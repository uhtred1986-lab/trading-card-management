/**
 * #979 and #980 (stale-row triage of 17 Oct 2026, #907): four wordings the
 * compiler used to leave unread, or read with a measure dropped.
 *
 *  - "an energy cost less than or equal to your current energy" (BT12-030, TB3-046,
 *    EX03-12 …) is a bound on the master's energy count *when the skill resolves*:
 *    equal is allowed, one over is not, and it is the master's count even when the
 *    cards chosen are the opponent's.
 *  - the Desire family's "choose 1 red or black ≪Desire≫ card in your hand with … and
 *    activate its [Activate: Main] skill" (BT5-002 …): the hand Extra's real Main
 *    line, its printed price waived (12-2-4), with the colours and the energy bound
 *    kept.
 *  - a search that offers "a Unison Card with a specified cost of 4 **or** 1 yellow
 *    Battle Card with an energy cost of 1" (BT10-114 …): either description, each
 *    with its own words — and the aside "―both green and with an energy cost of 4 or
 *    less―" belongs to the description it follows.
 *  - "with no specified cost" and "with N marker(s) on it" (BT12-139, P-288, BT28-148 …):
 *    the card arrives with those markers (13-2-3); until now they were dropped.
 *
 * Rules engine only; nothing reads the database. The readings are the catalog's
 * deckplanet text of 17 Oct 2026, abridged to the clause that matters.
 */
import assert from "node:assert/strict";
import { compileSkill } from "../../src/lib/arena/compile";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { matches, parseFilter, specifiedCostNone } from "../../src/lib/arena/text/filters";
import { parseTarget } from "../../src/lib/arena/compile/targets";
import { describeScript, validateProgram } from "../../src/lib/arena/vm/script";
import { RULES } from "../../src/lib/arena/vm";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { moveCard } from "../../src/lib/arena/vm/zones";
import type { Op } from "../../src/lib/arena/vm/script";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { Action, CardDef, PlayerId } from "../../src/lib/arena/types";
import { CTX, DEFS, card, fifty, rulesFromCompiler } from "./harness";

const compile = (text: string, index = 0) => compileSkill(parseSkills(text)[index]!);
const opsOf = (text: string): Op[] => compile(text).ops;

