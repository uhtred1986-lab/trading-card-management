/** #573: fixed #539 readings and a real fill-under skill on both engines. */
import assert from "node:assert/strict";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { validateProgram } from "../../src/lib/arena/vm/script";
import type { Action, GameEvent } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";
import { CTX, DEFS, IMPL, arenaG, assertConsistentG, card, hasG, leaderOf, placeUnderG, powerOfG, zoneOf } from "./harness";

const FILL = "[Auto] When this card KOs your opponent's Battle Card, place cards from the top of your deck under your {Majin Buu's Sealed Ball} until there are 5 cards under {Majin Buu's Sealed Ball}.";
const BALL = "C573-BALL";
const KOER = "C573-KOER";
DEFS[BALL] = card(BALL, { name: "Majin Buu's Sealed Ball", power: 5000 });
DEFS[KOER] = card(KOER, { power: 20000, skill: FILL });
DEFS["C573-EACH"] = card("C573-EACH", { power: 20000, skill: "[Auto] When this card attacks, this card gains +5000 power for each <Son Goku> and <Vegeta> in your Drop Area for the duration of the turn." });
DEFS["C573-GOKU"] = card("C573-GOKU", { characters: ["Son Goku"] });
DEFS["C573-VEGETA"] = card("C573-VEGETA", { characters: ["Vegeta"] });
DEFS["C573-OTHER"] = card("C573-OTHER", { characters: ["Piccolo"] });
DEFS["C573-REST"] = card("C573-REST", { energyCost: 0, skill: "[Auto] When this card is played, choose all of your opponent's Battle Cards and energy and switch them to Rest Mode." });
DEFS["C573-SUM"] = card("C573-SUM", { energyCost: 0, skill: "[Auto] When this card is played, choose any number of your opponent's Battle Cards with a combined total energy cost of 8 or less, ignoring [Barrier], and send them to their owner's Warp." });
DEFS["C573-C4A"] = card("C573-C4A", { energyCost: 4 });
DEFS["C573-C4B"] = card("C573-C4B", { energyCost: 4 });
DEFS["C573-C5"] = card("C573-C5", { energyCost: 5 });
DEFS["C573-TOTAL"] = card("C573-TOTAL", { type: "LEADER", power: 15000, energyCost: null, comboCost: null, comboPower: null,
  skill: "[Auto] When this card attacks, draw 1 card, and if there are 10 or more total <Son Goku> or <Vegeta> in your Drop Area, this card gains +5000 power and [Double Strike] for the duration of the turn." });
DEFS["C573-SHARED"] = card("C573-SHARED", { skill: "[Auto] When you combo with this card, if your Leader Card is blue and your life is at 4 or less, this card gains +10000 combo power for the duration of the turn. Then, choose up to 1 card in your opponent's Combo Area and return it to their owner's hand. Then, if there are no cards in your opponent's Combo Area, draw 1 card." });
DEFS["C573-SECRET"] = card("C573-SECRET", { name: "Unseen top-deck identity" });

const compiled = compileSkill(parseSkills(FILL)[0]!);
assert.deepEqual(compiled.unsupported, [], "BT2-009: the complete placement now reads");
assert.equal(validateProgram(compiled.ops), true, "BT2-009: compiled operations are valid rules language");
const fill = compiled.ops[0];
assert.equal(fill?.op, "if");
if (fill?.op === "if") {
  assert.deepEqual(fill.cond.kind, "count");
  assert.equal(fill.then[0]?.op, "choose", "one named host is selected when several exist");
  assert.equal(fill.then.length, 6, "there is one guarded opportunity for each missing card");
}
for (const bad of [
  FILL.replace("5 cards under", "5 cards beside"),
  FILL.replace("{Majin Buu's Sealed Ball}.", "{Another Ball}."),
  FILL.replace("5 cards under", "50 cards under"),
]) assert.ok(compileSkill(parseSkills(bad)[0]!).unsupported.length, `unreadable fill is refused: ${bad}`);

