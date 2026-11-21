// check-connections.ts — checks every connection the backend depends on. Prints no secret values.
//   npm run check            (from apps/api)   or   npm run api:check   (from the repo root)
// Checks: .env values, AI proxy (key + budget + one tiny model call), MCP case server, local API server.
// The model call costs a fraction of a cent. Exit code 1 if a required check fails.

try { process.loadEnvFile(new URL("../../../.env", import.meta.url)); } catch { /* no .env: use the environment */ }

const PROXY = (process.env.LLM_PROXY_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.TEAM_KEY ?? "";
const MCP_URL = process.env.MCP_URL ?? "";
const MCP_TOKEN = process.env.MCP_TOKEN ?? "";
const MODEL = process.env.LLM_MODEL ?? "gpt-5-mini";
const API = `http://127.0.0.1:${process.env.PORT ?? process.env.API_PORT ?? 8787}`;

let failed = 0;
const ok = (name: string, detail = "") => console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`);
const bad = (name: string, detail: string) => { failed++; console.log(`  FAIL  ${name}  ${detail}`); };
const warn = (name: string, detail: string) => console.log(`  WARN  ${name}  ${detail}`);
const mask = (s: string) => (s ? `${s.slice(0, 3)}…, ${s.length} chars` : "missing");

async function step(name: string, fn: () => Promise<void>) {
  try { await fn(); } catch (e) { bad(name, e instanceof Error ? e.message : String(e)); }
}

console.log("\n1. Environment (.env)");
for (const [k, v] of [["LLM_PROXY_URL", PROXY], ["TEAM_KEY", KEY], ["MCP_URL", MCP_URL], ["MCP_TOKEN", MCP_TOKEN]] as const) {
  if (!v) bad(k, "missing from .env");
  else ok(k, k.endsWith("URL") ? v : mask(v));
}

console.log("\n2. AI proxy");
await step("key and budget (/key/info)", async () => {
  const r = await fetch(`${PROXY}/key/info`, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}: key rejected or proxy down`);
  const j: any = await r.json();
  const spend = Number(j.info?.spend ?? 0), max = Number(j.info?.max_budget ?? 0);
  ok("key and budget (/key/info)", `spent $${spend.toFixed(4)} of $${max}`);
  if (max && spend / max > 0.8) warn("budget", "more than 80% used");
  const models: string[] = j.info?.models ?? [];
  if (models.length && !models.includes(MODEL)) bad("model available", `${MODEL} is not in this key's models`);
  else ok("model available", MODEL);
});
await step("model answers (/v1/chat/completions)", async () => {
  const started = Date.now();
  const r = await fetch(`${PROXY}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "user", content: "Reply with the single word: connected" }] }),
    signal: AbortSignal.timeout(60_000),
  });
  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${j?.error?.message ?? r.statusText}`);
  const text = String(j?.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new Error("empty answer");
  ok("model answers (/v1/chat/completions)", `"${text.slice(0, 40)}", ${Date.now() - started} ms, ${j?.usage?.total_tokens ?? "?"} tokens`);
});

console.log("\n3. MCP case server");
await step("MCP list_cases", async () => {
  let session = "";
  let id = 0;
  // Streamable HTTP MCP: JSON-RPC over POST; answers come as JSON or as server-sent events.
  const rpc = async (method: string, params: object, notify = false) => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${MCP_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (session) headers["Mcp-Session-Id"] = session;
    const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++id, method, params };
    const r = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (r.status === 401 || r.status === 403) throw new Error(`HTTP ${r.status}: token rejected (it lasts 72 h; log in again for a new one)`);
    if (r.status === 429) throw new Error("HTTP 429: MCP rate limit (120/min per network). Wait a minute.");
    if (!r.ok && !(notify && r.status === 202)) throw new Error(`HTTP ${r.status} on ${method}`);
    session = r.headers.get("mcp-session-id") ?? session;
    if (notify) return null;
    const text = await r.text();
    const json = (r.headers.get("content-type") ?? "").includes("event-stream")
      ? text.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).filter(Boolean).map(l => JSON.parse(l)).find(m => m.id === id)
      : JSON.parse(text);
    if (json?.error) throw new Error(`${method}: ${json.error.message}`);
    return json?.result;
  };
  await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "connection-check", version: "1.0.0" } });
  await rpc("notifications/initialized", {}, true);
  const result: any = await rpc("tools/call", { name: "list_cases", arguments: {} });
  const raw = result?.content?.[0]?.text ?? "";
  const ids = [...raw.matchAll(/"(?:caseId|id|slug)"\s*:\s*"([a-z0-9-]+)"/g)].map(m => m[1]);
  const unique = [...new Set(ids)];
  ok("MCP list_cases", unique.length ? `${unique.length} cases: ${unique.join(", ")}` : `answered (${raw.length} chars)`);
});

console.log("\n4. Local API server (apps/api)");
await step("API /api/health", async () => {
  let r: Response;
  try { r = await fetch(`${API}/api/health`, { signal: AbortSignal.timeout(5_000) }); }
  catch { warn("API /api/health", `not running on ${API}. Start it with: npm run api`); return; }
  const j: any = await r.json();
  if (!r.ok || !j.ok) throw new Error(`HTTP ${r.status}`);
  if (!j.ai) bad("API /api/health", "running, but it has no TEAM_KEY");
  else ok("API /api/health", `running, AI on ${j.model}`);
});

console.log("\n5. WhatsApp bot outbox (wabot/outbox.js)");
await step("outbox /health", async () => {
  const url = (process.env.OUTBOX_URL ?? "").replace(/\/+$/, "");
  const secret = process.env.OUTBOX_SECRET ?? "";
  if (!url || !secret || !process.env.WHATSAPP_DEMO_TO) { warn("outbox /health", "OUTBOX_URL, OUTBOX_SECRET or WHATSAPP_DEMO_TO missing in .env"); return; }
  let r: Response;
  try { r = await fetch(`${url}/health`, { headers: { "X-Outbox-Secret": secret }, signal: AbortSignal.timeout(5_000) }); }
  catch { bad("outbox /health", `bot not reachable at ${url}. It runs on Ches's laptop: OUTBOX_URL must be its tunnel address (https://….trycloudflare.com), with the bot and the tunnel running.`); return; }
  if (r.status === 401) throw new Error("secret rejected: OUTBOX_SECRET differs between this .env and the bot's .env");
  const j: any = await r.json().catch(() => ({}));
  if (!j.connected) bad("outbox /health", "bot reachable, but not logged in to WhatsApp (scan the QR)");
  else ok("outbox /health", `bot reachable at ${url} and connected to WhatsApp`);
});

console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nALL CONNECTIONS OK\n");
process.exit(failed ? 1 : 0);
