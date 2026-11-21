// serve.mjs — runs the whole system on ONE machine (e.g. Ches's laptop): `npm run serve`.
//
//   1. builds the web app (apps/web/dist)
//   2. starts the server (apps/api): web app + API on http://127.0.0.1:8787 (and [::1]:8787)
//   3. starts the WhatsApp bot (apps/whatsapp-bot); its outbox listens only on 127.0.0.1:8788
//
// Then expose ONE address to the internet:  cloudflared tunnel --url http://127.0.0.1:8787
// and open it from any device. APP_PASSWORD protects the app (required).
//
// The server keeps running if the bot stops (e.g. WhatsApp logged out); the bot is restarted.
// Settings come from the repo-root .env or from the environment (see .env.example).
// Options: SERVE_BOT=0 to skip the bot, SERVE_BUILD=0 to skip the web build.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function fail(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1); }

// The server runs TypeScript directly (--experimental-strip-types): Node 22.6 or later.
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 6)) fail(`Node ${process.versions.node} is too old. Install Node 22.6 or later (e.g. nvm install 22), then run npm run serve again.`);

try { process.loadEnvFile(path.join(root, ".env")); } catch { /* no .env: use the environment */ }
if (!process.env.APP_PASSWORD) fail("Set APP_PASSWORD in .env (or the environment). Once the app is public, it is the only thing stopping strangers from sending WhatsApp messages and spending the AI budget.");
if (!process.env.TEAM_KEY) console.warn("⚠ TEAM_KEY is not set: AI rewrite and AI replies on WhatsApp will not work.");
const demoTo = (process.env.WHATSAPP_DEMO_TO || "").trim();
if (!demoTo) fail("Set WHATSAPP_DEMO_TO in .env: the team's demo phone that receives the messages (country code + number, e.g. 34600111222).");
if (demoTo === "34600111222") fail("WHATSAPP_DEMO_TO is still the example value from .env.example. Put the team's demo phone (country code + number) in .env.");

const port = process.env.PORT || "8787";
const outboxPort = process.env.OUTBOX_PORT || "8788";
const env = {
  ...process.env,
  PORT: port,
  HOST: process.env.HOST || "127.0.0.1",
  OUTBOX_HOST: "127.0.0.1",
  OUTBOX_PORT: outboxPort,
  OUTBOX_URL: `http://127.0.0.1:${outboxPort}`,
  OUTBOX_SECRET: process.env.OUTBOX_SECRET || randomBytes(24).toString("hex"),
  OUTBOX_FROM_ENV: "1",
  // The server only ever sends to WHATSAPP_DEMO_TO, so that is exactly what the bot's outbox accepts.
  // (Without this, the outbox falls back to the bot's ALLOWED list, which may name another chat.)
  OUTBOX_ALLOWED: demoTo,
  // The bot answers replies only from ALLOWED chats: make sure the demo phone is one of them.
  ALLOWED: [...new Set([...(process.env.ALLOWED || "89653264785495@lid").split(","), demoTo].map((s) => s.trim()).filter(Boolean))].join(","),
};

if (process.env.SERVE_BUILD !== "0") {
  if (!fs.existsSync(path.join(root, "apps/web/node_modules"))) fail("Install first: npm run setup");
  console.log("▶ Building the web app…");
  // One command string: on Windows npm is a .cmd and needs a shell.
  const b = spawnSync(`${npm} --prefix apps/web run build`, { cwd: root, stdio: "inherit", env, shell: true });
  if (b.status !== 0) fail("Web build failed (see above).");
}

let stopping = false;
const children = new Set();
function run(name, args, cwd, onExit) {
  const child = spawn(process.execPath, args, { cwd: path.join(root, cwd), stdio: "inherit", env });
  children.add(child);
  child.on("exit", (code) => { children.delete(child); if (!stopping) onExit(code); });
  return child;
}
function stopAll(code) {
  stopping = true;
  for (const c of children) c.kill();
  process.exit(code);
}

// The server is essential: if it stops, everything stops.
run("server", ["--experimental-strip-types", "src/main.ts"], "apps/api", (code) => {
  console.error(`\n■ The server stopped (code ${code}). Stopping everything.`);
  stopAll(code ?? 1);
});

// The bot is restarted if it stops, without taking the website down.
let botRestarts = 0;
function startBot() {
  run("WhatsApp bot", ["index.js"], "apps/whatsapp-bot", (code) => {
    botRestarts++;
    const wait = Math.min(60, 5 * botRestarts);
    console.error(`\n■ WhatsApp bot stopped (code ${code}). The website keeps running. Restarting the bot in ${wait} s…`);
    setTimeout(startBot, wait * 1000);
  });
}
if (process.env.SERVE_BOT !== "0") {
  if (!fs.existsSync(path.join(root, "apps/whatsapp-bot/node_modules"))) fail("Install first: npm run setup");
  startBot();
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => stopAll(0));

// Confirm the server answers before telling people to open it.
const deadline = Date.now() + 20_000;
async function waitForServer() {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(2_000) });
    if (r.ok) {
      console.log(`
✔ Server answering at http://127.0.0.1:${port}
  From any device: in another terminal run
     cloudflared tunnel --url http://127.0.0.1:${port}
  and share the https://….trycloudflare.com address (password: APP_PASSWORD).
`);
      return;
    }
  } catch { /* not up yet */ }
  if (Date.now() > deadline) return console.error(`\n✖ The server did not answer on http://127.0.0.1:${port} within 20 s. Check the errors above.`);
  setTimeout(waitForServer, 500);
}
waitForServer();
