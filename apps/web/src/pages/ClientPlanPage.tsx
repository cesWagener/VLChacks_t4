import { useCallback, useEffect, useState, type MouseEvent } from "react";
import type { PlanData } from "../lib/plan.ts";
import { loadPlan } from "../lib/planSource.ts";
import { rememberOpened } from "../lib/openClient.ts";
import { CLIENTS_PATH, cameFromApp, navigate } from "../lib/router.ts";
import { AppHeader } from "../components/AppHeader.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ProposedMessage } from "../components/plan/ProposedMessage.tsx";
import { Prose } from "../components/plan/Prose.tsx";
import { NetWorthChart } from "../components/plan/NetWorthChart.tsx";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "missing" } | { status: "ready"; plan: PlanData };

const SECTIONS = [
  { id: "summary", label: "Summary" },
  { id: "retirement", label: "Retirement & Goals" },
  { id: "assets", label: "Assets & Investments" },
  { id: "debt", label: "Debt management" },
  { id: "savings", label: "Savings & Expenses" },
  { id: "protection", label: "Insurance & Protection" },
];

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usdK = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const money = (n: number) => usd0.format(Math.round(n));
const short = (n: number) => usdK.format(n);
const pct = (r: number) => `${Math.round(r * 100)}%`;

/** One family's page: the proposed message on top, then their plan laid out like the Sherpas shared plan. */
export function ClientPlanPage({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const fetchPlan = useCallback((fresh = false) => {
    setLoad({ status: "loading" });
    loadPlan(id, { fresh })
      .then(plan => setLoad(plan ? { status: "ready", plan } : { status: "missing" }))
      .catch((e: unknown) => setLoad({ status: "error", message: e instanceof Error ? e.message : String(e) }));
  }, [id]);
  useEffect(() => { fetchPlan(); rememberOpened(id); window.scrollTo(0, 0); }, [fetchPlan, id]);

  // Back returns to the filtered list exactly as it was (spec D6); a deep link falls back to /clients.
  const back = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    if (cameFromApp()) window.history.back();
    else navigate(CLIENTS_PATH);
  };

  return (
    <div className="page">
      <AppHeader />
      <main className="plan-page">
        <div className="plan-page__bar">
          <a className="back-link" href={CLIENTS_PATH} onClick={back}>← Clients</a>
          {load.status === "ready" && load.plan.planUrl && (
            <a className="link-external" href={load.plan.planUrl} target="_blank" rel="noopener noreferrer">Open the shared plan in Sherpas ↗</a>
          )}
        </div>

        {load.status === "loading" && <div className="plan-skeleton" aria-busy="true" aria-label="Loading plan" />}
        {load.status === "missing" && <EmptyState title="Client not found." />}
        {load.status === "error" && (
          <EmptyState tone="error" title="Couldn't load this plan." action={{ label: "Retry", onClick: () => fetchPlan(true) }}>{load.message}</EmptyState>
        )}
        {load.status === "ready" && <PlanBody plan={load.plan} />}
      </main>
    </div>
  );
}

