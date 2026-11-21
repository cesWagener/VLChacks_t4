// filters.ts — pure logic, no UI. Same code goes in the spec (Appendix A).

export type WealthBandId = "lt200k" | "200k-600k" | "600k-1m" | "1m-2m" | "gte2m";
export type SectorGroupId =
  | "technology" | "financials" | "healthcare" | "consumer"
  | "industrials" | "energy" | "materials";

export interface ClientSummary {
  id: string;                     // case slug, e.g. "samantha-lewis"
  displayName: string;            // "Samantha Lewis", "Timothy & Melanie Weah"
  familyName: string;             // "Lewis"
  members: { firstName: string; role: "client" | "co-client" | "child"; age: number }[];
  city: string; state: string;
  netWorth: number;               // USD, drives the wealth filter
  investableAssets: number;       // USD, shown, not filtered
  equityExposure: number;         // USD in stocks, base for $ sector exposure
  score: { value: number; band: string; colour: "green" | "yellow" | "red" };
  sectorWeights: Record<string, number>; // raw Morningstar sector -> share of equity (0..1)
  holdings: { ticker: string; name: string }[];
  goals: { name: string; type: string; date: string }[]; // ISO dates, future-dated plan moments
  planUrl?: string;
  simulated: boolean;
}

export const WEALTH_BANDS: { id: WealthBandId; label: string; min: number; max: number }[] = [
  { id: "lt200k",    label: "Under $200K",     min: -Infinity,  max: 200_000 },
  { id: "200k-600k", label: "$200K – $600K",   min: 200_000,    max: 600_000 },
  { id: "600k-1m",   label: "$600K – $1M",     min: 600_000,    max: 1_000_000 },
  { id: "1m-2m",     label: "$1M – $2M",       min: 1_000_000,  max: 2_000_000 },
  { id: "gte2m",     label: "$2M and over",    min: 2_000_000,  max: Infinity },
];
// min inclusive, max exclusive: exactly $600,000 is "$600K – $1M".
export const bandOf = (netWorth: number): WealthBandId =>
  WEALTH_BANDS.find(b => netWorth >= b.min && netWorth < b.max)!.id;

export const SECTOR_GROUPS: { id: SectorGroupId; label: string; sources: string[] }[] = [
  { id: "technology",  label: "Technology & Communications", sources: ["Technology", "Communication Services"] },
  { id: "financials",  label: "Financials & Real Estate",    sources: ["Financial Services", "Real Estate"] },
  { id: "healthcare",  label: "Healthcare",                  sources: ["Healthcare"] },
  { id: "consumer",    label: "Consumer",                    sources: ["Consumer Cyclical", "Consumer Defensive"] },
  { id: "industrials", label: "Industrials",                 sources: ["Industrials"] },
  { id: "energy",      label: "Energy & Utilities",          sources: ["Energy", "Utilities"] },
  { id: "materials",   label: "Basic Materials",             sources: ["Basic Materials"] },
];

export const groupWeight = (c: ClientSummary, g: SectorGroupId): number =>
  SECTOR_GROUPS.find(x => x.id === g)!.sources.reduce((s, src) => s + (c.sectorWeights[src] ?? 0), 0);

export const groupDollars = (c: ClientSummary, g: SectorGroupId): number =>
  groupWeight(c, g) * c.equityExposure;

export interface FilterState {
  q: string;                  // search text (kept in URL only)
  wealth: WealthBandId[];     // OR inside
  sectors: SectorGroupId[];   // OR inside
  minExposure: number;        // 0..1, default 0.10
  sort: SortId;
}
export type SortId = "next-milestone" | "name" | "net-worth-desc" | "score-asc" | "exposure-desc" | "exposure-usd-desc";

export const DEFAULT_FILTERS: FilterState = { q: "", wealth: [], sectors: [], minExposure: 0.10, sort: "next-milestone" };

// ---------- search ----------
export const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

export const MIN_QUERY_CHARS = 3;
export const queryIsActive = (q: string) => normalize(q).replace(/ /g, "").length >= MIN_QUERY_CHARS;

export type HitCategory = "people" | "location" | "holdings" | "goals";
export interface SearchHit { clientId: string; category: HitCategory; label: string; score: number }

const FIELD_WEIGHT: Record<HitCategory, number> = { people: 100, holdings: 70, location: 60, goals: 40 };

