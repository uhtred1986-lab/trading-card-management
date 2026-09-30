import Link from "next/link";
import { reasonOf } from "@/lib/arena/queue";
import type { RuleCounts, RuleStatus, WorklistRow } from "@/lib/arena/rules-store";
import { ProbePane } from "./ProbePane";
import { RuleRecord, type RecordProps } from "./RuleRecord";

/**
 * The workbench's three columns: the queue, the record, and what is known
 * about the rule beside it. There is one queue (#360): what it lists and how it
 * is grouped changes with the query, never what a row or a record looks like,
 * so `head` (the controls) is the only thing a page hands in besides the rows.
 * Grouped, the queue's rows give way to `grouped` and the record waits until a
 * row is opened from it.
 *
 * A row is a state glyph, the card, why it is in the queue and how many decks
 * play it. Opening it shows the record; that record's own layout is #361's.
 */
const STATE_LABEL: Record<RuleStatus, string> = { open: "Open", draft: "Draft", confirmed: "Confirmed", corrected: "Corrected" };
const STATE_ORDER: RuleStatus[] = ["open", "draft", "confirmed", "corrected"];

/**
 * Ring, half, filled: a state differs in shape as well as colour, so the list
 * never relies on hue alone (spec §3). A correction is filled, in its own hue.
 */
export function Glyph({ status }: { status: RuleStatus }) {
  const base = "mt-1 h-3 w-3 shrink-0 rounded-full border-2";
  const cls =
    status === "open"
      ? `${base} border-loss`
      : status === "draft"
        ? `${base} border-dbs-blue bg-[linear-gradient(90deg,var(--color-dbs-blue)_50%,transparent_50%)]`
        : status === "confirmed"
          ? `${base} border-gain bg-gain`
          : `${base} border-ki-500 bg-ki-500`;
  return <span role="img" aria-label={STATE_LABEL[status].toLowerCase()} className={cls} />;
}

export type QueueRow = WorklistRow & { decks: string[] };

export function Workbench({
  rows,
  head,
  href,
  record,
  history,
  mechanism,
  probe,
  empty,
  footer,
  grouped,
}: {
  rows: QueueRow[];
  /** The scope, state, group-by, search and confirm controls. */
  head: React.ReactNode;
  href: (ruleId: number) => string;
  record: RecordProps | null;
  history: { when: string; what: string }[];
  mechanism: { key: string; needs: string } | null;
  /** The boards this rule can be tried on; absent when the card has no catalog row to build one from. */
  probe: { ruleId: number; scenarios: { key: string; title: string }[] } | null;
  empty: React.ReactNode;
  /** Paging, under the list. */
  footer?: React.ReactNode;
  /** The groups, when the queue is grouped: they take the place of the rows and the record. */
  grouped?: React.ReactNode;
}) {
  return (
    <div className={`grid grid-cols-1 gap-3 ${grouped ? "lg:grid-cols-[300px_minmax(0,1fr)]" : "lg:grid-cols-[300px_minmax(0,1fr)_280px]"} lg:items-start`}>
      <aside className="rounded-xl border border-space-700/70 bg-space-900/50 lg:sticky lg:top-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto">
        <div className={`space-y-2 p-3 ${grouped ? "" : "sticky top-0 z-10 border-b border-space-700/70 bg-space-900"}`}>{head}</div>
        {!grouped && (
          <>
            <ol>
              {rows.length === 0 && <li className="p-4 text-center text-xs text-space-400">{empty}</li>}
              {rows.map((r) => {
                const reason = reasonOf(r);
                return (
                  <li key={r.id}>
                    <Link
                      href={href(r.id)}
                      scroll={false}
                      title={r.status === "open" ? `could not read: ${r.unread.join(" | ")}` : r.reads || "nothing"}
                      className={`grid grid-cols-[12px_minmax(0,1fr)_auto] items-start gap-2 border-b border-space-800 px-3 py-2 hover:bg-space-800/60 ${record?.id === r.id ? "bg-space-800/80 shadow-[inset_3px_0_0_var(--color-ki-500)]" : ""}`}
                    >
                      <Glyph status={r.status as RuleStatus} />
                      <span className="min-w-0">
                        <span className="text-sm font-medium text-space-100">{r.name}</span>
                        <span className="ml-1.5 font-mono text-[10px] text-space-500">{r.cardId}</span>
                        {reason && <span className="mt-0.5 block truncate text-[11px] text-space-400">{reason}</span>}
                      </span>
                      {r.decks.length > 0 && (
                        <span className="text-[10px] text-space-500" title={r.decks.join(", ")}>
                          {r.decks.length} deck{r.decks.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ol>
            {footer}
          </>
        )}
      </aside>

      {grouped ? (
        <main className="min-w-0">{grouped}</main>
      ) : (
        <>
          <main className="min-w-0">{record ? <RuleRecord key={record.id} {...record} /> : <p className="p-6 text-center text-sm text-space-400">Pick a rule on the left.</p>}</main>

          <aside className="space-y-3 lg:sticky lg:top-3">
            {probe && <ProbePane key={probe.ruleId} ruleId={probe.ruleId} scenarios={probe.scenarios} />}
            {mechanism && (
              <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
                <h2 className="text-xs font-semibold text-space-300">What it would need</h2>
                <p className="mt-1 text-sm text-space-100">{mechanism.key}</p>
                <p className="mt-1 text-[11px] text-space-400">{mechanism.needs}</p>
              </section>
            )}
            {history.length > 0 && (
              <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
                <h2 className="text-xs font-semibold text-space-300">History</h2>
                <ol className="mt-1 divide-y divide-space-800 text-[11px] text-space-400">
                  {history.map((h, i) => (
                    <li key={i} className="py-1.5">
                      <span className="font-mono text-space-500">{h.when}</span> — {h.what}
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </aside>
        </>
      )}
    </div>
  );
}

/** The state control: the four states with their counts, the one showing pressed. */
export function StateSegments({ state, counts, href }: { state: RuleStatus; counts: RuleCounts; href: (s: RuleStatus) => string }) {
  return (
    <div role="group" aria-label="State" className="flex rounded-lg bg-space-950 p-0.5 text-[11px] font-semibold">
      {STATE_ORDER.map((s) => (
        <Link key={s} href={href(s)} aria-current={state === s ? "true" : undefined} className={`tap flex-1 rounded-md px-1 py-1 text-center ${state === s ? "bg-space-800 text-space-50" : "text-space-400 hover:text-space-100"}`}>
          {STATE_LABEL[s]} <span className="text-space-500">{counts[s]}</span>
        </Link>
      ))}
    </div>
  );
}

/** A small labelled choice of links, for *Group by*. */
export function Choice<T extends string>({ label, value, options, href }: { label: string; value: T; options: { key: T; label: string }[]; href: (key: T) => string }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-1.5">
      <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-space-500">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {options.map((o) => (
          <Link key={o.key} href={href(o.key)} aria-current={value === o.key ? "true" : undefined} className={chipClass(value === o.key)}>
            {o.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export const chipClass = (on: boolean) => `tap rounded-full border px-2.5 py-0.5 text-[11px] ${on ? "border-ki-500 text-ki-300" : "border-space-600 text-space-300 hover:text-space-100"}`;
