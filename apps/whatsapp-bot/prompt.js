// prompt.js — builds the advisor's system prompt for one family.
//
// The rules live in prompts/advisor-system.md: a compact version of the team's master prompt
// (the full original is docs/advisor-master-prompt.md). Edit them there; the file is re-read on every reply.
// Its {{FAMILY_FACTS}} placeholder gets a short fact sheet built from cases/<id>/ with ONLY the values the
// rules use, already formatted ("24.9%", "August 2033", "$373 per month"). That keeps each reply around
// 3-4k tokens instead of ~20k for the raw JSON files.
import "./env.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PROMPT_FILE = path.join(here, "prompts", "advisor-system.md");
const CASES_DIR = path.resolve(process.env.CASES_DIR || path.join(here, "..", "..", "cases"));

// ---------- formatting ----------
const usd = (n) => `$${Math.round(Number(n)).toLocaleString("en-US")}`;
const pct = (r, d = 1) => `${(Number(r) * 100).toFixed(d).replace(/\.0$/, "")}%`;
const month = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const isNum = (v) => v !== "" && v !== null && !Number.isNaN(Number(v)) && typeof v !== "boolean";
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** One `facts` entry ({value, unit, label, period}) as a short line. */
function fact(name, f) {
  if (!f || typeof f !== "object") return null;
  const isRange = !("value" in f) && "min" in f && "max" in f;
  if (!("value" in f) && !isRange) return null;
  const { value, unit = "", label = "", period = "" } = f;
  // The data's own warnings ("Never call this the emergency reserve") keep the model from mixing concepts.
  const warn = typeof f.note === "string" && /never|not |excludes|only/i.test(f.note) ? ` NOTE: ${clip(f.note, 110)}` : "";
  let v;
  if (isRange) {
    const fmt = (x) => (isNum(x) && /USD/.test(unit) ? usd(x) : x);
    v = `${fmt(f.min)} to ${fmt(f.max)}${/USD\/yr/.test(unit) ? " per year" : ""}`;
  } else if (value && typeof value === "object") {
    v = Object.entries(value).map(([k, x]) => `${k} ${isNum(x) && /USD/.test(unit) ? usd(x) : x}`).join(", ");
  } else if (isNum(value) && /USD\/yr/.test(unit)) v = `${usd(value)} per year`;
  else if (isNum(value) && /USD\/mo/.test(unit)) v = `${usd(value)} per month`;
  else if (isNum(value) && /USD/.test(unit)) v = usd(value);
  else if (isNum(value) && /(%|percent|ratio|share|rate)/i.test(unit) && Math.abs(Number(value)) <= 1.5) v = pct(value);
  else if (isNum(value) && /month/.test(unit)) v = `${value} months`;
  else if (typeof value === "string" && /%$/.test(value.trim())) v = value.trim();
  else v = `${value}${unit && !/n\/a/i.test(unit) ? ` ${unit}` : ""}`;
  return `- ${name}: ${v}${label ? ` (${clip(label, 90)}${period ? `; ${clip(period, 60)}` : ""})` : ""}${warn}`;
}

function factGroup(title, group) {
  if (!group) return [];
  const lines = [];
  for (const [k, f] of Object.entries(group)) {
    if (Array.isArray(f)) f.forEach((x, i) => { const l = fact(`${k}[${i + 1}]`, x); if (l) lines.push(l); });
    else { const l = fact(k, f); if (l) lines.push(l); }
  }
  return lines.length ? [`${title}:`, ...lines] : [];
}

/** Tables come as [[header...], [row...]]: turn the rows into objects. */
const rows = (t) => (Array.isArray(t) && Array.isArray(t[0]) ? t.slice(1).map((r) => Object.fromEntries(t[0].map((h, i) => [h, r[i]]))) : []);

