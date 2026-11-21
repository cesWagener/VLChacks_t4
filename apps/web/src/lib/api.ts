// api.ts — calls to the app's own backend (apps/api). The browser never holds an API key:
// the backend reads the keys from .env and talks to the AI proxy. In dev, Vite forwards /api to it.
import type { Tone } from "./message.ts";

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
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The AI service answered ${res.status}.`);
  return data as RewriteResult;
}