// Five readings were already fixed before #573. Keep their distinctions
// pinned, rather than rewriting old compiler rules or conflating OR with AND.
const one = (text: string) => compileSkill(parseSkills(text)[0]!);
{
  const shared = one("[Auto] When you combo with this card, if your Leader Card is blue and your life is at 4 or less, this card gains +10000 combo power for the duration of the turn. Then, choose up to 1 card in your opponent's Combo Area and return it to their owner's hand. Then, if there are no cards in your opponent's Combo Area, draw 1 card.");
  assert.deepEqual(shared.unsupported, []);
  assert.equal(JSON.stringify(shared.ops).split('"leaderMatches"').length - 1, 2, "BT3-043: blue Leader covers both outer and nested group");
  assert.equal(JSON.stringify(shared.ops).split('"kind":"life"').length - 1, 2, "BT3-043: life threshold also covers the return and draw");

  const total = one("[Auto] When this card attacks, draw 1 card, and if there are 10 or more total <Son Goku> or <Vegeta> in your Drop Area, this card gains +5000 power and [Double Strike] for the duration of the turn.");
  assert.deepEqual(total.unsupported, []);
  const count = (total.ops[1] as { cond: { kind: string; atLeast: number; sel: { area: string; filter: { characters: string[] } } } }).cond;
  assert.deepEqual([count.kind, count.atLeast, count.sel.area, count.sel.filter.characters], ["count", 10, "drop", ["son goku", "vegeta"]], "BT2-001: one total over either name");

  const each = one(DEFS["C573-EACH"].skill!);
  assert.deepEqual(each.unsupported, []);
  const power = each.ops[0] as { op: string; amount: { count: { area: string; count: number; filter: { characters: string[] } }; times: number } };
  assert.deepEqual([power.op, power.amount.count.area, power.amount.count.count, power.amount.count.filter.characters, power.amount.times],
    ["power", "drop", 99, ["son goku", "vegeta"], 5000], "BT2-012: +5000 per matching card, not per any card");

  const both = one("[Auto] When a card evolves into this card, choose all of your opponent's Battle Cards and energy and switch them to Rest Mode.");
  assert.deepEqual(both.unsupported, []);
  assert.deepEqual(both.ops.map((op) => [op.op, (op as { target: { sel: { side: string; area: string } } }).target.sel.side, (op as { target: { sel: { area: string } } }).target.sel.area]),
    [["switchMode", "opponent", "battle"], ["switchMode", "opponent", "energy"]], "BT3-084: both area nouns, not one mixed target");

  const sum = one("[Auto] When this card is played, choose any number of your opponent's Battle Cards with a combined total energy cost of 8 or less, ignoring [Barrier], and send them to their owner's Warp.");
  assert.deepEqual(sum.unsupported, []);
  const sel = (sum.ops[0] as { sel: { count: number; upTo: boolean; sumAtMost: { attr: string; total: number }; filter: { costMax: number | null } } }).sel;
  assert.deepEqual([sel.count, sel.upTo, sel.sumAtMost, sel.filter.costMax], [99, true, { attr: "energyCost", total: 8 }, null], "BT31-090: the sum, not each card, is bounded");
}

function take(state: EngineState, action: Action): { state: EngineState; events: GameEvent[] } {
  assert.ok(IMPL.legalActions(CTX, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)),
    `rules: expected ${JSON.stringify(action)} at ${state.prompt.kind}`);
  return IMPL.apply(CTX, state, action);
}

function stage(state: EngineState, id: string, area: "battle" | "energy" | "drop", player: "p1" | "p2" = "p1"): string {
  const deck = zoneOf(state, player, "deck");
  const instance = deck.shift();
  assert.ok(instance);
  state.cards[instance].cardId = id;
  state.cards[instance].mode = "active";
  zoneOf(state, player, area).push(instance);
  return instance;
}

for (const matches of [0, 3]) {
  let state = arenaG({ battle: ["C573-EACH"] });
  const attacker = zoneOf(state, "p1", "battle").find((id) => state.cards[id].cardId === "C573-EACH")!;
  stage(state, "C573-OTHER", "drop");
  if (matches) {
    stage(state, "C573-GOKU", "drop");
    stage(state, "C573-GOKU", "drop");
    stage(state, "C573-VEGETA", "drop");
  }
  stage(state, "C573-GOKU", "drop", "p2");
  const attacked = take(state, { type: "attack", player: "p1", attacker, target: leaderOf(state, "p2") });
  state = attacked.state;
  assert.equal(powerOfG(state, attacker), 20000 + matches * 5000, "BT2-012 counts only own matching Drop cards");
  assert.equal(attacked.events.filter((e) => e.type === "skill" && e.card === attacker).length, 1);
  assertConsistentG(state);
}

