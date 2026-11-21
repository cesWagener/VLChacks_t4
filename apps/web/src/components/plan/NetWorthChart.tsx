import { useId } from "react";

/** Net worth projection by age, with the retirement age marked (like the plan's "Your net worth projection"). */
export function NetWorthChart({ points, retirementAge, retireLabel }: {
  points: { age: number; netWorth: number }[];
  retirementAge: number;
  retireLabel: string;
}) {
  const gradId = useId();
  if (points.length < 2) return null;
  const W = 820, H = 280, L = 64, R = 16, T = 16, B = 32;
  const ages = points.map(p => p.age);
  const vals = points.map(p => p.netWorth);
  const minA = Math.min(...ages), maxA = Math.max(...ages);
  const step = niceStep(Math.max(...vals, 0) - Math.min(...vals, 0));
  const minV = Math.min(0, Math.floor(Math.min(...vals) / step) * step);
  const maxV = Math.max(step, Math.ceil(Math.max(...vals) / step) * step);
  const x = (a: number) => L + ((a - minA) / (maxA - minA)) * (W - L - R);
  const y = (v: number) => T + (1 - (v - minV) / (maxV - minV)) * (H - T - B);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.age).toFixed(1)},${y(p.netWorth).toFixed(1)}`).join(" ");
  const area = `${line} L${x(maxA)},${y(Math.max(minV, 0))} L${x(minA)},${y(Math.max(minV, 0))} Z`;
  const yTicks: number[] = [];
  for (let v = minV; v <= maxV + 1; v += step) yTicks.push(v);
  const xTicks: number[] = [];
  for (let a = Math.ceil(minA / 5) * 5; a <= maxA; a += 5) xTicks.push(a);
  const showRetire = retirementAge >= minA && retirementAge <= maxA;

  return (
    <svg className="nw-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Projected net worth from age ${minA} to ${maxA}`}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#3B5BDB" stopOpacity=".22" />
          <stop offset="100%" stopColor="#3B5BDB" stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map(v => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={v === 0 ? "#C9CEE0" : "#EEF0F6"} />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="nw-chart__tick">{compact(v)}</text>
        </g>
      ))}
      {xTicks.map(a => (
        <text key={a} x={x(a)} y={H - 10} textAnchor="middle" className="nw-chart__tick">{a}</text>
      ))}
      {showRetire && (
        <g>
          <line x1={x(retirementAge)} x2={x(retirementAge)} y1={T} y2={H - B} stroke="#5B6178" strokeDasharray="4 4" />
          <text x={x(retirementAge) + 6} y={T + 12} className="nw-chart__label">{retireLabel}</text>
        </g>
      )}
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke="#3B5BDB" strokeWidth="2.5" strokeLinejoin="round" />
    </svg>
  );
}

function niceStep(range: number) {
  const raw = Math.max(range, 1) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}
const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const compact = (v: number) => fmt.format(v);
