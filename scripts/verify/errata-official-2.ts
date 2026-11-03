/**
 * errata-official-2 (owner's decisions of 2 Nov 2026, R-116 to R-125): the errata errata-official-1 held back, and the
 * machinery the rest needed.
 *
 * 1. The errata layer for what a card *is* (`FIELD_CORRECTIONS`, `SPECIFIED_COST_CORRECTIONS`), applied by the
 *    catalog sync (`shapeCatalog`) and re-checked against the payload; "no colour" as a specified cost (`-`).
 * 2. Deck legality: BT21-068's "All Battle Cards in your deck must be green ≪Android≫" (R-121), a flag.
 * 3. The compiler on the errata's wordings: BT24-096's bare price (R-116), P-493's "you may choose 12 … If you do"
 *    (R-117), BT7-125…129's ban with its condition after it (R-122), BT22-001's placing from the Z-Deck (R-123),
 *    "choose this card or …" (R-124), BT9-076's maximum (R-125), BT20-024's "play battle cards by skills", and
 *    BT11-064's moment left unread.
 * 4. The VM: `orSelf` offers this card beside the cards described; `placeOnTop` takes a Z-Leader from the Z-Deck onto
 *    the Leader, placed and not played; R-117's condition holds only with all 12.
 *
 * Printed text inline: the catalog's text of 2 Nov 2026 through `correctSkillText`.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, card, fifty } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { cardDefFrom } from "../../src/lib/arena/load";
import { parseFilter } from "../../src/lib/arena/text/filters";
import { parseTarget } from "../../src/lib/arena/compile/targets";
import { specifiedCostOf } from "../../src/lib/arena/text/cards";
import { NO_COLOUR, parseSpecifiedCost, printSpecifiedCost, staleSpecifiedCosts } from "../../src/lib/arena/specified-cost";
import { CORRECTIONS, FIELD_CORRECTIONS, SPECIFIED_COST_CORRECTIONS, correctCardFields, correctSkillText, unmatchedCorrections, unmatchedFieldCorrections } from "../../src/lib/catalog/errata";
import { shapeCatalog } from "../../src/lib/catalog/deckplanet";
import { deckBuildingOf } from "../../src/lib/decks/cardRules";
import { legality, type LegalityCard } from "../../src/lib/decks/legality";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { vmHost } from "../../src/lib/arena/vm/host";
import { condHolds, resolveSelector } from "../../src/lib/arena/vm/program";
import type { Cond, Op, ScriptFrame } from "../../src/lib/arena/vm/script";
import type { Action, CardDef, EngineContext, PlayerId } from "../../src/lib/arena/types";
import type { VmState } from "../../src/lib/arena/vm/state";

// ── 1. what a card is ───────────────────────────────────────────────────────────────────────
const printed = (id: string) => ({ name: FIELD_CORRECTIONS[id]?.name?.[0] ?? id, backName: null as string | null, characters: FIELD_CORRECTIONS[id]?.characters?.[0] ?? [id] });
for (const [id, want] of Object.entries({
  "P-642": { name: "Sansyo, Interference" },
  "BT10-144": { characters: ["Vegeta", "Trunks: Future"] },
  "P-144": { characters: ["Evil Wizard Babidi"] },
  "P-075": { characters: ["Black Masked Saiyan"] },
  "BT15-067": { name: "Kaio-Ken Son Goku, Maximum Gains" },
})) {
  const before = printed(id);
  const after = correctCardFields(id, before);
  if ("name" in want) assert.equal(after.name, want.name, `${id}: the official card name`);
  if ("characters" in want) assert.deepEqual(after.characters, want.characters, `${id}: the official character names`);
  assert.deepEqual(correctCardFields(id, after), after, `${id}: applying twice changes nothing`);
  assert.deepEqual(unmatchedFieldCorrections(new Map([[id, before]])), [], `${id}: the printed side matches the feed`);
  assert.equal(unmatchedFieldCorrections(new Map([[id, after]])).length, 1, `${id}: reported once the source is fixed upstream`);
}
assert.deepEqual(correctCardFields("BT15-066", { name: "Son Goku, Maximum Gains", backName: null, characters: ["Son Goku"] }).name, "Son Goku, Maximum Gains", "card-specific: another card keeps its name");
// The sync applies them on the way in, the search text included, and writes the official specified cost.
const raw = (n: string, o: Record<string, unknown>) => ({ id: n.length, card_number: n, card_type: "Battle", card_color: "Red", card_energy_cost: "4", card_rarity: "C", ...o });
const shaped = shapeCatalog([
  raw("P-144", { card_name: "Babidi, the Mastermind", card_character: ["Babidi"] }),
  raw("BT19-140", { card_name: "Black Smoke Dragon, Accumulated Negativity", card_character: ["Black Smoke Dragon"], card_color: "Black", card_energy_cost: "2" }),
  raw("BT15-067", { card_name: "Son Goku, Maximum Gains", card_character: ["Son Goku"], card_color: "Green" }),
] as never, "dbs");
const byId = new Map(shaped.cards.map((c) => [c.id, c]));
assert.deepEqual(byId.get("P-144")!.characters, ["Evil Wizard Babidi"]);
assert.match(byId.get("P-144")!.searchText, /evil wizard babidi/);
assert.equal(byId.get("BT15-067")!.name, "Kaio-Ken Son Goku, Maximum Gains");
assert.equal(byId.get("BT19-140")!.specifiedCost, "-");
assert.equal(byId.get("P-144")!.specifiedCost, undefined, "no official specified cost: the column keeps what was entered");
// BT15-068's corrected text names BT15-067 by that name.
assert.equal(correctSkillText("BT15-068", "Play up to 1 {Son Goku, Maximum Gains} from your deck"), "Play up to 1 {Kaio-Ken Son Goku, Maximum Gains} from your deck");
// "No colour" (R-120): `-` parses as no orbs at all — a fact, not an unknown — prints back, and is never stale for BT19-140.
assert.equal(SPECIFIED_COST_CORRECTIONS["BT19-140"], NO_COLOUR);
assert.deepEqual(parseSpecifiedCost("-"), {});
assert.equal(printSpecifiedCost({}), "-");
assert.equal(parseSpecifiedCost(""), null, "an empty box is still unknown");
assert.deepEqual(staleSpecifiedCosts([{ id: "BT19-140", energyCost: "2", skill: null, specifiedCost: "-" }]), [], "the official entry is not stale");
assert.equal(staleSpecifiedCosts([{ id: "OTHER-1", energyCost: "2", skill: null, specifiedCost: "-" }]).length, 1, "the same entry by hand on a fixed cost still is");
const row140 = { id: "BT19-140", name: "Black Smoke Dragon", cardType: "BATTLE", colors: ["Black"], energyCost: "2", specifiedCost: "-", zEnergyCost: null, power: 15000, comboCost: 0, comboPower: 5000, skill: null, characters: [], traits: [], backName: null, backPower: null, backSkill: null, game: "dbs" };
assert.deepEqual(specifiedCostOf(cardDefFrom(row140 as never)), {}, "BT19-140 charges no colour");
assert.deepEqual(specifiedCostOf(cardDefFrom({ ...row140, specifiedCost: null } as never)), { Black: 1 }, "…where the fixed-cost convention charged one black orb");

// ── 2. deck legality (R-121) ───────────────────────────────────────────────────────────────
const BT21_068 = correctSkillText("BT21-068", "[Auto] When this card is placed in your Leader Area, place up to 1 {Gingertown} from your deck in your opponent's Battle Area.<br>[Activate: Main] Switch this card to Rest Mode and place 1 green ≪Android≫ from your hand at the bottom of your deck: Draw 2 cards.")!;
assert.match(BT21_068, /^\[Permanent\] All Battle Cards in your deck must be green ≪Android≫\.<br>\[Auto\]/);
const deckRule = deckBuildingOf(BT21_068);
assert.deepEqual(deckRule.unread, []);
assert.equal(deckRule.rules.length, 1);
assert.ok(deckRule.rules[0].kind === "exclude" && deckRule.rules[0].filters.length === 2, "one filter per measure: not green, not ≪Android≫");
const lrow = (cardId: string, zone: string, o: Partial<LegalityCard> = {}): LegalityCard => ({ cardId, zone, quantity: 1, name: cardId, cardType: "BATTLE", colors: ["Green"], limitedTo: null, isBanned: false, traits: ["Android"], energyCost: "2", ...o });
const legal = legality([
  lrow("BT21-068", "leader", { cardType: "LEADER", skill: BT21_068, traits: ["Android"] }),
  lrow("GREEN-DROID", "main"),
  lrow("RED-DROID", "main", { colors: ["Red"] }),
  lrow("GREEN-HUMAN", "main", { traits: ["Earthling"] }),
  lrow("GREEN-EXTRA", "main", { cardType: "EXTRA", traits: [] }),
], "dbs");
assert.ok(legal.flags["main:RED-DROID"], "a red ≪Android≫ is flagged");
assert.ok(legal.flags["main:GREEN-HUMAN"], "a green non-≪Android≫ is flagged");
assert.ok(!legal.flags["main:GREEN-DROID"], "a green ≪Android≫ is not");
assert.ok(!legal.flags["main:GREEN-EXTRA"], "an Extra is not restricted");
// Not an unread clause in the arena either: a deck-building line reads nothing, on purpose.
assert.deepEqual(skillRecords(card("BT21068", { type: "LEADER", colors: ["Green"], skill: BT21_068 }))[0].unread, []);

// ── 3. the compiler ──────────────────────────────────────────────────────────────────────────
const recs = (id: string, text: string, o: Partial<CardDef> = {}) => skillRecords(card(id, { skill: text, ...o }));
// R-116: BT24-096's erratum is R-010's price.
const BT24_096 = correctSkillText("BT24-096", "[activate: main][limit 1]{y}{y}, if you switch 5 yellow cards to Rest Mode: Draw 1 card and play this card from your hand.")!;
assert.match(BT24_096, /\{y\}\{y\}, switch 5 of your yellow cards to Rest Mode:/);
{
  const price = recs("BT24096", BT24_096, { colors: ["Yellow"] })[0].cost!.program!;
  const pick = price[0] as Extract<Op, { op: "choose" }>;
  assert.deepEqual(pick.sel.areas, ["play", "energy"], "R-116: in play or in the energy");
  assert.ok(pick.sel.count === 5 && !pick.sel.upTo && pick.sel.mode === "active" && pick.sel.filter?.colors.join() === "Yellow", "R-116: exactly 5 Active Mode yellow cards");
  assert.deepEqual(price[1], { op: "switchMode", target: { var: pick.as }, mode: "rest" });
}
// R-117: P-493 asks the offer and all 12.
const P_493 = correctSkillText("P-493", "[auto] When this card is played, choose up to 12 of your opponent's Battle Cards with ≪God≫ or ≪Universe≫ in their special traits, ignoring [barrier], negate their [indestructible] skills, and remove them from the game.")!;
const p493 = recs("P493", P_493)[0];
assert.deepEqual(p493.unread, []);
const mayOp = p493.ops[0] as Extract<Op, { op: "may" }>;
assert.equal(mayOp.op, "may");
const chosen = (mayOp.ops[0] as Extract<Op, { op: "choose" }>);
assert.ok(chosen.sel.count === 12 && !chosen.sel.upTo, "a choice of 12, not up to 12");
const ifDone = p493.ops[1] as Extract<Op, { op: "if" }>;
assert.deepEqual(ifDone.cond, { kind: "all", conds: [{ kind: "did", what: "may" }, { kind: "chose", var: chosen.as, atLeast: 12 }] }, "R-117: the offer taken and all 12 chosen");
// …only where the offer is the choice alone: an offer that acts keeps asking the offer (EX13-34's shape).
const acting = recs("ACT", "[Counter: Attack] Negate the attack. You may send 4 cards from your Drop Area to your Warp. If you do, return this card to your hand.", { type: "EXTRA" })[0];
assert.ok(!JSON.stringify(acting.ops).includes('"atLeast":4'), "an offer that acts is asked about its action, not its count");
// R-122: the BT7 bans keep their condition, with the erratum's measure.
for (const [id, colour] of [["BT7-125", "red"], ["BT7-126", "blue"], ["BT7-127", "green"], ["BT7-128", "yellow"], ["BT7-129", "black"]] as const) {
  const before = `[Permanent] If you have any non-${colour} cards in areas other than your deck, hand, or life, you can't play this card from any area.`;
  const text = correctSkillText(id, before)!;
  assert.equal(text, `[Permanent] You can't play this card from any area if you have cards in areas other than your deck, hand, or life that are any color other than ${colour}.`, `${id}: the erratum's wording`);
  const rec = recs(id.replace("-", ""), text)[0];
  assert.deepEqual(rec.unread, [], `${id}: read whole`);
  assert.equal(rec.cond?.kind, "count", `${id}: the ban has its condition`);
  const f = (rec.cond as Extract<Cond, { kind: "count" }>).sel.filter!;
  const cap = colour.charAt(0).toUpperCase() + colour.slice(1);
  assert.deepEqual(f.anyOf?.map((a) => [a.notColors, a.multiColor]), [[[cap], false], [[], true]], `${id}: a non-${colour} card, or a multicolour one`);
  assert.equal((rec.ops[0] as { op: string; what: string }).what, "play");
}
assert.deepEqual(recs("BAN", "[Permanent] You can't play this card from any area if the moon is full.")[0].ops.filter((o) => o.op === "forbid"), [], "a ban with a condition it cannot read is not read as a ban that always holds");
// R-123: BT22-001's back places a Z-Leader from the Z-Deck on top of this card.
const BT22_001B = correctSkillText("BT22-001", "[Auto][Once per turn] When your {Piccolo, Power Beyond Awakening} activates a [Blocker] skill or is removed from a Battle Area by an opponent's skill, at the end of the turn, add cards from your life to your hand until you have 4 life left, and play up to 1 red &lt;Son Gohan: SH&gt; Z-Leader from your Z-Deck on top of this card.")!;
assert.match(BT22_001B, /and place up to 1 red &lt;Son Gohan: SH&gt; Z-Leader from your Z-Deck on top of this card\.$/);
{
  const ops = JSON.stringify(recs("BT22001", BT22_001B, { type: "LEADER" })[0].ops);
  assert.match(ops, /"op":"choose","sel":\{"side":"you","area":"zDeck"/);
  assert.match(ops, /"op":"placeOnTop","target":\{"var":"[^"]+"\}\}/, "placed on top of this card, not played");
  assert.doesNotMatch(ops, /"to":"under"/, "this Leader is not moved under the Z-Deck card");
}
assert.equal(recs("UNDERHAND", "[Activate: Main] Place 1 card from your hand on top of this card.")[0].ops.length, 0, "a card in the hand is no stack to put this card under: refused");
// R-124: "choose this card or …" is one choice among this card and the cards described.
const P_092B = correctSkillText("P-092", "[Activate: Main][Once per turn] Choose 1 card from your life and add it to your hand: Choose up to 1 of your cards in Rest Mode and switch it to Active Mode.")!;
assert.match(P_092B, /Choose this card or up to 1 &lt;Broly: Br&gt; card in your Battle Area and switch it to Active Mode\.$/);
{
  const pick = recs("P092", P_092B, { type: "LEADER" })[0].ops[0] as Extract<Op, { op: "choose" }>;
  assert.ok(pick.sel.orSelf && pick.sel.area === "battle" && pick.sel.count === 1 && pick.sel.upTo, "this card, or up to 1 <Broly: Br> in the Battle Area");
  assert.deepEqual(pick.sel.filter?.characters, ["Broly: Br"]);
  const bt1 = recs("BT1001", "[Activate: Main][Once per turn] Choose this card or 1 of your Battle Cards. It gains +5000 power for the duration of the turn.", { type: "LEADER" })[0].ops[0] as Extract<Op, { op: "choose" }>;
  assert.ok(bt1.sel.orSelf && bt1.sel.count === 1 && !bt1.sel.upTo, "BT1-001's back: exactly one of them");
}
// R-125: BT9-076's maximum.
const BT9_076 = correctSkillText("BT9-076", "[Auto] If all of your energy is black: When you combo with this card from your hand, this card gets +1000 combo power for the duration of the turn for each card in your Drop Area and Warp.")!;
{
  const op = recs("BT9076", BT9_076, { colors: ["Black"] })[0].ops[0] as { op: string; amount: { capped?: [{ count: unknown; times?: number }, number] } };
  assert.equal(op.op, "comboPower");
  assert.equal(op.amount.capped?.[1], 12000, "R-125: 12 cards at most, +12000");
  assert.equal(op.amount.capped?.[0].times, 1000);
}
// BT20-024's erratum is the rule the old wording was; BT11-064's narrower moment is left unread.
{
  const BT20_024 = correctSkillText("BT20-024", "[Permanent] During your turn, you can't use skills to play Battle Cards.")!;
  const rec = recs("BT20024", BT20_024, { type: "LEADER" })[0];
  assert.deepEqual(rec.unread, []);
  assert.match(JSON.stringify(rec.ops), /"what":"play"[^}]*"bySkill":true/);
  const BT11_064 = correctSkillText("BT11-064", "[Auto][Once per turn] When a marker is removed from this card by a skill, your opponent chooses 1 card from their hand and discards it.")!;
  assert.match(BT11_064, /by a non-keyword skill/);
  assert.deepEqual(recs("BT11064", BT11_064, { type: "UNISON" })[0].trigger, [], "no moment read: an [Auto] the engine refuses, not one that fires on every removal");
}
// The filter on its own.
assert.deepEqual(parseFilter("cards with a color other than green").anyOf?.map((a) => [a.notColors, a.multiColor]), [[["Green"], false], [[], true]]);
assert.ok(CORRECTIONS["BT7-125"] && CORRECTIONS["BT22-001"] && CORRECTIONS["BT24-096"] && CORRECTIONS["BT15-068"]);
assert.deepEqual(unmatchedCorrections(new Map([["BT15-068", ["{Son Goku, Maximum Gains}"]]])), []);

// ── 4. the VM ───────────────────────────────────────────────────────────────────────────────
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;
const defs: Record<string, CardDef> = {
  ...DEFS,
  BROLY2: card("BROLY2", { characters: ["Broly: Br"] }),
  OTHER2: card("OTHER2", { characters: ["Paragus: Br"] }),
  GOHANZ2: card("GOHANZ2", { type: "Z-LEADER", colors: ["Red"], characters: ["Son Gohan: SH"], energyCost: null, comboCost: null, comboPower: null, skill: null }),
  GOD2: card("GOD2", { traits: ["God"] }),
};
const ctx: EngineContext = { ...CTX, defs };
const roundtrip = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
function board(seed: number): VmState {
  let s = RULES.createGame(ctx, { seed, p1: { name: "One", leader: "L-RED", main: fifty("V1") }, p2: { name: "Two", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const step = (a: Action) => { s = RULES.apply(ctx, roundtrip(s), a).state as VmState; };
  step({ type: "chooseFirst", player: s.chooser, first: "p1" });
  for (let i = 0; i < 24 && s.prompt.kind !== "main"; i++) step({ type: "pass", player: (s.prompt as { player: PlayerId }).player });
  return s;
}
function stage(s: VmState, p: PlayerId, def: string, area: string): string {
  const id = s.sides[p].zones.deck[0];
  s.cards[id].cardId = def;
  assert.ok(moveCard(s, game, id, area, { owner: p }).ok, `${def} to ${area}`);
  if (area === "battle") s.cards[id].mode = "active";
  return id;
}
const frameOf = (s: VmState, p: PlayerId, vars: Record<string, string[]> = {}, did?: Record<string, boolean>) =>
  ({ ops: [], ip: 0, vars, card: s.sides[p].zones.leader[0], master: p, ...(did ? { did } : {}) }) as unknown as ScriptFrame;
{
  // R-124: this card (the Leader) and the <Broly: Br> in the Battle Area are on offer; another card is not.
  const s = board(1241);
  const broly = stage(s, "p1", "BROLY2", "battle");
  const paragus = stage(s, "p1", "OTHER2", "battle");
  const sel = parseTarget("this card or up to 1 <Broly: Br> card in your Battle Area")!;
  const offered = resolveSelector(ctx, game, s, frameOf(s, "p1"), sel);
  assert.deepEqual([...offered].sort(), [s.sides.p1.zones.leader[0], broly].sort(), "this card and the <Broly: Br>");
  assert.ok(!offered.includes(paragus));
}
{
  // R-123: a Z-Leader from the Z-Deck goes on top of the Leader — placed, the old Leader under it.
  const s = board(1242);
  const leader = s.sides.p1.zones.leader[0];
  const z = stage(s, "p1", "GOHANZ2", "zDeck");
  const ev: unknown[] = [];
  assert.equal(vmHost(ctx, game, s, ev as never).placeOnTop(z, leader), true);
  assert.deepEqual(s.sides.p1.zones.leader, [z], "the Z-Leader is the Leader now");
  assert.ok(s.cards[z].under.includes(leader), "the old Leader is under it");
  assert.ok(!s.sides.p1.zones.zDeck.includes(z));
  assert.ok(!JSON.stringify(ev).includes('"asPlay":true'), "placed, not played");
  // A card that is not a Leader card is not taken from the Z-Deck onto the Leader.
  const s2 = board(1243);
  const other2 = stage(s2, "p1", "BROLY2", "zDeck");
  assert.equal(vmHost(ctx, game, s2, [] as never).placeOnTop(other2, s2.sides.p1.zones.leader[0]), false);
}
{
  // R-117: "if you do" after the offer of 12 holds only with all 12 chosen.
  const s = board(1244);
  const gods = Array.from({ length: 12 }, () => stage(s, "p2", "GOD2", "battle"));
  const cond = ifDone.cond;
  const v = chosen.as;
  assert.equal(condHolds(ctx, game, s, frameOf(s, "p1", { [v]: gods }, { may: true }), cond), true, "12 chosen: it holds");
  assert.equal(condHolds(ctx, game, s, frameOf(s, "p1", { [v]: gods.slice(0, 3) }, { may: true }), cond), false, "3 chosen (all there were): it does not");
  assert.equal(condHolds(ctx, game, s, frameOf(s, "p1", { [v]: gods }), cond), false, "the offer declined: it does not");
}

console.log("errata-official-2: identity errata (names, characters, BT19-140's no-colour cost) through the sync, BT21-068's deck rule flagged, the held errata read (R-116 price, R-117 all 12, R-122 bans, R-123 Z-Deck placing, R-124 this card or, R-125 maximum), BT20-024 and BT11-064, orSelf/placeOnTop/R-117 in the VM — passed");
