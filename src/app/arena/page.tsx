import Link from "next/link";
import { db } from "@/db";
import { listDecks } from "@/lib/decks/queries";
import { listGames } from "@/lib/arena/games";
import { compileCardCached, parseSkills } from "@/lib/arena/engine";
import { cardDefFrom, deckInputFor } from "@/lib/arena/load";
import { cards as cardsTable } from "@/db/schema";
import { inArray } from "drizzle-orm";
import { startGameForm } from "./actions";

export const dynamic = "force-dynamic";

/** How much of a deck's card text the engine reads on its own (proposal §6). */
async function coverageFor(deckId: number): Promise<{ cards: number; referee: number } | null> {
  const input = await deckInputFor(db, deckId);
  if (!input) return null;
  const ids = [...new Set(input.cardIds)];
  const rows = await db.select().from(cardsTable).where(inArray(cardsTable.id, ids));
  let referee = 0;
  for (const row of rows) {
    const d = cardDefFrom(row);
    const scripts = compileCardCached(d, "front");
    const needs = parseSkills(d.skill).some((sk) => {
      const sc = scripts.bySkill[sk.index];
      return !!sc && sc.unsupported.length > 0;
    });
    if (needs) referee++;
  }
  return { cards: rows.length, referee };
}

export default async function ArenaPage() {
  const [decks, games] = await Promise.all([listDecks(db), listGames(db)]);
  // What games of each kind have actually cost, rather than an estimate.
  const spent: Record<string, string | null> = { sparring: null, tournament: null };
  for (const mode of ["sparring", "tournament"] as const) {
    const done = games.filter((g) => g.mode === mode && g.status !== "playing" && g.costMicros > 0);
    if (!done.length) continue;
    const avg = done.reduce((n, g) => n + g.costMicros, 0) / done.length / 1_000_000;
    spent[mode] = `Your games so far: $${avg.toFixed(2)} on average.`;
  }
  const playable = decks.filter((d) => d.leader && d.mainCount >= 50);
  const coverage = new Map<number, { cards: number; referee: number } | null>();
  for (const d of playable) coverage.set(d.id, await coverageFor(d.id));

  const select = "tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-2 text-sm text-space-100";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-space-50">Arena</h1>
        <p className="mt-1 text-sm text-space-300">
          Play a full game against Claude, or hot-seat against yourself. The rules are enforced by the engine, so only legal moves are ever offered — Claude picks
          from the same list you do, and never sees your hand.
        </p>
      </div>

      {playable.length < 1 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">
          No deck is ready to play yet. A deck needs a leader and at least 50 cards.{" "}
          <Link href="/decks" className="text-ki-300 hover:underline">
            Build one
          </Link>
          .
        </p>
      ) : (
        <form action={startGameForm} className="space-y-3 rounded-xl border border-space-700/70 bg-space-900/50 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wider text-space-400">First player&rsquo;s deck</span>
              <select name="p1" className={select} defaultValue={playable[0]?.id}>
                {playable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {d.leader?.name ?? "no leader"}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-xs uppercase tracking-wider text-space-400">Second player&rsquo;s deck (Claude&rsquo;s, unless hot-seat)</span>
              <select name="p2" className={select} defaultValue={playable[1]?.id ?? playable[0]?.id}>
                {playable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {d.leader?.name ?? "no leader"}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset>
            <legend className="mb-1 block text-xs uppercase tracking-wider text-space-400">Opponent</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { value: "hotseat", title: "Hot-seat", note: "Both sides are yours. Free." },
                { value: "sparring", title: "Sparring", note: `Claude on Haiku 4.5. ${spent.sparring ?? "Measured at about 10 to 15 cents a game."}` },
                { value: "tournament", title: "Tournament", note: `Claude on Opus 5 for the turns that decide things. ${spent.tournament ?? "Measured at about 20 to 30 cents a game."}` },
              ].map((o, i) => (
                <label key={o.value} className="tap flex cursor-pointer flex-col rounded-lg border border-space-600 bg-space-900 p-2 text-sm has-[:checked]:border-ki-500 has-[:checked]:bg-space-800">
                  <span className="flex items-center gap-2">
                    <input type="radio" name="mode" value={o.value} defaultChecked={i === 0} className="accent-ki-500" />
                    <span className="font-medium text-space-50">{o.title}</span>
                  </span>
                  <span className="mt-0.5 pl-6 text-[11px] text-space-400">{o.note}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button className="tap w-full rounded-lg bg-ki-500 px-4 py-3 text-sm font-semibold text-space-950">Flip the coin</button>
          <p className="text-[11px] text-space-400">
            A game starts with the coin flip, then each side may mulligan once. Life is 8; the player going second gets one energy marker. Against Claude, the second
            deck is the one it plays.
          </p>
        </form>
      )}

      {playable.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-widest text-space-400">What the engine reads in each deck</h2>
          <ul className="space-y-1 text-xs">
            {playable.map((d) => {
              const c = coverage.get(d.id);
              return (
                <li key={d.id} className="flex flex-wrap items-baseline gap-x-2 rounded-lg bg-space-900/50 px-2 py-1.5">
                  <span className="font-medium text-space-100">{d.name}</span>
                  {c ? (
                    <span className="text-space-400">
                      {c.cards - c.referee} of {c.cards} cards fully read
                      {c.referee > 0 && <span className="text-dbs-yellow"> · {c.referee} put to Claude when they resolve</span>}
                    </span>
                  ) : (
                    <span className="text-loss">no leader — cannot be played</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-widest text-space-400">Games</h2>
        {games.length === 0 ? (
          <p className="text-sm text-space-400">None yet.</p>
        ) : (
          <ul className="space-y-1">
            {games.map((g) => (
              <li key={g.id}>
                <Link href={`/arena/${g.id}`} className="flex flex-wrap items-baseline gap-x-2 rounded-lg border border-space-700/70 bg-space-900/50 px-3 py-2 hover:border-ki-500/50">
                  <span className="text-sm font-medium text-space-50">
                    {g.p1Name} <span className="text-space-500">vs</span> {g.p2Name}
                  </span>
                  <span className="text-xs text-space-400">turn {g.turn}</span>
                  <span className="text-xs text-space-500">{g.mode === "hotseat" ? "hot-seat" : g.mode}</span>
                  <span className={`ml-auto text-xs ${g.status === "playing" ? "text-ki-300" : "text-space-400"}`}>
                    {g.status === "playing" ? "in progress" : g.status === "over" ? (g.winner ? `${g.winner === "p1" ? g.p1Name : g.p2Name} won` : "draw") : "abandoned"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
