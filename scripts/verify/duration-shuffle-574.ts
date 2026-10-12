/** #574: the owned Charge duration and SD7 closed-area shuffle readings. */
import assert from "node:assert/strict";
import { compileCostProgram, compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { validateProgram } from "../../src/lib/arena/vm/script";
import { addSkip as legacySkip, taxesOn as legacyTaxes } from "../../src/lib/arena/engine/state";
import { addSkip as rulesSkip } from "../../src/lib/arena/vm/skips";
import { taxesOn as rulesTaxes } from "../../src/lib/arena/vm/program";
import { isVmState } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";
import { CTX, DEFS, ENGINE, IMPL, arenaG, assertConsistentG, card, leaderOf, powerOfG, zoneOf } from "./harness";

const CHARGE = "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards, switch it to Rest Mode, and it can't switch to Active Mode during your opponent's next Charge Phase.";
const POWER = "[Auto] When you play this card, this card gains +5000 power until the beginning of your next turn.";
const SEARCH = "[Activate: Main] Switch this card to Rest Mode: Choose up to 2 [Dragon Ball] cards from your deck or life and add them to your hand. Then shuffle any areas you looked through.";
const WISH = "[Activate: Main] Choose one- ・Draw 1 card. ・Choose 1 ≪Desire≫ card in your hand with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill.";
const WISH_CHAIN = `${WISH.slice(0, -1)}. Then draw 2 cards.`;
const DESIRE = "[Activate: Main] {r}{1}: Draw 1 card.";

const injected = ["C574-LOCK", "C574-VICTIM", "C574-POWER", "C574-SEARCH", "C574-DRAGON", "C574-WISH", "C574-WISH-CHAIN", "C574-DESIRE", "C574-OTHER", "C574-COND", "C574-ONCE", "C574-MULTI"] as const;
try {
DEFS["C574-LOCK"] = card("C574-LOCK", { energyCost: 0, skill: CHARGE });
DEFS["C574-VICTIM"] = card("C574-VICTIM", { skill: "[Activate: Main] Switch this card to Active Mode." });
DEFS["C574-POWER"] = card("C574-POWER", { energyCost: 0, skill: POWER });
DEFS["C574-SEARCH"] = card("C574-SEARCH", { type: "LEADER", energyCost: null, power: 15000, comboCost: null, comboPower: null, skill: SEARCH });
DEFS["C574-DRAGON"] = card("C574-DRAGON", { type: "EXTRA", energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Dragon Ball]" });
DEFS["C574-WISH"] = card("C574-WISH", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: WISH });
DEFS["C574-WISH-CHAIN"] = card("C574-WISH-CHAIN", { type: "LEADER", energyCost: null, comboCost: null, comboPower: null, skill: WISH_CHAIN });
DEFS["C574-DESIRE"] = card("C574-DESIRE", { type: "EXTRA", energyCost: 2, power: null, comboCost: null, comboPower: null, traits: ["Desire"], skill: DESIRE });
DEFS["C574-OTHER"] = card("C574-OTHER", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: DESIRE });
DEFS["C574-COND"] = card("C574-COND", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, traits: ["Desire"], skill: "[Activate: Main] If your Leader Card is blue: Draw 1 card." });
DEFS["C574-ONCE"] = card("C574-ONCE", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, traits: ["Desire"], skill: "[Activate: Main] [Once per turn] Draw 1 card." });
DEFS["C574-MULTI"] = card("C574-MULTI", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, traits: ["Desire"], skill: "[Activate: Main] [Once per turn] Draw 1 card.<br>[Activate: Main] [Once per turn] Draw 2 cards." });

