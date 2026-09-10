import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { arenaFeedback, arenaGames, cards as cardsTable } from "@/db/schema";
import { listRemoteIssues, getFeedbackGitHubLink } from "@/lib/github";
import { setFeedbackStatus, syncFeedbackToGitHubAction, syncAllFeedbackAction } from "../actions";

export const dynamic = "force-dynamic";

const KINDS: Record<string, { label: string; hint: string }> = {
  bug: { label: "went wrong in a game", hint: "reported from the board" },
  card: { label: "a card explained", hint: "from the backlog, in your own words" },
  rule: { label: "a rule you set", hint: "from the rules page" },
};

/**
 * Everything you told the arena, from whichever page you said it on.
 *
 * One list, because there is one question worth asking of it: what has been
 * said that the automatic measurements cannot see? A coverage run knows which
 * clauses the compiler failed to read; it cannot know that a card charged the
 * energy anyway, or that a wording means something other than it appears to.
 */
export default async function FeedbackPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const want = (Array.isArray(sp.status) ? sp.status[0] : sp.status) ?? "open";
  const status = want === "all" ? null : want === "fixed" ? "fixed" : "open";

  const [rows, remoteIssues] = await Promise.all([
    db
      .select()
      .from(arenaFeedback)
      .where(status ? eq(arenaFeedback.status, status) : undefined)
      .orderBy(desc(arenaFeedback.createdAt))
      .limit(100),
    listRemoteIssues(),
  ]);

  const existingIssuesCount = rows.filter((r) => Boolean(getFeedbackGitHubLink(r, remoteIssues).isExisting)).length;

  // Which of these games are still being played. A bug filed mid-game copies
  // the position in, and the log and the move list below name cards from
  // whichever hand the engine was asking — so in a 1 v 1 a live report would
  // be a way of reading your opponent's hand off this page. They open once the
  // game is over, which is when they are wanted anyway.
  const gameIds = [...new Set(rows.map((r) => r.gameId).filter((x): x is number => !!x))];
  const live = new Set<number>();
  if (gameIds.length)
    for (const g of await db.select({ id: arenaGames.id, status: arenaGames.status }).from(arenaGames).where(inArray(arenaGames.id, gameIds))) if (g.status === "playing") live.add(g.id);

  const ids = [...new Set(rows.map((r) => r.cardId).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) for (const c of await db.select({ id: cardsTable.id, name: cardsTable.name }).from(cardsTable).where(inArray(cardsTable.id, ids))) names.set(c.id, c.name);

  const tab = (key: string, label: string) => (
    <Link key={key} href={`/arena/feedback?status=${key}`} className={`tap rounded-md px-3 py-1.5 ${want === key ? "bg-space-800 text-space-50" : "text-space-300"}`}>
      {label}
    </Link>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h1 className="text-lg font-semibold tracking-tight text-space-50">What you told me</h1>
        <Link href="/arena" className="ml-auto text-xs text-space-300 hover:text-ki-300">
          ← Arena
        </Link>
      </div>
      <p className="text-sm text-space-300">
        Everything said from inside the arena, in one place: bugs reported from the board, cards explained on the backlog, and rules set by hand. Either player in a 1 v 1 can file one, and it says who
        did. A bug carries the whole game with it — the state, every move made, and what was on offer — so it can be replayed exactly as it was seen.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {tab("open", "Open")}
        {tab("fixed", "Fixed")}
        {tab("all", "All")}

        <div className="ml-auto flex items-center gap-2">
          <a
            href="https://github.com/uhtred1986-lab/trading-card-management/issues?q=is%3Aissue+%22%5BFeedback%22"
            target="_blank"
            rel="noopener noreferrer"
            className="tap inline-flex items-center gap-1.5 rounded-md border border-space-700/60 bg-space-900/60 px-2.5 py-1 text-[11px] text-space-300 hover:text-ki-300 hover:border-ki-500/40"
          >
            <svg className="h-3 w-3 fill-current" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
            <span>GitHub Issues ({existingIssuesCount}/{rows.length})</span>
            <span className="text-[9px] text-space-500">↗</span>
          </a>
          <form action={syncAllFeedbackAction}>
            <button
              type="submit"
              className="tap rounded-md bg-space-800 px-2.5 py-1 text-[11px] text-space-200 hover:bg-space-700 hover:text-ki-300 transition-colors"
            >
              Sync all to GitHub
            </button>
          </form>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">Nothing here. That is the good outcome.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => {
            const ghLink = getFeedbackGitHubLink(r, remoteIssues);
            return (
              <li key={r.id} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[10px] text-space-500">#{r.id}</span>
                  <p className="min-w-0 flex-1 text-sm text-space-100">{r.note}</p>
                  <span className="shrink-0 rounded bg-space-800 px-1.5 py-0.5 text-[10px] text-space-300">{KINDS[r.kind]?.label ?? r.kind}</span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${r.status === "open" ? "bg-dbs-yellow/20 text-dbs-yellow" : "bg-gain/20 text-gain"}`}>{r.status}</span>

                  {/* GitHub Issue Link */}
                  {ghLink.isExisting ? (
                    <a
                      href={ghLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1.5 rounded bg-space-800/90 hover:bg-space-800 px-2 py-0.5 text-[11px] font-mono text-space-200 hover:text-ki-300 transition-colors border border-space-700/60"
                      title={`GitHub Issue #${ghLink.issueNumber} (${ghLink.state})`}
                    >
                      <svg className="w-3 h-3 fill-current text-space-400" viewBox="0 0 24 24">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                      </svg>
                      <span>#{ghLink.issueNumber}</span>
                      <span className="text-[9px] text-space-400">↗</span>
                    </a>
                  ) : (
                    <a
                      href={ghLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 rounded bg-space-800/40 hover:bg-space-800 px-1.5 py-0.5 text-[10px] text-space-400 hover:text-ki-300 transition-colors border border-space-700/40"
                      title="Open prefilled issue on GitHub"
                    >
                      <svg className="w-2.5 h-2.5 fill-current opacity-70" viewBox="0 0 24 24">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                      </svg>
                      <span>Track on GitHub ↗</span>
                    </a>
                  )}
                </div>

                <p className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-space-400">
                  {r.cardId && (
                    <Link href={`/cards/${encodeURIComponent(r.cardId)}`} className="text-space-200 hover:text-ki-300">
                      {names.get(r.cardId) ?? r.cardId}
                    </Link>
                  )}
                  {r.gameId && (
                    <Link href={`/arena/${r.gameId}`} className="hover:text-ki-300">
                      game {r.gameId}
                    </Link>
                  )}
                  {r.kind === "bug" ? (
                    <>
                      <span>
                        turn {r.turn}
                        {r.phase ? `, ${r.phase}` : ""}
                      </span>
                      {r.prompt && <span>waiting on: {r.prompt}</span>}
                    </>
                  ) : (
                    <span>{KINDS[r.kind]?.hint}</span>
                  )}
                  {r.reportedBy && <span className="text-space-200">{r.reportedBy}</span>}
                  <span>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                </p>

                {r.resolution && (
                  <p className="mt-1 border-l-2 border-gain pl-2 text-[11px] text-space-300">
                    <span className="text-space-400">{r.kind === "bug" ? "Fixed: " : "Read as: "}</span>
                    {r.resolution}
                  </p>
                )}

                {r.kind === "bug" && r.gameId && live.has(r.gameId) && (
                  <p className="mt-2 text-[11px] text-space-500">The game is still being played — the log and what was on offer open when it ends.</p>
                )}

                {r.kind === "bug" && !(r.gameId && live.has(r.gameId)) && (
                  <details className="mt-2 text-[11px]">
                    <summary className="cursor-pointer text-space-400">the log, and what was on offer</summary>
                    <ol className="mt-1 space-y-0.5 font-mono text-[10px] text-space-400">
                      {((r.log as string[]) ?? []).slice(-14).map((line, i) => (
                        <li key={i} className={line.startsWith("—") ? "mt-1 text-space-200" : ""}>
                          {line}
                        </li>
                      ))}
                    </ol>
                    <p className="mt-1 text-space-500">On offer: {((r.legal as string[]) ?? []).join(" · ") || "nothing"}</p>
                  </details>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px]">
                  <form action={setFeedbackStatus.bind(null, r.id, r.status === "open" ? "fixed" : "open")}>
                    <button type="submit" className="tap text-space-400 hover:text-ki-300">
                      {r.status === "open" ? "mark fixed" : "reopen"}
                    </button>
                  </form>
                  {!ghLink.isExisting && (
                    <form action={syncFeedbackToGitHubAction.bind(null, r.id)}>
                      <button type="submit" className="tap text-space-400 hover:text-ki-300">
                        sync to GitHub issue
                      </button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
