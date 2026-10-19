import type { SnapshotRow } from "@/lib/arena/rules-progress";

/** Done cards over the days a snapshot was taken (one a day, written after the Rules page renders). */
export function Sparkline({ points }: { points: SnapshotRow[] }) {
  if (points.length < 2) return <p className="text-xs text-space-400">The trend appears after the second day of snapshots.</p>;
  const w = 240, h = 48;
  const max = Math.max(...points.map((p) => p.totalCards), 1);
  const xy = points.map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - (p.confirmedCards / max) * h).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <div className="flex flex-wrap items-center gap-3">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-48 max-w-full text-gain" role="img" aria-label={`Done cards over ${points.length} days`} preserveAspectRatio="none">
        <polyline points={xy} fill="none" stroke="currentColor" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span className="text-xs text-space-400">{points[0].date} to {last.date}: {points[0].confirmedCards} to {last.confirmedCards} done</span>
    </div>
  );
}
