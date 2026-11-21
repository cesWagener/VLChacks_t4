// ai.js — módulo de IA (lo implementa tu compañero)
//
// Contrato:
//   responder({ jid, text, history }) -> Promise<string>
//
//   jid:     identificador del chat
//   text:    mensaje del usuario
//   history: [{ role: "user" | "assistant", content: string }, ...] (últimos mensajes)
//   return:  texto que el bot enviará de vuelta por WhatsApp
//
// Versión MOCK: sustituir el interior por la llamada real a la IA.
// No hace falta tocar index.js.

export async function responder({ jid, text, history }) {
  return `Eco: ${text}`;
}
