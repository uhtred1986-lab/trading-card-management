import Link from "next/link";
import type { CardGroup, Queue } from "@/lib/arena/queue";
import type { RuleFilter } from "@/lib/arena/rules-store";
import { cardHref } from "@/lib/arena/queue";
import { ConfirmAll } from "./ConfirmAll";
import { QueueRow } from "./CardQueue";

/**
 * The queue, grouped (design: the rows under a header of title, count, note and an action). A
 * group is a set of CARDS: by why they are incomplete, by the wording their worst skill reads out
 * as, or by set. It shows its first few and links to the ungrouped list narrowed to exactly it.
 *
 * A *Same wording* group of unchecked cards carries "approve the group": aimed at the group's own
 * cards and its pattern, never at the rows on screen.
 */
export interface GroupView {
  g: CardGroup;
  /** The ungrouped queue narrowed to this group. */
  all: string;
  /** What "approve same wording" presses; null when this group is not approved in bulk. */
  confirm: RuleFilter | null;
}

const SHOWN = 6;

export function Groups({ views, queue, decksOf, batches }: { views: GroupView[]; queue: Queue; decksOf: (cardId: string) => number; batches: { id: number; note: string; n: number }[] }) {
  if (views.length === 0) return <p className="p-6 text-center text-sm text-space-300">Nothing here.</p>;
  return (
    <div>
      {views.map((v) => (
        <section key={v.g.key} aria-label={v.g.title}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-space-700/70 bg-space-800/50 px-3 py-3 sm:px-5">
            <h2 className="text-sm font-extrabold text-space-50">{v.g.title}</h2>
            <span className="ds-status-warning rounded-full px-2 text-xs font-bold tabular-nums">{v.g.cards.length}</span>
            {v.g.note && <span className="min-w-0 flex-1 text-xs text-space-400">{v.g.note}</span>}
            <span className="ml-auto flex flex-wrap items-center gap-3">
              {v.confirm && <ConfirmAll filter={v.confirm} drafts={v.g.cards.length} label="Approve the group" batches={batches} />}
              <Link href={cardHref(v.g.cards[0].cardId, queue, v.g.cards[0].ruleId)} className="tap flex items-center text-[13px] font-bold text-ki-300 hover:underline">
                Review one by one ›
              </Link>
            </span>
          </div>
          <ol>
            {v.g.cards.slice(0, SHOWN).map((c) => (
              <QueueRow key={c.cardId} card={c} queue={queue} decks={decksOf(c.cardId)} />
            ))}
          </ol>
          {v.g.cards.length > SHOWN && (
            <p className="border-t border-space-700/70 px-3 py-2 sm:px-5">
              <Link href={v.all} className="tap inline-flex items-center text-[13px] font-bold text-ki-300 hover:underline">
                Show all {v.g.cards.length} ›
              </Link>
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
