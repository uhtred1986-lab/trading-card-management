/** 22-30-2 / 22-30-3 / 5-8-4: a printed [Aegis] action skill cost is a price, paid after the colours. */
// Independent expectations; never derived from the legacy oracle. The cards
// are synthetic printings of the "[Aegis XY] skill cost" form 22-30-2 names,
// not claims about a catalogued Aegis card.
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { compileCard } from "../../src/lib/arena/compile";
import { skillRecords } from "../../src/lib/arena/draft";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { NotYet } from "../../src/lib/arena/vm/errors";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const engine = engineFor("rules");
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;
const defs = { ...DEFS,
  REST595P: card("REST595P", { skill: "[Aegis red/blue] Switch this card to Rest Mode" }),
  DISC595P: card("DISC595P", { skill: "[Aegis red/blue] Place 1 card from your hand in your Drop Area" }),
  // KO is a strict-host price since #549's KO family (ko-marker-price-549.ts);
  // a draw is still outside the host.
  DRAW595P: card("DRAW595P", { skill: "[Aegis red/blue] Draw 1 card" }),
  UNREAD595P: card("UNREAD595P", { skill: "[Aegis red/blue] Sing the anthem of the Kai" }),
  MIXED595P: card("MIXED595P", { skill: "[Aegis red/blue] {1} Place 1 card from your hand in your Drop Area" }),
  ORBS595P: card("ORBS595P", { skill: "[Aegis red/blue] {1}" }),
  STALE595P: card("STALE595P", { skill: "[Aegis red/blue] Switch this card to Rest Mode" }),
  RED595P: card("RED595P", { colors: ["Red"], skill: null }),
  BLUE595P: card("BLUE595P", { colors: ["Blue"], skill: null }),
  FODDER595P: card("FODDER595P", { colors: ["Green"], skill: null }),
};

// ── the reading: compiler, drafter and the compiled context agree ───────────
{
  const rest = compileCard(defs.REST595P).bySkill[0];
  assert.deepEqual(rest.ops, [], "the text after the tag is not an effect");
  assert.deepEqual(rest.price?.ops, [{ op: "switchMode", target: { sel: { special: "self" } }, mode: "rest" }], "…it is the skill cost (22-30-2)");
  const [record] = skillRecords(defs.REST595P);
  assert.ok(record, "the line still gets a record a person can confirm");
  assert.deepEqual(record.ops, []);
  assert.deepEqual(record.cost?.program, rest.price?.ops, "the drafted record carries the cost program");
  assert.equal(record.cost?.text, "Switch this card to Rest Mode");
  assert.deepEqual(compileCard(defs.DISC595P).bySkill[0].price?.ops, [{ op: "discard", n: 1 }]);
  // Orbs alone are unchanged; orbs beside an action stay unread rather than
  // losing the orbs the parse never put in the energy cost.
  assert.equal(compileCard(defs.ORBS595P).bySkill[0].price?.ops, null);
  assert.deepEqual(skillRecords(defs.ORBS595P), [], "an orbs-only keyword line still needs no record");
  assert.ok(compileCard(defs.MIXED595P).unsupported.length > 0, "orbs mixed with an action stay explicitly unread");
  assert.equal(compileCard(defs.UNREAD595P).bySkill[0].price?.ops, null);
}

const scripts = rulesFromCompiler(defs);
// A record drafted before this reading: the cost as an effect program, no price.
const staleScripts = new Proxy(scripts, { get: (target, key) => key === "STALE595P"
  ? { ...target.STALE595P, bySkill: { 0: { ...target.STALE595P.bySkill[0], ops: [{ op: "switchMode", target: { sel: { special: "self" } }, mode: "rest" }], price: { condition: null, ops: null } } } }
  : (target as Record<string | symbol, unknown>)[key] });
