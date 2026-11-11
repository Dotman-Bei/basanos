import type { Rails } from "../lib/rails";
import { railPercent } from "../lib/rails";

const W = 600;
const H = 220;

export function RailsChart(props: { rails: Rails; points: readonly bigint[] }) {
  const { rails } = props;
  const lo = rails.dailyFloor < rails.trailingFloor ? rails.dailyFloor : rails.trailingFloor;
  const span = rails.target - lo > 0n ? rails.target - lo : 1n;
  const y = (v: bigint) => H - 20 - Number(((v - lo) * BigInt(H - 40)) / span);
  const line = (v: bigint, label: string) => (
    <g key={label}>
      <line x1={0} x2={W} y1={y(v)} y2={y(v)} stroke="currentColor" strokeOpacity={0.4} strokeDasharray="4 4" />
      <text x={4} y={y(v) - 4} fontSize={13}>
        {label}
      </text>
    </g>
  );
  const path = props.points
    .map((p, i) => `${i === 0 ? "M" : "L"}${(i * W) / Math.max(props.points.length - 1, 1)},${y(p)}`)
    .join(" ");
  return (
    <figure className="panel rails" aria-label="Equity against the rulebook rails">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {line(rails.target, `Target +${railPercent(rails.target, rails.start).toFixed(2)}%`)}
        {line(rails.dailyFloor, `Daily floor ${railPercent(rails.dailyFloor, rails.start).toFixed(2)}%`)}
        {line(rails.trailingFloor, `Trailing floor ${railPercent(rails.trailingFloor, rails.start).toFixed(2)}%`)}
        {path ? <path d={path} fill="none" stroke="var(--p-accent)" strokeWidth={2} /> : null}
      </svg>
    </figure>
  );
}
