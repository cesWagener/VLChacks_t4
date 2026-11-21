import { record } from './net.js';

type Part = 'financial-health' | 'investment-analysis' | 'persona' | 'signals' | 'legal-values';

export interface Locator {
  part: Part;
  section?: string;
}

interface Selection extends Locator {
  fields?: readonly string[];
}

function fields(part: Part, section: string, ...paths: string[]): Selection {
  return { part, section, fields: paths };
}

function financialProfile(...paths: string[]): Selection {
  return fields('financial-health', 'profile', ...paths);
}

const holdingPositions: Selection = { part: 'investment-analysis', section: 'positions' };
const planGoals: Selection = { part: 'financial-health', section: 'goals' };
const persona: Selection = { part: 'persona' };

export const topicDescriptions = {
  holdings: 'Recorded positions by ticker, account, fund or stock, and recorded dollar value.',
  allocation: 'Recorded asset allocations or comparison of current and target allocations in the plan.',
  portfolio_risk: 'Portfolio risk, concentration and the household risk preferences in the plan.',
  portfolio_performance: 'Plan-reported historical or back-tested performance and drawdowns.',
  liabilities: 'Recorded debts, interest rates and payments, including credit cards and mortgage.',
  assets: 'Recorded accounts, cash, assets, balances and account contributions.',
  income_expenses: 'Recorded income, salary and expenses.',
  insurance: 'Insurance policies and coverage in the plan.',
  goals: 'Goals recorded in the plan, including college or property.',
  retirement: 'Retirement goals, plan recommendations and year-by-year projections.',
  recommendations: 'Recommendations already written in the financial plan and its score moves.',
  persona: 'Recorded household preferences, risk tolerance, concerns and priorities.',
  historical_signals: 'Dated event examples already supplied in the case.',
  social_security_wage_base: 'Social Security wage bases by year in the case legal snapshot.',
  social_security_payroll_tax: 'Social Security payroll tax values in the case legal snapshot.',
  medicare_payroll_tax: 'Medicare payroll tax values in the case legal snapshot.',
  additional_medicare_tax: 'Additional Medicare tax values in the case legal snapshot.',
  standard_deduction: 'Federal standard deductions by year in the case legal snapshot.',
  federal_tax_brackets: 'Federal income tax brackets by year in the case legal snapshot.',
  child_tax_credit: 'Child tax credit values by year in the case legal snapshot.',
} as const;

export type Topic = keyof typeof topicDescriptions;

const selections: Record<Topic, readonly Selection[]> = {
  holdings: [holdingPositions],
  allocation: [fields('investment-analysis', 'analysis', 'summary.assetAllocation',
    'portfolioAnalysis.allocationSnapshot.allocation', 'targetAnalysis.allocationSnapshot.allocation')],
  portfolio_risk: [
    fields('investment-analysis', 'key_metrics', 'performanceAnalysis.window',
      'performanceAnalysis.household', 'performanceAnalysis.concentration',
      'targetAllocationInForce'),
    persona,
  ],
  portfolio_performance: [fields('investment-analysis', 'key_metrics',
    'performanceAnalysis.window', 'performanceAnalysis.household', 'performanceAnalysis.perEventDrawdowns',
    'performanceAnalysis.sameRiskBenchmark')],
  liabilities: [financialProfile('liabilities')],
  assets: [financialProfile('accounts', 'other_assets')],
  income_expenses: [financialProfile('incomes', 'expenses')],
  insurance: [financialProfile('insurance')],
  goals: [planGoals],
  retirement: [
    planGoals,
    fields('financial-health', 'narrative', 'summary_recommendations',
      'retirement_short_observations', 'retirement_what_to_look_into'),
    { part: 'financial-health', section: 'projections' },
  ],
  recommendations: [
    fields('financial-health', 'narrative', 'summary_recommendations'),
    fields('financial-health', 'score', 'published_score', 'top_moves'),
  ],
  persona: [persona],
  historical_signals: [{ part: 'signals', section: 'signals' }],
  social_security_wage_base: [{ part: 'legal-values', section: 'SSWageBaseByYear' }],
  social_security_payroll_tax: [{ part: 'legal-values', section: 'FICATaxSS' }],
  medicare_payroll_tax: [{ part: 'legal-values', section: 'FICATaxMedicare' }],
  additional_medicare_tax: [{ part: 'legal-values', section: 'FICATaxAdditionalMedicare' }],
  standard_deduction: [{ part: 'legal-values', section: 'StandardDeductionByYear' }],
  federal_tax_brackets: [{ part: 'legal-values', section: 'FederalIncomeTaxBracketsByYear' }],
  child_tax_credit: [{ part: 'legal-values', section: 'ChildTaxCreditByYear' }],
};

export interface Evidence {
  source: string;
  data: unknown;
}

export function locatorKey(locator: Locator): string {
  return locator.section ? locator.part + '.' + locator.section : locator.part;
}

export function selectLocators(topics: readonly Topic[]): Map<string, Selection> {
  const chosen = new Map<string, Selection>();
  for (const topic of topics) {
    for (const item of selections[topic]) {
      const key = locatorKey(item);
      const previous = chosen.get(key);
      if (!previous) {
        chosen.set(key, item);
      } else if (previous.fields && item.fields) {
        chosen.set(key, { ...item, fields: [...new Set([...previous.fields, ...item.fields])] });
      } else {
        chosen.set(key, { part: item.part, section: item.section });
      }
    }
  }
  return chosen;
}

export function project(value: unknown, selection: Selection): unknown {
  if (!selection.fields || value === null) return value;
  const chosen: Record<string, unknown> = {};
  for (const path of selection.fields) {
    let field: unknown = value;
    for (const key of path.split('.')) field = record(field)?.[key];
    if (field !== undefined && field !== null) chosen[path] = field;
  }
  return Object.keys(chosen).length ? chosen : null;
}
