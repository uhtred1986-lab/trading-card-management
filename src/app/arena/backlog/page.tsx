import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { arenaFeedback } from "@/db/schema";
import { countRules, draftPatterns, openPatterns } from "@/lib/arena/rules-store";

export const dynamic = "force-dynamic";

const EPIC = {
  title: "Legacy arena rules-engine programme",
  note: "Finish the rule-reading and workflow gaps on the legacy engine while the rules VM is built beside it.",
};

const STREAMS = [
  {
    title: "Move replacement",
    status: "In progress",
    note: "Let script-driven moves and KOs suspend for replacement choices, then replay identically.",
    doc: "/docs/arena-move-replacement-scope.md",
    href: "/arena/rules/patterns?half=open",
    cta: "replacement groups",
    parallel: false,
  },
  {
    title: "Wrongly-read wording audit",
    status: "Ready",
    note: "Hunt near-miss phrasings in compile.ts and filters.ts; prefer unread over wrongly read.",
    doc: "/docs/arena-next-session-prompt.md",
    href: "/arena/rules/patterns?half=open",
    cta: "open wording groups",
    parallel: true,
  },
  {
    title: "Known structural fixes",
    status: "Ready",
    note: "Side-scope follow-ups, condition OR handling, specified-cost reducers, and other named engine debts.",
    doc: "/docs/arena-next-stage-spec.md",
    href: "/arena/rules",
    cta: "deck worklist",
    parallel: true,
  },
  {
    title: "Markers and [Empower] board surfaces",
    status: "Queued",
    note: "Finish the card-movement and snapshot/UI pieces the engine already almost supports.",
    doc: "/docs/arena-markers-stage-scope.md",
    href: "/arena/feedback",
    cta: "reported issues",
    parallel: true,
  },
  {
    title: "Rules VM build-out",
    status: "Queued",
    note: "Continue the new rules language and ruleset path without changing the frozen legacy engine more than needed.",
    doc: "/docs/arena-ruleset-spec.md",
    href: "/arena/rules/keywords",
    cta: "compiler glossary",
    parallel: true,
  },
];

const TRACKERS = [
  {
    title: "Deck worklist",
    href: "/arena/rules",
    note: "Cards in arena-playable decks, with rule state and probes.",
  },
  {
    title: "Patterns",
    href: "/arena/rules/patterns?half=open",
    note: "Unread wording groups and drafted readings, by pattern.",
  },
  {
    title: "Feedback",
    href: "/arena/feedback",
    note: "Bugs and card/rule notes filed from the arena.",
  },
];

async function feedbackCount(status: "open" | "fixed") {
  const [row] = await db.select({ n: count() }).from(arenaFeedback).where(eq(arenaFeedback.status, status));
  return row?.n ?? 0;
}

export default async function BacklogPage() {
  const [counts, open, drafts, feedbackOpen, feedbackFixed] = await Promise.all([countRules(db), openPatterns(db), draftPatterns(db), feedbackCount("open"), feedbackCount("fixed")]);
  const stats = [
    { label: "Open rules", value: counts.open, href: "/arena/rules?seg=open" },
    { label: "Draft rules", value: counts.draft, href: "/arena/rules?seg=draft" },
    { label: "Open wording groups", value: open.length, href: "/arena/rules/patterns?half=open" },
    { label: "Draft pattern groups", value: drafts.length, href: "/arena/rules/patterns" },
    { label: "Open feedback items", value: feedbackOpen, href: "/arena/feedback?status=open" },
    { label: "Fixed feedback items", value: feedbackFixed, href: "/arena/feedback?status=fixed" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-space-50">Arena backlog</h1>
        <Link href="/arena" className="ml-auto text-xs text-space-300 hover:text-ki-300">
          ← Arena
        </Link>
      </div>

      <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
        <p className="text-[11px] uppercase tracking-widest text-space-400">Epic</p>
        <h2 className="mt-1 text-base font-medium text-space-50">{EPIC.title}</h2>
        <p className="mt-1 text-sm text-space-300">{EPIC.note}</p>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3 hover:border-ki-500/60">
            <p className="text-[11px] uppercase tracking-widest text-space-400">{s.label}</p>
            <p className="mt-1 text-2xl font-semibold text-space-50">{s.value}</p>
          </Link>
        ))}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <h2 className="text-sm font-medium text-space-100">Feature streams</h2>
          <span className="text-[11px] text-space-400">Parallel-safe streams are marked ready to split into their own checkout.</span>
        </div>
        <ol className="space-y-2">
          {STREAMS.map((item) => (
            <li key={item.title} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <h3 className="text-sm font-medium text-space-50">{item.title}</h3>
                <span className={`rounded px-1.5 py-0.5 text-[10px] ${item.status === "In progress" ? "bg-ki-500/15 text-ki-300" : item.status === "Ready" ? "bg-dbs-yellow/20 text-dbs-yellow" : "bg-space-800 text-space-300"}`}>
                  {item.status}
                </span>
                {item.parallel && <span className="rounded bg-gain/15 px-1.5 py-0.5 text-[10px] text-gain">parallel</span>}
              </div>
              <p className="mt-1 text-sm text-space-300">{item.note}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
                <Link href={item.href} className="text-ki-300 hover:underline">
                  {item.cta} →
                </Link>
                <code className="text-space-400">{item.doc}</code>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-space-100">Tracking surfaces</h2>
        <ul className="space-y-2">
          {TRACKERS.map((item) => (
            <li key={item.title} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <Link href={item.href} className="text-sm font-medium text-space-50 hover:text-ki-300">
                  {item.title}
                </Link>
              </div>
              <p className="mt-1 text-sm text-space-300">{item.note}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
