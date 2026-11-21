// api.ts — calls to the app's own backend (apps/api). The browser never holds an API key:
// the backend reads the keys from .env and talks to the AI proxy. In dev, Vite forwards /api to it.
import type { Tone } from "./message.ts";
import { UNAUTHORIZED_EVENT } from "./session.ts";

function checkSession(res: Response) {
  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    throw new Error("Your session has ended. Please log in again.");
  }
}

export interface RewriteResult { subject: string; body: string; tone: Tone; model: string }

export async function rewriteWithAI(input: { clientId: string; tone?: Tone; issueKeys?: string[] }): Promise<RewriteResult> {
  let res: Response;
  try {
    res = await fetch("/api/messages/rewrite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(90_000),
    });
  } catch {
    throw new Error("The AI service isn't reachable. Is the API running (npm run api)?");
  }
  checkSession(res);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The AI service answered ${res.status}.`);
  return data as RewriteResult;
}

export interface SendResult { sent: true; to: string; family: string; at: string }

/** Sends the approved message through the team's WhatsApp bot (via our API). Recipient is the demo phone set in .env. */
export async function sendViaWhatsApp(input: { clientId: string; subject: string; body: string }): Promise<SendResult> {
  let res: Response;
  try {
    res = await fetch("/api/messages/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("The API isn't reachable. Is it running (npm run api)?");
  }
  checkSession(res);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Sending failed (HTTP ${res.status}).`);
  return data as SendResult;
}

/** Test phone per family (one phone plays one family in the demo). Shared by every device via the server. */
export async function getPhones(): Promise<Record<string, string>> {
  const res = await fetch("/api/phones", { signal: AbortSignal.timeout(10_000) });
  checkSession(res);
  if (!res.ok) throw new Error(`Could not load the phones (HTTP ${res.status}).`);
  return res.json();
}

export async function savePhone(clientId: string, phone: string): Promise<{ phone: string; registered: boolean }> {
  const res = await fetch(`/api/phones/${encodeURIComponent(clientId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
    signal: AbortSignal.timeout(15_000),
  });
  checkSession(res);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Saving failed (HTTP ${res.status}).`);
  return data;
}