for (const count of [9, 10]) {
  let state = arenaG();
  const leader = leaderOf(state, "p1")!;
  state.cards[leader].cardId = "C573-TOTAL";
  for (let i = 0; i < 8; i++) stage(state, "C573-GOKU", "drop");
  for (let i = 8; i < count; i++) stage(state, "C573-VEGETA", "drop");
  stage(state, "C573-OTHER", "drop");
  stage(state, "C573-GOKU", "drop", "p2");
  const beforeHand = zoneOf(state, "p1", "hand").length;
  const attacked = take(state, { type: "attack", player: "p1", attacker: leader, target: leaderOf(state, "p2") });
  state = attacked.state;
  assert.equal(zoneOf(state, "p1", "hand").length, beforeHand + 1, "BT2-001 always draws once");
  assert.equal(powerOfG(state, leader), count === 10 ? 20000 : 15000, "BT2-001 totals both names at ten");
  assert.equal(hasG(state, leader, "Strike"), count === 10, "BT2-001 grants Double Strike only at threshold");
  assert.equal(attacked.events.filter((e) => e.type === "skill" && e.card === leader).length, 1);
  assertConsistentG(state);
}

for (const [blue, life, shouldDraw] of [[true, 4, true], [true, 5, false], [false, 4, false]] as const) {
  let state = arenaG({ hand: ["C573-SHARED"] });
  if (blue) state.cards[leaderOf(state, "p1")!].cardId = "L-BLUE";
  const lifeArea = zoneOf(state, "p1", "life");
  zoneOf(state, "p1", "drop").push(...lifeArea.splice(life));
  const source = zoneOf(state, "p1", "hand").find((id) => state.cards[id].cardId === "C573-SHARED")!;
  state = take(state, { type: "attack", player: "p1", attacker: leaderOf(state, "p1")!, target: leaderOf(state, "p2")! }).state;
  const beforeHand = zoneOf(state, "p1", "hand").length;
  const joined = take(state, { type: "combo", player: "p1", card: source });
  state = joined.state;
  assert.ok(zoneOf(state, "p1", "combo").includes(source));
  // Current DBS answers this ordinary self-combo Auto at the 5-7 entry
  // checkpoint, before combat.
  assert.equal(joined.events.filter((e) => e.type === "skill" && e.card === source).length, 1);
  assert.equal(zoneOf(state, "p1", "hand").length, beforeHand - 1 + Number(shouldDraw));
  const events = joined.events.slice();
  for (let i = 0; i < 5 && state.prompt.kind !== "main"; i++) {
    const prompt = state.prompt;
    const action: Action = prompt.kind === "combo" ? { type: "pass", player: prompt.player }
      : prompt.kind === "zEnergyFromCombo" ? { type: "zEnergyFromCombo", player: prompt.player, card: null }
      : (() => { throw Error(`rules: BT3-043 stopped at ${prompt.kind}`); })();
    const next = take(state, action);
    state = next.state;
    events.push(...next.events);
  }
  assert.equal(state.prompt.kind, "main");
  const compared = events.flatMap((e) => e.type === "powerCompare" ? [e.attackPower] : []);
  assert.deepEqual(compared, [blue && life <= 4 ? 25000 : 15000], "current rules apply BT3-043's conditional bonus before comparison");
  assert.equal(zoneOf(state, "p1", "hand").length, beforeHand - 1 + Number(shouldDraw), "BT3-043 draw shares both outer conditions");
  assert.equal(events.filter((e) => e.type === "skill" && e.card === source).length, 1);
  assertConsistentG(state);
}

{
  const state = arenaG({ hand: ["C573-REST"], energy: ["V1"], oppBattle: ["V-BLUE", "V-BLUE"], oppEnergy: ["V-BLUE", "V-BLUE"] });
  const source = zoneOf(state, "p1", "hand").find((id) => state.cards[id].cardId === "C573-REST")!;
  const battleCards = zoneOf(state, "p2", "battle").slice();
  const energyCards = zoneOf(state, "p2", "energy").slice();
  const ownEnergy = zoneOf(state, "p1", "energy")[0]!;
  const played = take(state, { type: "play", player: "p1", card: source });
  assert.equal(played.events.filter((e) => e.type === "skill" && e.card === source).length, 1);
  for (const id of [...battleCards, ...energyCards]) assert.equal(played.state.cards[id].mode, "rest", "BT3-084 rests each opponent zone");
  assert.equal(played.state.cards[ownEnergy].mode, "active", "BT3-084 does not rest your energy");
  assert.deepEqual(played.events.flatMap((e) => e.type === "mode" && e.mode === "rest" ? [e.card] : []).sort(), [...battleCards, ...energyCards].sort());
  assertConsistentG(played.state);
}

