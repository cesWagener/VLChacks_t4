import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAH_PATH = path.join(__dirname, "media", "Fahh.mp3");
const ALLOWED = ["89653264785495@lid"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === "open") console.log("Conectado ✅");
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) start();
      else console.log("Sesión cerrada. Borra la carpeta 'auth' y vuelve a escanear.");
    }
  });

  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const m of messages) {
      const jid = m.key.remoteJid;
      const text = (m.message?.conversation || m.message?.extendedTextMessage?.text || "").trim();
      console.log("JID:", jid, "| fromMe:", m.key.fromMe, "| texto:", text);

      if (!text || m.key.fromMe) continue;
      if (!ALLOWED.includes(jid)) continue;

      try {
        if (text.toLowerCase() === "fah") {
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