function PlanBody({ plan }: { plan: PlanData }) {
  const active = useActiveSection();
  const n = plan.narrative;
  const m = plan.metrics;
  const adults = plan.household.filter(h => h.role !== "child");
  const income = m.incomes.length ? m.incomes.map(i => `${i.owner} ${short(i.yearly)}`).join(" · ") : "—";

  return (
    <>
      <h1 className="plan-page__title">{plan.displayName}</h1>
      <p className="plan-page__sub">
        {plan.household.map(h => `${h.firstName} (${h.age})`).join(" · ")} · {plan.city}, {plan.state}
      </p>

      <ProposedMessage plan={plan} />

      <div className="plan">
        <nav className="plan__nav" aria-label="Plan sections">
          <p className="plan__nav-title">Financial health</p>
          <ul>
            {SECTIONS.map(s => (
              <li key={s.id}>
                <a href={`#${s.id}`} aria-current={active === s.id ? "true" : undefined}>{s.label}</a>
              </li>
            ))}
          </ul>
          <p className="plan__nav-title"><a href="#investments" aria-current={active === "investments" ? "true" : undefined}>Investment analysis</a></p>
        </nav>

        <div className="plan__main">
          <section className="score-hero" data-colour={plan.score.colour}>
            <h2 className="score-hero__title">Financial Health Score: <span className="score-hero__value">{plan.score.value}</span></h2>
            <p className="score-hero__text">{plan.score.message}</p>
            <ul className="pillars">
              {plan.score.pillars.map(p => <li key={p.pillar}><span>{p.pillar}</span><strong>{p.points}</strong></li>)}
            </ul>
          </section>
          <p className="plan__disclaimer">Rules-based diagnostic from provided data and assumptions; may vary with inputs. Does not measure investment performance or predict outcomes.</p>

          <section id="summary" className="plan-section">
            <h2>Summary</h2>
            <div className="fact-cards">
              <FactCard icon="people" title="Household" lines={[adults.map(a => `${a.firstName} (${a.age})`).join(", ")]} />
              <FactCard icon="briefcase" title="Income" lines={[income]} />
              <FactCard icon="dollar" title="Net worth" lines={[`${short(m.netWorth)} total`, `${short(m.investable)} investable assets`]} />
              <FactCard icon="card" title="Debt" lines={m.totalDebt ? [`${short(m.totalDebt)} balance`, `${money(m.monthlyDebtPayment)} monthly payment`] : ["No debt"]} />
            </div>
            <Prose text={n.summary_main} />
            <div className="recommendations">
              <h3>Recommendations</h3>
              <Prose text={n.summary_recommendations} />
            </div>
          </section>

          <section id="retirement" className="plan-section">
            <h2>Retirement & Goals</h2>
            <ol className="goal-list">
              {plan.goalsSummary.map((g, i) => <li key={i}><span className="goal-list__n">{i + 1}</span>{g}</li>)}
            </ol>
            <div className="panel">
              <h3>Your net worth projection</h3>
              <div className="panel__stats">
                <Stat label="Current net worth" value={short(m.netWorth)} />
                <Stat label="Net worth at retirement" value={short(plan.projections.find(p => p.age === m.retirement.retirementAge)?.netWorth ?? 0)} />
                <Stat label="End of plan" value={short(plan.projections.at(-1)?.netWorth ?? 0)} />
              </div>
              <NetWorthChart
                points={plan.projections.map(p => ({ age: p.age, netWorth: p.netWorth }))}
                retirementAge={m.retirement.retirementAge}
                retireLabel={`${plan.adults[0]} retires`}
              />
              <p className="panel__note">One possible scenario based on our assumptions and your data. Actual results will differ as markets, inflation, taxes and your decisions change.</p>
            </div>
            <Prose text={n.retirement_short_observations} />
            <LookInto text={n.retirement_what_to_look_into} />
          </section>

          <section id="assets" className="plan-section">
            <h2>Assets & Investments</h2>
            <MoneyList title="Assets" total={m.totalAssets} lines={m.assets} />
            <Prose text={n.assets_short_observations} />
            <LookInto text={n.assets_what_to_look_into} />
          </section>

          <section id="debt" className="plan-section">
            <h2>Debt management</h2>
            <div className="ratio-tiles">
              <Stat label="Debt-to-income" value={pct(m.debtToIncome)} big />
              <Stat label="Housing ratio" value={pct(m.housingRatio)} big />
              <Stat label="Monthly payment" value={money(m.monthlyDebtPayment)} big />
            </div>
            <MoneyList title="Liabilities" total={m.totalDebt} lines={m.liabilities} />
            <Prose text={n.debt_short_observations} />
            <LookInto text={n.debt_what_to_look_into} />
          </section>

          <section id="savings" className="plan-section">
            <h2>Savings & Expenses</h2>
            <CashflowBars plan={plan} />
            <Prose text={n.savings_short_observations} />
            <LookInto text={n.savings_what_to_look_into} />
          </section>

          <section id="protection" className="plan-section">
            <h2>Insurance & Protection</h2>
            <Prose text={n.protection_intro} />
            <ProtectionCard
              title="Emergency fund"
              recommended={`${short(m.emergency.minAmount)} – ${short(m.emergency.maxAmount)}`}
              current={short(m.emergency.cash)}
              status={m.emergency.shortfall > 0 ? { label: "Not enough", tone: "bad" } : { label: "Covered", tone: "good" }}
              text={n.protection_emergency_fund_short_observations}
            />
            <ProtectionCard
              title="Life insurance"
              recommended={m.life.people.map(p => `${m.life.people.length > 1 ? `${p.name}: ` : ""}${short(p.minRec)} – ${short(p.maxRec)}`).join(" · ")}
              current={m.life.people.map(p => `${m.life.people.length > 1 ? `${p.name}: ` : ""}${short(p.current)}`).join(" · ")}
              status={m.life.people.some(p => p.shortfall > 0) ? { label: "Under insured", tone: "warn" } : { label: "Covered", tone: "good" }}
              text={n.protection_life_insurance_short_observations}
            />
            <ProtectionCard
              title="Umbrella insurance"
              recommended={short(m.umbrella.recommended)}
              current={m.umbrella.has ? short(m.umbrella.amount) : "$0"}
              status={m.umbrella.has ? { label: "Covered", tone: "good" } : { label: "No coverage", tone: "bad" }}
              text={n.protection_umbrella_short_observations}
            />
          </section>

          <section id="investments" className="plan-section">
            <h2>Investment analysis</h2>
            <Prose text={plan.investmentNarrative.summary_main} />
            {plan.investmentNarrative.portfolio_today_whats_working && (
              <>
                <h3 className="plan-section__h3">What's working</h3>
                <Prose text={plan.investmentNarrative.portfolio_today_whats_working} />
              </>
            )}
            {plan.investmentNarrative.recommendations_main && (
              <div className="recommendations">
                <h3>Recommendations</h3>
                <Prose text={plan.investmentNarrative.recommendations_main} />
              </div>
            )}
          </section>

          <footer className="plan__footer">
            <p><strong>Disclaimer.</strong> This analysis is for planning and informational purposes only. It is based on data provided by the client and assumptions selected by the advisor. Projections are hypothetical, do not reflect actual investment results, and are not guarantees of future performance.</p>
          </footer>
        </div>
      </div>
    </>
  );
}

