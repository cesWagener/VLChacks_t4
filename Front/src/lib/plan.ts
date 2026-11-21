// plan.ts — the shape of one family's plan page data (public/plans/<id>.json), built by scripts/build-plans.ts
// from the case files in cases/<id>/. Everything here comes from the case data; nothing is simulated.

export type Band = "critical" | "vulnerable" | "stable" | "strong" | string;
export type Severity = "CRITICAL" | "SIGNIFICANT" | "MODERATE" | "MINOR";

export interface PlanPerson { firstName: string; role: "client" | "co-client" | "child"; age: number; retirementAge?: number; riskProfile?: string }
export interface MoneyLine { name: string; total: number; count?: number; items?: { name: string; total: number }[] }

export interface PlanData {
  id: string;
  displayName: string;
  adults: string[];                       // first names of client and co-client
  household: PlanPerson[];
  city: string; state: string;
  planUrl?: string;

  score: {
    value: number; band: Band; colour: "green" | "yellow" | "red"; message: string;
    pillars: { pillar: string; points: string }[];
    topMoves: { title: string; action: string; scoreBefore: number; scoreAfter: number }[];
  };

  goalsSummary: string[];                 // "Plan to purchase a home for $550,000 in 2027."
  goals: { name: string; type: string; subType?: string; date: string }[];

  narrative: Record<string, string>;      // financial-health.json → narrative (client-facing text, markdown-ish)
  investmentNarrative: Record<string, string>;

  metrics: {
    incomes: { owner: string; yearly: number }[];
    totalAssets: number; netWorth: number; investable: number;
    totalDebt: number; monthlyDebtPayment: number;
    assets: MoneyLine[]; liabilities: MoneyLine[];
    debtToIncome: number; housingRatio: number;
    cashflow: { inflow: number; outflows: MoneyLine[]; free: number };
    savings: { amount: number; ratio: number };
    employerMatchMaximized: boolean | null;
    emergency: { cash: number; monthlyExpenses: number; minMonths: number; maxMonths: number; minAmount: number; maxAmount: number; shortfall: number; excess: number };
    life: { people: { name: string; current: number; minRec: number; maxRec: number; shortfall: number }[] };
    umbrella: { has: boolean; amount: number; recommended: number };
    retirement: { retirementAge: number; endOfPlanAge: number; runOutAge: number | null; gap: number };
    creditCard: { name: string; balance: number; rate: number } | null;
    educationGap: number;
  };

  projections: { year: number; age: number; netWorth: number }[];

  persona: {
    concerns: { id: string; severity: Severity; title: string }[];
  };
}
