// contexto.js — remembers which family each WhatsApp chat is about.
// The web app sends an approved message with its clientId (via outbox.js); when the person replies,
// ai.js reads it back to answer with that family's plan. Saved to contexto.json (git-ignored) so a
// bot restart keeps it.
//
// WhatsApp can address the same person in two ways (a phone JID "...@s.whatsapp.net" and a "...@lid"),
// so a reply may arrive from a different JID than the one the message was sent to. In that case
// buscarContexto() falls back to the most recent message sent from the app and links the new JID to it.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./env.js";

const FILE = path.join(DATA_DIR, "contexto.json");
let datos = {};
try { datos = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { /* first run */ }

function guardar() {
  try { fs.writeFileSync(FILE, JSON.stringify(datos, null, 2)); } catch (err) { console.error("ERROR CONTEXTO:", err); }
}

/** ctx: { clientId, subject, text, at } — the last message the advisor sent to this chat. */
export function guardarContexto(jid, ctx) {
  datos[jid] = ctx;
  guardar();
}

export function leerContexto(jid) {
  return datos[jid] ?? null;
}

/** Context for this chat; if none, the most recent message sent from the app (linked to this chat from now on). */
export function buscarContexto(jid) {
  const own = datos[jid];
  if (own) return { ctx: own, via: "chat" };
  const latest = Object.values(datos).filter((c) => c?.clientId && c?.at).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
  if (!latest) return { ctx: null, via: "none" };
  datos[jid] = { ...latest, linkedFrom: "latest" };
  guardar();
  return { ctx: latest, via: "latest" };
}