const one = (text: string) => compileSkill(parseSkills(text)[0]!);
const lock = one(CHARGE);
assert.deepEqual(lock.unsupported, []);
assert.equal(lock.ops[2]?.op, "forbid");
if (lock.ops[2]?.op === "forbid") assert.deepEqual([lock.ops[2].what, lock.ops[2].until], ["switchToActiveInCharge", "afterOpponentCharge"]);
assert.deepEqual(one(POWER).unsupported, []);
assert.equal((one(POWER).ops[0] as { until: string }).until, "nextTurn", "BT2-004 already has the right own-turn duration");
const search = one(SEARCH);
assert.deepEqual(search.unsupported, []);
assert.equal(validateProgram(search.ops), true);
assert.deepEqual(search.ops.at(-1), { op: "shuffle", areas: ["deck", "life"], inspectedOnly: true });
const wish = one(WISH);
assert.deepEqual(wish.unsupported, []);
assert.equal(validateProgram(wish.ops), true);
assert.equal(wish.ops[0]?.op, "chooseMode");
if (wish.ops[0]?.op === "chooseMode") assert.deepEqual(wish.ops[0].modes[1]?.ops, [{ op: "invokeSkill", trait: "Desire", skillKind: "activate:main", from: "hand", maxCost: "currentEnergy" }]);
const chain = one(WISH_CHAIN);
assert.deepEqual(chain.unsupported, []);
if (chain.ops[0]?.op === "chooseMode") assert.deepEqual(chain.ops[0].modes[1]?.ops.map((op) => op.op), ["invokeSkill", "draw"]);

function take(state: EngineState, action: Action): { state: EngineState; events: GameEvent[] } {
  assert.ok(IMPL.legalActions(CTX, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)),
    `${ENGINE}: expected ${JSON.stringify(action)} at ${state.prompt.kind}`);
  return IMPL.apply(CTX, state, action);
}

function stage(state: EngineState, player: PlayerId, id: string, area: "hand" | "battle" | "life" | "deck"): string {
  const source = zoneOf(state, player, "deck");
  const cardId = source.shift();
  assert.ok(cardId);
  state.cards[cardId].cardId = id;
  zoneOf(state, player, area).push(cardId);
  if (area === "battle") state.cards[cardId].mode = "active";
  return cardId;
}

// SD7's second branch activates the selected Extra's skill, without charging
// its original energy or skill price. The card reaches Drop before that skill
// draws, and a reloaded choice resolves to the same state and events.
{
  let state = arenaG({ hand: ["C574-DESIRE", "C574-OTHER"], energy: ["V1", "V1"] });
  state.cards[leaderOf(state, "p1")].cardId = "C574-WISH";
  const desire = zoneOf(state, "p1", "hand").find((id) => state.cards[id].cardId === "C574-DESIRE")!;
  const other = zoneOf(state, "p1", "hand").find((id) => state.cards[id].cardId === "C574-OTHER")!;
  const source = leaderOf(state, "p1");
  const started = take(state, { type: "activate", player: "p1", card: source, skill: parseSkills(WISH)[0]!.index });
  state = started.state;
  assert.equal(state.prompt.kind, "chooseMode");
  const reloaded = JSON.parse(JSON.stringify(state)) as EngineState;
  const answer: Action = { type: "chooseMode", player: "p1", index: 1 };
  const chosen = take(state, answer);
  const restored = take(reloaded, answer);
  assert.deepEqual(restored.events, chosen.events);
  assert.equal(JSON.stringify(restored.state), JSON.stringify(chosen.state));
  state = chosen.state;
  assert.ok(zoneOf(state, "p1", "drop").includes(desire));
  assert.ok(zoneOf(state, "p1", "hand").includes(other));
  assert.equal(zoneOf(state, "p1", "energy").filter((id) => state.cards[id].mode === "rest").length, 0);
  assert.equal(chosen.events.filter((event) => event.type === "skill" && event.card === desire).length, 1);
  assert.ok(chosen.events.some((event) => event.type === "draw" && event.player === "p1"));
  assertConsistentG(state);
}

{
  let state = arenaG({ hand: ["C574-DESIRE"], energy: ["V1", "V1"] });
  state.cards[leaderOf(state, "p1")].cardId = "C574-WISH-CHAIN";
  const id = zoneOf(state, "p1", "hand").find((item) => state.cards[item].cardId === "C574-DESIRE")!;
  state = take(state, { type: "activate", player: "p1", card: leaderOf(state, "p1"), skill: parseSkills(WISH_CHAIN)[0]!.index }).state;
  const result = take(state, { type: "chooseMode", player: "p1", index: 1 });
  const nested = result.events.findIndex((event) => event.type === "skill" && event.card === id);
  const firstDraw = result.events.findIndex((event) => event.type === "draw" && event.player === "p1");
  assert.ok(nested >= 0 && firstDraw > nested, "the nested activation runs before its parent's continuation");
  assert.equal(result.events.filter((event) => event.type === "draw" && event.player === "p1").length, 3);
  assertConsistentG(result.state);
}