function fieldsOf(c: ClientSummary): { category: HitCategory; label: string; text: string }[] {
  return [
    { category: "people", label: c.displayName, text: c.displayName },
    ...c.members.map(m => ({ category: "people" as const, label: `${roleLabel(m.role)} · ${m.firstName}`, text: m.firstName })),
    { category: "location", label: `${c.city}, ${c.state}`, text: `${c.city} ${c.state}` },
    ...c.holdings.filter(h => h.ticker).map(h => ({ category: "holdings" as const, label: `Holds ${h.ticker}`, text: `${h.ticker} ${h.name}` })),
    ...c.goals.map(g => ({ category: "goals" as const, label: `${g.name} · ${monthYear(g.date)}`, text: g.name })),
  ];
}
const roleLabel = (r: string) => (r === "co-client" ? "Co-client" : r === "child" ? "Child" : "Client");
const monthYear = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

// Every query token must match some field of the client (AND across tokens).
// A token matches a field at a word start (strong) or anywhere (weak).
// `scope` = the chip picked in the results panel ("Holdings" only looks at holdings, etc.).
export function searchClients(clients: ClientSummary[], q: string, scope?: HitCategory): SearchHit[] {
  if (!queryIsActive(q)) return [];
  const tokens = normalize(q).split(" ").filter(Boolean);
  const hits: SearchHit[] = [];
  for (const c of clients) {
    const fields = fieldsOf(c)
      .filter(f => !scope || f.category === scope)
      .map(f => ({ ...f, norm: normalize(f.text) }));
    let best: SearchHit | null = null;
    let allTokensFound = true;
    for (const t of tokens) {
      let tokenBest: SearchHit | null = null;
      for (const f of fields) {
        const words = f.norm.split(/[^a-z0-9]+/);
        const prefix = words.some(w => w.startsWith(t));
        const inside = !prefix && f.norm.includes(t);
        if (!prefix && !inside) continue;
        const s = FIELD_WEIGHT[f.category] * (prefix ? 1 : 0.5) + (f.norm === t ? 20 : 0);
        if (!tokenBest || s > tokenBest.score) tokenBest = { clientId: c.id, category: f.category, label: f.label, score: s };
      }
      if (!tokenBest) { allTokensFound = false; break; }
      if (!best || tokenBest.score > best.score) best = tokenBest;
    }
    if (allTokensFound && best) hits.push(best);
  }
  return hits.sort((a, b) => b.score - a.score || a.clientId.localeCompare(b.clientId));
}

// ---------- filters ----------
export const matchesWealth = (c: ClientSummary, f: FilterState) =>
  f.wealth.length === 0 || f.wealth.includes(bandOf(c.netWorth));

export const matchesSectors = (c: ClientSummary, f: FilterState) =>
  f.sectors.length === 0 || f.sectors.some(g => groupWeight(c, g) >= f.minExposure - 1e-9);

export function applyFilters(clients: ClientSummary[], f: FilterState): ClientSummary[] {
  const hitIds = queryIsActive(f.q) ? new Set(searchClients(clients, f.q).map(h => h.clientId)) : null;
  return clients.filter(c => (!hitIds || hitIds.has(c.id)) && matchesWealth(c, f) && matchesSectors(c, f));
}

// Reason shown next to a search match that the active filters hide (D9).
export function whyHidden(c: ClientSummary, f: FilterState): string[] {
  const out: string[] = [];
  if (!matchesWealth(c, f))
    out.push(`not in ${f.wealth.map(id => WEALTH_BANDS.find(b => b.id === id)!.label).join(", ")}`);
  if (!matchesSectors(c, f))
    out.push(`under ${Math.round(f.minExposure * 100)}% in ${f.sectors.map(id => SECTOR_GROUPS.find(g => g.id === id)!.label).join(", ")}`);
  return out;
}

// Counts shown next to each option. Each facet ignores its own selection
// (so ticking one band never turns the other bands into 0).
export function facetCounts(clients: ClientSummary[], f: FilterState) {
  const wealthBase = applyFilters(clients, { ...f, wealth: [] });
  const sectorBase = applyFilters(clients, { ...f, sectors: [] });
  return {
    wealth: Object.fromEntries(WEALTH_BANDS.map(b => [b.id, wealthBase.filter(c => bandOf(c.netWorth) === b.id).length])),
    sectors: Object.fromEntries(SECTOR_GROUPS.map(g => [g.id, sectorBase.filter(c => groupWeight(c, g.id) >= f.minExposure - 1e-9).length])),
  } as { wealth: Record<WealthBandId, number>; sectors: Record<SectorGroupId, number> };
}

