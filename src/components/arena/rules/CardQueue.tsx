import Link from "next/link";
import { CardImage } from "@/components/CardImage";
import { cardHref, HEALTH_TABS, type Queue } from "@/lib/arena/queue";
import type { QueueCard, RuleHealth } from "@/lib/arena/rules-store";

/**
 * The pieces of the Rules queue (design: "Rules queue — desktop" and "— phone"). Server
 * components: a row is a link, a tab is a link, nothing here holds state.
 *
 * The four healths differ by SHAPE as well as colour, so the list never relies on hue alone:
 * text only is a filled square, incomplete a half-filled circle, read-not-checked a ring and done
 * a filled circle.
 */

const LABEL: Record<RuleHealth, string> = {
  "text-only": "text only: the engine does nothing with it",
  incomplete: "incomplete: partly read, or reported wrong",
  unchecked: "read, not checked",
  done: "done: plays as written",
};

export function HealthDot({ health, size = "h-2.5 w-2.5" }: { health: RuleHealth; size?: string }) {
  const base = `${size} shrink-0 border-2`;
  const cls =
    health === "text-only"
      ? `${base} rounded-[2px] border-loss bg-loss`
      : health === "incomplete"
        ? `${base} rounded-full border-ki-500 bg-[linear-gradient(90deg,var(--color-ki-500)_50%,transparent_50%)]`
        : health === "unchecked"
          ? `${base} rounded-full border-dbs-blue`
          : `${base} rounded-full border-gain bg-gain`;
  return <span role="img" aria-label={LABEL[health]} title={LABEL[health]} className={cls} />;
}

/** The count pill beside a tab: the design system's status colours, a neutral one for "not checked". */
const PILL: Record<RuleHealth, string> = {
  "text-only": "ds-status-danger",
  incomplete: "ds-status-warning",
  unchecked: "bg-space-800 text-dbs-blue ring-1 ring-space-600",
  done: "ds-status-success",
};

export function HealthTabs({ health, counts, href }: { health: RuleHealth; counts: Record<RuleHealth, number>; href: (h: RuleHealth) => string }) {
  return (
    <nav aria-label="Health" className="flex overflow-x-auto border-b border-space-700/70 px-1 [scrollbar-width:thin]">
      {HEALTH_TABS.map((t) => (
        <Link
          key={t.key}
          href={href(t.key)}
          scroll={false}
          aria-current={health === t.key ? "page" : undefined}
          className={`tap flex shrink-0 items-center gap-2 whitespace-nowrap border-b-[3px] px-3 text-sm font-bold sm:px-4 ${health === t.key ? "border-ki-500 text-space-50" : "border-transparent text-space-400 hover:text-space-100"}`}
        >
          {t.label}
          <span className={`rounded-full px-2 text-xs font-bold tabular-nums ${PILL[t.key]}`}>{counts[t.key]}</span>
        </Link>
      ))}
    </nav>
  );
}

/** What the four shapes mean, once, above the list (desktop only: a phone reads them off the tab names). */
export function HealthLegend() {
  return (
    <ul className="hidden flex-wrap gap-x-5 gap-y-1 border-b border-space-700/70 px-5 py-2 text-xs text-space-400 sm:flex">
      {(Object.keys(LABEL) as RuleHealth[]).map((h) => (
        <li key={h} className="flex items-center gap-1.5">
          <HealthDot health={h} />
          {LABEL[h].charAt(0).toUpperCase() + LABEL[h].slice(1)}
        </li>
      ))}
    </ul>
  );
}

const facts = (c: QueueCard) => `${c.cardId} · ${c.cardType.toLowerCase().replace(/^\w/, (m) => m.toUpperCase())}${c.colors.length ? ` · ${c.colors.join("/")}` : ""}`;

/** One card of the queue: art, name, its dots, how many decks run it, why, and *Open ›*. */
export function QueueRow({ card, queue, decks }: { card: QueueCard; queue: Queue; decks: number }) {
  const reason = card.reasons[0] ?? "";
  return (
    <li>
      <Link
        href={cardHref(card.cardId, queue, card.ruleId)}
        data-queue-row
        className="grid min-h-16 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-t border-space-700/70 px-3 py-2.5 hover:bg-space-800/60 sm:grid-cols-[52px_minmax(0,1.6fr)_minmax(0,2fr)_auto] sm:gap-4 sm:px-5 sm:py-3"
      >
        <CardImage src={card.imageUrl} alt={card.name} sizes="52px" className="w-10 sm:w-[52px]" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-extrabold text-space-50 sm:text-[15px]">{card.name}</span>
          <span className="hidden truncate text-xs text-space-400 sm:block">{facts(card)}</span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            {card.skills.map((s, i) => (
              <HealthDot key={i} health={s.health} />
            ))}
            <span className="ml-1 text-xs text-space-400">{decks > 0 ? `in ${decks} deck${decks === 1 ? "" : "s"}` : "in no deck"}</span>
          </span>
          {reason && <span className="mt-0.5 block truncate text-xs text-space-400 sm:hidden">{reason}</span>}
        </span>
        <span className="hidden min-w-0 text-[13px] text-space-200 sm:block">{reason}</span>
        <span className="text-lg text-ki-300 sm:text-[13px] sm:font-bold" aria-hidden="true">
          <span className="sm:hidden">›</span>
          <span className="hidden sm:inline">Open ›</span>
        </span>
        <span className="sr-only">Open {card.name}</span>
      </Link>
    </li>
  );
}

/** "X of Y deck cards play as written", over a stacked bar of the four counts. */
export function SummaryBar({ counts, label }: { counts: Record<RuleHealth, number>; label: string }) {
  const total = counts["text-only"] + counts.incomplete + counts.unchecked + counts.done;
  const w = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <div className="space-y-2">
      <p className="text-sm sm:text-base">
        <b className="text-2xl font-black italic text-space-50">{counts.done}</b> <span className="font-bold">of {total} {label} play as written</span>
      </p>
      <div
        role="img"
        aria-label={`Text only ${counts["text-only"]}, incomplete ${counts.incomplete}, read not checked ${counts.unchecked}, done ${counts.done} of ${total}`}
        className="flex h-3 w-full overflow-hidden rounded-full border border-space-600 bg-space-800"
      >
        <span className="bg-loss" style={{ width: w(counts["text-only"]) }} />
        <span className="bg-ki-500" style={{ width: w(counts.incomplete) }} />
        <span className="bg-dbs-blue" style={{ width: w(counts.unchecked) }} />
        <span className="bg-gain" style={{ width: w(counts.done) }} />
      </div>
    </div>
  );
}

export const chipClass = (on: boolean) => `tap inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-ki-500 bg-ki-500/15 text-ki-300" : "border-space-600 text-space-300 hover:text-space-100"}`;
