import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  matchesSectors, matchesWealth, normalize, queryIsActive, searchClients, whyHidden,
  type ClientSummary, type FilterState, type HitCategory, type SearchHit,
} from "../lib/filters.ts";
import { bandLabelOf } from "../lib/format.ts";
import { openClient, readRecent } from "../lib/openClient.ts";

type Scope = "all" | HitCategory;
const SCOPES: { id: Scope; label: string }[] = [
  { id: "all", label: "All" },
  { id: "people", label: "People" },
  { id: "location", label: "Location" },
  { id: "holdings", label: "Holdings" },
  { id: "goals", label: "Goals" },
];
const MAX_SHOWN = 8;
const MAX_HIDDEN = 5;
const DEBOUNCE_MS = 120;
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

type Row =
  | { kind: "client"; client: ClientSummary; hit?: SearchHit; hidden?: string[] }
  | { kind: "show-all"; count: number };

/**
 * Search combobox (spec 5.1, D8, D9, §9). Typing only drives the suggestion panel;
 * Enter or "Show all" applies the text to the list as a `Search:` chip.
 */
export function ClientSearch({ clients, filters, onApply, disabled }: {
  clients: ClientSummary[];
  filters: FilterState;
  onApply: (q: string) => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState(filters.q);
  const [debounced, setDebounced] = useState(filters.q);
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<Scope>("all");
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  // The applied search changed from outside (chip removed, Clear all, Back): mirror it.
  useEffect(() => { setText(filters.q); setDebounced(filters.q); }, [filters.q]);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => setActive(-1), [debounced, scope, open]);

  // `/` and Ctrl+K / ⌘K focus the search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); inputRef.current?.focus(); }
      else if (e.key === "/" && !typing) { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) close(); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const close = () => { setOpen(false); setScope("all"); };

  const byId = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients]);

  const results = useMemo(() => {
    if (!queryIsActive(debounced)) return null;
    const visible = (h: SearchHit) => {
      const c = byId.get(h.clientId)!;
      return matchesWealth(c, filters) && matchesSectors(c, filters);
    };
    const perScope = Object.fromEntries(
      SCOPES.map(s => [s.id, searchClients(clients, debounced, s.id === "all" ? undefined : s.id)]),
    ) as Record<Scope, SearchHit[]>;
    const counts = Object.fromEntries(SCOPES.map(s => [s.id, perScope[s.id].filter(visible).length])) as Record<Scope, number>;
    const current = perScope[scope];
    return {
      counts,
      shown: current.filter(visible),
      hidden: current.filter(h => !visible(h)),
    };
  }, [debounced, scope, clients, byId, filters]);

  const textActive = queryIsActive(text);
  const mode: "recent" | "hint" | "results" = !text.trim() ? "recent" : textActive ? "results" : "hint";

  const recent = useMemo(
    () => (open && mode === "recent" ? readRecent().map(id => byId.get(id)).filter((c): c is ClientSummary => !!c) : []),
    [open, mode, byId],
  );

  const rows: Row[] = useMemo(() => {
    if (mode === "recent") return recent.map(client => ({ kind: "client", client }));
    if (mode !== "results" || !results) return [];
    const out: Row[] = [
      ...results.shown.slice(0, MAX_SHOWN).map(hit => ({ kind: "client" as const, client: byId.get(hit.clientId)!, hit })),
      ...results.hidden.slice(0, MAX_HIDDEN).map(hit => {
        const client = byId.get(hit.clientId)!;
        return { kind: "client" as const, client, hit, hidden: whyHidden(client, filters) };
      }),
    ];
    if (results.counts.all > 0) out.push({ kind: "show-all", count: results.counts.all });
    return out;
  }, [mode, recent, results, byId, filters]);

  const apply = () => {
    onApply(text.trim());
    close();
  };

  const choose = (row: Row) => {
    if (row.kind === "show-all") { apply(); return; }
    close();
    openClient(row.client);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!open) { setOpen(true); return; }
        if (rows.length) setActive(a => (a + 1) % rows.length);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!open) { setOpen(true); return; }
        if (rows.length) setActive(a => (a <= 0 ? rows.length - 1 : a - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (open && active >= 0 && rows[active]) choose(rows[active]);
        else if (textActive) apply();
        break;
      case "Escape":
        e.preventDefault();
        if (open) close();
        else setText("");
        break;
    }
  };

  const tokens = useMemo(() => normalize(debounced).split(" ").filter(Boolean), [debounced]);
  const optionId = (i: number) => `${baseId}-opt-${i}`;
  const shownCount = rows.filter(r => r.kind === "client" && !r.hidden).length;
  const hiddenRows = rows.filter(r => r.kind === "client" && r.hidden);

  const renderClientRow = (row: Extract<Row, { kind: "client" }>, i: number) => {
    const { client: c, hit } = row;
    const why = hit && hit.label !== c.displayName ? hit.label : `${c.city}, ${c.state}`;
    const whyIsMatch = Boolean(hit && hit.label !== c.displayName);
    return (
      <li
        key={`${c.id}-${row.hidden ? "h" : "v"}`}
        id={optionId(i)}
        role="option"
        aria-selected={i === active}
        className="search-row"
        data-active={i === active || undefined}
        data-hidden={row.hidden ? true : undefined}
        onMouseDown={e => e.preventDefault()}
        onMouseEnter={() => setActive(i)}
        onClick={() => choose(row)}
      >
        <span className="search-row__name">
          <span>{hit && !whyIsMatch ? highlight(c.displayName, tokens) : c.displayName}</span>
          {c.simulated && <span className="badge-sim">SIM</span>}
        </span>
        <span className="search-row__why">{whyIsMatch ? highlight(why, tokens) : why}</span>
        <span className="search-row__band">{bandLabelOf(c)}</span>
        {row.hidden && <span className="search-row__reason">{row.hidden.join("; ")}</span>}
      </li>
    );
  };

  return (
    <div className="search" ref={rootRef} onBlur={e => { if (open && e.relatedTarget && !rootRef.current?.contains(e.relatedTarget as Node)) close(); }}>
      <div className="search__field">
        <svg className="search__icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          className="search__input"
          type="text"
          role="combobox"
          aria-label="Search families, children, cities, tickers, goals"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
          placeholder="Search families, children, cities, tickers, goals…"
          autoComplete="off"
          spellCheck={false}
          value={text}
          disabled={disabled}
          onChange={e => { setText(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {text ? (
          <button
            type="button"
            className="search__clear"
            aria-label="Clear search"
            onClick={() => { setText(""); if (filters.q) onApply(""); inputRef.current?.focus(); }}
          >
            ✕
          </button>
        ) : (
          <kbd className="search__kbd" aria-hidden="true">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        )}
      </div>

      {open && (
        <div className="search__panel">
          {mode === "results" && results && (
            <div className="scope-chips" role="group" aria-label="Search in">
              {SCOPES.map(s => (
                <button
                  key={s.id}
                  type="button"
                  className="scope-chip"
                  aria-pressed={scope === s.id}
                  onClick={() => { setScope(s.id); inputRef.current?.focus(); }}
                >
                  {s.label} <span className="scope-chip__count">{results.counts[s.id]}</span>
                </button>
              ))}
            </div>
          )}

          {mode === "hint" && <p className="search__message">Type 3 letters to search.</p>}

          {mode === "recent" && recent.length === 0 && (
            <p className="search__message">Clients you open appear here.</p>
          )}

          {mode === "results" && results && results.shown.length === 0 && results.hidden.length === 0 && (
            <p className="search__message">
              No families match '{debounced.trim()}'. Try a first name, a child's name, a city, a ticker or a goal.
            </p>
          )}

          <ul className="search__list" role="listbox" id={listboxId} aria-label="Search suggestions">
            {mode === "recent" && recent.length > 0 && (
              <li role="presentation" className="search__group">Recently opened</li>
            )}
            {rows.map((row, i) => (
              <Fragment key={row.kind === "client" ? `${row.client.id}-${row.hidden ? "h" : "v"}` : "show-all"}>
                {row.kind === "client" && row.hidden && i === shownCount && (
                  <li role="presentation" className="search__group">
                    Hidden by your filters ({results?.hidden.length ?? hiddenRows.length})
                  </li>
                )}
                {row.kind === "client" ? renderClientRow(row, i) : (
                  <li
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    className="search-row search-row--action"
                    data-active={i === active || undefined}
                    onMouseDown={e => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(row)}
                  >
                    <span aria-hidden="true">↵</span> Show all {row.count} in the list
                  </li>
                )}
              </Fragment>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Bolds the parts of `label` that match the query tokens, ignoring case and accents. */
function highlight(label: string, tokens: string[]): ReactNode {
  if (!tokens.length) return label;
  // Map every character of the normalised label back to its index in the original label.
  let norm = "";
  const back: number[] = [];
  [...label].forEach((ch, i) => {
    const n = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    for (const nc of n) { norm += nc; back.push(i); }
  });
  const chars = [...label];
  const marked = new Array<boolean>(chars.length).fill(false);
  for (const t of tokens) {
    let from = 0;
    for (let at = norm.indexOf(t, from); at !== -1; at = norm.indexOf(t, from)) {
      for (let k = at; k < at + t.length; k++) marked[back[k]] = true;
      from = at + t.length;
    }
  }
  const out: ReactNode[] = [];
  let buf = "";
  let bold = false;
  chars.forEach((ch, i) => {
    if (marked[i] !== bold) { if (buf) out.push(bold ? <strong key={i}>{buf}</strong> : buf); buf = ""; bold = marked[i]; }
    buf += ch;
  });
  if (buf) out.push(bold ? <strong key="end">{buf}</strong> : buf);
  return out;
}
