import { useEffect, useId, useState, type FormEvent } from "react";
import { getPhones, savePhone } from "../../lib/api.ts";

const pretty = (p: string) => (p.includes("@") ? p : `+${p}`);

/**
 * "WhatsApp number for this family": the test phone that plays this family in the demo.
 * Messages for the family go there, and that phone's replies are answered as this family.
 * Saved on the server, so every device sees the same number.
 */
export function FamilyPhone({ clientId, familyName }: { clientId: string; familyName: string }) {
  const inputId = useId();
  const [saved, setSaved] = useState<string | null>(null); // null = loading or unavailable
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [state, setState] = useState<{ status: "idle" | "saving" | "error" | "unavailable"; message?: string }>({ status: "idle" });

  useEffect(() => {
    let alive = true;
    getPhones()
      .then(p => { if (alive) { const v = p[clientId] ?? ""; setSaved(v); setValue(v); setEditing(!v); } })
      .catch(() => { if (alive) setState({ status: "unavailable" }); });
    return () => { alive = false; };
  }, [clientId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState({ status: "saving" });
    try {
      const r = await savePhone(clientId, value);
      setSaved(r.phone);
      setValue(r.phone);
      setEditing(!r.phone);
      setState({ status: "idle", message: r.phone && !r.registered ? "Saved. The bot isn't reachable right now; it will pick the number up on the first send." : undefined });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  if (state.status === "unavailable") return null; // no server (static preview): nothing to configure

  return (
    <div className="family-phone">
      {saved && !editing ? (
        <p className="family-phone__current">
          <span className="family-phone__label">WhatsApp for {familyName}:</span> <strong>{pretty(saved)}</strong>
          <button type="button" className="link-button" onClick={() => setEditing(true)}>Change</button>
        </p>
      ) : (
        <form className="family-phone__form" onSubmit={submit}>
          <label className="family-phone__label" htmlFor={inputId}>WhatsApp number for this family</label>
          <div className="family-phone__row">
            <input
              id={inputId}
              className="field__input family-phone__input"
              type="tel"
              inputMode="tel"
              placeholder="+34 611 222 333"
              value={value}
              onChange={e => setValue(e.target.value)}
              disabled={saved === null || state.status === "saving"}
            />
            <button type="submit" className="button" disabled={saved === null || state.status === "saving"}>
              {state.status === "saving" ? "Saving…" : "Save"}
            </button>
            {saved && <button type="button" className="link-button" onClick={() => { setValue(saved); setEditing(false); setState({ status: "idle" }); }}>Cancel</button>}
          </div>
          <p className="family-phone__hint">
            The test phone that plays {familyName}: messages go there, and its replies are answered as this family.
            Use a different phone per family. Leave empty to use the team's demo phone.
          </p>
        </form>
      )}
      {state.message && <p className={state.status === "error" ? "proposal__error" : "family-phone__hint"} role={state.status === "error" ? "alert" : "status"}>{state.message}</p>}
    </div>
  );
}
