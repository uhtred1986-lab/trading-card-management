/**
 * #538 owner's ruling (4 Oct 2026): BT3-109 pays exactly five Warp cards or
 * declines; with fewer the cost cannot be paid. The printed BT6-062 / SD8-03
 * "may choose 2 … If you do" is the same optional exact choice (20-16).
 * Catalog text: saved public-card snapshot, 15 Oct 2026. Synthetic leaders,
 * payoff cards and pending moments isolate the complete real Auto programs.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { compileCard, compileSkill } from "../../src/lib/arena/compile";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { run } from "../../src/lib/arena/vm/flow";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { stepScript, type Op, type ScriptFrame } from "../../src/lib/arena/vm/script";
import { vmHost } from "../../src/lib/arena/vm/host";
import type { Action, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const printed = {
  "BT3-109": "[Xeno-Evolve] ⑤: <Bardock: Xeno> (Play this card in Active Mode by sending the specified card from your Battle Area to your Warp)<br>[Triple Strike] (This card inflicts 3 damage instead of 1 when attacking)<br>[Auto] When a card evolves into this card, if your Leader Card is black, you may choose 5 cards from your Warp and place them in the Drop Area. If you do so, send all of your opponent's Battle Cards to their Warp.",
  "BT6-062": "[Activate: Battle][Once per turn] Choose 1 card from your hand and place it in your Drop Area: Choose up to 1 of your opponent's Battle Cards with an energy cost of 3 or less and KO it.<br>[Auto] When this card is removed from a Battle Area by a skill or KO'd, and if your Leader Card is a green ≪Frieza's Army≫ card, you may choose 2 cards from your hand and place them in your Drop Area. If you do, choose up to 1 green <Broly: Br> card with an energy cost of 6 from your hand and play it.",
  "SD8-03": "[Critical] (When this card inflicts damage to your opponent's life, they place that many cards in their Drop Area instead of their hand.)<br>[Auto] When this card is removed from a Battle Area by a skill or KO'd, you may choose 2 cards from your hand and place them in your Drop Area. If you do, choose up to 1 green <Broly: Br> card with an energy cost of 7 from your hand and play it.",
};
const defs = { ...DEFS,
  EXACT538BLACK: card("EXACT538BLACK", { type: "LEADER", colors: ["Black"], skill: null, energyCost: null }),
  EXACT538GREEN: card("EXACT538GREEN", { type: "LEADER", colors: ["Green"], traits: ["Frieza's Army"], skill: null, energyCost: null }),
  "BT3-109": card("BT3-109", { colors: ["Black"], skill: printed["BT3-109"] }),
  "BT6-062": card("BT6-062", { colors: ["Green"], skill: printed["BT6-062"] }),
  "SD8-03": card("SD8-03", { colors: ["Green"], skill: printed["SD8-03"] }),
  EXACT538BROLY6: card("EXACT538BROLY6", { colors: ["Green"], characters: ["Broly: Br"], energyCost: 6, skill: null }),
  EXACT538BROLY7: card("EXACT538BROLY7", { colors: ["Green"], characters: ["Broly: Br"], energyCost: 7, skill: null }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, action: Action) => RULES.apply(ctx, reload(s), action).state as VmState;
const choose = (s: VmState, cards: string[]) => apply(s, { type: "choose", player: "p1", cards });
const mode = (s: VmState, index: number) => apply(s, { type: "chooseMode", player: "p1", index });
const candidates = (s: VmState) => s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : [];
const snapshot = (s: VmState, viewer: PlayerId) => buildSnapshot({ id: 538, mode: "versus", status: "playing", p1Name: "P1", p2Name: "P2", ctx, state: s, legal: RULES.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
function stage(s: VmState, cardId: string, area: string, p: PlayerId = "p1") {
  const id = s.sides[p].zones.deck[0]; assert.ok(id);
  s.cards[id].cardId = cardId;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok);
  return id;
}
function board(cardId: keyof typeof printed, available: number, extra = 0) {
  const bardock = cardId === "BT3-109";
  let s = RULES.createGame(ctx, { seed: 538, p1: { name: "P1", leader: bardock ? "EXACT538BLACK" : "EXACT538GREEN", main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = apply(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.prompt.kind, "main");
  for (const id of s.sides.p1.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { position: "bottom" }).ok);
  const source = stage(s, cardId, bardock ? "battle" : "drop");
  const paid = Array.from({ length: available }, () => stage(s, "V1", bardock ? "warp" : "hand"));
  for (let i = 0; i < extra; i++) paid.push(stage(s, "V1", bardock ? "warp" : "hand"));
  const target = stage(s, "V-BLUE", "battle", "p2");
  const broly = !bardock && available >= 2 ? stage(s, cardId === "BT6-062" ? "EXACT538BROLY6" : "EXACT538BROLY7", "hand") : null;
  s.pending.push({ card: source, master: "p1", skillIndex: bardock ? 20 : 10, trigger: bardock ? "evolvedInto" : "removedFromBattle" });
  run(ctx, game, s, []);
  return { s, source, paid, target, broly, bardock };
}

for (const cardId of Object.keys(printed) as (keyof typeof printed)[]) {
  const count = cardId === "BT3-109" ? 5 : 2;
  const skill = compileCard(defs[cardId]).bySkill[cardId === "BT3-109" ? 20 : 10];
  assert.deepEqual(skill.unsupported, [], `${cardId}: the whole printed Auto reads`);
  for (const available of [0, count - 1]) {
    const b = board(cardId, available);
    assert.equal(b.s.prompt.kind, "main", `${cardId}: with ${available} candidates no offer is made`);
    assert.ok(b.paid.every((id) => b.s.sides.p1.zones[b.bardock ? "warp" : "hand"].includes(id)), "an unaffordable optional payment moves nothing");
    assert.ok(b.s.sides.p2.zones.battle.includes(b.target), "no unpaid payoff");
    assert.equal(b.s.sides.p1.zones.battle.filter((id) => b.s.cards[id].cardId.startsWith("EXACT538BROLY")).length, 0);
  }
  {
    const b = board(cardId, count);
    assert.equal(b.s.prompt.kind, "chooseMode", "the full payment can be declined before choosing cards");
    const declined = mode(b.s, 1);
    assert.equal(declined.prompt.kind, "main");
    assert.ok(b.paid.every((id) => declined.sides.p1.zones[b.bardock ? "warp" : "hand"].includes(id)));
    assert.ok(declined.sides.p2.zones.battle.includes(b.target));
    if (b.broly) assert.ok(declined.sides.p1.zones.hand.includes(b.broly));
  }
  {
    const b = board(cardId, count, 2);
    let s = mode(b.s, 0);
    assert.equal(s.prompt.kind, "chooseCards");
    assert.equal(s.prompt.kind === "chooseCards" && s.prompt.choice.min, 1);
    assert.throws(() => choose(s, []), "accepting an exact offer cannot immediately stop");
    for (const viewer of ["p1", "p2"] as const) assert.deepEqual(snapshot(s, viewer), snapshot(reload(s), viewer), "both projections survive the saved payment prompt");
    if (!b.bardock) for (const id of [...b.paid, b.broly!]) assert.ok(!JSON.stringify(snapshot(s, "p2")).includes(id), "the opponent cannot see hand-payment identities");
    for (let i = 0; i < count; i++) {
      if (i < count - 1) {
        s = choose(s, [b.paid[i]]);
        assert.throws(() => choose(s, []), "a partial saved payment cannot stop short");
        const forged = reload(s); forged.lastChoice = [];
        const pending = forged.programs[0]; assert.ok(pending);
        assert.throws(() => stepScript(vmHost(ctx, game, forged, []), pending), /exact choice still requires a card/, "a restored empty answer cannot bypass the public action validator");
        assert.ok(b.paid.every((id) => s.sides.p1.zones[b.bardock ? "warp" : "hand"].includes(id)), "no card moves while the exact selection is incomplete");
      } else s = choose(s, [b.paid[i]]);
    }
    assert.ok(b.paid.slice(0, count).every((id) => s.sides.p1.zones.drop.includes(id)), "all N payments move together");
    assert.ok(b.paid.slice(count).every((id) => s.sides.p1.zones[b.bardock ? "warp" : "hand"].includes(id)), "unselected cards stay");
    if (b.bardock) {
      assert.ok(s.sides.p2.zones.warp.includes(b.target), "Bardock's full payment warps the opposing board");
      assert.equal(s.prompt.kind, "main");
    } else {
      assert.deepEqual(candidates(s), [b.broly], "only the correct-cost Broly is offered after full payment");
      s = choose(s, [b.broly!]);
      assert.ok(s.sides.p1.zones.battle.includes(b.broly!));
      assert.equal(s.prompt.kind, "main");
    }
  }
}

// The exact candidate count is taken only after acceptance; it is never paid automatically.
{
  const b = board("BT3-109", 5);
  assert.equal(b.s.prompt.kind, "chooseMode");
  const s = mode(b.s, 0);
  assert.ok(b.paid.every((id) => s.sides.p1.zones.drop.includes(id)));
  assert.ok(s.sides.p2.zones.warp.includes(b.target));
}
// Mandatory exact effects still do as much as possible; printed "up to" still permits one.
for (const [text, optional] of [["[Auto] When this card attacks, choose 2 cards from your Warp and place them in your Drop Area.", false], ["[Auto] When this card attacks, you may choose up to 2 cards from your Warp and place them in your Drop Area.", true]] as const) {
  const b = board("BT3-109", 1); b.s.flow = [];
  const compiled = compileSkill(parseSkills(text)[0]); assert.deepEqual(compiled.unsupported, []);
  const frame: ScriptFrame = { ops: compiled.ops, ip: 0, vars: {}, master: "p1", card: b.source };
  const first = stepScript(vmHost(ctx, game, b.s, []), frame);
  if (optional) {
    assert.equal(first, "wait");
    b.s.lastChoice = [b.paid[0]];
    assert.equal(stepScript(vmHost(ctx, game, b.s, []), frame), "done");
  } else assert.equal(first, "done");
  assert.ok(b.s.sides.p1.zones.drop.includes(b.paid[0]));
}
// An offer with an earlier operation that creates its candidates cannot be prechecked against
// the current board; the exact-choice check is restricted to the first instruction.
{
  const b = board("BT3-109", 0); b.s.flow = [];
  const ops: Op[] = [{ op: "may", ops: [{ op: "draw", n: 2 }, { op: "choose", sel: { side: "you", area: "hand", count: 2 }, as: "drawn" }] }];
  assert.equal(stepScript(vmHost(ctx, game, b.s, []), { ops, ip: 0, vars: {}, master: "p1", card: b.source }), "wait");
}
// A pool already bound by an earlier look/choice is known now. Use the live frame's variables,
// rather than the empty variables a replacement-offer preflight would construct.
for (const available of [1, 2]) {
  const b = board("BT3-109", available); b.s.flow = [];
  const ops: Op[] = [{ op: "may", ops: [{ op: "choose", sel: { fromVar: "pool", count: 2 }, as: "picked" }] }];
  const frame: ScriptFrame = { ops, ip: 0, vars: { pool: b.paid }, master: "p1", card: b.source };
  assert.equal(stepScript(vmHost(ctx, game, b.s, []), frame), available === 2 ? "wait" : "done", "offer eligibility reads an already-selected pool");
  assert.deepEqual(frame.vars.pool, b.paid, "preflight never consumes the captured pool");
}
console.log("optional-exact-538: ok — three printed Autos, affordable full-or-decline payments, saved partial choices and privacy");