function unavailable(candidate: string, energy: string[], mutate?: (state: EngineState, id: string) => void): void {
  let state = arenaG({ hand: [candidate], energy });
  state.cards[leaderOf(state, "p1")].cardId = "C574-WISH";
  const id = zoneOf(state, "p1", "hand").find((item) => state.cards[item].cardId === candidate)!;
  mutate?.(state, id);
  const wasInDrop = zoneOf(state, "p1", "drop").includes(id);
  const result = take(state, { type: "activate", player: "p1", card: leaderOf(state, "p1"), skill: parseSkills(WISH)[0]!.index });
  state = result.state;
  assert.notEqual(state.prompt.kind, "chooseMode", `${candidate}: unavailable Desire branch is not offered`);
  assert.ok(!result.events.some((event) => event.type === "skill" && event.card === id));
  assert.equal(zoneOf(state, "p1", "drop").includes(id), wasInDrop, `${candidate}: an ineligible Extra was not spent`);
  assertConsistentG(state);
}
unavailable("C574-DESIRE", ["V1"]); // printed energy cost exceeds current energy
unavailable("C574-OTHER", ["V1", "V1"]); // wrong special trait
unavailable("C574-COND", ["V1", "V1"]); // waived cost does not waive the condition
unavailable("C574-ONCE", ["V1", "V1"], (state, id) => state.cards[id].usedThisTurn.push(0));
unavailable("C574-DESIRE", ["V1", "V1"], (state, id) => {
  state.effects.push({ id: 574, target: id, kind: "forbid", value: 0, forbid: { what: "activateSkill", player: "p1" },
    until: "turn", source: id, createdTurn: state.turn, ownerTurn: "p1", master: "p1" });
});

// A counted restriction grants exactly one activation before it starts
// forbidding this named Extra. Nested activation spends the same use as a
// declared activation, although the invoking Leader remains unrestricted.
{
  let state = arenaG({ hand: ["C574-DESIRE"], energy: ["V1", "V1"] });
  const leader = leaderOf(state, "p1");
  state.cards[leader].cardId = "C574-WISH";
  const id = zoneOf(state, "p1", "hand").find((item) => state.cards[item].cardId === "C574-DESIRE")!;
  state.effects.push({ id: 5741, target: "", kind: "forbid", value: 0,
    forbid: { what: "activateSkill", player: "p1", name: "C574-DESIRE", uses: 1 },
    until: "turn", source: leader, createdTurn: state.turn, ownerTurn: "p1", master: "p1" });
  state = take(state, { type: "activate", player: "p1", card: leader, skill: parseSkills(WISH)[0]!.index }).state;
  state = take(state, { type: "chooseMode", player: "p1", index: 1 }).state;
  assert.equal(state.effects.find((effect) => effect.id === 5741)?.forbid?.uses, 0);
  assert.ok(zoneOf(state, "p1", "drop").includes(id));
  assertConsistentG(state);
}
// Active gap boundary for #677: the existing, recognised 20-14 price is
// visible to both tax readers, but neither normal nor nested Activate: Main
// currently charges it. This asserts the missing payment, not legal behavior.
{
  const price = compileCostProgram(parseSkills("[Activate: Main] Place 1 card from your hand in your Drop Area: Draw 1 card.")[0]!);
  assert.deepEqual(price?.unsupported, []);
  assert.deepEqual(price?.ops.map((op) => op.op), ["discard"]);
  const loaded = rulesetFor("dbs");
  if (!loaded.ok) throw Error("DBS ruleset did not load");
  for (const nested of [false, true]) {
    let state = arenaG({ hand: ["C574-ONCE", "V1"], energy: ["V1", "V1"] });
    const leader = leaderOf(state, "p1");
    if (nested) state.cards[leader].cardId = "C574-WISH";
    const id = zoneOf(state, "p1", "hand").find((item) => state.cards[item].cardId === "C574-ONCE")!;
    state.effects.push({ id: 5743, target: id, kind: "forbid", value: 0,
      forbid: { what: "activateSkill", pay: price!.ops }, until: "turn",
      source: leader, createdTurn: state.turn, ownerTurn: "p1", master: "p1" });
    const taxes: ReturnType<typeof legacyTaxes> = isVmState(state)
      ? rulesTaxes(CTX, loaded.definition, state, "activateSkill", { player: "p1", card: id })
      : legacyTaxes(CTX, state, "activateSkill", { player: "p1", card: id });
    assert.equal(taxes.length, 1, "#677: existing readers recognise the extra activation price");
    assert.deepEqual(taxes[0].ops, price!.ops);
    if (nested) {
      state = take(state, { type: "activate", player: "p1", card: leader, skill: parseSkills(WISH)[0]!.index }).state;
      const result = take(state, { type: "chooseMode", player: "p1", index: 1 });
      state = result.state;
      assert.equal(result.events.filter((event) => event.type === "move" && event.from === "hand" && event.to === "drop").length, 1,
        "#677 gap: only the Extra moves to Drop; the external activation price is omitted");
    } else {
      const result = take(state, { type: "activate", player: "p1", card: id, skill: parseSkills(DEFS["C574-ONCE"].skill!)[0]!.index });
      state = result.state;
      assert.equal(result.events.filter((event) => event.type === "move" && event.from === "hand" && event.to === "drop").length, 1,
        "#677 gap: normal activation also omits the external price");
    }
    assert.ok(zoneOf(state, "p1", "drop").includes(id));
    assertConsistentG(state);
  }
}
unavailable("C574-DESIRE", ["V1", "V1"], (state, id) => {
  zoneOf(state, "p1", "hand").splice(zoneOf(state, "p1", "hand").indexOf(id), 1);
  zoneOf(state, "p1", "drop").push(id);
});

