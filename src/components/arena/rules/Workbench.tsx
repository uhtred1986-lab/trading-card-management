import Link from "next/link";
import { SKILL_LABELS } from "@/lib/arena/beats";
import type { RuleStatus, WorklistRow } from "@/lib/arena/rules-store";
import { ProbePane } from "./ProbePane";
import { RuleRecord, type RecordProps } from "./RuleRecord";

/**
 * The workbench's three columns: the worklist, the record, and what is known
 * about the rule beside it.
 *
 * The two worklists — the cards in your decks, and the whole catalog — differ
 * in what they select and in the chips above the list, never in what a row or
 * a record looks like, so `head` is the only thing a page hands in that the
 * other does not.
 */
const ORDER: Record<RuleStatus, number> = { open: 0, draft: 1, corrected: 2, confirmed: 3 };
const GROUP: Record<RuleStatus, string> = {
  open: "Open — the engine plays these as blank",
  draft: "Drafts — read by the compiler, not yet confirmed",
  corrected: "Corrected — a program you or Claude set",
  confirmed: "Confirmed",
};
const DOT: Record<RuleStatus, string> = { open: "bg-loss", draft: "bg-dbs-blue", confirmed: "bg-gain", corrected: "bg-ki-500" };

export const SEGMENTS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "draft", label: "Drafts" },
  { key: "confirmed", label: "Confirmed" },
  { key: "corrected", label: "Corrected" },
];

/** Open first — those are the ones the engine plays as blank — then drafts, corrections, confirmed. */
export const statusRank = (r: { status: string }) => ORDER[r.status as RuleStatus] ?? 9;

/** Ordered as the worklist shows them: by state, then by card. */
export function worklistOrder<T extends WorklistRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => statusRank(a) - statusRank(b) || a.name.localeCompare(b.name) || a.skillIndex - b.skillIndex);
}

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
}: {
  rows: WorklistRow[];
  /** The segments, chips and search box: the one thing the two worklists do not share. */
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
}) {
  // Group headings are decided before rendering, once per change of status.
  const items = rows.map((r, i) => ({ r, head: i === 0 || rows[i - 1].status !== r.status }));
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)_280px] lg:items-start">
      <aside className="rounded-xl border border-space-700/70 bg-space-900/50 lg:sticky lg:top-3 lg:max-h-[calc(100vh-6rem)] lg:overflow-auto">
        <div className="sticky top-0 z-10 space-y-2 border-b border-space-700/70 bg-space-900 p-3">{head}</div>
        <ol>
          {items.length === 0 && <li className="p-4 text-center text-xs text-space-400">{empty}</li>}
          {items.map(({ r, head: isHead }) => (
            <li key={r.id}>
              {isHead && <div className="px-3 pb-1 pt-3 text-[11px] font-semibold text-space-500">{GROUP[r.status as RuleStatus]}</div>}
              <Link
                href={href(r.id)}
                scroll={false}
                className={`grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-2 border-b border-space-800 px-3 py-2 hover:bg-space-800/60 ${record?.id === r.id ? "bg-space-800/80 shadow-[inset_3px_0_0_var(--color-ki-500)]" : ""}`}
              >
                <span className={`mt-1.5 h-2.5 w-2.5 rounded-full ${DOT[r.status as RuleStatus]}`} />
                <span className="min-w-0">
                  <span className="text-sm font-medium text-space-100">{r.name}</span>
                  <span className="ml-1.5 font-mono text-[10px] text-space-500">{r.cardId}</span>
                  <span className="block truncate text-[11px] text-space-400">{r.status === "open" ? `could not read: ${r.unread.join(" | ")}` : r.reads || "nothing"}</span>
                </span>
                <span className="text-[10px] text-space-500">[{SKILL_LABELS[r.kind] ?? r.kind}]</span>
              </Link>
            </li>
          ))}
        </ol>
        {footer}
      </aside>

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
    </div>
  );
}

/** The segment row, shared by both worklists. */
export function Segments({ seg, counts, href }: { seg: string; counts: Record<string, number>; href: (key: string) => string }) {
  return (
    <div className="flex rounded-lg bg-space-950 p-0.5 text-[11px] font-semibold">
      {SEGMENTS.map((s) => (
        <Link key={s.key} href={href(s.key)} className={`tap flex-1 rounded-md px-1 py-1 text-center ${seg === s.key ? "bg-space-800 text-space-50" : "text-space-400 hover:text-space-100"}`}>
          {s.label} <span className="text-space-500">{counts[s.key]}</span>
        </Link>
      ))}
    </div>
  );
}

export const chipClass = (on: boolean) => `tap rounded-full border px-2.5 py-0.5 text-[11px] ${on ? "border-ki-500 text-ki-300" : "border-space-600 text-space-300 hover:text-space-100"}`;
