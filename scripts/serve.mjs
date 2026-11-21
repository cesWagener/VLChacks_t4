// serve.mjs — runs the whole system on ONE machine (e.g. Ches's laptop): `npm run serve`.
//
//   1. builds the web app (apps/web/dist)
//   2. starts the server (apps/api): web app + API on http://127.0.0.1:8787
//   3. starts the WhatsApp bot (apps/whatsapp-bot); its outbox listens only on 127.0.0.1:8788
//
// Then expose ONE address to the internet, e.g.  cloudflared tunnel --url http://localhost:8787
// and open it from any device. APP_PASSWORD protects the app (required).
//
// Settings come from the repo-root .env or from the environment (see .env.example).
// Options: SERVE_BOT=0 to skip the bot, SERVE_BUILD=0 to skip the web build.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try { process.loadEnvFile(path.join(root, ".env")); } catch { /* no .env: use the environment */ }
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function fail(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1); }

if (!process.env.APP_PASSWORD) fail("Set APP_PASSWORD in .env (or the environment). Once the app is public, it is the only thing stopping strangers from sending WhatsApp messages and spending the AI budget.");
if (!process.env.TEAM_KEY) console.warn("⚠ TEAM_KEY is not set: AI rewrite and AI replies on WhatsApp will not work.");
if (!process.env.WHATSAPP_DEMO_TO) fail("Set WHATSAPP_DEMO_TO in .env: the team's demo phone that receives the messages.");

// Bot and API run side by side: the outbox stays private to this machine.
const outboxPort = process.env.OUTBOX_PORT || "8788";
const env = {
  ...process.env,
  OUTBOX_HOST: "127.0.0.1",
  OUTBOX_PORT: outboxPort,
  OUTBOX_URL: `http://127.0.0.1:${outboxPort}`,
  OUTBOX_SECRET: process.env.OUTBOX_SECRET || randomBytes(24).toString("hex"),
  OUTBOX_FROM_ENV: "1",
};

if (process.env.SERVE_BUILD !== "0") {
  if (!fs.existsSync(path.join(root, "apps/web/node_modules"))) fail("Install first: npm run setup");
  console.log("▶ Building the web app…");
  // One command string: on Windows npm is a .cmd and needs a shell.
  const b = spawnSync(`${npm} --prefix apps/web run build`, { cwd: root, stdio: "inherit", env, shell: true });
  if (b.status !== 0) fail("Web build failed.");
}

const children = [];
function start(name, args, cwd) {
  const child = spawn(process.execPath, args, { cwd: path.join(root, cwd), stdio: "inherit", env });
  child.on("exit", (code) => {
    console.log(`\n■ ${name} stopped (code ${code}). Stopping everything.`);
    for (const c of children) if (c !== child && c.exitCode === null) c.kill();
    process.exit(code ?? 1);
  });
  children.push(child);
}

start("server", ["--experimental-strip-types", "src/main.ts"], "apps/api");
if (process.env.SERVE_BOT !== "0") {
  if (!fs.existsSync(path.join(root, "apps/whatsapp-bot/node_modules"))) fail("Install first: npm run setup");
  start("WhatsApp bot", ["index.js"], "apps/whatsapp-bot");
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { for (const c of children) c.kill(); process.exit(0); });

console.log(`
▶ Running. Open it locally at http://localhost:${process.env.PORT || 8787}
  From any device: in another terminal run
     cloudflared tunnel --url http://localhost:${process.env.PORT || 8787}
  and share the https://….trycloudflare.com address (password: APP_PASSWORD).
`);