// ── the readings ────────────────────────────────────────────────────────────
{
  // #979: the measure, its spellings, and the area it must not be mistaken for.
  for (const said of ["with an energy cost less than or equal to your current energy", "with an energy cost less than or equal to your energy", "with an energy cost equal to or less than your energy"]) {
    const f = parseFilter(`Battle Card ${said}`);
    assert.deepEqual([f.unreadable, f.costAtMostEnergy, f.type], [false, true, "BATTLE"], said);
  }
  const sel = parseTarget("up to 1 of your opponent's Battle Cards with an energy cost equal to or less than your energy");
  assert.deepEqual([sel?.side, sel?.area, sel?.filter?.costAtMostEnergy], ["opponent", "battle", true], "'your energy' at the end of the bound is not the Energy Area (EX03-12)");
  assert.equal(parseTarget("1 green Battle Card in your Drop Area with an energy cost less than or equal to your current energy")?.area, "drop");
  assert.equal(parseFilter("Battle Card with an energy cost less than or equal to their current energy").costAtMostEnergy, false, "another player's count is not the master's");
  assert.equal(compile("[Activate: Main] Play up to 1 blue skill-less Battle Card from your Drop Area with an energy cost less than or equal to your current energy.").unsupported.length, 0, "BT12-030");
  assert.equal(compile("[Activate: Main] If your Leader is a red ≪Red Ribbon Army≫ card: Play up to 1 red <Gamma 1: SH> card with an energy cost less than or equal to your energy from your hand in Rest Mode.").unsupported.length, 0, "BT22-008");
  assert.equal(compile("[Auto] When you play this card, you may choose 1 card in your life and add it to your hand. If you do so, choose up to 1 of your opponent's Battle Cards with an energy cost equal to or less than your energy and KO it.").unsupported.length, 0, "EX03-12");
  // Two descriptions share one bound only when the text says it does; an "or" between them is refused.
  assert.equal(parseTarget("1 red <A> card or 1 blue <B> card in your hand with an energy cost less than or equal to your current energy"), null);

  // The Desire family: both spellings, the colours and the bound kept; anything else stays unread.
  const two = opsOf("[Activate: Main] Choose 1 red or black ≪Desire≫ card in your hand with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill.");
  const one = opsOf("[Activate: Main] Activate the [Activate: Main] skill of up to 1 red or black ≪Desire≫ from your hand with an energy cost less than or equal to your current energy.");
  for (const ops of [two, one]) {
    assert.deepEqual(ops.map((o) => o.op), ["invokeSkill"]);
    const op = ops[0] as Extract<Op, { op: "invokeSkill" }>;
    assert.ok("sel" in op && op.skillKind === "activate:main" && op.from === "hand");
    assert.deepEqual(op.sel && [op.sel.filter?.colors, op.sel.filter?.traits, op.sel.filter?.costAtMostEnergy, op.sel.count], [["Red", "Black"], ["Desire"], true, 1]);
    assert.equal(validateProgram(ops), true, "the stored form validates");
  }
  assert.equal(((two[0] as { sel: { upTo?: boolean } }).sel.upTo ?? false), false, "'choose 1' is not optional");
  assert.equal(((one[0] as { sel: { upTo?: boolean } }).sel.upTo ?? false), true, "'up to 1' is");
  assert.ok(compile("[Activate: Main] Choose 1 red or black ≪Desire≫ card in your hand with an energy cost less than or equal to your current energy and activate its [Activate: Battle] skill.").unsupported.length > 0, "another skill kind stays unread");
  assert.ok(compile("[Activate: Main] Choose 1 red or black ≪Desire≫ card in your Drop Area with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill.").unsupported.length > 0, "another area stays unread");
  // SD7-01's bare form keeps its own spelling (stored rows are untouched).
  const sd7 = opsOf("[Activate: Main][Once per turn] Choose one — ・Draw 1 card. ・Choose 1 ≪Desire≫ card in your hand with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill.");
  assert.ok(JSON.stringify(sd7).includes('"trait":"Desire"') && JSON.stringify(sd7).includes('"maxCost":"currentEnergy"'));

  // #980: the alternation, each branch with its own words.
  const search = (said: string) => parseFilter(said);
  const branches = (f: ReturnType<typeof parseFilter>) => {
    assert.equal(f.unreadable, false);
    assert.equal(f.anyOf?.length, 2, "two descriptions");
    return f.anyOf!;
  };
  const uni = (id: string, over: Partial<CardDef>) => card(id, { type: "UNISON", energyCost: null, comboCost: null, comboPower: null, power: 10000, skill: null, ...over });
  {
    // BT10-114: "a yellow Unison with a specified cost of 4 or 1 yellow Battle Card with an energy cost of 1".
    const f = search("yellow Unison Card with a specified cost of 4 or 1 yellow Battle Card with an energy cost of 1");
    branches(f);
    assert.equal(matches(uni("U4", { colors: ["Yellow"], specifiedCost: { Yellow: 4 } }), f), true, "the Unison branch");
    assert.equal(matches(card("B1", { colors: ["Yellow"], energyCost: 1 }), f), true, "the Battle Card branch");
    assert.equal(matches(uni("U3", { colors: ["Yellow"], specifiedCost: { Yellow: 3 } }), f), false, "a Unison of another cost");
    assert.equal(matches(card("B2", { colors: ["Yellow"], energyCost: 2 }), f), false, "a Battle Card of another cost");
    assert.equal(matches(card("B1R", { colors: ["Red"], energyCost: 1 }), f), false, "the colour belongs to both descriptions");
    assert.equal(matches(uni("UX", { colors: ["Yellow"], energyCost: "X" }), f), false, "a Unison whose cost nobody entered is unknown, not 4");
  }
  {
    // BT14-040: names, cost, "or 1 blue Unison with a specified cost of 3" — the names' own "or" stays inside the first.
    const f = search("blue ≪Saiyan≫ or ≪Earthling≫ card with an energy cost of 3 or less or 1 blue Unison Card with a specified cost of 3");
    branches(f);
    assert.equal(matches(card("SAIYAN3", { colors: ["Blue"], traits: ["Saiyan"], energyCost: 3 }), f), true);
    assert.equal(matches(card("EARTH2", { colors: ["Blue"], traits: ["Earthling"], energyCost: 2 }), f), true, "either trait");
    assert.equal(matches(card("SAIYAN4", { colors: ["Blue"], traits: ["Saiyan"], energyCost: 4 }), f), false);
    assert.equal(matches(card("SAIYANRED", { colors: ["Red"], traits: ["Saiyan"], energyCost: 1 }), f), false);
    assert.equal(matches(uni("U3B", { colors: ["Blue"], specifiedCost: { Blue: 3 } }), f), true);
    assert.equal(matches(uni("U3BS", { colors: ["Blue"], traits: ["Saiyan"], specifiedCost: { Blue: 3 } }), f), true, "the Unison needs only its own description");
    assert.equal(matches(uni("U2B", { colors: ["Blue"], specifiedCost: { Blue: 2 } }), f), false);
  }
  {
    // BT18-083 and SD18-01: "―both green and with an energy cost of 4 or less―" belongs to the names before it.
    const f = search("≪Namekian≫ or ≪Demon Clan≫ card―both green and with an energy cost of 4 or less―or 1 green Unison with a specified cost of 2");
    branches(f);
    assert.equal(matches(card("NAMEK4G", { colors: ["Green"], traits: ["Namekian"], energyCost: 4 }), f), true);
    assert.equal(matches(card("NAMEK4R", { colors: ["Red"], traits: ["Namekian"], energyCost: 4 }), f), false, "'both green' covers the names");
    assert.equal(matches(uni("U2G", { colors: ["Green"], specifiedCost: { Green: 2 } }), f), true);
    assert.equal(matches(uni("U2Gnamek", { colors: ["Green"], traits: ["Namekian"], specifiedCost: { Green: 2 } }), f), true);
    assert.equal(matches(uni("U2R", { colors: ["Red"], specifiedCost: { Red: 2 } }), f), false, "and the Unison is green by its own words");
    // BT28-060: the Unison first, the aside after the names.
    const g = search("green Unison with a specified cost of 2 or up to 1 ≪Saiyan≫ or ≪Earthling≫ card -- both green and with an energy cost of 4 or less --");
    branches(g);
    assert.equal(matches(uni("U2Gb", { colors: ["Green"], specifiedCost: { Green: 2 } }), g), true, "BT28-060: the Unison branch, first");
    assert.equal(matches(card("EARTH4G", { colors: ["Green"], traits: ["Earthling"], energyCost: 4 }), g), true, "…and the names after it, with the aside");
    assert.equal(matches(card("EARTH4R", { colors: ["Red"], traits: ["Earthling"], energyCost: 4 }), g), false);
    const sd20 = search("<Son Goku: Childhood> or <Bulma> card?both yellow?or 1 yellow Unison with a specified cost of 1");
    branches(sd20);
    assert.equal(matches(card("BULMA", { colors: ["Yellow"], characters: ["Bulma"], energyCost: 5 }), sd20), true, "SD20-05: the feed's '?' for a dash");
    assert.equal(matches(card("BULMAR", { colors: ["Red"], characters: ["Bulma"], energyCost: 5 }), sd20), false);
  }
  {
    // DB3-074: a list of names, then "or green Unison Card with a specified cost of 1".
    const f = search("<Hirudegarn>, <Tapion>, <Minotia>, or green Unison Card with a specified cost of 1");
    branches(f);
    assert.equal(matches(card("TAPION", { colors: ["Red"], characters: ["Tapion"] }), f), true, "a named card of any colour");
    assert.equal(matches(uni("U1G", { colors: ["Green"], specifiedCost: { Green: 1 } }), f), true);
    assert.equal(matches(uni("U1R", { colors: ["Red"], specifiedCost: { Red: 1 } }), f), false);
  }
  // BT31-051 prints "a specified of 2", with no "cost": a bound that cannot be read is refused, not dropped.
  assert.equal(parseFilter("mono-green <Son Goku: GT> or <Gogeta: GT> card or Unison with a specified of 2").unreadable, true);
  assert.equal(compile("[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 blue ≪Saiyan≫ or ≪Earthling≫ card with an energy cost of 3 or less or 1 blue Unison Card with a specified cost of 3 among them to your hand, then shuffle your deck.").unsupported.length, 0, "BT14-040 reads whole");
  {
    // BT14-007 and a dozen more print a comma before the "or" ("…cost of 4 or less, or 1 red Unison Card …"):
    // the clause used to be cut there, and neither half could be read.
    const r = compile("[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 red ≪Universe 7≫ card with an energy cost of 4 or less, or 1 red Unison Card with a specified cost of 2 among them to your hand, then shuffle your deck.");
    assert.equal(r.unsupported.length, 0, "BT14-007: the comma before the second description does not cut the search");
    assert.equal(/"anyOf"/.test(JSON.stringify(r.ops)), true, "…and it reads as two descriptions");
    // A named card after the comma is not a description eitherFilter can split: it stays unread rather than being ANDed in (BT17-054).
    assert.equal(compile("[Auto] When this card is played, look at up to 5 cards from the top of your deck, add up to 1 blue ≪Red Ribbon Army≫ card with an energy cost of 5 or less, or 1 {Android 17 & Android 18, Teaming Up} among them to your hand, then shuffle your deck.").unsupported.length > 0, true, "BT17-054 stays unread");
  }

  // The null specified cost.
  const none = parseFilter("black Unison Card with no specified cost and 15000 power");
  assert.deepEqual([none.unreadable, none.specifiedCostNone, none.powerMin, none.powerMax, none.type], [false, true, 15000, 15000, "UNISON"]);
  assert.equal(parseFilter("≪Agent of Destruction≫ cards in your hand as if they had no specified cost").unreadable, true, "'treat as if it had no specified cost' is a sentence, not a measure");
  assert.equal(matches(uni("NOCOST", { colors: ["Black"], power: 15000 }), none), true);
  assert.equal(matches(uni("NOCOST20", { colors: ["Black"], power: 20000 }), none), false);
  assert.equal(matches(uni("STORED", { colors: ["Black"], power: 15000, specifiedCost: { Black: 2 } }), none), false, "orbs the owner entered are a cost");
  assert.equal(matches(uni("UNENTERED", { colors: ["Black"], power: 15000, energyCost: "X" }), none), false, "an X cost nobody entered is unknown, not 'none'");
  assert.equal(specifiedCostNone(uni("N", {})), true);
  assert.equal(specifiedCostNone(card("B3", { energyCost: 3, colors: ["Red"] })), false);
}

