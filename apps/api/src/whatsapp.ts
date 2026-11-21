// whatsapp.ts — sends an approved message through the team's WhatsApp bot (wabot/outbox.js).
// The recipient is fixed by .env (WHATSAPP_DEMO_TO): the families are fictional, so every message goes
// to the team's own demo phone, never to a real client (challenge ground rule: send no real messages).
//
// The bot runs on a teammate's laptop. On guest Wi-Fi laptops usually can't reach each other, so the
// teammate exposes the outbox with a tunnel (e.g. `cloudflared tunnel --url http://localhost:8788`) and
// OUTBOX_URL holds that https address. The outbox is protected by OUTBOX_SECRET either way.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LlmError as ApiError } from "./llm.ts";
import { loadPlan } from "./rewrite.ts";

const ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));
const KEYS = ["OUTBOX_URL", "OUTBOX_SECRET", "WHATSAPP_DEMO_TO"] as const;

/** Reads the WhatsApp settings fresh from .env on every call, so a new OUTBOX_URL works without a restart. */
function config() {
  const fromFile: Record<string, string> = {};
  try {
    for (const line of readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m && (KEYS as readonly string[]).includes(m[1])) fromFile[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* no .env: fall back to the environment */ }
  const get = (k: (typeof KEYS)[number]) => fromFile[k] ?? process.env[k] ?? "";
  return {
    url: (get("OUTBOX_URL") || "http://127.0.0.1:8788").replace(/\/+$/, ""),
    secret: get("OUTBOX_SECRET"),
    to: get("WHATSAPP_DEMO_TO"),
  };
}

export const maskRecipient = (to: string) => (to.length > 6 ? `…${to.replace(/@.*/, "").slice(-4)}` : "demo phone");
const isLocal = (url: string) => /\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);

function unreachable(url: string) {
  return isLocal(url)
    ? `No WhatsApp bot is running on this laptop (${url}). The bot runs on Ches's laptop: put the address it shares (the https://….trycloudflare.com tunnel) in OUTBOX_URL in .env, then send again.`
    : `The WhatsApp bot isn't answering at ${url}. Check that the bot and its tunnel are still running on Ches's laptop (the tunnel address changes each time it restarts).`;
}

async function outbox(path: string, init: RequestInit = {}) {
  const c = config();
  try {
    return await fetch(`${c.url}${path}`, {
      ...init,
      headers: { "X-Outbox-Secret": c.secret, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new ApiError(unreachable(c.url), 503);
  }
}

export async function whatsappStatus() {
  const c = config();
  const base = { configured: Boolean(c.secret && c.to), url: c.url, recipient: c.to ? maskRecipient(c.to) : null };
  if (!base.configured) return { ...base, reachable: false, connected: false };
  try {
    const r = await outbox("/health");
    const j: any = await r.json().catch(() => ({}));
    return { ...base, reachable: r.ok, secretOk: r.status !== 401, connected: Boolean(j.connected) };
  } catch {
    return { ...base, reachable: false, connected: false };
  }
}

export interface SendInput { clientId?: unknown; subject?: unknown; body?: unknown }

export async function sendApprovedMessage(input: SendInput) {
  const c = config();
  if (!c.secret || !c.to) throw new ApiError("WhatsApp sending is not set up: add OUTBOX_SECRET and WHATSAPP_DEMO_TO to .env.", 500);
  const plan = loadPlan(String(input.clientId ?? ""));
  if (!plan) throw new ApiError("Unknown client.", 404);
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  if (!body) throw new ApiError("The message is empty.", 400);
  // WhatsApp has no subject line: show it in bold above the message.
  const text = `${subject ? `*${subject}*\n\n` : ""}${body}`;
  if (text.length > 4000) throw new ApiError("The message is too long for WhatsApp (4,000 characters max).", 400);

  const r = await outbox("/send", { method: "POST", body: JSON.stringify({ to: c.to, text, clientId: plan.id, subject }) });
  const j: any = await r.json().catch(() => ({}));
  if (r.status === 401) throw new ApiError("The bot rejected the secret: OUTBOX_SECRET must be identical in your .env and in Ches's .env.", 502);
  if (r.status === 503) throw new ApiError("The bot is running but not logged in to WhatsApp. Ches should check the bot's terminal (QR code).", 503);
  if (!r.ok) throw new ApiError(`The WhatsApp bot refused the message: ${j.error ?? `HTTP ${r.status}`}`, r.status === 429 ? 429 : 502);
  return { sent: true, to: maskRecipient(c.to), family: plan.displayName, at: new Date().toISOString() };
}