// ---------- fact sheet ----------
function personaLines(raw) {
  const md = raw.replace(/\r\n/g, "\n");
  const fence = "```";
  const cls = md.match(new RegExp(`${fence}classification\\n([\\s\\S]*?)${fence}`))?.[1] ?? "";
  const profile = cls.split("\n").filter((l) => /^D\d/.test(l.trim())).join("; ");
  const ot = (md.match(/^- \*\*[OT]\d+[^\n]*/gm) ?? []).map((l) => `- ${clip(l.replace(/^- /, "").replace(/\*\*/g, ""), 230)}`);
  const d6 = md.match(/## D6[^\n]*\n\n([^\n]+)/)?.[1];
  const d5 = md.match(/## D5[^\n]*\n\n([^\n]+)/)?.[1];
  return [
    `Profile (persona): ${profile}`,
    d5 ? `Decision style: ${clip(d5, 200)}` : "",
    d6 ? `Motivational anchor: ${clip(d6, 200)}` : "",
    "Concerns and tensions:",
    ...ot,
  ].filter(Boolean);
}

function buildFacts(dir) {
  const fh = JSON.parse(fs.readFileSync(path.join(dir, "financial-health.json"), "utf8"));
  const ia = JSON.parse(fs.readFileSync(path.join(dir, "investment-analysis.json"), "utf8"));
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8") : "");
  const persona = read("persona.md");
  const legal = read("legal-values.json") ? JSON.parse(read("legal-values.json")) : {};
  const signals = read("signals.json") ? JSON.parse(read("signals.json")).signals ?? [] : [];
  const km = fh.key_metrics ?? {};
  const status = fh.case?.tax_filing_status ?? "";
  const out = [];

  // Household
  const hh = fh.case?.household ?? [];
  out.push(`Household: ${hh.map((h) => `${h.first_name} (${h.role}, ${h.age}${h.retirement_age ? `, retires at ${h.retirement_age}` : ""}${h.risk_profile ? `, risk ${h.risk_profile}` : ""})`).join("; ")}. ${fh.case?.city}, ${fh.case?.state}. Filing status: ${status}.`);
  out.push(...personaLines(persona));

  // Score
  const sc = fh.score ?? {};
  out.push(`Financial health score: ${sc.published_score}/100 (${sc.band}). Pillars: ${(sc.pillars ?? []).map((p) => `${p.pillar} ${p.points_shown_in_app}`).join("; ")}.`);
  if (sc.top_moves?.length) out.push(`Top moves: ${sc.top_moves.map((m) => `${m.title} (score ${m.score_before} to ${m.score_after})`).join("; ")}.`);

  // Goals, income, debts, insurance
  const goals = (fh.goals?.chartGoals ?? []).filter((g) => g.name && !/BANKRUPTCY/.test(g.goalType));
  out.push(`Goals: ${goals.map((g) => `${g.name} ${month(g.date)}${g.termDate && g.goalType === "VACATION" ? " (yearly)" : ""}`).join("; ")}.`);
  out.push(`Income: ${(fh.profile?.incomes ?? []).map((i) => `${i.name.replace(/^Client's income /, "")} (${(i.owner ?? []).join(" & ")}) ${usd(i.yearly)} per year ${i.starts}-${i.ends}`).join("; ")}.`);
  out.push(`Debts: ${(fh.profile?.liabilities ?? []).map((l) => `${l.name} ${usd(l.balance)} at ${pct(l.interest_rate)}, ${usd(l.monthly_payment)} per month`).join("; ") || "none"}.`);
  const cc = km.ratios?.creditCardDebt;
  if (cc?.hasDebt) out.push(`Credit card: payoff ${month(cc.ccPayoffDate)} at the current pace; about ${usd(cc.paymentsEqualToInterest)} per month goes to interest.`);
  out.push(`Insurance: ${(fh.profile?.insurance ?? []).map((i) => `${i.name} ${isNum(i.coverage) ? usd(i.coverage) : i.coverage}`).join("; ") || "none recorded"}.`);

  // Facts (cash, education, retirement)
  const facts = km.facts ?? {};
  out.push(...factGroup("Cash facts", facts.cash), ...factGroup("College facts", facts.education), ...factGroup("Retirement facts", facts.retirement));

  // Investments
  const ikm = ia.key_metrics ?? {};
  const h = ikm.performanceAnalysis?.household ?? {};
  out.push(`Portfolio: ${usd(h.aum ?? 0)} invested; ${pct(h.return3yAnnualized ?? 0)} per year over 3 years; worst fall ${pct(Math.abs(h.maxDrawdown3y ?? 0))}${h.maxDrawdownRecoveryDays ? `, recovered in ${h.maxDrawdownRecoveryDays} days` : ""}; stocks ${pct(h.currentEquityPct ?? 0)} of the portfolio.`);
  const events = (ikm.performanceAnalysis?.perEventDrawdowns ?? []).filter((e) => typeof e.household?.drawdownPct === "number")
    .sort((a, b) => a.household.drawdownPct - b.household.drawdownPct).slice(0, 4);
  if (events.length) out.push(`Their portfolio in past shocks: ${events.map((e) => `${e.eventTitle} (${month(e.eventDate)}) fell ${pct(Math.abs(e.household.drawdownPct))}${e.household.recoveryDays ? `, recovered in ${e.household.recoveryDays} days` : ""}`).join("; ")}.`);
  const envs = (list) => (list ?? []).filter((e) => /Financial Crisis|COVID/i.test(e.name)).map((e) => `${e.name} ${pct(e.performance)}`).join(", ");
  if (envs(ikm.portfolioAnalysis?.marketEnvironments)) out.push(`History, current mix: ${envs(ikm.portfolioAnalysis.marketEnvironments)}; recommended mix: ${envs(ikm.targetAnalysis?.marketEnvironments)}.`);
  const cd = ikm.concentrationAndDiversification ?? {};
  const sectors = rows(cd.sectorConcentration).slice(0, 3).map((r) => `${r.Sector} ${pct(r["Weight (% of equity)"])} of stocks (${r.Driver})`);
  if (sectors.length) out.push(`Sectors: ${sectors.join("; ")}.`);
  const us = rows(cd.geographyConcentration).find((r) => r.Geography === "United States");
  if (us) out.push(`Geography: United States ${pct(us["Weight (% of equity)"])} of stocks.`);
  const emp = rows(cd.employerConcentration).find((r) => r.Component === "Total employer exposure");
  if (emp && isNum(emp["% of net worth"])) out.push(`Employer exposure: salary equals ${pct(emp["% of net worth"])} of net worth.`);
  const single = rows(cd.singleStockConcentration);
  const byTicker = new Map();
  for (const p of ia.positions ?? []) {
    const k = p.ticker || p.name;
    const prev = byTicker.get(k);
    byTicker.set(k, { k, value: (prev?.value ?? 0) + Number(p.value || 0), category: p.category });
  }
  const holdings = [...byTicker.values()].sort((a, b) => b.value - a.value).slice(0, 8);
  out.push(`Holdings (largest first): ${holdings.map((p) => `${p.k} ${usd(p.value)}${p.category ? ` (${p.category})` : ""}`).join("; ")}.${single.length ? "" : " No individual stocks."}`);
  const sw = rows(ikm.savingsAndContributions?.savingsWaterfall).filter((r) => r.Status && r.Status !== "N/A").slice(0, 8);
  if (sw.length) out.push(`Savings priority order: ${sw.map((r) => `${r["#"]}. ${r.Bucket} (${r.Status}${isNum(r.Delta) && Number(r.Delta) ? `, ${usd(Math.abs(r.Delta))} to go` : ""})`).join("; ")}.`);
  const hsa = ikm.savingsAndContributions?.taxOpportunityCheck?.hsaCheck;
  if (hsa) out.push(`HSA: ${hsa.hasHsa ? "has one" : "none"}; room ${usd(hsa.contributionGap ?? 0)} per year, saving about ${usd(hsa.annualTaxSavingsAtCurrentMarginal ?? 0)} per year in tax (eligibility to be confirmed).`);

  // Tax and legal values (2026 and 2027 only, for their filing status)
  const yv = (k, y) => legal[k]?.[y]?.value;
  const src = (k, y) => clip(String(legal[k]?.[y]?.source ?? "").split(/[:(]/)[0].trim(), 60);
  const ss26 = yv("SSWageBaseByYear", "2026"), ss27 = yv("SSWageBaseByYear", "2027");
  const sd26 = yv("StandardDeductionByYear", "2026")?.[status], sd27 = yv("StandardDeductionByYear", "2027")?.[status];
  const ct26 = yv("ChildTaxCreditByYear", "2026"), ct27 = yv("ChildTaxCreditByYear", "2027");
  const tax = [];
  if (ss27) tax.push(`Social Security wage base ${ss26 ? `${usd(ss26)} (2026) to ` : ""}${usd(ss27)} (2027) [${src("SSWageBaseByYear", "2027")}]`);
  if (sd27) tax.push(`standard deduction (${status}) ${sd26 ? `${usd(sd26)} to ` : ""}${usd(sd27)} [${src("StandardDeductionByYear", "2027")}]`);
  if (ct27) tax.push(`child tax credit ${ct26 ? `${usd(ct26.perChild)} to ` : ""}${usd(ct27.perChild)} per child under ${ct27.childUnderAge}, phase-out from ${usd(ct27.phaseOutStart?.[status] ?? 0)}`);
  if (tax.length) out.push(`Tax values: ${tax.join("; ")}.`);

  // Signals
  for (const s of signals) {
    out.push(`Signal (${s.moment}, ${month(s.date)}): ${s.headline}. For them: ${clip((s.touches_this_family ?? []).join(" "), 320)}${s.sources?.length ? ` Sources: ${clip(s.sources.map((x) => x.split(/[:(]/)[0].trim()).join("; "), 120)}.` : ""}`);
  }
  return { text: out.join("\n"), adults: hh.filter((x) => x.role !== "child").map((x) => x.first_name) };
}

export function caseExists(clientId) {
  return /^[a-z0-9-]{1,80}$/.test(clientId ?? "") && fs.existsSync(path.join(CASES_DIR, clientId, "financial-health.json"));
}

const today = () => new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** Full system prompt for this family. ctx = last message the advisor sent (from contexto.js), optional. */
export function buildSystemPrompt(clientId, ctx) {
  const { text, adults } = buildFacts(path.join(CASES_DIR, clientId));
  const facts = [
    `Today: ${today()}. You are writing on WhatsApp to ${adults.join(" and ") || "the family"}, as their advisor's team.`,
    text,
    ctx?.text ? `The last message their advisor sent them (they are replying to it):\n"""\n${clip(ctx.text, 1200)}\n"""` : "",
  ].filter(Boolean).join("\n");
  return fs.readFileSync(PROMPT_FILE, "utf8").replace("{{FAMILY_FACTS}}", facts);
}
