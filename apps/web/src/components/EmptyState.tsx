import type { ReactNode } from "react";

/** Empty, error and "no results" states (spec 5.6). */
export function EmptyState({ title, children, action, tone = "neutral" }: {
  title: string;
  children?: ReactNode;
  action?: { label: string; onClick: () => void };
  tone?: "neutral" | "error";
}) {
  return (
    <div className="empty-state" data-tone={tone} role={tone === "error" ? "alert" : undefined}>
      <p className="empty-state__title">{title}</p>
      {children && <p className="empty-state__body">{children}</p>}
      {action && (
        <button type="button" className="button" onClick={action.onClick}>{action.label}</button>
      )}
    </div>
  );
}
