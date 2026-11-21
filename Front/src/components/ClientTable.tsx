import type { MouseEvent } from "react";
import { groupDollars, groupWeight, nextMilestone, type ClientSummary, type FilterState } from "../lib/filters.ts";
import {
  SECTOR_SHORT, bandLabelOf, groupBreakdown, membersLine, money, moneyExact, monthYear, pct, sectorLabel, topGroup,
} from "../lib/format.ts";
import { clientHref, rememberOpened } from "../lib/openClient.ts";
import { navigate } from "../lib/router.ts";
import { Tooltip } from "./Tooltip.tsx";

/** Results list (spec 5.5). The whole row is clickable; the family name is the real link. */
export function ClientTable({ clients, filters, today }: { clients: ClientSummary[]; filters: FilterState; today: Date }) {
  return (
    <table className="client-table">
      <thead>
        <tr>
          <th scope="col">Family</th>
          <th scope="col" className="col-location">Location</th>
          <th scope="col" className="num">Net worth</th>
          <th scope="col">Score</th>
          <th scope="col" className="num">Exposure</th>
          <th scope="col">Next milestone</th>
        </tr>
      </thead>
      <tbody>
        {clients.map(c => <ClientRow key={c.id} c={c} filters={filters} today={today} />)}
      </tbody>
    </table>
  );
}

function ClientRow({ c, filters, today }: { c: ClientSummary; filters: FilterState; today: Date }) {
  const href = clientHref(c);
  const milestone = nextMilestone(c, today);

  const onLinkClick = (e: MouseEvent<HTMLAnchorElement>) => {
    rememberOpened(c.id);
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser handle it
    e.preventDefault();
    navigate(href);
  };

  // Row click forwards to the link, unless the click was on the link or a tooltip trigger.
  const onRowClick = (e: MouseEvent<HTMLTableRowElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("a, .tooltip")) return;
    e.currentTarget.querySelector<HTMLAnchorElement>("a.client-link")?.click();
  };

  return (
    <tr className="client-row" onClick={onRowClick}>
      <td data-label="Family">
        <div className="cell-family">
          <a
            className="client-link"
            href={href}
            onClick={onLinkClick}
          >
            {c.displayName}
          </a>
          {c.simulated && <span className="badge-sim" title="Simulated family for the demo">SIM</span>}
        </div>
        <div className="cell-sub">{membersLine(c)}</div>
      </td>
      <td data-label="Location" className="col-location">{c.city}, {c.state}</td>
      <td data-label="Net worth" className="num">
        <Tooltip align="end" content={`Net worth ${moneyExact(c.netWorth)} · Investable ${moneyExact(c.investableAssets)}`}>
          <span className="cell-money">{money(c.netWorth)}</span>
          <span className="band-pill">{bandLabelOf(c)}</span>
        </Tooltip>
      </td>
      <td data-label="Score">
        <div className="cell-score">
          <span className={`score-dot score-dot--${c.score.colour}`} aria-hidden="true" />
          <span className="cell-score__value">{c.score.value}</span>
        </div>
        <div className="cell-sub">{c.score.band}</div>
      </td>
      <td data-label="Exposure" className="num"><ExposureCell c={c} filters={filters} /></td>
      <td data-label="Next milestone">
        {milestone ? (
          <>
            <div>{milestone.name}</div>
            <div className="cell-sub">{monthYear(milestone.date)}</div>
          </>
        ) : "—"}
      </td>
    </tr>
  );
}

function ExposureCell({ c, filters }: { c: ClientSummary; filters: FilterState }) {
  if (filters.sectors.length === 0) {
    const g = topGroup(c);
    return (
      <Tooltip align="end" content={<><strong>{sectorLabel(g)}</strong><br />{groupBreakdown(c, g)}</>}>
        <span className="cell-sub-inline">{SECTOR_SHORT[g]}</span> {pct(groupWeight(c, g))}
      </Tooltip>
    );
  }
  const share = filters.sectors.reduce((s, g) => s + groupWeight(c, g), 0);
  const dollars = filters.sectors.reduce((s, g) => s + groupDollars(c, g), 0);
  return (
    <Tooltip
      align="end"
      content={filters.sectors.map(g => (
        <div key={g}><strong>{sectorLabel(g)} {pct(groupWeight(c, g))}</strong><br />{groupBreakdown(c, g)}</div>
      ))}
    >
      <span className="cell-strong">{pct(share)}</span> · {money(dollars)}
    </Tooltip>
  );
}

export function SkeletonRows({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton__row">
          <span className="skeleton__bar skeleton__bar--wide" />
          <span className="skeleton__bar" />
          <span className="skeleton__bar" />
          <span className="skeleton__bar" />
        </div>
      ))}
    </div>
  );
}
