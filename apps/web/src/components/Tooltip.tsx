import { useId, useState, type ReactNode } from "react";

/** Hover/focus tooltip. The trigger is focusable so keyboard users can read it too. */
export function Tooltip({ content, children, align = "start" }: { content: ReactNode; children: ReactNode; align?: "start" | "end" }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="tooltip"
      tabIndex={0}
      aria-describedby={id}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={e => { if (e.key === "Escape") setOpen(false); }}
    >
      {children}
      <span role="tooltip" id={id} className={`tooltip__bubble tooltip__bubble--${align}`} data-open={open || undefined}>
        {content}
      </span>
    </span>
  );
}
