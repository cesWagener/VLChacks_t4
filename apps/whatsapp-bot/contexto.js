// contexto.js — remembers which family each WhatsApp chat is about.
// The web app sends an approved message with its clientId (via outbox.js); when the person replies,
// ai.js reads it back to answer with that family's plan. Saved to contexto.json (git-ignored) so a
// bot restart keeps it.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./env.js";

const FILE = path.join(DATA_DIR, "contexto.json");
let datos = {};
try { datos = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { /* first run */ }

/** ctx: { clientId, subject, text, at } — the last message the advisor sent to this chat. */
export function guardarContexto(jid, ctx) {
  datos[jid] = ctx;
  try { fs.writeFileSync(FILE, JSON.stringify(datos, null, 2)); } catch (err) { console.error("ERROR CONTEXTO:", err); }
}

export function leerContexto(jid) {
  return datos[jid] ?? null;
}