{
  let state = arenaG({ hand: ["C573-SUM"], energy: ["V1"], oppBattle: ["C573-C4A", "C573-C4B", "C573-C5"] });
  const source = zoneOf(state, "p1", "hand").find((id) => state.cards[id].cardId === "C573-SUM")!;
  const byCard = (name: string) => zoneOf(state, "p2", "battle").find((id) => state.cards[id].cardId === name)!;
  const [a, b, five] = [byCard("C573-C4A"), byCard("C573-C4B"), byCard("C573-C5")];
  state = take(state, { type: "play", player: "p1", card: source }).state;
  assert.equal(state.prompt.kind, "chooseCards");
  if (state.prompt.kind !== "chooseCards") throw Error("BT31-090 choice missing");
  assert.deepEqual(state.prompt.choice.candidates.slice().sort(), [a, b, five].sort(), "each card alone fits under eight");
  state = take(state, { type: "choose", player: "p1", cards: [a] }).state;
  assert.equal(state.prompt.kind, "chooseCards");
  if (state.prompt.kind !== "chooseCards") throw Error("BT31-090 second choice missing");
  assert.deepEqual(state.prompt.choice.candidates, [b], "after four, only the other four fits");
  state = JSON.parse(JSON.stringify(state)) as EngineState;
  const saved = JSON.stringify(state);
  assert.throws(() => IMPL.apply(CTX, state, { type: "choose", player: "p1", cards: [five] }), "nine total is illegal");
  assert.equal(JSON.stringify(state), saved);
  const ended = take(state, { type: "choose", player: "p1", cards: [b] });
  assert.ok(zoneOf(ended.state, "p2", "warp").includes(a) && zoneOf(ended.state, "p2", "warp").includes(b));
  assert.ok(zoneOf(ended.state, "p2", "battle").includes(five));
  assert.equal(ended.events.filter((e) => e.type === "move" && e.to === "warp").length, 2);
  assertConsistentG(ended.state);
}

function battle(state: EngineState, attacker: string, victim: string): { state: EngineState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  const attack = take(state, { type: "attack", player: "p1", attacker, target: victim });
  state = attack.state;
  events.push(...attack.events);
  for (let i = 0; i < 8 && state.prompt.kind !== "main" && state.prompt.kind !== "chooseCards" && state.prompt.kind !== "gameOver"; i++) {
    const p = state.prompt;
    const action: Action = p.kind === "combo" ? { type: "pass", player: p.player }
      : p.kind === "zEnergyFromCombo" ? { type: "zEnergyFromCombo", player: p.player, card: null }
      : (() => { throw Error(`rules: battle reached ${p.kind}`); })();
    const next = take(state, action);
    state = next.state;
    events.push(...next.events);
  }
  return { state, events };
}

function staged(existing: number, hosts = 1, deckLimit?: number): { state: EngineState; koer: string; victim: string; balls: string[]; prior: string[]; top: string[]; energy: string } {
  const state = arenaG({ battle: [KOER], oppBattle: ["V-BLUE"] });
  const koer = zoneOf(state, "p1", "battle").find((id) => state.cards[id].cardId === KOER)!;
  const victim = zoneOf(state, "p2", "battle")[0]!;
  state.cards[victim].mode = "rest";
  const balls = Array.from({ length: hosts }, () => stage(state, BALL, "battle"));
  const energy = stage(state, "V1", "energy");
  for (let i = 0; i < existing; i++) {
    const id = zoneOf(state, "p1", "deck")[0]!;
    assert.ok(placeUnderG(state, id, balls[0]!), "fixture placed an existing card under the Ball");
  }
  if (deckLimit !== undefined) {
    const deck = zoneOf(state, "p1", "deck");
    zoneOf(state, "p1", "drop").push(...deck.splice(deckLimit));
  }
  return { state, koer, victim, balls, prior: balls[0] ? state.cards[balls[0]].under.slice() : [], top: zoneOf(state, "p1", "deck").slice(0, Math.max(0, 5 - existing)), energy };
}

