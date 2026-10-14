/**
 * #677: a saved game paying two 20-14 activation prices — EX06-35's hand card
 * and BT23-140's two Active Mode cards — on a Battle Card's [Activate], read
 * back from PGlite at every question: revision/CAS, wrong actor, duplicate
 * requests, the prices charged once each, and both viewers' projections.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { Db } from "../../src/db/index.ts";
import { arenaGames } from "../../src/db/schema.ts";
import { RULES } from "../../src/lib/arena/vm/index.ts";
import { applyToGame, loadGame, mutationFingerprint, StaleGame, type LoadedGame } from "../../src/lib/arena/games.ts";
import { rulesetFor } from "../../src/lib/arena/rulesets/index.ts";
import { snapshotOfGame } from "../../src/lib/arena/session.ts";
import { parseSkills } from "../../src/lib/arena/text/cards.ts";
import type { Action, EngineContext, PlayerId } from "../../src/lib/arena/types.ts";
import type { VmState } from "../../src/lib/arena/vm/state.ts";
import { moveCard } from "../../src/lib/arena/vm/zones.ts";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness.ts";

const defs = { ...DEFS,
  "EX06-35": card("EX06-35", { name: "Fu, the Dark Banisher", colors: ["Black"], energyCost: 8, power: 25000, comboCost: 1, comboPower: 10000,
    skill: "[triple attack]<br>[over realm 8] {4}<br>[permanent] Your opponent can't activate skills unless they choose 1 card in their hand and send it to their Warp." }),
  "BT23-140": card("BT23-140", { name: "Ultra Instinct Son Goku, State of the Gods", colors: ["Yellow"], energyCost: 8, power: 45000, comboCost: 1, comboPower: 10000,
    skill: "[ultimate][victory strike]<br>[permanent] This card isn't affected by the skills of opponent's cards other than Battle Cards.<br>[permanent] Your opponent can't activate the skills of Battle Cards in any Area unless they switch 2 of their Active Mode cards to Rest Mode as an additional skill cost.<br>[activate: main]{y}{y}{y}{y}, if your Leader is yellow, you have 5 or more energy, and you have 10 or more cards in your Z-Energy: Play this card from your hand." }),
  "DB677-DRAW": card("DB677-DRAW", { energyCost: 1, skill: "[Activate: Main] Draw 1 card." }),
  "DB677-FODDER": card("DB677-FODDER", { energyCost: 9, skill: null }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

export async function verifyArenaActivationTaxes(db: Db): Promise<void> {
  const rules = rulesetFor("dbs");
  assert.ok(rules.ok);
  const engine = RULES;
  let state = engine.createGame(ctx, { seed: 6770,
    p1: { name: "Alice", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Bob", leader: "L-BLUE", main: fifty("V-BLUE") },
  }).state as VmState;
  state = engine.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) {
    state = engine.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  }
  assert.equal(state.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) for (const id of [...state.sides[p].zones.hand]) assert.ok(moveCard(state, rules.definition, id, "deck", { owner: p }).ok);
  const stage = (p: PlayerId, cardId: keyof typeof defs, to: "battle" | "hand") => {
    const id = state.sides[p].zones.deck[0];
    assert.ok(id);
    state.cards[id].cardId = cardId;
    assert.ok(moveCard(state, rules.definition, id, to, { owner: p }).ok);
    state.pending = [];
    return id;
  };
  stage("p2", "EX06-35", "battle");
  stage("p2", "BT23-140", "battle");
  const user = stage("p1", "DB677-DRAW", "battle");
  const spare = stage("p1", "DB677-FODDER", "battle");
  const [f1, f2] = [stage("p1", "DB677-FODDER", "hand"), stage("p1", "DB677-FODDER", "hand")];
  const leader = state.sides.p1.zones.leader[0];
  const [created] = await db.insert(arenaGames).values({
    p1Name: "Alice", p2Name: "Bob", p1User: "alice", p2User: "bob",
    seed: 6770, mode: "versus", engine: "rules", state, version: 3,
  }).returning({ id: arenaGames.id });
  const id = created.id;
  try {
    const load = async (): Promise<LoadedGame> => {
      const game = await loadGame(db, id);
      assert.ok(game);
      game.ctx = ctx;
      game.art = {};
      return game;
    };
    const row = async () => (await db.select().from(arenaGames).where(eq(arenaGames.id, id)))[0];
    const request = (revision: number, sequence: number, action: Action) => ({
      actor: "alice", requestId: `00000000-0000-4000-8677-${String(sequence).padStart(12, "0")}`,
      fingerprint: mutationFingerprint({ revision, action }),
    });
    const skill = parseSkills(defs["DB677-DRAW"].skill!).find((k) => k.kind === "activate:main")!.index;

    // Declared: the first price (a hand card) is asked, the skill waits.
    let game = await load();
    const use: Action = { type: "activate", player: "p1", card: user, skill };
    game = await applyToGame(db, id, use, undefined, { game, expectedRevision: game.version, request: request(game.version, 1, use) });
    assert.equal(game.version, 4);
    assert.equal(game.state.prompt.kind, "chooseCards", "EX06-35's price is asked");
    const deckBefore = (game.state as VmState).sides.p1.zones.deck.length;

    // Reloaded at the private hand question: the payer sees it, the opponent does not.
    game = await load();
    for (const viewer of ["p1", "p2"] as const) {
      const projected = await snapshotOfGame(db, game, viewer);
      assert.equal(projected.game.revision, 4);
      if (viewer === "p1") {
        assert.ok(JSON.stringify(projected).includes("DB677-FODDER"));
        assert.ok(projected.legal.some((item) => item.action.type === "choose" && item.action.cards.includes(f1)));
      } else {
        assert.equal(projected.view.them.hand, null);
        assert.ok(!projected.legal.some((item) => item.action.type === "choose"), "the opponent is offered nothing");
        assert.ok(!JSON.stringify(projected.view.prompt ?? null).includes(f1), "nor told which cards could pay");
      }
    }
    const beforePrice = await row();
    await assert.rejects(() => applyToGame(db, id, { type: "choose", player: "p2", cards: [f1] }, undefined, { game, expectedRevision: game.version }), /p1's decision|not your|illegal/i);
    await assert.rejects(() => applyToGame(db, id, { type: "choose", player: "p1", cards: [f1] }, undefined, { game, expectedRevision: 3 }), StaleGame);
    assert.deepEqual(await row(), beforePrice, "wrong actor and stale answers write nothing");

    const payHand: Action = { type: "choose", player: "p1", cards: [f2] };
    const payHandRequest = request(game.version, 2, payHand);
    game = await applyToGame(db, id, payHand, undefined, { game, expectedRevision: game.version, request: payHandRequest });
    assert.equal(game.version, 5);
    assert.equal(game.state.prompt.kind, "chooseCards", "then BT23-140's price, re-read live");
    const paidRow = await row();
    const replay = await applyToGame(db, id, payHand, undefined, { game: await load(), expectedRevision: 4, request: payHandRequest });
    assert.equal(replay.duplicateRequest, true);
    assert.deepEqual(await row(), paidRow, "a duplicate request cannot charge the hand price twice");

    // The two Active Mode cards, one question each, across reloads.
    game = await load();
    const rest1: Action = { type: "choose", player: "p1", cards: [leader] };
    game = await applyToGame(db, id, rest1, undefined, { game, expectedRevision: game.version, request: request(game.version, 3, rest1) });
    game = await load();
    const rest2: Action = { type: "choose", player: "p1", cards: [spare] };
    const rest2Request = request(game.version, 4, rest2);
    game = await applyToGame(db, id, rest2, undefined, { game, expectedRevision: game.version, request: rest2Request });
    assert.equal(game.state.prompt.kind, "main");
    const done = game.state as VmState;
    assert.deepEqual(done.sides.p1.zones.warp, [f2], "EX06-35's price, once");
    assert.ok(done.sides.p1.zones.hand.includes(f1));
    assert.deepEqual([done.cards[leader].mode, done.cards[spare].mode, done.cards[user].mode], ["rest", "rest", "active"], "BT23-140's price, once");
    assert.equal(done.sides.p1.zones.deck.length, deckBefore - 1, "the skill draws once, after both prices");
    const beats = game.beats?.list ?? [];
    const warp = beats.findIndex((beat) => beat.t === "move" && beat.card === f2 && beat.to === "warp");
    const draw = beats.findIndex((beat) => beat.t === "draw" && beat.player === "p1");
    assert.ok(warp >= 0 && draw > warp, "paid before the effect");
    const finishedRow = await row();
    const again = await applyToGame(db, id, rest2, undefined, { game: await load(), expectedRevision: game.version - 1, request: rest2Request });
    assert.equal(again.duplicateRequest, true);
    assert.deepEqual(await row(), finishedRow, "a duplicate last answer changes nothing");
  } finally {
    await db.delete(arenaGames).where(eq(arenaGames.id, id));
  }
  console.log("#677 saved activation taxes: two prices live, CAS, duplicate requests and both viewer projections passed");
}
