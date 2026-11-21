// build-plans.ts — one JSON per family for the client plan page (/clients/:id).
// Run from apps/web/: node --experimental-strip-types scripts/build-plans.ts ../../cases public/plans   (or: npm run data)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MoneyLine, PlanData, Severity } from "../src/lib/plan.ts";

const PLAN_URLS: Record<string, string> = {
  "timothy-melanie-weah": "https://app.sherpaswealth.com/plan/shared/RcCtgoNkGmD6dvGtYVKWLGefdCTFdc4JP_jH9Jbz2jo",
  "michael-carter":       "https://app.sherpaswealth.com/plan/shared/ZshH0AUJjZnvwKIYtP5wYKyvI6Nc1nsGwQlDncXLfek",
  "daniel-emily-johnson": "https://app.sherpaswealth.com/plan/shared/FjVPq_UEwSMxaye8aOWj3osJWWSE3cDnYWcxm1X7I78",
  "samantha-lewis":       "https://app.sherpaswealth.com/plan/shared/vyV2h64-qSet-sJuwkAHxw-iUaYV88Lkwsg29L2Y5y8",
};
const SKIP_GOAL_TYPES = new Set(["BANKRUPTCY", "BANKRUPTCY_ZEROCASH"]);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Net-worth statement categories with a non-zero total, e.g. "Cash account (2) $27,000".
function lines(node: any): MoneyLine[] {
  return (node.items ?? [])
    .filter((c: any) => !c._isHidden && num(c.total) !== 0)
    .map((c: any) => ({ name: c.name, total: num(c.total), count: countLeaves(c) }));
}
function countLeaves(n: any): number {
  if (!n.items?.length) return 1;
  return n.items.reduce((s: number, x: any) => s + countLeaves(x), 0);
}

// persona.md concerns come in two styles: "**O1 SIGNIFICANT: Title.**" and "**O1: Title (SIGNIFICANT).**"
function parseConcerns(md: string): PlanData["persona"]["concerns"] {
  const out: PlanData["persona"]["concerns"] = [];
  const re = /- \*\*(O\d+)(?:\s+(CRITICAL|SIGNIFICANT|MODERATE|MINOR))?:\s*(.+?)(?:\s*\((CRITICAL|SIGNIFICANT|MODERATE|MINOR)\))?\.?\*\*/g;
  for (const m of md.matchAll(re)) {
    const severity = (m[2] ?? m[4]) as Severity | undefined;
    if (severity) out.push({ id: m[1], severity, title: m[3].replace(/\.$/, "") });
  }
  return out;
}

// How the family's own portfolio behaved in past market falls, for the "Reassuring" message tone.
function marketOf(pa: any): PlanData["market"] {
  const h = pa?.household;
  if (!h) return null;
  const events = ((pa.perEventDrawdowns ?? []) as any[])
    .filter(e => typeof e.household?.drawdownPct === "number")
    .sort((a, b) => a.household.drawdownPct - b.household.drawdownPct);
  const worst = events[0];
  return {
    return3yAnnualized: num(h.return3yAnnualized),
    maxDrawdown: num(h.maxDrawdown3y),
    recoveryDays: numOrNull(h.maxDrawdownRecoveryDays),
    worstEvent: worst ? {
      title: worst.eventTitle, date: worst.eventDate,
      drawdown: worst.household.drawdownPct, recoveryDays: numOrNull(worst.household.recoveryDays),
    } : null,
    topSector: pa.concentration?.topSectorName ?? "", topSectorPct: num(pa.concentration?.topSectorPct),
  };
}