// Two legal hand targets require a real choice. An answer captured before a
// target leaves the hand cannot spend a newly stale card or duplicate a skill.
{
  let state = arenaG({ hand: ["C574-DESIRE", "C574-DESIRE"], energy: ["V1", "V1"] });
  state.cards[leaderOf(state, "p1")].cardId = "C574-WISH";
  const desires = zoneOf(state, "p1", "hand").filter((id) => state.cards[id].cardId === "C574-DESIRE");
  state = take(state, { type: "activate", player: "p1", card: leaderOf(state, "p1"), skill: parseSkills(WISH)[0]!.index }).state;
  state = take(state, { type: "chooseMode", player: "p1", index: 1 }).state;
  assert.equal(state.prompt.kind, "chooseCards");
  if (state.prompt.kind !== "chooseCards") throw Error("Desire hand choice missing");
  assert.deepEqual(state.prompt.choice.candidates, desires);
  const observer = buildSnapshot({ id: 574, revision: 2, mode: "versus", engine: ENGINE, status: "playing",
    p1Name: "Player 1", p2Name: "Player 2", ctx: CTX, state, legal: [], log: [], beats: IMPL.toBeats(CTX, state, [], 0), spotlight: null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer: "p2", images: {} });
  assert.ok(!JSON.stringify(observer).includes("C574-DESIRE"), "opponent view masks hand Desire identities and choice candidates");
  const stale = JSON.parse(JSON.stringify(state)) as EngineState;
  zoneOf(stale, "p1", "hand").splice(zoneOf(stale, "p1", "hand").indexOf(desires[0]), 1);
  zoneOf(stale, "p1", "drop").push(desires[0]);
  const before = JSON.stringify(stale);
  assert.throws(() => IMPL.apply(CTX, stale, { type: "choose", player: "p1", cards: [desires[0]] }), /cannot|eligible|hand|choice|target/i);
  assert.equal(JSON.stringify(stale), before, "rejected stale choice leaves stored board untouched");
  const reloaded = JSON.parse(JSON.stringify(state)) as EngineState;
  const choice: Action = { type: "choose", player: "p1", cards: [desires[1]] };
  const chosen = take(state, choice);
  const restored = take(reloaded, choice);
  assert.equal(JSON.stringify(chosen.state), JSON.stringify(restored.state));
  assert.deepEqual(chosen.events, restored.events);
  assert.ok(zoneOf(chosen.state, "p1", "drop").includes(desires[1]));
  assert.ok(zoneOf(chosen.state, "p1", "hand").includes(desires[0]));
  assert.equal(chosen.events.filter((event) => event.type === "skill" && event.card === desires[1]).length, 1);
  assertConsistentG(chosen.state);
}

