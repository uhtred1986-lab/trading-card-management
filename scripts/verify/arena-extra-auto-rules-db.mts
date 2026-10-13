/** #683: a persisted, legally triggered rules-engine Extra Auto and its keyword hook. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { arenaGames } from "../../src/db/schema.ts";
import { RULES } from "../../src/lib/arena/vm/index.ts";
import { applyToGame, loadGame, mutationFingerprint, RequestIdentityConflict, StaleGame, type LoadedGame } from "../../src/lib/arena/games.ts";
import { snapshotOfGame } from "../../src/lib/arena/session.ts";
import { rulesetFor } from "../../src/lib/arena/rulesets/index.ts";
import { moveCard } from "../../src/lib/arena/vm/zones.ts";
import type { VmState } from "../../src/lib/arena/vm/state.ts";
import type { Action, EngineContext, PlayerId } from "../../src/lib/arena/types.ts";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness.ts";

const defs = { ...DEFS,
  "DB683-RULES-FIELD": card("DB683-RULES-FIELD", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null,
    skill: "[Field]<br>[Villainous]<br>[Auto] {r}: When this card is placed in a Battle Area, draw 1 card." }),
  "DB683-RULES-SECRET": card("DB683-RULES-SECRET", { skill: null }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

export async function verifyArenaExtraAutoRules(db: Db): Promise<void> {
  const rules = rulesetFor("dbs");
  assert.ok(rules.ok);
  const engine = RULES;
  let state = engine.createGame(ctx, { seed: 68302,
    p1: { name: "Alice", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Bob", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState;
  state = engine.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) {
    const action = engine.legalActions(ctx, state)[0]?.action;
    assert.ok(action);
    state = engine.apply(ctx, state, action).state as VmState;
  }
  assert.equal(state.prompt.kind, "main");
  const extra = state.sides.p1.zones.hand[0];
  const secret = state.sides.p2.zones.hand[0];
  assert.ok(extra && secret);
  state.cards[extra].cardId = "DB683-RULES-FIELD";
  state.cards[secret].cardId = "DB683-RULES-SECRET";
  // The native optional cost requires an active red energy. The zero-cost
  // Field activation itself has no energy price.
  for (const existing of state.sides.p1.zones.energy) state.cards[existing].mode = "rest";
  const energy = state.sides.p1.zones.hand.find((id) => id !== extra);
  assert.ok(energy);
  assert.ok(moveCard(state, rules.definition, energy, "energy", { owner: "p1" }).ok);
  assert.equal(state.cards[energy].mode, "active");
  const [created] = await db.insert(arenaGames).values({
    p1Name: "Alice", p2Name: "Bob", p1User: "alice", p2User: "bob",
    seed: 68302, mode: "versus", engine: "rules", state, version: 7,
  }).returning({ id: arenaGames.id });
  const id = created.id;
  try {
    const load = async (): Promise<LoadedGame> => {
      const game = await loadGame(db, id);
      assert.ok(game);
      // Only definitions and compiled rows are synthetic. Each state, prompt,
      // revision, receipt and beat below came back from the persisted game.
      game.ctx = ctx;
      game.art = {};
      return game;
    };
    const row = async () => (await db.select().from(arenaGames).where(eq(arenaGames.id, id)))[0];
    const request = (revision: number, sequence: number, action: Action, actor = "alice") => ({
      actor, requestId: `00000000-0000-4000-8000-${String(683100 + sequence).padStart(12, "0")}`,
      fingerprint: mutationFingerprint({ revision, action }),
    });
    const assertViewer = async (game: LoadedGame, actor: PlayerId, expectedWaiting: "you" | "opponent", choice = false, secretPublic = false) => {
      const snapshot = await snapshotOfGame(db, game, actor);
      assert.equal(snapshot.game.revision, game.version);
      assert.equal(snapshot.game.you, actor);
      assert.equal(snapshot.waiting, expectedWaiting);
      assert.equal(snapshot.view.them.hand, null);
      assert.ok(!JSON.stringify(snapshot).includes("afterSkillKeyword"), "private pending identity is not projected");
      assert.ok(!JSON.stringify(snapshot).includes("pendingHookSkill"), "internal hook-frame identity is not projected");
      assert.ok(!JSON.stringify(snapshot).includes("continuations"), "saved continuation state is not projected");
      if (actor === "p1") {
        assert.equal(JSON.stringify(snapshot).includes("DB683-RULES-SECRET"), secretPublic,
          "the opponent's card becomes public only after the discard");
      } else {
        assert.ok(JSON.stringify(snapshot).includes("DB683-RULES-SECRET"), "owner can identify the card to discard");
      }
      if (choice) assert.equal(snapshot.legal.some((entry) => entry.action.type === "choose" && entry.action.cards.includes(secret)), actor === "p2");
      return snapshot;
    };

    let game = await load();
    const field = game.legal.find((entry) => entry.action.type === "activate" && entry.action.card === extra)?.action;
    assert.ok(field, "[Field] is genuinely offered from hand");
    const fieldRequest = request(game.version, 1, field);
    game = await applyToGame(db, id, field, undefined, { game, expectedRevision: game.version, request: fieldRequest });
    assert.equal(game.version, 8);
    assert.equal(game.state.prompt.kind, "chooseMode", "arrival Auto reaches its native price prompt");
    assert.ok((game.state as VmState).sides.p1.zones.battle.includes(extra));
    assert.equal((game.state as VmState).cards[energy].mode, "active", "the Auto price has not yet been paid");
    assert.deepEqual((game.state as VmState).effects.filter((effect) => effect.kind === "negateSkill" && effect.target === extra), []);
    const fieldRow = await row();
    const fieldReplay = await applyToGame(db, id, field, undefined, { game: await load(), expectedRevision: 7, request: fieldRequest });
    assert.equal(fieldReplay.duplicateRequest, true);
    assert.deepEqual(await row(), fieldRow, "duplicate Field activation cannot pend a second Auto");
    game = await load();
    const p1Price = await assertViewer(game, "p1", "you");
    const p2Price = await assertViewer(game, "p2", "opponent");
    assert.ok(p1Price.legal.some((entry) => entry.action.type === "chooseMode" && entry.action.index === 0));
    assert.deepEqual(p2Price.legal, []);
    const priceRow = await row();
    await assert.rejects(() => applyToGame(db, id, { type: "chooseMode", player: "p2", index: 0 }, undefined,
      { game, expectedRevision: game.version }), /p1's decision|not your|illegal/i);
    await assert.rejects(() => applyToGame(db, id, { type: "chooseMode", player: "p1", index: 0 }, undefined,
      { game, expectedRevision: 7 }), StaleGame);
    assert.deepEqual(await row(), priceRow, "wrong actor and stale price action write no state, beat or receipt");

    const pay: Action = { type: "chooseMode", player: "p1", index: 0 };
    const payRequest = request(game.version, 2, pay);
    game = await applyToGame(db, id, pay, undefined, { game, expectedRevision: game.version, request: payRequest });
    assert.equal(game.version, 9);
    assert.equal(game.state.prompt.kind, "chooseCards", "the Auto effect and Heroic finish before Villainous choice");
    assert.equal((game.state.prompt as { player: PlayerId }).player, "p2");
    assert.equal((game.state as VmState).cards[energy].mode, "rest");
    assert.ok((game.state as VmState).programs.some((frame) => frame.card === extra && frame.pendingHookSkill && frame.skillIndex === 10),
      "the individually identified Villainous hook survives the saved opponent choice");
    assert.deepEqual((game.state as VmState).pending, []);
    const priceBeats = game.beats?.list ?? [];
    const restBeat = priceBeats.findIndex((beat) => beat.t === "mode" && beat.card === energy && beat.mode === "rest");
    const autoBeat = priceBeats.findIndex((beat, index) => index > restBeat && beat.t === "skill" && beat.card === extra);
    const draws = priceBeats.flatMap((beat, index) => beat.t === "draw" && beat.player === "p1" ? [index] : []);
    assert.equal(draws.length, 1, "the Extra Auto effect draws exactly once before Villainous");
    assert.ok(restBeat >= 0 && restBeat < autoBeat && autoBeat < draws[0]);
    const paidRow = await row();
    const payReplay = await applyToGame(db, id, pay, undefined, { game: await load(), expectedRevision: 8, request: payRequest });
    assert.equal(payReplay.duplicateRequest, true);
    assert.deepEqual(await row(), paidRow, "duplicate payment cannot charge, draw or spend twice");
    await assert.rejects(async () => applyToGame(db, id, pay, undefined,
      { game: await load(), expectedRevision: 8, request: { ...payRequest, fingerprint: mutationFingerprint({ revision: 8, action: { ...pay, index: 1 } }) } }),
      RequestIdentityConflict);
    assert.deepEqual(await row(), paidRow, "conflicting request fingerprint changes nothing");

    game = await load();
    const p1Choice = await assertViewer(game, "p1", "opponent", true);
    const p2Choice = await assertViewer(game, "p2", "you", true);
    assert.deepEqual(p1Choice.legal, []);
    assert.ok(p2Choice.legal.some((entry) => entry.action.type === "choose" && entry.action.cards.includes(secret)));
    const choiceRow = await row();
    const choose: Action = { type: "choose", player: "p2", cards: [secret] };
    await assert.rejects(() => applyToGame(db, id, { ...choose, player: "p1" }, undefined,
      { game, expectedRevision: game.version }), /p2's decision|not your|illegal/i);
    await assert.rejects(() => applyToGame(db, id, choose, undefined,
      { game, expectedRevision: 8 }), StaleGame);
    assert.deepEqual(await row(), choiceRow);
    const choiceRequest = request(game.version, 3, choose, "bob");
    game = await applyToGame(db, id, choose, undefined, { game, expectedRevision: game.version, request: choiceRequest });
    assert.equal(game.version, 10);
    assert.equal(game.state.prompt.kind, "main");
    const completed = game.state as VmState;
    assert.ok(completed.sides.p2.zones.drop.includes(secret));
    assert.deepEqual(completed.pending, []);
    assert.deepEqual(completed.programs, []);
    assert.deepEqual(completed.effects.filter((effect) => effect.kind === "negateSkill" && effect.target === extra)
      .map((effect) => effect.value), [10]);
    const beats = game.beats?.list ?? [];
    assert.equal(beats.filter((beat) => beat.t === "skill" && beat.card === extra).length, 2, "one Field and one Auto activation");
    assert.equal(beats.filter((beat) => beat.t === "draw" && beat.player === "p1").length, 1);
    assert.equal(beats.filter((beat) => beat.t === "move" && beat.card === secret && beat.to === "drop").length, 1);
    assert.equal(game.actionReceipts.length, 3);
    const finishedRow = await row();
    const choiceReplay = await applyToGame(db, id, choose, undefined, { game: await load(), expectedRevision: 9, request: choiceRequest });
    assert.equal(choiceReplay.duplicateRequest, true);
    assert.deepEqual(await row(), finishedRow, "duplicate opponent choice cannot discard or emit another beat");
    const firstSeat = await assertViewer(await load(), "p1", "you", false, true);
    const secondSeat = await assertViewer(await load(), "p2", "opponent", false, true);
    assert.equal(firstSeat.beats?.seq, secondSeat.beats?.seq, "both viewers receive one public resolution");
    assert.equal(firstSeat.beats?.list.filter((beat) => beat.t === "skill" && beat.card === extra).length, 2);
  } finally {
    await db.delete(arenaGames).where(eq(arenaGames.id, id));
  }
  console.log("#683 persisted rules Extra Auto: native price, own Villainous, CAS, receipts and both seat projections passed");
}