const [casesDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

for (const slug of readdirSync(casesDir).sort()) {
  if (!statSync(join(casesDir, slug)).isDirectory()) continue;
  const fh = JSON.parse(readFileSync(join(casesDir, slug, "financial-health.json"), "utf8"));
  const ia = JSON.parse(readFileSync(join(casesDir, slug, "investment-analysis.json"), "utf8"));
  const persona = readFileSync(join(casesDir, slug, "persona.md"), "utf8");
  const km = fh.key_metrics;
  const hh = fh.case.household as any[];
  const adults = hh.filter(m => m.role !== "child").map(m => m.first_name as string);
  const familyName = cap(slug.split("-").at(-1)!);

  const ef = km.protection.emergencyFund;
  const efLevels = ef.recommendedEmergencyFundLevels;
  const efEval = ef.emergencyFundCoverageEvaluation;
  const lifeBasics = km.protection.lifeInsurance.lifeInsuranceCoverageBasics;
  const lifeRec = km.protection.lifeInsurance.lifeInsuranceCoverageRecommendations;
  const lifeGap = km.protection.lifeInsurance.lifeInsuranceCoverageGapsAndExcess;
  const umb = km.protection.umbrellaInsurance;
  const ret = km.retirementAndOtherGoals;
  const debts = (km.debtManagement.listOfDebts as any[]).slice(1);
  const cards = debts.filter(d => d[1] === "Credit card" && num(d[2]) > 0).sort((a, b) => num(b[3]) - num(a[3]));
  const matches = (km.assetsAndInvestments.matchGapAnalysis ?? []) as any[];

  const lifePeople = [
    { name: adults[0], current: num(lifeBasics.lifeInsuranceAmountClient), minRec: num(lifeRec.clientMinRecommendedCoverage), maxRec: num(lifeRec.clientMaxRecommendedCoverage), shortfall: num(lifeGap.clientShortfall) },
    ...(adults[1] ? [{ name: adults[1], current: num(lifeBasics.lifeInsuranceAmountCoClient), minRec: num(lifeRec.coClientMinRecommendedCoverage), maxRec: num(lifeRec.coClientMaxRecommendedCoverage), shortfall: num(lifeGap.coClientShortfall) }] : []),
  ];

  const plan: PlanData = {
    id: slug,
    displayName: `${adults.join(" & ")} ${familyName}`,
    adults,
    household: hh.map(m => ({ firstName: m.first_name, role: m.role, age: m.age, retirementAge: m.retirement_age, riskProfile: m.risk_profile })),
    city: fh.case.city, state: fh.case.state,
    planUrl: PLAN_URLS[slug],
    score: {
      value: fh.score.published_score, band: fh.score.band, colour: fh.score.colour, message: fh.score.message,
      pillars: (fh.score.pillars as any[]).map(p => ({ pillar: p.pillar, points: p.points_shown_in_app })),
      topMoves: (fh.score.top_moves as any[]).map(m => ({ title: m.title, action: m.action, scoreBefore: m.score_before, scoreAfter: m.score_after })),
    },
    goalsSummary: (fh.goals.goalsSummary as any[]).map(g => g.value),
    goals: (fh.goals.chartGoals as any[])
      .filter(g => g.name && !SKIP_GOAL_TYPES.has(g.goalType))
      .map(g => ({ name: g.name, type: g.goalType, subType: g.subType, date: g.date })),
    narrative: fh.narrative,
    investmentNarrative: ia.narrative,
    metrics: {
      incomes: (fh.profile.incomes as any[]).filter(i => i.type === "SALARY_AND_WAGES").map(i => ({ owner: (i.owner ?? []).join(" & "), yearly: num(i.yearly) })),
      totalAssets: num(km.netWorthStatement.assets.total),
      netWorth: num(km.netWorthStatement.netWorth.total),
      investable: num(km.ratios.investableAssetLevel.investableAssets),
      totalDebt: num(km.netWorthStatement.liabilities.total),
      monthlyDebtPayment: num(km.ratios.debtToIncome.monthlyDebtPayments),
      assets: lines(km.netWorthStatement.assets),
      liabilities: lines(km.netWorthStatement.liabilities),
      debtToIncome: num(km.ratios.debtToIncome.debtOnlyDti),
      housingRatio: num(km.ratios.housingRatio.ratio),
      cashflow: {
        inflow: num(km.cashflowStatement.inflows.total),
        outflows: (km.cashflowStatement.outflows.items as any[]).map(g => ({
          name: g.name, total: num(g.total),
          items: (g.items ?? []).map((x: any) => ({ name: x.name, total: num(x.total) })),
        })),
        free: num(km.cashflowStatement.freeCashflow.total),
      },
      savings: { amount: num(km.ratios.savingsLevel.savingAmount), ratio: num(km.ratios.savingsLevel.ratio) },
      employerMatchMaximized: matches.length ? matches.every(m => m.matchMaximizationStatus === "MAXIMIZED") : null,
      emergency: {
        cash: num(ef.cashAndExpensesOverview.cashReserves),
        monthlyExpenses: num(ef.cashAndExpensesOverview.monthlyExpenses),
        minMonths: num(efLevels.minimumMonthsRecommended), maxMonths: num(efLevels.maximumMonthsRecommended),
        minAmount: num(efLevels.minimumAmountRecommended), maxAmount: num(efLevels.maximumAmountRecommended),
        shortfall: num(efEval.emergencyFundShortfall), excess: num(efEval.emergencyFundExcess),
      },
      life: { people: lifePeople },
      umbrella: {
        has: Boolean(umb.umbrellaCoverage.hasUmbrellaPolicy),
        amount: num(umb.umbrellaCoverage.umbrellaCoverageAmount),
        recommended: num(umb.coverageRecommendationsAndAnalysis.umbrellaMinRecommendedCoverage),
      },
      retirement: {
        retirementAge: num(ret.clientProfile.clientRetirementAge),
        endOfPlanAge: num(ret.clientProfile.endOfPlanAge),
        runOutAge: numOrNull(ret.assetDepletion.ageWhenTheyRunOutOfLiquidAssets),
        gap: num(ef.retirementAndEducationGaps.retirementGap),
      },
      creditCard: cards[0] ? { name: cards[0][0], balance: num(cards[0][2]), rate: num(cards[0][3]) } : null,
      educationGap: num(ef.retirementAndEducationGaps.educationGap),
    },
    projections: (fh.projections.yearly as any[]).map(p => ({ year: p.year, age: p.age_client, netWorth: Math.round(num(p.net_worth)) })),
    market: marketOf(ia.key_metrics.performanceAnalysis),
    persona: { concerns: parseConcerns(persona) },
  };

  writeFileSync(join(outDir, `${slug}.json`), JSON.stringify(plan, null, 2));
  console.log(`${slug}: score ${plan.score.value} ${plan.score.band}, ${plan.persona.concerns.length} concerns`);
}
