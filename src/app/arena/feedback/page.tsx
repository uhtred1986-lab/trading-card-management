import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { arenaFeedback, cards as cardsTable } from "@/db/schema";
import { setFeedbackStatus } from "../actions";

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

  const rows = await db
    .select()
    .from(arenaFeedback)
    .where(status ? eq(arenaFeedback.status, status) : undefined)
    .orderBy(desc(arenaFeedback.createdAt))
    .limit(100);

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
        Everything said from inside the arena, in one place: bugs reported from the board, cards explained on the backlog, and rules set by hand. A bug carries the
        whole game with it — the state, every move made, and what was on offer — so it can be replayed exactly as you saw it.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {tab("open", "Open")}
        {tab("fixed", "Fixed")}
        {tab("all", "All")}
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">Nothing here. That is the good outcome.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-[10px] text-space-500">#{r.id}</span>
                <p className="min-w-0 flex-1 text-sm text-space-100">{r.note}</p>
                <span className="shrink-0 rounded bg-space-800 px-1.5 py-0.5 text-[10px] text-space-300">{KINDS[r.kind]?.label ?? r.kind}</span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${r.status === "open" ? "bg-dbs-yellow/20 text-dbs-yellow" : "bg-gain/20 text-gain"}`}>{r.status}</span>
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
                <span>{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
              </p>

              {r.resolution && (
                <p className="mt-1 border-l-2 border-gain pl-2 text-[11px] text-space-300">
                  <span className="text-space-400">{r.kind === "bug" ? "Fixed: " : "Read as: "}</span>
                  {r.resolution}
                </p>
              )}

              {r.kind === "bug" && (
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

              <form action={setFeedbackStatus.bind(null, r.id, r.status === "open" ? "fixed" : "open")} className="mt-1">
                <button className="tap text-[10px] text-space-400 hover:text-ki-300">{r.status === "open" ? "mark fixed" : "reopen"}</button>
              </form>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
