/**
 * BT6-063, official card list verified 14 Oct 2026:
 * https://www.dbs-cardgame.com/us-en/cardlist/index.php?free=BT6-063&search=true
 * Icons/brackets and colon spacing are normalized to the catalog's [Auto], ≪trait≫ and <character>.
 * 0-2-10-1 and 5-2-2–6: one or two is a bounded choice, with as many as
 * possible when Life is insufficient. Synthetic Leaders/fodder isolate the
 * printed Battle Card's complete skill; no database records are read or changed.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { compileCard } from "../../src/lib/arena/compile";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { canonical, parseRule, printRule, validateRule } from "../../src/lib/arena/lang";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { describeScript, stepScript, validateProgram, type Op, type ScriptFrame } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, EngineContext, PlayerId } from "../../src/lib/arena/types";

const PRINTED = "[Auto] When you play this card from your hand and if your Leader Card is a green ≪Frieza's Army≫ card, choose 2 cards from your life and add them to your hand.<br>[Auto] When this card is removed from a Battle Area by a skill or KO'd, and if your Leader Card is a green ≪Frieza's Army≫ card, choose 1 or 2 cards from your life and add them to your hand, then choose up to 1 green <Broly: Br> card with an energy cost of 4 from your hand and play it.";
const defs = { ...DEFS,
  "BT6-063": card("BT6-063", { name: "Broly, Unrealized Ambition", colors: ["Green"], characters: ["Broly: Br"], traits: ["Saiyan", "Frieza's Army"], skill: PRINTED }),
  "LEADER820-KO": card("LEADER820-KO", { type: "LEADER", colors: ["Green"], traits: ["Frieza's Army"], energyCost: null, skill: "[Activate: Main] Choose 1 of your Battle Cards and KO it." }),
  "LEADER820-REMOVE": card("LEADER820-REMOVE", { type: "LEADER", colors: ["Green"], traits: ["Frieza's Army"], energyCost: null, skill: "[Activate: Main] Choose 1 of your Battle Cards and place it in its owner's Drop Area." }),
  "LEADER820-WRONG": card("LEADER820-WRONG", { type: "LEADER", colors: ["Blue"], traits: ["Frieza's Army"], energyCost: null, skill: "[Activate: Main] Choose 1 of your Battle Cards and KO it." }),
  "LEADER820-NOTARMY": card("LEADER820-NOTARMY", { type: "LEADER", colors: ["Green"], traits: ["Saiyan"], energyCost: null, skill: "[Activate: Main] Choose 1 of your Battle Cards and KO it." }),
  "BROLY820": card("BROLY820", { colors: ["Green"], characters: ["Broly: Br"], energyCost: 4 }),
  "BROLY820-COST3": card("BROLY820-COST3", { colors: ["Green"], characters: ["Broly: Br"], energyCost: 3 }),
  "BROLY820-BLUE": card("BROLY820-BLUE", { colors: ["Blue"], characters: ["Broly: Br"], energyCost: 4 }),
  "BROLY820-OTHER": card("BROLY820-OTHER", { colors: ["Green"], characters: ["Broly"], energyCost: 4 }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, a: Action) => RULES.apply(ctx, reload(s), a) as { state: VmState };
const candidates = (s: VmState) => s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : [];
const choose = (s: VmState, cards: string[], p: PlayerId = "p1") => apply(s, { type: "choose", player: p, cards }).state;
const snapshot = (s: VmState, viewer: PlayerId) => buildSnapshot({ id: 820, mode: "versus", status: "playing", p1Name: "P1", p2Name: "P2", ctx, state: s, legal: RULES.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });

function stage(s: VmState, id: keyof typeof defs, area: "battle" | "hand" | "life" | "drop", p: PlayerId = "p1"): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
function board(life = 3, leader: keyof typeof defs = "LEADER820-KO", opts: { noBroly?: boolean; brolyLife?: boolean } = {}) {
  let s = RULES.createGame(ctx, { seed: 820, p1: { name: "P1", leader, main: fifty("V1") }, p2: { name: "P2", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = apply(s, { type: "chooseFirst", player: (s.prompt as { player: PlayerId }).player, first: "p1" }).state;
  s = apply(s, { type: "mulligan", player: "p1", redraw: false }).state;
  s = apply(s, { type: "mulligan", player: "p2", redraw: false }).state;
  s = apply(s, { type: "charge", player: "p1", card: null }).state;
  for (const id of s.sides.p1.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { position: "bottom" }).ok);
  while (s.sides.p1.zones.life.length > life) assert.ok(moveCard(s, game, s.sides.p1.zones.life.at(-1)!, "deck", { position: "bottom" }).ok);
  const source = stage(s, "BT6-063", "battle");
  const broly = stage(s, "BROLY820", "hand");
  const wrong = [stage(s, "BROLY820-COST3", "hand"), stage(s, "BROLY820-BLUE", "hand"), stage(s, "BROLY820-OTHER", "hand")];
  const dropBroly = stage(s, "BROLY820", "drop");
  const lifeIds = [...s.sides.p1.zones.life];
  if (opts.noBroly || opts.brolyLife) assert.ok(moveCard(s, game, broly, "deck", { position: "bottom" }).ok);
  if (opts.brolyLife) s.cards[lifeIds[0]].cardId = "BROLY820";
  s = apply(s, { type: "activate", player: "p1", card: s.sides.p1.zones.leader[0], skill: 0 }).state;
  return { s, source, broly, wrong, dropBroly, lifeIds };
}

const skill = compileCard(defs["BT6-063"]).bySkill[10];
assert.deepEqual(skill.unsupported, [], "BT6-063 #10 is completely readable");
assert.match(describeScript(skill.ops), /choose 1 to 2 cards in your Life Area/);
assert.ok(!JSON.stringify(skill.ops).includes('"special":"leader"'), "Life movement never targets the Leader");
assert.equal(validateProgram(skill.ops), true);
const text = printRule({ kind: "auto", trigger: [], cost: null, cond: null, ops: skill.ops });
const parsed = parseRule(text); assert.ok(parsed.ok, JSON.stringify(parsed));
assert.equal(validateRule(parsed.value, "auto"), null);
assert.deepEqual(canonical(parsed.value.ops), canonical(skill.ops), "range survives language round-trip");
for (const sel of [{ count: 2, minCount: 3 }, { count: 2, minCount: 1, upTo: true }, { count: 2, minCount: -1 }]) assert.equal(validateProgram([{ op: "choose", sel, as: "x" }] as Op[]), false);
assert.equal(validateProgram([{ op: "ko", target: { sel: { area: "battle", count: 2, minCount: 1 } } }]), false, "a floor outside a choice is not silently ignored");

// The real interpreter also refuses injected saved answers, independently
// of the public action validator. Authored MIN selectors without a printed
// reason describe the range in their default prompt.
{
  const b = board(); b.s.flow = [];
  const frame: ScriptFrame = { ops: [{ op: "choose", sel: { side: "you", area: "life", count: 2, minCount: 1 }, as: "range" }], ip: 0, master: "p1", card: b.source, vars: {} };
  assert.equal(stepScript(vmHost(ctx, game, b.s, []), frame), "wait");
  assert.match(b.s.prompt.kind === "chooseCards" ? b.s.prompt.choice.reason : "", /choose 1 to 2/);
  for (const answer of [[], b.lifeIds]) {
    const state = reload(b.s); state.lastChoice = answer;
    assert.throws(() => stepScript(vmHost(ctx, game, state, []), JSON.parse(JSON.stringify(frame))), "a saved zero/three answer cannot evade the floor/ceiling");
  }
}

for (const take of [1, 2] as const) for (const removal of ["LEADER820-KO", "LEADER820-REMOVE"] as const) {
  const b = board(3, removal);
  let s = b.s;
  assert.deepEqual(candidates(s), b.lifeIds, `${removal}: Life is chosen before Broly`);
  assert.equal(s.prompt.kind === "chooseCards" && s.prompt.choice.min, 1, "zero cannot end the initial choice");
  for (const ids of [[], b.lifeIds, [b.lifeIds[0], b.lifeIds[0]]]) assert.throws(() => choose(s, ids));
  assert.throws(() => choose(s, [b.lifeIds[0]], "p2"));
  for (const p of ["p1", "p2"] as const) assert.deepEqual(snapshot(reload(s), p), snapshot(s, p), "both views survive reload");
  const opponentBefore = JSON.stringify(snapshot(s, "p2"));
  for (const id of [...b.lifeIds, b.broly, ...b.wrong]) assert.ok(!opponentBefore.includes(id), "opponent cannot identify hidden Life/hand choices");
  s = choose(s, [b.lifeIds[0]]);
  assert.equal(s.sides.p1.zones.life.length, 3, "cards move together after the whole bounded selection");
  assert.equal(s.prompt.kind === "chooseCards" && s.prompt.choice.min, 0, "one card satisfies the floor, so the second is optional");
  assert.throws(() => choose(s, [b.lifeIds[0]]), "the same Life card cannot be picked twice");
  s = choose(s, take === 1 ? [] : [b.lifeIds[1]]);
  assert.equal(s.sides.p1.zones.life.length, 3 - take);
  assert.deepEqual(candidates(s), [b.broly], "only green Broly:Br cost4 in hand is a legal play");
  assert.ok(s.sides.p1.zones.hand.includes(b.broly), "Broly waits until the Life movement is done");
  assert.throws(() => choose(s, [b.dropBroly]));
  for (const id of b.wrong) assert.throws(() => choose(s, [id]));
  assert.ok(!JSON.stringify(snapshot(s, "p2")).includes(b.broly), "the pending hand play stays private after Life movement");
  s = choose(s, [b.broly]);
  assert.ok(s.sides.p1.zones.battle.includes(b.broly));
  assert.ok(s.sides.p1.zones.drop.includes(b.source));
  assert.equal(s.sides.p1.zones.leader.length, 1, "the green Leader stays in its area");
  assert.ok(!s.sides.p1.zones.hand.includes(s.sides.p1.zones.leader[0]));
  for (const id of b.lifeIds.slice(0, take)) assert.ok(s.sides.p1.zones.hand.includes(id));
  assert.equal(s.prompt.kind, "main");
}

// Two candidates are still a real choice between one and two: never forced to two.
{
  const b = board(2); assert.equal(b.s.prompt.kind, "chooseCards");
  const s = choose(choose(b.s, [b.lifeIds[0]]), []);
  assert.equal(s.sides.p1.zones.life.length, 1);
}
// With one candidate 5-2-5 forces that one, then proceeds to the Broly choice.
{
  const b = board(1); assert.deepEqual(candidates(b.s), [b.broly]);
  assert.ok(b.s.sides.p1.zones.hand.includes(b.lifeIds[0]));
  assert.equal(b.s.sides.p1.zones.life.length, 0);
  const done = choose(b.s, [b.broly]);
  assert.ok(done.sides.p1.zones.battle.includes(b.broly), "the skill finishes its play before the following checkpoint");
  assert.equal(done.winner, "p2", "zero Life loses at the subsequent checkpoint (4-2, 21-2)");
}
// With no Life, the interpreter binds no targets (5-2-6). Such a live game
// cannot reach this Auto because its preceding checkpoint has already lost;
// isolate the whole printed effect on the real host to prove the empty area.
{
  const b = board();
  for (const id of b.lifeIds) assert.ok(moveCard(b.s, game, id, "deck", { position: "bottom" }).ok);
  b.s.flow = [];
  const frame: ScriptFrame = { ops: skill.ops, ip: 0, master: "p1", card: b.source, vars: {} };
  assert.equal(stepScript(vmHost(ctx, game, b.s, []), frame), "wait");
  assert.deepEqual(frame.vars.c0, [], "zero candidates is not an illegal voluntary zero answer");
  assert.deepEqual(candidates(b.s), [b.broly], "the Life target's absence does not retarget the Leader");
}
// A Broly taken from Life has reached hand before the subsequent live search.
{
  const b = board(3, "LEADER820-KO", { brolyLife: true });
  let s = choose(choose(b.s, [b.lifeIds[0]]), []);
  assert.deepEqual(candidates(s), [b.lifeIds[0]]);
  s = choose(s, [b.lifeIds[0]]);
  assert.ok(s.sides.p1.zones.battle.includes(b.lifeIds[0]));
}
// The later play is up to one: it may be declined, or find no eligible card.
{
  const b = board();
  const ready = choose(choose(b.s, [b.lifeIds[0]]), []);
  const done = choose(ready, []);
  assert.ok(done.sides.p1.zones.hand.includes(b.broly)); assert.equal(done.prompt.kind, "main");
  const missing = board(3, "LEADER820-KO", { noBroly: true });
  const absent = choose(choose(missing.s, [missing.lifeIds[0]]), []);
  assert.equal(absent.prompt.kind, "main"); assert.deepEqual(absent.sides.p1.zones.battle, []);
}
// A false green Leader condition does no Life movement and no Broly play.
for (const leader of ["LEADER820-WRONG", "LEADER820-NOTARMY"] as const) {
  const b = board(3, leader);
  assert.equal(b.s.prompt.kind, "main"); assert.equal(b.s.sides.p1.zones.life.length, 3);
  assert.ok(b.s.sides.p1.zones.hand.includes(b.broly));
}
console.log("  ok  #820 BT6-063: complete printed skill, one/two Life, floor, order, correct hand target, reload/privacy");
