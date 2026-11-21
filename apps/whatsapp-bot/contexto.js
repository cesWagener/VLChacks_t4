// contexto.js — which family each WhatsApp chat is about (one test phone per family).
// The web app registers a phone for a family (outbox.js /register) and sends approved messages to it
// (/send); when that phone writes, ai.js answers as that family. Saved to contexto.json (git-ignored)
// so a bot restart keeps it.
//
// WhatsApp can address the same person in two ways: a phone JID "...@s.whatsapp.net" and a "...@lid".
// Baileys gives the other one in m.key.remoteJidAlt, so a reply is matched by either.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./env.js";

const FILE = path.join(DATA_DIR, "contexto.json");
let datos = {};
try { datos = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { /* first run */ }

function guardar() {
  try { fs.writeFileSync(FILE, JSON.stringify(datos, null, 2)); } catch (err) { console.error("ERROR CONTEXTO:", err); }
}

/** This phone plays this family. A phone plays one family at a time: the newest registration wins. */
export function registrarTelefono(jid, clientId) {
  datos[jid] = { ...(datos[jid]?.clientId === clientId ? datos[jid] : {}), clientId, registered: true, at: datos[jid]?.at ?? new Date().toISOString() };
  guardar();
}

/** ctx: { clientId, subject, text, at } — the last message the advisor sent to this chat. */
export function guardarContexto(jid, ctx) {
  datos[jid] = { ...(datos[jid] ?? {}), ...ctx, registered: true };
  guardar();
}

export function leerContexto(jid) {
  return datos[jid] ?? null;
}

/** True when the web app registered this chat (by either of its JIDs), so the bot may answer it. */
export function estaRegistrado(jid, alt) {
  return Boolean((jid && datos[jid]?.clientId) || (alt && datos[alt]?.clientId));
}

/** The family for this chat: its own JID, else its alternate JID (then linked), else — only when a single
 *  family is in play — that family. With several phones/families, never guess. */
export function buscarContexto(jid, alt) {
  if (datos[jid]?.clientId) return { ctx: datos[jid], via: "chat" };
  if (alt && datos[alt]?.clientId) {
    datos[jid] = { ...datos[alt], linkedFrom: alt };
    guardar();
    return { ctx: datos[alt], via: "alt" };
  }
  const families = [...new Set(Object.values(datos).map((c) => c?.clientId).filter(Boolean))];
  if (families.length === 1) {
    const latest = Object.values(datos).filter((c) => c?.clientId).sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
    datos[jid] = { ...latest, linkedFrom: "only-family" };
    guardar();
    return { ctx: latest, via: "only-family" };
  }
  return { ctx: null, via: families.length ? "ambiguous" : "none" };
}
