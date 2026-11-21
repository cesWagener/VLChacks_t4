// prompt.js — builds the advisor's system prompt for one family.
//
// The prompt text lives in prompts/advisor-system.md (edit it there; it is re-read on every reply).
// Its four placeholders are filled with that family's case files from cases/<id>/:
//   {{PERSONA_MD}}                  persona.md, as is
//   {{FINANCIAL_HEALTH_SUMMARY}}    the financial-health.json fields the prompt refers to
//   {{INVESTMENT_ANALYSIS_SUMMARY}} the investment-analysis.json fields the prompt refers to
//   {{LEGAL_VALUES_AND_SIGNALS}}    legal-values.json + signals.json
// A short runtime block is appended: today's date, the channel, and the last message the advisor sent.
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = path.join(here, "prompts", "advisor-system.md");
const CASES_DIR = path.resolve(process.env.CASES_DIR || path.join(here, "..", "..", "cases"));

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj?.[k] !== undefined).map((k) => [k, obj[k]]));

export function caseExists(clientId) {
  return /^[a-z0-9-]{1,80}$/.test(clientId ?? "") && fs.existsSync(path.join(CASES_DIR, clientId, "financial-health.json"));
}

function financialHealthSummary(fh) {
  const km = fh.key_metrics ?? {};
  const { rules: _rules, ...facts } = km.facts ?? {}; // `rules` is internal scoring detail the prompt never uses
  return {
    case: pick(fh.case, ["household", "city", "state", "tax_filing_status"]),
    score: pick(fh.score, ["published_score", "band", "pillars", "top_moves", "combined_moves"]),
    goals: { chartGoals: fh.goals?.chartGoals ?? [], goalsSummary: fh.goals?.goalsSummary ?? [] },
    profile: pick(fh.profile, ["incomes", "liabilities", "insurance", "goals"]),
    key_metrics: {
      facts,
      ratios: pick(km.ratios, ["creditCardDebt", "emergencyFund", "debtToIncome", "savingsLevel", "lifeInsurance", "umbrella"]),
    },
    narrative: pick(fh.narrative, ["summary_main", "summary_recommendations"]),
  };
}

function investmentSummary(ia) {
  const km = ia.key_metrics ?? {};
  return {
    positions: (ia.positions ?? []).map((p) => pick(p, ["account", "ticker", "name", "category", "value", "weight_in_account"])),
    key_metrics: {
      performanceAnalysis: pick(km.performanceAnalysis, ["window", "household", "perEventDrawdowns", "sameRiskBenchmark"]),
      portfolioAnalysis: pick(km.portfolioAnalysis, ["marketEnvironments"]),
      targetAnalysis: pick(km.targetAnalysis, ["marketEnvironments"]),
      concentrationAndDiversification: pick(km.concentrationAndDiversification, ["totals", "sectorConcentration", "geographyConcentration", "employerConcentration", "singleStockConcentration"]),
      savingsAndContributions: pick(km.savingsAndContributions, ["savingsWaterfall", "taxOpportunityCheck"]),
      taxDragAnalysis: km.taxDragAnalysis,
    },
  };
}

const today = () => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** Full system prompt for this family. ctx = last message the advisor sent (from contexto.js), optional. */
export function buildSystemPrompt(clientId, ctx) {
  const dir = path.join(CASES_DIR, clientId);
  const fh = readJson(path.join(dir, "financial-health.json"));
  const ia = readJson(path.join(dir, "investment-analysis.json"));
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8") : "");
  const legal = read("legal-values.json");
  const signals = read("signals.json");

  const values = {
    PERSONA_MD: read("persona.md").trim(),
    FINANCIAL_HEALTH_SUMMARY: JSON.stringify(financialHealthSummary(fh)),
    INVESTMENT_ANALYSIS_SUMMARY: JSON.stringify(investmentSummary(ia)),
    LEGAL_VALUES_AND_SIGNALS: JSON.stringify({
      legal_values: legal ? JSON.parse(legal) : null,
      signals: signals ? JSON.parse(signals) : null,
    }),
  };
  const template = fs.readFileSync(PROMPT_FILE, "utf8");
  const filled = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, key) => (key in values ? values[key] : m));

  const adults = (fh.case?.household ?? []).filter((h) => h.role !== "child").map((h) => h.first_name);
  const runtime = [
    "",
    "================================================================================",
    "RUNTIME CONTEXT",
    "================================================================================",
    `- Today's date: ${today()}. Milestones before this date are in the past.`,
    `- You are writing to ${adults.join(" and ") || "the family"} on WhatsApp, as their advisor's team.`,
    "- Reply in the same language the client writes in.",
    ctx?.text ? `- The last message their advisor sent them (they are replying to it):\n"""\n${ctx.text}\n"""` : "",
  ].filter(Boolean).join("\n");

  return `${filled}\n${runtime}`;
}
