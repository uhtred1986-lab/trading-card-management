import Link from "next/link";
import { count, eq } from "drizzle-orm";
import { db } from "@/db";
import { arenaFeedback } from "@/db/schema";
import { countRules, draftPatterns, openPatterns } from "@/lib/arena/rules-store";
import { getBacklogItemsWithGitHub, getIssueUrl, getRepoUrl } from "@/lib/github";
import { syncBacklogAction } from "../actions";

export const dynamic = "force-dynamic";

const EPIC = {
  title: "Legacy arena rules-engine programme",
  note: "Finish the rule-reading and workflow gaps on the legacy engine while the rules VM is built beside it.",
  githubIssueNumber: 177,
  githubUrl: getIssueUrl(177),
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
    githubIssueNumber: 107,
    githubUrl: getIssueUrl(107),
  },
  {
    title: "Wrongly-read wording audit",
    status: "Ready",
    note: "Hunt near-miss phrasings in compile.ts and filters.ts; prefer unread over wrongly read.",
    doc: "/docs/arena-next-session-prompt.md",
    href: "/arena/rules/patterns?half=open",
    cta: "open wording groups",
    parallel: true,
    githubIssueNumber: 93,
    githubUrl: getIssueUrl(93),
  },
  {
    title: "Known structural fixes",
    status: "Ready",
    note: "Side-scope follow-ups, condition OR handling, specified-cost reducers, and other named engine debts.",
    doc: "/docs/arena-next-stage-spec.md",
    href: "/arena/rules",
    cta: "deck worklist",
    parallel: true,
    githubIssueNumber: 94,
    githubUrl: getIssueUrl(94),
  },
  {
    title: "Markers and [Empower] board surfaces",
    status: "Queued",
    note: "Finish the card-movement and snapshot/UI pieces the engine already almost supports.",
    doc: "/docs/arena-markers-stage-scope.md",
    href: "/arena/feedback",
    cta: "reported issues",
    parallel: true,
    githubIssueNumber: 108,
    githubUrl: getIssueUrl(108),
  },
  {
    title: "Rules VM build-out",
    status: "Queued",
    note: "Continue the new rules language and ruleset path without changing the frozen legacy engine more than needed.",
    doc: "/docs/arena-rules-language.md",
    href: "/arena/rules/keywords",
    cta: "compiler glossary",
    parallel: true,
    githubIssueNumber: 170,
    githubUrl: getIssueUrl(170),
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

export default async function BacklogPage({
  searchParams,
}: {
  searchParams?: Promise<{ status?: string; stage?: string; q?: string }>;
}) {
  const sp = searchParams ? await searchParams : {};
  const filterStatus = sp.status || "all";
  const filterStage = sp.stage || "all";
  const searchQuery = (sp.q || "").toLowerCase().trim();

  const [counts, open, drafts, feedbackOpen, feedbackFixed, allBacklogItems] = await Promise.all([
    countRules(db),
    openPatterns(db),
    draftPatterns(db),
    feedbackCount("open"),
    feedbackCount("fixed"),
    getBacklogItemsWithGitHub(),
  ]);

  const closedBacklogCount = allBacklogItems.filter((i) => i.githubState === "closed" || i.status === "closed").length;
  const openBacklogCount = allBacklogItems.length - closedBacklogCount;

  // Filter items
  const filteredBacklogItems = allBacklogItems.filter((item) => {
    if (filterStatus === "open" && (item.githubState === "closed" || item.status === "closed")) return false;
    if (filterStatus === "closed" && !(item.githubState === "closed" || item.status === "closed")) return false;
    if (filterStage !== "all") {
      if (filterStage === "ui" && !item.file.startsWith("ui-")) return false;
      if (filterStage === "s2" && !item.file.startsWith("s2-")) return false;
      if (filterStage === "s3" && !item.file.startsWith("s3-")) return false;
      if (filterStage === "s4" && !item.file.startsWith("s4-")) return false;
      if (filterStage === "s5" && !item.file.startsWith("s5-")) return false;
      if (filterStage === "other" && (item.file.startsWith("ui-") || item.file.startsWith("s2-") || item.file.startsWith("s3-") || item.file.startsWith("s4-") || item.file.startsWith("s5-"))) return false;
    }
    if (searchQuery) {
      const matchText = `${item.id} ${item.title} ${item.milestone} ${item.stage} ${item.labels.join(" ")} ${item.githubIssueNumber ?? ""}`.toLowerCase();
      if (!matchText.includes(searchQuery)) return false;
    }
    return true;
  });

  const stats = [
    { label: "Open rules", value: counts.open, href: "/arena/rules?seg=open" },
    { label: "Draft rules", value: counts.draft, href: "/arena/rules?seg=draft" },
    { label: "Open wording groups", value: open.length, href: "/arena/rules/patterns?half=open" },
    { label: "Draft pattern groups", value: drafts.length, href: "/arena/rules/patterns" },
    { label: "Open feedback items", value: feedbackOpen, href: "/arena/feedback?status=open" },
    { label: "Fixed feedback items", value: feedbackFixed, href: "/arena/feedback?status=fixed" },
    {
      label: "GitHub Backlog Issues",
      value: `${openBacklogCount} open / ${allBacklogItems.length}`,
      href: `${getRepoUrl()}/issues`,
      external: true,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-space-50">Arena backlog</h1>
        <div className="ml-auto flex items-center gap-3">
          <a
            href={`${getRepoUrl()}/issues`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-space-300 hover:text-ki-300"
          >
            <svg className="h-3.5 w-3.5 fill-current" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <span>Repo Issues ↗</span>
          </a>
          <Link href="/arena" className="text-xs text-space-300 hover:text-ki-300">
            ← Arena
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[11px] uppercase tracking-widest text-space-400">Epic</p>
          <a
            href={EPIC.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-mono text-space-300 hover:text-ki-300"
          >
            GitHub #{EPIC.githubIssueNumber} ↗
          </a>
        </div>
        <h2 className="mt-1 text-base font-medium text-space-50">{EPIC.title}</h2>
        <p className="mt-1 text-sm text-space-300">{EPIC.note}</p>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {stats.map((s) => {
          if (s.external) {
            return (
              <a
                key={s.label}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-space-700/70 bg-space-900/50 p-3 hover:border-ki-500/60"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-widest text-space-400">{s.label}</p>
                  <span className="text-[10px] text-space-500">↗</span>
                </div>
                <p className="mt-1 text-xl font-semibold text-space-50">{s.value}</p>
              </a>
            );
          }
          return (
            <Link key={s.label} href={s.href} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3 hover:border-ki-500/60">
              <p className="text-[11px] uppercase tracking-widest text-space-400">{s.label}</p>
              <p className="mt-1 text-2xl font-semibold text-space-50">{s.value}</p>
            </Link>
          );
        })}
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

                {/* Stream GitHub Issue Link */}
                <a
                  href={item.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto inline-flex items-center gap-1 rounded bg-space-800 px-2 py-0.5 text-[11px] font-mono text-space-200 hover:text-ki-300 transition-colors border border-space-700/60"
                  title={`View GitHub Issue #${item.githubIssueNumber}`}
                >
                  <svg className="w-3 h-3 fill-current text-space-400" viewBox="0 0 24 24">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  <span>Issue #{item.githubIssueNumber}</span>
                  <span className="text-[9px] text-space-400">↗</span>
                </a>
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

      {/* Backlog Items from docs/arena-backlog/*.md with direct GitHub links */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-space-800 pb-2">
          <div>
            <h2 className="text-sm font-medium text-space-100">
              Tracked Backlog Items ({filteredBacklogItems.length} of {allBacklogItems.length})
            </h2>
            <p className="text-[11px] text-space-400">
              Synchronized from <code className="text-space-300">docs/arena-backlog/</code> and mapped to GitHub issues.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <form action={syncBacklogAction}>
              <button
                type="submit"
                className="tap rounded-md bg-space-800 px-2.5 py-1 text-[11px] text-space-200 hover:bg-space-700 hover:text-ki-300 transition-colors"
                title="Closes GitHub issues for all completed backlog items"
              >
                Sync completed to GitHub
              </button>
            </form>
          </div>
        </div>

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[11px] text-space-400">Status:</span>
          {[
            { key: "all", label: `All (${allBacklogItems.length})` },
            { key: "open", label: `Open (${openBacklogCount})` },
            { key: "closed", label: `Closed (${closedBacklogCount})` },
          ].map((t) => (
            <Link
              key={t.key}
              href={`/arena/backlog?status=${t.key}&stage=${filterStage}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`}
              className={`tap rounded-md px-2.5 py-1 ${filterStatus === t.key ? "bg-space-800 text-space-50" : "text-space-400 hover:text-space-200"}`}
            >
              {t.label}
            </Link>
          ))}

          <span className="ml-3 text-[11px] text-space-400">Stage:</span>
          {[
            { key: "all", label: "All" },
            { key: "ui", label: "UI" },
            { key: "s2", label: "Stage 2" },
            { key: "s3", label: "Stage 3" },
            { key: "s4", label: "Stage 4" },
            { key: "s5", label: "Stage 5" },
            { key: "other", label: "Other" },
          ].map((t) => (
            <Link
              key={t.key}
              href={`/arena/backlog?status=${filterStatus}&stage=${t.key}${searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : ""}`}
              className={`tap rounded-md px-2.5 py-1 ${filterStage === t.key ? "bg-space-800 text-space-50" : "text-space-400 hover:text-space-200"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>

        {/* List of backlog items */}
        {filteredBacklogItems.length === 0 ? (
          <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">
            No backlog items match the selected filters.
          </p>
        ) : (
          <ul className="space-y-2">
            {filteredBacklogItems.map((item) => {
              const isClosed = item.githubState === "closed" || item.status === "closed";
              return (
                <li key={item.file} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3 hover:border-space-600 transition-colors">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-mono text-[10px] text-space-500">{item.id}</span>
                    <h3 className="min-w-0 flex-1 text-sm font-medium text-space-100">{item.title}</h3>

                    {/* Status Badge */}
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        isClosed
                          ? "bg-gain/20 text-gain"
                          : item.status === "in progress" || item.status === "in-progress"
                          ? "bg-ki-500/20 text-ki-300"
                          : "bg-dbs-yellow/20 text-dbs-yellow"
                      }`}
                    >
                      {isClosed ? "closed" : item.status || "open"}
                    </span>

                    {/* Milestone badge */}
                    {item.milestone && (
                      <span className="shrink-0 rounded bg-space-800 px-1.5 py-0.5 text-[10px] text-space-400">
                        {item.milestone}
                      </span>
                    )}

                    {/* Direct GitHub Issue Link */}
                    {item.githubUrl ? (
                      <a
                        href={item.githubUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 inline-flex items-center gap-1.5 rounded bg-space-800/90 hover:bg-space-800 px-2 py-0.5 text-[11px] font-mono text-space-200 hover:text-ki-300 transition-colors border border-space-700/60"
                        title={`View GitHub Issue #${item.githubIssueNumber} (${item.githubState ?? "linked"})`}
                      >
                        <svg className="w-3 h-3 fill-current text-space-400" viewBox="0 0 24 24">
                          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                        </svg>
                        <span>Issue #{item.githubIssueNumber}</span>
                        <span className="text-[9px] text-space-400">↗</span>
                      </a>
                    ) : (
                      <span className="text-[10px] text-space-500">unlinked</span>
                    )}
                  </div>

                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-space-400">
                    <code className="text-space-400">{item.file}</code>
                    {item.stage && <span>stage: {item.stage}</span>}
                    {item.labels.length > 0 && (
                      <span className="text-space-500">
                        {item.labels.join(" · ")}
                      </span>
                    )}
                    {item.tracking && (
                      <span className="rounded bg-space-800/80 px-1 text-[10px] text-space-400">tracking doc</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
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

