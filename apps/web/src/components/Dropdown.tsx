import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Filter dropdown shell (spec 5.2, 5.3, §9): a button with aria-expanded that opens a popover.
 * Clicking inside does not close it; Esc or a click outside does. Focus moves into the list when it opens.
 */
export function Dropdown({ label, active, disabled, children }: {
  label: string;
  active: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div
      className="dropdown"
      ref={rootRef}
      onKeyDown={e => { if (e.key === "Escape" && open) { e.stopPropagation(); close(); } }}
      onBlur={e => { if (open && !rootRef.current?.contains(e.relatedTarget as Node | null) && e.relatedTarget) setOpen(false); }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="dropdown__button"
        data-active={active || undefined}
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        <span>{label}</span>
        <svg className="dropdown__caret" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="dropdown__panel" id={panelId} ref={panelRef}>
          {children}
        </div>
      )}
    </div>
  );
}

/** One checkbox row with its live count. A zero count stays clickable but muted (spec 5.2). */
export function CheckOption({ label, count, checked, onChange, hint }: {
  label: string;
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="check-option" data-empty={count === 0 || undefined} title={hint}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="check-option__label">{label}</span>
      <span className="check-option__count">{count}</span>
    </label>
  );
}

/** Button label rule (spec 5.2): "Wealth", "Wealth: $1M – $2M", "Wealth · 2". */
export function dropdownLabel(base: string, picked: string[]) {
  if (picked.length === 0) return base;
  if (picked.length === 1) return `${base}: ${picked[0]}`;
  return `${base} · ${picked.length}`;
}