for (const existing of [0, 2, 5, 6]) {
  const { state: start, koer, victim, balls, prior, top, energy } = staged(existing);
  if (existing === 0) start.cards[top[0]!].cardId = "C573-SECRET";
  const before = zoneOf(start, "p1", "deck").length;
  const result = battle(JSON.parse(JSON.stringify(start)) as EngineState, koer, victim);
  assert.equal(result.state.prompt.kind, "main", `rules: one host needs no choice`);
  const needed = Math.max(0, 5 - existing);
  assert.equal(result.state.cards[balls[0]!].under.length, existing + needed);
  assert.deepEqual(result.state.cards[balls[0]!].under,
    [...top].reverse().concat(prior),
    "fills with only the deck's top cards in the established stack order");
  assert.equal(zoneOf(result.state, "p1", "deck").length, before - needed);
  assert.equal(result.events.filter((e) => e.type === "stack" && e.top === balls[0]).length, needed);
  assert.equal(result.events.filter((e) => e.type === "skill" && e.card === koer).length, 1, "one Auto from this KO");
  assert.ok(zoneOf(result.state, "p2", "drop").includes(victim));
  assert.ok(zoneOf(result.state, "p1", "energy").includes(energy));
  assert.equal(result.state.cards[energy].mode, "active", "this Auto charges no Energy");
  if (existing === 0) {
    const beats = IMPL.toBeats(CTX, result.state, result.events, 0);
    for (const viewer of ["p1", "p2"] as const) {
      const snap = buildSnapshot({ id: 573, revision: 1, mode: "versus", status: "playing",
        p1Name: "Player 1", p2Name: "Player 2", ctx: CTX, state: result.state, legal: [], log: [], beats,
        spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
      const host = (viewer === "p1" ? snap.view.you : snap.view.them).battle.find((c) => c.id === balls[0]);
      assert.equal(host?.underCount, 5);
      assert.ok(!JSON.stringify(snap).includes("C573-SECRET"), "the deck card's printed identity stays hidden in both public snapshots");
      assert.ok(!JSON.stringify(snap).includes("Unseen top-deck identity"));
    }
  }
  assertConsistentG(result.state);
}

{
  const { state, koer, victim, balls, prior, energy } = staged(1, 1, 2);
  const top = zoneOf(state, "p1", "deck").slice();
  const result = battle(state, koer, victim);
  assert.equal(result.state.cards[balls[0]!].under.length, 3, "short deck contributes only available cards");
  assert.deepEqual(result.state.cards[balls[0]!].under, [...top].reverse().concat(prior));
  assert.equal(result.events.filter((e) => e.type === "stack" && e.top === balls[0]).length, 2);
  assert.equal(result.state.cards[energy].mode, "active");
  assertConsistentG(result.state);
}

{
  const { state, koer, victim } = staged(0, 0);
  const before = zoneOf(state, "p1", "deck").slice();
  const result = battle(state, koer, victim);
  assert.equal(result.state.prompt.kind, "main", "absent host poses no choice");
  assert.deepEqual(zoneOf(result.state, "p1", "deck"), before, "absent host negates placement");
  assert.equal(result.events.filter((e) => e.type === "stack").length, 0);
  assertConsistentG(result.state);
}

for (const where of ["energy", "opponent"] as const) {
  const { state, koer, victim } = staged(0, 0);
  stage(state, BALL, where === "energy" ? "energy" : "battle", where === "energy" ? "p1" : "p2");
  const before = zoneOf(state, "p1", "deck").slice();
  const result = battle(state, koer, victim);
  assert.equal(result.state.prompt.kind, "main", `${where} host is ineligible`);
  assert.deepEqual(zoneOf(result.state, "p1", "deck"), before);
  assert.equal(result.events.filter((e) => e.type === "stack").length, 0, `${where} host cannot receive cards`);
  assertConsistentG(result.state);
}

{
  const { state, koer, victim, balls } = staged(1, 2);
  const result = battle(state, koer, victim);
  assert.equal(result.state.prompt.kind, "chooseCards", "two valid hosts require a choice");
  if (result.state.prompt.kind !== "chooseCards") throw Error("missing host choice");
  assert.deepEqual(result.state.prompt.choice.candidates.slice().sort(), balls.slice().sort());
  const saved = JSON.parse(JSON.stringify(result.state)) as EngineState;
  const before = JSON.stringify(saved);
  assert.throws(() => IMPL.apply(CTX, saved, { type: "choose", player: "p1", cards: [koer] }), "a stale/wrong host is illegal");
  assert.equal(JSON.stringify(saved), before, "refused selection keeps the saved board");
  const chosen = take(saved, { type: "choose", player: "p1", cards: [balls[1]!] });
  assert.equal(chosen.state.cards[balls[0]!].under.length, 1);
  assert.equal(chosen.state.cards[balls[1]!].under.length, 5);
  assert.equal(chosen.events.filter((e) => e.type === "stack" && e.top === balls[1]).length, 5);
  assertConsistentG(chosen.state);
}

delete DEFS[BALL];
delete DEFS[KOER];
for (const id of ["C573-EACH", "C573-GOKU", "C573-VEGETA", "C573-OTHER", "C573-REST", "C573-SUM", "C573-C4A", "C573-C4B", "C573-C5", "C573-TOTAL", "C573-SHARED", "C573-SECRET"]) delete DEFS[id];
console.log(`#573 grouped readings and BT2-009 fill-under scenarios passed on rules`);