// Next one-off milestone in the plan. The yearly vacation is skipped: every family
// has one in January, so it would hide the moments that matter (home, college, car).
export function nextMilestone(c: ClientSummary, today: Date) {
  return c.goals
    .filter(g => g.type !== "VACATION" && new Date(g.date) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
}

export function sortClients(list: ClientSummary[], f: FilterState, today: Date): ClientSummary[] {
  const byName = (a: ClientSummary, b: ClientSummary) => a.familyName.localeCompare(b.familyName);
  const share = (c: ClientSummary) => f.sectors.reduce((s, g) => s + groupWeight(c, g), 0);
  const dollars = (c: ClientSummary) => f.sectors.reduce((s, g) => s + groupDollars(c, g), 0);
  const cmp: Record<SortId, (a: ClientSummary, b: ClientSummary) => number> = {
    "next-milestone": (a, b) =>
      (nextMilestone(a, today)?.date ?? "9999").localeCompare(nextMilestone(b, today)?.date ?? "9999") || byName(a, b),
    "name": byName,
    "net-worth-desc": (a, b) => b.netWorth - a.netWorth || byName(a, b),
    "score-asc": (a, b) => a.score.value - b.score.value || byName(a, b),
    // Share of the family's own stock holdings: a $150K family with 45% in tech ranks above
    // a $3M family with 30%. Dollars only break ties (D10).
    "exposure-desc": (a, b) => share(b) - share(a) || dollars(b) - dollars(a) || byName(a, b),
    "exposure-usd-desc": (a, b) => dollars(b) - dollars(a) || byName(a, b),
  };
  return [...list].sort(cmp[f.sort]);
}

// Picking the first sector switches the sort to exposure (the advisor's question is
// "who is most exposed?"). Clearing the sectors switches it back. A sort the advisor
// chose by hand is never overridden.
export const isExposureSort = (s: SortId) => s === "exposure-desc" || s === "exposure-usd-desc";
export function withSectors(f: FilterState, sectors: SectorGroupId[]): FilterState {
  let sort = f.sort;
  if (f.sectors.length === 0 && sectors.length > 0 && f.sort === DEFAULT_FILTERS.sort) sort = "exposure-desc";
  if (sectors.length === 0 && isExposureSort(f.sort)) sort = DEFAULT_FILTERS.sort;
  return { ...f, sectors, sort };
}

// ---------- URL <-> state ----------
const WEALTH_IDS = new Set(WEALTH_BANDS.map(b => b.id));
const SECTOR_IDS = new Set(SECTOR_GROUPS.map(g => g.id));
const SORT_IDS = new Set<SortId>(["next-milestone", "name", "net-worth-desc", "score-asc", "exposure-desc", "exposure-usd-desc"]);
export const EXPOSURE_STEPS = [0, 0.05, 0.10, 0.20, 0.30];

export function toSearchParams(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.wealth.length) p.set("wealth", f.wealth.join(","));
  if (f.sectors.length) p.set("sector", f.sectors.join(","));
  if (f.minExposure !== DEFAULT_FILTERS.minExposure) p.set("minExp", String(Math.round(f.minExposure * 100)));
  if (f.sort !== DEFAULT_FILTERS.sort) p.set("sort", f.sort);
  return p;
}

// Unknown or broken values are dropped, never thrown.
export function fromSearchParams(p: URLSearchParams): FilterState {
  const list = (k: string) => (p.get(k) ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const minExp = Number(p.get("minExp")) / 100;
  const sectors = [...new Set(list("sector"))].filter((x): x is SectorGroupId => SECTOR_IDS.has(x as SectorGroupId));
  let sort = SORT_IDS.has(p.get("sort") as SortId) ? (p.get("sort") as SortId) : DEFAULT_FILTERS.sort;
  if (isExposureSort(sort) && sectors.length === 0) sort = DEFAULT_FILTERS.sort;  // nothing to rank by
  return {
    q: p.get("q") ?? "",
    wealth: [...new Set(list("wealth"))].filter((x): x is WealthBandId => WEALTH_IDS.has(x as WealthBandId)),
    sectors,
    minExposure: p.has("minExp") && EXPOSURE_STEPS.includes(minExp) ? minExp : DEFAULT_FILTERS.minExposure,
    sort,
  };
}
