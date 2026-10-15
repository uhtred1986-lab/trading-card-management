const COLOR_CLASS: Record<string, string> = {
  Red: "ds-color-red ring-dbs-red/40",
  Blue: "ds-color-blue ring-dbs-blue/40",
  Green: "ds-color-green ring-dbs-green/40",
  Yellow: "ds-color-yellow ring-dbs-yellow/40",
  Black: "ds-color-black ring-dbs-black/50",
  White: "ds-color-white ring-dbs-white/40",
  Colorless: "ds-badge-neutral ring-space-500",
};

export function ColorPill({ color, small = false }: { color: string; small?: boolean }) {
  const cls = COLOR_CLASS[color] ?? COLOR_CLASS.Colorless;
  return <span className={`inline-flex items-center rounded-full font-medium ring-1 ${cls} ${small ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-xs"}`}>{color}</span>;
}

export function RarityBadge({ code }: { code: string }) {
  return <span className="inline-flex items-center rounded bg-space-800 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-space-200 ring-1 ring-space-600">{code}</span>;
}

export function TypeBadge({ type }: { type: string }) {
  return <span className="inline-flex items-center rounded bg-space-800 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-space-300">{type}</span>;
}
