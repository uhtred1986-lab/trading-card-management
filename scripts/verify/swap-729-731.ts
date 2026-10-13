/**
 * #731 (22-22-2/3): [Swap] reveals only the *specified* Battle Card — the
 * printed description read with the compiler's filter grammar, on the offer
 * and the resolution. #729 (22-22, 4-3-3, 5-8): BT4-079's action price is paid
 * on the strict action-price host after its energy and before the swap.
 *
 * Independent expectations; never derived from the legacy oracle. BT4-077,
 * BT4-078, BT4-079, BT4-084, BT4-091, SD5-04 and SD5-05 are the catalog's own
 * text (the #649 audit snapshot); the *731/*729 cards are synthetic, and the
 * ones that carry another catalog card's [Swap] line copy its printed words
 * (named beside each).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CTX, DEFS, card, fifty } from "./harness";
import { engineFor } from "../../src/lib/arena/engines";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { compileCard } from "../../src/lib/arena/compile";
import { rulesFromCompiler } from "../../src/lib/arena/draft";
import { cardDefFrom } from "../../src/lib/arena/load";
import { buildSnapshot } from "../../src/lib/arena/snapshot";
import { parseFilter } from "../../src/lib/arena/text/filters";
import { printedDescription, skillsOf } from "../../src/lib/arena/text/cards";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { IllegalAction } from "../../src/lib/arena/vm/common";
import { stepSwapCost } from "../../src/lib/arena/vm/swap-costs";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, EngineContext, GameEvent, PlayerId, Requirement } from "../../src/lib/arena/types";

const engine = engineFor("rules");
const loaded = rulesetFor("dbs"); assert.ok(loaded.ok);
const game = loaded.definition;

const snapshot = JSON.parse(readFileSync("docs/arena-backlog/evidence/649/catalog-subset-2026-10-13.json", "utf8")) as { cards: { id: string }[] };
const printed = (id: string): CardDef => {
  const row = snapshot.cards.find((c) => c.id === id);
  assert.ok(row, `${id} is in the audit snapshot`);
  return cardDefFrom(row as Parameters<typeof cardDefFrom>[0]);
};
const yellow = (id: string, o: Partial<CardDef> = {}) => card(id, { colors: ["Yellow"], skill: null, ...o });

const defs: Record<string, CardDef> = { ...DEFS,
  ...Object.fromEntries(["BT4-077", "BT4-078", "BT4-079", "BT4-084", "BT4-091", "SD5-04", "SD5-05"].map((id) => [id, printed(id)])),
  // Yellow energy, and a hand card no [Swap] specifies.
  YEL729: yellow("YEL729"),
  FODDER729: yellow("FODDER729", { colors: ["Green"] }),
  // Off-trait Battle Cards at the costs the snapshot's [Swap]s name.
  OFF731C2: yellow("OFF731C2", { energyCost: 2 }),
  OFF731C3: yellow("OFF731C3", { energyCost: 3 }),
  OFF731C4: yellow("OFF731C4", { energyCost: 4, traits: ["Vegeta's Lineage"] }),
  GL4X731: yellow("GL4X731", { energyCost: 4, traits: ["Goku's Lineage"] }),
  // A ≪Goku's Lineage≫ card at cost 4 that is an Extra, not a Battle Card (22-22-2).
  GLEX731: yellow("GLEX731", { type: "EXTRA", energyCost: 4, power: null, comboCost: null, comboPower: null, traits: ["Goku's Lineage"] }),
  // EX19-31's printed line on a synthetic card: "Green/Yellow" is a multicolor card (1-8-1-1-1-1).
  GY731: card("GY731", { colors: ["Green", "Yellow"], energyCost: 3, skill: "[swap 8]{g}{y}, if you have 3 or more energy: Green/Yellow <Broly: Br> with an energy cost of 8." }),
  BROLYGY731: card("BROLYGY731", { colors: ["Green", "Yellow"], energyCost: 8, characters: ["Broly: Br"] }),
  BROLYG731: card("BROLYG731", { colors: ["Green"], energyCost: 8, characters: ["Broly: Br"] }),
  // P-594's printed line: a restriction with a description, outside the strict host.
  P594X729: card("P594X729", { colors: ["Red"], energyCost: 3, skill: "[swap 6]{r}, if you have 3 or more energy and you can't play a Battle Card with 40000 power or more for the turn: Mono-red <Broly: Br> card with an energy cost of 6." }),
  BROLYR729: card("BROLYR729", { colors: ["Red"], energyCost: 6, characters: ["Broly: Br"] }),
};

// ── #731, the reading: every [Swap] description shape the catalog prints ──
{
  const desc = (id: string) => parseFilter(printedDescription(skillsOf(defs[id])[0]));
  // ≪…≫ and the catalog's ASCII "<<…>>" (SD5-04, SD5-05) are one trait.
  for (const id of ["BT4-078", "BT4-079", "SD5-04", "SD5-05"]) {
    const f = desc(id);
    assert.deepEqual([f.traits, f.characters], [["Goku's Lineage"], []], `${id}: ≪Goku's Lineage≫ is a trait, never a character`);
  }
  assert.deepEqual([desc("SD5-04").costMin, desc("SD5-04").costMax], [8, 8]);
  // EX19-31: "Green/Yellow" names a Green/Yellow multicolor card, not either colour.
  const gy = desc("GY731");
  assert.deepEqual([gy.colors, gy.multiColor, gy.characters], [["Green", "Yellow"], true, ["Broly: Br"]]);
  // The other printed shapes, word for word from the catalog (13 Oct 2026).
  const shape = (text: string) => parseFilter(printedDescription({ effect: text, cost: "" }));
  assert.deepEqual(shape("Mono-red <Broly: Br> with an energy cost of 6.").monoColor, true, "BT11-015: mono-colour");
  assert.deepEqual(shape("Yellow <Frieza> with an energy cost of 5 and [swap].").keywords, ["Swap"], "BT21-123: and [Swap]");
  assert.deepEqual(shape("Yellow <Frieza> card with an energy cost of 5 and a [swap] skill.").keywords, ["Swap"], "P-675: and a [Swap] skill");
  assert.deepEqual([shape("Yellow <Son Gohan: Childhood> card with an energy cost of 5 and 20000 power.").powerMin, shape("Yellow <Son Gohan: Childhood> card with an energy cost of 5 and 20000 power.").powerMax], [20000, 20000], "BT26-097: and 20000 power");
  assert.deepEqual(shape("Blue card with an energy cost of 9 and <Beerus> in its character name.").charactersIncluding, ["Beerus"], "BT31-038: <Beerus> in its character name");
  assert.deepEqual(shape("Yellow ≪Master's Teachings≫ with energy cost of 8.").costMin, 8, "BT19-128: \"with energy cost of 8\"");
  assert.deepEqual(shape("Black <Towa> card with an energy cost of 3.").colors, ["Black"], "BT16-116");
  // A name keeps its own slash and colour words: only text outside brackets is rewritten.
  assert.equal(printedDescription({ effect: "{Red/Blue Thing} with an energy cost of 2.", cost: "" }), "{Red/Blue Thing} with an energy cost of 2.");
  assert.equal(printedDescription({ effect: "Red/Blue multicolor card", cost: "" }), "Red/Blue multicolor card", "an already-multicolor slash is left as printed");
}

// ── #729, the reading: BT4-079's price compiles to a price program ────────
{
  const price = compileCard(defs["BT4-079"]).bySkill[0].price;
  assert.equal(price?.condition, null);
  assert.deepEqual(JSON.parse(JSON.stringify(price?.ops)), [
    { op: "choose", sel: { side: "you", area: "hand", count: 1, upTo: false }, as: "c0", reason: "choose 1 card from your hand" },
    { op: "moveTo", target: { var: "c0" }, to: "drop", reveal: true },
  ], "BT4-079: choose 1 card from your hand, then place it in the Drop Area");
  // An orbs-only [Swap] still has no action price.
  assert.equal(compileCard(defs["BT4-078"]).bySkill[0].price?.ops, null);
  // P-594: the restriction is read — and is a family the strict host does not admit.
  assert.equal(compileCard(defs.P594X729).bySkill[0].price?.ops?.[0]?.op, "forbid");
}

const scripts = rulesFromCompiler(defs);
const ctx: EngineContext = { ...CTX, defs, scripts };
const reload = (s: VmState): VmState => JSON.parse(JSON.stringify(s));
function apply(s: VmState, action: Action) { return engine.apply(ctx, reload(s), action) as { state: VmState; events: GameEvent[] }; }
function play(s: VmState, ...actions: Action[]): VmState { for (const action of actions) s = apply(s, action).state; return s; }
const legal = (s: VmState) => engine.legalActions(ctx, s);
const rejected = (s: VmState) => engine.rejectedActions(ctx, s, legal(s));
const offered = (s: VmState, id: string) => legal(s).some((l) => l.action.type === "activate" && l.action.card === id);
const refusal = (s: VmState, id: string): Requirement[] | undefined => rejected(s).find((r) => r.action.type === "activate" && r.action.card === id)?.why;
const activate = (s: VmState, id: string) => apply(s, { type: "activate", player: "p1", card: id, skill: 0 } as Action);
const choose = (s: VmState, ids: string[], player: PlayerId = "p1") => apply(s, { type: "choose", player, cards: ids });
const candidates = (s: VmState) => (s.prompt.kind === "chooseCards" ? [...s.prompt.choice.candidates].sort() : []);
const at = (ev: GameEvent[], test: (e: GameEvent) => boolean) => ev.findIndex(test);
const view = (s: VmState, viewer: PlayerId) => JSON.stringify(buildSnapshot({ id: 729, revision: 1, mode: "versus", engine: "rules", status: "playing",
  p1Name: "Player 1", p2Name: "Player 2", ctx, state: s, legal: [], log: [], beats: null, spotlight: null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, ai: null, viewer, images: {} }));

/** p1's first Main Phase with an empty hand and no energy; `stage` puts a copy of a card where it is wanted. */
function main(seed: number): VmState {
  let s = engine.createGame(ctx, { seed, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  s = play(s, { type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) s = play(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  assert.equal(s.prompt.kind, "main"); assert.equal(s.turnPlayer, "p1");
  for (const id of s.sides.p1.zones.hand.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  for (const id of s.sides.p1.zones.energy.slice()) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  return s;
}
function stage(s: VmState, id: string, area: "battle" | "energy" | "hand" | "drop", p: PlayerId = "p1"): string {
  const physical = s.sides[p].zones.deck[0]; assert.ok(physical);
  s.cards[physical].cardId = id;
  assert.ok(moveCard(s, game, physical, area, { owner: p }).ok);
  return physical;
}
function board(battle: string, energy: string[], hand: string[], seed = 7290) {
  const s = main(seed);
  const swapper = stage(s, battle, "battle");
  energy.forEach((id) => stage(s, id, "energy"));
  return { s, swapper, hand: hand.map((id) => stage(s, id, "hand")) };
}

// ── #731 on the rules engine: offer and resolution read the description ──
{
  // BT4-078 [Swap 3] ≪Goku's Lineage≫: BT4-077 is the specified card; an
  // off-trait cost-3 Battle Card is not; a cost-2 ≪Goku's Lineage≫ is not.
  const a = board("BT4-078", ["YEL729", "YEL729"], ["BT4-077", "OFF731C3", "BT4-084"]);
  assert.ok(offered(a.s, a.swapper), "a specified cost-3 card in hand: offered");
  const d = activate(a.s, a.swapper).state;
  assert.equal(d.prompt.kind, "chooseCards");
  assert.deepEqual(candidates(d), [a.hand[0]], "only BT4-077: not the off-trait cost-3 card, not the cost-2 ≪Goku's Lineage≫");
  const before = JSON.stringify(d);
  assert.throws(() => choose(d, [a.hand[1]]), IllegalAction, "a forged answer naming the off-trait card is refused");
  assert.equal(JSON.stringify(d), before);
  const done = choose(d, [a.hand[0]]).state;
  assert.ok(done.sides.p1.zones.battle.includes(a.hand[0]) && done.sides.p1.zones.hand.includes(a.swapper), "22-22-4: swapped");
}
{
  const a = board("BT4-078", ["YEL729", "YEL729"], ["OFF731C3", "BT4-084"]);
  assert.ok(!offered(a.s, a.swapper), "only off-trait / off-cost cards in hand: not offered (22-22-3)");
  assert.deepEqual(refusal(a.s, a.swapper), [{ kind: "target", reason: "no specified cost-3 Battle Card in your hand" }]);
}
{
  // SD5-05 prints "<<Goku's Lineage>>": the same trait. OFF731C4 (≪Vegeta's
  // Lineage≫) and an Extra with the trait are not specified Battle Cards.
  const a = board("SD5-05", ["YEL729", "YEL729"], ["OFF731C4", "GLEX731"]);
  assert.ok(!offered(a.s, a.swapper), "SD5-05: neither a cost-4 off-trait card nor a ≪Goku's Lineage≫ Extra");
}
{
  // SD5-05 with a cost-4 ≪Goku's Lineage≫ Battle Card.
  const a = board("SD5-05", ["YEL729", "YEL729"], ["OFF731C4", "GL4X731"]);
  assert.ok(offered(a.s, a.swapper), "SD5-05: a cost-4 ≪Goku's Lineage≫ Battle Card is specified by \"<<Goku's Lineage>>\"");
  const d = activate(a.s, a.swapper).state;
  assert.deepEqual(candidates(d), [a.hand[1]]);
}
{
  // EX19-31's line: a Green/Yellow <Broly: Br>, never a mono-green one.
  const a = board("GY731", ["YEL729", "YEL729", "YEL729", "FODDER729"], ["BROLYG731"]);
  assert.ok(!offered(a.s, a.swapper), "a mono-green <Broly: Br> is not a Green/Yellow one");
  const b = board("GY731", ["YEL729", "YEL729", "YEL729", "FODDER729"], ["BROLYG731", "BROLYGY731"]);
  assert.ok(offered(b.s, b.swapper));
  assert.deepEqual(candidates(activate(b.s, b.swapper).state), [b.hand[1]]);
}

// ── #729: BT4-079's action price on the strict host ──────────────────────
// Offered only when the whole price is payable, 22-22-3's reveal included.
{
  const none = board("BT4-079", ["YEL729"], []);
  assert.ok(!offered(none.s, none.swapper), "empty hand: not offered");
  assert.equal(refusal(none.s, none.swapper)?.[0]?.kind, "target", "nothing to reveal (22-22-3)");
  const short = board("BT4-079", [], ["BT4-084", "FODDER729"]);
  assert.ok(!offered(short.s, short.swapper), "no energy: not offered");
  assert.equal(refusal(short.s, short.swapper)?.[0]?.kind, "energy");
  // The only specified card is also the only card that could pay: paying
  // would leave nothing to reveal, so the [Swap] cannot be activated.
  const alone = board("BT4-079", ["YEL729"], ["BT4-084"]);
  assert.ok(!offered(alone.s, alone.swapper), "the price would take the only card to reveal");
  assert.deepEqual(refusal(alone.s, alone.swapper), [{ kind: "other", detail: "its skill cost cannot be paid in full" }]);
  // A forged declaration is refused before anything is paid.
  const before = JSON.stringify(alone.s);
  assert.throws(() => activate(alone.s, alone.swapper), IllegalAction);
  assert.equal(JSON.stringify(alone.s), before);
}
{
  const a = board("BT4-079", ["YEL729"], ["BT4-084", "FODDER729"]);
  const [gohan, fodder] = a.hand;
  assert.ok(offered(a.s, a.swapper), "BT4-079: offered when the energy and a card to pay are there (U4)");
  const declared = activate(a.s, a.swapper);
  const d = declared.state;
  assert.equal(d.prompt.kind, "chooseCards", "the price asks which hand card pays");
  assert.ok(d.programs[0].swapCost, "the stored continuation is on the paying frame");
  assert.equal(d.cards[d.sides.p1.zones.energy[0]].mode, "rest", "the energy half is paid first");
  assert.equal(declared.events.filter((e) => e.type === "skill").length, 0, "nothing is announced while the price is unpaid");
  assert.ok(d.sides.p1.zones.battle.includes(a.swapper), "BT4-079 is still in the Battle Area");
  // BT4-084 is the only card the swap could reveal, so paying with it is no answer.
  assert.deepEqual(candidates(d), [fodder], "the price cannot take the card 22-22-3 must reveal");
  // Both viewer projections: the payer sees the candidate, the opponent does not.
  assert.ok(view(d, "p1").includes("FODDER729"), "the payer sees the hand candidate");
  assert.ok(!view(d, "p2").includes("FODDER729"), "the opponent's view masks it");
  // Wrong actor, the reveal card, an empty answer: refused, unchanged.
  const before = JSON.stringify(d);
  assert.throws(() => choose(d, [fodder], "p2"), IllegalAction, "only the payer answers");
  assert.throws(() => choose(d, [gohan]), IllegalAction, "an answer that leaves nothing to reveal");
  assert.throws(() => choose(d, []), IllegalAction, "the price is not optional");
  assert.equal(JSON.stringify(d), before);
  // Stale: the picked card left the hand since the question was asked.
  const stale = reload(d); assert.ok(moveCard(stale, game, fodder, "deck", { owner: "p1" }).ok);
  const staleBefore = JSON.stringify(stale);
  assert.throws(() => choose(stale, [fodder]), IllegalAction); assert.equal(JSON.stringify(stale), staleBefore);
  // A JSON reload mid-price resolves the same, and charges once.
  const paid = choose(reload(d), [fodder]); const again = choose(reload(d), [fodder]);
  assert.equal(JSON.stringify(again.state), JSON.stringify(paid.state), "a reload at the price resolves the same");
  assert.equal(JSON.stringify(again.events), JSON.stringify(paid.events));
  const p = paid.state;
  assert.ok(p.sides.p1.zones.drop.includes(fodder), "the price paid: the card is in the Drop Area");
  assert.ok(!p.programs.some((f) => f.swapCost), "no payment cursor is left behind");
  const priceAt = at(paid.events, (e) => e.type === "move" && e.card === fodder && e.to === "drop");
  const skillAt = at(paid.events, (e) => e.type === "skill" && e.card === a.swapper);
  assert.ok(priceAt >= 0 && priceAt < skillAt, "price, then the skill (5-8-1)");
  assert.equal(paid.events.filter((e) => e.type === "skill").length, 1, "announced once");
  // 22-22-3: the reveal, offered only the specified card.
  assert.equal(p.prompt.kind, "chooseCards");
  assert.deepEqual(candidates(p), [gohan], "the swap reveals ≪Goku's Lineage≫ with an energy cost of 2");
  assert.ok(view(p, "p1").includes("BT4-084") && p.sides.p1.zones.battle.includes(a.swapper), "the swap has not happened yet");
  const swapped = choose(p, [gohan]);
  const backAt = at(swapped.events, (e) => e.type === "move" && e.card === a.swapper && e.to === "hand");
  const inAt = at(swapped.events, (e) => e.type === "move" && e.card === gohan && e.to === "battle");
  assert.ok(backAt >= 0 && backAt < inAt, "22-22-4: back to the hand, then the specified card is played");
  assert.ok(swapped.state.sides.p1.zones.hand.includes(a.swapper) && swapped.state.sides.p1.zones.battle.includes(gohan));
}
// Two specified cards in hand: either may pay, and the other is then revealed.
{
  // BT4-091 is ≪Goku's Lineage≫ at cost 1: not specified, so it may pay, but
  // the one BT4-084 may not.
  const one = board("BT4-079", ["YEL729"], ["BT4-084", "BT4-091", "FODDER729"]);
  assert.deepEqual(candidates(activate(one.s, one.swapper).state), [one.hand[1], one.hand[2]].sort(), "the cost-1 ≪Goku's Lineage≫ pays like any card");
  const a = board("BT4-079", ["YEL729"], ["BT4-084", "BT4-084", "FODDER729"]);
  const d = activate(a.s, a.swapper).state;
  assert.deepEqual(candidates(d), [...a.hand].sort(), "with a second specified card, any of the three may pay");
  const p = choose(d, [a.hand[0]]).state;
  assert.deepEqual(candidates(p), [a.hand[1]], "the other BT4-084 is then revealed");
}
// 5-8-4: a price that can no longer be paid when its turn comes fails the
// activation: the energy stays spent, no skill, no swap.
{
  const a = board("BT4-079", ["YEL729"], ["BT4-084", "FODDER729"]);
  const d = activate(a.s, a.swapper).state;
  const s = reload(d);
  const frame = s.programs.shift()!; delete frame.awaiting;
  assert.ok(frame.swapCost, "the paying frame");
  for (const id of a.hand) assert.ok(moveCard(s, game, id, "deck", { owner: "p1" }).ok);
  const ev: GameEvent[] = [];
  assert.equal(stepSwapCost(ctx, game, s, ev, frame), "done");
  assert.equal(s.cards[s.sides.p1.zones.energy[0]].mode, "rest", "the paid energy is not refunded");
  assert.equal(ev.filter((e) => e.type === "skill").length, 0);
  assert.ok(ev.some((e) => e.type === "note" && /\[Swap\] activation failed/.test(e.text)));
  assert.ok(s.sides.p1.zones.battle.includes(a.swapper), "no swap");
  assert.ok(!s.programs.some((f) => f.card === a.swapper), "no `DO` is queued");
}
// A price outside the strict host is a typed #729 gap: never offered, never free.
{
  const a = board("P594X729", ["V1", "V1", "V1"], ["BROLYR729"]);
  assert.ok(!offered(a.s, a.swapper));
  const why = refusal(a.s, a.swapper);
  assert.equal(why?.length, 1); assert.equal(why?.[0].kind, "other");
  assert.match((why?.[0] as { detail: string }).detail, /^not yet: .*forbid.*\(#729\)$/);
  const before = JSON.stringify(a.s);
  assert.throws(() => activate(a.s, a.swapper), IllegalAction);
  assert.equal(JSON.stringify(a.s), before, "no energy and no card moved");
}

console.log("#729/#731: [Swap] reveals only the specified card, and BT4-079's action price is paid on the strict host");
