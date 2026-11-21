// message.ts — drafts a personal message from the advisor to one family, from their plan data only.
// Rules, not a language model: every sentence traces back to a number in the case files, and the advisor
// edits and approves the draft before anything is sent (README problem 9). Nothing is sent from the app.
//
// Tone follows how the family is doing:
//   supportive   score band critical or vulnerable: acknowledge, normalise, one small step, no pressure
//   steady       stable band, or a severe issue under a good score: honest, calm, act early
//   celebratory  strong band and nothing severe: recognise progress, one small tidy-up
// Two more tones the advisor picks by hand (never automatic):
//   reassuring   for a market fall: calm, this is normal, the family's own past falls and recoveries, no action needed
//   brief        a short check-in, sized for a text message: one point and one question
import type { PlanData } from "./plan.ts";

export type Tone = "supportive" | "steady" | "celebratory" | "reassuring" | "brief";
export const TONES: { id: Tone; label: string }[] = [
  { id: "supportive", label: "Supportive" },
  { id: "steady", label: "Steady" },
  { id: "celebratory", label: "Celebratory" },
  { id: "reassuring", label: "Reassuring (market fall)" },
  { id: "brief", label: "Brief (text message)" },
];

export interface TalkingPoint {
  key: string;
  kind: "issue" | "strength";
  severity: 1 | 2 | 3;          // issues: 3 = severe, 2 = significant, 1 = minor
  text: string;                 // second person, lower-case start, no final full stop
  label: string;                // short name for the advisor's panel
  source: string;               // where the number comes from
  recommendationHint?: RegExp;  // picks the matching plan recommendation as the first step
}

