// clientsSource.ts — the only place the app gets its client list from.
// It reads the static index built from the four case folders in cases/ (spec §7.2, D7). No simulated families.
// Anything that later serves the same ClientSummary[] can replace this fetch; the UI does not change.
import type { ClientSummary } from "./filters.ts";

const FILE = "clients.index.json";
let cache: Promise<ClientSummary[]> | null = null;

export function loadClients({ fresh = false } = {}): Promise<ClientSummary[]> {
  if (!fresh && cache) return cache;
  const promise = fetch(`${import.meta.env.BASE_URL}${FILE}`).then(res => {
    if (!res.ok) throw new Error(`Could not load ${FILE} (HTTP ${res.status})`);
    return res.json() as Promise<ClientSummary[]>;
  });
  cache = promise;
  promise.catch(() => { if (cache === promise) cache = null; }); // let Retry fetch again
  return promise;
}
