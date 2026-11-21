import { useState, type FormEvent } from "react";

/** Shown when the server requires APP_PASSWORD and there is no valid session. */
export function LoginPage({ onLogin, demoPassword }: { onLogin: (password: string) => Promise<void>; demoPassword?: string | null }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try { await onLogin(password); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); setPassword(""); }
    finally { setBusy(false); }
  };

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <p className="login__brand">sherpas</p>
        <h1 className="login__title">Advisor console</h1>
        <p className="login__text">Enter the team password to continue.</p>
        {demoPassword && (
          <p className="login__demo" role="note">
            Demo access: the password is <strong>{demoPassword}</strong>
          </p>
        )}
        <label className="field">
          <span className="field__label">Password</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="proposal__error" role="alert">{error}</p>}
        <button type="submit" className="button login__button" disabled={busy || !password}>{busy ? "Checking…" : "Log in"}</button>
      </form>
    </div>
  );
}
