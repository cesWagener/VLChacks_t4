// server.ts — the advisor app's backend. Plain node:http, no framework.
//   GET  /api/health             is the AI configured, which model
//   POST /api/messages/rewrite   { clientId, tone?, issueKeys? } -> { subject, body, tone, model }
// Keys come from the repo-root .env (npm start loads it). Only listens on localhost.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { LlmError, MODEL, llmConfigured } from "./llm.ts";
import { rewriteMessage } from "./rewrite.ts";
import { sendApprovedMessage, whatsappStatus } from "./whatsapp.ts";

const PORT = Number(process.env.API_PORT ?? 8787);
const HOST = process.env.API_HOST ?? "127.0.0.1";
const MAX_BODY = 16 * 1024;

function send(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<any> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new LlmError("Request too large.", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new LlmError("Invalid JSON.", 400); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      return send(res, 200, { ok: true, ai: llmConfigured(), model: MODEL });
    }
    if (req.method === "GET" && url.pathname === "/api/whatsapp/status") {
      return send(res, 200, await whatsappStatus());
    }
    if (req.method === "POST" && url.pathname === "/api/messages/send") {
      if (!(req.headers["content-type"] ?? "").includes("application/json")) throw new LlmError("Send JSON.", 415);
      const body = await readJson(req);
      const result = await sendApprovedMessage(body);
      console.log(`whatsapp sent ${body.clientId} to ${result.to}`);
      return send(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/api/messages/rewrite") {
      if (!(req.headers["content-type"] ?? "").includes("application/json")) throw new LlmError("Send JSON.", 415);
      const body = await readJson(req);
      const started = Date.now();
      const result = await rewriteMessage(body);
      console.log(`rewrite ${body.clientId} tone=${result.tone} ${Date.now() - started}ms tokens=${result.usage?.total_tokens ?? "?"}`);
      return send(res, 200, result);
    }
    send(res, 404, { error: "Not found" });
  } catch (e) {
    const status = e instanceof LlmError ? e.status : 500;
    const message = e instanceof LlmError ? e.message : "Unexpected server error.";
    if (!(e instanceof LlmError)) console.error(e);
    send(res, status, { error: message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`API on http://${HOST}:${PORT}  (AI: ${llmConfigured() ? `${MODEL} via proxy` : "TEAM_KEY missing in .env"})`);
});
