import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  getContentType,
  normalizeMessageContent,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAH_PATH = path.join(__dirname, "media", "Fahh.mp3");

// JID exactos que salen en el log (el segundo es un marcador: cámbialo)
const ALLOWED = ["89653264785495@lid", "JID_NUMERO_2"];

const NO_ENTIENDO = "No te entiendo todavía, pero estamos trabajando en ello 🛠️";
const IGNORAR = new Set([
  "protocolMessage",
  "senderKeyDistributionMessage",
  "reactionMessage",
  "messageContextInfo",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const procesados = new Set(); // ids de mensajes ya atendidos

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  // SOLO conexión aquí dentro
  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === "open") console.log("Conectado ✅");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      sock.ev.removeAllListeners("messages.upsert"); // limpia el socket viejo
      if (code !== DisconnectReason.loggedOut) setTimeout(start, 2000);
      else console.log("Sesión cerrada. Borra la carpeta 'auth' y vuelve a escanear.");
    }
  });

  // Se registra UNA sola vez por socket, fuera de connection.update
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const m of messages) {
      const jid = m.key.remoteJid;
      if (!m.message || m.key.fromMe) continue;
      if (!ALLOWED.includes(jid)) continue;

      // Evita atender dos veces el mismo mensaje
      if (procesados.has(m.key.id)) continue;
      procesados.add(m.key.id);
      if (procesados.size > 500) procesados.delete(procesados.values().next().value);

      const content = normalizeMessageContent(m.message);
      const tipo = getContentType(content);
      if (!tipo || IGNORAR.has(tipo)) continue;

      const text = (content.conversation || content.extendedTextMessage?.text || "").trim();
      console.log("JID:", jid, "| tipo:", tipo, "| texto:", text);

      try {
        if (!text) {
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
          await sleep(1000 + Math.random() * 1500);
          await sock.sendMessage(jid, { text: `Recibido: ${text}` });
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