// ── markers on arrival ──────────────────────────────────────────────────────
{
  /** Every play op in a program, however deep (an "if", a mode of a "choose one"). */
  const playOf = (text: string): Extract<Op, { op: "play" }>[] => {
    const found: Extract<Op, { op: "play" }>[] = [];
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        if ((v as { op?: string }).op === "play") found.push(v as Extract<Op, { op: "play" }>);
        Object.values(v).forEach(walk);
      }
    };
    walk(opsOf(text));
    return found;
  };
  const cases: [string, string, number | undefined][] = [
    ["BT12-139", "[Auto] When this card is played, draw 1 card; if you don't have a Unison Card in play, play 1 black Unison Card with no specified cost and 15000 power from your Drop Area with a marker on it; you can't play copies of this card for the turn.", 1],
    ["BT16-098b", "[Activate: Main] Play up to 1 black Unison Card with no specified cost and 20000 power from your Drop Area with a marker on it in Rest Mode.", 1],
    ["BT28-148", "[Auto] When this card is played, draw 2 cards, play up to 1 blue Unison with a specified cost of 2 and 3 markers on it from your Drop, then choose all of your opponent's Battle Cards, ignoring [Barrier], and place them at the bottom of their owner's deck in any order.", 3],
    ["BT28-039", "[Auto] When this card is played, choose one -- ・Draw 1 card ・Play up to 1 mono-blue Unison with a specified cost of 2 and 1 marker on it from your deck or hand, then shuffle your deck.", 1],
    ["P-288", "[Activate: Main] If you don't have a Unison Card in play, choose 1 black Unison Card with no specified cost and 15000 power in your hand or Warp and play it with a marker on it.", 1],
    ["BT12-057", "[Activate: Main] If your Leader Card is green: Play this card from your hand with a marker on it.", 1],
    ["no markers said", "[Activate: Main] Play up to 1 black Unison Card with no specified cost and 15000 power from your Drop Area.", undefined],
  ];
  for (const [id, text, markers] of cases) {
    assert.deepEqual(compile(text).unsupported, [], `${id} reads whole`);
    const plays = playOf(text);
    assert.equal(plays.length, 1, `${id}: one play`);
    assert.equal(plays[0].markers, markers, `${id}: markers on arrival`);
    if (markers !== undefined) assert.match(describeScript(compile(text).ops), new RegExp(`with ${markers} marker${markers === 1 ? "" : "s"} on it`), `${id}: the reading says it`);
  }
  // The clause is no longer cut at "and 3 markers on it", which counted the 3 as a number of cards.
  const cut = compile("[Auto] When this card is played, play up to 1 blue Unison with a specified cost of 2 and 3 markers on it from your Drop.");
  assert.equal((cut.ops.find((o) => o.op === "choose") as { sel: { count?: number; area?: string } }).sel.count, 1);
  assert.equal((cut.ops.find((o) => o.op === "choose") as { sel: { count?: number; area?: string } }).sel.area, "drop");
}