// A card with two eligible Main lines asks which line to activate. The saved
// prompt position remains bound to that line, and a newly spent line is stale.
{
  let state = arenaG({ hand: ["C574-MULTI"], energy: ["V1"] });
  state.cards[leaderOf(state, "p1")].cardId = "C574-WISH";
  const id = zoneOf(state, "p1", "hand").find((item) => state.cards[item].cardId === "C574-MULTI")!;
  state = take(state, { type: "activate", player: "p1", card: leaderOf(state, "p1"), skill: parseSkills(WISH)[0]!.index }).state;
  state = take(state, { type: "chooseMode", player: "p1", index: 1 }).state;
  assert.equal(state.prompt.kind, "chooseMode");
  if (state.prompt.kind !== "chooseMode") throw Error("Desire skill-line choice missing");
  assert.equal(state.prompt.options.length, 2);
  const second = parseSkills(DEFS["C574-MULTI"].skill!)[1]!.index;
  const stale = JSON.parse(JSON.stringify(state)) as EngineState;
  stale.cards[id].usedThisTurn.push(second);
  assert.throws(() => IMPL.apply(CTX, stale, { type: "chooseMode", player: "p1", index: 1 }), /cannot|eligible|line|choice/i);
  const result = take(state, { type: "chooseMode", player: "p1", index: 1 });
  assert.equal(result.events.filter((event) => event.type === "skill" && event.card === id && event.skill === second).length, 1);
  assert.equal(result.events.filter((event) => event.type === "draw" && event.player === "p1").length, 2);
  assert.ok(zoneOf(result.state, "p1", "drop").includes(id));
  assertConsistentG(result.state);
}

// The prohibited mode change is the opponent's Active Step, not an entire
// turn-long rest lock. A skill later in that Main Phase can stand the card.
{
  let state = arenaG({ hand: ["C574-LOCK"], oppBattle: ["C574-VICTIM"] });
  const lockCard = zoneOf(state, "p1", "hand").find((id) => state.cards[id].cardId === "C574-LOCK")!;
  const victim = zoneOf(state, "p2", "battle").find((id) => state.cards[id].cardId === "C574-VICTIM")!;
  const played = take(state, { type: "play", player: "p1", card: lockCard });
  state = played.state;
  assert.equal(state.prompt.kind, "chooseCards");
  const chosen = take(state, { type: "choose", player: "p1", cards: [victim] });
  state = chosen.state;
  assert.equal(state.cards[victim].mode, "rest");
  assert.ok(state.effects.some((e) => e.until === "afterOpponentCharge" && e.target === victim));
  assert.equal(chosen.events.filter((e) => e.type === "mode" && e.card === victim && e.mode === "rest").length, 1);
  const saved = JSON.parse(JSON.stringify(state)) as EngineState;
  state = take(state, { type: "endMain", player: "p1" }).state;
  const reloaded = take(saved, { type: "endMain", player: "p1" }).state;
  assert.equal(JSON.stringify(reloaded), JSON.stringify(state), "Charge expiry is stable after JSON reload");
  assert.equal(state.cards[victim].mode, "rest", "opponent's next Active Step cannot stand the card");
  assert.ok(!state.effects.some((e) => e.until === "afterOpponentCharge"), "restriction ends as Charge's Active Step finishes");
  state = take(state, { type: "charge", player: "p2", card: null }).state;
  const skill = parseSkills(DEFS["C574-VICTIM"].skill!)[0]!.index;
  state = take(state, { type: "activate", player: "p2", card: victim, skill }).state;
  assert.equal(state.cards[victim].mode, "active", "skill untap later that turn is permitted");
  assertConsistentG(state);
}

