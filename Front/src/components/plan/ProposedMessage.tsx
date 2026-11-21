import { useEffect, useMemo, useRef, useState } from "react";
import type { PlanData } from "../../lib/plan.ts";
import { TONES, draftMessage, type Tone } from "../../lib/message.ts";

const STORAGE_PREFIX = "sherpas.proposedMessage.v1.";

interface Saved {
  tone: Tone | null;          // null = automatic
  issueKeys: string[] | null; // null = the generator's pick
  subject: string;
  body: string;
  edited: boolean;
  approved: boolean;
}

function readSaved(id: string): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch { return null; }
}

const TONE_WHY: Record<Tone, string> = {
  supportive: "Supportive: acknowledge, reassure, one small step",
  steady: "Steady: honest and calm, act early",
  celebratory: "Celebratory: recognise progress",
};

/**
 * Proposed message for one family, shown above their plan. The advisor reviews, edits and approves it;
 * nothing is sent from here (challenge ground rule: send no real messages).
 */
export function ProposedMessage({ plan }: { plan: PlanData }) {
  const saved = useMemo(() => readSaved(plan.id), [plan.id]);
  const [tone, setTone] = useState<Tone | null>(saved?.tone ?? null);
  const [issueKeys, setIssueKeys] = useState<string[] | null>(saved?.issueKeys ?? null);
  const draft = useMemo(
    () => draftMessage(plan, { tone: tone ?? undefined, issueKeys: issueKeys ?? undefined }),
    [plan, tone, issueKeys],
  );
  const [subject, setSubject] = useState(saved?.subject ?? draft.subject);
  const [body, setBody] = useState(saved?.body ?? draft.body);
  const [edited, setEdited] = useState(saved?.edited ?? false);
  const [approved, setApproved] = useState(saved?.approved ?? false);
  const [copied, setCopied] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Options changed and the advisor hasn't hand-edited: follow the new draft.
  useEffect(() => {
    if (!edited) { setSubject(draft.subject); setBody(draft.body); }
  }, [draft, edited]);

  useEffect(() => {
    const s: Saved = { tone, issueKeys, subject, body, edited, approved };
    try { localStorage.setItem(STORAGE_PREFIX + plan.id, JSON.stringify(s)); } catch { /* storage blocked */ }
  }, [plan.id, tone, issueKeys, subject, body, edited, approved]);

  // Grow the textarea with its content so the whole message is readable without inner scrolling.
  useEffect(() => {
    const el = bodyRef.current;
    if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight + 2}px`; }
  }, [body]);

  const regenerate = () => { setEdited(false); setApproved(false); setSubject(draft.subject); setBody(draft.body); };
  const onEdit = (fn: () => void) => { fn(); setEdited(true); setApproved(false); };
  // Changing the tone or topics rewrites the draft; hand edits are kept only if the advisor says so.
  const changeOptions = (apply: () => void) => {
    if (edited && !window.confirm("Replace your edits with a new draft?")) return;
    apply();
    setEdited(false);
    setApproved(false);
  };
  const toggleIssue = (key: string, on: boolean) => changeOptions(() => {
    const current = issueKeys ?? draft.usedIssues;
    setIssueKeys(draft.issues.map(i => i.key).filter(k => (k === key ? on : current.includes(k))));
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked: the text is still selectable */ }
  };

  const usedStrengths = draft.strengths.slice(0, 2);
  const band = `${plan.score.value} · ${plan.score.band}`;

  return (
    <section className="proposal" aria-labelledby="proposal-title" data-tone={draft.tone}>
      <header className="proposal__head">
        <div>
          <p className="proposal__eyebrow">Proposed message</p>
          <h2 id="proposal-title" className="proposal__title">For {plan.adults.join(" & ")}</h2>
        </div>
        <div className="proposal__status">
          <span className={`tone-pill tone-pill--${draft.tone}`}>{TONES.find(t => t.id === draft.tone)!.label} tone</span>
          <span className="status-pill" data-approved={approved || undefined}>{approved ? "Approved" : edited ? "Edited draft" : "Draft"}</span>
        </div>
      </header>

      <div className="proposal__grid">
        <div className="proposal__editor">
          <label className="field">
            <span className="field__label">Subject</span>
            <input className="field__input" value={subject} onChange={e => onEdit(() => setSubject(e.target.value))} />
          </label>
          <label className="field">
            <span className="field__label">Message</span>
            <textarea ref={bodyRef} className="field__textarea" value={body} onChange={e => onEdit(() => setBody(e.target.value))} spellCheck />
          </label>
          <div className="proposal__actions">
            {approved ? (
              <button type="button" className="button button--approved" onClick={() => setApproved(false)}>✓ Approved · undo</button>
            ) : (
              <button type="button" className="button" onClick={() => setApproved(true)}>Approve message</button>
            )}
            <button type="button" className="button button--ghost" onClick={copy}>{copied ? "Copied" : "Copy text"}</button>
            {edited && <button type="button" className="link-button" onClick={regenerate}>Discard edits and regenerate</button>}
          </div>
          <p className="proposal__note">
            Nothing is sent from here. Once approved, copy it into your usual channel.
          </p>
        </div>

        <aside className="proposal__why" aria-label="Why this message">
          <h3 className="why__title">Why this message</h3>

          <div className="why__block">
            <label className="why__label" htmlFor={`tone-${plan.id}`}>Tone</label>
            <select
              id={`tone-${plan.id}`}
              className="why__select"
              value={tone ?? "auto"}
              onChange={e => { const v = e.target.value; changeOptions(() => setTone(v === "auto" ? null : (v as Tone))); }}
            >
              <option value="auto">Automatic ({TONES.find(t => t.id === draft.autoTone)!.label})</option>
              {TONES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <p className="why__hint">Score {band}. {TONE_WHY[draft.tone]}.</p>
          </div>

          {usedStrengths.length > 0 && (
            <div className="why__block">
              <p className="why__label">Opens with what's going well</p>
              <ul className="why__list">
                {usedStrengths.map(s => <li key={s.key} title={s.source}><span className="dot dot--green" aria-hidden="true" />{s.label}</li>)}
              </ul>
            </div>
          )}

          <div className="why__block">
            <p className="why__label">Topics to raise</p>
            {draft.issues.length === 0 ? (
              <p className="why__hint">No gaps found in the plan.</p>
            ) : (
              <ul className="why__list">
                {draft.issues.map(i => (
                  <li key={i.key} title={i.source}>
                    <label className="why__check">
                      <input type="checkbox" checked={draft.usedIssues.includes(i.key)} onChange={e => toggleIssue(i.key, e.target.checked)} />
                      <span className={`dot dot--sev${i.severity}`} aria-hidden="true" />
                      <span>{i.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {draft.milestone && (
            <div className="why__block">
              <p className="why__label">Next moment in the plan</p>
              <p className="why__hint why__hint--strong">
                {draft.milestone.label.replace(/^your /, "")} ·{" "}
                {new Date(draft.milestone.date).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}
              </p>
            </div>
          )}

          {plan.persona.concerns.length > 0 && (
            <div className="why__block">
              <p className="why__label">Persona concerns</p>
              <ul className="why__list why__list--compact">
                {plan.persona.concerns.slice(0, 4).map(c => (
                  <li key={c.id}><span className={`sev-tag sev-tag--${c.severity.toLowerCase()}`}>{c.severity.toLowerCase()}</span>{c.title}</li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
