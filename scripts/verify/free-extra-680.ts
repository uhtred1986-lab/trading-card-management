/** #680: BT31-116's optional, cost-waived hand Extra skill activation. */
import assert from "node:assert/strict";
import { compileCostProgram, compileSkill } from "../../src/lib/arena/compile";
import { move as legacyMove, playCost as legacyPlayCost } from "../../src/lib/arena/engine/state";
import { pendTriggers } from "../../src/lib/arena/engine/triggers";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { whiteCellPlayedSubjectFilter } from "../../src/lib/arena/text/triggers";
import { engineFor } from "../../src/lib/arena/engines";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { pendAutos } from "../../src/lib/arena/vm/triggers";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, GameEvent, GameState, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { RULES_ONLY } from "./rules-only";

const AUTO = "[Auto] Switch 1 of your energy to Hidden Mode: When your <Cell> or <Cell Jr.> card—both white and with an energy cost of 3 or more—is played, activate an [Activate: Main/Battle] skill of up to 1 mono-white Extra with an energy cost of 2 in your hand.";
const EXTRA = "[Activate: Main/Battle] {r}{1}: Draw 1 card.";
const TWO_LINES = `${EXTRA}<br>[Activate: Main/Battle] {r}{1}: Draw 2 cards.`;
const REDUCE = "[Auto] When you play a card, choose up to 1 of your Battle Cards and reduce its energy cost by 1 for the turn.";
const INCREASE = "[Auto] When you play a card, choose up to 1 of your Battle Cards and increase its energy cost by 1 for the turn.";
const BOUNCE = "[Auto] When you play a card, choose up to 1 of your Battle Cards and return it to its owner's hand.";
const EFFECT_ONLY_IF = "[Auto] Switch 1 of your energy to Hidden Mode: When you play a card, if your Leader Card is blue, draw 1 card.";
const EXTRA_WATCH = "[Auto] When you activate a white Extra from your hand, draw 1 card.";
const WISH = "[Activate: Main] Choose one- ・Draw 1 card. ・Choose 1 ≪Desire≫ card in your hand with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill.";
const defs = { ...DEFS,
  "C680-LEADER": card("C680-LEADER", { type: "LEADER", colors: ["White"], energyCost: null, comboCost: null, comboPower: null, skill: AUTO }),
  "C680-WISH": card("C680-WISH", { type: "LEADER", colors: ["White"], energyCost: null, comboCost: null, comboPower: null, skill: WISH }),
  "C680-CELL": card("C680-CELL", { colors: ["White"], characters: ["Cell"], energyCost: 3, skill: null }),
  "C680-CELL2": card("C680-CELL2", { colors: ["White"], characters: ["Cell"], energyCost: 2, skill: null }),
  "C680-FREECELL": card("C680-FREECELL", { colors: ["White"], characters: ["Cell"], energyCost: 3, skill: "[Permanent] You can play this card from your hand without paying its energy cost." }),
  "C680-GOHAN": card("C680-GOHAN", { colors: ["White"], characters: ["Son Gohan"], energyCost: 3, skill: null }),
  "C680-REDCELL": card("C680-REDCELL", { colors: ["Red"], characters: ["Cell"], energyCost: 3, skill: null }),
  "C680-ENERGY": card("C680-ENERGY", { colors: ["White"], skill: null }),
  "C680-REDENERGY": card("C680-REDENERGY", { colors: ["Red"], skill: null }),
  "C680-EXTRA": card("C680-EXTRA", { type: "EXTRA", colors: ["White"], energyCost: 2, power: null, comboCost: null, comboPower: null, skill: EXTRA }),
  "C680-ZERO": card("C680-ZERO", { type: "EXTRA", colors: ["White"], energyCost: 0, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main/Battle] Draw 1 card." }),
  "C680-DESIRE": card("C680-DESIRE", { type: "EXTRA", colors: ["White"], traits: ["Desire"], energyCost: 2, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] {r}{1}: Draw 1 card." }),
  "C680-WATCH": card("C680-WATCH", { energyCost: 0, skill: EXTRA_WATCH }),
  "C680-TWO": card("C680-TWO", { type: "EXTRA", colors: ["White"], energyCost: 2, power: null, comboCost: null, comboPower: null, skill: TWO_LINES }),
  "C680-RED": card("C680-RED", { type: "EXTRA", colors: ["Red"], energyCost: 2, power: null, comboCost: null, comboPower: null, skill: EXTRA }),
  "C680-MULTI": card("C680-MULTI", { type: "EXTRA", colors: ["White", "Red"], energyCost: 2, power: null, comboCost: null, comboPower: null, skill: EXTRA }),
  "C680-ONE": card("C680-ONE", { type: "EXTRA", colors: ["White"], energyCost: 1, power: null, comboCost: null, comboPower: null, skill: EXTRA }),
  "C680-MAIN": card("C680-MAIN", { type: "EXTRA", colors: ["White"], energyCost: 2, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 1 card." }),
  "C680-COND": card("C680-COND", { type: "EXTRA", colors: ["White"], energyCost: 2, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main/Battle] If your Leader Card is blue: Draw 1 card." }),
  "C680-ONCE": card("C680-ONCE", { type: "EXTRA", colors: ["White"], energyCost: 2, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main/Battle][Once per turn] Draw 1 card." }),
  "C680-REDUCE": card("C680-REDUCE", { energyCost: 0, skill: REDUCE }),
  "C680-INCREASE": card("C680-INCREASE", { energyCost: 0, skill: INCREASE }),
  "C680-BOUNCE": card("C680-BOUNCE", { energyCost: 0, skill: BOUNCE }),
  "C680-IF": card("C680-IF", { energyCost: 0, skill: EFFECT_ONLY_IF }),
  "C680-GENERIC": card("C680-GENERIC", { colors: ["White"], energyCost: 0, skill: null }),
};
const ctx = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const rules = engineFor("rules");
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;

const compiled = compileSkill(parseSkills(AUTO)[0]!);
assert.deepEqual(compiled.unsupported, []);
assert.deepEqual(compiled.ops.map((op) => op.op), ["invokeSkill"], "the trigger guard runs at the play moment, not after the Auto price");
assert.equal(compiled.ops[0]?.op === "invokeSkill" && compiled.ops[0].skillKind, "activate:main/battle");
assert.deepEqual(compileCostProgram(parseSkills(AUTO)[0]!)?.ops.map((op) => op.op), ["choose", "hidden"]);
for (const extended of [
  AUTO.replace("is played, activate", "is played and your life is at 4 or less, activate"),
  AUTO.replace("is played, activate", "is played, and your life is at 4 or less, activate"),
  AUTO.replace("is played, activate", "is played, your Leader Card is blue, activate"),
]) {
  const skill = parseSkills(extended)[0]!;
  assert.equal(whiteCellPlayedSubjectFilter(skill), null, "an extended trigger is not this exact printed family");
  const read = compileSkill(skill);
  assert.equal(read.ops[0]?.op, "if", "the compiler retains an extended trigger's own condition");
}

function main(leader: "C680-LEADER" | "C680-WISH" | "L-RED" = "C680-LEADER"): VmState {
  let state = rules.createGame(ctx, { seed: 680, p1: { name: "You", leader, main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  state = rules.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) state = rules.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(state.prompt.kind, "main");
  return state;
}
function stage(state: VmState, id: keyof typeof defs, area: "hand" | "energy" | "battle", player: PlayerId = "p1"): string {
  const physical = state.sides[player].zones.deck[0];
  assert.ok(physical);
  state.cards[physical].cardId = id;
  assert.ok(moveCard(state, dbs, physical, area, { owner: player }).ok);
  return physical;
}
function take(state: VmState, action: Action): { state: VmState; events: GameEvent[] } {
  assert.ok(rules.legalActions(ctx, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)), JSON.stringify({ prompt: state.prompt, action }));
  return rules.apply(ctx, JSON.parse(JSON.stringify(state)), action) as { state: VmState; events: GameEvent[] };
}
const reload = (state: VmState): VmState => JSON.parse(JSON.stringify(state)) as VmState;
const draws = (events: GameEvent[]) => events.filter((event) => event.type === "draw").length;
function snapshot(state: VmState, viewer: PlayerId) {
  return buildSnapshot({ id: 680, engine: "rules", mode: "versus", status: "playing", p1Name: "You", p2Name: "Other", ctx, state, legal: rules.legalActions(ctx, state), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}
function prepared(extraIds: (keyof typeof defs)[] = ["C680-EXTRA"], playedId: keyof typeof defs = "C680-CELL"): { state: VmState; cell: string; energy: string[]; extras: string[] } {
  const state = main();
  const energy = Array.from({ length: 4 }, () => stage(state, "C680-ENERGY", "energy"));
  if (playedId === "C680-REDCELL") state.cards[energy[0]].cardId = "C680-REDENERGY";
  const cell = stage(state, playedId, "hand");
  const extras = extraIds.map((id) => stage(state, id, "hand"));
  return { state, cell, energy, extras };
}

if (!RULES_ONLY) {
for (const wrong of ["C680-CELL2", "C680-GOHAN", "C680-REDCELL"] as const) {
  const { state, cell, energy, extras: [extra] } = prepared(["C680-EXTRA"], wrong);
  const played = take(state, { type: "play", player: "p1", card: cell });
  assert.equal(played.state.prompt.kind, "main", `${wrong} does not pend the qualified Auto or offer its price`);
  assert.equal(energy.filter((id) => played.state.cards[id].hidden).length, 0);
  assert.ok(played.state.sides.p1.zones.hand.includes(extra));
  assert.equal(played.events.filter((event) => event.type === "skill" && event.card === extra).length, 0);
}
{
  const { state, cell, energy, extras: [extra] } = prepared();
  state.effects.push({ id: 6801, target: cell, kind: "cost", value: 1, until: "turn",
    source: state.sides.p1.zones.leader[0], createdTurn: state.turn, ownerTurn: "p1", master: "p1" });
  assert.equal(attrsNow(ctx, dbs, state, cell).costOf, 2);
  const played = take(state, { type: "play", player: "p1", card: cell });
  assert.equal(played.state.prompt.kind, "main", "an in-force cost reduction makes the Cell ineligible at the play moment");
  assert.equal(energy.filter((id) => played.state.cards[id].hidden).length, 0);
  assert.ok(played.state.sides.p1.zones.hand.includes(extra));
}
{
  const { state, cell, extras: [extra] } = prepared(["C680-EXTRA"], "C680-FREECELL");
  assert.equal(attrsNow(ctx, dbs, state, cell).costOf, 3);
  assert.ok(rules.legalActions(ctx, state).some((row) => row.action.type === "play" && row.action.card === cell && row.action.alt === true));
  const played = take(state, { type: "play", player: "p1", card: cell, alt: true });
  assert.equal(played.state.prompt.kind, "chooseMode", "a free-play payment leaves the Cell's current energy cost at 3");
  assert.ok(played.state.sides.p1.zones.hand.includes(extra));
}
{
  const state = main();
  const moment = { event: "moved", controller: "p1" as const, args: { asPlay: true, to: "battle" } };
  assert.deepEqual(pendAutos(ctx, dbs, state, moment), [], "a played-card watcher cannot qualify without a subject");
  assert.equal(state.pending.length, 0);
}
for (const [watchId, expectedCost, expectedArea] of [
  ["C680-REDUCE", 2, "battle"],
  ["C680-BOUNCE", 3, "hand"],
] as const) {
  const { state, cell, energy, extras: [extra] } = prepared();
  const watcher = stage(state, watchId, "battle");
  const played = take(state, { type: "play", player: "p1", card: cell });
  assert.equal(played.state.prompt.kind, "orderPending");
  assert.deepEqual(played.state.pending.map((item) => item.card), [played.state.sides.p1.zones.leader[0], watcher]);
  const selected = take(played.state, { type: "orderPending", player: "p1", index: 1 });
  const restored = take(reload(played.state), { type: "orderPending", player: "p1", index: 1 });
  assert.deepEqual(restored.events, selected.events);
  assert.deepEqual(restored.state, selected.state);
  assert.equal(selected.state.prompt.kind, "chooseCards");
  const changed = take(selected.state, { type: "choose", player: "p1", cards: [cell] });
  assert.equal(changed.state.prompt.kind, "chooseMode", "the valid Cell's earlier trigger stays pending after the other Auto");
  assert.equal(attrsNow(ctx, dbs, changed.state, cell).costOf, expectedCost);
  assert.ok(changed.state.sides.p1.zones[expectedArea].includes(cell));
  const pay = take(changed.state, { type: "chooseMode", player: "p1", index: 0 });
  const energyPaid = take(pay.state, { type: "choose", player: "p1", cards: [energy[3]] });
  assert.equal(energyPaid.state.prompt.kind, "chooseCards");
  const invoked = take(energyPaid.state, { type: "choose", player: "p1", cards: [extra] });
  assert.ok(invoked.state.sides.p1.zones.drop.includes(extra));
  assert.equal(draws(invoked.events), 1, `${watchId}: captured trigger resolves after subject changes`);
}
{
  const { state, cell, energy, extras: [extra] } = prepared(["C680-EXTRA"], "C680-CELL2");
  stage(state, "C680-INCREASE", "battle");
  const played = take(state, { type: "play", player: "p1", card: cell });
  assert.equal(played.state.prompt.kind, "chooseCards", "only the cost-increase watcher pended for an originally cost-2 Cell");
  assert.equal(played.state.pending.length, 0, "the invalid BT31 trigger was never queued");
  const increased = take(played.state, { type: "choose", player: "p1", cards: [cell] });
  assert.equal(attrsNow(ctx, dbs, increased.state, cell).costOf, 3);
  assert.equal(increased.state.prompt.kind, "main", "a later increase cannot create a missed Auto trigger");
  assert.equal(energy.filter((id) => increased.state.cards[id].hidden).length, 0);
  assert.ok(increased.state.sides.p1.zones.hand.includes(extra));
}
{
  const state = main("L-RED");
  const energy = stage(state, "C680-ENERGY", "energy");
  const source = stage(state, "C680-IF", "battle");
  const subject = stage(state, "C680-GENERIC", "hand");
  const played = take(state, { type: "play", player: "p1", card: subject });
  assert.equal(played.state.prompt.kind, "chooseMode", "a body-only false condition does not suppress the Auto's cost decision");
  const pay = take(played.state, { type: "chooseMode", player: "p1", index: 0 });
  const paid = pay.state.prompt.kind === "chooseCards"
    ? take(pay.state, { type: "choose", player: "p1", cards: [energy] }) : pay;
  assert.equal(paid.state.cards[energy].hidden, true);
  assert.equal(paid.events.filter((event) => event.type === "skill" && event.card === source).length, 1);
  assert.equal(draws(paid.events), 0, "the effect-only condition remains false after payment and activation");
}
function paidUntilExtra(state: VmState, cell: string, energy: string): { state: VmState; events: GameEvent[] } {
  const played = take(state, { type: "play", player: "p1", card: cell });
  assert.equal(played.state.prompt.kind, "chooseMode", "BT31's own Auto cost has pay/decline decisions");
  assert.equal(draws(played.events), 0);
  const pay = take(played.state, { type: "chooseMode", player: "p1", index: 0 });
  assert.equal(pay.state.prompt.kind, "chooseCards", "the Auto chooses one actual Revealed Mode energy");
  const chosen = take(pay.state, { type: "choose", player: "p1", cards: [energy] });
  assert.equal(chosen.state.cards[energy].hidden, true, "the Auto's own Hidden Mode cost was paid");
  return chosen;
}

{
  const { state, cell, energy, extras: [extra] } = prepared();
  const paid = paidUntilExtra(state, cell, energy[3]);
  assert.equal(paid.state.prompt.kind, "chooseCards");
  if (paid.state.prompt.kind === "chooseCards") assert.deepEqual([paid.state.prompt.choice.min, paid.state.prompt.choice.max, paid.state.prompt.choice.candidates], [0, 1, [extra]]);
  const opponent = JSON.stringify(snapshot(paid.state, "p2"));
  assert.ok(!opponent.includes(extra) && !opponent.includes("C680-EXTRA"), "the opponent cannot see a private hand choice");
  const before = JSON.stringify(paid.state);
  assert.throws(() => rules.apply(ctx, reload(paid.state), { type: "choose", player: "p1", cards: [cell] }), IllegalAction);
  assert.equal(JSON.stringify(paid.state), before, "invalid choice did not change the saved state");
  const invoked = take(paid.state, { type: "choose", player: "p1", cards: [extra] });
  const restored = take(reload(paid.state), { type: "choose", player: "p1", cards: [extra] });
  assert.deepEqual(restored.events, invoked.events);
  assert.deepEqual(restored.state, invoked.state);
  assert.equal(invoked.state.prompt.kind, "main");
  assert.ok(invoked.state.sides.p1.zones.drop.includes(extra));
  assert.ok(!invoked.state.sides.p1.zones.battle.includes(extra));
  assert.equal(invoked.events.filter((event) => event.type === "skill" && event.card === extra).length, 1);
  assert.equal(draws(invoked.events), 1);
  const drop = invoked.events.findIndex((event) => event.type === "move" && event.card === extra && event.to === "drop");
  const skill = invoked.events.findIndex((event) => event.type === "skill" && event.card === extra);
  assert.ok(drop >= 0 && skill > drop, "hand Extra moves to Drop before its skill activates");
  assert.equal(energy.filter((id) => invoked.state.cards[id].mode === "rest").length, 3, "only the played Cell spent energy; the Extra's original price was waived");
  assert.equal(energy.filter((id) => invoked.state.cards[id].hidden).length, 1, "only the Auto's own action price switched energy Hidden");
  assert.throws(() => rules.apply(ctx, invoked.state, { type: "choose", player: "p1", cards: [extra] }), IllegalAction);
}
// 12-1-3 still calls this an Extra activation when its original cost is
// waived. The same watcher must answer the ordinary zero-price hand use.
{
  const { state, cell, energy, extras: [extra] } = prepared();
  const watcher = stage(state, "C680-WATCH", "battle");
  const paid = paidUntilExtra(state, cell, energy[3]);
  const invoked = take(paid.state, { type: "choose", player: "p1", cards: [extra] });
  assert.equal(draws(invoked.events), 2, "the invoked Extra's draw and its activation watcher both resolve");
  assert.equal(invoked.events.filter((event) => event.type === "skill" && event.card === watcher).length, 1);
}
{
  const state = main();
  const watcher = stage(state, "C680-WATCH", "battle");
  const extra = stage(state, "C680-ZERO", "hand");
  const activated = take(state, { type: "activate", player: "p1", card: extra, skill: 0 });
  assert.ok(activated.state.sides.p1.zones.drop.includes(extra));
  assert.equal(draws(activated.events), 2, "a normally activated zero-cost hand Extra reaches the same watcher");
  assert.equal(activated.events.filter((event) => event.type === "skill" && event.card === watcher).length, 1);
}
{
  const state = main("C680-WISH");
  stage(state, "C680-ENERGY", "energy");
  stage(state, "C680-ENERGY", "energy");
  const watcher = stage(state, "C680-WATCH", "battle");
  const extra = stage(state, "C680-DESIRE", "hand");
  const leader = state.sides.p1.zones.leader[0];
  const started = take(state, { type: "activate", player: "p1", card: leader, skill: 0 });
  assert.equal(started.state.prompt.kind, "chooseMode");
  const invoked = take(started.state, { type: "chooseMode", player: "p1", index: 1 });
  assert.ok(invoked.state.sides.p1.zones.drop.includes(extra));
  assert.equal(draws(invoked.events), 2, "SD7's cost-waived Desire and the Extra-activation watcher both resolve");
  assert.equal(invoked.events.filter((event) => event.type === "skill" && event.card === watcher).length, 1);
}

// Declining the Auto's own action price leaves both the energy and Extra
// untouched. Declining only the *up to one* Extra choice keeps the paid Auto
// price but causes no Extra activation or play.
{
  const { state, cell, energy, extras: [extra] } = prepared();
  const played = take(state, { type: "play", player: "p1", card: cell });
  const declined = take(played.state, { type: "chooseMode", player: "p1", index: 1 });
  assert.equal(declined.state.prompt.kind, "main");
  assert.equal(energy.filter((id) => declined.state.cards[id].hidden).length, 0);
  assert.ok(declined.state.sides.p1.zones.hand.includes(extra));
  assert.equal(declined.events.filter((event) => event.type === "skill" && event.card === extra).length, 0);
  assert.equal(draws(declined.events), 0);
  const paid = paidUntilExtra(state, cell, energy[3]);
  const noExtra = take(paid.state, { type: "choose", player: "p1", cards: [] });
  assert.equal(noExtra.state.prompt.kind, "main");
  assert.equal(noExtra.state.cards[energy[3]].hidden, true);
  assert.ok(noExtra.state.sides.p1.zones.hand.includes(extra));
  assert.equal(noExtra.events.filter((event) => event.type === "skill" && event.card === extra).length, 0);
  assert.equal(draws(noExtra.events), 0);
}

// The printed hand, mono-white, energy-cost-2 and exact Main/Battle kind are
// conjunctive. A non-matching Extra cannot be selected after paying the Auto.
for (const wrong of ["C680-RED", "C680-MULTI", "C680-ONE", "C680-MAIN", "C680-COND", "C680-ONCE"] as const) {
  const { state, cell, energy, extras: [extra] } = prepared([wrong]);
  if (wrong === "C680-ONCE") state.cards[extra].usedThisTurn.push(0);
  const paid = paidUntilExtra(state, cell, energy[3]);
  assert.equal(paid.state.prompt.kind, "main", `${wrong} is not a valid chosen Main/Battle line`);
  assert.ok(paid.state.sides.p1.zones.hand.includes(extra));
  assert.equal(paid.events.filter((event) => event.type === "skill" && event.card === extra).length, 0);
  assert.equal(draws(paid.events), 0);
}
{
  const { state, cell, energy, extras: [extra] } = prepared();
  assert.ok(moveCard(state, dbs, extra, "drop", { owner: "p1" }).ok);
  const paid = paidUntilExtra(state, cell, energy[3]);
  assert.equal(paid.state.prompt.kind, "main", "the correct Extra outside the hand is not offered");
  assert.ok(paid.state.sides.p1.zones.drop.includes(extra));
}
{
  const { state, cell, energy, extras: [extra] } = prepared();
  state.effects.push({ id: 680, target: extra, kind: "forbid", value: 0,
    forbid: { what: "activateSkill", player: "p1" }, until: "turn",
    source: state.sides.p1.zones.leader[0], createdTurn: state.turn, ownerTurn: "p1", master: "p1" });
  const paid = paidUntilExtra(state, cell, energy[3]);
  assert.equal(paid.state.prompt.kind, "main", "a prohibited Extra line is not a legal free invocation");
  assert.ok(paid.state.sides.p1.zones.hand.includes(extra));
  assert.equal(paid.events.filter((event) => event.type === "skill" && event.card === extra).length, 0);
}
{
  const { state, cell, energy } = prepared([]);
  const other = stage(state, "C680-EXTRA", "hand", "p2");
  const paid = paidUntilExtra(state, cell, energy[3]);
  assert.equal(paid.state.prompt.kind, "main", "the opponent's matching Extra is not yours to invoke");
  assert.ok(paid.state.sides.p2.zones.hand.includes(other));
}

// A saved prompt must not turn an Extra moved out of hand into a fresh skill
// use. Multiple cards and multiple hybrid lines both require explicit answers.
{
  const { state, cell, energy, extras: [first, second] } = prepared(["C680-EXTRA", "C680-TWO"]);
  const paid = paidUntilExtra(state, cell, energy[3]);
  assert.equal(paid.state.prompt.kind, "chooseCards");
  if (paid.state.prompt.kind === "chooseCards") assert.deepEqual(paid.state.prompt.choice.candidates, [first, second]);
  const stale = reload(paid.state);
  assert.ok(moveCard(stale, dbs, second, "drop", { owner: "p1" }).ok);
  const staleBefore = JSON.stringify(stale);
  assert.throws(() => rules.apply(ctx, stale, { type: "choose", player: "p1", cards: [second] }), IllegalAction);
  assert.equal(JSON.stringify(stale), staleBefore);
  const cardChosen = take(paid.state, { type: "choose", player: "p1", cards: [second] });
  assert.equal(cardChosen.state.prompt.kind, "chooseMode");
  assert.ok(cardChosen.state.sides.p1.zones.hand.includes(first));
  const staleLine = reload(cardChosen.state);
  assert.ok(moveCard(staleLine, dbs, second, "drop", { owner: "p1" }).ok);
  const staleLineBefore = JSON.stringify(staleLine);
  assert.throws(() => rules.apply(ctx, staleLine, { type: "chooseMode", player: "p1", index: 1 }), IllegalAction);
  assert.equal(JSON.stringify(staleLine), staleLineBefore);
  const lineChosen = take(cardChosen.state, { type: "chooseMode", player: "p1", index: 1 });
  const reloaded = take(reload(cardChosen.state), { type: "chooseMode", player: "p1", index: 1 });
  assert.deepEqual(reloaded.events, lineChosen.events);
  assert.deepEqual(reloaded.state, lineChosen.state);
  assert.equal(draws(lineChosen.events), 2);
  assert.equal(lineChosen.events.filter((event) => event.type === "skill" && event.card === second).length, 1);
  assert.ok(lineChosen.state.sides.p1.zones.drop.includes(second));
  assert.ok(lineChosen.state.sides.p1.zones.hand.includes(first));
}

function legacyReady(): { legacy: ReturnType<typeof engineFor>; state: GameState; stageLegacy: (id: keyof typeof defs, area: "hand" | "energy" | "battle") => string } {
  const legacy = engineFor("legacy");
  let state = legacy.createGame(ctx, { seed: 681, p1: { name: "You", leader: "C680-LEADER", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as GameState;
  state = legacy.apply(ctx, state, { type: "chooseFirst", player: (state.prompt as { player: PlayerId }).player, first: "p1" }).state as GameState;
  for (const player of ["p1", "p2"] as const) state = legacy.apply(ctx, state, { type: "mulligan", player, redraw: false }).state as GameState;
  state = legacy.apply(ctx, state, { type: "charge", player: "p1", card: null }).state as GameState;
  state = legacy.apply(ctx, state, { type: "endMain", player: "p1" }).state as GameState;
  state = legacy.apply(ctx, state, { type: "charge", player: "p2", card: null }).state as GameState;
  state = legacy.apply(ctx, state, { type: "endMain", player: "p2" }).state as GameState;
  state = legacy.apply(ctx, state, { type: "charge", player: "p1", card: null }).state as GameState;
  assert.equal(state.prompt.kind, "main");
  const stageLegacy = (id: keyof typeof defs, area: "hand" | "energy" | "battle") => {
    const physical = state.players.p1.deck[0];
    assert.ok(physical);
    state.cards[physical].cardId = id;
    legacyMove(ctx, state, [], physical, area, "p1");
    return physical;
  };
  return { legacy, state, stageLegacy };
}
for (const wrong of ["C680-CELL2", "C680-GOHAN", "C680-REDCELL"] as const) {
  const { legacy, state, stageLegacy } = legacyReady();
  Array.from({ length: 4 }, () => stageLegacy(wrong === "C680-REDCELL" ? "C680-REDENERGY" : "C680-ENERGY", "energy"));
  const cell = stageLegacy(wrong, "hand");
  const played = legacy.apply(ctx, state, { type: "play", player: "p1", card: cell });
  assert.equal(played.state.prompt.kind, "main", `legacy: ${wrong} does not qualify at the play moment`);
  assert.equal(played.state.pending.length, 0);
}
{
  const { legacy, state, stageLegacy } = legacyReady();
  const leader = state.players.p1.leader;
  pendTriggers(ctx, state, "youPlayed", leader);
  assert.equal(state.pending.length, 0, "legacy: a missing play subject is not qualified");
  Array.from({ length: 4 }, () => stageLegacy("C680-ENERGY", "energy"));
  const cell = stageLegacy("C680-CELL", "hand");
  state.effects.push({ id: 6802, target: cell, kind: "cost", value: 1, until: "turn",
    source: leader, createdTurn: state.turn, ownerTurn: "p1", master: "p1" });
  assert.equal(legacyPlayCost(ctx, state, cell).total, 2);
  const played = legacy.apply(ctx, state, { type: "play", player: "p1", card: cell });
  assert.equal(played.state.prompt.kind, "main", "legacy: current cost 2 fails the at-least-3 trigger");
  assert.equal(played.state.pending.length, 0);
}
{
  const { legacy, state, stageLegacy } = legacyReady();
  const cell = stageLegacy("C680-FREECELL", "hand");
  assert.equal(legacyPlayCost(ctx, state, cell).total, 3);
  const played = legacy.apply(ctx, state, { type: "play", player: "p1", card: cell, alt: true });
  assert.equal(played.state.prompt.kind, "main", "legacy: its payment gap still omits the Auto price");
  assert.equal(played.state.pending.length, 0);
  // The Auto can have no eligible Extra here, so use its activation event as
  // the proof that alternative play payment did not lower the card's cost.
  assert.ok(played.events.some((event) => event.type === "skill" && event.card === state.players.p1.leader));
}
// The legacy engine shares the compiled nested invocation and its exact
// selector, but #549 still owns its separate action-price omission. Pin both
// facts on an actual play without treating the absent Hidden payment as legal.
{
  const { legacy, state: starting, stageLegacy } = legacyReady();
  let state = starting;
  const energy = Array.from({ length: 4 }, () => stageLegacy("C680-ENERGY", "energy"));
  const watcher = stageLegacy("C680-WATCH", "battle");
  const cell = stageLegacy("C680-CELL", "hand");
  const extra = stageLegacy("C680-EXTRA", "hand");
  const played = legacy.apply(ctx, state, { type: "play", player: "p1", card: cell });
  state = played.state as GameState;
  assert.equal(state.prompt.kind, "chooseCards", "legacy reaches the same optional nested Extra choice");
  assert.equal(energy.filter((id) => state.cards[id].hidden).length, 0, "#549 legacy gap: the Auto's Hidden price was omitted");
  const chosen = legacy.apply(ctx, state, { type: "choose", player: "p1", cards: [extra] });
  state = chosen.state as GameState;
  assert.ok(state.players.p1.drop.includes(extra));
  assert.ok(!state.players.p1.battle.includes(extra));
  assert.equal(chosen.events.filter((event) => event.type === "skill" && event.card === extra).length, 1);
  assert.equal(draws(chosen.events), 2, "legacy: waived hand Extra still causes the ordinary activation watcher");
  assert.equal(chosen.events.filter((event) => event.type === "skill" && event.card === watcher).length, 1);
  assert.equal(energy.filter((id) => state.cards[id].hidden).length, 0, "#549 legacy gap remains an active unsupported payment boundary");
}
}

console.log("free-extra-680: VM paid/declined activation, eligibility, stale/reload/privacy and legacy invocation boundary passed");