// A whole skipped Charge still consumes "during next Charge" restrictions.
// The clock belongs to the source master even if control of the victim changes.
for (const transfer of [false, true]) {
  let state = arenaG({ hand: ["C574-LOCK"], oppBattle: ["C574-VICTIM"] });
  const lockCard = zoneOf(state, "p1", "hand").find((id) => state.cards[id].cardId === "C574-LOCK")!;
  const victim = zoneOf(state, "p2", "battle").find((id) => state.cards[id].cardId === "C574-VICTIM")!;
  if (isVmState(state)) rulesSkip(state, "p2", "charge", "next");
  else legacySkip(state, "p2", "charge", "next");
  state = take(state, { type: "play", player: "p1", card: lockCard }).state;
  state = take(state, { type: "choose", player: "p1", cards: [victim] }).state;
  assert.ok(state.effects.some((effect) => effect.until === "afterOpponentCharge" && effect.target === victim));
  if (transfer) {
    zoneOf(state, "p2", "battle").splice(zoneOf(state, "p2", "battle").indexOf(victim), 1);
    zoneOf(state, "p1", "battle").push(victim);
  }
  const ended = take(JSON.parse(JSON.stringify(state)) as EngineState, { type: "endMain", player: "p1" });
  state = ended.state;
  assert.ok(ended.events.some((event) => event.type === "phase" && event.phase === "charge" && event.player === "p2" && event.skipped));
  assert.ok(!state.effects.some((effect) => effect.until === "afterOpponentCharge"), "skipped opponent Charge ends source-master clock");
  assertConsistentG(state);
}

// A lock made by p1 during p2's turn names p2's *next* Charge. If its target
// changes controller to p1, the intervening p1 Charge must stand it and must
// not consume p2's lock. Returning it to p2 tests both the actual Active Step
// and a skipped due phase, including the saved-state boundary at each turn.
for (const skipDue of [false, true]) {
  let state = arenaG();
  state = take(state, { type: "endMain", player: "p1" }).state;
  state = take(state, { type: "charge", player: "p2", card: null }).state;
  const target = stage(state, "p1", "C574-VICTIM", "battle");
  state.cards[target].mode = "rest";
  state.effects.push({ id: 5742, target, kind: "forbid", value: 0,
    forbid: { what: "switchToActiveInCharge" }, until: "afterOpponentCharge",
    source: leaderOf(state, "p1"), createdTurn: state.turn, ownerTurn: "p2", master: "p1" });
  const beforeOwnCharge = JSON.parse(JSON.stringify(state)) as EngineState;
  const ownCharge = take(state, { type: "endMain", player: "p2" });
  const ownReloaded = take(beforeOwnCharge, { type: "endMain", player: "p2" });
  assert.equal(JSON.stringify(ownReloaded.state), JSON.stringify(ownCharge.state));
  assert.deepEqual(ownReloaded.events, ownCharge.events);
  state = ownCharge.state;
  assert.equal(state.cards[target].mode, "active", "p1's own Charge is outside p1's opponent-Charge lock");
  assert.ok(state.effects.some((effect) => effect.id === 5742), "off-turn lock waits for p2's next Charge");
  state = take(state, { type: "charge", player: "p1", card: null }).state;
  zoneOf(state, "p1", "battle").splice(zoneOf(state, "p1", "battle").indexOf(target), 1);
  zoneOf(state, "p2", "battle").push(target);
  state.cards[target].mode = "rest";
  if (skipDue) {
    if (isVmState(state)) rulesSkip(state, "p2", "charge", "next");
    else legacySkip(state, "p2", "charge", "next");
  }
  const beforeDue = JSON.parse(JSON.stringify(state)) as EngineState;
  const due = take(state, { type: "endMain", player: "p1" });
  const dueReloaded = take(beforeDue, { type: "endMain", player: "p1" });
  assert.equal(JSON.stringify(dueReloaded.state), JSON.stringify(due.state));
  assert.deepEqual(dueReloaded.events, due.events);
  state = due.state;
  assert.equal(state.cards[target].mode, "rest", "p2's due Charge cannot stand the target");
  assert.equal(due.events.some((event) => event.type === "phase" && event.phase === "charge" && event.player === "p2" && event.skipped), skipDue);
  assert.ok(!state.effects.some((effect) => effect.id === 5742), "lock ends after the due Charge, including when skipped");
  assertConsistentG(state);
}

