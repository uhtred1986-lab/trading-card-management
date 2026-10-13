/** The last catalogued Auto action prices on the strict host (#549). */
// Fixed expectations from 2-7-2, 3-1-4-3, 5-7-1/5-7-2/5-7-3-1, 5-8-2-2,
// 5-8-2-2-1-1, 5-8-4 and 9-6-4; never derived from the legacy oracle. The card
// texts are the deckplanet catalog's own (13 Oct 2026, read-only), with the
// catalog's printed stats: BT12-023 (and its PR print) "flip 1 face-up card in
// your life face down", BT29-030 "Use 1 card from under this card in a combo
// with its skills negated for the turn", DB2-011 "This card gets -15000 power
// for the turn". BT29-030 and DB2-011 fire from their own printed moments;
// BT12-023's moment (removed by an opponent's skill) is pended directly.
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { run } from "../../src/lib/arena/vm/flow";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { NotYet } from "../../src/lib/arena/vm/errors";
import { readableAutomaticPrice } from "../../src/lib/arena/vm/auto-costs";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Op } from "../../src/lib/arena/vm/script";
import type { Action, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const rules = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const dbs = loaded.definition;
const BT12_023 = "[Unique]<br>[Auto][Once per turn] If your Leader Card is a red &lt;King Piccolo&gt; card: When a card is placed in your life face up from any area other than your life, draw 1 card.<br>[Auto] If your Leader Card is a red &lt;King Piccolo&gt; card and you flip 1 face-up card in your life face down: When this card is placed in your Drop Area from your Battle Area by an opponent's skill, play this card from your Drop Area with its skills negated for the turn.<br>";
const BT29_030 = "[deflect][triple attack]\n[permanent] When this card would be removed from a Battle Area by an opponent's skill, you may place 1 ≪Cooler's Armored Squadron≫ card from under this card into its owner's Drop instead.\n[auto] When this card is played, place up to 3 cards with 5000 combo power and different card names from your Drop under this card.\n[auto] Use 1 card from under this card in a combo with its skills negated for the turn: When this card attacks, choose up to 1 of your opponent's Battle Cards and return it to its owner's hand.";
const DB2_011 = "[Double Strike]<br>[Deflect]<br>[Auto] This card gets -15000 power for the turn: When one of your opponent's cards attacks, negate the attack.<br>[Activate: Main] Choose 2 skill-less Battle Cards in your Drop Area and remove them from the game: Switch this card to Active Mode.";
const defs = { ...DEFS,
  PIANO549: card("PIANO549", { energyCost: 1, power: 4000, comboCost: 0, comboPower: 5000, characters: ["Piano"], traits: ["Demon Clan"], skill: BT12_023 }),
  SQUADRON549: card("SQUADRON549", { type: "Z-BATTLE", colors: ["Blue"], energyCost: 3, power: 25000, comboCost: 0, comboPower: 0, characters: ["Cooler's Armored Squadron"], traits: ["Cooler's Armored Squadron"], skill: BT29_030 }),
  GANOS549: card("GANOS549", { energyCost: 5, power: 30000, comboCost: 1, comboPower: 10000, characters: ["Ganos"], traits: ["Alien", "Universe 4"], skill: DB2_011 }),
  PICCOLO549: card("PICCOLO549", { type: "LEADER", characters: ["King Piccolo"], energyCost: null, comboCost: null, comboPower: null }),
  DORE549: card("DORE549", { colors: ["Blue"], comboCost: 0, comboPower: 5000, characters: ["Dore"], traits: ["Cooler's Armored Squadron"] }),
  SALZA549: card("SALZA549", { colors: ["Blue"], comboCost: 1, comboPower: 10000, characters: ["Salza"], traits: ["Cooler's Armored Squadron"] }),
  NOCOMBO549: card("NOCOMBO549", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null }),
};
const scripts = rulesFromCompiler(defs);
const ctx: EngineContext = { ...CTX, defs, scripts };
const priced = (id: keyof typeof defs): number => {
  const found = Object.entries(scripts[id].bySkill).find(([, skill]) => skill?.price?.ops?.length);
  assert.ok(found, `${id} has a priced skill`);
  return Number(found[0]);
};
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, action: Action) => rules.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] };
const answer = (s: VmState, index: number, player: PlayerId = "p1") => apply(s, { type: "chooseMode", player, index });
const choose = (s: VmState, cards: string[], player: PlayerId = "p1") => apply(s, { type: "choose", player, cards });
const skillAt = (ev: GameEvent[], id: string) => ev.findIndex((e) => e.type === "skill" && e.card === id);
const skills = (ev: GameEvent[], id: string) => ev.filter((e) => e.type === "skill" && e.card === id).length;
const declineIndex = (s: VmState) => { assert.ok(s.prompt.kind === "chooseMode"); return s.prompt.kind === "chooseMode" ? s.prompt.options.length - 1 : -1; };
const candidates = (s: VmState) => (s.prompt.kind === "chooseCards" ? [...s.prompt.choice.candidates].sort() : []);
function snapshot(s: VmState, viewer: PlayerId) {
  return buildSnapshot({ id: 549, mode: "versus", status: "playing", p1Name: "You", p2Name: "Other", ctx, state: s, legal: rules.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}
/** Both projections of a pending price decision: the payer is asked; the
 * opponent waits with no legal move; neither view carries the cost cursor. */
function projections(s: VmState, payer: PlayerId = "p1"): void {
  const other: PlayerId = payer === "p1" ? "p2" : "p1";
  const mine = snapshot(s, payer); const theirs = snapshot(s, other);
  assert.equal(mine.waiting, "you"); assert.equal(theirs.waiting, "opponent");
  assert.ok(mine.legal.length > 0); assert.equal(theirs.legal.length, 0);
  for (const view of [mine, theirs]) assert.ok(!JSON.stringify(view).includes("autoCost"));
}
function main(leader?: string): VmState {
  let s = rules.createGame(ctx, { seed: 5493, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = rules.apply(ctx, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = rules.apply(ctx, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(s.prompt.kind, "main");
  if (leader) s.cards[s.sides.p1.zones.leader[0]].cardId = leader;
  return s;
}
function stage(s: VmState, id: string, area: "hand" | "battle" | "energy" | "drop" = "battle", p: PlayerId = "p1", under?: string): string {
  const physical = s.sides[p].zones.deck[0];
  assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, dbs, physical, area, { owner: p, ...(under ? { under } : {}) }).ok);
  return physical;
}
function unaffordable(s: VmState, before: string, ev: GameEvent[], source: string): void {
  assert.notEqual(s.prompt.kind, "chooseMode", "no payment is offered");
  assert.equal(JSON.stringify(s.sides), before, "nothing is paid");
  assert.equal(skills(ev, source), 0);
  assert.ok(ev.some((e) => e.type === "note" && /unaffordable/.test(e.text)));
}

// ── the reading: the catalog wordings compile to the shapes this host admits ─
{
  const piano = scripts.PIANO549.bySkill[priced("PIANO549")].price!;
  assert.equal(piano.condition?.kind, "leaderMatches", "the Leader condition stays a condition, not a price step");
  assert.deepEqual(piano.ops?.map((op) => op.op), ["choose", "faceUp"]);
  const pick = piano.ops![0] as Extract<Op, { op: "choose" }>;
  assert.equal(pick.sel.area, "life"); assert.equal(pick.sel.count, 1); assert.equal(pick.sel.filter?.faceUp, true);
  assert.equal((piano.ops![1] as Extract<Op, { op: "faceUp" }>).faceUp, false);
  const squadron = scripts.SQUADRON549.bySkill[priced("SQUADRON549")].price!;
  assert.deepEqual(squadron.ops?.map((op) => op.op), ["choose", "comboFrom"]);
  assert.equal((squadron.ops![0] as Extract<Op, { op: "choose" }>).sel.area, "under");
  assert.equal((squadron.ops![1] as Extract<Op, { op: "comboFrom" }>).negated, true);
  assert.deepEqual(scripts.GANOS549.bySkill[priced("GANOS549")].price?.ops, [{ op: "power", target: { sel: { special: "self" } }, amount: -15000, until: "turn" }]);
  for (const id of ["PIANO549", "SQUADRON549", "GANOS549"] as const) {
    for (const [label, owner] of [["Auto", "#549"], ["Aegis", "#595"], ["Counter", "#716"]] as const) readableAutomaticPrice(scripts[id].bySkill[priced(id)].price!.ops!, label, owner);
  }
  // Neighbouring shapes without a payment proof stay typed unknown.
  const life = (extra: object) => ({ op: "choose" as const, sel: { side: "you" as const, area: "life" as const, count: 1, ...extra }, as: "c0" });
  const under = (extra: object, sel: object = {}) => ({ op: "choose" as const, sel: { side: "you" as const, area: "under" as const, count: 1, ...sel }, as: "c0", ...extra });
  const unproved: Op[][] = [
    [life({ filter: { faceUp: true } }), { op: "faceUp", target: { var: "c0" } }], // a face-up card turned face up: contradictory
    [life({ filter: { faceUp: true, colors: ["Red"] } }), { op: "faceUp", target: { var: "c0" }, faceUp: false }],
    [life({ upTo: true }), { op: "faceUp", target: { var: "c0" }, faceUp: false }],
    [under({}, { upTo: true }), { op: "comboFrom", target: { var: "c0" }, negated: true }],
    [under({}, { count: 2 }), { op: "comboFrom", target: { var: "c0" } }],
    [under({}, { area: "drop" }), { op: "comboFrom", target: { var: "c0" } }],
    [under({ chooser: "opponent" }), { op: "comboFrom", target: { var: "c0" } }],
    [{ op: "comboFrom", target: { sel: { side: "you", area: "hand" } } }],
    [{ op: "power", target: { sel: { special: "self" } }, amount: 5000, until: "turn" }],
    [{ op: "power", target: { sel: { special: "self" } }, amount: { x: true }, until: "turn" }],
    [{ op: "power", target: { sel: { special: "self" } }, amount: -5000, until: "game" }],
    [{ op: "choose", sel: { side: "you", area: "battle", count: 1 }, as: "c0" }, { op: "power", target: { var: "c0" }, amount: -5000, until: "turn" }],
  ];
  for (const ops of unproved) for (const owner of ["#549", "#595"] as const) {
    assert.throws(() => readableAutomaticPrice(ops, owner === "#549" ? "Auto" : "Aegis", owner), (err: unknown) => err instanceof NotYet && err.issue === owner, JSON.stringify(ops));
  }
}

// ── BT12-023: flip 1 face-up card in your life face down ───────────────────
// Offered only while the Leader condition holds and a face-up Life card
// exists; the choice offers only face-up Life cards; payment turns exactly
// that card face down (verified) before the skill plays the source.
function piano(leader = "PICCOLO549", faceUp = 2) {
  const s = main(leader);
  const source = stage(s, "PIANO549", "drop");
  const life = s.sides.p1.zones.life;
  for (const id of life.slice(0, faceUp)) s.cards[id].faceUp = true;
  return { s, source, up: life.slice(0, faceUp), down: life.slice(faceUp) };
}
function pendPiano(s: VmState, source: string): GameEvent[] {
  s.pending.push({ card: source, master: "p1", skillIndex: priced("PIANO549"), trigger: "played" });
  const ev: GameEvent[] = [];
  run(ctx, dbs, s, ev);
  return ev;
}
{
  const a = piano();
  const ev = pendPiano(a.s, a.source);
  assert.equal(a.s.prompt.kind, "chooseMode"); assert.equal(skills(ev, a.source), 0);
  assert.ok(a.s.prompt.kind === "chooseMode" && /Pay/.test(a.s.prompt.options[0]) && /face down/.test(a.s.prompt.options[0]), "the price names itself");
  projections(a.s);
  const offer = JSON.stringify(a.s);
  assert.throws(() => answer(a.s, 0, "p2"), IllegalAction, "only the Auto's master answers");
  assert.throws(() => answer(a.s, 9), IllegalAction);
  assert.equal(JSON.stringify(a.s), offer);
  const declined = answer(a.s, declineIndex(a.s));
  assert.ok(a.up.every((id) => declined.state.cards[id].faceUp), "declining turns nothing");
  assert.ok(declined.state.sides.p1.zones.drop.includes(a.source)); assert.equal(skills(declined.events, a.source), 0);
  const opened = answer(a.s, 0);
  assert.equal(opened.state.prompt.kind, "chooseCards");
  assert.deepEqual(candidates(opened.state), [...a.up].sort(), "only face-up Life cards can be turned face down");
  assert.equal(skills(opened.events, a.source), 0);
  projections(opened.state);
  const saved = JSON.stringify(opened.state);
  assert.throws(() => choose(opened.state, [a.up[0]], "p2"), IllegalAction);
  assert.throws(() => choose(opened.state, [a.down[0]]), IllegalAction, "a face-down card is no payment");
  assert.throws(() => choose(opened.state, []), IllegalAction, "the price is not optional once paying");
  assert.equal(JSON.stringify(opened.state), saved);
  const stale = reload(opened.state); stale.cards[a.up[0]].faceUp = false;
  const staleBefore = JSON.stringify(stale);
  assert.throws(() => choose(stale, [a.up[0]]), IllegalAction, "a card already face down can no longer pay");
  assert.equal(JSON.stringify(stale), staleBefore);
  const paid = choose(reload(opened.state), [a.up[0]]); const again = choose(JSON.parse(saved) as VmState, [a.up[0]]);
  assert.equal(JSON.stringify(again.state), JSON.stringify(paid.state), "reload mid-price resolves identically");
  assert.equal(paid.state.cards[a.up[0]].faceUp, false); assert.equal(paid.state.cards[a.up[1]].faceUp, true);
  const turned = paid.events.findIndex((e) => e.type === "note" && /face down/.test(e.text));
  assert.ok(turned >= 0 && turned < skillAt(paid.events, a.source), "turned face down, then the skill");
  assert.equal(paid.events.filter((e) => e.type === "note" && /face down/.test(e.text)).length, 1, "charged once");
  assert.equal(skills(paid.events, a.source), 1);
  assert.ok(paid.state.sides.p1.zones.battle.includes(a.source), "the effect plays the source from the Drop");
  assert.ok(!JSON.stringify(snapshot(paid.state, "p2")).includes(a.up[0]), "the turned Life card is private again");
  assert.ok(JSON.stringify(snapshot(paid.state, "p2")).includes(a.up[1]), "the other face-up Life card stays public");
}
// No face-up Life card: unaffordable, nothing turns, nothing is played.
{
  const a = piano("PICCOLO549", 0);
  const before = JSON.stringify(a.s.sides);
  const ev = pendPiano(a.s, a.source);
  unaffordable(a.s, before, ev, a.source);
}
// 9-6-4-1-1: the Leader condition is a condition, not a choice. Without it
// the skill is neither offered nor paid.
{
  const a = piano("L-RED");
  const before = JSON.stringify(a.s.sides);
  const ev = pendPiano(a.s, a.source);
  assert.notEqual(a.s.prompt.kind, "chooseMode"); assert.equal(JSON.stringify(a.s.sides), before); assert.equal(skills(ev, a.source), 0);
}

// ── BT29-030: use 1 card from under this card in a combo ───────────────────
// Its own moment: it attacks. Only a card under it that can be used in a
// combo now is offered (5-7-2: a Battle Card with a combo cost and combo
// power; no combo prohibition); payment places it in the Combo Area with its
// skills negated (3-1-4-3) before the skill returns an opponent's card.
/** The price Auto's own activation, apart from [Triple Attack]'s. */
const fired = (ev: GameEvent[], id: string) => ev.filter((e) => e.type === "skill" && e.card === id && e.skill === priced("SQUADRON549")).length;
const firedAt = (ev: GameEvent[], id: string) => ev.findIndex((e) => e.type === "skill" && e.card === id && e.skill === priced("SQUADRON549"));
/** p1's second turn, in its Main Phase: the first player's first turn has no attack. */
function laterTurn(): VmState {
  let s = main();
  s = apply(s, { type: "endMain", player: "p1" }).state;
  for (let i = 0; i < 40 && !(s.prompt.kind === "main" && s.turnPlayer === "p1"); i++) {
    const p = (s.prompt as { player: PlayerId }).player;
    s = apply(s, s.prompt.kind === "main" ? { type: "endMain", player: p } : s.prompt.kind === "charge" ? { type: "charge", player: p, card: null } : { type: "pass", player: p }).state;
  }
  assert.equal(s.prompt.kind, "main"); assert.equal(s.turnPlayer, "p1");
  return s;
}
function squadron(under: string[] = ["DORE549", "SALZA549", "NOCOMBO549"], setup?: (s: VmState, source: string, pile: string[]) => void) {
  const s = laterTurn();
  const source = stage(s, "SQUADRON549", "battle");
  const pile = under.map((id) => stage(s, id, "drop", "p1", source));
  const target = stage(s, "V-BLUE", "battle", "p2");
  setup?.(s, source, pile);
  const attacked = apply(s, { type: "attack", player: "p1", attacker: source, target: s.sides.p2.zones.leader[0] });
  // 9-6-3: the attack pends this price Auto and [Triple Attack] together; the
  // master orders them, and nothing is charged before that decision.
  const queued = attacked.state;
  assert.equal(queued.prompt.kind, "orderPending");
  assert.deepEqual(queued.pending.map((p) => [p.card, p.trigger]), [[source, "attacks"], [source, "attacks"]]);
  assert.equal(skills(attacked.events, source), 0);
  const at = queued.prompt.kind === "orderPending" ? queued.prompt.candidates.findIndex((i) => queued.pending[i].skillIndex === priced("SQUADRON549")) : -1;
  assert.ok(at >= 0);
  const other = queued.pending.find((p) => p.skillIndex !== priced("SQUADRON549"))!;
  const ordered = apply(reload(queued), { type: "orderPending", player: "p1", index: at });
  return { s: ordered.state, events: [...attacked.events, ...ordered.events], source, pile, target, other };
}
{
  const a = squadron();
  assert.ok(a.s.pending.some((p) => p.card === a.source && p.skillIndex === a.other.skillIndex), "the other Auto keeps its source and place");
  assert.deepEqual([...a.s.cards[a.source].under].sort(), [...a.pile].sort());
  assert.equal(a.s.prompt.kind, "chooseMode"); assert.equal(fired(a.events, a.source), 0);
  assert.ok(a.s.prompt.kind === "chooseMode" && /Pay/.test(a.s.prompt.options[0]) && !/nothing/.test(a.s.prompt.options[0]));
  projections(a.s);
  const offer = JSON.stringify(a.s);
  assert.throws(() => answer(a.s, 0, "p2"), IllegalAction); assert.equal(JSON.stringify(a.s), offer);
  const declined = answer(a.s, declineIndex(a.s));
  assert.deepEqual([...declined.state.cards[a.source].under].sort(), [...a.pile].sort(), "declining moves nothing");
  assert.equal(declined.state.sides.p1.zones.combo.length, 0); assert.equal(fired(declined.events, a.source), 0);
  assert.ok(declined.state.sides.p2.zones.battle.includes(a.target));
  const opened = answer(a.s, 0);
  assert.equal(opened.state.prompt.kind, "chooseCards");
  const [dore, salza, extra] = a.pile;
  assert.deepEqual(candidates(opened.state), [dore, salza].sort(), "an Extra Card cannot be used in a combo (5-7-2)");
  projections(opened.state);
  const saved = JSON.stringify(opened.state);
  assert.throws(() => choose(opened.state, [dore], "p2"), IllegalAction);
  assert.throws(() => choose(opened.state, [extra]), IllegalAction);
  assert.throws(() => choose(opened.state, []), IllegalAction);
  assert.equal(JSON.stringify(opened.state), saved);
  const stale = reload(opened.state); assert.ok(moveCard(stale, dbs, dore, "drop", { owner: "p1" }).ok);
  const staleBefore = JSON.stringify(stale);
  assert.throws(() => choose(stale, [dore]), IllegalAction, "a card no longer under the source cannot pay");
  assert.equal(JSON.stringify(stale), staleBefore);
  const paid = choose(reload(opened.state), [dore]); const again = choose(JSON.parse(saved) as VmState, [dore]);
  assert.equal(JSON.stringify(again.state), JSON.stringify(paid.state), "reload mid-price resolves identically");
  assert.deepEqual(paid.state.sides.p1.zones.combo, [dore], "5-8-2-2-1-1: the card reached the Combo Area");
  assert.deepEqual([...paid.state.cards[a.source].under].sort(), [salza, extra].sort());
  assert.ok(paid.state.effects.some((e) => e.kind === "negateSkills" && e.target === dore), "its skills are negated");
  const moved = paid.events.findIndex((e) => e.type === "move" && e.card === dore && e.to === "combo");
  assert.ok(moved >= 0 && moved < firedAt(paid.events, a.source), "the combo, then the skill");
  assert.equal(paid.events.filter((e) => e.type === "move" && e.to === "combo").length, 1, "charged once");
  assert.equal(fired(paid.events, a.source), 1);
  // The effect: choose up to 1 of the opponent's Battle Cards, return it.
  assert.equal(paid.state.prompt.kind, "chooseCards");
  const bounced = choose(paid.state, [a.target]);
  assert.ok(bounced.state.sides.p2.zones.hand.includes(a.target));
  assert.ok(JSON.stringify(snapshot(paid.state, "p2").view.them).includes(dore), "the combo card is public");
}
// Nothing under it can combo, or nothing at all, or combos are prohibited:
// unaffordable, nothing moves, no skill.
for (const [label, under, setup] of [
  ["only an Extra", ["NOCOMBO549"], undefined],
  ["empty pile", [], undefined],
  ["combo prohibited", ["DORE549"], (s: VmState, source: string) => {
    s.effects.push({ id: 5490, target: "", kind: "forbid", value: 0, forbid: { what: "combo", player: "p1" }, until: "turn", source, createdTurn: s.turn, ownerTurn: "p1", master: "p2" });
  }],
] as const) {
  const a = squadron([...under], setup);
  assert.notEqual(a.s.prompt.kind, "chooseMode", label);
  assert.equal(a.s.sides.p1.zones.combo.length, 0, label); assert.deepEqual(a.s.cards[a.source].under.length, under.length, label);
  assert.equal(fired(a.events, a.source), 0, label);
  assert.ok(a.events.some((e) => e.type === "note" && /unaffordable/.test(e.text)), label);
}
// A lone eligible card is the whole choice: paying uses it at once. A
// standing "leave" replacement on it does not answer: replacements are found
// for departures from play (`replace.ts` `leaveRoute`), and an arrival in the
// Combo Area is not one, so the strict host's arrival check (5-8-2-2-1-1)
// still sees the card in the Combo Area.
{
  const a = squadron(["DORE549", "NOCOMBO549"], (s, source, [dore]) => {
    addEffect(s, [], { master: "p1", source: dore, target: dore, kind: "replaceLeave", value: { to: "hand" }, until: "turn" });
  });
  const [dore] = a.pile;
  assert.equal(a.s.prompt.kind, "chooseMode");
  const paid = answer(a.s, 0);
  assert.deepEqual(paid.state.sides.p1.zones.combo, [dore]); assert.equal(fired(paid.events, a.source), 1);
  assert.ok(paid.events.findIndex((e) => e.type === "move" && e.card === dore && e.to === "combo") < firedAt(paid.events, a.source));
}
// The battle is over before the answer (a stale saved choice): no combo can
// be made (5-7-1), so the answer is refused without mutation.
{
  const a = squadron();
  const opened = answer(a.s, 0);
  const stale = reload(opened.state); stale.battle = null;
  const before = JSON.stringify(stale);
  assert.throws(() => choose(stale, [a.pile[0]]), IllegalAction);
  assert.equal(JSON.stringify(stale), before);
}

// ── DB2-011: this card gets -15000 power for the turn ──────────────────────
// Its own moment: an opponent's card attacks. Paying puts the power loss in
// force on the source (2-7-2 lets power go below zero, so it is always
// performable on a card in the Battle Area) before the attack is negated.
function ganos(setup?: (s: VmState, source: string) => void) {
  let s = main();
  const source = stage(s, "GANOS549", "battle");
  setup?.(s, source);
  s = apply(s, { type: "endMain", player: "p1" }).state;
  s = apply(s, { type: "charge", player: "p2", card: null }).state;
  const attacker = s.sides.p2.zones.leader[0];
  const before = JSON.stringify(s.sides);
  const attacked = apply(s, { type: "attack", player: "p2", attacker, target: s.sides.p1.zones.leader[0] });
  return { s: attacked.state, events: attacked.events, source, attacker, before };
}
const power = (s: VmState, id: string) => s.effects.filter((e) => e.kind === "power" && e.target === id);
{
  const a = ganos();
  assert.equal(a.s.prompt.kind, "chooseMode"); assert.ok(a.s.prompt.kind === "chooseMode" && a.s.prompt.player === "p1", "the Auto's master decides, on the opponent's turn");
  assert.ok(a.s.prompt.kind === "chooseMode" && /Pay/.test(a.s.prompt.options[0]) && /power/.test(a.s.prompt.options[0]), "the price names itself");
  assert.equal(skills(a.events, a.source), 0); assert.equal(power(a.s, a.source).length, 0);
  projections(a.s);
  const offer = JSON.stringify(a.s);
  assert.throws(() => answer(a.s, 0, "p2"), IllegalAction, "the turn player cannot answer for the Auto's master");
  assert.throws(() => answer(a.s, 7), IllegalAction);
  assert.equal(JSON.stringify(a.s), offer);
  const declined = answer(a.s, declineIndex(a.s));
  assert.equal(power(declined.state, a.source).length, 0); assert.equal(skills(declined.events, a.source), 0);
  assert.ok(!declined.state.battle?.negated, "declining leaves the attack standing");
  const paid = answer(reload(a.s), 0); const again = answer(JSON.parse(offer) as VmState, 0);
  assert.equal(JSON.stringify(again.state), JSON.stringify(paid.state), "a reloaded offer pays identically");
  assert.deepEqual(power(paid.state, a.source).map((e) => [e.value, e.until, e.master]), [[-15000, "turn", "p1"]], "charged once, on the source, for the turn");
  const effect = paid.events.findIndex((e) => e.type === "effect" && e.effect.kind === "power" && e.effect.target === a.source);
  assert.ok(effect >= 0 && effect < skillAt(paid.events, a.source), "the power loss, then the skill");
  assert.equal(skills(paid.events, a.source), 1);
  assert.equal(paid.state.battle, null, "the attack is negated and its battle is over");
  assert.ok(paid.state.prompt.kind === "main" && paid.state.prompt.player === "p2", "the attacking player is back in their Main Phase");
  assert.equal(declined.state.battle?.attacker, a.attacker); assert.equal(declined.state.prompt.kind, "combo", "a declined price lets the battle go on");
  assert.throws(() => answer(paid.state, 0), IllegalAction, "a paid price cannot be answered again");
  for (const viewer of ["p1", "p2"] as const) assert.ok(!JSON.stringify(snapshot(paid.state, viewer)).includes("autoCost"));
}
// The source has left the Battle Area before its checkpoint: the power loss
// would change nothing the game reads, so it is no payment (unaffordable).
{
  const s = main();
  const source = stage(s, "GANOS549", "drop");
  const before = JSON.stringify(s.sides);
  s.pending.push({ card: source, master: "p1", skillIndex: priced("GANOS549"), trigger: "opponentAttacks" });
  const ev: GameEvent[] = []; run(ctx, dbs, s, ev);
  unaffordable(s, before, ev, source);
  assert.equal(power(s, source).length, 0);
}

console.log("last-prints-price-549: BT12-023, BT29-030 and DB2-011 prices offer, pay, decline, refuse and reload on the strict host");
