/** 9-6-3-1-1: a pending cost-free [Auto] still in a secret area may be left undeclared. */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { vmToBeats } from "../../src/lib/arena/vm/beats";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { moved, run, shuffleDeck } from "../../src/lib/arena/vm/flow";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Beats } from "../../src/lib/arena/beats";
import type { EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { Op } from "../../src/lib/arena/vm/script";

const rules = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const defs = { ...DEFS,
  H549: card("H549", { energyCost: 0, skill: "[Auto] When you play this card, draw 1 card." }),
  OTHER549: card("OTHER549", { energyCost: 0, skill: null }),
  A549: card("A549", { energyCost: 0, skill: "[Auto] At the start of your Charge Phase, choose 1 of your Battle Cards and return it to its owner's hand." }),
  B549: card("B549", { energyCost: 0, skill: "[Auto] At the start of your Charge Phase, draw 1 card." }),
};
const scripts = rulesFromCompiler(defs);
function script(id: "H549" | "A549" | "B549", trigger: "played" | "chargeStart", ops: Op[]): void {
  const original = scripts[id].bySkill[0];
  assert.ok(original);
  scripts[id].bySkill[0] = { ...original, trigger: [trigger], unsupported: [], ops, price: { ...original.price, condition: null, ops: null } };
}
script("H549", "played", [{ op: "draw", n: 1 }]);
script("A549", "chargeStart", [{ op: "choose", sel: { side: "you", area: "battle", count: 1 }, as: "returned" }, { op: "moveTo", target: { var: "returned" }, to: "hand" }]);
script("B549", "chargeStart", [{ op: "draw", n: 1 }]);
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (state: VmState): VmState => JSON.parse(JSON.stringify(state));

function main(): VmState {
  let state = rules.createGame(ctx, { seed: 5491, p1: { name: "First", leader: "L-RED", main: fifty("V1") }, p2: { name: "Second", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  state = rules.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) state = rules.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(state.prompt.kind, "main");
  return state;
}
function stage(state: VmState, id: keyof typeof defs, area: "hand" | "battle" = "hand", player: PlayerId = "p1"): string {
  const source = state.sides[player].zones.hand.find((candidate) => !["H549", "OTHER549", "A549", "B549"].includes(state.cards[candidate].cardId));
  assert.ok(source);
  state.cards[source].cardId = id;
  if (area !== "hand") assert.ok(moveCard(state, dbs, source, area, { owner: player }).ok);
  return source;
}
function order(state: VmState, index: number, player: PlayerId, decline = false) {
  return rules.apply(ctx, reload(state), { type: "orderPending", player, index, ...(decline ? { decline: true as const } : {}) }) as { state: VmState; events: GameEvent[] };
}
function snapshot(state: VmState, viewer: PlayerId, beats: Beats | null = null) {
  return buildSnapshot({ id: 5491, mode: "versus", status: "playing", p1Name: "First", p2Name: "Second", ctx, state, legal: rules.legalActions(ctx, state), log: [], beats, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}
const skillEvents = (events: GameEvent[], card: string): Extract<GameEvent, { type: "skill" }>[] =>
  events.filter((event): event is Extract<GameEvent, { type: "skill" }> => event.type === "skill" && event.card === card);

// A singleton cost-free hand source is a real choice. Leaving it undeclared
// removes only that pending occurrence, with no skill, draw, cost or public clue.
{
  const state = main();
  const hidden = stage(state, "H549");
  const other = stage(state, "OTHER549");
  state.pending.push({ card: hidden, master: "p1", skillIndex: 0, trigger: "played" });
  const events: GameEvent[] = [];
  run(ctx, dbs, state, events);
  assert.equal(state.prompt.kind, "orderPending");
  const owner = snapshot(state, "p1");
  const opponent = snapshot(state, "p2");
  assert.deepEqual(owner.legal.filter((move) => move.action.type === "orderPending").map((move) => move.action), [
    { type: "orderPending", player: "p1", index: 0 },
    { type: "orderPending", player: "p1", index: 0, decline: true },
  ]);
  assert.equal(owner.view.prompt.question, "Which pending skill do you declare?");
  assert.equal(opponent.view.prompt.kind, "waiting");
  assert.equal(opponent.legal.length, 0);
  assert.ok(!JSON.stringify(opponent).includes("H549"));
  assert.ok(!JSON.stringify(opponent).includes("OTHER549"));
  for (const [index, player] of [[-1, "p1"], [0, "p2"]] as const) {
    const before = JSON.stringify(state);
    assert.throws(() => order(state, index, player, true), IllegalAction);
    assert.equal(JSON.stringify(state), before);
  }
  const changed = reload(state); changed.pending[0].subject = other;
  assert.throws(() => order(changed, 0, "p1", true), IllegalAction);
  const publicSource = reload(state); assert.ok(moveCard(publicSource, dbs, hidden, "battle", { owner: "p1" }).ok);
  assert.throws(() => order(publicSource, 0, "p1", true), IllegalAction);
  const declined = order(state, 0, "p1", true);
  assert.equal(declined.state.prompt.kind, "main");
  assert.equal(declined.state.pending.length, 0);
  assert.deepEqual(declined.events.filter((event) => event.type === "skill" || event.type === "note" || event.type === "draw"), []);
  assert.ok(!JSON.stringify(snapshot(declined.state, "p2", vmToBeats(ctx, declined.state, declined.events))).includes("H549"));
  const declared = order(state, 0, "p1");
  assert.equal(skillEvents(declared.events, hidden).length, 1);
  assert.equal(skillEvents(declared.events, hidden)[0].type === "skill" && skillEvents(declared.events, hidden)[0].reveal, true);
  assert.equal(declared.events.filter((event) => event.type === "draw").length, 1);
  const beats = vmToBeats(ctx, declared.state, declared.events);
  const now = snapshot(declared.state, "p2", beats);
  // Shown to p2 under an opaque name, never its instance id, which is a hidden decklist position (`conceal.ts`).
  assert.equal(now.beats?.art["?shown:0"]?.cardId, "H549");
  assert.equal(now.beats?.art[hidden], undefined);
  assert.ok(!JSON.stringify(now).includes(`"${hidden}"`), "the declared card's instance id is not on p2's board");
  assert.equal(now.beats?.art[other], undefined);
  assert.ok(!JSON.stringify(now).includes("OTHER549"));
  const persisted = snapshot(reload(declared.state), "p2", beats);
  assert.equal(persisted.beats?.art["?shown:0"]?.cardId, "H549");
  assert.ok(!JSON.stringify(now).includes("revealEpoch") && !JSON.stringify(persisted).includes("revealEpoch"));
  const later = rules.apply(ctx, reload(declared.state), { type: "pass", player: "p1" });
  assert.deepEqual(Object.keys(snapshot(later.state as VmState, "p2", beats).beats?.art ?? {}).filter((id) => id === hidden || id.startsWith("?shown:")), [], "a later unrelated action re-masks retained history");
  const reentered = reload(declared.state);
  const moveEvents: GameEvent[] = [];
  moved(ctx, dbs, reentered, moveEvents, hidden, "battle", { owner: "p1" });
  moved(ctx, dbs, reentered, moveEvents, hidden, "hand", { owner: "p1" });
  assert.deepEqual(Object.keys(snapshot(reentered, "p2", beats).beats?.art ?? {}).filter((id) => id === hidden || id.startsWith("?shown:")), [], "source departure and re-entry end the old reveal");
  reentered.pending.push({ card: hidden, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, dbs, reentered, []);
  const redeclared = order(reentered, 0, "p1");
  const newBeats = vmToBeats(ctx, redeclared.state, redeclared.events, beats.seq);
  const history = { seq: newBeats.seq, list: [...beats.list, ...newBeats.list], art: { ...beats.art, ...newBeats.art } };
  const remembered = snapshot(redeclared.state, "p2", history);
  const skills = remembered.beats?.list.filter((beat) => beat.t === "skill") ?? [];
  assert.equal(skills.length, 2);
  assert.equal(skills[0].t === "skill" && skills[0].text, "", "the older activation does not inherit a later epoch");
  assert.ok(skills[1].t === "skill" && skills[1].text.includes("draw 1"));
  // Nor is it linked to the shown one: only the live declaration names its card.
  assert.deepEqual(skills.map((beat) => beat.t === "skill" && beat.card), ["?", "?shown:0"]);
}

// A cost-free effect can suspend at a choice. Its exact declared frame keeps
// the source visible across JSON reload and that answer, then relinquishes
// the reveal at the next unrelated action.
{
  const original = scripts.H549.bySkill[0];
  scripts.H549.bySkill[0] = { ...original, ops: [
    { op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "picked" },
    { op: "draw", n: 1 },
  ] };
  const state = main();
  const secret = stage(state, "H549");
  const other = stage(state, "OTHER549");
  state.pending.push({ card: secret, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, dbs, state, []);
  const declared = order(state, 0, "p1");
  assert.equal(declared.state.prompt.kind, "chooseCards");
  const beats = vmToBeats(ctx, declared.state, declared.events);
  assert.equal(snapshot(reload(declared.state), "p2", beats).beats?.art["?shown:0"]?.cardId, "H549");
  assert.equal(snapshot(reload(declared.state), "p2", beats).beats?.art[secret], undefined, "shown under an opaque name, not its instance id");
  assert.equal(snapshot(reload(declared.state), "p2", beats).beats?.art[other], undefined);
  const answered = rules.apply(ctx, reload(declared.state), { type: "choose", player: "p1", cards: [other] });
  assert.equal((answered.state as VmState).prompt.kind, "main");
  assert.equal(snapshot(answered.state as VmState, "p2", beats).beats?.art["?shown:0"]?.cardId, "H549");
  const later = rules.apply(ctx, answered.state, { type: "pass", player: "p1" });
  assert.equal(snapshot(later.state as VmState, "p2", beats).beats?.art[secret], undefined);
  scripts.H549.bySkill[0] = original;
}

// Repeated occurrences are separate pending records. Withholding one leaves
// the other for a fresh singleton offer; only then does the opposing master
// resolve their older public Auto.
{
  const state = main();
  const secret = stage(state, "H549");
  const opposing = stage(state, "B549", "battle", "p2");
  state.pending.push({ card: opposing, master: "p2", skillIndex: 0, trigger: "chargeStart" });
  state.pending.push({ card: secret, master: "p1", skillIndex: 0, trigger: "played" });
  state.pending.push({ card: secret, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, dbs, state, []);
  assert.deepEqual(state.prompt.kind === "orderPending" ? state.prompt.candidates : [], [1, 2]);
  const first = order(state, 2, "p1", true);
  assert.equal(first.state.prompt.kind, "orderPending");
  assert.deepEqual(first.state.pending.map((item) => item.card), [opposing, secret]);
  assert.deepEqual(first.state.prompt.kind === "orderPending" ? first.state.prompt.candidates : [], [1]);
  const second = order(first.state, 1, "p1", true);
  assert.equal(skillEvents(second.events, secret).length, 0);
  assert.equal(skillEvents(second.events, opposing).length, 1);
  assert.equal(second.state.pending.length, 0);
}

// A face-up Life card is public under 3-9-2-1. Its cost-free Auto remains
// compulsory even though the physical zone is ordinarily secret.
{
  const state = main();
  const source = stage(state, "H549");
  assert.ok(moveCard(state, dbs, source, "life", { owner: "p1" }).ok);
  state.cards[source].faceUp = true;
  state.pending.push({ card: source, master: "p1", skillIndex: 0, trigger: "played" });
  const events: GameEvent[] = [];
  run(ctx, dbs, state, events);
  assert.equal(state.prompt.kind, "main");
  assert.equal(skillEvents(events, source).length, 1);
  assert.equal(skillEvents(events, source)[0].type === "skill" && skillEvents(events, source)[0].reveal, undefined);
}

// Even an unchanged one-card deck permutation revokes a card's temporary
// declaration reveal. A deck source is an internal pending-record control:
// no present DBS declaration naturally fires for a card still face down there.
{
  const original = scripts.H549.bySkill[0];
  scripts.H549.bySkill[0] = { ...original, ops: [] };
  const state = main();
  const source = stage(state, "H549");
  assert.ok(moveCard(state, dbs, source, "deck", { owner: "p1" }).ok);
  for (const id of [...state.sides.p1.zones.deck]) if (id !== source) assert.ok(moveCard(state, dbs, id, "removed", { owner: "p1" }).ok);
  assert.deepEqual(state.sides.p1.zones.deck, [source]);
  state.pending.push({ card: source, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, dbs, state, []);
  const offered = snapshot(state, "p1");
  assert.ok(offered.legal.every((move) => !move.label.includes("H549")), "even the master cannot inspect a face-down deck source");
  const declared = order(state, 0, "p1");
  const beats = vmToBeats(ctx, declared.state, declared.events);
  assert.equal(snapshot(declared.state, "p2", beats).beats?.art["?shown:0"]?.cardId, "H549");
  shuffleDeck(declared.state, "p1");
  assert.deepEqual(declared.state.sides.p1.zones.deck, [source]);
  assert.equal(snapshot(declared.state, "p2", beats).beats?.art[source], undefined);
  // The skill-language shuffle goes through the separate host mover. It too
  // must revoke before the same action's snapshot can reuse the revealed id.
  scripts.H549.bySkill[0] = { ...original, ops: [{ op: "shuffle" }] };
  const effectState = main();
  const effectSource = stage(effectState, "H549");
  assert.ok(moveCard(effectState, dbs, effectSource, "deck", { owner: "p1" }).ok);
  for (const id of [...effectState.sides.p1.zones.deck]) if (id !== effectSource) assert.ok(moveCard(effectState, dbs, id, "removed", { owner: "p1" }).ok);
  effectState.pending.push({ card: effectSource, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, dbs, effectState, []);
  const shuffled = order(effectState, 0, "p1");
  assert.equal(skillEvents(shuffled.events, effectSource)[0].reveal, true);
  assert.deepEqual(shuffled.state.sides.p1.zones.deck, [effectSource]);
  assert.equal(snapshot(shuffled.state, "p2", vmToBeats(ctx, shuffled.state, shuffled.events)).beats?.art[effectSource], undefined);
  scripts.H549.bySkill[0] = original;
}

// The same host shuffle can target Life (#574). An actual declaration action
// from a face-down Life source must lose its temporary witness even when its
// one-card Life pile cannot change order. The pending record is an internal
// source control: no present card naturally fires this on-play trigger there.
{
  const original = scripts.H549.bySkill[0];
  scripts.H549.bySkill[0] = { ...original, ops: [{ op: "shuffle", side: "you", areas: ["life"] }] };
  const state = main();
  const source = stage(state, "H549");
  assert.ok(moveCard(state, dbs, source, "life", { owner: "p1" }).ok);
  for (const id of [...state.sides.p1.zones.life]) if (id !== source) assert.ok(moveCard(state, dbs, id, "removed", { owner: "p1" }).ok);
  assert.deepEqual(state.sides.p1.zones.life, [source]);
  state.pending.push({ card: source, master: "p1", skillIndex: 0, trigger: "played" });
  run(ctx, dbs, state, []);
  assert.equal(state.prompt.kind, "orderPending");
  const declared = order(state, 0, "p1");
  assert.equal(skillEvents(declared.events, source)[0]?.reveal, true);
  assert.deepEqual(declared.state.sides.p1.zones.life, [source], "a one-card Life shuffle keeps its physical order");
  assert.deepEqual(declared.state.publicAutoReveals ?? [], [], "the host revokes its declaration witness during the Life shuffle");
  const beats = vmToBeats(ctx, declared.state, declared.events);
  for (const viewer of ["p1", "p2"] as const) {
    const projected = snapshot(reload(declared.state), viewer, beats);
    assert.equal(projected.beats?.art[source], undefined);
    const oldSkill = projected.beats?.list.find((beat) => beat.t === "skill");
    assert.equal(oldSkill?.t === "skill" ? oldSkill.text : undefined, "");
    assert.equal(oldSkill?.t === "skill" ? oldSkill.card : undefined, "?", "a shuffled Life source is not named, by face or by id (`conceal.ts`)");
    assert.equal(projected.spotlight, null);
    assert.deepEqual(projected.log, []);
    assert.ok(!JSON.stringify(projected).includes("H549"), "neither saved viewer snapshot identifies a shuffled Life source");
  }
  scripts.H549.bySkill[0] = original;
}

// Both Autos really pend on the following turn's Charge Phase. Resolving A
// moves B from the public Battle Area to a private hand before B is selected;
// the still-pending B then gets the 9-6-3-1-1 declaration choice.
{
  const state = main();
  const a = stage(state, "A549", "battle", "p2");
  const b = stage(state, "B549", "battle", "p2");
  const advanced = rules.apply(ctx, state, { type: "pass", player: "p1" });
  const pending = advanced.state as VmState;
  assert.equal(pending.prompt.kind, "orderPending");
  assert.deepEqual(pending.pending.map((item) => [item.card, item.master, item.trigger]), [[a, "p2", "chargeStart"], [b, "p2", "chargeStart"]]);
  const first = order(pending, 0, "p2");
  assert.equal(first.state.prompt.kind, "chooseCards");
  const returned = rules.apply(ctx, reload(first.state), { type: "choose", player: "p2", cards: [b] });
  const next = returned.state as VmState;
  assert.equal(next.sides.p2.zones.hand.includes(b), true);
  assert.equal(next.prompt.kind, "orderPending");
  assert.deepEqual(next.pending.map((item) => [item.card, item.master, item.trigger]), [[b, "p2", "chargeStart"]]);
  assert.ok(rules.legalActions(ctx, next).some((move) => move.action.type === "orderPending" && move.action.index === 0 && move.action.decline));
  assert.equal(snapshot(next, "p1").view.prompt.kind, "waiting");
  const withheld = order(next, 0, "p2", true);
  assert.equal(skillEvents(withheld.events, b).length, 0);
  const activated = order(next, 0, "p2");
  assert.equal(skillEvents(activated.events, b).length, 1);
  assert.equal(activated.events.filter((event) => event.type === "draw").length, withheld.events.filter((event) => event.type === "draw").length + 1);
}

console.log("#549 secret-area cost-free Auto declaration and decline: ok");
