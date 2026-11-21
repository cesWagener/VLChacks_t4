// ai.js — módulo de IA del bot.
//
// Contrato (lo usa index.js, sin cambios):
//   responder({ jid, text, history }) -> Promise<string>
//
// Answers the client's WhatsApp reply as the family's Senior Financial and Tax Advisor, with the master
// prompt in prompts/advisor-system.md filled with that family's case files (see prompt.js).
// Which family a chat is about comes from the last message the advisor sent from the web app (contexto.js).
// Model: gpt-5-mini through the hackathon AI proxy. Keys come from the repo-root .env (TEAM_KEY, LLM_PROXY_URL).
import "./env.js"; // loads the repo-root .env
import { leerContexto } from "./contexto.js";
import { buildSystemPrompt, caseExists } from "./prompt.js";

const PROXY = (process.env.LLM_PROXY_URL || "https://llm-hackathon.sherpaswealth.com").replace(/\/+$/, "");
const MODEL = process.env.LLM_MODEL || "gpt-5-mini";

const SIN_CONTEXTO =
  "Hi! This is your advisor's team. So I can help you properly, could you tell me your name? Your advisor will follow up with you personally.";

/** WhatsApp bold is *text*; the model writes Markdown **text**. Headings and code fences are not wanted. */
function paraWhatsApp(text) {
  return text
    .replace(/\*\*(.+?)\*\*/gs, "*$1*")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```/g, "")
    .trim();
}

export async function responder({ jid, text, history }) {
  const ctx = leerContexto(jid);
  if (!caseExists(ctx?.clientId)) return SIN_CONTEXTO;
  if (!process.env.TEAM_KEY) throw new Error("TEAM_KEY falta en .env");

  const messages = [
    { role: "system", content: buildSystemPrompt(ctx.clientId, ctx) },
    ...(history ?? []).slice(-8),
    { role: "user", content: text },
  ];
  const res = await fetch(`${PROXY}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.TEAM_KEY}`, "Content-Type": "application/json" },
    // No max_tokens: gpt-5-mini spends tokens on reasoning, and a low limit returns an empty answer.
    body: JSON.stringify({ model: MODEL, messages }),
    signal: AbortSignal.timeout(40_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`proxy ${res.status}: ${data?.error?.message ?? res.statusText}`);
  const reply = paraWhatsApp(String(data?.choices?.[0]?.message?.content ?? ""));
  if (!reply) throw new Error("respuesta vacía de la IA");
  return reply;
}
