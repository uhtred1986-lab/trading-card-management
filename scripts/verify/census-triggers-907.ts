/**
 * #907 (census of 18 Oct 2026, c1fa9a5a): the trigger and condition families.
 *
 *  1. "If this card has [Indestructible]" (BT21-005/-006/-007/-023, BT23-008, P-558) and
 *     "[Servant]" (BT26-054, P-491): the card has that keyword skill now, printed or gained.
 *  2. "When placing this card in your energy from any area" (DB2-166 …): `placedInEnergy`, on a
 *     [Permanent] that is really a trigger. The DB2 cards' own effect (an optional pair of
 *     coloured cards from the Drop) stays an honest unread gap.
 *  3. "During your turn, when you Combo with this card" (BT1-063, BT1-101, BT2-044, BT2-079,
 *     BT3-072, BT4-107) and the same turn phrase before any other "when": the turn is a
 *     condition, the moment is the head. "or if you combo with this card" (SD2-03).
 *  4. "If you didn't play a card" (BT12-005/-006/-009/-010, P-314, DB3-069/-070).
 *  5. "{1}, if your Leader's back side is a yellow <Gogeta: GT> card and you have a total of 2 or
 *     more multicolor <Pan> cards and/or multicolor cards with <GT> in their character names in
 *     your energy" (BT25-131 …): an either-description count; and BT26-020's "{r}. if" misprint.
 *
 * Rules engine only; nothing reads the database. Wordings are the catalog's text of 18 Oct 2026.
 */
import assert from "node:assert/strict";
import { CTX, DEFS, IMPL, arenaG, card, compileSkill, findG, leaderOf, parseSkills, playG, powerIn, stagedG, zoneOf } from "./harness";
import { compileCostProgram, priceCondition } from "../../src/lib/arena/compile";
import { skillRecords } from "../../src/lib/arena/draft";
import { autoTriggerMatches, comboEntryFromHand } from "../../src/lib/arena/text/triggers";
import { describeScript, validateProgram, type Cond } from "../../src/lib/arena/vm/script";
import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";

const compile = (text: string) => compileSkill(parseSkills(text)[0]);
const clean = (text: string) => {
  const s = compile(text);
  assert.deepEqual(s.unsupported, [], `reads whole: ${text}`);
  assert.ok(validateProgram(s.ops), `valid program: ${text}`);
  return s;
};
const rowOf = (id: string) => skillRecords(DEFS[id]).find((r) => r.kind === "auto" || r.kind === "permanent")!;

// ── 1. "if this card has [keyword]" ──────────────────────────────────────────
{
  const IND = "[Permanent] If this card has [Indestructible], it gets +10000 power and [Double Strike].";
  const s = clean(IND);
  assert.match(describeScript(s.ops, { permanent: true }), /if this card is a card with \[Indestructible\]: this card \+10000 power, this card gains \[Double Strike\]/);
  clean("[Permanent] If this card has [Indestructible], your opponent's Battle Cards and Unisons get -10000 power.");
  clean("[Permanent] If this card has the [Blocker] skill, this card gets +9000 power and [Barrier].");
  clean("[Activate: Main][Limit 1] If this card has [Servant]: Choose up to 1 of your opponent's Battle Cards with an energy cost of 3 or less and return it to its owner's hand.");
  clean("[Auto] If this card has [Servant]: When this card attacks, draw 1 card.");
  // A keyword the filter does not know would match every card: it stays a gap.
  assert.ok(compile("[Permanent] If this card has [Made Up Keyword], it gets +10000 power.").unsupported.length > 0, "an unknown keyword is not read as 'any card'");

  DEFS.K907A = card("K907A", { power: 10000, skill: "[Permanent] If this card has [Indestructible], it gets +10000 power." });
  DEFS.K907B = card("K907B", { power: 10000, skill: "[Indestructible]\n[Permanent] If this card has [Indestructible], it gets +10000 power." });
  const g = stagedG({ battle: ["K907A", "K907B"] });
  assert.equal(powerIn(CTX, g, findG(g, "p1", "battle", "K907A")), 10000, "without the keyword the condition does not hold");
  assert.equal(powerIn(CTX, g, findG(g, "p1", "battle", "K907B")), 20000, "with the printed keyword it does");
}

