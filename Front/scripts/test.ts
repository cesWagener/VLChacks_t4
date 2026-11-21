// test.ts — logic checks against the real cases (spec Appendix E).
// Run from Front/ after `npm run data`: npm test
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import * as F from "../src/lib/filters.ts";

const clients: F.ClientSummary[] = JSON.parse(readFileSync("public/clients.index.json", "utf8"));
const S = (over: Partial<F.FilterState>) => ({ ...F.DEFAULT_FILTERS, ...over });
const ids = (l: { id: string }[]) => l.map(c => c.id).sort();
const hits = (q: string, scope?: F.HitCategory) => F.searchClients(clients, q, scope);
const hitIds = (q: string, scope?: F.HitCategory) => hits(q, scope).map(h => h.clientId).sort();
const list = (f: Partial<F.FilterState>) => ids(F.applyFilters(clients, S(f)));
const today = new Date("2026-11-21T00:00:00Z");
const [JOHNSON, CARTER, LEWIS, WEAH] = ["daniel-emily-johnson", "michael-carter", "samantha-lewis", "timothy-melanie-weah"];

// 1. under 3 letters: nothing (spaces don't count)
assert.deepEqual(hits("sa"), []);
assert.deepEqual(hits(" s a "), []);
// 2-5. people, children, tickers
assert.deepEqual(hitIds("sam"), [LEWIS]);
assert.deepEqual(hits("oli").map(h => h.label), ["Child · Oliver"]);
assert.deepEqual(hits("upr").map(h => [h.clientId, h.label]), [[WEAH, "Holds UPRO"]]);
assert.deepEqual(hitIds("vti"), [JOHNSON, CARTER, LEWIS, WEAH]);
// 6. goals scope
assert.deepEqual(hits("col", "goals").map(h => h.label),
  ["College Oliver · Aug 2033", "College Ava · Aug 2028", "College Liam · Aug 2038"]);
assert.deepEqual(hits("col", "people"), []);
// 7. every word must match
assert.deepEqual(hitIds("sam mia"), [LEWIS]);
assert.deepEqual(hitIds("sam aus"), []);
// 8. case and accents
assert.deepEqual(hits("MÉLANIE").map(h => h.label), ["Co-client · Melanie"]);
// 9-12. wealth (OR inside)
assert.deepEqual(list({ wealth: ["200k-600k"] }), [JOHNSON, CARTER]);
assert.deepEqual(list({ wealth: ["200k-600k", "1m-2m"] }), [JOHNSON, CARTER, LEWIS]);
assert.deepEqual(list({ wealth: ["600k-1m"] }), [WEAH]);
assert.deepEqual(list({ wealth: ["lt200k", "gte2m"] }), []);
assert.equal(F.bandOf(600_000), "600k-1m");
assert.equal(F.bandOf(199_999), "lt200k");
assert.equal(F.bandOf(-50_000), "lt200k");
assert.equal(F.bandOf(2_000_000), "gte2m");
// 13-14. sectors at the default 10% level
assert.deepEqual(list({ sectors: ["healthcare"] }), [CARTER, LEWIS]);
assert.deepEqual(list({ sectors: ["materials"] }), []);
assert.deepEqual(list({ sectors: ["materials"], minExposure: 0 }), [JOHNSON, CARTER, LEWIS, WEAH]);
const topMaterials = [...clients].sort((a, b) => F.groupWeight(b, "materials") - F.groupWeight(a, "materials"))[0];
assert.equal(topMaterials.id, WEAH);
assert.equal((F.groupWeight(topMaterials, "materials") * 100).toFixed(1), "3.9");
// 15. picking a sector switches the sort to exposure: share of own stocks first, $ as option
const tech = F.withSectors(F.DEFAULT_FILTERS, ["technology"]);
assert.equal(tech.sort, "exposure-desc");
assert.deepEqual(F.sortClients(F.applyFilters(clients, tech), tech, today)
  .map(c => [c.id, +(F.groupWeight(c, "technology") * 100).toFixed(1)]),
  [[JOHNSON, 44.5], [CARTER, 40.8], [LEWIS, 38.3], [WEAH, 37.2]]);
const techUsd = { ...tech, sort: "exposure-usd-desc" as const };
assert.deepEqual(F.sortClients(F.applyFilters(clients, techUsd), techUsd, today)
  .map(c => [c.id, Math.round(F.groupDollars(c, "technology") / 100) / 10]),
  [[LEWIS, 108.6], [JOHNSON, 83.2], [WEAH, 60.5], [CARTER, 41.2]]);