/** Highlights the sidebar entry of the section in view. */
function useActiveSection() {
  const [active, setActive] = useState("summary");
  useEffect(() => {
    const ids = [...SECTIONS.map(s => s.id), "investments"];
    const els = ids.map(id => document.getElementById(id)).filter((e): e is HTMLElement => !!e);
    const obs = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id);
    }, { rootMargin: "-20% 0px -70% 0px" });
    els.forEach(e => obs.observe(e));
    return () => obs.disconnect();
  }, []);
  return active;
}

function LookInto({ text }: { text?: string }) {
  return text ? <div className="look-into"><Prose text={text} /></div> : null;
}

function Stat({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`stat ${big ? "stat--big" : ""}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
    </div>
  );
}

function MoneyList({ title, total, lines }: { title: string; total: number; lines: PlanData["metrics"]["assets"] }) {
  return (
    <div className="money-list">
      <div className="money-list__head"><span>{title}</span><strong>{money(total)}</strong></div>
      {lines.length === 0 ? <p className="money-list__empty">None</p> : (
        <ul>
          {lines.map(l => (
            <li key={l.name}>
              <span>{l.name}{l.count ? <span className="money-list__count">({l.count})</span> : null}</span>
              <span className="num">{money(l.total)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CashflowBars({ plan }: { plan: PlanData }) {
  const { inflow, outflows, free } = plan.metrics.cashflow;
  const rows = [
    ...outflows.map(o => ({ name: o.name.replace(/ Payments$/, "").replace(/Housing Expenses/, "Housing"), total: o.total })),
    ...(free < 0 ? [{ name: "Drawn from savings", total: free }] : free > 0 ? [{ name: "Left over", total: free }] : []),
  ];
  const max = Math.max(inflow, ...rows.map(r => Math.abs(r.total)));
  return (
    <div className="panel cashflow">
      <div className="cashflow__row cashflow__row--in">
        <span>Income</span>
        <span className="cashflow__bar"><span style={{ width: `${(inflow / max) * 100}%` }} /></span>
        <strong className="num">{short(inflow)}/yr</strong>
      </div>
      {rows.map(r => (
        <div key={r.name} className="cashflow__row" data-negative={r.total < 0 || undefined}>
          <span>{r.name}</span>
          <span className="cashflow__bar"><span style={{ width: `${(Math.abs(r.total) / max) * 100}%` }} /></span>
          <strong className="num">{r.total < 0 ? "-" : ""}{short(Math.abs(r.total))}/yr</strong>
        </div>
      ))}
    </div>
  );
}

function ProtectionCard({ title, recommended, current, status, text }: {
  title: string; recommended: string; current: string;
  status: { label: string; tone: "good" | "warn" | "bad" }; text?: string;
}) {
  return (
    <div className="protection-card">
      <div className="protection-card__head">
        <h3>{title}</h3>
        <span className={`status-tag status-tag--${status.tone}`}>{status.label}</span>
      </div>
      <div className="protection-card__nums">
        <Stat label="Recommended" value={recommended} />
        <Stat label="Current" value={current} />
      </div>
      <Prose text={text} />
    </div>
  );
}

function FactCard({ icon, title, lines }: { icon: "people" | "briefcase" | "dollar" | "card"; title: string; lines: string[] }) {
  return (
    <div className="fact-card">
      <Icon name={icon} />
      <p className="fact-card__title">{title}</p>
      {lines.map((l, i) => <p key={i} className="fact-card__line">{l}</p>)}
    </div>
  );
}

function Icon({ name }: { name: "people" | "briefcase" | "dollar" | "card" }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg className="fact-card__icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      {name === "people" && <><circle cx="9" cy="8" r="3.5" {...p} /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" {...p} /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2 .8 3 3 3 6" {...p} /></>}
      {name === "briefcase" && <><rect x="3" y="7" width="18" height="13" rx="2" {...p} /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18" {...p} /></>}
      {name === "dollar" && <><circle cx="12" cy="12" r="9" {...p} /><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.6-.6-3-1.6M12 6v12" {...p} /></>}
      {name === "card" && <><rect x="3" y="5" width="18" height="14" rx="2" {...p} /><path d="M3 10h18M7 15h4" {...p} /></>}
    </svg>
  );
}
