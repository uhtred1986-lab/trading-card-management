import { STATUS_LABEL, type DeckStatus, type IssueSeverity } from "@/lib/decks/legality";

const STATUS_CLASS: Record<DeckStatus, string> = {
  legal: "bg-gain/15 text-gain ring-gain/30",
  incomplete: "bg-ki-500/15 text-ki-300 ring-ki-500/30",
  illegal: "bg-loss/15 text-loss ring-loss/30",
};

/** Legal / Incomplete / Illegal chip. Nothing is ever blocked — this only labels. */
export function DeckStatusBadge({ status, title, small = false }: { status: DeckStatus; title?: string; small?: boolean }) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded-full font-semibold uppercase tracking-wide ring-1 ${STATUS_CLASS[status]} ${small ? "px-1.5 py-px text-[10px]" : "px-2 py-0.5 text-[11px]"}`}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

const FLAG_CLASS: Record<IssueSeverity, string> = {
  illegal: "bg-loss/20 text-loss",
  incomplete: "bg-ki-500/20 text-ki-300",
  warning: "bg-dbs-yellow/20 text-yellow-200",
};

/** Why one card row is flagged ("5 copies, limit 4", "banned card", "off-colour…"). */
export function CardFlagBadge({ severity, label }: { severity: IssueSeverity; label: string }) {
  return <span className={`rounded px-1.5 py-px text-[10px] font-semibold ${FLAG_CLASS[severity]}`}>{label}</span>;
}