// ── 2. "when placing this card in your energy from any area" ────────────────
{
  const DB2 = "[Permanent] When placing this card in your energy from any area, you may choose 1 red card and 1 green card in your Drop Area and send them to your Warp. If you do, negate this card's [Energy-Exhaust] skill.";
  const s = compile(DB2);
  assert.deepEqual(s.unsupported, [], "DB2's optional pair of coloured cards is read (census-effects-907): both from the Drop, or neither");
  DEFS.PERM907 = card("PERM907", { energyCost: 0, skill: "[Permanent] When placing this card in your energy from any area, draw 1 card." });
  DEFS.PERM907B = card("PERM907B", { energyCost: 0, skill: "[Auto] When this card is placed in your energy, draw 1 card." });
  DEFS.NEUTRAL907 = card("NEUTRAL907", { energyCost: 0, skill: null });
  clean("[Permanent] When placing this card in your energy from any area, draw 1 card.");
  assert.deepEqual([...rowOf("PERM907").trigger], ["placedInEnergy"], "the [Permanent] answers to the placing");
  assert.deepEqual([...rowOf("PERM907B").trigger], ["placedInEnergy"], "and so does the plain [Auto] spelling");
  const perm = parseSkills(DEFS.PERM907.skill!)[0];
  assert.ok(autoTriggerMatches(perm, "placedInEnergy"));
  assert.ok(!autoTriggerMatches(perm, "placedInEnergyFromHand"));
  // Another [Permanent] that opens with "when" is not a trigger.
  assert.deepEqual(skillRecords(card("PERMREP907", { skill: "[Permanent] When this card would be placed in a Drop, place it at the bottom of its owner's deck instead." }))[0].trigger, []);

  // A charge puts a card in the Energy Area from the hand (7-2-11): the [Permanent] answers once.
  const drawn = (cardId: string): number => {
    let s0 = stagedG({ hand: [cardId] });
    const c = findG(s0, "p1", "hand", cardId);
    s0 = playG(s0, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" });
    assert.equal(s0.prompt.kind, "charge");
    const deck0 = zoneOf(s0, "p1", "deck").length;
    s0 = playG(s0, { type: "charge", player: "p1", card: c });
    for (let i = 0; i < 6 && s0.pending.length; i++) s0 = playG(s0, { type: "orderPending", player: "p1", index: 0 } as Action);
    return deck0 - zoneOf(s0, "p1", "deck").length;
  };
  const base = drawn("NEUTRAL907");
  assert.equal(drawn("PERM907") - base, 1, "the [Permanent] drew a card as it was placed");
  assert.equal(drawn("PERM907B") - base, 1, "the [Auto] spelling draws the same");
}

// ── 3. "during your turn, when you combo with this card" ────────────────────
{
  // #1070: whose turn a combo moment answers on is the typed combo qualification (`combo.turn`), checked where the
  // combo enters, not an `isTurnPlayer` condition wrapped around the program.
  const turn = (text: string): string => {
    const s = clean(text);
    assert.ok(s.combo, text);
    assert.notEqual(s.ops[0]?.op, "if", `${text}: no turn condition is left in the program`);
    return s.combo!.turn;
  };
  assert.equal(turn("[Auto] During your turn, when you Combo with this card, choose up to 1 of your opponent's Battle Cards with an energy cost of 3 or less and KO it."), "controller");
  assert.equal(turn("[Auto] During your opponent's turn, when you Combo with this card, choose up to 1 of your Battle Cards and switch it to Active Mode."), "opponent");
  clean("[Auto] During your turn, when you combo with this card, if your Leader Card is blue, choose up to 1 of your energy and switch it to Active Mode.");
  clean("[Auto] During your turn, when you combo with this card, if your opponent has 3 or less energy, choose up to 1 of your opponent's Battle Cards ignoring [Barrier] with 30000 or more power and KO it.");
  clean("[Auto] During your turn, when you combo with a card that has an energy cost of 2 or more, draw 1 card.");
  // The turn before any other "when" is a condition too (TB2-067, BT5-044).
  const played = clean("[Auto] During your turn, when you play this card, if there are 2 or more ≪World Tournament≫ other than this card in play in your Battle Area, draw 2 cards.");
  assert.equal((played.ops[0] as { cond: Cond }).cond.kind, "isTurnPlayer");
  assert.deepEqual(clean("[Auto] During your turn, when this card attacks, draw 1 card.").ops[0], { op: "if", cond: { kind: "isTurnPlayer" }, then: [{ op: "draw", n: 1 }] });

  DEFS.CT907 = card("CT907", { energyCost: 0, comboCost: 0, comboPower: 10000, skill: "[Auto] During your turn, when you Combo with this card, draw 1 card." });
  DEFS.CTH907 = card("CTH907", { energyCost: 0, comboCost: 0, comboPower: 10000, skill: "[Auto] During your turn, when you combo with this card from your hand, draw 1 card." });
  DEFS.CTA907 = card("CTA907", { energyCost: 0, skill: "[Auto] During your turn, when this card attacks, draw 1 card." });
  DEFS.CTE907 = card("CTE907", { energyCost: 0, comboCost: 0, comboPower: 10000, skill: "[Auto] When a card evolves into this card, or if you combo with this card, draw 1 card." });
  for (const id of ["CT907", "CTH907", "CTE907"]) assert.ok(rowOf(id).trigger.includes("comboUsed"), `${id}: answers the combo entry`);
  assert.deepEqual([...rowOf("CTA907").trigger], ["attacks"], "the attack is the moment once the turn is off the head");
  assert.ok(rowOf("CTE907").trigger.includes("evolvedInto"), "SD2-03 keeps its evolve half");
  assert.equal(comboEntryFromHand(parseSkills(DEFS.CTH907.skill!)[0]), true, "'from your hand' asks for the captured origin");
  assert.equal(comboEntryFromHand(parseSkills(DEFS.CT907.skill!)[0]), false);

  const take = (state: EngineState, action: Action): { state: EngineState; events: GameEvent[] } => {
    assert.ok(IMPL.legalActions(CTX, state).some((row) => JSON.stringify(row.action) === JSON.stringify(action)), `expected legal ${JSON.stringify(action)} at ${state.prompt.kind}`);
    return IMPL.apply(CTX, state, action);
  };
  const stage = (state: EngineState, owner: PlayerId, cardId: string, area: "hand" | "battle"): string => {
    const id = zoneOf(state, owner, "deck").shift()!;
    state.cards[id].cardId = cardId;
    zoneOf(state, owner, area).push(id);
    if (area !== "hand") state.cards[id].mode = "active";
    return id;
  };
  // p1's turn: the combo draws; from the battle area only the unqualified wording does.
  for (const [cardId, area, draws] of [["CT907", "hand", 1], ["CT907", "battle", 1], ["CTH907", "hand", 1], ["CTH907", "battle", 0]] as const) {
    let state = arenaG();
    const combo = stage(state, "p1", cardId, area);
    state = take(state, { type: "attack", player: "p1", attacker: leaderOf(state, "p1")!, target: leaderOf(state, "p2")! }).state;
    const before = zoneOf(state, "p1", "hand").length;
    state = take(state, { type: "combo", player: "p1", card: combo }).state;
    assert.equal(zoneOf(state, "p1", "hand").length - (before - Number(area === "hand")), draws, `${cardId} from ${area} on p1's turn`);
  }
}

// ── 4. "if you didn't play a card" ──────────────────────────────────────────
{
  const BT12 = "[Auto]{R}{R}, if your Leader Card is a red ≪Earthling≫-only card: When this card in your life is flipped face up by one of your red card skills, you may place the top card of your deck in your life, then play this face-up card from your life. If you didn't play a card, place this face-up card in your Drop Area from your life.";
  const s = clean(BT12);
  assert.match(describeScript(s.ops), /if not \(you played a card\)/);
  clean("[Auto] When this card is played from your hand, play up to 1 {SS Cabba, Spirit Resonance} from your deck with 3 markers on it, then shuffle your deck. If you didn't play a card, choose up to 1 of your opponent's Battle Cards, ignoring [Barrier], and it gets -30000 power for the turn.");

  DEFS.GHOST907 = card("GHOST907", { name: "Ghost907", energyCost: 0, power: 5000 });
  DEFS.DP907 = card("DP907", { energyCost: 0, power: 5000, skill: "[Auto] When this card is played from your hand, play up to 1 {Ghost907} from your deck, then shuffle your deck. If you didn't play a card, draw 1 card." });
  const run = (ghostInDeck: boolean): { handDelta: number; ghostInPlay: boolean } => {
    let g = stagedG({ hand: ["DP907"] });
    if (ghostInDeck) g.cards[zoneOf(g, "p1", "deck")[0]].cardId = "GHOST907";
    const hand0 = zoneOf(g, "p1", "hand").length;
    g = playG(g, { type: "play", player: "p1", card: findG(g, "p1", "hand", "DP907") });
    for (let i = 0; i < 10 && g.prompt.kind !== "main"; i++) {
      const q = g.prompt as { kind: string; player: PlayerId; choice?: { candidates: string[] } };
      if (q.kind === "payCost") g = playG(g, { type: "payCost", player: q.player, option: 0 });
      else if (q.kind === "chooseCards") g = playG(g, { type: "choose", player: q.player, cards: q.choice?.candidates.slice(0, 1) ?? [] });
      else if (q.kind === "orderPending") g = playG(g, { type: "orderPending", player: q.player, index: 0 });
      else throw new Error(`unexpected prompt ${q.kind}`);
    }
    return { handDelta: zoneOf(g, "p1", "hand").length - hand0, ghostInPlay: zoneOf(g, "p1", "battle").some((x) => g.cards[x].cardId === "GHOST907") };
  };
  const found = run(true);
  const missed = run(false);
  assert.equal(found.ghostInPlay, true, "the search played the card");
  assert.equal(found.handDelta, -1, "so the 'didn't play' half stays quiet (the played card left the hand)");
  assert.equal(missed.ghostInPlay, false);
  assert.equal(missed.handDelta, 0, "nothing to play: the 'didn't play' draw happened (-1 for the play, +1 for the draw)");
}

// ── 5. Gogeta's price: leader's back side + an either-description energy count ─
{
  const GOGETA = "[Activate: Main/Battle][Limit 1]{1}, if your Leader's back side is a yellow <Gogeta: GT> card and you have a total of 2 or more multicolor <Pan> cards and/or multicolor cards with <GT> in their character names in your energy: Play this card from your hand.";
  const sk = parseSkills(GOGETA)[0];
  const s = clean(GOGETA);
  assert.match(describeScript(s.ops), /if your leader's back side is Yellow.*and there are 2 or more .* in your Energy Area/);
  const cond = priceCondition(sk)?.cond;
  assert.equal(cond?.kind, "all");
  const parts = (cond as Extract<Cond, { kind: "all" }>).conds;
  assert.equal(parts[0].kind, "leaderMatches");
  assert.equal((parts[0] as { back?: boolean }).back, true, "the back side is asked");
  const count = parts[1] as Extract<Cond, { kind: "count" }>;
  assert.equal(count.kind, "count");
  assert.equal(count.atLeast, 2);
  assert.equal(count.sel.filter?.anyOf?.length, 2, "one count over two descriptions");
  assert.equal(compileCostProgram(sk), null, "{1} is orbs: no action half is invented");
  // The misprint with a full stop where the siblings print the comma (BT26-020, BT26-101).
  assert.ok(priceCondition(parseSkills("[Activate: Main][Limit 1]{r}. if your Leader's back side is a red <Super 17> card and you have 2 or more energy: Play this card from your hand.")[0]), "BT26-020's '{r}. if' reads as the comma");
  clean("[Activate: Main][Limit 1]{r}. if your Leader's back side is a red <Super 17> card and you have 2 or more energy: Play this card from your hand.");
  // And/or with something that is not two plain descriptions stays refused.
  assert.ok(compile("[Permanent] If you have 2 or more red cards and/or blue cards in your Battle Area and Drop Area, this card gets +5000 power.").unsupported.length > 0);

  // A card that fits both descriptions counts once.
  DEFS.MULTI907 = card("MULTI907", { colors: ["Red", "Blue"] });
  DEFS.EITHER907 = card("EITHER907", { power: 10000, skill: "[Permanent] If you have 2 or more red cards and/or blue cards in your energy, this card gets +5000 power." });
  const power = (energy: string[]): number => {
    const g = stagedG({ battle: ["EITHER907"], energy });
    return powerIn(CTX, g, findG(g, "p1", "battle", "EITHER907"));
  };
  assert.equal(power(["V1", "V-BLUE"]), 15000, "a red and a blue card: two cards");
  assert.equal(power(["V1", "MULTI907"]), 15000, "a red card and a red/blue card: two cards");
  assert.equal(power(["MULTI907"]), 10000, "one red/blue card fits both descriptions and is still one card");
}

console.log("#907 census triggers/conditions: [keyword] condition, placing-in-energy permanent, turn-then-when, didn't play, either-description count, both the readings and the VM");