const ctx: EngineContext = { ...CTX, defs, scripts: staleScripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function apply(s: VmState, action: Action) { return engine.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] }; }
function play(s: VmState, ...actions: Action[]): VmState { for (const action of actions) s = apply(s, action).state; return s; }
function stage(s: VmState, id: string, area: "battle" | "energy" | "hand"): string {
  const physical = s.sides.p1.zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: "p1" }).ok);
  return physical;
}
function defense(source: string, hand = ["RED595P", "BLUE595P", "FODDER595P", "FODDER595P"]) {
  let s = engine.createGame(ctx, { seed: 5952, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = play(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = play(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.prompt.kind, "main");
  for (const id of s.sides.p1.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  const source_ = stage(s, source, "battle");
  const cards = hand.map((id) => stage(s, id, "hand"));
  const energy = ["RED595P", "RED595P"].map((id) => stage(s, id, "energy"));
  s = play(s, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null });
  energy.forEach((id) => { s.cards[id].mode = "rest"; });
  s = play(s, { type: "attack", player: "p2", attacker: s.sides.p2.zones.leader[0], target: s.sides.p1.zones.leader[0] }, { type: "pass", player: "p2" });
  assert.equal(s.prompt.kind, "combo");
  return { s, card: source_, cards, energy };
}
const activate = (s: VmState, id: string) => apply(s, { type: "activate", player: "p1", card: id, skill: 0 });
const choose = (s: VmState, ids: string[], player: PlayerId = "p1") => apply(s, { type: "choose", player, cards: ids });
const skills = (ev: GameEvent[], id: string) => ev.filter((e) => e.type === "skill" && e.card === id);
// Red is picked; with a single Blue left in hand the incremental colour
// choice (#596) is forced and taken without a second question.
const colorPrompt = (s: VmState) => s.prompt.kind === "chooseCards" && /covering the named colours/.test(s.prompt.choice.reason);
function payColors(s: VmState, a: ReturnType<typeof defense>) {
  assert.ok(colorPrompt(s));
  const paid = choose(s, [a.cards[0]]);
  assert.ok(!colorPrompt(paid.state), "the only Blue left is the forced second colour");
  return paid;
}
const colors = (a: ReturnType<typeof defense>) => payColors(activate(a.s, a.card).state, a);
const view = (s: VmState, viewer: PlayerId) => JSON.stringify(buildSnapshot({ id: 595, revision: 1, mode: "versus", engine: "rules", status: "playing",
  p1Name: "Player 1", p2Name: "Player 2", ctx, state: s, legal: [], log: [], beats: null, spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));

// A self-rest price is paid after both colour cards and before the skill is
// announced, its use spent, or any energy stood (22-30-3, 22-30-5).
{
  const a = defense("REST595P");
  const declared = activate(a.s, a.card);
  assert.equal(declared.state.cards[a.card].mode, "active", "declaring pays nothing");
  assert.equal(skills(declared.events, a.card).length, 0);
  const paid = payColors(declared.state, a);
  const moveAt = paid.events.map((e, i) => e.type === "move" && e.from === "hand" && e.to === "drop" ? i : -1).filter((i) => i >= 0);
  const restAt = paid.events.findIndex((e) => e.type === "mode" && e.card === a.card && e.mode === "rest");
  const skillAt = paid.events.findIndex((e) => e.type === "skill" && e.card === a.card);
  assert.equal(moveAt.length, 2); assert.ok(moveAt.every((i) => i < restAt) && restAt < skillAt, "colours, then the printed price, then the activation");
  assert.equal(paid.state.cards[a.card].mode, "rest");
  assert.equal(paid.state.prompt.kind, "chooseCards", "the effect's energy choice follows payment");
  const stood = choose(choose(paid.state, [a.energy[0]]).state, []);
  assert.equal(stood.state.cards[a.energy[0]].mode, "active");
  assert.equal(stood.events.filter((e) => e.type === "mode" && e.card === a.card).length, 0, "the price is not run again as an effect");
}

// 5-8-4: a self-rest that cannot be performed after the colours fails the
// activation: the colour cards stay spent, no skill, use or energy follows.
{
  const a = defense("REST595P"); a.s.cards[a.card].mode = "rest";
  const failed = colors(a);
  assert.equal(failed.state.prompt.kind, "combo");
  assert.ok([a.cards[0], a.cards[1]].every((id) => failed.state.sides.p1.zones.drop.includes(id)));
  assert.equal(skills(failed.events, a.card).length, 0); assert.deepEqual(failed.state.cards[a.card].usedThisTurn, []);
  assert.ok(a.energy.every((id) => failed.state.cards[id].mode === "rest"));
  assert.ok(failed.events.some((e) => e.type === "note" && /Aegis activation failed/.test(e.text)));
}

// A hand price is asked after the colours, persists across reload, hides its
// candidates from the opponent, refuses stale/invalid answers unchanged and
// is charged once.
{
  const a = defense("DISC595P");
  const asked = colors(a); const s = asked.state;
  assert.equal(s.prompt.kind, "chooseCards"); assert.equal(skills(asked.events, a.card).length, 0);
  assert.equal(s.programs[0].aegisCost?.stage, "action");
  assert.deepEqual(s.cards[a.card].usedThisTurn, []);
  const candidates = s.prompt.kind === "chooseCards" ? s.prompt.choice.candidates : [];
  assert.deepEqual([...candidates].sort(), [a.cards[2], a.cards[3]].sort(), "only cards still in hand can pay; the colour cards are gone");
  assert.ok(!view(s, "p2").includes("FODDER595P"), "the opponent's view masks the price's hand candidates");
  assert.ok(view(s, "p1").includes("FODDER595P"), "the payer sees them");
  const before = JSON.stringify(s);
  assert.throws(() => choose(s, [a.cards[0]]), IllegalAction, "a colour card already paid cannot pay again");
  assert.throws(() => choose(s, [a.cards[2]], "p2"), IllegalAction, "only the payer answers");
  assert.throws(() => choose(s, []), IllegalAction, "the price is not optional");
  assert.equal(JSON.stringify(s), before);
  const stale = reload(s); assert.ok(moveCard(stale, game, a.cards[2], "deck", { owner: "p1" }).ok);
  const staleBefore = JSON.stringify(stale);
  assert.throws(() => choose(stale, [a.cards[2]]), IllegalAction); assert.equal(JSON.stringify(stale), staleBefore);
  const paid = choose(reload(s), [a.cards[2]]); const again = choose(reload(s), [a.cards[2]]);
  assert.equal(JSON.stringify(again.state), JSON.stringify(paid.state), "a reload at the price resolves the same");
  assert.ok(paid.state.sides.p1.zones.drop.includes(a.cards[2])); assert.ok(paid.state.sides.p1.zones.hand.includes(a.cards[3]), "charged once");
  const discard = paid.events.findIndex((e) => e.type === "move" && e.card === a.cards[2]);
  assert.ok(discard >= 0 && discard < paid.events.findIndex((e) => e.type === "skill" && e.card === a.card));
  assert.equal(skills(paid.events, a.card).length, 1);
  assert.equal(paid.events.filter((e) => e.type === "move" && e.from === "hand").length, 1, "no colour card moves again");
}

// The colours empty the hand, so the hand price is now unaffordable (5-8-4).
{
  const a = defense("DISC595P", ["RED595P", "BLUE595P"]);
  const failed = colors(a);
  assert.equal(failed.state.prompt.kind, "combo"); assert.equal(skills(failed.events, a.card).length, 0);
  assert.ok(a.cards.every((id) => failed.state.sides.p1.zones.drop.includes(id)));
  assert.deepEqual(failed.state.cards[a.card].usedThisTurn, []);
}

// A price outside the strict shared host is an explicit #595 gap, raised on
// declaration — before any colour card is paid — rather than after.
{
  const a = defense("DRAW595P");
  assert.throws(() => activate(a.s, a.card), (err: unknown) => err instanceof NotYet && err.issue === "#595" && /draw/.test(err.step));
  assert.ok(a.cards.every((id) => a.s.sides.p1.zones.hand.includes(id)));
}

// Unread text, orbs beside an action, and a stale record that ran the cost as
// an effect are each refused, never activated for the colours alone.
for (const source of ["UNREAD595P", "MIXED595P", "STALE595P"]) {
  const a = defense(source);
  assert.throws(() => activate(a.s, a.card), (err: unknown) => err instanceof IllegalAction && /refused: unread/.test(err.message), source);
}
// Orb-only and colour-only Aegis lines are offered as before.
{
  const a = defense("ORBS595P"); a.s.cards[a.energy[0]].mode = "active";
  const paid = colors(a);
  assert.equal(skills(paid.events, a.card).length, 1);
  assert.equal(paid.state.cards[a.energy[0]].mode, "rest", "the orb is paid after the colours");
}
console.log("Aegis #595: printed action skill cost read as a price and paid after the colours");
