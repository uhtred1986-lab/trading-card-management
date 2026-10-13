/** #557: saved VM damage totals survive reload, stale CAS and duplicate requests. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { arenaGames } from "../../src/db/schema.ts";
import { damageTaken } from "../../src/lib/arena/engines.ts";
import { RULES } from "../../src/lib/arena/vm/index.ts";
import { applyToGame, loadGame, mutationFingerprint, StaleGame, type LoadedGame } from "../../src/lib/arena/games.ts";
import { rulesetFor } from "../../src/lib/arena/rulesets/index.ts";
import { snapshotOfGame } from "../../src/lib/arena/session.ts";
import type { Action, PlayerId, Prompt } from "../../src/lib/arena/types.ts";
import type { VmState } from "../../src/lib/arena/vm/state.ts";
import { moveCard } from "../../src/lib/arena/vm/zones.ts";
import { CTX, findG, leaderOf } from "./harness.ts";

const other = (p: PlayerId): PlayerId => p === "p1" ? "p2" : "p1";

function stagedDamageGame(): VmState {
  const rules = rulesetFor("dbs");
  assert.ok(rules.ok);
  const engine = RULES;
  let state = engine.createGame(CTX, {
    seed: 557,
    p1: { name: "Alice", leader: "L-RED", main: Array(50).fill("V1") },
    p2: { name: "Bob", leader: "L-BLUE", main: Array(50).fill("V-BLUE") },
  }).state as VmState;
  const step = (action: Action) => { state = engine.apply(CTX, state, action).state as VmState; };
  const chooser = (state.prompt as { player: PlayerId }).player;
  step({ type: "chooseFirst", player: chooser, first: "p1" });
  step({ type: "mulligan", player: "p1", redraw: false });
  step({ type: "mulligan", player: "p2", redraw: false });
  step({ type: "charge", player: "p1", card: null });
  step({ type: "endMain", player: "p1" });
  step({ type: "charge", player: "p2", card: null });
  step({ type: "endMain", player: "p2" });
  step({ type: "charge", player: "p1", card: null });
  assert.equal(state.prompt.kind, "main");
  const stage = (p: PlayerId, cardId: string, to: "hand" | "battle") => {
    const filler = p === "p1" ? "V1" : "V-BLUE";
    const id = state.sides[p].zones.deck.find((copy) => state.cards[copy].cardId === filler);
    assert.ok(id);
    state.cards[id].cardId = cardId;
    const placed = moveCard(state, rules.definition, id, to, { owner: p });
    assert.ok(placed.ok);
    if (to === "battle") state.cards[id].mode = "active";
  };
  stage("p1", "DOUBLE", "battle");
  stage("p2", "E-LIFE", "hand");
  return state;
}

export async function verifyArenaDamageStatistics(db: Db): Promise<void> {
  const initial = stagedDamageGame();
  const old = structuredClone(initial);
  delete old.damageTotals;
  const ids: number[] = [];
  try {
    for (const [seed, state] of [[557, initial], [558, old]] as const) {
      const [created] = await db.insert(arenaGames).values({
        p1Name: "Alice", p2Name: "Bob", p1User: "alice", p2User: "bob",
        seed, mode: "versus", engine: "rules", state, version: 7,
      }).returning({ id: arenaGames.id });
      ids.push(created.id);
    }

    const load = async (id: number): Promise<LoadedGame> => {
      const game = await loadGame(db, id);
      assert.ok(game);
      // The persisted state and version come from PGlite. This isolated proof
      // supplies the synthetic card definitions used to stage its board.
      game.ctx = CTX;
      game.art = {};
      return game;
    };
    const request = (revision: number, number: number) => ({
      actor: "alice", requestId: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
      fingerprint: mutationFingerprint({ revision, number }),
    });

    const playDamage = async (id: number, original: LoadedGame, withRetry: boolean) => {
      let game = original;
      const attack: Action = { type: "attack", player: "p1", attacker: findG(game.state, "p1", "battle", "DOUBLE"), target: leaderOf(game.state, "p2") };
      const firstRequest = request(game.version, id);
      game = await applyToGame(db, id, attack, undefined, { game, expectedRevision: game.version, request: firstRequest });
      assert.equal(damageTaken(game.state, "p2"), withRetry ? 0 : null);
      const persistedAfterAttack = (await db.select().from(arenaGames).where(eq(arenaGames.id, id)))[0];

      if (withRetry) {
        await assert.rejects(
          applyToGame(db, id, attack, undefined, { game: original, expectedRevision: original.version }),
          StaleGame,
          "a competing write against the obsolete persisted revision loses the CAS",
        );
        assert.deepEqual((await db.select().from(arenaGames).where(eq(arenaGames.id, id)))[0], persistedAfterAttack, "stale CAS wrote no state, log, receipt or version");
        const replay = await applyToGame(db, id, attack, undefined, { game, expectedRevision: original.version, request: firstRequest });
        assert.equal(replay.duplicateRequest, true, "the same request is acknowledged without reapplying damage");
        assert.equal(damageTaken(replay.state, "p2"), 0);
        assert.deepEqual((await db.select().from(arenaGames).where(eq(arenaGames.id, id)))[0], persistedAfterAttack, "an idempotent retry writes no second event or receipt");
      }

      // Decline the Counter, then each combo opportunity, until the two life
      // cards are genuinely taken. Each accepted action is a durable revision.
      for (let n = 0; n < 5 && game.state.prompt.kind !== "main"; n++) {
        const prompt = game.state.prompt as Prompt;
        const action: Action = prompt.kind === "counter"
          ? { type: "counter", player: prompt.player, card: null }
          : prompt.kind === "combo"
            ? { type: "pass", player: prompt.player }
            : (() => { throw new Error(`unexpected prompt ${prompt.kind}`); })();
        game = await applyToGame(db, id, action, undefined, { game, expectedRevision: game.version, request: request(game.version, id * 10 + n) });
      }
      assert.equal(game.state.prompt.kind, "main");
      const row = (await db.select().from(arenaGames).where(eq(arenaGames.id, id)))[0];
      assert.equal(row.version, game.version);
      assert.equal((row.state as VmState).sides.p2.zones.life.length, initial.sides.p2.zones.life.length - 2);
      return game;
    };

    const newGame = await playDamage(ids[0], await load(ids[0]), true);
    assert.equal(damageTaken(newGame.state, "p2"), 2);
    const reloaded = await load(ids[0]);
    assert.equal(damageTaken(reloaded.state, "p2"), 2, "PGlite reload retains the authoritative lifetime count");
    assert.equal(damageTaken(reloaded.state, "p1"), 0);

    // Both seats receive personal board views. The new bookkeeping is used by
    // the server end screen; it is not serialized into the snapshot contract.
    for (const viewer of ["p1", "p2"] as const) {
      const snapshot = await snapshotOfGame(db, reloaded, viewer);
      assert.equal(snapshot.game.you, viewer);
      assert.equal(snapshot.view.them.hand, null);
      assert.equal(snapshot.over, null);
      const serialized = JSON.stringify(snapshot);
      assert.equal(serialized.includes("damageTotals"), false);
      assert.equal(serialized.includes("privateContext"), false);
      // Life just taken as damage is in hand but its move was public in the
      // beat queue. Check cards never shown to this viewer, not all hand ids.
      const privateIds = viewer === "p1"
        ? [findG(reloaded.state, "p2", "hand", "E-LIFE")]
        : (reloaded.state as VmState).sides.p1.zones.hand;
      for (const hidden of privateIds) {
        assert.equal(serialized.includes(`"${hidden}"`), false, "a never-revealed opponent hand id stays hidden");
      }
      assert.deepEqual({ you: damageTaken(reloaded.state, viewer), them: damageTaken(reloaded.state, other(viewer)) }, viewer === "p1" ? { you: 0, them: 2 } : { you: 2, them: 0 });
    }

    await playDamage(ids[1], await load(ids[1]), false);
    const oldReloaded = await load(ids[1]);
    assert.equal(damageTaken(oldReloaded.state, "p2"), null, "a later real hit does not promote an old partial count to a lifetime total");
    assert.equal((oldReloaded.state as VmState).damageTotals, undefined);
  } finally {
    for (const id of ids) await db.delete(arenaGames).where(eq(arenaGames.id, id));
  }
}
