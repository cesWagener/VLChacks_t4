// auth.ts — a simple password gate for the public app. Once the app is reachable from the internet, only
// people with APP_PASSWORD may use the AI (team budget) or send WhatsApp messages.
// Without APP_PASSWORD (local development) nothing is required.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const COOKIE = "sherpas_session";
const SESSION_MS = 12 * 60 * 60 * 1000;        // 12 hours
const MAX_ATTEMPTS = 10;                        // per IP per 5 minutes
const attempts = new Map<string, number[]>();

const password = () => process.env.APP_PASSWORD ?? "";
export const authRequired = () => password().length > 0;

// Sessions are signed with a key derived from the password, so changing the password logs everyone out,
// and a restart does not.
const sign = (payload: string) => createHmac("sha256", `sherpas-session:${password()}`).update(payload).digest("base64url");

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function clientIp(req: IncomingMessage) {
  const cf = req.headers["cf-connecting-ip"];
  const fwd = req.headers["x-forwarded-for"];
  return String((Array.isArray(cf) ? cf[0] : cf) ?? (Array.isArray(fwd) ? fwd[0] : fwd)?.split(",")[0] ?? req.socket.remoteAddress ?? "?").trim();
}

function cookieValue(req: IncomingMessage) {
  const raw = req.headers.cookie ?? "";
  const m = raw.split(/;\s*/).find(p => p.startsWith(`${COOKIE}=`));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : "";
}

export function isAuthenticated(req: IncomingMessage) {
  if (!authRequired()) return true;
  const [expires, sig] = cookieValue(req).split(".");
  if (!expires || !sig || Number(expires) < Date.now()) return false;
  return safeEqual(sig, sign(`v1.${expires}`));
}

/** Returns a Set-Cookie header on success, or a reason on failure. */
export function login(req: IncomingMessage, given: unknown): { ok: true; cookie: string } | { ok: false; status: number; error: string } {
  if (!authRequired()) return { ok: true, cookie: "" };
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter(t => now - t < 5 * 60 * 1000);
  if (recent.length >= MAX_ATTEMPTS) return { ok: false, status: 429, error: "Too many attempts. Try again in a few minutes." };
  recent.push(now);
  attempts.set(ip, recent);
  if (typeof given !== "string" || !safeEqual(given, password())) return { ok: false, status: 401, error: "Wrong password." };
  attempts.delete(ip);
  const expires = String(now + SESSION_MS);
  const secure = String(req.headers["x-forwarded-proto"] ?? "").includes("https") ? "; Secure" : "";
  return { ok: true, cookie: `${COOKIE}=${expires}.${sign(`v1.${expires}`)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}` };
}

export const logoutCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