// ── in a game ───────────────────────────────────────────────────────────────
const WISH_LEADER = "[Activate: Main] Choose 1 red or black ≪Desire≫ card in your hand with an energy cost less than or equal to your current energy and activate its [Activate: Main] skill.";
const BOUND_LEADER = "[Activate: Main] Play up to 1 blue skill-less Battle Card from your Drop Area with an energy cost less than or equal to your current energy.";
const KO_LEADER = "[Activate: Main] Choose up to 1 of your opponent's Battle Cards with an energy cost equal to or less than your energy and KO it.";
const UNISON_LEADER = "[Activate: Main] Play up to 1 black Unison Card with no specified cost and 15000 power from your Drop Area with a marker on it.";
const UNISON3_LEADER = "[Activate: Main] Play up to 1 blue Unison with a specified cost of 2 and 3 markers on it from your Drop.";
const DESIRE_SKILL = "[Activate: Main] {r}{1}: Draw 1 card.";
const unison = (id: string, over: Partial<CardDef>) => card(id, { type: "UNISON", energyCost: null, comboCost: null, comboPower: null, power: 15000, skill: null, ...over });
const extra = (id: string, over: Partial<CardDef>) => card(id, { type: "EXTRA", power: null, comboCost: null, comboPower: null, skill: DESIRE_SKILL, ...over });
const leader = (id: string, skill: string) => card(id, { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null, skill });
const defs: Record<string, CardDef> = {
  ...DEFS,
  "E-WISH": leader("E-WISH", WISH_LEADER),
  "E-BOUND": leader("E-BOUND", BOUND_LEADER),
  "E-KO": leader("E-KO", KO_LEADER),
  "E-UNI": leader("E-UNI", UNISON_LEADER),
  "E-UNI3": leader("E-UNI3", UNISON3_LEADER),
  "E-ENERGY": card("E-ENERGY", { colors: ["Red"], skill: null }),
};
for (let cost = 0; cost <= 12; cost++) {
  defs[`BB-${cost}`] = card(`BB-${cost}`, { colors: ["Blue"], energyCost: cost, skill: null });
  defs[`BR-${cost}`] = card(`BR-${cost}`, { colors: ["Red"], energyCost: cost, skill: null });
  defs[`DR-${cost}`] = extra(`DR-${cost}`, { colors: ["Red"], traits: ["Desire"], energyCost: cost });
  defs[`DK-${cost}`] = extra(`DK-${cost}`, { colors: ["Black"], traits: ["Desire"], energyCost: cost });
  defs[`DB-${cost}`] = extra(`DB-${cost}`, { colors: ["Blue"], traits: ["Desire"], energyCost: cost });
}
defs["BB-SKILLED"] = card("BB-SKILLED", { colors: ["Blue"], energyCost: 1, skill: "[Permanent] This card gets +1000 power." });
defs["U-NONE"] = unison("U-NONE", { colors: ["Black"] });
defs["U-NONE-BIG"] = unison("U-NONE-BIG", { colors: ["Black"], power: 20000 });
defs["U-STORED"] = unison("U-STORED", { colors: ["Black"], specifiedCost: { Black: 2 }, energyCost: "X" });
defs["U-UNKNOWN"] = unison("U-UNKNOWN", { colors: ["Black"], energyCost: "X" });
defs["U-B2"] = unison("U-B2", { colors: ["Blue"], energyCost: "X", specifiedCost: { Blue: 2 } });
defs["U-B1"] = unison("U-B1", { colors: ["Blue"], energyCost: "X", specifiedCost: { Blue: 1 } });
const ctx = { ...CTX, defs, scripts: rulesFromCompiler(defs) };
const loaded = rulesetFor("dbs");
assert.ok(loaded.ok);
const game = loaded.definition;

