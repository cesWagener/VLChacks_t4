// useFilterState.ts — keeps the menu's filters in the URL (source of truth) and in localStorage (spec Appendix B, D6).
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_FILTERS, fromSearchParams, isExposureSort, toSearchParams, type FilterState } from "./filters.ts";

const STORAGE_KEY = "sherpas.clientMenu.filters.v1";
const FILTER_KEYS = ["wealth", "sector", "minExp", "sort"];
const STATE_KEYS = ["q", ...FILTER_KEYS];

function initialState(): FilterState {
  const url = new URLSearchParams(window.location.search);
  const q = url.get("q") ?? "";
  if (FILTER_KEYS.some(k => url.has(k))) return fromSearchParams(url);       // 1. a link wins
  try {
    const saved = localStorage.getItem(STORAGE_KEY);                          // 2. last session
    if (saved) return { ...fromSearchParams(new URLSearchParams(saved)), q };
  } catch { /* storage blocked (private mode, iframe): use defaults */ }
  return { ...DEFAULT_FILTERS, q };                                           // 3. defaults
}

/** `path` is the page that owns these filters; the URL is only rewritten while on it. */
export function useFilterState(path: string) {
  const [state, setState] = useState<FilterState>(initialState);

  // Every change: rewrite the URL without adding history entries, and save the filters
  // (not the search text) for next time. Params that are not filter state (e.g. `data=real`) are kept.
  useEffect(() => {
    if (window.location.pathname !== path) return;
    const params = toSearchParams(state);
    const url = new URLSearchParams(window.location.search);
    STATE_KEYS.forEach(k => url.delete(k));
    params.forEach((v, k) => url.set(k, v));
    const qs = url.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    params.delete("q");
    try { localStorage.setItem(STORAGE_KEY, params.toString()); } catch { /* ignore */ }
  }, [state, path]);

  // Browser back/forward into this page restores what that URL says.
  useEffect(() => {
    const onPop = () => {
      if (window.location.pathname === path) setState(fromSearchParams(new URLSearchParams(window.location.search)));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [path]);

  const update = useCallback(
    (next: Partial<FilterState> | ((s: FilterState) => FilterState)) =>
      setState(s => (typeof next === "function" ? next(s) : { ...s, ...next })),
    [],
  );

  // "Clear all" (spec 5.4): clears the filters and the search text, keeps the sort.
  // An exposure sort has nothing to rank by once the sectors are gone, so it goes back to the default.
  const clearAll = useCallback(
    () => setState(s => ({ ...DEFAULT_FILTERS, sort: isExposureSort(s.sort) ? DEFAULT_FILTERS.sort : s.sort })),
    [],
  );
  return { state, update, clearAll };
}
