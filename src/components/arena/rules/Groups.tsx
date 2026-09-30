import Link from "next/link";
import { mechanismNeeds, PHRASING_ONLY } from "@/lib/arena/gaps";
import type { PatternGroup, RuleFilter } from "@/lib/arena/rules-store";
import { ConfirmAll } from "./ConfirmAll";

/**
 * The queue, grouped (`Group by` in #360): the same rules gathered by the
 * wording that produced them, the reason they are in the queue, or their set.
 *
 * Each group carries what is on file about it, a few rules to look at, one
 * Confirm for the group when it is a set of drafts worth confirming together,
 * and a link to the ungrouped list narrowed to exactly that group. Confirming
 * is aimed at the group's filter, never at the rows on screen.
 */
export interface GroupView {
  g: PatternGroup;
  /** The filter a Confirm presses; null when this group is not confirmed in bulk. */
  confirm: RuleFilter | null;
  /** The ungrouped queue narrowed to this group. */
  all: string;
}

export function Groups({ views, open, batches, note }: { views: GroupView[]; open: (ruleId: number) => string; batches: { id: number; note: string; n: number }[]; note?: string }) {
  const rules = views.reduce((n, v) => n + v.g.rules, 0);
  if (views.length === 0) return <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">Nothing here.</p>;
  return (
    <div className="space-y-2">
      <p className="text-xs text-space-400">
        {views.length} group{views.length === 1 ? "" : "s"} · {rules} rule{rules === 1 ? "" : "s"}
        {note ? ` · ${note}` : ""}
      </p>
      <ol className="space-y-2">
        {views.map((v) => (
          <Group key={`${v.g.kind}:${v.g.key}:${v.g.label}`} v={v} open={open} batches={batches} />
        ))}
      </ol>
    </div>
  );
}

function Group({ v, open, batches }: { v: GroupView; open: (ruleId: number) => string; batches: { id: number; note: string; n: number }[] }) {
  const { g } = v;
  return (
    <li className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <code className="break-words text-sm text-space-50">{g.label}</code>
        {g.mechanism && g.label !== `Unread: ${g.mechanism}` && <span className={`rounded-full px-2 py-0.5 text-[10px] ${g.mechanism === PHRASING_ONLY ? "bg-space-800 text-space-300" : "bg-ki-500/15 text-ki-300"}`}>{g.mechanism}</span>}
        <span className="ml-auto shrink-0 text-xs text-space-400">
          {g.rules} rule{g.rules === 1 ? "" : "s"} on {g.cards} card{g.cards === 1 ? "" : "s"}
          {g.timesSeen > 0 && <span className="text-ki-300"> · came up {g.timesSeen}×</span>}
        </span>
      </div>

      {g.mechanism && <p className="mt-1 text-[11px] text-space-400">→ {mechanismNeeds(g.mechanism)}</p>}

      {g.explanation && (
        <p className="mt-2 rounded border-l-2 border-gain bg-space-950/60 p-2 text-[11px] text-space-300">
          <span className="text-space-500">what it means, on file: </span>
          {g.explanation}
        </p>
      )}
      {g.brief && (
        <details className="mt-2 rounded-lg border border-space-700 bg-space-950/60">
          <summary className="cursor-pointer p-2 text-[11px] text-ki-300">the work item for teaching the compiler this wording</summary>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-2 font-mono text-[10px] leading-relaxed text-space-300">{g.brief}</pre>
        </details>
      )}

      <ul className="mt-2 space-y-1.5">
        {g.examples.map((e) => (
          <li key={e.id} className="rounded-lg bg-space-950/60 p-2 text-[11px]">
            <div className="flex flex-wrap items-baseline gap-1.5">
              <Link href={open(e.id)} className="font-medium text-space-100 hover:text-ki-300">
                {e.name}
              </Link>
              <span className="font-mono text-[10px] text-space-500">{e.cardId}</span>
            </div>
            <p className="mt-0.5 text-space-400">{e.printed.replace(/\s+/g, " ").slice(0, 200)}</p>
            <p className={e.unread.length ? "text-loss" : "text-space-300"}>
              <span className="text-space-500">{e.unread.length ? "could not read: " : "reads as: "}</span>
              {e.unread.length ? e.unread.join(" | ") : e.reads || "nothing"}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {v.confirm && <ConfirmAll filter={v.confirm} drafts={g.rules} label="Confirm the group" batches={batches} />}
        <Link href={v.all} className="text-[11px] text-space-400 hover:text-ki-300">
          {g.rules > g.examples.length ? `all ${g.rules} in the list →` : "these in the list →"}
        </Link>
      </div>
    </li>
  );
}
