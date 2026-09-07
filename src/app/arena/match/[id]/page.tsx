import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/db";
import { decks as decksTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { matchById } from "@/lib/arena/matches";
import { currentUser } from "@/lib/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { MatchWaiting } from "@/components/arena/MatchWaiting";
import { cancelMatchAction } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * The host's side of a 1 v 1: you have chosen, and the other player has not.
 *
 * There is no game yet — a match becomes one only when the second deck
 * arrives — so this is the only arena screen with nothing to draw. It waits,
 * and takes you to the board the moment the join lands.
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
  const deck = match.hostDeckId ? await db.query.decks.findFirst({ where: eq(decksTable.id, match.hostDeckId), columns: { name: true } }) : null;

  return (
    <div className="mx-auto max-w-md space-y-4 py-8 text-center">
      <h1 className="text-lg font-semibold tracking-tight text-space-50">
        {mine ? "Waiting for your opponent" : `${match.hostUser} is waiting for a player`}
      </h1>
      <p className="text-sm text-space-300">
        {mine ? (
          <>
            You are in with <span className="text-space-100">{deck?.name ?? "a deck that is gone"}</span>. This screen takes you to the board the moment they pick
            theirs — leave it open, or come back to the arena and it will be listed there.
          </>
        ) : (
          <>
            They are in with <span className="text-space-100">{deck?.name ?? "a deck that is gone"}</span>. Choose your own deck back on the arena page to start
            the game.
          </>
        )}
      </p>

      <MatchWaiting matchId={id} />

      <div className="flex items-center justify-center gap-4 pt-2 text-sm">
        <Link href="/arena" className="text-space-300 hover:text-ki-300">
          ← Arena
        </Link>
        {mine && (
          <form action={cancelMatchAction.bind(null, id)}>
            <SubmitButton pendingLabel="Calling it off…" className="tap text-space-400 hover:text-loss">
              call it off
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}
