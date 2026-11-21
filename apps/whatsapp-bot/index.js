import { DATA_DIR } from "./env.js"; // first: loads .env and sets the data folder
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  getContentType,
  normalizeMessageContent,
  downloadMediaMessage,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import readline from "readline";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { responder } from "./ai.js";
import { iniciarOutbox } from "./outbox.js"; // envíos aprobados desde la web (ver outbox.js)
import { buscarContexto, estaRegistrado } from "./contexto.js"; // teléfonos registrados desde la web, uno por familia
import { preguntarPorVoz, vozActiva } from "./voice.js"; // notas de voz -> apps/voice-api

// ─────────────────────────── Configuración ───────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAH_PATH = path.join(__dirname, "media", "Fahh.mp3");
const AUDIO_DIR = path.join(DATA_DIR, "recibidos");
const AUTH_DIR = path.join(DATA_DIR, "auth"); // sesión de WhatsApp (no subir a git)
fs.mkdirSync(AUDIO_DIR, { recursive: true });

// JID exactos que salen en el log ("JID: ..."), separados por comas.
// Se pueden definir con la variable de entorno ALLOWED o editando el valor por defecto.
// Ejemplo: ALLOWED="89653264785495@lid,123456789012345@lid"
const ALLOWED = (process.env.ALLOWED || "89653264785495@lid")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const NO_ENTIENDO = "I don't understand these messages yet, we are working on it 🛠️";
const ERROR_IA = "I can't talk to you right now, will check in a bit 🙏";
const NO_ENTIENDO_AUDIO = "I couldn't listen to that voice note just now. Could you type your question? 🙏";

// Tipos internos de WhatsApp que NO son mensajes del usuario: se ignoran
const IGNORAR = new Set([
  "protocolMessage",
  "senderKeyDistributionMessage",
  "reactionMessage",
  "messageContextInfo",
  "stickerMessage", // stickers: sin respuesta (ni "I don't understand…" ni llamada a la IA)
  // Fotos, vídeos y audios: sin respuesta, ni se descargan.
  "imageMessage",
  "videoMessage",
  "ptvMessage", // vídeo-nota redonda
  // Notas de voz: ignoradas salvo BOT_VOICE_NOTES=1 (entonces las contesta la API de voz, ver voice.js)
  ...(process.env.BOT_VOICE_NOTES === "1" ? [] : ["audioMessage"]),
]);

const MAX_HISTORIAL = 10; // mensajes recordados por contacto
const TIMEOUT_IA_MS = 45000; // gpt-5-mini puede tardar 5-20 s en responder

// ─────────────────────────── Utilidades ───────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procesados = new Set(); // ids de mensajes ya atendidos (evita duplicados)
const historial = new Map(); // jid -> [{role, content}, ...]

let sockActual = null; // socket activo (para enviar desde la terminal)
let terminalIniciada = false;

async function guardarAudio(sock, m) {
  const buffer = await downloadMediaMessage(
    m,
    "buffer",
    {},
    { reuploadRequest: sock.updateMediaMessage }
  );
  const archivo = path.join(AUDIO_DIR, `${Date.now()}_${m.key.id}.ogg`);
  fs.writeFileSync(archivo, buffer);
  return { archivo, buffer };
}

// Nota de voz de una familia: la API de voz (apps/voice-api) contesta con otra nota de voz,
// o devuelve la transcripción y la IA contesta por texto. Devuelve false si no hay familia o voz.
async function responderNotaDeVoz(sock, jid, alt, audio) {
  if (!vozActiva()) return false;
  const { ctx } = buscarContexto(jid, alt);
  if (!ctx?.clientId) return false;
  await sock.sendPresenceUpdate("recording", jid);
  try {
    const r = await preguntarPorVoz(ctx.clientId, audio);
    if (r.audio) {
      await sock.sendMessage(jid, { audio: r.audio, mimetype: "audio/ogg; codecs=opus", ptt: true });
      console.log("VOZ: respuesta en audio para", ctx.clientId);
    } else {
      console.log("VOZ: transcripción ->", r.text);
      await sock.sendPresenceUpdate("composing", jid);
      const respuesta = await responderConIA(jid, r.text, alt);
      await sock.sendMessage(jid, { text: respuesta });
    }
  } catch (err) {
    console.error("ERROR VOZ:", err?.code ?? "", err?.message ?? err);
    await sock.sendMessage(jid, { text: NO_ENTIENDO_AUDIO });
  }
  return true;
}

async function responderConIA(jid, text, alt) {
  const h = historial.get(jid) || [];
  try {
    const respuesta = await Promise.race([
      responder({ jid, alt, text, history: [...h] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_IA_MS)),
    ]);
    h.push({ role: "user", content: text }, { role: "assistant", content: respuesta });
    while (h.length > MAX_HISTORIAL) h.shift();
    historial.set(jid, h);
    return respuesta;
  } catch (err) {
    console.error("ERROR IA:", err);
    return ERROR_IA;
  }
}

