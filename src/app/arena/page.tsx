import Link from "next/link";
import { db } from "@/db";
import { listDecks } from "@/lib/decks/queries";
import { ENGINE_INFO, engineOr } from "@/lib/arena/engines";
import { lastPlayedDecks, listGames, modeLabel } from "@/lib/arena/games";
import { listOpenMatches } from "@/lib/arena/matches";
import { currentOwner, currentUser } from "@/lib/auth";
import { listUsers } from "@/lib/auth/users";
import { isLocked, readiness } from "@/lib/arena/readiness";
import { ArenaHeader } from "@/components/arena/ArenaHeader";
import { PlayPicker } from "@/components/arena/PlayPicker";
import { SubmitButton } from "@/components/SubmitButton";
import { cancelMatchAction, joinMatchForm, startGameForm } from "./actions";

export const dynamic = "force-dynamic";

export default async function ArenaPage() {
  // The engine reads the original game's rule manual and nothing else, so
  // Fusion World decks are simply not offered here (owner's decision).
  const me = await currentUser();
  const [decks, games, matches, users] = await Promise.all([
    listDecks(db, { game: "dbs", viewer: await currentOwner() }),
    listGames(db, 20, me),
    listOpenMatches(db),
    listUsers(db).catch(() => []),
  ]);
  // A 1 v 1 is two people, and a person here is an `app_users` row. Without a
  // second one the form would only throw, so it says so instead.
  const canVersus = users.filter((u) => u.isActive).length >= 2 && !!me;
  // What games of each kind have actually cost, rather than an estimate.
  const costs = { sparring: "~12¢ a game", tournament: "~25¢ a game" };
  for (const mode of ["sparring", "tournament"] as const) {
    const done = games.filter((g) => g.mode === mode && g.status !== "playing" && g.costMicros > 0);
    if (!done.length) continue;
    const avg = done.reduce((n, g) => n + g.costMicros, 0) / done.length / 10_000;
    costs[mode] = `your average ~${Math.round(avg)}¢`;
  }
  const playable = decks.filter((d) => d.leader && d.mainCount >= 50);
  // One query for every deck's rule readiness (#357).
  const ready = await readiness(db, playable.map((d) => d.id));

  // Preselected from the newest games, but always a *ready* deck: a locked one
  // cannot be played, so the last-played ready one wins, then the first ready.
  const last = await lastPlayedDecks(db, playable.map((d) => d.id), me);
  const readyIds = playable.filter((d) => !isLocked(ready.get(d.id))).map((d) => d.id);
  const pick = (id: number | null, fallback: number) => (id != null && readyIds.includes(id) ? id : fallback);
  const initialDeck = pick(last.own, readyIds[0] ?? playable[0]?.id ?? 0);
  const initialClaudeDeck = pick(last.claude, readyIds.find((id) => id !== initialDeck) ?? readyIds[0] ?? playable[0]?.id ?? 0);

  const select = "tap w-full rounded-md border border-space-600 bg-space-900 px-2 py-2 text-sm text-space-100";

  return (
    <div className="space-y-5">
      <ArenaHeader side="play" />
      {playable.length < 1 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-6 text-center text-sm text-space-300">
          No deck is ready to play yet. A deck needs a leader, at least 50 cards, and the original game&rsquo;s rules — the arena does not play Fusion World.{" "}
          <Link href="/decks" className="text-ki-300 hover:underline">
            Build one
          </Link>
          .
        </p>
      ) : (
        <PlayPicker
          decks={playable.map((d) => ({ id: d.id, name: d.name, leaderName: d.leader?.name ?? null, leaderImage: d.leader?.imageUrl ?? null, mainCount: d.mainCount, ready: ready.get(d.id)! }))}
          initialDeck={initialDeck}
          initialClaudeDeck={initialClaudeDeck}
          costs={costs}
          canVersus={canVersus}
          versusNote="Needs a second login: add one under Settings → Users."
          action={startGameForm}
        />
      )}

      {matches.length > 0 && (
        <section id="friend">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-space-400">Waiting for a player</h2>
          <ul className="space-y-2">
            {matches.map((m) => {
              const mine = m.hostUser === me;
              return (
                <li key={m.id} className="rounded-xl border border-space-700/70 bg-space-900/50 p-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium text-space-50">
                      {mine ? "You" : m.hostUser} want{mine ? "" : "s"} to play
                    </span>
                    <span className="text-xs text-space-400">with {m.hostDeckName ?? "a deck that is gone"}</span>
                  </div>
                  {mine ? (
                    <form action={cancelMatchAction.bind(null, m.id)} className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-space-400">Waiting for someone to join.</span>
                      <SubmitButton pendingLabel="Calling it off…" className="tap ml-auto text-xs text-space-400 hover:text-loss">
                        call it off
                      </SubmitButton>
                    </form>
                  ) : (
                    <form action={joinMatchForm} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="match" value={m.id} />
                      <label className="min-w-0 flex-1 text-sm">
                        <span className="mb-1 block text-xs uppercase tracking-wider text-space-400">Your deck</span>
                        <select name="deck" className={select} defaultValue={readyIds[0] ?? playable[0]?.id}>
                          {playable.map((d) => (
                            <option key={d.id} value={d.id} disabled={isLocked(ready.get(d.id))}>
                              {d.name} — {d.leader?.name ?? "no leader"}
                              {isLocked(ready.get(d.id)) ? ` (${ready.get(d.id)!.open} open, locked)` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                      <SubmitButton pendingLabel="Flipping…" className="tap rounded-lg bg-ki-500 px-4 py-2.5 text-sm font-semibold text-space-950">
                        Join
                      </SubmitButton>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section id="games">
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
                  {g.p1User && g.p2User && (
                    <span className="text-xs text-space-400">
                      {g.p1User} v {g.p2User}
                    </span>
                  )}
                  <span className="text-xs text-space-400">turn {g.turn}</span>
                  <span className="text-xs text-space-500">{modeLabel(g.mode)}</span>
                  {/* Inverted at #166: the rules engine is the default now, so the badge marks the games that are *not* on it. Muted, because a legacy game is the ordinary older one rather than something to look at. */}
                  {engineOr(g.engine) === "legacy" && <span className="rounded-full border border-space-700 px-1.5 text-[10px] uppercase tracking-wider text-space-400">{ENGINE_INFO.legacy.label}</span>}
                  {/* Issue #335: a legacy row read off its stored snapshot rather than computed live — read-only, and worth marking the way the engine badge is. */}
                  {g.archived && <span className="rounded-full border border-dbs-yellow/50 px-1.5 text-[10px] uppercase tracking-wider text-dbs-yellow">archived</span>}
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
