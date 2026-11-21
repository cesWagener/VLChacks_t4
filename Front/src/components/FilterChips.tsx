import { useEffect, useState } from "react";
import type { FilterState, SectorGroupId, WealthBandId } from "../lib/filters.ts";
import { SECTOR_SHORT, wealthLabel } from "../lib/format.ts";

export const hasActiveFilters = (f: FilterState) => Boolean(f.q) || f.wealth.length > 0 || f.sectors.length > 0;

/** "150 families" with nothing active; "12 of 150 families" once a filter or search is applied. */
export const countText = (shown: number, total: number, filtered = false) =>
  filtered ? `${shown} of ${total} ${total === 1 ? "family" : "families"}` : `${total} ${total === 1 ? "family" : "families"}`;

/** Chips bar (spec 5.4): result count, one chip per active option, Clear all. Hidden when nothing is active. */
export function FilterChips({ state, shown, total, onRemoveQuery, onRemoveWealth, onRemoveSector, onClearAll }: {
  state: FilterState;
  shown: number;
  total: number;
  onRemoveQuery: () => void;
  onRemoveWealth: (id: WealthBandId) => void;
  onRemoveSector: (id: SectorGroupId) => void;
  onClearAll: () => void;
}) {
  if (!hasActiveFilters(state)) return null;
  const level = Math.round(state.minExposure * 100);
  return (
    <div className="chips-bar">
      <span className="chips-bar__count">{countText(shown, total, true)}</span>
      <ul className="chips" aria-label="Active filters">
        {state.q && <Chip label={`Search: ${state.q}`} onRemove={onRemoveQuery} />}
        {state.wealth.map(id => <Chip key={id} label={wealthLabel(id)} onRemove={() => onRemoveWealth(id)} />)}
        {state.sectors.map(id => (
          <Chip key={id} label={`${SECTOR_SHORT[id]} ≥ ${level}%`} onRemove={() => onRemoveSector(id)} />
        ))}
      </ul>
      <button type="button" className="link-button chips-bar__clear" onClick={onClearAll}>Clear all</button>
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <li className="chip">
      <span>{label}</span>
      <button type="button" className="chip__remove" aria-label={`Remove ${label}`} onClick={onRemove}>✕</button>
    </li>
  );
}

/** Screen-reader announcement of the result count, debounced 300 ms (spec §9). */
export function ResultAnnouncer({ shown }: { shown: number }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setText(`${shown} ${shown === 1 ? "family" : "families"}`), 300);
    return () => clearTimeout(t);
  }, [shown]);
  return <div className="visually-hidden" aria-live="polite" aria-atomic="true">{text}</div>;
}