// Envío proactivo con indicador de "escribiendo..."
async function enviar(sock, jid, text) {
  await sock.sendPresenceUpdate("composing", jid);
  await sleep(1000 + Math.random() * 1000);
  await sock.sendMessage(jid, { text });
  await sock.sendPresenceUpdate("paused", jid);
}

// Escribe en la terminal: "34600111222 mensaje" y se envía por WhatsApp
function iniciarTerminal() {
  if (terminalIniciada) return;
  terminalIniciada = true;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("line", async (line) => {
    const [num, ...resto] = line.trim().split(" ");
    if (!num || !resto.length) return console.log("Formato: 34600111222 mensaje");
    if (!sockActual) return console.log("Bot no conectado todavía");
    try {
      const jid = num.includes("@") ? num : `${num}@s.whatsapp.net`;
      await enviar(sockActual, jid, resto.join(" "));
      console.log("Enviado ✅");
    } catch (err) {
      console.error("ERROR AL ENVIAR DESDE TERMINAL:", err);
    }
  });
}

// ─────────────────────────── Bot ───────────────────────────
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const sock = makeWASocket({ auth: state });
  sockActual = sock;

  sock.ev.on("creds.update", saveCreds);

  // SOLO conexión aquí dentro
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });

    if (connection === "open") {
      console.log("Conectado ✅");
      iniciarTerminal();
      iniciarOutbox({ getSock: () => sockActual, enviar, allowed: ALLOWED });
    }

    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      sock.ev.removeAllListeners("messages.upsert"); // limpia el socket viejo
      if (code !== DisconnectReason.loggedOut) {
        setTimeout(start, 2000);
      } else {
        console.log("Sesión cerrada. Borra la carpeta 'auth' y vuelve a escanear.");
      }
    }
  });

  // Se registra UNA sola vez por socket, fuera de connection.update
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const m of messages) {
      const jid = m.key.remoteJid;
      if (!m.message || m.key.fromMe) continue;
      // El mismo contacto puede llegar como "...@lid" o como número: Baileys da el otro en remoteJidAlt.
      const alt = m.key.remoteJidAlt || null;
      // Responde a ALLOWED y a los teléfonos registrados desde la web (un teléfono de prueba por familia).
      if (!ALLOWED.includes(jid) && !(alt && ALLOWED.includes(alt)) && !estaRegistrado(jid, alt)) continue;

      // Evita atender dos veces el mismo mensaje
      if (procesados.has(m.key.id)) continue;
      procesados.add(m.key.id);
      if (procesados.size > 500) procesados.delete(procesados.values().next().value);

      // Quita envoltorios (mensajes temporales, ver una vez, etc.)
      const content = normalizeMessageContent(m.message);
      const tipo = getContentType(content);
      if (!tipo || IGNORAR.has(tipo)) continue;

      const text = (content.conversation || content.extendedTextMessage?.text || "").trim();
      console.log("JID:", jid, "| tipo:", tipo, "| texto:", text);

      // Guarda los audios recibidos (.ogg) en la carpeta "recibidos"
      let notaDeVoz = null;
      if (tipo === "audioMessage") {
        try {
          const { archivo, buffer } = await guardarAudio(sock, m);
          notaDeVoz = buffer;
          console.log("AUDIO GUARDADO:", archivo);
        } catch (err) {
          console.error("ERROR AL GUARDAR AUDIO:", err);
        }
      }

      try {
        if (notaDeVoz && (await responderNotaDeVoz(sock, jid, alt, notaDeVoz))) {
          // contestada por la API de voz (audio) o por la IA (texto a partir de la transcripción)
        } else if (!text) {
          // Imagen, audio, sticker, vídeo, documento, ubicación, contacto...
          await sock.sendPresenceUpdate("composing", jid);
          await sleep(1000 + Math.random() * 1000);
          await sock.sendMessage(jid, { text: NO_ENTIENDO });
        } else if (text.toLowerCase() === "fah") {
          await sock.sendPresenceUpdate("recording", jid);
          await sleep(1000 + Math.random() * 1000);
          await sock.sendMessage(jid, {
            audio: fs.readFileSync(FAH_PATH),
            mimetype: "audio/mpeg",
            ptt: false,
          });
        } else {
          await sock.sendPresenceUpdate("composing", jid);
          const respuesta = await responderConIA(jid, text, alt);
          await sock.sendMessage(jid, { text: respuesta });
        }
        await sock.sendPresenceUpdate("paused", jid);
        console.log("ENVIADO OK");
      } catch (err) {
        console.error("ERROR AL ENVIAR:", err);
      }
    }
  });
}

start();
