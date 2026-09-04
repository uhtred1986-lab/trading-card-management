import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { cards as cardsTable } from "@/db/schema";
import { ExplainCard } from "@/components/arena/ExplainCard";
import { SubmitButton } from "@/components/SubmitButton";
import { backlogByPattern } from "@/lib/arena/ai/debug";
import { cardScripts } from "@/db/schema";
import { markNote, sweepBacklog } from "../actions";

export const dynamic = "force-dynamic";

/**
 * Card text the compiler cannot read yet — the working list for extending
 * `src/lib/arena/engine/compile.ts`.
 *
 * Grouped by the shape of the clause rather than by card, because one rule in
 * the compiler usually clears many cards at once. Text that has actually come
 * up in a game sorts first; that is where a new rule pays off soonest.
 */
export default async function BacklogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const status = (Array.isArray(sp.status) ? sp.status[0] : sp.status) === "done" ? "done" : "open";
  const groups = await backlogByPattern(db, status);

  const cardIds = [...new Set(groups.flatMap((g) => g.cards.map((c) => c.cardId)))];
  const names = new Map<string, string>();
  if (cardIds.length) {
    for (const r of await db.select({ id: cardsTable.id, name: cardsTable.name }).from(cardsTable).where(inArray(cardsTable.id, cardIds))) names.set(r.id, r.name);
  }

  // Cards with a stored program already play correctly, whatever the compiler thinks.
  const scripted = new Set((await db.select({ cardId: cardScripts.cardId, skillIndex: cardScripts.skillIndex }).from(cardScripts)).map((r) => `${r.cardId}#${r.skillIndex}`));

  const totalCards = groups.reduce((n, g) => n + g.cards.length, 0);
  const seen = groups.filter((g) => g.timesSeen > 0).length;

  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <h1 className="text-lg font-semibold tracking-tight text-space-50">Card text the engine cannot read</h1>
          <Link href="/arena" className="ml-auto text-xs text-space-300 hover:text-ki-300">
            ← Arena
          </Link>
        </div>
        <p className="mt-1 text-sm text-space-300">
          Each row is one shape of wording that defeats the compiler. Adding a rule for it in <code className="text-space-400">compile.ts</code> usually fixes every card
          in the group at once. Until then Claude rules on these cards when they resolve, which works but costs tokens and is slower.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Link href="/arena/backlog" className={`tap rounded-md px-3 py-1.5 ${status === "open" ? "bg-space-800 text-space-50" : "text-space-300"}`}>
          Open ({status === "open" ? groups.length : "…"})
        </Link>
        <Link href="/arena/backlog?status=done" className={`tap rounded-md px-3 py-1.5 ${status === "done" ? "bg-space-800 text-space-50" : "text-space-300"}`}>
          Done
        </Link>
        <form action={sweepBacklog} className="ml-auto">
          <SubmitButton pendingLabel="Scanning…" className="tap rounded-md border border-space-600 px-3 py-1.5 text-space-100 hover:bg-space-800">Scan my decks again</SubmitButton>
        </form>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">
          {status === "done" ? "Nothing marked done yet." : "Nothing on the list. Press “Scan my decks again” to fill it from the decks you play."}
        </p>
      ) : (
        <>
          <p className="text-xs text-space-400">
            {groups.length} wordings across {totalCards} cards
            {seen > 0 && ` · ${seen} have already come up in a game`}
          </p>
          <ol className="space-y-2">
            {groups.map((g) => (
              <li key={g.pattern} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <code className="text-sm text-space-50">{g.pattern}</code>
                  <span className="ml-auto shrink-0 text-xs text-space-400">
                    {g.cards.length} card{g.cards.length === 1 ? "" : "s"}
                    {g.timesSeen > 0 && <span className="text-ki-300"> · came up {g.timesSeen}×</span>}
                  </span>
                </div>

                <details className="mt-2 text-xs">
                  <summary className="cursor-pointer text-space-400">the cards, and what Claude ruled</summary>
                  <ul className="mt-1 space-y-2">
                    {g.cards.map((c) => (
                      <li key={c.id} className="rounded-lg bg-space-950/60 p-2">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <Link href={`/cards/${encodeURIComponent(c.cardId)}`} className="font-medium text-space-100 hover:text-ki-300">
                            {names.get(c.cardId) ?? c.cardId}
                          </Link>
                          <span className="font-mono text-[10px] text-space-500">{c.cardId}</span>
                          <form action={markNote.bind(null, c.id, c.status === "open" ? "done" : "open")} className="ml-auto">
                            <SubmitButton className="tap text-[10px] text-space-400 hover:text-ki-300">{c.status === "open" ? "mark done" : "reopen"}</SubmitButton>
                          </form>
                        </div>
                        <p className="mt-1 text-space-400">
                          <span className="text-space-500">could not read: </span>
                          {c.clause}
                        </p>
                        <p className="mt-0.5 text-space-500">{c.skillText.replace(/\s+/g, " ").slice(0, 220)}</p>
                        {c.lastRulingWhy && (
                          <p className="mt-1 border-l-2 border-dbs-yellow pl-2 text-space-300">
                            <span className="text-space-400">Claude ruled: </span>
                            {c.lastRulingWhy}
                          </p>
                        )}
                        {c.lastRuling != null && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[10px] text-space-500">the program it produced</summary>
                            <pre className="mt-1 overflow-auto rounded bg-space-950 p-2 font-mono text-[10px] text-space-300">{JSON.stringify(c.lastRuling, null, 1)}</pre>
                          </details>
                        )}
                        <ExplainCard
                          noteId={c.id}
                          cardName={names.get(c.cardId) ?? c.cardId}
                          clause={c.clause}
                          explanation={c.explanation}
                          meaning={c.explanation ? c.lastRulingWhy : null}
                          brief={c.brief}
                          hasProgram={scripted.has(`${c.cardId}#${c.skillIndex}`)}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
