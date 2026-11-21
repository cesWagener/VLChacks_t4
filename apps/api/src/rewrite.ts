// rewrite.ts — turns the rule-based draft into a warmer, more personal message with the AI,
// using only facts the server derives itself from the family's plan. The browser only sends
// which family, which tone and which topics; it cannot inject facts or instructions.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { draftMessage, TONES, type Tone } from "../../web/src/lib/message.ts";
import type { PlanData } from "../../web/src/lib/plan.ts";
import { chat, LlmError } from "./llm.ts";

const PLANS_DIR = fileURLToPath(new URL("../../web/public/plans/", import.meta.url));
const TONE_IDS = new Set<string>(TONES.map(t => t.id));

export function loadPlan(clientId: string): PlanData | null {
  if (!/^[a-z0-9-]{1,80}$/.test(clientId)) return null;
  try { return JSON.parse(readFileSync(`${PLANS_DIR}${clientId}.json`, "utf8")); } catch { return null; }
}

const TONE_GUIDE: Record<Tone, string> = {
  supportive: "Supportive. The family is in a difficult position. Be warm and empathetic: open with what they do well, name the hard points plainly but gently, say clearly it is not their fault, suggest one small first step, no pressure.",
  steady: "Steady. Honest and calm. If an issue is severe, say you wanted them to hear it from you first, and that there is time to act.",
  celebratory: "Celebratory. Recognise their progress warmly; mention at most one small thing to tidy up.",
  reassuring: "Reassuring, after a market fall. Calm first: falls are normal and the plan expects them. Use their own portfolio history. Say there is nothing to do today and selling after a fall locks in losses.",
  brief: "Brief, for a text message: at most 3 short sentences, one point, one question. No subject line needed but still return one.",
};

export interface RewriteInput { clientId: string; tone?: string; issueKeys?: string[] }

export async function rewriteMessage(input: RewriteInput) {
  const plan = loadPlan(String(input.clientId ?? ""));
  if (!plan) throw new LlmError("Unknown client.", 404);
  const tone = TONE_IDS.has(String(input.tone)) ? (input.tone as Tone) : undefined;
  const issueKeys = Array.isArray(input.issueKeys) ? input.issueKeys.filter(k => typeof k === "string").slice(0, 10) : undefined;
  const draft = draftMessage(plan, { tone, issueKeys });
  const used = draft.issues.filter(i => draft.usedIssues.includes(i.key));

  const facts = {
    family: plan.displayName,
    greetingNames: plan.adults,
    children: plan.household.filter(h => h.role === "child").map(h => `${h.firstName} (${h.age})`),
    city: `${plan.city}, ${plan.state}`,
    financialHealthScore: `${plan.score.value}/100, ${plan.score.band}`,
    strengths: draft.strengths.slice(0, 2).map(s => s.text),
    topicsToRaise: used.map(i => i.text),
    upcomingMilestone: draft.milestone ? `${draft.milestone.label}, ${draft.milestone.date.slice(0, 7)}` : null,
    suggestedFirstStep: draft.firstStep,
    marketHistory: draft.tone === "reassuring" && plan.market ? {
      worstEvent: plan.market.worstEvent ? `${plan.market.worstEvent.title} (${plan.market.worstEvent.date.slice(0, 7)}): portfolio fell ${(-plan.market.worstEvent.drawdown * 100).toFixed(1)}%` : null,
      worstFall3y: `${(-plan.market.maxDrawdown * 100).toFixed(1)}%${plan.market.recoveryDays ? `, recovered in ${plan.market.recoveryDays} days` : ""}`,
      growthPerYear3y: `${(plan.market.return3yAnnualized * 100).toFixed(1)}%`,
    } : undefined,
  };

  const system = [
    "You draft a personal message from a financial advisor named David to one client family. David reviews and approves it before anything is sent.",
    "Rules:",
    "- Use ONLY the facts provided. Never invent numbers, dates, products, names or events. You may round numbers the way a person would.",
    "- Plain, human English. Short paragraphs. No jargon, no bullet points, no emojis, no exclamation marks in hard news.",
    "- No guarantees about returns or outcomes. Do not recommend specific products or securities.",
    "- Greet the adults by first name. Sign off as David.",
    `- Tone: ${TONE_GUIDE[draft.tone]}`,
    draft.tone === "brief" ? "- Length: under 60 words." : "- Length: 120 to 220 words.",
    'Return JSON only: {"subject": string, "body": string}. The body is plain text with \\n line breaks.',
  ].join("\n");

  const user = [
    `Facts about the family (from their plan):\n${JSON.stringify(facts, null, 2)}`,
    `A rule-based draft that is correct but generic. Keep its facts, make it sound like David wrote it for this family:\nSubject: ${draft.subject}\n\n${draft.body}`,
  ].join("\n\n");

  const out = await chat([{ role: "system", content: system }, { role: "user", content: user }], { json: true });
  let parsed: { subject?: unknown; body?: unknown };
  try { parsed = JSON.parse(out.content); } catch { throw new LlmError("The AI answer was not valid JSON."); }
  const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
  const body = typeof parsed.body === "string" ? parsed.body.trim() : "";
  if (!subject || !body) throw new LlmError("The AI answer was incomplete.");
  return { subject: subject.slice(0, 200), body: body.slice(0, 4000), tone: draft.tone, model: out.model, usage: out.usage };
}
