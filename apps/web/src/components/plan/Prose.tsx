import type { ReactNode } from "react";

/**
 * Renders the plan's narrative text, which uses a small Markdown subset:
 * "- " bullet lines, paragraphs, and **bold**. Text only; never injected as HTML.
 */
export function Prose({ text, className }: { text?: string; className?: string }) {
  if (!text) return null;
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={`ul-${blocks.length}`}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) bullets.push(bullet[1]);
    else { flush(); blocks.push(<p key={`p-${blocks.length}`}>{inline(line)}</p>); }
  }
  flush();
  return <div className={`prose ${className ?? ""}`}>{blocks}</div>;
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part,
  );
}
