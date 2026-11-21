// session.ts — the app's login state. The server decides whether a password is needed (APP_PASSWORD).
// In local development without the server, nothing is required and the app works as before.
import { useCallback, useEffect, useState } from "react";

export const UNAUTHORIZED_EVENT = "app:unauthorized";

type Session = { status: "loading" } | { status: "ready"; required: boolean; authenticated: boolean };

export function useSession() {
  const [session, setSession] = useState<Session>({ status: "loading" });

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/session", { signal: AbortSignal.timeout(8_000) });
      const data = res.ok ? await res.json() : null;
      setSession({ status: "ready", required: Boolean(data?.required), authenticated: Boolean(data?.authenticated) });
    } catch {
      setSession({ status: "ready", required: false, authenticated: true }); // no server: static app only
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Any API call answering 401 means the session ended: show the login again.
  useEffect(() => {
    const onUnauthorized = () => setSession(s => (s.status === "ready" ? { ...s, authenticated: false } : s));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (password: string) => {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error ?? "Login failed.");
    await refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await fetch("/api/logout", { method: "POST" }).catch(() => undefined);
    await refresh();
  }, [refresh]);

  return { session, login, logout };
}
