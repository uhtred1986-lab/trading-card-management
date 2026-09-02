const COLOR_CLASS: Record<string, string> = {
  Red: "bg-dbs-red/20 text-red-300 ring-dbs-red/40",
  Blue: "bg-dbs-blue/20 text-blue-300 ring-dbs-blue/40",
  Green: "bg-dbs-green/20 text-green-300 ring-dbs-green/40",
  Yellow: "bg-dbs-yellow/20 text-yellow-200 ring-dbs-yellow/40",
  Black: "bg-dbs-black/30 text-gray-200 ring-dbs-black/50",
  White: "bg-dbs-white/20 text-gray-100 ring-dbs-white/40",
  Colorless: "bg-space-700 text-space-200 ring-space-500",
};

export function ColorPill({ color, small = false }: { color: string; small?: boolean }) {
  const cls = COLOR_CLASS[color] ?? COLOR_CLASS.Colorless;
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ring-1 ${cls} ${
        small ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-xs"
      }`}
    >
      {color}
    </span>
  );
}

export function RarityBadge({ code }: { code: string }) {
  return (
    <span className="inline-flex items-center rounded bg-space-800 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-space-200 ring-1 ring-space-600">
      {code}
    </span>
  );
}

export function TypeBadge({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center rounded bg-space-800 px-1.5 py-px text-[10px] font-medium uppercase tracking-wide text-space-300">
      {type}
    </span>
  );
}
