import { useCallback, useEffect, useMemo, useState } from "react";
import {
  applyFilters, facetCounts, groupWeight, isExposureSort, queryIsActive,
  searchClients, sortClients, withSectors,
  type ClientSummary, type FilterState, type SortId,
} from "../lib/filters.ts";
import { SECTOR_SHORT, greeting, pct, sectorLabel, wealthLabel } from "../lib/format.ts";
import { loadClients } from "../lib/clientsSource.ts";
import { useFilterState } from "../lib/useFilterState.ts";
import { CLIENTS_PATH } from "../lib/router.ts";
import { AppHeader } from "../components/AppHeader.tsx";
import { ClientSearch } from "../components/ClientSearch.tsx";
import { WealthFilter } from "../components/WealthFilter.tsx";
import { SectorFilter } from "../components/SectorFilter.tsx";
import { FilterChips, ResultAnnouncer, countText, hasActiveFilters } from "../components/FilterChips.tsx";
import { ClientTable, SkeletonRows } from "../components/ClientTable.tsx";
import { EmptyState } from "../components/EmptyState.tsx";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; clients: ClientSummary[] };

const SORTS: { id: SortId; label: string; needsSector?: boolean }[] = [
  { id: "next-milestone", label: "Next milestone" },
  { id: "name", label: "Name A–Z" },
  { id: "net-worth-desc", label: "Net worth high → low" },
  { id: "score-asc", label: "Needs attention (score ↑)" },
  { id: "exposure-desc", label: "Exposure % high → low", needsSector: true },
  { id: "exposure-usd-desc", label: "Exposure $ high → low", needsSector: true },
];

const EMPTY: ClientSummary[] = [];

