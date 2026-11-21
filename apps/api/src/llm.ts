// llm.ts — calls the hackathon AI proxy (OpenAI-compatible) with the team key from .env.
// The key never leaves this server. Limits from the challenge README: 60 requests/min, 4 concurrent per team.

const PROXY = (process.env.LLM_PROXY_URL ?? "https://llm-hackathon.sherpaswealth.com").replace(/\/+$/, "");
const KEY = process.env.TEAM_KEY ?? "";
export const MODEL = process.env.LLM_MODEL ?? "gpt-5-mini";

const MAX_CONCURRENT = 3;      // stay under the team's 4 concurrent requests (teammates share the key)
const MAX_PER_MINUTE = 20;     // stay well under 60/min
let active = 0;
const recent: number[] = [];

export class LlmError extends Error {
  status: number;
  constructor(message: string, status = 502) { super(message); this.status = status; }
}

export const llmConfigured = () => KEY.length > 0;

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }

export async function chat(messages: ChatMessage[], { json = false, timeoutMs = 60_000 } = {}) {
  if (!llmConfigured()) throw new LlmError("TEAM_KEY is missing from .env", 500);
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= MAX_PER_MINUTE || active >= MAX_CONCURRENT) throw new LlmError("Too many AI requests right now. Try again in a minute.", 429);
  recent.push(now);
  active++;
  try {
    const res = await fetch(`${PROXY}/v1/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      // No max_tokens: gpt-5-mini spends tokens on reasoning, and a low limit returns an empty answer (README).
      body: JSON.stringify({ model: MODEL, messages, ...(json ? { response_format: { type: "json_object" } } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => null) as any;
    if (!res.ok) throw new LlmError(`AI proxy answered ${res.status}: ${data?.error?.message ?? res.statusText}`, res.status === 429 ? 429 : 502);
    const content: string = data?.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new LlmError("The AI returned an empty answer.");
    return { content, usage: data?.usage ?? null, model: data?.model ?? MODEL };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e instanceof Error && e.name === "TimeoutError") throw new LlmError("The AI took too long to answer.", 504);
    throw new LlmError(`Could not reach the AI proxy: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    active--;
  }
}
