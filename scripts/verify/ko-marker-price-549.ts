/** KO and add-marker action prices on the strict Auto/Aegis host (#549, #595). */
// Fixed expectations from 5-8-2-2, 5-8-2-2-1-1, 5-8-4, 5-12, 9-6-4 and
// 22-30-3; never derived from the legacy oracle. The printed wordings are the
// catalog's own ("[Auto] KO this card: …", "Choose 1 of your <Vegeta> cards
// and KO it: …", BT31's "Add 1 marker to this card: …"), compiled here on
// synthetic cards; no particular printed card's trigger is replayed.
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
const defs = { ...DEFS,
  KOSELF549: card("KOSELF549", { energyCost: 0, skill: "[Auto] KO this card: When you play this card, draw 1 card.\n[Auto] When this card is KO'd, draw 2 cards." }),
  KOPICK549: card("KOPICK549", { energyCost: 0, skill: "[Auto] Choose 1 of your <Vegeta> cards and KO it: When you play this card, draw 1 card." }),
  KOBATTLE549: card("KOBATTLE549", { energyCost: 0, skill: "[Auto] Choose 1 of your Battle Cards and KO it: When you play this card, draw 1 card." }),
  MARK549: card("MARK549", { energyCost: 0, skill: "[Auto] Add 1 marker to this card: When you play this card, draw 1 card." }),
  VEGETA549: card("VEGETA549", { energyCost: 0, characters: ["Vegeta"], skill: null }),
  VEGLEAD549: card("VEGLEAD549", { type: "LEADER", characters: ["Vegeta"], energyCost: null, comboCost: null, comboPower: null }),
  NOKO549: card("NOKO549", { energyCost: 0, characters: ["Vegeta"], skill: "[Permanent] This card can't be KO'd." }),
  NOKOSELF549: card("NOKOSELF549", { energyCost: 0, skill: "[Permanent] This card can't be KO'd.\n[Auto] KO this card: When you play this card, draw 1 card." }),
  OPPTOUGH549: card("OPPTOUGH549", { energyCost: 0, characters: ["Vegeta"], skill: "[Permanent] This card can't be KO'd by your opponent's skills." }),
  KO595: card("KO595", { skill: "[Aegis red/blue] KO 1 of your Battle Cards" }),
  KOSELF595: card("KOSELF595", { skill: "[Aegis red/blue] KO this card" }),
  MARK595: card("MARK595", { skill: "[Aegis red/blue] Add 1 marker to this card" }),
  DRAW595: card("DRAW595", { skill: "[Aegis red/blue] Draw 1 card" }),
  RED595: card("RED595", { colors: ["Red"], skill: null }),
  BLUE595: card("BLUE595", { colors: ["Blue"], skill: null }),
};
const scripts = rulesFromCompiler(defs);
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
const apply = (s: VmState, action: Action) => rules.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] };
const answer = (s: VmState, index: number, player: PlayerId = "p1") => apply(s, { type: "chooseMode", player, index });
const choose = (s: VmState, cards: string[], player: PlayerId = "p1") => apply(s, { type: "choose", player, cards });
const draws = (ev: GameEvent[]) => ev.filter((e) => e.type === "draw").length;
const skillAt = (ev: GameEvent[], id: string) => ev.findIndex((e) => e.type === "skill" && e.card === id);
const skills = (ev: GameEvent[], id: string) => ev.filter((e) => e.type === "skill" && e.card === id).length;
const declineIndex = (s: VmState) => { assert.ok(s.prompt.kind === "chooseMode" || s.prompt.kind === "replaceMove"); return s.prompt.kind === "chooseMode" || s.prompt.kind === "replaceMove" ? s.prompt.options.length - 1 : -1; };
const candidates = (s: VmState) => (s.prompt.kind === "chooseCards" ? [...s.prompt.choice.candidates].sort() : []);
function snapshot(s: VmState, viewer: PlayerId) {
  return buildSnapshot({ id: 549, mode: "versus", status: "playing", p1Name: "You", p2Name: "Other", ctx, state: s, legal: rules.legalActions(ctx, s), log: [], beats: null, spotlight: null, spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} });
}
function main(): VmState {
  let s = rules.createGame(ctx, { seed: 5491, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = rules.apply(ctx, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = rules.apply(ctx, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(s.prompt.kind, "main");
  return s;
}
function stage(s: VmState, id: string, area: "hand" | "battle" | "energy" | "drop" = "battle", p: PlayerId = "p1"): string {
  const physical = s.sides[p].zones.deck[0];
  assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, dbs, physical, area, { owner: p }).ok);
  return physical;
}
/** Pend the source's first Auto from the "played" moment and run the checkpoint. */
function pend(s: VmState, source: string): GameEvent[] {
  s.pending.push({ card: source, master: "p1", skillIndex: 0, trigger: "played" });
  const ev: GameEvent[] = [];
  run(ctx, dbs, s, ev);
  return ev;
}
function unaffordable(s: VmState, source: string): void {
  const before = JSON.stringify(s.sides);
  const ev = pend(s, source);
  assert.equal(s.prompt.kind, "main", "no payment is offered");
  assert.equal(JSON.stringify(s.sides), before, "nothing is paid");
  assert.equal(draws(ev), 0); assert.equal(skills(ev, source), 0);
  assert.ok(ev.some((e) => e.type === "note" && /unaffordable/.test(e.text)));
}

// ── the reading: catalog wordings compile to the shapes this host admits ────
{
  assert.deepEqual(scripts.KOSELF549.bySkill[0].price?.ops, [{ op: "ko", target: { sel: { special: "self" } } }]);
  assert.deepEqual(scripts.KOPICK549.bySkill[0].price?.ops?.map((op) => op.op), ["choose", "ko"]);
  assert.equal((scripts.KOPICK549.bySkill[0].price?.ops?.[0] as Extract<Op, { op: "choose" }>).sel.area, "play", "\"your <Vegeta> cards\" also reads the Leader");
  assert.deepEqual(scripts.MARK549.bySkill[0].price?.ops, [{ op: "addMarker", target: { sel: { special: "self" } }, n: 1 }]);
  for (const id of ["KOSELF549", "KOPICK549", "KOBATTLE549", "MARK549", "KO595", "KOSELF595", "MARK595"] as const) {
    readableAutomaticPrice(scripts[id].bySkill[0].price?.ops ?? [], "Auto", "#549");
  }
  // Shapes without a payment proof stay typed unknown under each owner.
  const unproved: Op[][] = [
    [{ op: "choose", sel: { side: "you", area: "battle", count: 1, upTo: true }, as: "c0" }, { op: "ko", target: { var: "c0" } }],
    [{ op: "choose", sel: { side: "opponent", area: "battle", count: 1 }, as: "c0" }, { op: "ko", target: { var: "c0" } }],
    [{ op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "c0" }, { op: "ko", target: { var: "c0" } }],
    [{ op: "choose", sel: { side: "you", area: "battle", count: 1 }, as: "c0", chooser: "opponent" }, { op: "ko", target: { var: "c0" } }],
    [{ op: "ko", target: { sel: { side: "you", area: "battle" } } }],
    [{ op: "addMarker", target: { sel: { special: "self" } }, n: { x: true } }],
    [{ op: "choose", sel: { side: "you", area: "battle", count: 1 }, as: "c0" }, { op: "addMarker", target: { var: "c0" }, n: 1 }],
    [{ op: "draw", n: 1 }],
  ];
  for (const ops of unproved) for (const owner of ["#549", "#595"] as const) {
    assert.throws(() => readableAutomaticPrice(ops, owner === "#549" ? "Auto" : "Aegis", owner), (err: unknown) => err instanceof NotYet && err.issue === owner, JSON.stringify(ops));
  }
  // A completed KO is a paid prefix for a later conditional adjunct.
  readableAutomaticPrice([{ op: "ko", target: { sel: { special: "self" } } }, { op: "if", cond: { kind: "all", conds: [] }, then: [{ op: "shuffle" }] }]);
}

// ── Auto: KO this card ──────────────────────────────────────────────────────
// A real play moment offers the price; declining pays nothing; paying KOs the
// source into its owner's Drop before the skill fires and draws. The KO is a
// KO: the source's own "when this card is KO'd" Auto answers afterwards.
{
  const start = main(); const source = stage(start, "KOSELF549", "hand");
  const played = apply(start, { type: "play", player: "p1", card: source });
  const s = played.state;
  assert.equal(draws(played.events), 0); assert.equal(skills(played.events, source), 0);
  assert.ok(s.sides.p1.zones.battle.includes(source));
  assert.equal(s.prompt.kind, "chooseMode");
  assert.ok(s.prompt.kind === "chooseMode" && /Pay/.test(s.prompt.options[0]));
  const before = JSON.stringify(s);
  assert.throws(() => answer(s, 0, "p2"), IllegalAction, "only the Auto's master answers");
  assert.throws(() => answer(s, 9), IllegalAction);
  assert.equal(JSON.stringify(s), before);
  const declined = answer(s, declineIndex(s));
  assert.ok(declined.state.sides.p1.zones.battle.includes(source)); assert.equal(draws(declined.events), 0);
  assert.equal(declined.events.some((e) => e.type === "ko"), false);
  const paid = answer(s, 0);
  assert.ok(paid.state.sides.p1.zones.drop.includes(source), "5-12-1: the source reached its owner's Drop");
  const ko = paid.events.findIndex((e) => e.type === "ko" && e.card === source);
  const move = paid.events.findIndex((e) => e.type === "move" && e.card === source && e.to === "drop");
  assert.ok(ko >= 0 && ko < move && move < skillAt(paid.events, source), "ko, move, then the skill");
  assert.equal(draws(paid.events), 3, "the paid Auto draws 1, then its KO'd Auto draws 2 at the next checkpoint");
  const paidSkills = paid.events.filter((e) => e.type === "skill" && e.card === source).map((e) => e.type === "skill" ? e.skill : -1);
  assert.equal(paidSkills.length, 2); assert.equal(paidSkills[0], 0);
  assert.equal(paid.state.prompt.kind, "main");
  assert.throws(() => answer(paid.state, 0), IllegalAction, "a paid price cannot be answered again");
}
// Not in the Battle Area, or protected by a prohibition: the KO cannot be
// performed, so the price is unaffordable rather than a free skill.
{
  const s = main(); const source = stage(s, "KOSELF549", "drop");
  unaffordable(s, source);
}
{
  // The source itself cannot be KO'd at all (20-14).
  const index = Number(Object.entries(scripts.NOKOSELF549.bySkill).find(([, skill]) => skill?.price?.ops?.length)?.[0]);
  assert.ok(Number.isInteger(index));
  const s = main(); const source = stage(s, "NOKOSELF549", "battle");
  s.pending.push({ card: source, master: "p1", skillIndex: index, trigger: "played" });
  const before = JSON.stringify(s.sides); const ev: GameEvent[] = []; run(ctx, dbs, s, ev);
  assert.equal(s.prompt.kind, "main"); assert.equal(JSON.stringify(s.sides), before); assert.equal(draws(ev), 0);
  assert.ok(ev.some((e) => e.type === "note" && /unaffordable/.test(e.text)));
}

// ── Auto: choose 1 of your cards and KO it ─────────────────────────────────
// Candidates are only own Battle-Area cards that can actually be KO'd: never
// the Leader (5-12-1), an opponent's card, or a card that can't be KO'd; a
// card protected only from the opponent's skills can pay an own price.
{
  const s = main(); const source = stage(s, "KOPICK549", "battle");
  const leader = s.sides.p1.zones.leader[0]; s.cards[leader].cardId = "VEGLEAD549";
  const fodder = stage(s, "VEGETA549", "battle"); const tough = stage(s, "OPPTOUGH549", "battle");
  const blocked = stage(s, "NOKO549", "battle"); const inHand = stage(s, "VEGETA549", "hand");
  const theirs = stage(s, "VEGETA549", "battle", "p2");
  pend(s, source);
  const opened = answer(s, 0);
  assert.equal(opened.state.prompt.kind, "chooseCards");
  assert.deepEqual(candidates(opened.state), [fodder, tough].sort());
  for (const id of [leader, blocked, inHand, theirs, source]) assert.ok(!candidates(opened.state).includes(id));
  assert.equal(draws(opened.events), 0); assert.equal(skills(opened.events, source), 0);
  // Projections: the payer is asked and holds the choice; the opponent waits
  // with no legal move, and neither view carries the private cost cursor.
  const mine = snapshot(opened.state, "p1"); const other = snapshot(opened.state, "p2");
  assert.equal(mine.waiting, "you"); assert.equal(other.waiting, "opponent");
  assert.ok(mine.legal.some((m) => m.action.type === "choose" && (m.action as { cards: string[] }).cards.includes(fodder)));
  assert.equal(other.legal.length, 0);
  for (const view of [mine, other]) assert.ok(!JSON.stringify(view).includes("autoCost"));
  // Stale and wrong-actor answers are refused without mutation.
  const saved = JSON.stringify(opened.state);
  assert.throws(() => choose(opened.state, [fodder], "p2"), IllegalAction);
  assert.throws(() => choose(opened.state, [leader]), IllegalAction);
  assert.throws(() => choose(opened.state, [blocked]), IllegalAction);
  assert.throws(() => choose(opened.state, []), IllegalAction, "the price is not optional once paying");
  assert.equal(JSON.stringify(opened.state), saved);
  const stale = reload(opened.state); assert.ok(moveCard(stale, dbs, fodder, "hand", { owner: "p1" }).ok);
  const staleBefore = JSON.stringify(stale);
  assert.throws(() => choose(stale, [fodder]), IllegalAction, "a card that left the Battle Area can no longer pay");
  assert.equal(JSON.stringify(stale), staleBefore);
  // JSON reload mid-price resolves identically, once.
  const paid = choose(reload(opened.state), [fodder]); const again = choose(JSON.parse(saved) as VmState, [fodder]);
  assert.equal(JSON.stringify(again.state), JSON.stringify(paid.state));
  assert.ok(paid.state.sides.p1.zones.drop.includes(fodder)); assert.ok(paid.state.sides.p1.zones.battle.includes(tough));
  const ko = paid.events.findIndex((e) => e.type === "ko" && e.card === fodder);
  assert.ok(ko >= 0 && ko < skillAt(paid.events, source)); assert.equal(skills(paid.events, source), 1); assert.equal(draws(paid.events), 1);
  assert.equal(paid.events.filter((e) => e.type === "ko").length, 1, "charged once");
  assert.ok(JSON.stringify(snapshot(paid.state, "p2").view.them).includes(fodder), "the KO'd card is public in the opponent's view of the Drop");
  // Paying with OPPTOUGH549: "can't be KO'd by your opponent's skills" does not stop an own cost.
  const toughPaid = choose(reload(opened.state), [tough]);
  assert.ok(toughPaid.state.sides.p1.zones.drop.includes(tough)); assert.equal(draws(toughPaid.events), 1);
}
// Only the Leader (or nothing KO-able) matches: unaffordable, nothing paid.
{
  const s = main(); const source = stage(s, "KOPICK549", "battle");
  s.cards[s.sides.p1.zones.leader[0]].cardId = "VEGLEAD549";
  stage(s, "NOKO549", "battle"); stage(s, "VEGETA549", "hand");
  unaffordable(s, source);
}
// 9-10 replacements of the KO. An optional "instead" offered to the card's
// master: applying it diverts the card, so the attempted payment fails after
// it was made (5-8-2-2-1-1, 5-8-4) and the skill never fires; declining it
// completes the KO. A mandatory redirect makes the price unpayable before any
// offer. A replacement of removal "by a skill" (an effect) does not answer a
// cost KO.
for (const mode of ["optional", "mandatory", "effect-only"] as const) {
  // The source is not a <Vegeta> card, so the fodder is the only candidate.
  const s = main(); const source = stage(s, "KOPICK549", "battle");
  const fodder = stage(s, "VEGETA549", "battle");
  addEffect(s, [], { master: "p1", source: fodder, target: fodder, kind: "replaceLeave", value: { to: "hand", ...(mode === "effect-only" ? { by: "skill" } : { by: "ko" }), ...(mode === "optional" ? { optional: true } : {}) }, until: "turn" });
  if (mode === "mandatory") {
    unaffordable(s, source);
    continue;
  }
  pend(s, source);
  const opened = answer(s, 0);
  const picked = opened.state.prompt.kind === "chooseCards" ? choose(opened.state, [fodder]) : opened;
  if (mode === "effect-only") {
    assert.ok(picked.state.sides.p1.zones.drop.includes(fodder)); assert.equal(draws(picked.events), 1);
    continue;
  }
  assert.equal(picked.state.prompt.kind, "replaceMove"); assert.equal(skills(picked.events, source), 0);
  assert.ok(picked.state.prompt.kind === "replaceMove" && picked.state.prompt.player === "p1");
  const midway = reload(picked.state);
  const failed = answer(midway, 0);
  assert.ok(failed.state.sides.p1.zones.hand.includes(fodder), "the replacement took the card to the hand");
  assert.equal(skills(failed.events, source), 0); assert.equal(draws(failed.events), 0);
  assert.ok(failed.events.some((e) => e.type === "note" && /payment to fail/.test(e.text)));
  assert.equal(failed.state.prompt.kind, "main");
  const kept = answer(midway, declineIndex(midway));
  assert.ok(kept.state.sides.p1.zones.drop.includes(fodder)); assert.equal(draws(kept.events), 1);
  assert.ok(kept.events.findIndex((e) => e.type === "move" && e.card === fodder && e.to === "drop") < skillAt(kept.events, source));
}

// ── Auto: add a marker to this card ─────────────────────────────────────────
{
  const s = main(); const source = stage(s, "MARK549", "battle");
  pend(s, source);
  const declined = answer(s, declineIndex(s));
  assert.equal(declined.state.cards[source].markers, 0); assert.equal(draws(declined.events), 0);
  const paid = answer(reload(s), 0);
  assert.equal(paid.state.cards[source].markers, 1);
  const marker = paid.events.findIndex((e) => e.type === "markers" && e.card === source);
  assert.ok(marker >= 0 && marker < skillAt(paid.events, source)); assert.equal(draws(paid.events), 1);
  assert.equal(paid.events.filter((e) => e.type === "markers").length, 1, "charged once");
}
{
  const s = main(); const source = stage(s, "MARK549", "drop");
  unaffordable(s, source);
}

// ── Aegis: the same families after the colour cards (22-30-3) ──────────────
function defense(source: string, extra: string[] = []) {
  let s = rules.createGame(ctx, { seed: 5952, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = rules.apply(ctx, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = rules.apply(ctx, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
  for (const id of s.sides.p1.zones.hand.slice()) assert.ok(moveCard(s, dbs, id, "deck", { owner: "p1" }).ok);
  const src = stage(s, source, "battle");
  const others = extra.map((id) => stage(s, id, "battle"));
  const colours = ["RED595", "BLUE595"].map((id) => stage(s, id, "hand"));
  s = apply(s, { type: "endMain", player: "p1" }).state;
  s = apply(s, { type: "charge", player: "p2", card: null }).state;
  s = apply(s, { type: "attack", player: "p2", attacker: s.sides.p2.zones.leader[0], target: s.sides.p1.zones.leader[0] }).state;
  s = apply(s, { type: "pass", player: "p2" }).state;
  assert.equal(s.prompt.kind, "combo");
  return { s, source: src, others, colours };
}
function payColours(a: ReturnType<typeof defense>) {
  const declared = apply(a.s, { type: "activate", player: "p1", card: a.source, skill: 0 });
  assert.equal(skills(declared.events, a.source), 0, "declaring pays nothing");
  assert.ok(a.colours.every((id) => declared.state.sides.p1.zones.hand.includes(id)));
  const paid = choose(declared.state, [a.colours[0]]);
  assert.ok(a.colours.every((id) => paid.state.sides.p1.zones.drop.includes(id)), "both colour cards paid first");
  return paid;
}
// KO 1 of your Battle Cards: asked after the colours, reloadable, refuses
// stale and wrong-actor answers unchanged, and is charged once before the
// skill. Opponent sees no legal move and no cost cursor.
{
  const a = defense("KO595", ["V1"]); const [fodder] = a.others;
  const asked = payColours(a);
  assert.equal(asked.state.prompt.kind, "chooseCards"); assert.equal(skills(asked.events, a.source), 0);
  assert.equal(asked.state.programs[0].aegisCost?.stage, "action");
  assert.deepEqual(candidates(asked.state), [a.source, fodder].sort());
  const other = snapshot(asked.state, "p2"); assert.equal(other.legal.length, 0); assert.ok(!JSON.stringify(other).includes("aegisCost"));
  assert.ok(!JSON.stringify(snapshot(asked.state, "p1")).includes("aegisCost"));
  const saved = JSON.stringify(asked.state);
  assert.throws(() => choose(asked.state, [fodder], "p2"), IllegalAction);
  assert.throws(() => choose(asked.state, [a.colours[0]]), IllegalAction);
  assert.equal(JSON.stringify(asked.state), saved);
  const stale = reload(asked.state); assert.ok(moveCard(stale, dbs, fodder, "hand", { owner: "p1" }).ok);
  const staleBefore = JSON.stringify(stale);
  assert.throws(() => choose(stale, [fodder]), IllegalAction); assert.equal(JSON.stringify(stale), staleBefore);
  const paid = choose(reload(asked.state), [fodder]); const again = choose(JSON.parse(saved) as VmState, [fodder]);
  assert.equal(JSON.stringify(paid.state), JSON.stringify(again.state));
  assert.ok(paid.state.sides.p1.zones.drop.includes(fodder));
  const ko = paid.events.findIndex((e) => e.type === "ko" && e.card === fodder);
  assert.ok(ko >= 0 && ko < skillAt(paid.events, a.source)); assert.equal(skills(paid.events, a.source), 1);
  assert.equal(paid.events.filter((e) => e.type === "move" && e.from === "hand").length, 0, "no colour card moves again");
}
// KO this card. A mandatory KO replacement makes it impossible after the
// colours: the activation fails, the colours stay spent (5-8-4). An optional
// one offered to the master fails the attempted payment when applied.
{
  const a = defense("KOSELF595");
  const paid = payColours(a);
  assert.ok(paid.state.sides.p1.zones.drop.includes(a.source));
  assert.ok(paid.events.findIndex((e) => e.type === "ko" && e.card === a.source) < skillAt(paid.events, a.source));
  assert.equal(skills(paid.events, a.source), 1);
}
for (const optional of [false, true]) {
  const a = defense("KOSELF595");
  addEffect(a.s, [], { master: "p1", source: a.source, target: a.source, kind: "replaceLeave", value: { to: "hand", by: "ko", ...(optional ? { optional: true } : {}) }, until: "turn" });
  let result = payColours(a);
  if (optional) {
    assert.equal(result.state.prompt.kind, "replaceMove"); assert.equal(skills(result.events, a.source), 0);
    result = answer(reload(result.state), 0);
  }
  assert.ok(result.state.sides.p1.zones.battle.includes(a.source) || result.state.sides.p1.zones.hand.includes(a.source));
  assert.equal(result.state.sides.p1.zones.drop.includes(a.source), false);
  assert.equal(skills(result.events, a.source), 0); assert.deepEqual(result.state.cards[a.source].usedThisTurn, []);
  assert.ok(a.colours.every((id) => result.state.sides.p1.zones.drop.includes(id)), "the colour payment is retained");
  assert.ok(result.events.some((e) => e.type === "note" && /Aegis activation failed/.test(e.text)));
  assert.equal(result.state.prompt.kind, "combo");
}
// Add a marker: paid after the colours and before the activation.
{
  const a = defense("MARK595");
  const paid = payColours(a);
  assert.equal(paid.state.cards[a.source].markers, 1);
  assert.ok(paid.events.findIndex((e) => e.type === "markers" && e.card === a.source) < skillAt(paid.events, a.source));
}
// A family still outside the host stays a #595 interruption at declaration.
{
  const a = defense("DRAW595");
  assert.throws(() => apply(a.s, { type: "activate", player: "p1", card: a.source, skill: 0 }), (err: unknown) => err instanceof NotYet && err.issue === "#595" && /draw/.test(err.step));
}
console.log("ko-marker-price-549: KO and add-marker Auto/Aegis prices pay, decline, fail and reload on the strict host");
