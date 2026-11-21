// whatsapp.ts — sends an approved message through the team's WhatsApp bot (wabot/outbox.js).
// The recipient is fixed by .env (WHATSAPP_DEMO_TO): the families are fictional, so every message goes
// to the team's own demo phone, never to a real client (challenge ground rule: send no real messages).
import { LlmError as ApiError } from "./llm.ts";
import { loadPlan } from "./rewrite.ts";

const OUTBOX_URL = (process.env.OUTBOX_URL ?? "http://127.0.0.1:8788").replace(/\/+$/, "");
const SECRET = process.env.OUTBOX_SECRET ?? "";
const DEMO_TO = process.env.WHATSAPP_DEMO_TO ?? "";

export const whatsappConfigured = () => Boolean(SECRET && DEMO_TO);
export const maskRecipient = (to: string) => (to.length > 6 ? `…${to.replace(/@.*/, "").slice(-4)}` : "demo phone");

async function outbox(path: string, init: RequestInit = {}) {
  try {
    return await fetch(`${OUTBOX_URL}${path}`, {
      ...init,
      headers: { "X-Outbox-Secret": SECRET, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ApiError(`The WhatsApp bot isn't reachable at ${OUTBOX_URL}. Is it running, on the same network?`, 503);
  }
}

export async function whatsappStatus() {
  if (!whatsappConfigured()) return { configured: false, reachable: false, connected: false };
  try {
    const r = await outbox("/health");
    const j: any = await r.json().catch(() => ({}));
    return { configured: true, reachable: r.ok, connected: Boolean(j.connected), recipient: maskRecipient(DEMO_TO) };
  } catch {
    return { configured: true, reachable: false, connected: false, recipient: maskRecipient(DEMO_TO) };
  }
}

export interface SendInput { clientId?: unknown; subject?: unknown; body?: unknown }

export async function sendApprovedMessage(input: SendInput) {
  if (!whatsappConfigured()) throw new ApiError("WhatsApp sending is not set up: add OUTBOX_SECRET and WHATSAPP_DEMO_TO to .env.", 500);
  const plan = loadPlan(String(input.clientId ?? ""));
  if (!plan) throw new ApiError("Unknown client.", 404);
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) throw new ApiError("The message is empty.", 400);
  // WhatsApp has no subject line: show it in bold above the message.
  const text = `${subject ? `*${subject}*\n\n` : ""}${body}`;
  if (text.length > 4000) throw new ApiError("The message is too long for WhatsApp (4,000 characters max).", 400);

  const r = await outbox("/send", { method: "POST", body: JSON.stringify({ to: DEMO_TO, text }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(`The WhatsApp bot refused the message: ${j.error ?? `HTTP ${r.status}`}`, r.status === 429 ? 429 : 502);
  return { sent: true, to: maskRecipient(DEMO_TO), family: plan.displayName, at: new Date().toISOString() };
}