export interface Draft {
  tone: Tone;
  autoTone: Tone;
  subject: string;
  body: string;
  issues: TalkingPoint[];       // all issues found, most severe first
  usedIssues: string[];         // keys used in the body
  strengths: TalkingPoint[];
  milestone: { label: string; date: string } | null;
  firstStep: string | null;
  advisorName: string;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const money = (n: number) => usd.format(Math.round(n));
const roundMoney = (n: number) => money(n >= 1_000 ? Math.round(n / 100) * 100 : n);
const pct = (r: number) => `${Math.round(r * 100)}%`;
const pct1 = (r: number) => `${(r * 100).toFixed(1).replace(/\.0$/, "")}%`;
const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const joinNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** Everything worth raising, most severe first. */
export function findIssues(p: PlanData): TalkingPoint[] {
  const m = p.metrics;
  const out: TalkingPoint[] = [];
  const kids = p.household.filter(h => h.role === "child").map(h => h.firstName);
  const couple = p.adults.length > 1;

  const r = m.retirement;
  if (r.runOutAge !== null && r.endOfPlanAge && r.runOutAge < r.endOfPlanAge) {
    const early = r.endOfPlanAge - r.runOutAge;
    out.push({
      key: "retirement", kind: "issue", severity: early >= 10 ? 3 : 2, label: `Savings run out at ${r.runOutAge}`,
      text: `your savings are projected to run out at age ${r.runOutAge}, ${early} years before the plan's horizon of ${r.endOfPlanAge}`,
      source: "financial-health.json · key_metrics.retirementAndOtherGoals.assetDepletion",
      recommendationHint: /retire/i,
    });
  }

  const e = m.emergency;
  const months = e.monthlyExpenses ? e.cash / e.monthlyExpenses : 0;
  if (e.shortfall > 0) {
    out.push({
      key: "cash", kind: "issue", severity: months < 2 ? 3 : 2, label: `Cash covers ${monthsText(months)}`,
      text: `your cash covers about ${monthsText(months)} of expenses, while we aim for ${e.minMonths} to ${e.maxMonths} months as a safety cushion`,
      source: "financial-health.json · key_metrics.protection.emergencyFund",
      recommendationHint: /cash|cushion|reserve|emergency/i,
    });
  }

  if (m.cashflow.free < 0) {
    out.push({
      key: "cashflow", kind: "issue", severity: 2, label: `Cash flow ${money(m.cashflow.free)}/yr`,
      text: `a little more goes out each year than comes in, about ${roundMoney(-m.cashflow.free)}, so your savings are quietly covering the difference`,
      source: "financial-health.json · key_metrics.cashflowStatement.freeCashflow",
      recommendationHint: /cash flow|budget|spending|shortfall/i,
    });
  }

  const lifeShort = m.life.people.filter(x => x.shortfall > 0);
  if (lifeShort.length) {
    const who = kids.length ? joinNames(kids) : couple ? "each other" : "the people and plans that rely on your income";
    out.push({
      key: "life", kind: "issue", severity: kids.length || couple ? 2 : 1, label: "Life cover below need",
      text: `your life insurance is well below what ${kids.length ? `${who} would need` : `would protect ${who}`} if an income stopped`,
      source: "financial-health.json · key_metrics.protection.lifeInsurance",
      recommendationHint: /life insurance|life cover|life,/i,
    });
  }

  if (m.educationGap > 0 && kids.length) {
    out.push({
      key: "college", kind: "issue", severity: 2, label: `College gap ${roundMoney(m.educationGap)}`,
      text: `college savings for ${joinNames(kids)} are about ${roundMoney(m.educationGap)} behind what the plan needs`,
      source: "financial-health.json · key_metrics.protection.emergencyFund.retirementAndEducationGaps",
      recommendationHint: /college|education|529/i,
    });
  }

  const cc = m.creditCard;
  if (cc && cc.rate >= 0.15) {
    out.push({
      key: "card", kind: "issue", severity: cc.balance >= 10_000 ? 2 : 1, label: `${pct(cc.rate)} card, ${roundMoney(cc.balance)}`,
      text: `the ${roundMoney(cc.balance)} balance on your card at ${(cc.rate * 100).toFixed(1).replace(/\.0$/, "")}% is your most expensive debt`,
      source: "financial-health.json · key_metrics.debtManagement.listOfDebts",
      recommendationHint: /card/i,
    });
  }

  if (!m.umbrella.has && m.umbrella.recommended > 0) {
    out.push({
      key: "umbrella", kind: "issue", severity: 1, label: "No umbrella cover",
      text: `you have no umbrella liability cover yet, so a single claim could reach the savings you're building`,
      source: "financial-health.json · key_metrics.protection.umbrellaInsurance",
      recommendationHint: /umbrella/i,
    });
  }

  return out.sort((a, b) => b.severity - a.severity);
}

/** What the family is already doing well, best first. */
export function findStrengths(p: PlanData): TalkingPoint[] {
  const m = p.metrics;
  const out: TalkingPoint[] = [];
  const e = m.emergency;
  const months = e.monthlyExpenses ? e.cash / e.monthlyExpenses : 0;

  if (m.savings.ratio >= 0.15) {
    out.push({
      key: "savings", kind: "strength", severity: 1, label: `Saves ${pct(m.savings.ratio)} of income`,
      text: `you put ${roundMoney(m.savings.amount)} a year into savings, ${pct(m.savings.ratio)} of your income${m.employerMatchMaximized ? ", and you capture your full employer match" : ""}`,
      source: "financial-health.json · key_metrics.ratios.savingsLevel",
    });
  }
  if (months > e.maxMonths && e.maxMonths > 0) {
    out.push({
      key: "cushion", kind: "strength", severity: 1, label: `${Math.round(months)} months of cash`,
      text: `you have a strong cash cushion, about ${Math.round(months)} months of expenses`,
      source: "financial-health.json · key_metrics.protection.emergencyFund",
    });
  }
  if (m.cashflow.free > 0) {
    out.push({
      key: "surplus", kind: "strength", severity: 1, label: `+${roundMoney(m.cashflow.free)}/yr cash flow`,
      text: `your budget has room to spare, about ${roundMoney(m.cashflow.free)} a year after everything is paid`,
      source: "financial-health.json · key_metrics.cashflowStatement.freeCashflow",
    });
  }
  if (m.totalDebt === 0) {
    out.push({
      key: "debt-free", kind: "strength", severity: 1, label: "Debt-free",
      text: "you are completely debt-free", source: "financial-health.json · key_metrics.netWorthStatement.liabilities",
    });
  }
  if (m.life.people.length && m.life.people.every(x => x.shortfall === 0 && x.current > 0)) {
    out.push({
      key: "protected", kind: "strength", severity: 1, label: "Life cover in place",
      text: "your family is well protected by your life insurance", source: "financial-health.json · key_metrics.protection.lifeInsurance",
    });
  }
  return out;
}

/** Next one-off life moment in the next three years (the yearly vacation is not a milestone). */
export function upcomingMilestone(p: PlanData, today: Date): Draft["milestone"] {
  const horizon = new Date(today); horizon.setFullYear(horizon.getFullYear() + 3);
  const g = p.goals
    .filter(x => x.type !== "VACATION" && new Date(x.date) >= today && new Date(x.date) <= horizon)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!g) return null;
  const label =
    g.type === "PURCHASE" && g.subType === "REAL_ESTATE_PURCHASE" ? "your home purchase"
    : g.type === "PURCHASE" && /vehicle/i.test(g.name) ? "your new car"
    : g.type === "COLLEGE" ? `${g.name.replace(/^College\s+/i, "")}'s first college bills`
    : g.type === "RETIREMENT" ? "your retirement"
    : lowerFirst(g.name);
  return { label, date: g.date };
}

