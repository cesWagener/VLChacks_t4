// outbox.js — lets the advisor web app send an approved message through this bot.
//
// The app's API (apps/api) calls:  POST http://<this-laptop>:8788/send  { to, text }
// with the header  X-Outbox-Secret: <OUTBOX_SECRET>.  Both sides read the same secret from their .env.
//
// Safety:
//   - Off unless OUTBOX_SECRET is set.
//   - Only sends to numbers in OUTBOX_ALLOWED (defaults to the bot's ALLOWED list). The families in the
//     challenge are fictional: messages go to the team's own demo phone, never to real clients.
//   - At most 10 messages a minute; text up to 4,096 characters.
import http from "node:http";
import crypto from "node:crypto";
import os from "node:os";
import "./env.js"; // OUTBOX_SECRET, OUTBOX_ALLOWED... from the repo-root .env
import { estaRegistrado, guardarContexto, registrarTelefono } from "./contexto.js";

const MAX_TEXT = 4096;
const MAX_PER_MINUTE = 10;

let iniciado = false;

const toJid = (to) => (String(to).includes("@") ? String(to).trim() : `${String(to).replace(/\D/g, "")}@s.whatsapp.net`);

function secretOk(given, expected) {
  const a = Buffer.from(String(given ?? ""));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function responder(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

/**
 * Starts the outbox once. getSock returns the current socket (it changes on reconnect);
 * enviar(sock, jid, text) is the bot's own send function (shows "typing…" first).
 */
export function iniciarOutbox({ getSock, enviar, allowed }) {
  if (iniciado) return;
  const secret = process.env.OUTBOX_SECRET;
  if (!secret) {
    console.log("Outbox apagado: falta OUTBOX_SECRET en .env (la web no podrá enviar por WhatsApp).");
    return;
  }
  iniciado = true;

  const host = process.env.OUTBOX_HOST || "0.0.0.0";
  const port = Number(process.env.OUTBOX_PORT || 8788);
  const permitidos = new Set(
    (process.env.OUTBOX_ALLOWED || allowed.join(",")).split(",").map((s) => s.trim()).filter(Boolean).map(toJid),
  );
  const recientes = [];

  const server = http.createServer(async (req, res) => {
    try {
      if (!secretOk(req.headers["x-outbox-secret"], secret)) return responder(res, 401, { error: "Secreto incorrecto" });

      if (req.method === "GET" && req.url === "/health") {
        return responder(res, 200, { ok: true, connected: Boolean(getSock()?.user) });
      }

      const leerJson = async () => {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (raw.length > 16 * 1024) throw Object.assign(new Error("Demasiado grande"), { status: 413 });
        }
        return JSON.parse(raw || "{}");
      };
      const familiaValida = (id) => typeof id === "string" && /^[a-z0-9-]{1,80}$/.test(id);

      // The web app says which phone plays which family (one test phone per family).
      if (req.method === "POST" && req.url === "/register") {
        const { to, clientId } = await leerJson();
        if (!to || !familiaValida(clientId)) return responder(res, 400, { error: "to y clientId son obligatorios" });
        const jid = toJid(to);
        registrarTelefono(jid, clientId);
        console.log("OUTBOX REGISTRADO 📱", jid, "->", clientId);
        return responder(res, 200, { ok: true, jid });
      }

      if (req.method === "POST" && req.url === "/send") {
        const { to, text, clientId, subject } = await leerJson();
        const jid = toJid(to ?? "");
        // Allowed: the env list (OUTBOX_ALLOWED / ALLOWED), a phone registered for a family, or a family send.
        // Only the server can call the outbox (secret), and it sends only to phones an admin set for a family.
        if (!permitidos.has(jid) && !estaRegistrado(jid) && !familiaValida(clientId)) {
          console.error(`OUTBOX: destinatario ${jid} no permitido. Permitidos: ${[...permitidos].join(", ")}`);
          return responder(res, 403, { error: `Recipient ${jid} is not in the bot's allowed list (${[...permitidos].join(", ")}).` });
        }
        if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) return responder(res, 400, { error: "Texto vacío o demasiado largo" });

        const ahora = Date.now();
        while (recientes.length && ahora - recientes[0] > 60_000) recientes.shift();
        if (recientes.length >= MAX_PER_MINUTE) return responder(res, 429, { error: "Demasiados envíos, espera un minuto" });

        const sock = getSock();
        if (!sock?.user) return responder(res, 503, { error: "El bot no está conectado a WhatsApp" });
        recientes.push(ahora);
        try {
          await enviar(sock, jid, text);
        } catch (err) {
          // WhatsApp itself refused: say why, so the web app can show it.
          console.error("ERROR OUTBOX al enviar a", jid, err);
          return responder(res, 502, { error: `WhatsApp could not deliver to ${jid}: ${err?.message ?? err}` });
        }
        // Remember which family this chat is about, so ai.js can answer the reply with their plan.
        if (familiaValida(clientId)) {
          guardarContexto(jid, { clientId, subject: typeof subject === "string" ? subject : "", text, at: new Date().toISOString() });
        }
        console.log("OUTBOX ENVIADO ✅", jid, clientId ?? "");
        return responder(res, 200, { ok: true });
      }

      responder(res, 404, { error: "No encontrado" });
    } catch (err) {
      if (err?.status) return responder(res, err.status, { error: err.message });
      console.error("ERROR OUTBOX:", err);
      responder(res, 500, { error: `Outbox error: ${err?.message ?? err}` });
    }
  });

  server.listen(port, host, () => {
    console.log(`Outbox listo en el puerto ${port} (destinatarios permitidos: ${permitidos.size})`);
    // The address teammates put in OUTBOX_URL (same Wi-Fi). One line per network card.
    const virtual = /vEthernet|VMware|VirtualBox|Hyper-V|WSL|Loopback|Bluetooth|docker|utun|vbox/i;
    const ips = Object.entries(os.networkInterfaces())
      .filter(([name]) => !virtual.test(name))
      .flatMap(([, list]) => list ?? [])
      .filter((i) => i.family === "IPv4" && !i.internal)
      .map((i) => i.address);
    for (const ip of ips) console.log(`  OUTBOX_URL=http://${ip}:${port}`);
  });
}
