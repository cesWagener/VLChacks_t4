import makeWASocket, { useMultiFileAuthState, DisconnectReason } from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";

// Los 2 números permitidos (prefijo país, sin +)
const ALLOWED = ["34600111222@s.whatsapp.net", "34600333444@s.whatsapp.net"];

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const sock = makeWASocket({ auth: state });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === "open") {
      console.log("Conectado ✅");
    }
    if (connection === "close") {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) start(); // reconectar
      else console.log("Sesión cerrada. Borra la carpeta 'auth' y vuelve a escanear.");
    }
  });

  // Responder mensajes entrantes
  sock.ev.on("messages.upsert", async ({ messages }) => {
    for (const m of messages) {
      const jid = m.key.remoteJid;
      const text = m.message?.conversation || m.message?.extendedTextMessage?.text || "";
      console.log("JID:", jid, "| fromMe:", m.key.fromMe, "| texto:", text);

      if (!text || m.key.fromMe) continue;

      try {
        const res = await sock.sendMessage(jid, { text: `Hola, ¿en que puedo ayudarte? :)` });
        console.log("ENVIADO OK:", res?.key?.id);
      } catch (err) {
        console.error("ERROR AL ENVIAR:", err);
      }
    }
  });
} // <-- esta era la llave que faltaba

start();