// The first Main skill's prompt exposes matching identities from deck and
// life to the skill's master only. A JSON round trip must preserve that
// inspection through the choice and produce the same deterministic shuffle.
{
  let state = arenaG();
  state.cards[leaderOf(state, "p1")].cardId = "C574-SEARCH";
  const lifeBall = stage(state, "p1", "C574-DRAGON", "life");
  const deckBall = stage(state, "p1", "C574-DRAGON", "deck");
  const beforeLife = zoneOf(state, "p1", "life").filter((id) => id !== lifeBall);
  const beforeDeck = zoneOf(state, "p1", "deck").slice();
  const otherLife = zoneOf(state, "p2", "life").slice();
  const otherDeck = zoneOf(state, "p2", "deck").slice();
  const source = leaderOf(state, "p1");
  const skill = parseSkills(SEARCH)[0]!.index;
  const action: Action = { type: "activate", player: "p1", card: source, skill };
  const started = take(state, action);
  state = started.state;
  assert.equal(state.prompt.kind, "chooseCards");
  if (state.prompt.kind !== "chooseCards") throw Error("search choice missing");
  assert.ok(state.prompt.choice.candidates.includes(lifeBall) && state.prompt.choice.candidates.includes(deckBall));
  const p2 = buildSnapshot({ id: 574, revision: 1, mode: "versus", engine: ENGINE, status: "playing",
    p1Name: "Player 1", p2Name: "Player 2", ctx: CTX, state, legal: [], log: [], beats: IMPL.toBeats(CTX, state, started.events, 0),
    spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer: "p2", images: {} });
  assert.ok(!JSON.stringify(p2).includes("C574-DRAGON"), "opponent's public view does not reveal searched Life/Deck identity");
  const reloaded = JSON.parse(JSON.stringify(state)) as EngineState;
  const choice: Action = { type: "choose", player: "p1", cards: [lifeBall] };
  const normal = take(state, choice);
  const restored = take(reloaded, choice);
  assert.equal(JSON.stringify(restored.state), JSON.stringify(normal.state), "reload at the choice preserves shuffle and RNG");
  assert.deepEqual(restored.events, normal.events);
  state = normal.state;
  // The optional second pick may be declined; both areas were already
  // inspected when the joint candidate pool was shown.
  if (state.prompt.kind === "chooseCards") {
    const declined = take(state, { type: "choose", player: "p1", cards: [] });
    state = declined.state;
    assert.equal(declined.events.filter((e) => e.type === "note" && /shuffles their life/.test(e.text)).length, 1,
      "searched Life is shuffled once after the choice finishes");
  }
  assert.ok(zoneOf(state, "p1", "hand").includes(lifeBall));
  assert.ok(!zoneOf(state, "p1", "life").includes(lifeBall));
  assert.notDeepEqual(zoneOf(state, "p1", "life"), beforeLife, "remaining Life is actually randomized");
  assert.notDeepEqual(zoneOf(state, "p1", "deck"), beforeDeck, "searched Deck is actually randomized");
  assert.deepEqual(zoneOf(state, "p2", "life"), otherLife, "other player's Life is untouched");
  assert.deepEqual(zoneOf(state, "p2", "deck"), otherDeck, "other player's Deck is untouched");
  assertConsistentG(state);
}

// BT2-004's parser and existing turn clock are already correct; the named
// game-level expiry proof follows the actual play and two turn transitions.
{
  let state = arenaG({ hand: ["C574-POWER"] });
  const id = zoneOf(state, "p1", "hand").find((item) => state.cards[item].cardId === "C574-POWER")!;
  state = take(state, { type: "play", player: "p1", card: id }).state;
  assert.equal(powerOfG(state, id), 15000, "BT2-004 bonus applies on play");
  state = take(state, { type: "endMain", player: "p1" }).state;
  assert.equal(powerOfG(state, id), 15000, "bonus survives the opponent's turn start");
  state = take(state, { type: "charge", player: "p2", card: null }).state;
  state = take(state, { type: "endMain", player: "p2" }).state;
  assert.equal(powerOfG(state, id), 10000, "bonus is gone at the beginning of your next turn");
  assert.ok(!state.effects.some((e) => e.source === id && e.until === "nextTurn"));
  assertConsistentG(state);
}
} finally {
  for (const id of injected) delete DEFS[id];
}
