/** Saved-game revision, request identity and status-only polling proof. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import {
  abandonGame,
  applyToGame,
  GameAlreadyFinished,
  loadGame,
  mutationFingerprint,
  replayMutation,
  RequestIdentityConflict,
  StaleGame,
  startGame,
} from "../../src/lib/arena/games.ts";
import { snapshotOfGame, waitForRevision } from "../../src/lib/arena/session.ts";
import { reconcileSnapshot } from "../../src/lib/arena/snapshot.ts";
import type { Action } from "../../src/lib/arena/types.ts";

export async function verifyArenaRevision(db: Db, deckId: number): Promise<void> {
  const id = await startGame(db, deckId, deckId, "hotseat", false, { p1User: null, p2User: null });
  const original = (await loadGame(db, id))!;
  const firstAction: Action = original.legal[0].action;
  const firstIdentity = {
    actor: "alice",
    requestId: "00000000-0000-4000-8000-000000000001",
    fingerprint: mutationFingerprint({ basedOn: original.version, index: 0 }),
  };
  assert.equal(firstIdentity.fingerprint.length, 64, "the stored request receipt is a compact SHA-256 hash");

  const applied = await applyToGame(db, id, firstAction, undefined, {
    game: original,
    expectedRevision: original.version,
    request: firstIdentity,
  });
  assert.equal(applied.version, original.version + 1, "a successful action advances the authoritative revision once");
  assert.equal(applied.actionReceipts.length, 1, "the receipt is committed with the action");

  const competingIdentity = {
    actor: "bob",
    requestId: "00000000-0000-4000-8000-000000000002",
    fingerprint: mutationFingerprint({ basedOn: original.version, index: 0 }),
  };
  await assert.rejects(
    applyToGame(db, id, firstAction, undefined, { game: original, expectedRevision: original.version, request: competingIdentity }),
    StaleGame,
    "a second client that acted on the same old revision loses the CAS",
  );
  const afterCompetition = (await loadGame(db, id))!;
  assert.equal(afterCompetition.version, applied.version, "the losing write changed no revision");
  assert.equal(afterCompetition.actionReceipts.length, 1, "the losing write left no false acknowledgement");

  const replay = await applyToGame(db, id, firstAction, undefined, {
    game: afterCompetition,
    expectedRevision: original.version,
    request: firstIdentity,
  });
  assert.equal(replay.duplicateRequest, true, "an identical retry is acknowledged before stale/status checks");
  assert.equal(replay.version, applied.version, "a duplicate does not apply the action twice");
  assert.deepEqual(replay.state, applied.state, "the duplicate returns the currently persisted state");
  assert.equal(((await db.query.arenaGames.findFirst({ where: eq(schema.arenaGames.id, id) }))!.actions as Action[]).length, 1);

  const changedPayload = { ...firstIdentity, fingerprint: mutationFingerprint({ basedOn: original.version, index: 1 }) };
  assert.throws(() => replayMutation(afterCompetition, changedPayload), RequestIdentityConflict, "one request id cannot name a different action");

  const movedAction: Action = afterCompetition.legal[0].action;
  const secondIdentity = {
    actor: "alice",
    requestId: "00000000-0000-4000-8000-000000000003",
    fingerprint: mutationFingerprint({ basedOn: afterCompetition.version, index: 0 }),
  };
  const moved = await applyToGame(db, id, movedAction, undefined, {
    game: afterCompetition,
    expectedRevision: afterCompetition.version,
    request: secondIdentity,
  });
  const afterReload = (await loadGame(db, id))!;
  assert.equal(afterReload.version, moved.version, "reload reads the committed revision");
  const oldRetry = replayMutation(afterReload, firstIdentity);
  assert.equal(oldRetry?.duplicateRequest, true, "an old request remains recognizable after later game writes");
  assert.equal(oldRetry?.version, moved.version, "retries converge on the current authoritative board");

  const abandonId = await startGame(db, deckId, deckId, "hotseat", false, { p1User: null, p2User: null });
  const beforeAbandon = (await loadGame(db, abandonId))!;
  const priorBeats = { seq: 37, list: [], art: {} };
  await db.update(schema.arenaGames).set({ beats: priorBeats }).where(eq(schema.arenaGames.id, abandonId));
  const beforeSnapshot = await snapshotOfGame(db, { ...beforeAbandon, beats: priorBeats });
  await assert.rejects(
    abandonGame(db, abandonId, beforeAbandon.version + 1, {
      actor: "bob",
      requestId: "00000000-0000-4000-8000-000000000006",
      fingerprint: mutationFingerprint({ basedOn: beforeAbandon.version + 1, type: "abandon" }),
    }),
    StaleGame,
    "giving up from an obsolete revision is refused instead of applying against a newer board",
  );
  const afterStaleAbandon = (await loadGame(db, abandonId))!;
  assert.equal(afterStaleAbandon.status, "playing", "a stale give-up request leaves the game playing");
  assert.equal(afterStaleAbandon.version, beforeAbandon.version, "a stale give-up request advances no revision");
  assert.equal(afterStaleAbandon.actionReceipts.length, 0, "a stale give-up request leaves no success receipt");
  const abandonIdentity = {
    actor: "bob",
    requestId: "00000000-0000-4000-8000-000000000004",
    fingerprint: mutationFingerprint({ basedOn: beforeAbandon.version, type: "abandon" }),
  };
  const abandoned = await abandonGame(db, abandonId, beforeAbandon.version, abandonIdentity);
  const firstReader = await snapshotOfGame(db, abandoned, "p1");
  const secondReader = await snapshotOfGame(db, abandoned, "p2");
  assert.equal(abandoned.version, beforeAbandon.version + 1, "abandonment advances revision even without a beat");
  assert.equal(firstReader.game.status, "abandoned", "the first connected client sees the terminal state");
  assert.equal(secondReader.game.status, "abandoned", "the other client sees the same terminal state");
  assert.deepEqual(firstReader.legal, [], "the first reader sees no playable actions after abandonment");
  assert.deepEqual(firstReader.taps, { byCard: {}, bare: [], attackTargets: {} }, "the first reader sees no actionable targets after abandonment");
  assert.equal("rejected" in firstReader, false, "a terminal board carries no rejected-action prompts");
  assert.deepEqual(secondReader.legal, [], "the other reader sees no playable actions after abandonment");
  assert.deepEqual(secondReader.taps, { byCard: {}, bare: [], attackTargets: {} }, "the other reader sees no actionable targets after abandonment");
  assert.deepEqual(firstReader.beats, beforeSnapshot.beats, "status-only writes preserve, rather than replay, the old beat queue");
  assert.equal(await waitForRevision(db, abandonId, beforeAbandon.version, 0), true, "revision polling wakes for a no-beat abandonment");
  assert.equal((await abandonGame(db, abandonId, beforeAbandon.version, abandonIdentity)).duplicateRequest, true, "a retry of abandon is acknowledged after the game is terminal");
  await assert.rejects(
    abandonGame(db, abandonId, abandoned.version, { ...abandonIdentity, requestId: "00000000-0000-4000-8000-000000000005" }),
    GameAlreadyFinished,
    "a competing new abandon request cannot mutate the terminal game",
  );

  assert.equal(reconcileSnapshot(firstReader, beforeSnapshot), firstReader, "a delayed lower-revision response cannot replace the newer board");
  assert.equal(reconcileSnapshot(beforeSnapshot, firstReader), firstReader, "a later higher-revision response replaces the older board");
  assert.equal(reconcileSnapshot(firstReader, secondReader), firstReader, "equal revisions do not roll back a board either");
  const anotherGame = { ...beforeSnapshot, game: { ...beforeSnapshot.game, id: beforeSnapshot.game.id + 1, revision: 0 } };
  assert.equal(reconcileSnapshot(firstReader, anotherGame), anotherGame, "a different game starts its own revision sequence");

  await db.delete(schema.arenaGames).where(eq(schema.arenaGames.id, id));
  await db.delete(schema.arenaGames).where(eq(schema.arenaGames.id, abandonId));
}
