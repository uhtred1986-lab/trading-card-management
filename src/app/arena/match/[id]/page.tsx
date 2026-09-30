import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { inviteView, matchById } from "@/lib/arena/matches";
import { isLocked, readiness } from "@/lib/arena/readiness";
import { listDecks } from "@/lib/decks/queries";
import { currentOwner, currentUser } from "@/lib/auth";
import { CardImage } from "@/components/CardImage";
import { SubmitButton } from "@/components/SubmitButton";
import { InviteShare } from "@/components/arena/InviteShare";
import { MatchWaiting } from "@/components/arena/MatchWaiting";
import { cancelMatchAction, joinMatchForm } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * The invite page of a 1 v 1 (#369), one route, two views.
 *
 * There is no game yet — a match becomes one only when the second deck
 * arrives. The host sees who they wait for, the link to send and a live
 * waiting indicator that takes them to the board on join. Any other login
 * sees the host's leader and deck name (nothing more: no hand, no list) and
 * picks one of their *own* decks here; locked ones are disabled, and
 * `joinMatch` refuses them again on the server.
 */
export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const match = await matchById(db, id);
  if (!match) notFound();

  // Already going: whoever lands here late goes straight to the board.
  if (match.gameId) redirect(`/arena/${match.gameId}`);
  if (match.status === "cancelled") redirect("/arena");

  const me = await currentUser();
  const mine = match.hostUser === me;
  const host = await inviteView(db, match.hostDeckId);
  const taken = match.status !== "open";

  const hostSide = (
    <div className="flex items-center justify-center gap-4">
      <div className="w-24 text-center">
        <CardImage src={host.leaderImage} alt={host.leaderName ?? "Leader"} sizes="96px" priority />
        <p className="mt-1 truncate text-xs text-space-200">{host.leaderName ?? "No leader"}</p>
        <p className="truncate text-[11px] text-space-400">{host.hostDeckName ?? "a deck that is gone"}</p>
      </div>
      <span className="text-xs uppercase tracking-widest text-space-500">vs</span>
      <div className="flex h-32 w-24 items-center justify-center rounded-lg border border-dashed border-space-600 text-2xl text-space-500" aria-label="Opponent not chosen yet">
        ?
      </div>
    </div>
  );

  if (mine) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-6 text-center">
        <h1 className="text-lg font-semibold tracking-tight text-space-50">Waiting for your opponent</h1>
        {hostSide}
        <MatchWaiting matchId={id} />
        <p className="text-sm text-space-300">Send them this link. They pick a deck on it and the game starts on both phones.</p>
        <InviteShare path={`/arena/match/${id}`} hostName={match.hostUser} />
        <div className="flex items-center justify-center gap-4 pt-2 text-sm">
          <Link href="/arena" className="text-space-300 hover:text-ki-300">
            ← Arena
          </Link>
          <form action={cancelMatchAction.bind(null, id)}>
            <SubmitButton pendingLabel="Calling it off…" className="tap text-space-400 hover:text-loss">
              Call it off
            </SubmitButton>
          </form>
        </div>
      </div>
    );
  }

  // Guest: only the guest's own (visible) decks, the original game's only.
  const decks = me ? (await listDecks(db, { game: "dbs", viewer: await currentOwner() })).filter((d) => d.leader && d.mainCount >= 50) : [];
  const ready = await readiness(db, decks.map((d) => d.id));
  const firstReady = decks.find((d) => !isLocked(ready.get(d.id)))?.id;

  return (
    <div className="mx-auto max-w-md space-y-4 py-6">
      <h1 className="text-center text-lg font-semibold tracking-tight text-space-50">{match.hostUser} invites you to play</h1>
      {hostSide}
      {!me ? (
        <p className="text-center text-sm text-space-300">A 1 v 1 needs two logins. Sign in with your own to join.</p>
      ) : taken ? (
        <p className="text-center text-sm text-space-300">Someone else is joining this match.</p>
      ) : decks.length === 0 ? (
        <p className="rounded-xl border border-dashed border-space-700 p-4 text-center text-sm text-space-300">
          You have no deck ready to play: it needs a leader and 50 cards, from the original game.{" "}
          <Link href="/decks" className="text-ki-300 hover:underline">
            Build one
          </Link>
          .
        </p>
      ) : (
        <form action={joinMatchForm} className="space-y-3">
          <input type="hidden" name="match" value={id} />
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs uppercase tracking-widest text-space-400">Your deck</legend>
            {decks.map((d) => {
              const locked = isLocked(ready.get(d.id));
              return (
                <label key={d.id} className={`flex items-center gap-3 rounded-xl border p-2 has-[:checked]:border-ki-500 has-[:checked]:bg-space-800 ${locked ? "border-space-800 opacity-60" : "tap cursor-pointer border-space-700/70 bg-space-900/50"}`}>
                  <input type="radio" name="deck" value={d.id} disabled={locked} defaultChecked={d.id === firstReady} className="sr-only" />
                  <div className="w-14 shrink-0">
                    <CardImage src={d.leader?.imageUrl} alt={d.leader?.name ?? "No leader"} sizes="56px" />
                  </div>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-space-50">{d.name}</span>
                    <span className="block truncate text-xs text-space-400">
                      {d.leader?.name}
                      {locked && ` · Locked, ${ready.get(d.id)!.open} card${ready.get(d.id)!.open === 1 ? "" : "s"} with no rule`}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>
          {firstReady == null && <p className="text-center text-xs text-loss">Every one of your decks is locked, so you cannot join yet. Fix the open rules in Rules first.</p>}
          <SubmitButton pendingLabel="Flipping…" disabled={firstReady == null} className="tap w-full rounded-lg bg-ki-500 px-4 py-3 text-sm font-semibold uppercase tracking-wide text-space-950 disabled:opacity-40">
            Join · flip the coin
          </SubmitButton>
        </form>
      )}
      <p className="text-center text-sm">
        <Link href="/arena" className="text-space-300 hover:text-ki-300">
          ← Arena
        </Link>
      </p>
    </div>
  );
}
