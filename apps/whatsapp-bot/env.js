// env.js — loads the repo-root .env (if any) before anything else reads process.env, and defines where the
// bot keeps its local state. Import it first. Variables already set in the environment win over .env.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(here, "..", "..", ".env")); } catch { /* no .env: use the environment */ }

// WhatsApp login (auth/), received audio (recibidos/) and chat->family links (contexto.json).
// All git-ignored. Point BOT_DATA_DIR at a persistent disk when hosting.
export const DATA_DIR = path.resolve(process.env.BOT_DATA_DIR || here);
fs.mkdirSync(DATA_DIR, { recursive: true });
