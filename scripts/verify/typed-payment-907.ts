/** #907: stored payment is authoritative through offers, charges and saved continuations.
 * BT11-013 source: #923 inventory, also frozen in keyword-action-costs-926.ts.
 * Current official cardlist power is 20000 (19 Oct online check); #926 retains
 * its historical 35000 fixture. This source correction changes no payment expectation.
 * Generic resource mutations deliberately leave the printed skill unchanged.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardDefFrom } from "../../src/lib/arena/load";
import { normalizeRows } from "../arena-corpus-provenance.mts";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, saveRule, type RuleRow } from "../../src/lib/arena/rules-store";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { addEffect } from "../../src/lib/arena/vm/effects";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction, GRANTED_LINE_BASE } from "../../src/lib/arena/vm/common";
import type { CostRecord, Op } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

const FUSION = "[deflect]<br>[union-fusion]{r}{r}{r}, draw 2 cards: Red <Son Goku: Br> and red <Vegeta: Br>.<br>[permanent] This card can't be KO'd.<br>[auto] If your Leader Card is red: When this card is played, choose up to 1 of your red Unison Cards, add a marker to it, then choose all of your opponent's Battle Cards and they get -15000 power for the turn.";
const GRANT = "[permanent] Red <Gogeta: Br> cards in your hand gain the following skill: ・[union-fusion]{r}{u}{2}: <Son Goku: Br> and <Vegeta: Br>.";
const defs: Record<string, CardDef> = { ...DEFS,
  "BT11-013": card("BT11-013", { name: "Gogeta, Fusion of the Gods", colors: ["Red"], characters: ["Gogeta: Br"], power: 20000, energyCost: 5, specifiedCost: { Red: 3 }, traits: ["Saiyan"], skill: FUSION }),
  GOKU907: card("GOKU907", { characters: ["Son Goku: Br"] }),
  VEG907: card("VEG907", { characters: ["Vegeta: Br"] }),
  MULTI907: card("MULTI907", { colors: ["Red", "Blue"] }),
  BLUE907: card("BLUE907", { colors: ["Blue"] }),
  RESOURCE907: card("RESOURCE907", { skill: "[Activate: Main] Draw 1 card." }),
  MARKER907: card("MARKER907", { type: "UNISON", skill: "[Activate: Main] Draw 1 card." }),
  UNISON907: card("UNISON907", { type: "UNISON" }),
  GRANT907: card("GRANT907", { type: "LEADER", skill: GRANT }),
  GAIN907: card("GAIN907", { type: "LEADER", skill: "[Permanent] If you have 2 or more cards in your Drop Area, reduce the skill cost of [union] skills on red <Gogeta: Br> cards in your hand by {r}." }),
  LOSE907: card("LOSE907", { type: "LEADER", skill: "[Permanent] If you have 3 or more cards in your hand, reduce the skill cost of [union] skills on red <Gogeta: Br> cards in your hand by {r}." }),
  AUTOGOKU907: card("AUTOGOKU907", { characters: ["Son Goku: Br"], skill: "[Auto] When this card is placed in your Drop Area from your hand by a skill, draw 1 card." }),
  GOG907: card("GOG907", { characters: ["Gogeta: Br"] }),
};
const referencePath = process.argv.includes("--reference-records") ? process.argv[process.argv.indexOf("--reference-records") + 1] : undefined;
const reference = referencePath ? JSON.parse(readFileSync(referencePath, "utf8")) : undefined;
if (reference) defs["BT11-013"] = cardDefFrom(reference.catalog.find((entry: { id: string }) => entry.id === "BT11-013"));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok); const game = loaded.definition;
const rows = Object.values(defs).flatMap((def) => skillRecords(def).map((row, id) => ({ ...row, id, source: "compiler", status: "draft" } as unknown as RuleRow)));
if (reference) {
  const stored = normalizeRows(reference.after).rows.filter((row) => row.cardId === "BT11-013");
  assert.equal(stored.length, 3, "exact exported BT11-013 skill set");
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].cardId === "BT11-013") rows.splice(i, 1);
  rows.push(...stored);
}
const fusionRow = rows.find((row) => row.cardId === "BT11-013" && row.kind === "keyword")!;
assert.ok(fusionRow);
const original = fusionRow.cost as CostRecord;
assert.equal(original.version, 1);
assert.deepEqual(original.orbs, { Red: 3 });
assert.deepEqual(original.program, [{ op: "draw", n: 2 }]);

function context(change?: (saved: RuleRow[]) => void): EngineContext {
  const saved = clone(rows); change?.(saved);
  return clone({ ...CTX, defs, scripts: rulesFromRows(saved, defs) });
}
function withCost(id: string, edit: (cost: CostRecord) => void): EngineContext {
  return context((saved) => edit(saved.find((r) => r.cardId === id && r.skillIndex === (id === "BT11-013" ? fusionRow.skillIndex : 0))!.cost as CostRecord));
}
interface Saved { ctx: EngineContext; state: VmState }
function take(saved: Saved, action: Action): { saved: Saved; events: GameEvent[] } {
  const restored = clone(saved); // The executable context and the pending VM are both persisted.
  const result = RULES.apply(restored.ctx, restored.state, clone(action));
  return { saved: clone({ ctx: restored.ctx, state: result.state as VmState }), events: result.events };
}
function fresh(ctx: EngineContext, seat: PlayerId = "p1", leader = "L-RED"): Saved {
  let saved: Saved = { ctx, state: RULES.createGame(ctx, { seed: 907, p1: { name: "One", leader: seat === "p1" ? leader : "L-BLUE", main: fifty("V1") }, p2: { name: "Two", leader: seat === "p2" ? leader : "L-BLUE", main: fifty("V1") } }).state as VmState };
  const first: Action[] = [
    { type: "chooseFirst", player: saved.state.chooser, first: "p1" },
    { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null },
    ...(seat === "p2" ? [{ type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }] as Action[] : []),
  ];
  for (const action of first) saved = take(saved, action).saved;
  assert.equal(saved.state.prompt.kind, "main");
  for (const p of ["p1", "p2"] as const) {
    for (const area of ["hand", "energy"] as const) for (const id of saved.state.sides[p].zones[area].slice()) assert.ok(moveCard(saved.state, game, id, "deck", { owner: p }).ok);
    saved.state.sides[p].attrs.energyMarkers = 0;
  }
  return saved;
}
function stage(saved: Saved, seat: PlayerId, def: string, area: string): string {
  const id = saved.state.sides[seat].zones.deck.at(-1)!;
  saved.state.cards[id].cardId = def;
  assert.ok(moveCard(saved.state, game, id, area, { owner: seat }).ok);
  return id;
}
const offer = (saved: Saved, id: string, skill?: number) => RULES.legalActions(saved.ctx, saved.state).find((l) => l.action.type === "activate" && l.action.card === id && (skill === undefined || l.action.skill === skill));
function finish(start: Saved, first: Action): { saved: Saved; events: GameEvent[]; actions: Action[] } {
  let saved = clone(start); const events: GameEvent[] = [], actions: Action[] = [];
  const apply = (action: Action) => { actions.push(action); const next = take(saved, action); saved = next.saved; events.push(...next.events); };
  apply(first);
  for (let i = 0; i < 30 && saved.state.prompt.kind !== "main"; i++) {
    const prompt = saved.state.prompt;
    if (prompt.kind === "chooseMode" || prompt.kind === "replaceMove") apply({ type: "chooseMode", player: prompt.player, index: 0 } as Action);
    else if (prompt.kind === "payCost") apply({ type: "payCost", player: prompt.player, option: 0 } as Action);
    else if (prompt.kind === "chooseCards") apply({ type: "choose", player: prompt.player, cards: prompt.choice.candidates.slice(0, prompt.choice.min) });
    else if (prompt.kind === "orderPending") apply({ type: "orderPending", player: prompt.player, index: prompt.candidates[0] } as Action);
    else apply({ type: "pass", player: (prompt as { player: PlayerId }).player });
  }
  assert.equal(saved.state.prompt.kind, "main", "saved continuation finishes");
  let replay = clone(start); const replayEvents: GameEvent[] = [];
  for (const action of actions) { const next = take(replay, action); replay = next.saved; replayEvents.push(...next.events); }
  assert.deepEqual(replay, saved, "persisted action replay has identical state and executable context");
  assert.deepEqual(replayEvents, events, "persisted action replay emits identical events");
  return { saved, events, actions };
}
function fusionBoard(ctx: EngineContext, energy: number, seat: PlayerId = "p1"): { saved: Saved; fusion: string } {
  const saved = fresh(ctx, seat);
  const fusion = stage(saved, seat, "BT11-013", "hand");
  stage(saved, seat, "GOKU907", "hand"); stage(saved, seat, "VEG907", "hand");
  for (let i = 0; i < energy; i++) stage(saved, seat, "V1", "energy");
  return { saved, fusion };
}
const rested = (saved: Saved, seat: PlayerId) => saved.state.sides[seat].zones.energy.filter((id) => saved.state.cards[id].mode === "rest").length;

for (const seat of ["p1", "p2"] as const) {
  const ordinary = fusionBoard(context(), 3, seat);
  const action = offer(ordinary.saved, ordinary.fusion)!.action;
  const deck = ordinary.saved.state.sides[seat].zones.deck.length;
  const full = finish(ordinary.saved, action);
  assert.equal(rested(full.saved, seat), 3);
  assert.equal(full.saved.state.sides[seat].zones.deck.length, deck - 2);
  assert.ok(full.saved.state.sides[seat].zones.battle.includes(ordinary.fusion));
  assert.equal(offer(fusionBoard(context(), 1, seat).saved, ordinary.fusion), undefined, "printed RRR costs three until the record changes");

  const cheap = withCost("BT11-013", (cost) => { cost.orbs = { Red: 1 }; cost.program = [{ op: "draw", n: 1 }]; });
  const changed = fusionBoard(cheap, 1, seat);
  assert.ok(offer(changed.saved, changed.fusion), "record mutation alone makes the move affordable");
  const before = changed.saved.state.sides[seat].zones.deck.length;
  const result = finish(changed.saved, offer(changed.saved, changed.fusion)!.action);
  assert.equal(rested(result.saved, seat), 1);
  assert.equal(result.saved.state.sides[seat].zones.deck.length, before - 1, "stored action cost is charged instead of printed draw 2");
  const display = withCost("BT11-013", (cost) => { cost.text = "display-only text: pay nothing"; });
  const same = fusionBoard(display, 3, seat);
  assert.equal(offer(fusionBoard(display, 1, seat).saved, same.fusion), undefined);
  const displayDone = finish(same.saved, offer(same.saved, same.fusion)!.action);
  assert.deepEqual(displayDone.saved.state, full.saved.state, "changing cost display text changes no game behavior");
  assert.deepEqual(displayDone.events, full.events);

  // Source identity was checked by the loader. Changing the live card label afterwards
  // must not introduce a second payment authority through parseSkills at activation.
  const relabeled = context();
  relabeled.defs["BT11-013"].skill = FUSION.replace("{r}{r}{r}, draw 2 cards", "{u}, draw 99 cards");
  const labelBoard = fusionBoard(relabeled, 3, seat);
  assert.ok(offer(labelBoard.saved, labelBoard.fusion), "live printed Blue/draw99 label cannot replace stored Red3/draw2");
  const labelBefore = labelBoard.saved.state.sides[seat].zones.deck.length;
  const labelDone = finish(labelBoard.saved, offer(labelBoard.saved, labelBoard.fusion)!.action).saved;
  assert.equal(rested(labelDone, seat), 3);
  assert.equal(labelDone.state.sides[seat].zones.deck.length, labelBefore - 2);
  const labelShort = fusionBoard(relabeled, 1, seat);
  assert.equal(offer(labelShort.saved, labelShort.fusion), undefined, "live one-orb label cannot cheapen stored price");
}

// A stored ordinary action price is charged even though its display line has no cost.
{
  const ctx = withCost("RESOURCE907", (cost) => { cost.program = [{ op: "discard", n: 1 }]; });
  const saved = fresh(ctx), source = stage(saved, "p1", "RESOURCE907", "battle");
  const discard = stage(saved, "p1", "V1", "hand");
  const result = finish(saved, offer(saved, source)!.action).saved;
  assert.ok(result.state.sides.p1.zones.drop.includes(discard), "stored action is paid before the effect");
  assert.equal(result.state.sides.p1.zones.hand.length, 1, "discard one then draw one");
  const noHand = clone(saved);
  assert.ok(moveCard(noHand.state, game, discard, "warp", { owner: "p1" }).ok);
  assert.equal(offer(noHand, source), undefined, "unpayable stored action price is refused");

  const zero = context();
  zero.defs.RESOURCE907.skill = "[Activate: Main] {u}, discard 99 cards from your hand: Draw 1 card.";
  const free = fresh(zero), freeSource = stage(free, "p1", "RESOURCE907", "battle");
  assert.ok(offer(free, freeSource), "stored zero remains free despite a costly live label");
  const done = finish(free, offer(free, freeSource)!.action).saved;
  assert.equal(rested(done, "p1"), 0);
  assert.equal(done.state.sides.p1.zones.hand.length, 1);
}

// Official ver4 §22-13-4-4/-4-1 disproves the old energy-at-declaration
// expectation: a reload before material payment must still hold all energy active.
{
  const board = fusionBoard(context(), 3);
  let pending = take(board.saved, offer(board.saved, board.fusion)!.action).saved;
  if (pending.state.prompt.kind === "payCost") pending = take(pending, { type: "payCost", player: "p1", option: 0 } as Action).saved;
  assert.equal(rested(pending, "p1"), 0);
  assert.equal(pending.state.prompt.kind, "chooseCards");
  for (const id of pending.state.sides.p1.zones.deck.slice(1)) assert.ok(moveCard(pending.state, game, id, "warp", { owner: "p1" }).ok);
  const question = pending.state.prompt;
  assert.ok(question.kind === "chooseCards");
  const failed = finish(pending, { type: "choose", player: question.player, cards: question.choice.candidates.slice(0, question.choice.min) });
  assert.ok(failed.saved.state.sides.p1.zones.hand.includes(board.fusion), "failed draw payment does not play the Fusion");
  assert.equal(failed.saved.state.sides.p1.zones.deck.length, 1, "draw 2 is never charged partially");
  assert.equal(failed.saved.state.sides.p1.zones.drop.length, 2, "material payment remains paid");
  assert.equal(rested(failed.saved, "p1"), 3, "energy payment remains paid");
  assert.ok(!failed.events.some((event) => event.type === "skill" && "card" in event && event.card === board.fusion), "failed activation is never announced");
}

// Synthetic printed support cards isolate §22-13-4-4-1's dynamic board rule;
// they are engineering interaction probes, not claims about catalog cards.
for (const seat of ["p1", "p2"] as const) {
  const make = (leader: string, energy: number, auto = false) => {
    const saved = fresh(context(), seat, leader);
    const fusion = stage(saved, seat, "BT11-013", "hand");
    const goku = stage(saved, seat, auto ? "AUTOGOKU907" : "GOKU907", "hand");
    const vegeta = stage(saved, seat, "VEG907", "hand");
    for (let i = 0; i < energy; i++) stage(saved, seat, "V1", "energy");
    return { saved, fusion, goku, vegeta };
  };
  for (const leader of ["GAIN907", "LOSE907"]) {
    assert.ok((rows.find((row) => row.cardId === leader)?.ops as Op[]).length, "support survives stored compiler record");
  }
  const gained = make("GAIN907", 2);
  assert.ok(offer(gained.saved, gained.fusion), "a reducer becoming true after materials makes RRR affordable with RR");
  const before = clone(gained.saved);
  const gainedDone = finish(gained.saved, offer(gained.saved, gained.fusion)!.action);
  assert.deepEqual(gained.saved, before, "offer proof has no board side effects");
  assert.equal(rested(gainedDone.saved, seat), 2, "remaining cost is determined after Drop count changes");
  assert.ok(gainedDone.saved.state.sides[seat].zones.battle.includes(gained.fusion));
  const lost = make("LOSE907", 2);
  assert.equal(offer(lost.saved, lost.fusion), undefined, "a hand-count reducer lost with the materials cannot discount the remaining cost");
  const enough = make("LOSE907", 3);
  assert.equal(rested(finish(enough.saved, offer(enough.saved, enough.fusion)!.action).saved, seat), 3);

  const watched = make("L-RED", 3, true);
  const watchedDone = finish(watched.saved, offer(watched.saved, watched.fusion)!.action);
  const activation = watchedDone.events.findIndex((event) => event.type === "skill" && "card" in event && event.card === watched.fusion && "skill" in event && event.skill === fusionRow.skillIndex);
  const materialAuto = watchedDone.events.findIndex((event) => event.type === "skill" && "card" in event && event.card === watched.goku);
  assert.ok(activation >= 0 && materialAuto > activation, "material-leave Auto stays pending through remaining payment and activation");
  assert.equal(watchedDone.events.filter((event) => event.type === "draw").length, 3, "printed draw2 cost plus later material Auto draw1");

  const choiceBoard = make("L-RED", 4);
  choiceBoard.saved.state.cards[choiceBoard.saved.state.sides[seat].zones.energy.at(-1)!].cardId = "MULTI907";
  let choicePending = take(choiceBoard.saved, offer(choiceBoard.saved, choiceBoard.fusion)!.action).saved;
  for (let i = 0; i < 2; i++) {
    const question = choicePending.state.prompt; assert.ok(question.kind === "chooseCards");
    assert.equal(rested(choicePending, seat), 0);
    choicePending = take(choicePending, { type: "choose", player: seat, cards: question.choice.candidates.slice(0, question.choice.min) }).saved;
  }
  assert.equal(choicePending.state.prompt.kind, "chooseMode", "resource choices open only after both material departures");
  assert.ok([choiceBoard.goku, choiceBoard.vegeta].every((id) => choicePending.state.sides[seat].zones.drop.includes(id)));
  assert.equal(rested(choicePending, seat), 0);
  for (const old of [clone(choicePending), take(choiceBoard.saved, offer(choiceBoard.saved, choiceBoard.fusion)!.action).saved]) {
    const frame = old.state.programs.find((entry) => entry.keywordPrice || entry.keywordCost)!;
    const cost = frame.keywordPrice ?? frame.keywordCost!;
    delete cost.fusion;
    const question = old.state.prompt;
    const beforeZones = clone(old.state.sides[seat].zones);
    const obsolete = take(old, question.kind === "chooseCards" ? { type: "choose", player: seat, cards: question.choice.candidates.slice(0, question.choice.min) } : { type: "chooseMode", player: seat, index: 0 } as Action);
    assert.equal(obsolete.saved.state.outcome?.kind, "interrupted");
    assert.match(obsolete.saved.state.outcome?.privateContext?.detail ?? "", /rebuild this saved match/);
    assert.deepEqual(obsolete.saved.state.sides[seat].zones, beforeZones, "obsolete payment save is diagnosed before resource or material movement");
  }
  const stale = clone(choicePending);
  for (const id of stale.state.sides[seat].zones.energy) stale.state.cards[id].mode = "rest";
  assert.throws(() => take(stale, { type: "chooseMode", player: seat, index: 0 } as Action), IllegalAction, "a saved stale payment cannot replan or pay twice");
  assert.equal(rested(finish(choicePending, { type: "chooseMode", player: seat, index: 0 } as Action).saved, seat), 3);

  const xctx = withCost("BT11-013", (cost) => { cost.x = { min: 1, max: 1 }; });
  const xBoard = fusionBoard(xctx, 4, seat);
  assert.equal(rested(finish(xBoard.saved, offer(xBoard.saved, xBoard.fusion)!.action).saved, seat), 4, "stored X is charged in addition to fixed orbs at the checkpoint");
  const xShort = fusionBoard(xctx, 3, seat);
  assert.equal(offer(xShort.saved, xShort.fusion), undefined, "stored X cannot silently become free");

  const replaced = make("L-RED", 3);
  addEffect(replaced.saved.state, [], { master: seat, source: replaced.goku, target: replaced.goku, kind: "replaceLeave", value: { to: "warp", optional: true }, until: "turn" });
  let replacedPending = take(replaced.saved, offer(replaced.saved, replaced.fusion)!.action).saved;
  for (let i = 0; i < 2; i++) {
    const question = replacedPending.state.prompt; assert.ok(question.kind === "chooseCards");
    replacedPending = take(replacedPending, { type: "choose", player: seat, cards: question.choice.candidates.slice(0, question.choice.min) }).saved;
  }
  assert.equal(replacedPending.state.prompt.kind, "replaceMove");
  assert.equal(rested(replacedPending, seat), 0);
  const diverted = finish(replacedPending, { type: "chooseMode", player: seat, index: 0 } as Action);
  assert.ok(diverted.saved.state.sides[seat].zones.warp.includes(replaced.goku));
  assert.ok(diverted.saved.state.sides[seat].zones.hand.includes(replaced.fusion));
  assert.equal(rested(diverted.saved, seat), 0, "redirected material fails before energy or draw payment");
  assert.ok(!diverted.events.some((event) => event.type === "skill" && "card" in event && event.card === replaced.fusion));

  const burstCtx = withCost("BT11-013", (cost) => { cost.burst = 1; });
  const burst = fusionBoard(burstCtx, 3, seat);
  const top = burst.saved.state.sides[seat].zones.deck[0];
  let burstPending = take(burst.saved, offer(burst.saved, burst.fusion)!.action).saved;
  // Install a legal replacement after declaration to isolate the saved
  // native-payment failure path from the declaration's affordability proof.
  addEffect(burstPending.state, [], { master: seat, source: top, target: top, kind: "replaceLeave", value: { to: "warp", optional: true }, until: "turn" });
  for (let i = 0; i < 2; i++) {
    const question = burstPending.state.prompt; assert.ok(question.kind === "chooseCards");
    burstPending = take(burstPending, { type: "choose", player: seat, cards: question.choice.candidates.slice(0, question.choice.min) }).saved;
  }
  assert.equal(burstPending.state.prompt.kind, "replaceMove", "native Burst asks its persisted replacement before completing payment");
  const burstFailed = finish(burstPending, { type: "chooseMode", player: seat, index: 0 } as Action);
  assert.ok(burstFailed.saved.state.sides[seat].zones.warp.includes(top));
  assert.equal(rested(burstFailed.saved, seat), 0, "declared Burst precedes energy; an unpaid Burst never charges later resources");
  assert.equal(burstFailed.saved.state.sides[seat].zones.drop.length, 2, "already paid Fusion materials stay in Drop");
  assert.ok(burstFailed.saved.state.sides[seat].zones.hand.includes(burst.fusion));
  assert.ok(!burstFailed.events.some((event) => event.type === "skill" && "card" in event && event.card === burst.fusion));

  const failed = make("L-RED", 3, true);
  let pending = take(failed.saved, offer(failed.saved, failed.fusion)!.action).saved;
  assert.equal(pending.state.prompt.kind, "chooseCards");
  assert.equal(rested(pending, seat), 0, "declaring Fusion spends no energy");
  // A saved-state resource invalidation models a payment that became impossible.
  for (const id of pending.state.sides[seat].zones.energy) pending.state.cards[id].mode = "rest";
  const q = pending.state.prompt; assert.ok(q.kind === "chooseCards");
  const failure = finish(pending, { type: "choose", player: seat, cards: q.choice.candidates.slice(0, q.choice.min) });
  assert.ok([failed.goku, failed.vegeta].every((id) => failure.saved.state.sides[seat].zones.drop.includes(id)), "failed resource payment retains already paid materials");
  assert.ok(failure.saved.state.sides[seat].zones.hand.includes(failed.fusion));
  assert.ok(!failure.events.some((event) => event.type === "skill" && "card" in event && event.card === failed.fusion), "resource failure never activates Fusion");
  assert.ok(failure.events.some((event) => event.type === "skill" && "card" in event && event.card === failed.goku), "failed activation still reaches the ordinary checkpoint for the material Auto");
}

// Invalid or absent stored contracts never become a free Union activation.
const invalid: [string, (saved: RuleRow[]) => void][] = [
  ["obsolete", (saved) => { delete (saved.find((r) => r.cardId === "BT11-013" && r.kind === "keyword")!.cost as Partial<CostRecord>).version; }],
  ["missing", (saved) => { saved.splice(saved.findIndex((r) => r.cardId === "BT11-013" && r.kind === "keyword"), 1); }],
  ["malformed", (saved) => { (saved.find((r) => r.cardId === "BT11-013" && r.kind === "keyword")!.cost as CostRecord).orbs = { Red: -1 }; }],
  ["unreadable", (saved) => { (saved.find((r) => r.cardId === "BT11-013" && r.kind === "keyword")!.cost as CostRecord).readable = false; }],
  ["invalid X", (saved) => { (saved.find((r) => r.cardId === "BT11-013" && r.kind === "keyword")!.cost as CostRecord).x = { min: -1 }; }],
];
for (const [label, edit] of invalid) {
  const { saved, fusion } = fusionBoard(context(edit), 3);
  assert.equal(offer(saved, fusion), undefined, `${label} contract is refused`);
  const before = clone(saved);
  assert.throws(() => RULES.apply(saved.ctx, clone(saved.state), { type: "activate", player: "p1", card: fusion, skill: fusionRow.skillIndex }), IllegalAction);
  assert.deepEqual(saved, before, `${label} forged activation changes nothing`);
}

// Each resource comes from the stored cost on an unchanged plain Activate line.
for (const resource of ["either", "marker", "burst", "spiritBoost"] as const) {
  const id = resource === "marker" ? "MARKER907" : "RESOURCE907";
  const ctx = withCost(id, (cost) => {
    if (resource === "either") cost.either = [["Red", "Blue"]];
    else if (resource === "marker") cost.marker = -2;
    else cost[resource] = 2;
  });
  const saved = fresh(ctx), source = stage(saved, "p1", id, resource === "marker" ? "unison" : "battle");
  let payer: string | undefined;
  if (resource === "either") payer = stage(saved, "p1", "BLUE907", "energy");
  if (resource === "marker") saved.state.cards[source].markers = 3;
  if (resource === "spiritBoost") { payer = stage(saved, "p1", "UNISON907", "unison"); saved.state.cards[payer].markers = 3; }
  const before = saved.state.sides.p1.zones.deck.length;
  assert.ok(offer(saved, source), `${resource} affordable`);
  const result = finish(saved, offer(saved, source)!.action).saved;
  if (resource === "either") assert.equal(result.state.cards[payer!].mode, "rest");
  if (resource === "marker") { assert.equal(result.state.cards[source].markers, 1); assert.equal(result.state.cards[source].usedMarkerSkill, true); assert.equal(offer(result, source), undefined); }
  if (resource === "spiritBoost") assert.equal(result.state.cards[payer!].markers, 1);
  assert.equal(result.state.sides.p1.zones.deck.length, before - 1 - (resource === "burst" ? 2 : 0));
  const short = clone(saved);
  if (resource === "either") short.state.cards[payer!].mode = "rest";
  else if (resource === "marker") short.state.cards[source].markers = 1;
  else if (resource === "spiritBoost") short.state.cards[payer!].markers = 1;
  else for (const cardId of short.state.sides.p1.zones.deck.slice(1)) assert.ok(moveCard(short.state, game, cardId, "warp", { owner: "p1" }).ok);
  assert.equal(offer(short, source), undefined, `${resource} shortfall is refused`);
}

// P-360's granted price is persisted data too, independent of the grant's display line.
const granted = context((saved) => {
  const row = saved.find((r) => r.cardId === "GRANT907")!;
  const permit = (row.ops as Op[]).find((op) => op.op === "permit"); assert.ok(permit?.op === "permit" && permit.price);
  assert.deepEqual(permit.price.payment.orbs, { Red: 1, Blue: 1, any: 2 });
  permit.price.payment.orbs = { Red: 1 };
});
const grantBoard = fresh(granted, "p1", "GRANT907");
const gog = stage(grantBoard, "p1", "GOG907", "hand");
stage(grantBoard, "p1", "GOKU907", "hand"); stage(grantBoard, "p1", "VEG907", "hand"); stage(grantBoard, "p1", "V1", "energy");
const grantOffer = offer(grantBoard, gog, GRANTED_LINE_BASE); assert.ok(grantOffer);
const grantDone = finish(grantBoard, grantOffer.action).saved;
assert.equal(rested(grantDone, "p1"), 1);
assert.ok(grantDone.state.sides.p1.zones.battle.includes(gog));

// A new authored row cannot silently acquire the obsolete database null default.
// The mock supplies only the read: reaching any write fails this proof.
async function verifyNewRecordAdmission() {
  const db = { query: { cardRules: { findFirst: async () => undefined } }, insert: () => { throw new Error("unexpected database write"); } };
  await assert.rejects(saveRule(db as unknown as Parameters<typeof saveRule>[0], {
    cardId: "NEW907", side: "front", skillIndex: 0, source: "user", status: "draft",
    printed: "[Activate: Main] Draw 1 card.", kind: "activate:main", ops: [{ op: "draw", n: 1 }],
  }), /new rule requires explicit typed payment/);
}
verifyNewRecordAdmission().then(() => {
  console.log("typed-payment-907: stored Union payment; post-material resources/reducers/X; pending Autos; material and Burst replacement failure; stale choices and obsolete saves; both seats/context+state replay passed");
}).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