function main(leaderId: string): VmState {
  let state = RULES.createGame(ctx, { seed: 979, p1: { name: "You", leader: leaderId, main: fifty("V1") }, p2: { name: "Other", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  state = RULES.apply(ctx, state, { type: "chooseFirst", player: state.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 24 && state.prompt.kind !== "main"; i++) state = RULES.apply(ctx, state, { type: "pass", player: (state.prompt as { player: PlayerId }).player }).state as VmState;
  assert.equal(state.prompt.kind, "main");
  return state;
}
function stage(state: VmState, id: string, area: "hand" | "energy" | "battle" | "drop", player: PlayerId = "p1"): string {
  const physical = state.sides[player].zones.deck[0];
  assert.ok(physical);
  state.cards[physical].cardId = id;
  assert.ok(moveCard(state, game, physical, area, { owner: player }).ok);
  return physical;
}
function take(state: VmState, action: Action): VmState {
  assert.ok(RULES.legalActions(ctx, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)), JSON.stringify({ prompt: state.prompt, action }));
  return RULES.apply(ctx, JSON.parse(JSON.stringify(state)), action).state as VmState;
}
const candidates = (state: VmState): string[] => (state.prompt.kind === "chooseCards" ? state.prompt.choice.candidates : []);
/** Activate the Leader's skill; the energy the player has is whatever the state holds when the skill resolves. */
const activate = (state: VmState) => take(state, { type: "activate", player: "p1", card: state.sides.p1.zones.leader[0], skill: 0 });
const energyOf = (state: VmState) => state.sides.p1.zones.energy.length;

// #979: the bound at the edge, in the master's current energy (BT12-030).
for (const extraEnergy of [0, 2]) {
  const state = main("E-BOUND");
  for (let i = 0; i < extraEnergy; i++) stage(state, "E-ENERGY", "energy");
  const n = energyOf(state);
  const edge = stage(state, `BB-${n}`, "drop");
  const below = n > 0 ? stage(state, `BB-${n - 1}`, "drop") : null;
  const over = stage(state, `BB-${n + 1}`, "drop");
  const red = stage(state, `BR-${n}`, "drop");
  const skilled = stage(state, "BB-SKILLED", "drop");
  const inHand = stage(state, `BB-${n}`, "hand");
  const theirs = stage(state, `BB-${n}`, "drop", "p2");
  const started = activate(state);
  const offered = candidates(started);
  assert.ok(offered.includes(edge), `energy ${n}: a cost equal to the energy is allowed`);
  if (below) assert.ok(offered.includes(below), `energy ${n}: a cost under it is`);
  for (const [why, id] of [["one over", over], ["a red card", red], ["a card with a skill", skilled], ["a card in hand", inHand], ["the other player's Drop", theirs]] as const) assert.ok(!offered.includes(id), `energy ${n}: ${why} is not`);
  // The bound is read when the skill resolves: the saved choice reloads and stays the same.
  const reloaded = JSON.parse(JSON.stringify(started)) as VmState;
  assert.deepEqual(candidates(reloaded), offered);
  assert.throws(() => RULES.apply(ctx, reloaded, { type: "choose", player: "p1", cards: [over] }), "one over cannot be chosen by hand");
  const done = take(started, { type: "choose", player: "p1", cards: [edge] });
  assert.ok(done.sides.p1.zones.battle.includes(edge), "the card at the edge is played");
}
// A bigger energy area widens the same text: the count is read each time.
{
  const state = main("E-BOUND");
  const base = energyOf(state);
  const cards = [stage(state, `BB-${base}`, "drop"), stage(state, `BB-${base + 2}`, "drop")];
  assert.deepEqual(candidates(activate(state)).sort(), [cards[0]].sort());
  for (let i = 0; i < 2; i++) stage(state, "E-ENERGY", "energy");
  assert.deepEqual(candidates(activate(state)).sort(), cards.slice().sort(), "two more energy: a cost two higher is within it");
}
// Opponent-side wording (EX03-12): the opponent's cards, the master's energy.
{
  const state = main("E-KO");
  for (let i = 0; i < 3; i++) stage(state, "E-ENERGY", "energy");
  for (let i = 0; i < 6; i++) stage(state, "E-ENERGY", "energy", "p2");
  const n = energyOf(state);
  const edge = stage(state, `BB-${n}`, "battle", "p2");
  const over = stage(state, `BB-${n + 1}`, "battle", "p2");
  const mine = stage(state, `BB-${n - 1}`, "battle", "p1");
  const started = activate(state);
  const offered = candidates(started);
  assert.deepEqual(offered, [edge], "only the opponent's card at or under MY energy (their six energy is not asked)");
  assert.ok(!offered.includes(over) && !offered.includes(mine));
  const done = take(started, { type: "choose", player: "p1", cards: [edge] });
  assert.ok(!done.sides.p2.zones.battle.includes(edge), "it is KO'd");
  assert.ok(done.sides.p2.zones.battle.includes(over));
}

// #979: the Desire family keeps its colours and its bound, and activates the real line without the printed price.
{
  const state = main("E-WISH");
  stage(state, "E-ENERGY", "energy");
  stage(state, "E-ENERGY", "energy");
  const n = energyOf(state);
  const redEdge = stage(state, `DR-${n}`, "hand");
  const blackBelow = stage(state, `DK-${n - 1}`, "hand");
  const redOver = stage(state, `DR-${n + 1}`, "hand");
  const blue = stage(state, `DB-${n}`, "hand");
  const plain = stage(state, `BR-${n}`, "hand");
  const started = activate(state);
  assert.deepEqual(candidates(started).sort(), [redEdge, blackBelow].sort(), "a red or black Desire card at or under the energy; not blue, not over, not a non-Extra");
  const handBefore = started.sides.p1.zones.hand.length;
  const done = take(started, { type: "choose", player: "p1", cards: [redEdge] });
  assert.ok(done.sides.p1.zones.drop.includes(redEdge), "the Extra is activated and goes to the Drop (12-2-4)");
  assert.ok(!done.sides.p1.zones.hand.includes(redEdge));
  assert.equal(done.sides.p1.zones.hand.length, handBefore - 1 + 1, "its Draw 1 resolved though its {r}{1} price was waived");
  for (const id of [redOver, blue, plain, blackBelow]) assert.ok(done.sides.p1.zones.hand.includes(id), "the others stay in hand");
  assert.deepEqual(done.sides.p1.zones.energy.map((id) => done.cards[id].mode).filter((m) => m === "rest"), [], "no energy was paid for the printed price");
}

// #980: "no specified cost" and the marker on arrival (BT12-139 family).
{
  const state = main("E-UNI");
  const none = stage(state, "U-NONE", "drop");
  const wrong = [stage(state, "U-NONE-BIG", "drop"), stage(state, "U-STORED", "drop"), stage(state, "U-UNKNOWN", "drop")];
  const started = activate(state);
  assert.deepEqual(candidates(started), [none], "no specified cost, 15000 power: the stored-cost, unknown-cost and 20000 Unisons are not offered");
  const done = take(started, { type: "choose", player: "p1", cards: [none] });
  assert.ok(done.sides.p1.zones.unison.includes(none), "it is played into the Unison Area");
  assert.equal(done.cards[none].markers, 1, "with a marker on it (13-2-3)");
  for (const id of wrong) assert.ok(done.sides.p1.zones.drop.includes(id));
  const reloaded = JSON.parse(JSON.stringify(done)) as VmState;
  assert.equal(reloaded.cards[none].markers, 1);
}
{
  const state = main("E-UNI3");
  const two = stage(state, "U-B2", "drop");
  const one = stage(state, "U-B1", "drop");
  const started = activate(state);
  assert.deepEqual(candidates(started), [two], "a specified cost of 2, not 1");
  const done = take(started, { type: "choose", player: "p1", cards: [two] });
  assert.equal(done.cards[two].markers, 3, "arrives with 3 markers");
  assert.ok(done.sides.p1.zones.drop.includes(one));
}
console.log("  ok  #979/#980: current-energy bound at the edge and on the opponent's side, Desire colours and bound, either-description searches, no specified cost, markers on arrival");
