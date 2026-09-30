/**
 * verify-db checks for the admin match review (#351): flag a turn, flag it
 * again (a no-op that hands back the first flag), save a reviewer note, resolve
 * and reopen, and which games the review lists. Own ids, so it cannot collide
 * with the other verify-db sections. The admin gate is in `actions.ts` and
 * `review/page.tsx`; `isAdminUser` itself is `verify/arena-admin.ts`'s.
 */
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { flagsForGame, flagTurn, gamesWithFlags, reopenFlag, reviewFlag } from "../src/lib/arena/review-store.ts";

export async function verifyReview(db: Db): Promise<void> {
  const mk = async (p2Name: string) => {
    const [g] = await db
      .insert(schema.arenaGames)
      .values({ p1Name: "Review Player", p2Name, seed: 351, mode: "sparring", engine: "rules", state: {}, turn: 6 })
      .returning({ id: schema.arenaGames.id });
    return g.id;
  };
  const a = await mk("Review Claude A");
  const b = await mk("Review Claude B");
  const untouched = await mk("Review Claude C");

  // Flag a turn.
  const first = await flagTurn(db, { gameId: a, turn: 4, beatIndex: 32, note: "  ignored my   rested card\n", flaggedBy: "owner" });
  assert.equal(first.created, true, "a new flag is created");
  assert.deepEqual({ turn: first.flag.turn, beat: first.flag.beatIndex, note: first.flag.note, by: first.flag.flaggedBy, resolved: first.flag.resolved }, { turn: 4, beat: 32, note: "ignored my rested card", by: "owner", resolved: false }, "the note is kept as one trimmed line");

  // Flag it again: a no-op. The first flag stands, whatever the second said.
  const again = await flagTurn(db, { gameId: a, turn: 4, beatIndex: 40, note: "a different note", flaggedBy: "someone else" });
  assert.equal(again.created, false, "flagging the same turn twice is a no-op");
  assert.equal(again.flag.id, first.flag.id, "it hands back the flag that is already there");
  assert.equal(again.flag.note, "ignored my rested card", "the second note did not overwrite the first");
  assert.equal((await flagsForGame(db, a)).length, 1, "still one flag for the turn");

  // A different turn, a blank note, a different game.
  const second = await flagTurn(db, { gameId: a, turn: 6, beatIndex: 47, note: "   ", flaggedBy: null });
  assert.equal(second.created, true);
  assert.equal(second.flag.note, null, "a blank note is stored as no note");
  await flagTurn(db, { gameId: b, turn: 4, beatIndex: 10, flaggedBy: "owner" });
  assert.deepEqual((await flagsForGame(db, a)).map((f) => f.turn), [4, 6], "a game's flags come back earliest turn first");

  // The list: only games with flags, the most recently flagged first.
  let listed = (await gamesWithFlags(db, true)).filter((g) => [a, b, untouched].includes(g.id));
  assert.deepEqual(listed.map((g) => [g.id, g.flags]), [[b, 1], [a, 2]], "games with open flags, newest flag first, with a count");
  assert.ok(!listed.some((g) => g.id === untouched), "a game with no flags is not listed");

  // Reviewer note, then Resolve: both on the flag's own row.
  const noted = await reviewFlag(db, first.flag.id, { reviewerNote: "  the wording, not the rule ", resolve: false });
  assert.equal(noted?.reviewerNote, "the wording, not the rule");
  assert.equal(noted?.resolved, false, "saving a note does not resolve");
  const done = await reviewFlag(db, first.flag.id, { reviewerNote: "fixed in the narration", resolve: true });
  assert.equal(done?.resolved, true, "Resolve marks the flag resolved");
  assert.equal(done?.reviewerNote, "fixed in the narration");
  const [row] = await db.select().from(schema.arenaFlags).where(eq(schema.arenaFlags.id, first.flag.id));
  assert.ok(row.resolvedAt instanceof Date, "resolved_at is set on the same row");
  assert.equal(await reviewFlag(db, 999_999, { reviewerNote: "x", resolve: true }), null, "no such flag is null, not an error");

  // Resolved flags leave the open list but stay on the game and in the full list.
  listed = (await gamesWithFlags(db, true)).filter((g) => [a, b].includes(g.id));
  assert.deepEqual(listed.map((g) => [g.id, g.flags]), [[b, 1], [a, 1]], "a resolved flag is not open");
  listed = (await gamesWithFlags(db, false)).filter((g) => [a, b].includes(g.id));
  assert.equal(listed.find((g) => g.id === a)?.flags, 2, "the full list counts it");
  const refiled = await flagTurn(db, { gameId: a, turn: 4, beatIndex: 32, flaggedBy: "owner" });
  assert.equal(refiled.created, false, "a resolved turn is not flagged anew");
  assert.equal(refiled.flag.resolved, true);
  assert.equal((await reopenFlag(db, first.flag.id))?.resolved, false, "Reopen puts it back");

  // Deleting a game takes its flags with it.
  await db.delete(schema.arenaGames).where(inArray(schema.arenaGames.id, [a, b, untouched]));
  assert.equal((await db.select().from(schema.arenaFlags).where(inArray(schema.arenaFlags.gameId, [a, b]))).length, 0, "flags go with their game");
}
