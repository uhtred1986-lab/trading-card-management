/** #680: saved BT31-116 activation keeps its price, choice, revision and privacy. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { arenaGames } from "../../src/db/schema.ts";
import { engineFor } from "../../src/lib/arena/engines.ts";
import { applyToGame, loadGame, mutationFingerprint, StaleGame, type LoadedGame } from "../../src/lib/arena/games.ts";
import { rulesetFor } from "../../src/lib/arena/rulesets/index.ts";
import { snapshotOfGame } from "../../src/lib/arena/session.ts";
import type { Action, EngineContext, PlayerId } from "../../src/lib/arena/types.ts";
import type { VmState } from "../../src/lib/arena/vm/state.ts";
import { moveCard } from "../../src/lib/arena/vm/zones.ts";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness.ts";

const AUTO = "[Auto] Switch 1 of your energy to Hidden Mode: When your <Cell> or <Cell Jr.> card—both white and with an energy cost of 3 or more—is played, activate an [Activate: Main/Battle] skill of up to 1 mono-white Extra with an energy cost of 2 in your hand.";
const defs = { ...DEFS,
  "DB680-LEADER": card("DB680-LEADER", { type: "LEADER", colors: ["White"], energyCost: null, comboCost: null, comboPower: null, skill: AUTO }),
  "DB680-CELL": card("DB680-CELL", { colors: ["White"], characters: ["Cell"], energyCost: 3, skill: null }),
  "DB680-ENERGY": card("DB680-ENERGY", { colors: ["White"], skill: null }),
  "DB680-EXTRA": card("DB680-EXTRA", { type: "EXTRA", colors: ["White"], energyCost: 2, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main/Battle] {r}{1}: Draw 1 card." }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

export async function verifyArenaFreeExtra(db: Db): Promise<void> {
  const rules = rulesetFor("dbs");
  assert.ok(rules.ok);
  const engine = engineFor("rules");
  let state = engine.createGame(ctx, { seed: 6802,
    p1: { name: "Alice", leader: "DB680-LEADER", main: fifty("V1") },
    p2: { name: "Bob", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState;
  state = engine.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) {
    state = engine.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  }
  assert.equal(state.prompt.kind, "main");
  const stage = (cardId: keyof typeof defs, to: "energy" | "hand") => {
    const id = state.sides.p1.zones.deck[0];
    assert.ok(id);
    state.cards[id].cardId = cardId;
    assert.ok(moveCard(state, rules.definition, id, to, { owner: "p1" }).ok);
    return id;
  };
  const energy = Array.from({ length: 4 }, () => stage("DB680-ENERGY", "energy"));
  const cell = stage("DB680-CELL", "hand");
  const extra = stage("DB680-EXTRA", "hand");
  const [created] = await db.insert(arenaGames).values({
    p1Name: "Alice", p2Name: "Bob", p1User: "alice", p2User: "bob",
    seed: 6802, mode: "versus", engine: "rules", state, version: 7,
  }).returning({ id: arenaGames.id });
  const id = created.id;
  try {
    const load = async (): Promise<LoadedGame> => {
      const game = await loadGame(db, id);
      assert.ok(game);
      // Synthetic definitions belong only to this local proof. Every state,
      // prompt, receipt and revision is nevertheless read back from PGlite.
      game.ctx = ctx;
      game.art = {};
      return game;
    };
    const row = async () => (await db.select().from(arenaGames).where(eq(arenaGames.id, id)))[0];
    const request = (revision: number, sequence: number, action: Action) => ({
      actor: "alice", requestId: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      fingerprint: mutationFingerprint({ revision, action }),
    });
    let game = await load();
    const play: Action = { type: "play", player: "p1", card: cell };
    const playRequest = request(game.version, 1, play);
    game = await applyToGame(db, id, play, undefined, { game, expectedRevision: game.version, request: playRequest });
    assert.equal(game.version, 8);
    assert.equal(game.state.prompt.kind, "chooseMode", "the persisted play offers the Auto's own Hidden Mode price");
    assert.ok((game.state as VmState).sides.p1.zones.battle.includes(cell));
    assert.ok((game.state as VmState).sides.p1.zones.hand.includes(extra));
    game = await load(); // JSON reload at the Auto price.
    const beforePrice = await row();
    await assert.rejects(() => applyToGame(db, id, { type: "chooseMode", player: "p2", index: 0 }, undefined,
      { game, expectedRevision: game.version }), /p1's decision|not your|illegal/i);
    await assert.rejects(() => applyToGame(db, id, { type: "chooseMode", player: "p1", index: 0 }, undefined,
      { game, expectedRevision: 7 }), StaleGame);
    assert.deepEqual(await row(), beforePrice, "wrong actor and stale price requests write no state, actions, beats or receipt");

    const pay: Action = { type: "chooseMode", player: "p1", index: 0 };
    const payRequest = request(game.version, 2, pay);
    game = await applyToGame(db, id, pay, undefined, { game, expectedRevision: game.version, request: payRequest });
    assert.equal(game.version, 9);
    assert.equal(game.state.prompt.kind, "chooseCards");
    const paidRow = await row();
    const payReplay = await applyToGame(db, id, pay, undefined, { game: await load(), expectedRevision: 8, request: payRequest });
    assert.equal(payReplay.duplicateRequest, true);
    assert.deepEqual(await row(), paidRow, "duplicating the pay request cannot charge energy twice");

    game = await load();
    const hide: Action = { type: "choose", player: "p1", cards: [energy[3]] };
    game = await applyToGame(db, id, hide, undefined, { game, expectedRevision: game.version, request: request(game.version, 3, hide) });
    assert.equal(game.version, 10);
    assert.equal((game.state as VmState).cards[energy[3]].hidden, true);
    assert.equal(game.state.prompt.kind, "chooseCards", "paying the Auto now offers its optional hand Extra");
    game = await load(); // JSON reload at the private Extra selection.
    for (const viewer of ["p1", "p2"] as const) {
      const projected = await snapshotOfGame(db, game, viewer);
      assert.equal(projected.game.revision, 10);
      assert.equal(projected.game.you, viewer);
      assert.equal(projected.view.them.hand, null);
      if (viewer === "p1") {
        assert.ok(JSON.stringify(projected).includes("DB680-EXTRA"));
        assert.ok(projected.legal.some((item) => item.action.type === "choose" && item.action.cards.includes(extra)));
      } else {
        assert.ok(!JSON.stringify(projected).includes("DB680-EXTRA"), "the opponent cannot inspect the hand Extra or its private choice");
        assert.ok(!projected.legal.some((item) => item.action.type === "choose" && item.action.cards.includes(extra)));
      }
    }
    const beforeExtra = await row();
    await assert.rejects(() => applyToGame(db, id, { type: "choose", player: "p2", cards: [extra] }, undefined,
      { game, expectedRevision: game.version }), /p1's decision|not your|illegal/i);
    await assert.rejects(() => applyToGame(db, id, { type: "choose", player: "p1", cards: [extra] }, undefined,
      { game, expectedRevision: 9 }), StaleGame);
    assert.deepEqual(await row(), beforeExtra, "wrong actor and stale Extra choices cannot spend the card");

    const choose: Action = { type: "choose", player: "p1", cards: [extra] };
    const chooseRequest = request(game.version, 4, choose);
    const deckBefore = (game.state as VmState).sides.p1.zones.deck.length;
    game = await applyToGame(db, id, choose, undefined, { game, expectedRevision: game.version, request: chooseRequest });
    assert.equal(game.version, 11);
    assert.equal(game.state.prompt.kind, "main");
    const finished = game.state as VmState;
    assert.ok(finished.sides.p1.zones.drop.includes(extra));
    assert.ok(!finished.sides.p1.zones.battle.includes(extra));
    assert.equal(finished.sides.p1.zones.deck.length, deckBefore - 1, "the Extra's skill draws exactly once");
    assert.equal(energy.filter((copy) => finished.cards[copy].hidden).length, 1, "the Auto's own price is paid once");
    assert.equal(energy.filter((copy) => finished.cards[copy].mode === "rest").length, 3, "the Extra's original energy and skill costs were waived");
    const beats = game.beats?.list ?? [];
    const drop = beats.findIndex((beat) => beat.t === "move" && beat.card === extra && beat.to === "drop");
    const skill = beats.findIndex((beat) => beat.t === "skill" && beat.card === extra);
    assert.ok(drop >= 0 && skill > drop, "the Extra moves to Drop before its skill activates");
    assert.equal(beats.filter((beat) => beat.t === "skill" && beat.card === extra).length, 1);
    assert.equal(beats.filter((beat) => beat.t === "draw" && beat.player === "p1").length, 1);
    const completedRow = await row();
    const chooseReplay = await applyToGame(db, id, choose, undefined,
      { game: await load(), expectedRevision: 10, request: chooseRequest });
    assert.equal(chooseReplay.duplicateRequest, true);
    assert.deepEqual(await row(), completedRow, "duplicate Extra choice changes no state, draw, beat or receipt");
  } finally {
    await db.delete(arenaGames).where(eq(arenaGames.id, id));
  }
  console.log("#680 saved free Extra: payment, choice, CAS, duplicate requests and both viewer projections passed");
}
