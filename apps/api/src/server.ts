// server.ts — the advisor app's server. Plain node:http, no framework.
//
// API:
//   GET  /api/health             is the AI configured, which model          (open)
//   GET  /api/session            { required, authenticated }                (open)
//   POST /api/login              { password } -> session cookie             (open)
//   POST /api/logout                                                         (open)
//   GET  /api/whatsapp/status    bot reachable / logged in                  (password)
//   POST /api/messages/rewrite   { clientId, tone?, issueKeys? }            (password)
//   POST /api/messages/send      { clientId, subject, body }                (password)
//   GET  /api/phones             { clientId: phone } test phone per family  (password)
//   PUT  /api/phones/:clientId   { phone }  ("" clears it)                   (password)
// Web app: when apps/web/dist exists (npm run web:build), it is served from here too, with index.html
// as the fallback for app routes such as /clients/michael-carter. Same origin, so the app's relative
// /api calls work unchanged.
//
// Start it with main.ts (loads .env). HOST/PORT: 127.0.0.1:8787 by default; platforms set PORT.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { LlmError, MODEL, llmConfigured } from "./llm.ts";
import { rewriteMessage } from "./rewrite.ts";
import { maskRecipient, registerPhone, sendApprovedMessage, whatsappStatus } from "./whatsapp.ts";
import { allPhones, setPhone } from "./phones.ts";
import { loadPlan } from "./rewrite.ts";
import { authRequired, demoPassword, isAuthenticated, login, logoutCookie } from "./auth.ts";

const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 8787);
const HOST = process.env.HOST ?? process.env.API_HOST ?? "127.0.0.1";
const MAX_BODY = 16 * 1024;
const WEB_DIST = fileURLToPath(new URL("../../web/dist/", import.meta.url));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".map": "application/json",
};

function send(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
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

function requireJson(req: IncomingMessage) {
  if (!(req.headers["content-type"] ?? "").includes("application/json")) throw new LlmError("Send JSON.", 415);
}

/** Serves a file from apps/web/dist; unknown paths without an extension get index.html (app routes). */
function serveWeb(res: ServerResponse, pathname: string) {
  if (!existsSync(join(WEB_DIST, "index.html"))) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Web app not built. Run: npm run web:build");
  }
  let rel: string;
  try { rel = decodeURIComponent(pathname); } catch { rel = "/"; }
  const target = normalize(join(WEB_DIST, rel));
  const inside = target.startsWith(WEB_DIST) || target + sep === WEB_DIST;
  let file = inside && existsSync(target) && statSync(target).isFile() ? target : "";
  if (!file) {
    if (extname(rel)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    file = join(WEB_DIST, "index.html");
  }
  const hashed = file.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(file).pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  try {
    if (!path.startsWith("/api/")) {
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "Method not allowed" });
      return serveWeb(res, path);
    }

    // Open endpoints
    if (req.method === "GET" && path === "/api/health") return send(res, 200, { ok: true, ai: llmConfigured(), model: MODEL });
    if (req.method === "GET" && path === "/api/session") return send(res, 200, { required: authRequired(), authenticated: isAuthenticated(req), demoPassword: demoPassword() });
    if (req.method === "POST" && path === "/api/login") {
      requireJson(req);
      const body = await readJson(req);
      const result = login(req, body.password);
      if (!result.ok) return send(res, result.status, { error: result.error });
      return send(res, 200, { ok: true }, result.cookie ? { "Set-Cookie": result.cookie } : {});
    }
    if (req.method === "POST" && path === "/api/logout") return send(res, 200, { ok: true }, { "Set-Cookie": logoutCookie() });

    // Everything else needs the password (AI budget, WhatsApp sending)
    if (!isAuthenticated(req)) return send(res, 401, { error: "Please log in." });

    if (req.method === "GET" && path === "/api/whatsapp/status") return send(res, 200, await whatsappStatus());

    // Test phone per family: GET all, PUT one ({ phone: "" } clears it)
    if (req.method === "GET" && path === "/api/phones") return send(res, 200, allPhones());
    const phoneRoute = path.match(/^\/api\/phones\/([a-z0-9-]{1,80})$/);
    if (req.method === "PUT" && phoneRoute) {
      requireJson(req);
      const clientId = phoneRoute[1];
      const plan = loadPlan(clientId);
      if (!plan) throw new LlmError("Unknown client.", 404);
      const body = await readJson(req);
      const phone = setPhone(clientId, body.phone, id => loadPlan(id)?.displayName ?? id);
      const { registered } = await registerPhone(clientId, phone);
      console.log(`phone for ${clientId}: ${phone ? maskRecipient(phone) : "cleared"}${phone ? ` (bot ${registered ? "registered" : "not reachable, will register on send"})` : ""}`);
      return send(res, 200, { clientId, phone, registered });
    }
    if (req.method === "POST" && path === "/api/messages/send") {
      requireJson(req);
      const body = await readJson(req);
      const result = await sendApprovedMessage(body);
      console.log(`whatsapp sent ${body.clientId} to ${result.to}`);
      return send(res, 200, result);
    }
    if (req.method === "POST" && path === "/api/messages/rewrite") {
      requireJson(req);
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

// "localhost" can mean 127.0.0.1 or ::1 depending on the machine; tunnels (cloudflared) often try ::1 first
// and answer 502 when nothing listens there. With the default loopback HOST, listen on BOTH addresses.
const web = existsSync(join(WEB_DIST, "index.html")) ? "web app served" : "web app not built (npm run web:build)";
const status = `(AI: ${llmConfigured() ? `${MODEL} via proxy` : "TEAM_KEY missing"}; ${web}; password: ${authRequired() ? "on" : "OFF"})`;
const loopback = HOST === "127.0.0.1" || HOST === "localhost";

server.on("error", (e: NodeJS.ErrnoException) => {
  console.error(e.code === "EADDRINUSE"
    ? `Port ${PORT} is already in use on ${HOST}. Stop the other server (or set PORT) and try again.`
    : `Server error: ${e.message}`);
  process.exit(1);
});
server.listen(PORT, loopback ? "127.0.0.1" : HOST, () => {
  console.log(`Server on http://${loopback ? "127.0.0.1" : HOST}:${PORT}  ${status}`);
  if (!loopback) return;
  const v6 = createServer(server.listeners("request")[0] as Parameters<typeof createServer>[1]);
  v6.on("error", () => { /* no IPv6 on this machine: IPv4 is enough */ });
  v6.listen(PORT, "::1", () => console.log(`Server also on http://[::1]:${PORT} (IPv6 localhost)`));
});
