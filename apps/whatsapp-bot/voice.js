// voice.js — answers a client's WhatsApp voice note with the team's voice API (apps/voice-api).
//
//   voice note -> POST {VOICE_API_URL} (multipart: caseId + audio, Bearer VOICE_API_SECRET)
//     success: true  -> { audioBase64 }  the spoken answer: sent back as a voice note
//     success: false -> { text }         the transcript (question needs outside facts or the advisor):
//                                        answered in text by the AI advisor (ai.js), like a typed message
//
// The family comes from the chat (contexto.js): the phone registered for it in the web app.
// Off unless VOICE_API_SECRET is set (npm run serve sets it and starts the voice API).
import "./env.js";

const URL_VOZ = (process.env.VOICE_API_URL || "http://127.0.0.1:8790").replace(/\/+$/, "");
const TIMEOUT_MS = 80_000; // the voice API allows 75 s per request

export const vozActiva = () => Boolean(process.env.VOICE_API_SECRET);

export class VozError extends Error {
  constructor(code, message, status) { super(message); this.code = code; this.status = status; }
}

/** Sends the OGG/Opus voice note for this family. Returns { audio: Buffer } or { text: string }. */
export async function preguntarPorVoz(caseId, audioOgg) {
  const form = new FormData();
  form.append("caseId", caseId);
  form.append("audio", new Blob([audioOgg], { type: "audio/ogg" }), "nota.ogg");
  let res;
  try {
    res = await fetch(`${URL_VOZ}/api/voice`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.VOICE_API_SECRET}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new VozError("VOICE_API_UNREACHABLE", `voice API not reachable at ${URL_VOZ}: ${err?.message ?? err}`, 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new VozError(data?.error ?? `HTTP_${res.status}`, data?.message ?? `voice API answered ${res.status}`, res.status);
  if (data?.success === true && typeof data.audioBase64 === "string") return { audio: Buffer.from(data.audioBase64, "base64") };
  if (data?.success === false && typeof data.text === "string") return { text: data.text };
  throw new VozError("BAD_RESPONSE", "unexpected voice API response", res.status);
}
