// format.ts — display helpers shared by the components. No filtering logic here (that is filters.ts).
import {
  SECTOR_GROUPS, WEALTH_BANDS, bandOf, groupWeight,
  type ClientSummary, type SectorGroupId, type WealthBandId,
} from "./filters.ts";

const compactUsd = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1,
});
const exactUsd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** "$1.4M", "$108.6K", "$210K" */
export const money = (n: number) => compactUsd.format(n);
/** "$1,395,000" */
export const moneyExact = (n: number) => exactUsd.format(n);
/** 0.383 -> "38.3%" */
export const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

/** Short sector labels for chips, buttons and table cells. */
export const SECTOR_SHORT: Record<SectorGroupId, string> = {
  technology: "Tech & Comms",
  financials: "Financials & RE",
  healthcare: "Healthcare",
  consumer: "Consumer",
  industrials: "Industrials",
  energy: "Energy & Util.",
  materials: "Basic Materials",
};

export const wealthLabel = (id: WealthBandId) => WEALTH_BANDS.find(b => b.id === id)!.label;
export const sectorLabel = (id: SectorGroupId) => SECTOR_GROUPS.find(g => g.id === id)!.label;
export const bandLabelOf = (c: ClientSummary) => wealthLabel(bandOf(c.netWorth));

/** "Aug 2028" */
export const monthYear = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/** "Samantha 47 · Ethan 18 · Ava 16" */
export const membersLine = (c: ClientSummary) => c.members.map(m => `${m.firstName} ${m.age}`).join(" · ");

/** Raw Morningstar sectors behind a group, for the exposure tooltip (spec D3):
 *  "Technology 30.6% + Communication Services 7.7%" */
export function groupBreakdown(c: ClientSummary, g: SectorGroupId): string {
  const group = SECTOR_GROUPS.find(x => x.id === g)!;
  return group.sources.map(src => `${src} ${pct(c.sectorWeights[src] ?? 0)}`).join(" + ");
}

/** The group with the largest share of the family's stocks. */
export function topGroup(c: ClientSummary): SectorGroupId {
  return SECTOR_GROUPS.reduce((best, g) => (groupWeight(c, g.id) > groupWeight(c, best) ? g.id : best), SECTOR_GROUPS[0].id);
}

export function greeting(now: Date) {
  const h = now.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