assert.equal(F.withSectors(tech, []).sort, "next-milestone");
assert.equal(F.withSectors(techUsd, []).sort, "next-milestone");
assert.equal(F.withSectors(S({ sort: "name" }), ["energy"]).sort, "name");
// 16. AND across filters
assert.deepEqual(list({ wealth: ["200k-600k"], sectors: ["healthcare"] }), [CARTER]);
// 17. search + filters: shown vs hidden, with the reason
const f17 = S({ q: "col", wealth: ["600k-1m", "1m-2m"] });
assert.deepEqual(ids(F.applyFilters(clients, f17)), [LEWIS, WEAH]);
const hidden = clients.filter(c => hitIds("col").includes(c.id) && !ids(F.applyFilters(clients, f17)).includes(c.id));
assert.deepEqual(hidden.map(c => [c.id, F.whyHidden(c, f17)]), [[JOHNSON, ["not in $600K – $1M, $1M – $2M"]]]);
// counts ignore their own dropdown
assert.deepEqual(F.facetCounts(clients, S({ wealth: ["200k-600k"] })).wealth,
  { lt200k: 0, "200k-600k": 2, "600k-1m": 1, "1m-2m": 1, gte2m: 0 });
// 20. URL round trip; junk is dropped, never thrown
const st = S({ q: "sam", wealth: ["1m-2m", "600k-1m"], sectors: ["technology"], minExposure: 0.2, sort: "exposure-desc" });
assert.deepEqual(F.fromSearchParams(F.toSearchParams(st)), st);
assert.deepEqual(F.fromSearchParams(new URLSearchParams("wealth=foo,1m-2m,1m-2m&sector=crypto&minExp=13&sort=bad")), S({ wealth: ["1m-2m"] }));
assert.deepEqual(F.fromSearchParams(new URLSearchParams("minExp=0")), S({ minExposure: 0 }));
assert.equal(F.fromSearchParams(new URLSearchParams("sort=exposure-desc")).sort, "next-milestone"); // no sector, no exposure sort
// 21. default sort: next one-off milestone (yearly vacation skipped)
assert.deepEqual(F.sortClients(clients, F.DEFAULT_FILTERS, today).map(c => [c.id, F.nextMilestone(c, today)?.name]),
  [[CARTER, "Purchase a home"], [WEAH, "Purchase a vehicle"], [LEWIS, "College Ava"], [JOHNSON, "College Oliver"]]);
// 22. exposure tooltip numbers reconcile with the plan
const lewis = clients.find(c => c.id === LEWIS)!;
assert.equal((lewis.sectorWeights["Technology"] * 100).toFixed(1), "30.6");
assert.equal((lewis.sectorWeights["Communication Services"] * 100).toFixed(1), "7.7");
assert.equal((F.groupWeight(lewis, "technology") * 100).toFixed(1), "38.3");

// The book is exactly the four case families, none simulated.
assert.deepEqual(ids(clients), [JOHNSON, CARTER, LEWIS, WEAH]);
assert.ok(clients.every(c => !c.simulated && c.planUrl));

// Proposed messages (client page): tone follows the family's situation, and every draft is complete.
const { draftMessage } = await import("../src/lib/message.ts");
const plan = (id: string) => JSON.parse(readFileSync(`public/plans/${id}.json`, "utf8"));
const draft = (id: string) => draftMessage(plan(id), { today });
assert.equal(draft(CARTER).tone, "supportive");   // score 26, critical
assert.equal(draft(JOHNSON).tone, "supportive");  // score 52, vulnerable
assert.equal(draft(WEAH).tone, "steady");         // score 60, stable
assert.equal(draft(LEWIS).tone, "steady");        // score 82, but savings run out at 73: severe, so not celebratory
assert.match(draft(LEWIS).body, /run out at age 73/);
assert.match(draft(CARTER).body, /^Hi Michael,/);
assert.match(draft(JOHNSON).body, /^Hi Daniel and Emily,/);
assert.match(draft(CARTER).body, /home purchase in January 2027/);
for (const id of [JOHNSON, CARTER, LEWIS, WEAH]) {
  const d = draft(id);
  assert.ok(!/undefined|NaN|\$-/.test(d.subject + d.body), `${id}: broken value in draft`);
  assert.ok(d.firstStep, `${id}: no first step`);
  assert.match(d.body, /David$/);
}
// Topics chosen by the advisor replace the automatic pick.
assert.deepEqual(draftMessage(plan(CARTER), { today, issueKeys: ["umbrella"] }).usedIssues, ["umbrella"]);
assert.match(draftMessage(plan(CARTER), { today, issueKeys: ["umbrella"] }).body, /umbrella/);

console.log("ALL ASSERTS PASSED");
