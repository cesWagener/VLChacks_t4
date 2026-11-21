// build-index.ts — turns the case folders into the static index the app reads (spec Appendix C).
// Run from apps/web/: node --experimental-strip-types scripts/build-index.ts ../../cases > public/clients.index.json
// (or: npm run data)
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ClientSummary } from "../src/lib/filters.ts";

const PLAN_URLS: Record<string, string> = {
  "timothy-melanie-weah": "https://app.sherpaswealth.com/plan/shared/RcCtgoNkGmD6dvGtYVKWLGefdCTFdc4JP_jH9Jbz2jo",
  "michael-carter":       "https://app.sherpaswealth.com/plan/shared/ZshH0AUJjZnvwKIYtP5wYKyvI6Nc1nsGwQlDncXLfek",
  "daniel-emily-johnson": "https://app.sherpaswealth.com/plan/shared/FjVPq_UEwSMxaye8aOWj3osJWWSE3cDnYWcxm1X7I78",
  "samantha-lewis":       "https://app.sherpaswealth.com/plan/shared/vyV2h64-qSet-sJuwkAHxw-iUaYV88Lkwsg29L2Y5y8",
};
const SKIP_GOAL_TYPES = new Set(["BANKRUPTCY", "BANKRUPTCY_ZEROCASH"]); // projection markers, not life moments
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const casesDir = process.argv[2];
const out: ClientSummary[] = [];
for (const slug of readdirSync(casesDir).sort()) {
  if (!statSync(join(casesDir, slug)).isDirectory()) continue;
  const fh = JSON.parse(readFileSync(join(casesDir, slug, "financial-health.json"), "utf8"));
  const ia = JSON.parse(readFileSync(join(casesDir, slug, "investment-analysis.json"), "utf8"));
  const hh = fh.case.household as any[];
  const adults = hh.filter(m => m.role !== "child").map(m => m.first_name);
  const familyName = cap(slug.split("-").at(-1)!);
  const cd = ia.key_metrics.concentrationAndDiversification;
  const tickers = new Map<string, string>();
  for (const p of ia.positions) if (p.ticker) tickers.set(p.ticker, p.name);
  out.push({
    id: slug,
    displayName: `${adults.join(" & ")} ${familyName}`,
    familyName,
    members: hh.map(m => ({ firstName: m.first_name, role: m.role, age: m.age })),
    city: fh.case.city, state: fh.case.state,
    netWorth: fh.key_metrics.netWorthStatement.netWorth.total,
    investableAssets: fh.key_metrics.ratios.investableAssetLevel.investableAssets,
    equityExposure: cd.totals.equityExposure,
    score: { value: fh.score.published_score, band: fh.score.band, colour: fh.score.colour },
    sectorWeights: Object.fromEntries((cd.sectorConcentration as any[]).slice(1).map(r => [r[0], r[1]])),
    holdings: [...tickers].map(([ticker, name]) => ({ ticker, name })),
    goals: (fh.goals.chartGoals as any[])
      .filter(g => g.name && !SKIP_GOAL_TYPES.has(g.goalType))
      .map(g => ({ name: g.name, type: g.goalType, date: g.date })),
    planUrl: PLAN_URLS[slug],
    simulated: false,
  });
}
process.stdout.write(JSON.stringify(out, null, 2));
