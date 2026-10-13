/** #570: persisted row stays byte-for-byte unchanged across stale, seat and valid previews. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { arenaGames } from "../../src/db/schema.ts";
import { loadGame } from "../../src/lib/arena/games.ts";
import { previewLoadedGame } from "../../src/lib/arena/gameplan-preview.ts";
import { planActions, planCtx, planState } from "./gameplan-fixture-570.ts";
import type { Action } from "../../src/lib/arena/types.ts";

export async function verifyArenaGameplan(db: Db): Promise<void> {
  for (const engine of ["legacy", "rules"] as const) {
  const state = planState();
  const [created] = await db.insert(arenaGames).values({
    p1Name: "Alice", p2Name: "Bob", p1User: "alice", p2User: "bob",
    seed: 570, mode: "versus", engine, state, version: 7,
  }).returning({ id: arenaGames.id });
  try {
    const [before] = await db.select().from(arenaGames).where(eq(arenaGames.id, created.id));
    const loaded = (await loadGame(db, created.id))!;
    // The synthetic card definitions belong to the offline engine fixture;
    // the loaded state and revision still come from the persisted PGlite row.
    loaded.ctx = planCtx;
    const actions: Action[] = planActions(state);
    assert.equal(previewLoadedGame(loaded, 6, actions, "p1").error, "the board changed; refresh the plan");
    assert.equal(previewLoadedGame(loaded, 7, actions, "p2").error, "it is not your turn");
    assert.equal(previewLoadedGame(loaded, 7, actions, null).error, "it is not your turn", "an unseated caller cannot preview");
    assert.equal(previewLoadedGame(loaded, 6, actions, null).error, "it is not your turn", "an unseated caller learns no revision");
    assert.equal(previewLoadedGame(loaded, 7, null as unknown as Action[], "p1").error, "choose one or two moves from this board");
    assert.equal(previewLoadedGame(loaded, 7, [null] as unknown as Action[], "p1").error, "choose one or two moves from this board");
    assert.equal(previewLoadedGame(loaded, 7, actions, "p1").preview?.steps.length, 3);
    const priorStatus = loaded.status;
    loaded.status = "abandoned";
    assert.equal(previewLoadedGame(loaded, 7, actions, "p1").error, "a plan is only available during Main Phase");
    assert.equal(previewLoadedGame(loaded, 7, actions, null).error, "it is not your turn", "an unseated caller learns no status");
    loaded.status = priorStatus;
    const valid = previewLoadedGame(loaded, 7, actions, "p1");
    assert.equal(valid.error, null);
    assert.deepEqual(valid.preview?.steps.map((step) => step.budget.ready), [2, 1, 0]);
    const reloaded = (await loadGame(db, created.id))!;
    assert.equal(reloaded.version, 7, "reload observes the unchanged authoritative revision");
    const [after] = await db.select().from(arenaGames).where(eq(arenaGames.id, created.id));
    assert.deepEqual(after, before, "preview writes no state, RNG, actions, receipts, spend or timestamp");
  } finally {
    await db.delete(arenaGames).where(eq(arenaGames.id, created.id));
  }
  const [archived] = await db.insert(arenaGames).values({
    p1Name: "Alice", p2Name: "Bob", p1User: "alice", p2User: "bob",
    seed: 571, mode: "versus", engine, state, version: 7, status: "over", snapshot: { archived: true },
  }).returning({ id: arenaGames.id });
  try {
    assert.equal(await loadGame(db, archived.id), null, "an archived row cannot reach preview's live-game service");
  } finally {
    await db.delete(arenaGames).where(eq(arenaGames.id, archived.id));
  }
  }
}
