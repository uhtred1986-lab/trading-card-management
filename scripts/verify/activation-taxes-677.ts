/**
 * #677 on the five printed cards of the owner's catalog query (13 Oct 2026):
 * 20-14's "can't activate … unless …" — a price on activating a skill —
 * compiled from the printed text and played on the rules engine for every
 * kind of activation it governs.
 *
 *   EX06-35 [Permanent] "Your opponent can't activate skills unless they
 *           choose 1 card in their hand and send it to their Warp."
 *   DB1-015 [Auto] "…for the duration of the turn, … your opponent can't
 *           activate [Counter] skills unless they place 2 cards from their
 *           hand in their Drop Area as an additional cost."
 *   BT29-022 [Activate: Main] "Draw 1 card, and your opponent can't activate
 *           [Counter: Attack] skills for the turn unless they discard 2 cards
 *           from their hand."
 *   BT23-140 [Permanent] "Your opponent can't activate the skills of Battle
 *           Cards in any Area unless they switch 2 of their Active Mode cards
 *           to Rest Mode as an additional skill cost."
 *   BT10-097 [Permanent] "If your Leader Card is yellow, your opponent can't
 *           activate Extra Cards unless they switch 1 of their energy to Rest
 *           Mode."
 *
 * The readings, from the Rule Manual (no official Q&A on these cards is in
 * the repo):
 *
 *   * 20-14-1: action A (the activation) can only be taken after action B
 *     (the price); if B is not taken, A can't be taken. An activation whose
 *     prices can't be paid whole is not offered and is refused with nothing
 *     paid (9-2-3, 5-8-3).
 *   * The price is the activation's additional cost — BT23-140 and DB1-015
 *     call it that — so it is paid after the printed cost (22-30-3's "then,
 *     if there is an additional skill cost, determine that cost and pay it"),
 *     before the skill activates.
 *   * An [Auto] is activated (9-6-3, 9-6-5), so "can't activate skills"
 *     governs it. Its cost is paid in its entirety or not at all at the
 *     master's choice (9-6-4); nothing in 20-14-1 compels B, so the master
 *     may decline and the [Auto] is not activated — FLAGGED: the literal
 *     reading; the manual does not say a 20-14 price is a "skill cost".
 *   * 12-1-3: "activating an Extra Card" is an [Activate] or [Counter] skill
 *     of an Extra used from the hand — not an Extra's [Auto] (BT10-097).
 *   * Each price is charged once, re-read live after each one is paid: a rule
 *     whose source has left by then is not charged, one newly in force is,
 *     and one that can no longer be paid fails the activation (5-8-4) with
 *     what was paid left paid — FLAGGED: 20-14-1 does not say when the set
 *     of prices is fixed; "re-checked live" is the issue's acceptance.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { describeScript, validateProgram, type Op } from "../../src/lib/arena/vm/script";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { activationTaxes } from "../../src/lib/arena/vm/activate";
import type { PinnedMatch } from "../../src/lib/arena/browser";
import { localStep, policyTurn } from "../../src/lib/arena/policy/boundary";
import { choiceDecision } from "../../src/lib/arena/policy/choices";
import { localPolicy } from "../../src/lib/arena/policy/combat";
import { localMemory } from "../../src/lib/arena/policy/main";
import { policyRng } from "../../src/lib/arena/policy/rng";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";

const engine = RULES;
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

// ── the five printed cards, as the catalog prints them ─────────────────────
const PRINTED = {
  "EX06-35": "[triple attack]<br>[over realm 8] {4}<br>[permanent] Your opponent can't activate skills unless they choose 1 card in their hand and send it to their Warp.",
  "DB1-015": "[Barrier]<br>[Permanent] Only 1 {Jiren, Shackles of the Past} can be played in your Battle Area. <br>[Auto] When there are 10 or more Battle Cards in your Drop Area with 10000 power: At the start of your Main Phase, for the duration of the turn, this card gets +25000 power, [Double Strike], and [Dual Attack], and your opponent can't activate [Counter] skills unless they place 2 cards from their hand in their Drop Area as an additional cost.",
  "BT29-022": "[permanent] This card gains <Broly> in all areas.\n[activate: main][limit 1]{r}, if your Leader is a mono-red <Broly> card and you have a red <Broly> card in play: Draw 1 card, and your opponent can't activate [counter: attack] skills for the turn unless they discard 2 cards from their hand.\n[activate: battle][limit 1] Choose up to 1 of your red <Broly> Battle Cards and it gets +10000 power for the turn.",
  "BT23-140": "[ultimate][victory strike]<br>[permanent] This card isn't affected by the skills of opponent's cards other than Battle Cards.<br>[permanent] Your opponent can't activate the skills of Battle Cards in any Area unless they switch 2 of their Active Mode cards to Rest Mode as an additional skill cost.<br>[activate: main]{y}{y}{y}{y}, if your Leader is yellow, you have 5 or more energy, and you have 10 or more cards in your Z-Energy: Play this card from your hand.",
  "BT10-097": "[Deflect][Barrier][Unique]<br>[Permanent] If your Leader Card is yellow, your opponent can't activate Extra Cards unless they switch 1 of their energy to Rest Mode.",
} as const;

const extra = (id: string, skill: string, energyCost = 1, colors: CardDef["colors"] = ["Red"]): CardDef => card(id, { type: "EXTRA", colors, energyCost, power: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = {
  ...DEFS,
  "EX06-35": card("EX06-35", { name: "Fu, the Dark Banisher", colors: ["Black"], energyCost: 8, power: 25000, comboCost: 1, comboPower: 10000, characters: ["Fu"], traits: ["Scientist"], skill: PRINTED["EX06-35"] }),
  "DB1-015": card("DB1-015", { name: "Jiren, Shackles of the Past", colors: ["Red"], energyCost: 1, power: 5000, comboCost: 0, comboPower: 5000, characters: ["Jiren"], skill: PRINTED["DB1-015"] }),
  "BT29-022": extra("BT29-022", PRINTED["BT29-022"]),
  "BT23-140": card("BT23-140", { name: "Ultra Instinct Son Goku, State of the Gods", colors: ["Yellow"], energyCost: 8, power: 45000, comboCost: 1, comboPower: 10000, characters: ["Son Goku"], traits: ["Saiyan", "Universe 7"], skill: PRINTED["BT23-140"] }),
  "BT10-097": card("BT10-097", { name: "Son Goku, Absolute Annihilation", colors: ["Yellow"], energyCost: 3, power: 20000, comboCost: 0, comboPower: 5000, characters: ["Son Goku"], traits: ["Saiyan"], skill: PRINTED["BT10-097"] }),
  // The activations they tax, and the cards that pay.
  X677: extra("X677", "[Activate: Main] Draw 1 card."),
  B677: card("B677", { energyCost: 1, skill: "[Activate: Main] Draw 1 card." }),
  A677: card("A677", { energyCost: 0, skill: "[Auto] When you play this card, draw 1 card." }),
  N677: extra("N677", "[Counter: Attack] Negate the attack.", 0),
  F677: card("F677", { energyCost: 9 }),
  "L677-BROLY": card("L677-BROLY", { type: "LEADER", colors: ["Red"], energyCost: null, comboCost: null, comboPower: null, characters: ["Broly"] }),
  "L677-YELLOW": card("L677-YELLOW", { type: "LEADER", colors: ["Yellow"], energyCost: null, comboCost: null, comboPower: null }),
};
const ctx: EngineContext = { ...CTX, defs, scripts: rulesFromCompiler(defs) };

// ── helpers ───────────────────────────────────────────────────────────────
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, action: Action) => engine.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] };
const legal = (s: VmState) => engine.legalActions(ctx, s);
function stage(s: VmState, p: PlayerId, id: string, area: "battle" | "energy" | "hand" | "drop"): string {
  const physical = s.sides[p].zones.deck[0];
  assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  s.pending = [];
  return physical;
}
/** p2's Main Phase (p1 went first), both hands and energy emptied. */
function board(seed: number, leaders: { p1?: string; p2?: string } = {}): VmState {
  let s = engine.createGame(ctx, { seed, p1: { name: "One", leader: leaders.p1 ?? "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: leaders.p2 ?? "L-RED", main: fifty("V1") } }).state as VmState;
  const step = (a: Action) => { s = apply(s, a).state; };
  step({ type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) step({ type: "pass", player: (s.prompt as { player: PlayerId }).player });
  step({ type: "endMain", player: "p1" });
  step({ type: "charge", player: "p2", card: null });
  assert.equal(s.prompt.kind, "main");
  assert.equal(s.turnPlayer, "p2");
  for (const p of ["p1", "p2"] as const) for (const id of [...s.sides[p].zones.hand, ...s.sides[p].zones.energy]) assert.ok(moveCard(s, game, id, "deck", { owner: p }).ok);
  // No energy markers: every price here is paid in energy cards, so no payment question is asked.
  for (const p of ["p1", "p2"] as const) s.sides[p].attrs.energyMarkers = 0;
  return s;
}
const ids = (s: VmState, p: PlayerId, area: string, cardId: string) => (s.sides[p].zones[area] ?? []).filter((id) => s.cards[id].cardId === cardId);
const draws = (ev: GameEvent[], p: PlayerId) => ev.filter((e) => e.type === "draw" && e.player === p).length;
const skills = (ev: GameEvent[], id: string) => ev.filter((e) => e.type === "skill" && e.card === id).length;
const at = (ev: GameEvent[], ok: (e: GameEvent) => boolean) => ev.findIndex(ok);
const movedTo = (ev: GameEvent[], id: string, to: string) => at(ev, (e) => e.type === "move" && e.card === id && e.to === to);
const firstDraw = (ev: GameEvent[], p: PlayerId) => at(ev, (e) => e.type === "draw" && e.player === p);
const restedEnergy = (s: VmState, p: PlayerId) => s.sides[p].zones.energy.filter((id) => s.cards[id].mode === "rest").length;
const activate = (s: VmState, p: PlayerId, id: string, kind = "activate:main"): Action => {
  const sk = parseSkills(defs[s.cards[id].cardId].skill!).find((k) => k.kind === kind)!;
  return { type: "activate", player: p, card: id, skill: sk.index };
};
const offered = (s: VmState, action: Action) => legal(s).find((row) => JSON.stringify(row.action) === JSON.stringify(action));
/** Take an action, then answer each card question with the next of `picks`, collecting the events. */
function play(s: VmState, action: Action, ...picks: string[][]): { state: VmState; events: GameEvent[] } {
  let step = apply(s, action);
  let events = step.events;
  for (const cards of picks) {
    // An exact choice with no more candidates than it takes is not a
    // question: the engine takes them all.
    if (step.state.prompt.kind !== "chooseCards") break;
    step = apply(step.state, { type: "choose", player: (step.state.prompt as { player: PlayerId }).player, cards });
    events = [...events, ...step.events];
  }
  return { state: step.state, events };
}
const snapshot = (s: VmState, viewer: PlayerId) => JSON.stringify(buildSnapshot({ id: 677, revision: 1, mode: "versus", status: "playing",
  p1Name: "One", p2Name: "Two", ctx, state: s, legal: [], log: [], beats: null, spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));
/** The payer's hand picks are theirs alone: the other seat never sees the candidates' card ids. */
function privateToPayer(s: VmState, payer: PlayerId, cardId: string): void {
  assert.equal(s.prompt.kind, "chooseCards");
  const other: PlayerId = payer === "p1" ? "p2" : "p1";
  assert.ok(snapshot(s, payer).includes(cardId), `${payer} sees the cards they can pay with`);
  assert.ok(!snapshot(s, other).includes(cardId), `${other} does not learn ${payer}'s hand from the price`);
}
const refusedUnchanged = (s: VmState, action: Action) => {
  const before = JSON.stringify(s);
  assert.throws(() => engine.apply(ctx, s, action), IllegalAction);
  assert.equal(JSON.stringify(s), before, "a refused activation changes nothing");
};
const priceRefusal = (s: VmState, action: Action) => {
  const why = engine.rejectedActions(ctx, s, legal(s)).find((row) => JSON.stringify(row.action) === JSON.stringify(action))?.why[0];
  assert.equal(why?.kind, "forbidden", `refused by the price (${JSON.stringify(why)})`);
  assert.match(why && "unless" in why ? String(why.unless) : "", /you pay, each time/);
};
const attack = (s: VmState) => apply(s, { type: "attack", player: "p2", attacker: s.sides.p2.zones.leader[0], target: s.sides.p1.zones.leader[0] });
/** p2 attacks p1's Leader; p1's counter window, after any block question. */
function toCounterWindow(s: VmState): VmState {
  let a = attack(s).state;
  if (a.prompt.kind === "blocker") a = apply(a, { type: "block", player: "p1", card: null }).state;
  return a;
}

// ── 1. each printed line compiles, and validates ───────────────────────────
const forbidOf = (text: string): Extract<Op, { op: "forbid" }> => {
  const found: Extract<Op, { op: "forbid" }>[] = [];
  for (const sk of parseSkills(text)) {
    const read = compileSkill(sk);
    assert.deepEqual(read.unsupported, [], `every line of ${text.slice(0, 40)} is read`);
    assert.equal(validateProgram(read.ops), true);
    const walk = (ops: Op[]): void => ops.forEach((o) => (o.op === "forbid" && o.unlessPay ? found.push(o) : o.op === "if" ? (walk(o.then), walk(o.else ?? [])) : undefined));
    walk(read.ops);
  }
  assert.equal(found.length, 1, "one priced prohibition");
  return found[0];
};
const shape = (f: Extract<Op, { op: "forbid" }>) => ({ what: f.what, side: f.side, type: f.filter?.type ?? null, counterKind: f.counterKind ?? null, extra: !!f.extraCardActivation, price: f.unlessPay!.map((o) => o.op) });
{
  const ex = forbidOf(PRINTED["EX06-35"]);
  assert.deepEqual(shape(ex), { what: "activateSkill", side: "opponent", type: null, counterKind: null, extra: false, price: ["choose", "moveTo"] });
  const pick = ex.unlessPay![0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual([pick.sel.area, pick.sel.count, pick.sel.notSelf], ["hand", 1, "card"], "one card of the payer's hand, never the activating card");
  assert.equal((ex.unlessPay![1] as Extract<Op, { op: "moveTo" }>).to, "warp");

  const db = forbidOf(PRINTED["DB1-015"]);
  assert.deepEqual(shape(db), { what: "activateCounter", side: "opponent", type: null, counterKind: null, extra: false, price: ["choose", "moveTo"] });
  assert.equal(db.until, "turn", "for the duration of the turn");
  assert.deepEqual([(db.unlessPay![0] as Extract<Op, { op: "choose" }>).sel.count, (db.unlessPay![1] as Extract<Op, { op: "moveTo" }>).to], [2, "drop"]);

  const bt29 = forbidOf(PRINTED["BT29-022"]);
  assert.deepEqual(shape(bt29), { what: "activateCounter", side: "opponent", type: null, counterKind: "attack", extra: false, price: ["choose", "moveTo"] });
  assert.equal(bt29.until, "turn");

  const bt23 = forbidOf(PRINTED["BT23-140"]);
  assert.deepEqual(shape(bt23), { what: "activateSkill", side: "opponent", type: "BATTLE", counterKind: null, extra: false, price: ["choose", "switchMode"] });
  const rest2 = bt23.unlessPay![0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual([rest2.sel.count, rest2.sel.mode, rest2.sel.notSelf], [2, "active", undefined], "any 2 of the payer's Active Mode cards — the activating one included");

  const bt10 = forbidOf(PRINTED["BT10-097"]);
  assert.deepEqual(shape(bt10), { what: "activateSkill", side: "opponent", type: "EXTRA", counterKind: null, extra: true, price: ["choose", "switchMode"] });
  const rest1 = bt10.unlessPay![0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual([rest1.sel.area, rest1.sel.count, rest1.sel.mode], ["energy", 1, "active"], "5-8-2-2: only an Active Mode energy pays a switch to Rest Mode");
  // Said back the way it is printed (the rule page and the referee read this).
  for (const [f, words] of [
    [ex, /^your opponent can't activate skills unless, each time, the player doing it first pays: /],
    [db, /^your opponent can't activate \[Counter\] skills unless/],
    [bt29, /^your opponent can't activate \[Counter: Attack\] skills unless/],
    [bt23, /^your opponent can't activate the skills of .*Battle Card.* unless/i],
    [bt10, /^your opponent can't activate Extra Cards unless/],
  ] as const) assert.match(describeScript([f]), words);
}

// ── 2. EX06-35 on an [Activate]: paid once, at the boundary, privately ─────
{
  const s = board(6771);
  stage(s, "p1", "EX06-35", "battle");
  const x = stage(s, "p2", "X677", "hand");
  const [f1, f2] = [stage(s, "p2", "F677", "hand"), stage(s, "p2", "F677", "hand")];
  stage(s, "p2", "V1", "energy");
  const take = activate(s, "p2", x);
  assert.match(offered(s, take)?.label ?? "", / — first pay: /, "the button names the price");
  const asked = apply(s, take);
  assert.equal(asked.state.prompt.kind, "chooseCards");
  assert.deepEqual([...(asked.state.prompt.kind === "chooseCards" ? asked.state.prompt.choice.candidates : [])].sort(), [f1, f2].sort(), "never the activating Extra");
  assert.equal(draws(asked.events, "p2"), 0, "the skill waits for its price");
  privateToPayer(asked.state, "p2", "F677");
  // Reload mid-payment: the stored game answers exactly as the live one.
  const live = apply(asked.state, { type: "choose", player: "p2", cards: [f2] });
  const saved = apply(reload(asked.state), { type: "choose", player: "p2", cards: [f2] });
  assert.equal(JSON.stringify(saved.state), JSON.stringify(live.state));
  const ev = [...asked.events, ...live.events];
  assert.deepEqual(ids(live.state, "p2", "warp", "F677"), [f2], "charged once");
  assert.deepEqual(ids(live.state, "p2", "hand", "F677"), [f1]);
  assert.equal(draws(ev, "p2"), 1);
  assert.ok(movedTo(ev, f2, "warp") >= 0 && movedTo(ev, f2, "warp") < firstDraw(ev, "p2"), "the price is paid before the effect");
  assert.equal(skills(ev, x), 1);
  // Unpayable — no other hand card: not offered, refused naming the price, nothing changed.
  const poor = board(6772);
  stage(poor, "p1", "EX06-35", "battle");
  const lone = stage(poor, "p2", "X677", "hand");
  stage(poor, "p2", "V1", "energy");
  assert.ok(!offered(poor, activate(poor, "p2", lone)));
  priceRefusal(poor, activate(poor, "p2", lone));
  refusedUnchanged(poor, activate(poor, "p2", lone));
}

// ── 3. EX06-35 on an [Auto]: part of its cost, paid or declined (9-6-4) ────
{
  const setup = (seed: number, fodder: number) => {
    const s = board(seed);
    stage(s, "p1", "EX06-35", "battle");
    const auto = stage(s, "p2", "A677", "hand");
    const fs = Array.from({ length: fodder }, () => stage(s, "p2", "F677", "hand"));
    return { s, auto, fs };
  };
  // Payable: the master is asked once for the whole cost, and the local policy answers.
  {
    const { s, auto, fs } = setup(6773, 2);
    const played = apply(s, { type: "play", player: "p2", card: auto });
    assert.equal(played.state.prompt.kind, "chooseMode", "9-6-4: pay the cost or not");
    const options = played.state.prompt.kind === "chooseMode" ? played.state.prompt.options : [];
    assert.equal(options.length, 2);
    assert.match(options[0], /^Pay: choose 1 card in your hand other than this card, move the chosen cards to warp$/, "the option names the rule's price");
    assert.equal(options[1], "Don't pay");
    assert.equal(draws(played.events, "p2"), 0);
    assert.equal(skills(played.events, auto), 0, "not activated until paid");
    const match: PinnedMatch = { ctx: { ...ctx, rulesetDefinition: game }, state: played.state, beats: null, art: {}, names: { p1: "One", p2: "Two" } };
    const turn = policyTurn(match, "p2", 1);
    assert.equal(turn.input.decisions.window, "chooseMode");
    assert.ok(choiceDecision(turn.input), "the local choices policy answers the price question");
    const step = localStep(match, "p2", 1, localMemory(policyRng(677)), localPolicy());
    assert.ok(step.ok, `the local policy's answer plays (${JSON.stringify(step).slice(0, 200)})`);
    // Pay: the hand question is the payer's alone, then the skill activates and draws.
    const paying = apply(played.state, { type: "chooseMode", player: "p2", index: 0 });
    assert.equal(paying.state.prompt.kind, "chooseCards");
    privateToPayer(paying.state, "p2", "F677");
    const paid = apply(reload(paying.state), { type: "choose", player: "p2", cards: [fs[0]] });
    const ev = [...paying.events, ...paid.events];
    assert.deepEqual(ids(paid.state, "p2", "warp", "F677"), [fs[0]], "charged once");
    assert.equal(draws(ev, "p2"), 1);
    assert.equal(skills(ev, auto), 1);
    assert.ok(movedTo(ev, fs[0], "warp") < at(ev, (e) => e.type === "skill" && e.card === auto), "paid before the skill is activated");
    // Declined: not activated, nothing charged.
    const declined = apply(played.state, { type: "chooseMode", player: "p2", index: 1 });
    assert.equal(draws(declined.events, "p2"), 0);
    assert.equal(skills(declined.events, auto), 0);
    assert.equal(ids(declined.state, "p2", "hand", "F677").length, 2, "a declined price charges nothing");
  }
  // Unpayable: the hand is empty once it is played, so the [Auto] can't be activated (9-6-3-2).
  {
    const { s, auto } = setup(6774, 0);
    const played = apply(s, { type: "play", player: "p2", card: auto });
    assert.notEqual(played.state.prompt.kind, "chooseMode");
    assert.equal(draws(played.events, "p2"), 0);
    assert.equal(skills(played.events, auto), 0);
    assert.ok(played.events.some((e) => e.type === "note" && /can't be activated/.test(e.text)), "the cancellation is said");
  }
}

// ── 4. EX06-35 on a [Counter]: after its printed price, before it activates ─
{
  const s = board(6775);
  stage(s, "p2", "EX06-35", "battle");
  const neg = stage(s, "p1", "N677", "hand");
  const [f1, f2] = [stage(s, "p1", "F677", "hand"), stage(s, "p1", "F677", "hand")];
  const w = toCounterWindow(s);
  assert.equal(w.prompt.kind, "counter");
  assert.ok(w.prompt.kind === "counter" && w.prompt.candidates.includes(neg), "offered: the price can be paid");
  const asked = apply(w, { type: "counter", player: "p1", card: neg });
  assert.equal(asked.state.prompt.kind, "chooseCards");
  assert.deepEqual([...(asked.state.prompt.kind === "chooseCards" ? asked.state.prompt.choice.candidates : [])].sort(), [f1, f2].sort(), "never the [Counter] itself");
  assert.deepEqual(ids(asked.state, "p1", "hand", "N677"), [neg], "still in the hand while its price is paid");
  privateToPayer(asked.state, "p1", "F677");
  const paid = apply(reload(asked.state), { type: "choose", player: "p1", cards: [f1] });
  const ev = [...asked.events, ...paid.events];
  assert.deepEqual(ids(paid.state, "p1", "warp", "F677"), [f1]);
  assert.ok(movedTo(ev, f1, "warp") < movedTo(ev, neg, "drop"), "price, then the [Counter] to the Drop (22-10-7)");
  assert.ok(movedTo(ev, neg, "drop") < at(ev, (e) => e.type === "skill" && e.card === neg));
  assert.equal(skills(ev, neg), 1);
  assert.ok(ev.some((e) => e.type === "attackNegated"), "and it resolves");
  // Unpayable: the [Counter] alone in the hand is not offered.
  const poor = board(6776);
  stage(poor, "p2", "EX06-35", "battle");
  const lone = stage(poor, "p1", "N677", "hand");
  const pw = toCounterWindow(poor);
  assert.ok(pw.prompt.kind !== "counter" || !pw.prompt.candidates.includes(lone), "an unpayable [Counter] is not offered");
}

// ── 5. DB1-015's effect: [Counter] skills, for the turn ─────────────────────
{
  const db = forbidOf(PRINTED["DB1-015"]);
  const s = board(6777);
  const jiren = stage(s, "p2", "DB1-015", "battle");
  // What the resolved [Auto]'s `forbid` adds (vm/script.ts's `forbid` case).
  s.effects.push({ id: 67701, target: "", kind: "forbid", value: 0, until: "turn", source: jiren, master: "p2", createdTurn: s.turn, ownerTurn: "p2",
    forbid: { what: "activateCounter", pay: db.unlessPay, player: "p1" } } as VmState["effects"][number]);
  const neg = stage(s, "p1", "N677", "hand");
  const [f1, f2] = [stage(s, "p1", "F677", "hand"), stage(s, "p1", "F677", "hand")];
  assert.deepEqual(activationTaxes(ctx, game, s, "p1", neg, "activate:main"), [], "an [Activate] is not a [Counter]");
  const w = toCounterWindow(s);
  assert.ok(w.prompt.kind === "counter" && w.prompt.candidates.includes(neg));
  const paid = play(w, { type: "counter", player: "p1", card: neg }, [f1, f2]);
  assert.deepEqual(ids(paid.state, "p1", "drop", "F677").sort(), [f1, f2].sort(), "2 cards from the hand in the Drop");
  assert.equal(skills(paid.events, neg), 1);
  // One card short: not offered.
  const poor = board(6778);
  const j2 = stage(poor, "p2", "DB1-015", "battle");
  poor.effects.push({ id: 67702, target: "", kind: "forbid", value: 0, until: "turn", source: j2, master: "p2", createdTurn: poor.turn, ownerTurn: "p2",
    forbid: { what: "activateCounter", pay: db.unlessPay, player: "p1" } } as VmState["effects"][number]);
  const lone = stage(poor, "p1", "N677", "hand");
  stage(poor, "p1", "F677", "hand");
  const pw = toCounterWindow(poor);
  assert.ok(pw.prompt.kind !== "counter" || !pw.prompt.candidates.includes(lone));
}

// ── 6. BT29-022, activated: [Counter: Attack] only, for the turn ────────────
{
  const s = board(6779, { p2: "L677-BROLY" });
  const bt29 = stage(s, "p2", "BT29-022", "hand");
  for (let i = 0; i < 3; i++) stage(s, "p2", "V1", "energy");
  const neg = stage(s, "p1", "N677", "hand");
  const [f1, f2] = [stage(s, "p1", "F677", "hand"), stage(s, "p1", "F677", "hand")];
  const used = apply(s, activate(s, "p2", bt29));
  assert.equal(draws(used.events, "p2"), 1, "Draw 1 card");
  assert.equal(used.state.prompt.kind, "main");
  assert.equal(activationTaxes(ctx, game, used.state, "p1", neg, "counter:attack").length, 1, "a [Counter: Attack] is taxed");
  assert.equal(activationTaxes(ctx, game, used.state, "p1", neg, "counter:play").length, 0, "a [Counter: Play] is not");
  const w = toCounterWindow(used.state);
  assert.ok(w.prompt.kind === "counter" && w.prompt.candidates.includes(neg));
  const paid = play(w, { type: "counter", player: "p1", card: neg }, [f1, f2]);
  assert.deepEqual(ids(paid.state, "p1", "drop", "F677").sort(), [f1, f2].sort(), "discard 2 cards from their hand");
  assert.ok(paid.events.some((e) => e.type === "attackNegated"));
}

// ── 7. BT23-140: the skills of Battle Cards, paid by resting 2 cards ───────
{
  const s = board(6780);
  stage(s, "p1", "BT23-140", "battle");
  const b = stage(s, "p2", "B677", "battle");
  const leader = s.sides.p2.zones.leader[0];
  const taken = activate(s, "p2", b);
  assert.match(offered(s, taken)?.label ?? "", / — first pay: /);
  const done = play(s, taken, [leader, b]);
  assert.equal(done.state.cards[leader].mode, "rest");
  assert.equal(done.state.cards[b].mode, "rest", "the activating Battle Card may be one of them");
  assert.equal(draws(done.events, "p2"), 1);
  // An Extra's skill is not a Battle Card's: untaxed.
  const s2 = board(6781);
  stage(s2, "p1", "BT23-140", "battle");
  const x = stage(s2, "p2", "X677", "hand");
  stage(s2, "p2", "V1", "energy");
  const ex = apply(s2, activate(s2, "p2", x));
  assert.equal(ex.state.prompt.kind, "main");
  assert.equal(ex.state.cards[s2.sides.p2.zones.leader[0]].mode, "active", "nothing rested for the Extra");
  assert.equal(draws(ex.events, "p2"), 1);
  // One Active Mode card short: not offered, refused naming the price.
  const s3 = board(6782);
  stage(s3, "p1", "BT23-140", "battle");
  const b3 = stage(s3, "p2", "B677", "battle");
  s3.cards[s3.sides.p2.zones.leader[0]].mode = "rest";
  assert.ok(!offered(s3, activate(s3, "p2", b3)));
  priceRefusal(s3, activate(s3, "p2", b3));
  refusedUnchanged(s3, activate(s3, "p2", b3));
}

// ── 8. BT10-097: activating Extra Cards, under its Leader condition ────────
{
  const s = board(6783, { p1: "L677-YELLOW" });
  stage(s, "p1", "BT10-097", "battle");
  const x = stage(s, "p2", "X677", "hand");
  const [e1, e2] = [stage(s, "p2", "V1", "energy"), stage(s, "p2", "V1", "energy")];
  const asked = apply(s, activate(s, "p2", x));
  // One Active energy is left after the Extra's own cost: the price takes it
  // — 1 rested for the card, 1 for the price.
  const after = asked.state.prompt.kind === "chooseCards" ? apply(asked.state, { type: "choose", player: "p2", cards: asked.state.prompt.choice.candidates.slice(0, 1) }) : asked;
  assert.equal(restedEnergy(after.state, "p2"), 2);
  assert.ok([e1, e2].every((id) => after.state.cards[id].mode === "rest"));
  assert.equal(draws([...asked.events, ...(after === asked ? [] : after.events)], "p2"), 1);
  assert.equal(after.state.prompt.kind, "main");
  // One energy: the Extra's own cost takes it, so the price can't be paid — not offered.
  const poor = board(6784, { p1: "L677-YELLOW" });
  stage(poor, "p1", "BT10-097", "battle");
  const lone = stage(poor, "p2", "X677", "hand");
  stage(poor, "p2", "V1", "energy");
  assert.ok(!offered(poor, activate(poor, "p2", lone)), "the price is asked of the board the Extra's energy leaves");
  priceRefusal(poor, activate(poor, "p2", lone));
  // The Leader is not yellow: no price.
  const red = board(6785);
  stage(red, "p1", "BT10-097", "battle");
  const rx = stage(red, "p2", "X677", "hand");
  stage(red, "p2", "V1", "energy");
  const free = apply(red, activate(red, "p2", rx));
  assert.equal(free.state.prompt.kind, "main");
  assert.equal(draws(free.events, "p2"), 1);
  // A Battle Card's skill is not "activating an Extra Card" (12-1-3).
  const bt = board(6786, { p1: "L677-YELLOW" });
  stage(bt, "p1", "BT10-097", "battle");
  const b = stage(bt, "p2", "B677", "battle");
  const bdone = apply(bt, activate(bt, "p2", b));
  assert.equal(bdone.state.prompt.kind, "main");
  assert.equal(draws(bdone.events, "p2"), 1);
  // Nor is an Extra's [Auto] (12-1-3: [Activate] or [Counter] only).
  assert.equal(activationTaxes(ctx, game, bt, "p2", b, "auto").length, 0);
}

// ── 9. live after each payment: departed, newly due, unpayable ─────────────
{
  // A Battle Card's skill under both EX06-35 (a hand card) and BT23-140
  // (2 Active Mode cards): two prices, charged one after the other.
  const setup = (seed: number) => {
    const s = board(seed);
    const fu = stage(s, "p1", "EX06-35", "battle");
    const goku = stage(s, "p1", "BT23-140", "battle");
    const b = stage(s, "p2", "B677", "battle");
    const spare = stage(s, "p2", "F677", "battle");
    const fs = [stage(s, "p2", "F677", "hand"), stage(s, "p2", "F677", "hand")];
    const asked = apply(s, activate(s, "p2", b));
    assert.equal(asked.state.prompt.kind, "chooseCards", "the first price's question");
    return { asked, fu, goku, b, spare, fs, leader: s.sides.p2.zones.leader[0] };
  };
  // Both rules stay: each charged once, across a reload between them.
  {
    const { asked, b, fs, leader } = setup(6787);
    const first = apply(asked.state, { type: "choose", player: "p2", cards: [fs[0]] });
    assert.equal(first.state.prompt.kind, "chooseCards", "then the second's");
    const second = play(reload(first.state), { type: "choose", player: "p2", cards: [leader] }, [b]);
    const ev = [...asked.events, ...first.events, ...second.events];
    assert.deepEqual(ids(second.state, "p2", "warp", "F677"), [fs[0]], "EX06-35's, once");
    assert.equal(second.state.cards[leader].mode, "rest");
    assert.equal(draws(ev, "p2"), 1);
    assert.equal(second.state.prompt.kind, "main");
  }
  // BT23-140 leaves while the first price is asked: its price is no longer owed.
  {
    const { asked, goku, fs, leader } = setup(6788);
    const saved = reload(asked.state);
    assert.ok(moveCard(saved, game, goku, "drop", { owner: "p1" }).ok);
    const done = apply(saved, { type: "choose", player: "p2", cards: [fs[0]] });
    assert.equal(done.state.prompt.kind, "main", "nothing more is asked");
    assert.equal(done.state.cards[leader].mode, "active", "the departed rule charges nothing");
    assert.equal(draws(done.events, "p2"), 1);
  }
  // A rule newly in force before its turn comes is charged too.
  {
    const { asked, fs, leader, spare } = setup(6789);
    const saved = reload(asked.state);
    const ex = forbidOf(PRINTED["EX06-35"]);
    const third = stage(saved, "p2", "F677", "hand");
    saved.effects.push({ id: 67703, target: "", kind: "forbid", value: 0, until: "turn", source: saved.sides.p1.zones.leader[0], master: "p1", createdTurn: saved.turn, ownerTurn: "p2",
      forbid: { what: "activateSkill", pay: ex.unlessPay, player: "p2" } } as VmState["effects"][number]);
    const first = apply(saved, { type: "choose", player: "p2", cards: [fs[0]] });
    // The new rule is read before the standing ones (timed effects first).
    assert.equal(first.state.prompt.kind, "chooseCards", "the new rule's price is asked");
    assert.deepEqual([...(first.state.prompt.kind === "chooseCards" ? first.state.prompt.choice.candidates : [])].sort(), [fs[1], third].sort());
    const second = apply(reload(first.state), { type: "choose", player: "p2", cards: [third] });
    assert.equal(second.state.prompt.kind, "chooseCards", "then BT23-140's");
    const done = play(second.state, { type: "choose", player: "p2", cards: [leader] }, [spare]);
    assert.deepEqual(ids(done.state, "p2", "warp", "F677").sort(), [fs[0], third].sort(), "both hand prices charged, each once");
    assert.deepEqual([done.state.cards[leader].mode, done.state.cards[spare].mode], ["rest", "rest"]);
    assert.equal(draws(done.events, "p2"), 1);
    assert.equal(done.state.prompt.kind, "main");
  }
  // The second price can no longer be paid when its turn comes: the activation fails (5-8-4).
  {
    const { asked, fs, leader, spare } = setup(6790);
    const saved = reload(asked.state);
    saved.cards[leader].mode = "rest";
    saved.cards[spare].mode = "rest";
    const done = apply(saved, { type: "choose", player: "p2", cards: [fs[0]] });
    assert.deepEqual(ids(done.state, "p2", "warp", "F677"), [fs[0]], "what was paid stays paid");
    assert.equal(draws(done.events, "p2"), 0, "the skill does not resolve");
    assert.ok(done.events.some((e) => e.type === "note" && /activation failed/.test(e.text)));
    assert.equal(done.state.prompt.kind, "main");
  }
}

console.log("activation-taxes-677: five printed cards compiled; [Activate]/[Auto]/[Counter] taxes paid once, live, refused when unpayable, reloaded, private");