export function ClientsPage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const { state, update, clearAll } = useFilterState(CLIENTS_PATH);

  const fetchClients = useCallback((fresh = false) => {
    setLoad({ status: "loading" });
    loadClients({ fresh })
      .then(clients => setLoad({ status: "ready", clients }))
      .catch((e: unknown) => setLoad({ status: "error", message: e instanceof Error ? e.message : String(e) }));
  }, []);
  useEffect(() => fetchClients(), [fetchClients]);

  const clients = load.status === "ready" ? load.clients : EMPTY;
  const today = useMemo(() => new Date(), []);
  const visible = useMemo(() => sortClients(applyFilters(clients, state), state, today), [clients, state, today]);
  const counts = useMemo(() => facetCounts(clients, state), [clients, state]);
  const ready = load.status === "ready";
  const active = hasActiveFilters(state);

  return (
    <div className="page">
      <AppHeader />
      <main className="clients">
        <section className="clients__top">
          <h1 className="clients__title">
            {greeting(new Date())}, David.{" "}
            <span className="clients__title-sub">
              {ready ? `${clients.length} ${clients.length === 1 ? "family" : "families"} in your book.` : "Loading your book…"}
            </span>
          </h1>

          <ClientSearch clients={clients} filters={state} onApply={q => update({ q })} disabled={!ready} />

          <div className="filter-row">
            <div className="filter-row__left">
              <WealthFilter value={state.wealth} counts={counts.wealth} onChange={wealth => update({ wealth })} disabled={!ready} />
              <SectorFilter
                value={state.sectors}
                minExposure={state.minExposure}
                counts={counts.sectors}
                onChange={next => update(s => withSectors(s, next))}
                onMinExposure={minExposure => update({ minExposure })}
                disabled={!ready}
              />
            </div>
            <div className="filter-row__right">
              {ready && !active && <span className="filter-row__count">{countText(visible.length, clients.length)}</span>}
              <label className="sort">
                <span className="sort__label">Sort:</span>
                <select
                  className="sort__select"
                  value={state.sort}
                  onChange={e => update({ sort: e.target.value as SortId })}
                  disabled={!ready}
                >
                  {SORTS.map(s => (
                    <option key={s.id} value={s.id} disabled={s.needsSector && state.sectors.length === 0}>{s.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {state.sectors.length > 0 && isExposureSort(state.sort) && (
            <p className="sort-note">
              Most exposed first: {state.sort === "exposure-desc" ? "share of stocks" : "dollars in stocks"} in{" "}
              {state.sectors.map(sectorLabel).join(" + ")}
            </p>
          )}

          <FilterChips
            state={state}
            shown={visible.length}
            total={clients.length}
            onRemoveQuery={() => update({ q: "" })}
            onRemoveWealth={id => update(s => ({ ...s, wealth: s.wealth.filter(x => x !== id) }))}
            onRemoveSector={id => update(s => withSectors(s, s.sectors.filter(x => x !== id)))}
            onClearAll={clearAll}
          />
          <ResultAnnouncer shown={visible.length} />
        </section>

        <section className="clients__list" aria-label="Clients" aria-busy={load.status === "loading"}>
          {load.status === "loading" && <SkeletonRows />}
          {load.status === "error" && (
            <EmptyState
              tone="error"
              title="Couldn't load your clients."
              action={{ label: "Retry", onClick: () => fetchClients(true) }}
            >
              {load.message}
            </EmptyState>
          )}
          {ready && clients.length === 0 && (
            <EmptyState title="No clients yet.">Families appear here once their plan is delivered.</EmptyState>
          )}
          {ready && clients.length > 0 && visible.length === 0 && (
            <NoResults clients={clients} state={state} update={update} clearAll={clearAll} />
          )}
          {ready && visible.length > 0 && <ClientTable clients={visible} filters={state} today={today} />}
        </section>
      </main>
    </div>
  );
}

/** "No results" (spec 5.1, 5.3, 5.6): name the cause and offer the one click that fixes the most. */
function NoResults({ clients, state, update, clearAll }: {
  clients: ClientSummary[];
  state: FilterState;
  update: (next: Partial<FilterState> | ((s: FilterState) => FilterState)) => void;
  clearAll: () => void;
}) {
  // The search alone finds nothing.
  if (queryIsActive(state.q) && searchClients(clients, state.q).length === 0) {
    return (
      <EmptyState title={`No families match '${state.q}'.`} action={{ label: "Clear search", onClick: () => update({ q: "" }) }}>
        Try a first name, a child's name, a city, a ticker or a goal.
      </EmptyState>
    );
  }

  // The sector level is what empties the list: name the most exposed family instead.
  const withoutSectors = applyFilters(clients, { ...state, sectors: [] });
  if (state.sectors.length > 0 && withoutSectors.length > 0) {
    let best = { c: withoutSectors[0], g: state.sectors[0], w: -1 };
    for (const c of withoutSectors) for (const g of state.sectors) {
      const w = groupWeight(c, g);
      if (w > best.w) best = { c, g, w };
    }
    const level = Math.round(state.minExposure * 100);
    const names = state.sectors.map(sectorLabel).join(" or ");
    return (
      <EmptyState
        title={`No family has ${level}% or more in ${names}.`}
        action={state.minExposure > 0 ? { label: "Show any exposure", onClick: () => update({ minExposure: 0 }) } : undefined}
      >
        Highest: {best.c.displayName} at {pct(best.w)}{state.sectors.length > 1 ? ` in ${SECTOR_SHORT[best.g]}` : ""}.
      </EmptyState>
    );
  }

  // Otherwise: offer to remove the chip that brings back the most rows.
  const candidates: { label: string; next: (s: FilterState) => FilterState }[] = [
    ...(state.q ? [{ label: `Remove search '${state.q}'`, next: (s: FilterState) => ({ ...s, q: "" }) }] : []),
    ...state.wealth.map(id => ({ label: `Remove ${wealthLabel(id)}`, next: (s: FilterState) => ({ ...s, wealth: s.wealth.filter(x => x !== id) }) })),
    ...state.sectors.map(id => ({
      label: `Remove ${SECTOR_SHORT[id]} ≥ ${Math.round(state.minExposure * 100)}%`,
      next: (s: FilterState) => withSectors(s, s.sectors.filter(x => x !== id)),
    })),
  ];
  const scored = candidates
    .map(c => ({ ...c, rows: applyFilters(clients, c.next(state)).length }))
    .sort((a, b) => b.rows - a.rows);
  const top = scored[0];
  const action = top && top.rows > 0
    ? { label: top.label, onClick: () => update(top.next) }
    : { label: "Clear all filters", onClick: clearAll };
  return <EmptyState title="No families match these filters." action={action} />;
}