export function autoTone(p: PlanData, issues: TalkingPoint[]): Tone {
  if (p.score.band === "critical" || p.score.band === "vulnerable") return "supportive";
  if (p.score.band === "stable" || issues.some(i => i.severity === 3)) return "steady";
  return "celebratory";
}

function recommendations(p: PlanData): string[] {
  return (p.narrative.summary_recommendations ?? "")
    .split("\n").map(l => l.replace(/^\s*[-*]\s*/, "").replace(/\*\*/g, "").trim()).filter(Boolean);
}

/** The first step: the plan's own recommendation that matches the main issue, else its first recommendation. */
function pickFirstStep(p: PlanData, main?: TalkingPoint): string | null {
  const recs = recommendations(p);
  const hit = main?.recommendationHint ? recs.find(r => main.recommendationHint!.test(r)) : undefined;
  const rec = hit ?? recs[0];
  return rec ? lowerFirst(rec.replace(/\.$/, "")) : null;
}

export interface DraftOptions { tone?: Tone; issueKeys?: string[]; advisorName?: string; today?: Date }

export function draftMessage(p: PlanData, opts: DraftOptions = {}): Draft {
  const today = opts.today ?? new Date();
  const advisorName = opts.advisorName ?? "David";
  const issues = findIssues(p);
  const strengths = findStrengths(p);
  const auto = autoTone(p, issues);
  const tone = opts.tone ?? auto;
  const picked = opts.issueKeys
    ? issues.filter(i => opts.issueKeys!.includes(i.key))
    : issues.slice(0, tone === "reassuring" ? 0 : tone === "celebratory" || tone === "brief" ? 1 : 2);
  const chosen = tone === "brief" ? picked.slice(0, 1) : picked; // a text message carries one point
  const milestone = upcomingMilestone(p, today);
  const firstStep = pickFirstStep(p, chosen[0]);
  const names = joinNames(p.adults);
  const [s1, s2] = strengths;
  const [i1] = chosen;
  const rest = chosen.slice(1);
  const severe = i1?.severity === 3;
  const when = milestone ? `${milestone.label} in ${monthYear(milestone.date)}` : "";

  const paras: string[] = [];
  let subject: string;

  if (tone === "supportive") {
    subject = "Your plan, one step at a time";
    paras.push("I've been going through your plan and wanted to reach out to you personally.");
    if (s1) paras.push(`First, something I want you to hear: ${s1.text}. That takes real discipline, and it gives us a solid base to work from.`);
    if (i1) {
      const issuesText = listJoin(chosen.map(i => i.text));
      paras.push(
        `I also want to be open with you about where things stand. Right now ${issuesText}. ` +
        `I know that can feel like a lot to take in. It isn't a sign that you've done something wrong: ` +
        `it's a question of which job each dollar does first, and that is exactly what we can work out together.`,
      );
    }
    if (milestone) paras.push(`With ${when}, now is a good moment to look at this calmly, before it arrives.`);
    if (firstStep) paras.push(`You don't have to solve everything at once. A first step I'd suggest: ${firstStep}.`);
    paras.push("Could we find 30 minutes in the next couple of weeks? You don't need to prepare anything. I'll bring the numbers and a couple of options, and we'll decide together what matters most to you.");
    paras.push(`Warmly,\n${advisorName}`);
  } else if (tone === "steady") {
    subject = severe ? "Something in your plan I want you to hear from me first" : "A quick check-in on your plan";
    paras.push("I was reviewing your plan this week and wanted to share where things stand.");
    if (s1) paras.push(`Overall you're in a good place: ${s1.text}.${s2 ? ` On top of that, ${s2.text}.` : ""}`);
    if (i1) {
      paras.push(
        severe
          ? `There is one thing I want you to hear from me first: ${i1.text}. I know that isn't easy to read, which is why I'd rather we look at it together now, while there is plenty of time to change course.`
          : `There is one thing I'd like us to look at together: ${i1.text}. Nothing here needs a rushed decision, but it is much easier to act early than late.`,
      );
    }
    if (rest.length) paras.push(`We should also keep an eye on ${rest.length > 1 ? "these" : "this"}: ${listJoin(rest.map(i => i.text))}.`);
    if (milestone) paras.push(`With ${when}, it's a good time to make sure everything lines up.`);
    if (firstStep) paras.push(`A first step I'd suggest: ${firstStep}.`);
    paras.push("Would you have 30 minutes in the coming weeks? I'll come prepared with options.");
    paras.push(`Best,\n${advisorName}`);
  } else if (tone === "reassuring") {
    // Problem 2 in the challenge: markets fall and families panic alone. Lead with calm, then their own numbers.
    const mk = p.market;
    subject = "Markets are moving: what it means for you";
    paras.push("With markets moving the way they have, I wanted to check in before the headlines do the talking.");
    paras.push("The short version: falls like this are normal, and your plan was built with them in mind.");
    if (mk) {
      const facts: string[] = [];
      if (mk.worstEvent) facts.push(`When the ${mk.worstEvent.title.replace(/\s+announced$/i, "")} were announced in ${monthYear(mk.worstEvent.date)}, your portfolio fell about ${pct1(-mk.worstEvent.drawdown)}.`);
      if (mk.maxDrawdown < 0) facts.push(`Its worst fall over the last three years was about ${pct1(-mk.maxDrawdown)}${mk.recoveryDays ? `, and it was back at its previous high within ${mk.recoveryDays} days` : ""}.`);
      if (mk.return3yAnnualized > 0) facts.push(`Over the same three years it grew about ${pct1(mk.return3yAnnualized)} a year.`);
      if (facts.length) paras.push(`Your own portfolio has been through this before. ${facts.join(" ")}`);
    }
    if (milestone) paras.push(`Money you need soon, like for ${milestone.label} in ${monthYear(milestone.date)}, shouldn't have to ride the market. If it would help, we can check together that it is set aside.`);
    if (i1) paras.push(`Separately from the markets, when we next talk I'd also like to look at this: ${listJoin(chosen.map(i => i.text))}.`);
    paras.push("There is nothing you need to do today. Selling after a fall usually turns a temporary dip into a permanent loss. If you would like to talk it through, I'm one call away.");
    paras.push(`Best,\n${advisorName}`);
  } else if (tone === "brief") {
    subject = "Quick check-in";
    const parts = ["I was looking at your plan today."];
    if (i1) parts.push(`One thing worth a quick chat: ${listJoin(chosen.map(i => i.text))}.`);
    else if (s1) parts.push(`Everything looks on track: ${s1.text}.`);
    parts.push(i1 ? "Do you have 15 minutes this week?" : "Anything new on your side I should know about?");
    paras.push(parts.join(" "));
    paras.push(advisorName);
  } else {
    subject = "Good news from your plan review";
    paras.push("Good news from your latest plan review, and I wanted you to hear it from me.");
    if (s1) paras.push(`${capFirst(s1.text)}.${s2 ? ` On top of that, ${s2.text}.` : ""} That is the result of steady decisions, and it shows.`);
    if (milestone) paras.push(`With ${when}, you're heading into it from a strong position.`);
    if (i1) paras.push(`${chosen.length > 1 ? "A few small things" : "One small thing"} worth tidying up when you have a moment: ${listJoin(chosen.map(i => i.text))}.${firstStep ? ` My suggestion: ${firstStep}.` : ""}`);
    paras.push("Happy to walk you through it whenever suits you. A short call is plenty.");
    paras.push(`All the best,\n${advisorName}`);
  }

  const body = [`Hi ${names},`, ...paras].join("\n\n");
  return { tone, autoTone: auto, subject, body, issues, usedIssues: chosen.map(i => i.key), strengths, milestone, firstStep, advisorName };
}

/** "a", "a, and b", "a, b, and c" — clauses already contain commas, so always use the serial comma. */
function listJoin(parts: string[]) {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")}, and ${parts.at(-1)}`;
}

function monthsText(m: number) {
  if (m < 1) return "less than a month";
  const r = Math.round(m * 2) / 2;
  return `${r % 1 ? r.toFixed(1) : r} month${r === 1 ? "" : "s"}`;
}
