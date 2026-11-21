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
import { buscarContexto } from "./contexto.js";
import { buildSystemPrompt, caseExists } from "./prompt.js";

const PROXY = (process.env.LLM_PROXY_URL || "https://llm-hackathon.sherpaswealth.com").replace(/\/+$/, "");
const MODEL = process.env.LLM_MODEL || "gpt-5-mini";
// "low" cuts gpt-5-mini's hidden reasoning from ~1,900 to ~400 tokens: replies in ~10 s instead of ~28 s,
// with the same rules followed. Set LLM_REASONING_EFFORT=medium for more careful (slower) answers.
const REASONING_EFFORT = process.env.LLM_REASONING_EFFORT || "low";

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
  // Which family is this chat about? Its own link, else the latest message sent from the app
  // (WhatsApp may reply from a different JID), else BOT_DEFAULT_CLIENT if set.
  let { ctx, via } = buscarContexto(jid);
  if (!ctx && caseExists(process.env.BOT_DEFAULT_CLIENT)) {
    ctx = { clientId: process.env.BOT_DEFAULT_CLIENT, text: "" };
    via = "BOT_DEFAULT_CLIENT";
  }
  if (!caseExists(ctx?.clientId)) {
    console.log(`IA: sin familia para ${jid}: no se ha enviado ningún mensaje desde la web todavía (o pon BOT_DEFAULT_CLIENT en .env).`);
    return SIN_CONTEXTO;
  }
  console.log(`IA: ${jid} -> ${ctx.clientId} (${via})`);
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
    body: JSON.stringify({ model: MODEL, messages, reasoning_effort: REASONING_EFFORT }),
    signal: AbortSignal.timeout(40_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`proxy ${res.status}: ${data?.error?.message ?? res.statusText}`);
  const reply = paraWhatsApp(String(data?.choices?.[0]?.message?.content ?? ""));
  if (!reply) throw new Error("respuesta vacía de la IA");
  return reply;
}
