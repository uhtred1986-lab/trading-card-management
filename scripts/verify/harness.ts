/**
 * What every arena check is built on: the synthetic cards, the staged game and
 * the assertions more than one file makes.
 *
 * The checks themselves live in the files beside this one and run in the order
 * `scripts/verify-arena.ts` imports them — which matters, because the blocks
 * add cards to `DEFS` as they go and `CTX` compiles them lazily.
 *
 * There is one engine (the rules engine, #118) and every suite plays on it:
 * `createGame`/`apply`/`legalActions`/`rejectedActions` are `IMPL`'s, the
 * `*G` helpers below stage and read a board through the state seam
 * (`engine-state.ts`) and the declared readers (`vm/`). The `G` suffix is
 * historical (it marked the generic twin of a legacy function).
 */
import assert from "node:assert/strict";
import { capabilityForSkip } from "../../src/lib/arena/capability-inventory";
import { defsFrom } from "../../src/lib/arena/vm/common";
import { seedFrom } from "../../src/lib/arena/vm/rng";
import { type Action, type CardDef, type EngineContext, type GameEvent, type PlayerId, type RejectedAction, type LegalAction, type Requirement } from "../../src/lib/arena/types";
import type { EngineState } from "../../src/lib/arena/engines";
import { RULES } from "../../src/lib/arena/vm";
import { energyMarkersOf, leaderOf, unisonOf, zoneOf, type ZoneArea } from "../../src/lib/arena/engine-state";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { addEffect as vmAddEffect, schedule as vmSchedule, skillNegated as vmSkillNegated, skillsNegated as vmSkillsNegated } from "../../src/lib/arena/vm/effects";
import { forbids as vmForbids } from "../../src/lib/arena/vm/program";
import { withTokens } from "../../src/lib/arena/vm/cards";
import { cardPrice as vmCardPrice } from "../../src/lib/arena/vm/costs";
import { predicateOf as vmPredicateOf } from "../../src/lib/arena/vm/filters";
import { koCard as vmKoCard } from "../../src/lib/arena/vm/battle";
import { findCard as vmFindCard, isTokenCard as vmIsTokenCard } from "../../src/lib/arena/vm/zones";
import { fire as vmFire, type Moment as VmMoment } from "../../src/lib/arena/vm/events";
import { hasKeyword as vmHasKeyword } from "../../src/lib/arena/vm/program";
import { lifeReplacementChoices as vmLifeReplacementChoices } from "../../src/lib/arena/vm/replace";
import { moved as vmMoved } from "../../src/lib/arena/vm/flow";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { appendBeats, maskBeats, type Beat, type Beats, type NumberedBeat } from "../../src/lib/arena/beats";
import { buildSnapshot, rejectedFor, waitingFor, type Snapshot } from "../../src/lib/arena/snapshot";
import { missingEnergyChip, missingEnergyChips, pill, priceOf, refusal, sentence, stepText } from "../../src/lib/arena/wording";
import { narrate } from "../../src/lib/arena/narration";
import { colourOf, DEFAULT_LIGHTING, encodeLighting, LEADER_COLOURS, lightingFrom, LIGHTING_VERSION, mix, RIVAL, toneFor, TONES, turnVars } from "../../src/lib/arena/lighting";
import { trailingTrigger, parseSkills, keywordOf, orbsIn, eitherOrbsIn, skillLines } from "../../src/lib/arena/text/cards";
import { KEYWORDS, keywordTagSpellings, keywordsByGroup, tagBody, tagParsesTo } from "../../src/lib/arena/glossary";
import { parseFilter, matches, parseCondition, type CardFilter } from "../../src/lib/arena/text/filters";
import { compileCostProgram, compileSkill, costIsOnlyOrbs, costText, parseConditionClause, parseTarget, priceCondition, priceX, splitClauses } from "../../src/lib/arena/compile";
import { COND_CLASS, COND_SCHEMA, CONDITIONS_OFF_A_CARD, OP_CLASS, OP_SCHEMA, condSignature, describeCond, describeScript, opSignature, validateProgram as validate, type Op as SchemaOp } from "../../src/lib/arena/vm/script";
import { autoTriggerMatches } from "../../src/lib/arena/text/triggers";
import { masterOf as vmMasterOf } from "../../src/lib/arena/vm/triggers";
import type { KeywordSkill, Trigger } from "../../src/lib/arena/types";
import { canonical, hoist, patternKey, programShape, rulesFromCompiler, skillRecords } from "../../src/lib/arena/draft";
import { keywordPlays } from "../../src/lib/arena/glossary";
import { EFFECT_LANGUAGE } from "../../src/lib/arena/ai/opponent";
import { clauseShape, describeTrigger, mechanismOf, triggersOf } from "../../src/lib/arena/gaps";

// ── the engine every suite below plays on ───────────────────────────────────

const IMPL = RULES;

// ── synthetic cards ────────────────────────────────────────────────────────

const card = (id: string, o: Partial<CardDef>): CardDef => ({
  id,
  name: id,
  type: "BATTLE",
  colors: ["Red"],
  energyCost: 1,
  zEnergyCost: null,
  power: 10000,
  comboCost: 0,
  comboPower: 5000,
  skill: null,
  characters: [id],
  traits: [],
  ...o,
});

const DEFS: Record<string, CardDef> = defsFrom([
  card("L-RED", {
    type: "LEADER",
    energyCost: null,
    comboCost: null,
    comboPower: null,
    skill: "[Awaken] When your life is at 4 or less: Draw 1 card and flip this card over.",
    back: { name: "L-RED awakened", power: 15000, skill: null },
  }),
  card("L-BLUE", { type: "LEADER", colors: ["Blue"], energyCost: null, comboCost: null, comboPower: null }),
  card("V1", {}),
  card("V-BLUE", { colors: ["Blue"] }),
  card("BLOCKER", { energyCost: 2, skill: "[Blocker]", comboCost: 1, comboPower: 10000 }),
  // BT3-103, whose whole point is the two skills together: it blocks, then buys
  // its way back to Active Mode so it can block again.
  card("BERGAMO", {
    energyCost: 2,
    // Enough power to survive the block, or there is nothing left to untap.
    power: 15000,
    skill:
      "[Blocker]<br>[Auto] If this card participated in a battle during your opponent's turn, you may place 1 card from your hand in the Drop Area at the end of the battle. If you do so, switch this card to Active Mode, and this card gains +5000 power for the duration of the turn.",
  }),
  card("CRIT", { energyCost: 3, power: 15000, skill: "[Critical]" }),
  card("DOUBLE", { energyCost: 4, power: 20000, skill: "[Double Strike]" }),
  card("DUAL", { energyCost: 3, power: 15000, skill: "[Dual Attack]" }),
  card("INDESTRUCT", { energyCost: 2, skill: "[Indestructible]" }),
  card("REVENGE", { energyCost: 2, power: 5000, skill: "[Revenge]" }),
  card("BIG", { energyCost: 5, power: 25000 }),
  card("UNIQ", { energyCost: 1, skill: "[Unique]" }),
  card("E-NEGATE", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Negate the attack." }),
  card("E-DRAW", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 2 cards." }),
  card("U1", { type: "UNISON", energyCost: "X", power: 5000, comboCost: null, comboPower: null, skill: "[Blocker]" }),
  card("ZB", { type: "Z-BATTLE", energyCost: 2, zEnergyCost: 1, power: 20000, comboCost: null, comboPower: null, skill: "[Z-Stack 1] Red <V1>." }),
  // Lane D: a Z-Energy cost reducer, proving the discount is paid rather than
  // merely read. `payZEnergy`'s two call sites and the three legality gates
  // around it in `engine.ts` used to read `d.zEnergyCost` raw — a
  // `costReduction` naming "zEnergy" compiled and read correctly there, and
  // did nothing on the board (`state.ts:653`).
  card("ZCHEAP", { type: "Z-BATTLE", energyCost: 2, zEnergyCost: 2, power: 20000, comboCost: null, comboPower: null, skill: "[Permanent] Reduce the Z-Energy cost of this card in your Z-Deck by 1." }),
  card("EVO", { energyCost: 3, power: 20000, skill: "[Evolve]{1}: <V1>" }),
  // 22-22: swaps itself for the specified cost-3 Battle Card in hand — a red
  // <COST3> (#731). CRIT and DUAL are red cost-3 Battle Cards of other
  // characters, so a hand holding only those has nothing to reveal.
  card("SWAPPER", { energyCost: 2, power: 15000, skill: "[Swap 3]{1}: Red <COST3> with an energy cost of 3." }),
  card("COST3", { energyCost: 3, power: 15000 }),
  card("DRAWER", { energyCost: 1, skill: "[Auto] When you play this card, draw 1 card." }),
  card("KILLER", { energyCost: 1, skill: "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards and KO it." }),
  card("PUMP", { energyCost: 1, skill: "[Activate: Main] This card gets +5000 power for the turn." }),
  card("SPAWN", { energyCost: 1, skill: "[Auto] When you play this card, play 2 Saibaman tokens (10000 power, 0 combo cost, and 5000 combo power)." }),
  card("MYSTERY", { energyCost: 1, skill: "[Auto] When you play this card, bend the fabric of reality to your will." }),
  // 3-9-2-1: the three sides of a face-up life card — the skill that flips one,
  // the card in the life area that watches for it, and a card in play that
  // watches the same moment.
  card("FLIPPER", { colors: ["Red"], energyCost: 1, skill: "[Auto] When you play this card, flip up to 1 card in your life face up." }),
  card("LIFEWATCH", { energyCost: 1, skill: "[Auto] When this card in your life is flipped face up by one of your red card skills, draw 1 card." }),
  card("BLUEWATCH", { energyCost: 1, skill: "[Auto] When a card in your life is flipped face up by one of your blue card skills, draw 1 card." }),
  card("LIFEGIVER", { energyCost: 1, skill: "[Auto] When you play this card, you may choose 1 card in your hand and add it to your life face up." }),
  card("FORCEKILL", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and KO it." }),
  card("AUTOCOST", { energyCost: 1, skill: "[Auto]{r}: When you play this card, draw 2 cards." }),
  card("UNI2", { type: "UNISON", energyCost: "X", power: 5000, comboCost: null, comboPower: null, skill: "[-1][Activate: Main] Draw 1 card." }),
  card("XBAT", { energyCost: "X", power: 5000 }),
  card("AURA", { energyCost: 1, skill: "[Permanent] Your Battle Cards get +5000 power." }),
  card("CHEAP", { energyCost: 3, skill: "[Permanent] Reduce the energy cost of this card in your hand by 1." }),
  card("ODDAURA", { energyCost: 1, skill: "[Permanent] Your Battle Cards resonate with the will of the universe." }),
  card("DELAYKO", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards. At the end of the turn, KO it." }),
  card("DELAYDRAW", { energyCost: 1, skill: "[Auto] When you play this card, at the start of your next turn, draw 2 cards." }),
  card("DELAYOPP", { energyCost: 1, skill: "[Auto] When you play this card, during your opponent's next turn, your opponent discards 1 card." }),
  card("LOCKDOWN", { energyCost: 1, skill: "[Auto] When you play this card, your opponent can't attack with Battle Cards until the start of your next turn." }),
  card("RESTLOCK", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards. It can't switch to Active Mode until the end of your opponent's turn." }),
  card("NOCOPIES", { energyCost: 1, skill: "[Auto] When you play this card, you can't play copies of this card for the turn." }),
  card("TOUGH", { energyCost: 2, power: 5000, skill: "[Auto] When you play this card, this card can't be KO'd by your opponent's skills until the start of your next turn." }),
  card("STACKER", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your Battle Cards and place it under this card." }),
  card("MILLGATE", {
    energyCost: 1,
    skill: "[Auto] When you play this card, place the top card of your deck in your Drop Area. If that card is red, this card gains +5000 power for the duration of the turn.",
  }),
  card("BUUHOST", { energyCost: 1, power: 5000, characters: ["Majin Buu"] }),
  card("BUUEAT", {
    energyCost: 1,
    characters: ["Majin Buu"],
    skill:
      "[Auto] When you play this card, choose 1 of your <Majin Buu> and 1 of your opponent's Battle Cards with an energy cost of 3 or less. Place the chosen opponent Battle Card under the chosen <Majin Buu>.",
  }),
  card("TWOKILL", { energyCost: 1, skill: "[Auto] When you play this card, choose 2 of your opponent's Battle Cards and KO them." }),
  card("GRABBER", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's cards and place it in its owner's drop area." }),
  card("ONCEONLY", { energyCost: 1, skill: "[Auto] When you play this card, draw 1 card and negate this skill for the game." }),
  card("STEALER", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and gain control of it." }),
  card("PERMTOUGH", { energyCost: 2, power: 5000, skill: "[Permanent] This card can't be KO'd by your opponent's skills." }),
  card("PERMLOCK", { energyCost: 2, power: 5000, skill: "[Permanent] Your opponent can't attack with Battle Cards." }),
  card("SELFMUTE", { energyCost: 2, skill: "[Blocker]\n[Permanent] Negate this card's [Blocker] skill in all areas." }),
  card("BECOMES", { energyCost: 2, skill: "[Permanent] This card gains ≪Saiyan≫ in all areas." }),
  // BT2-001 Vegito's wording: the grant is on *other* cards, and the areas it
  // names are all of them rather than the table.
  card("RECOLOR", { energyCost: 2, skill: "[Permanent] Each <RECOLORED> in all of your areas gain red, blue, and green colors." }),
  card("RECOLORED", { energyCost: 1, colors: ["Yellow"] }),
  card("SAIYANKILL", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's ≪Saiyan≫ Battle Cards and KO it." }),
  // 20-1, the fourth thing a card can be "also treated as": a whole card name.
  card("RENAMED", { energyCost: 2, name: "RENAMED", skill: "[Permanent] This card is also treated as {Planet M-2} in all areas." }),
  card("CHEAPCOMBO", { energyCost: 3, comboCost: 2, comboPower: 5000, skill: "[Permanent] Reduce the combo cost of this card in your hand by 2." }),
  card("BLUECOMBO", { energyCost: 3, colors: ["Blue"], comboCost: 2, comboPower: 5000 }),
  card("CHEAPENER", { energyCost: 1, skill: "[Auto] When you play this card, reduce the combo cost of blue cards in your hand by 1 for the duration of the turn." }),
  card("ONLYONE", { energyCost: 1, name: "ONLYONE", skill: "[Permanent] Only 1 {ONLYONE} can be played in your Battle Area." }),
  card("RESTCOND", { energyCost: 1, skill: "[Permanent] If this card is in Rest Mode, your Battle Cards get +5000 power." }),
  card("FREEPLAY", { energyCost: 2, power: 5000, skill: "[Permanent] If you have <V1> in your Battle Area or Leader Area, you can play this card from your hand without paying its energy cost." }),
  card("EXILE", { energyCost: 2, power: 5000, skill: "[Permanent] If this card would leave the Battle Area, remove it from the game instead." }),
  card("MAYWARP", { energyCost: 2, power: 5000, skill: "[Permanent] If this card would leave the Battle Area, you may send it to your Warp instead." }),
  card("EARTHWARP", { energyCost: 2, power: 5000, traits: ["Earthling"], skill: "[Permanent] If this card would leave the Battle Area, send it to your Warp instead." }),
  card("WARPER", { energyCost: 2, power: 5000, skill: "[Permanent] If this card would be removed from your Battle Area by a skill, send this card to your Warp instead." }),
  card("E-STOP", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Counter: Counter] Negate the [Counter]." }),
  card("E-LIFE", {
    type: "EXTRA",
    energyCost: 3,
    power: null,
    comboCost: null,
    comboPower: null,
    skill:
      "[Counter: Attack] Negate the attack.<br>[Permanent] You can activate this card's [Counter] skill from your hand by adding a card from your life to your hand instead of paying its energy cost.",
  }),
  card("MODAL", { energyCost: 1, skill: "[Auto] When you play this card, choose one-<br>・Draw 1 card.<br>・Your opponent discards 1 card." }),
  // For the workflow spec: a search of the deck, and a skill the turn uses up.
  card("SEARCH", { energyCost: 1, skill: "[Auto] When you play this card, add up to 1 <V1> card from your deck to your hand, then shuffle your deck." }),
  card("ONCE", { energyCost: 1, skill: "[Activate: Main][Once per turn] Draw 1 card." }),
  card("LIMITED2", { energyCost: 1, skill: "[Activate: Main][Limit 2] Draw 1 card." }),
  // For the review's fixes: a pump that grants a keyword too, and a [Permanent] the static layer cannot apply.
  card("PUMPCRIT", { energyCost: 1, skill: "[Activate: Main] This card gets +5000 power and [Critical] for the turn." }),
  card("INERTPERM", { energyCost: 1, skill: "[Permanent] Draw 1 card." }),
  card("WALL", { energyCost: 1, skill: "[Barrier]" }),
  card("E-CC", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Counter: Counter] Negate the [Counter]." }),
  card("MUTEAUTO", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards and negate that card's [Auto] skills in all areas." }),
  card("E-MYSTERY", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Bend the fabric of reality to your will." }),
  // 20-5: a price paid at a value the player picks, read again by the effect.
  card("XDRAW", { energyCost: 1, skill: "[Activate: Main] Pay X energy: Draw X cards." }),
  card("XMARKERS", { energyCost: 1, skill: "[Permanent] This card gets +3000 power for each marker on it." }),
  card("XENERGY", { energyCost: 1, skill: "[Auto] When this card attacks, this card gains +1000 power for each 1 energy you have for the duration of the turn." }),
  // #536: what the attack is aimed at is part of the moment (SD5-01, BT6-014).
  card("ATK-LEADER", { energyCost: 1, skill: "[Auto] When this card attacks a Leader Card, draw 1 card." }),
  // #539: "can't switch to Active Mode during your opponent's next Charge Phase" — the Charge Phase alone.
  card("CHARGELOCK", { energyCost: 1, skill: "[Auto] When you play this card, choose 1 of your opponent's Battle Cards in Rest Mode. That card cannot switch to Active Mode during your opponent's next Charge Phase." }),
  card("STANDALL", { energyCost: 1, skill: "[Auto] When you play this card, switch all of your Battle Cards to Active Mode." }),
  // #539: "at the end of the battle after you combo with this card from your hand, play this card".
  card("COMBOBACK", { energyCost: 3, skill: "[Auto] At the end of the battle after you combo with this card from your hand, play this card in Rest Mode." }),
  card("ATK-BATTLE", { energyCost: 1, skill: "[Auto] When this card attacks a Battle Card, draw 1 card." }),
]);
// What a real game gets from `card_rules` once every card is drafted: the
// tests need no database, so the drafter's own compile stands in for the rows
// (lazily, because tests below add cards to DEFS as they go).
const CTX = { defs: DEFS, scripts: rulesFromCompiler(DEFS) };

const fifty = (id: string) => Array.from({ length: 50 }, () => id);

/**
 * The identity `rejectedActions` dedupes on: its own `cardOf`, which reads a
 * one-card `cards` as well as `card` and `attacker`. A `choose` prompt carries
 * neither of the latter, so keying on those alone would read one rejection per
 * unofferable card as the same entry repeated.
 *
 * An activation is keyed by its skill index too, and that is the whole of the
 * promise §3.2 makes today: **one rejection per card per action type — except
 * an activation, which is one per skill line.** A card prints up to nine of
 * them and one being on the menu says nothing about the rest. Every other
 * action type still gets exactly one.
 */
function cardKeyOf(a: Action): string {
  const x = a as { card?: string | null; attacker?: string; cards?: string[]; skill?: number };
  const skill = a.type === "activate" && typeof x.skill === "number" ? `#${x.skill}` : "";
  if (typeof x.card === "string") return x.card + skill;
  if (typeof x.attacker === "string") return x.attacker;
  if (Array.isArray(x.cards)) return x.cards.join(",");
  return "";
}

/**
 * §3.2, over two lists and nothing else: one promise, asserted over a menu and
 * its rejections wherever they come from.
 */
function assertMenuInvariants(legal: LegalAction[], rejected: RejectedAction[], where: string): void {
  const offered = new Set(legal.map((l) => JSON.stringify(l.action)));
  const keys = new Set<string>();
  // §3.2's exception, asserted as a property of the two lists rather than as an
  // absence of duplicates: **every activation says which line it is**. A card
  // prints up to nine and the index is the only thing that tells them apart, so
  // one without it would collapse nine answers into one and the "two rejections
  // for" check below would pass by saying less rather than by being right. Both
  // engines are passed through here and `scripts/arena-playthrough.mts` says
  // the same thing in the same words.
  for (const a of [...legal.map((l) => l.action), ...rejected.map((r) => r.action)]) {
    if (a.type !== "activate") continue;
    assert.equal(typeof (a as { skill?: unknown }).skill, "number", `${where}: an activation names no skill line, and a card prints up to nine of them`);
  }
  for (const r of rejected) {
    assert.ok(!offered.has(JSON.stringify(r.action)), `${where}: "${r.label}" is both legal and rejected`);
    assert.ok(r.why.length > 0, `${where}: "${r.label}" is rejected for no reason`);
    const key = `${r.action.type}:${cardKeyOf(r.action)}`;
    assert.ok(!keys.has(key), `${where}: two rejections for ${key}`);
    keys.add(key);
    // And no legal move of the same type on the same card, which is the
    // stronger promise a client relies on when it indexes by card.
    assert.ok(!legal.some((l) => `${l.action.type}:${cardKeyOf(l.action)}` === key), `${where}: ${key} is rejected while the same move is offered`);
  }
}

// ── the state interface (#152): staging helpers and readers ─────────────────
//
// `gameG`/`arenaG`/`playG`/`findG`/`labelsG`/`actsG`/`canActivateG` stage a
// board to a name, find a card by its catalog id and read the menu. Fields the
// state shares by name (`prompt`, `battle`, `winner`, `overReason`, `phase`,
// `turn`, `turnPlayer`, `effects`, `cards[id].{mode,markers,under,flipped,
// faceUp,hidden,battledThisTurn}`) are read directly; an **area** is
// `sides[p].zones[area]`, read through `zoneOf`/`leaderOf`/`unisonOf`.
// `arenaOnRules` is a raw relabel-and-splice into the zone array, no moment
// fired, `mode` set active outside the hand.

const ZONE_AREAS: ZoneArea[] = ["deck", "hand", "energy", "battle", "drop", "warp", "life", "combo", "zDeck", "zEnergy", "removed"];

/**
 * `zoneOf`/`leaderOf`/`unisonOf`/`energyMarkersOf` now live in
 * `src/lib/arena/engine-state.ts` — a production module, since `#161`'s probe
 * staging reads the same seam — and are imported above rather than kept here
 * as a second copy.
 */
function setEnergyMarkersG(s: EngineState, p: PlayerId, n: number): void {
  s.sides[p].attrs.energyMarkers = n;
}

/** A fresh game: `IMPL.createGame` itself. */
function gameG(seed = 1, p1 = fifty("V1"), p2 = fifty("V-BLUE"), z: string[] = []): EngineState {
  return IMPL.createGame(CTX, { seed, p1: { name: "You", leader: "L-RED", main: p1, z }, p2: { name: "Claude", leader: "L-BLUE", main: p2 } }).state;
}

/** Apply a list of actions, asserting each is legal (`IllegalAction`/`RulesetBroken` throw on their own). */
function playG(s: EngineState, ...actions: Action[]): EngineState {
  for (const a of actions) s = IMPL.apply(CTX, s, a).state;
  return s;
}

function labelsG(s: EngineState): string[] {
  return IMPL.legalActions(CTX, s).map((a) => a.label);
}
function actsG(s: EngineState) {
  return IMPL.legalActions(CTX, s).map((a) => a.action);
}
function canActivateG(s: EngineState, card: string): boolean {
  return actsG(s).some((a) => a.type === "activate" && a.card === card);
}

/** `IMPL.rejectedActions` over `IMPL.legalActions`'s own menu — the common case, where a caller has no menu of its own to pass. */
function rejectedActionsG(s: EngineState): RejectedAction[] {
  return IMPL.rejectedActions(CTX, s, IMPL.legalActions(CTX, s));
}

function findG(s: EngineState, p: PlayerId, area: ZoneArea, cardId: string): string {
  const id = zoneOf(s, p, area).find((x) => s.cards[x].cardId === cardId);
  assert.ok(id, `${p}'s ${area} has no ${cardId}`);
  return id!;
}

/** One card moved from the deck into a named area, cardId swapped, mode set active outside the hand — a raw fixture, no moment fired. */
function stageOnRules(r: VmState, p: PlayerId, cardId: string, area: "hand" | "energy" | "battle"): string {
  const filler = p === "p1" ? "V1" : "V-BLUE";
  const inst = r.sides[p].zones.deck.find((id) => r.cards[id].cardId === filler);
  assert.ok(inst, `${p}'s deck has run out of fixture cards to relabel as ${cardId}`);
  r.sides[p].zones.deck = r.sides[p].zones.deck.filter((id) => id !== inst);
  r.cards[inst!].cardId = cardId;
  r.sides[p].zones[area] = [...r.sides[p].zones[area], inst!];
  if (area !== "hand") r.cards[inst!].mode = "active";
  return inst!;
}

interface ArenaOpts {
  hand?: string[];
  energy?: string[];
  battle?: string[];
  oppHand?: string[];
  oppBattle?: string[];
  oppEnergy?: string[];
  z?: string[];
}

/** p1's Main Phase, their second turn. */
function arenaOnRules(opts: ArenaOpts): VmState {
  let r = IMPL.createGame(CTX, { seed: 7, p1: { name: "You", leader: "L-RED", main: fifty("V1"), z: opts.z ?? [] }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } }).state as VmState;
  const chooser = (r.prompt as { player: PlayerId }).player;
  r = IMPL.apply(CTX, r, { type: "chooseFirst", player: chooser, first: "p1" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p1", redraw: false }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "mulligan", player: "p2", redraw: false }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p1", card: null }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "endMain", player: "p1" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p2", card: null }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "endMain", player: "p2" }).state as VmState;
  r = IMPL.apply(CTX, r, { type: "charge", player: "p1", card: null }).state as VmState;
  assert.equal(r.prompt.kind, "main", "the rules-engine fixture did not reach p1's second Main Phase");
  for (const cardId of opts.hand ?? []) stageOnRules(r, "p1", cardId, "hand");
  for (const cardId of opts.energy ?? []) stageOnRules(r, "p1", cardId, "energy");
  for (const cardId of opts.battle ?? []) stageOnRules(r, "p1", cardId, "battle");
  for (const cardId of opts.oppHand ?? []) stageOnRules(r, "p2", cardId, "hand");
  for (const cardId of opts.oppEnergy ?? []) stageOnRules(r, "p2", cardId, "energy");
  for (const cardId of opts.oppBattle ?? []) stageOnRules(r, "p2", cardId, "battle");
  return r;
}

/** p1's Main Phase on turn 3 with the staged cards, the dealt filler left in both hands. */
function arenaG(opts: ArenaOpts = {}): EngineState {
  return arenaOnRules(opts);
}

/**
 * `arenaG`'s board with the dealt filler put back: p1's dealt V1s go to the
 * bottom of the deck (unless V1 was asked for) and so does every one of p2's
 * dealt V-BLUEs, which is what the suites that count hands, read `hand[0]` and
 * draw the contract fixtures from were written against.
 */
function stagedG(opts: ArenaOpts = {}): EngineState {
  const r = arenaOnRules(opts);
  for (const id of r.sides.p1.zones.hand.slice()) if (r.cards[id].cardId === "V1" && !(opts.hand ?? []).includes("V1")) moveCard(r, DBS_DEFINITION, id, "deck", { position: "bottom" });
  for (const id of r.sides.p2.zones.hand.slice()) if (r.cards[id].cardId === "V-BLUE") moveCard(r, DBS_DEFINITION, id, "deck", { position: "bottom" });
  return r;
}

/** Every card instance is in exactly one area (3-1). */
function assertConsistentG(s: EngineState): void {
  const seen = new Map<string, number>();
  for (const p of ["p1", "p2"] as PlayerId[]) {
    const all = [leaderOf(s, p), unisonOf(s, p), ...ZONE_AREAS.flatMap((a) => zoneOf(s, p, a))].filter(Boolean) as string[];
    for (const id of all) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const id of all) for (const u of s.cards[id].under) seen.set(u, (seen.get(u) ?? 0) + 1);
  }
  for (const id of Object.keys(s.cards)) assert.equal(seen.get(id), 1, `${id} is in exactly one place (found ${seen.get(id) ?? 0})`);
}

/** Is this card anywhere on the board — a zone, the Leader/Unison scalar, or under another card? The one predicate `assertConsistentAfterDropG` needs, since a fixture that spliced a life array by hand leaves the card it removed in none of them. */
function isPlacedG(s: EngineState, id: string): boolean {
  for (const p of ["p1", "p2"] as PlayerId[]) {
    if (leaderOf(s, p) === id || unisonOf(s, p) === id) return true;
    if (ZONE_AREAS.some((a) => zoneOf(s, p, a).includes(id))) return true;
  }
  return Object.values(s.cards).some((c) => c.under.includes(id));
}

/** A fixture that removed life cards outright by splicing the array puts them in the Drop so the invariant holds. */
function assertConsistentAfterDropG(s: EngineState): void {
  const gone = Object.keys(s.cards).filter((id) => s.cards[id].owner === "p1" && !isPlacedG(s, id));
  zoneOf(s, "p1", "drop").push(...gone);
}

/** §3.2: no action in both lists, and no rejection without a reason, over `IMPL`. */
function assertDisjointG(s: EngineState, where: string): RejectedAction[] {
  const legal = IMPL.legalActions(CTX, s);
  const rejected = IMPL.rejectedActions(CTX, s, legal);
  assertMenuInvariants(legal, rejected, where);
  return rejected;
}

const DBS_DEFINITION = (() => {
  const r = rulesetFor("dbs");
  if (!r.ok) throw new Error(`the DBS ruleset did not load for the harness's own use: ${JSON.stringify(r.errors)}`);
  return r.definition;
})();

/** 23-2: a fixture reaching for one card under another directly, the way a card's own skill does through `moveCard`'s `under` option. */
function placeUnderG(s: EngineState, id: string, host: string): boolean {
  return moveCard(s, DBS_DEFINITION, id, "drop", { under: host }).ok;
}

/** Add a continuous effect. */
function addEffectG(s: EngineState, ev: GameEvent[], e: Parameters<typeof vmAddEffect>[2]): void {
  vmAddEffect(s, ev, e);
}

/** A card's power: the declared attribute (`attrsNow(...).power`). */
function powerOfG(s: EngineState, id: string): number {
  return Number(attrsNow(withTokens(CTX), DBS_DEFINITION, s, id).power ?? 0);
}

/** `hasKeyword` (`vm/program.ts`) reads the same three sources: a printed skill still showing, a `keyword`-kind effect, and a [Permanent] static, so a keyword copied on by `copySkills` reads the same way a printed one does. */
function hasG(s: EngineState, id: string, name: KeywordSkill["name"]): boolean {
  return vmHasKeyword(withTokens(CTX), DBS_DEFINITION, s, id, name);
}

/** Is this one skill negated. */
function skillNegatedG(s: EngineState, id: string, index: number, kind?: Parameters<typeof vmSkillNegated>[3]): boolean {
  return vmSkillNegated(s, id, index, kind);
}

/** 3-1-6, the side whose in-play area currently holds the card, else its owner. */
function masterOfG(s: EngineState, id: string): PlayerId {
  return vmMasterOf(DBS_DEFINITION, s, id);
}

/** 9-10's `life` event (#272), the replacements that answer a life card's own move to `dest`. */
function lifeReplacementChoicesForG(s: EngineState, id: string, dest: "hand" | "drop") {
  return vmLifeReplacementChoices(CTX, DBS_DEFINITION, s, id, dest);
}

/**
 * Test-only staging: relocate a card instance into a named zone — a raw splice like `stageOnRules`'s own above, not
 * a move a rule would make (no event, no moment, no reason). Used where a
 * fixture needs a card in the Drop or at the bottom of the deck before the
 * move under test runs, and the *how it got there* is not itself part of what
 * is being checked; `moveG` is the call for a fixture that needs the real mover.
 */
function stageMoveG(s: EngineState, id: string, area: ZoneArea, side: PlayerId): void {
  for (const p of ["p1", "p2"] as PlayerId[]) {
    for (const a of ZONE_AREAS) {
      const z = zoneOf(s, p, a);
      const i = z.indexOf(id);
      if (i >= 0) z.splice(i, 1);
    }
  }
  zoneOf(s, side, area).push(id);
}

// ── readers over the declared attributes (#459) ─────────────────────────────
//
// Each reads a staged board through the rules engine's declared reading
// (`attrsNow`, `cardPrice`, `forbids`, `findCard`, …).

/** A card's power with the context the caller staged (a fixture may compile its own rules). */
function powerIn(ctx: EngineContext, s: EngineState, id: string): number {
  return Number(attrsNow(withTokens(ctx), DBS_DEFINITION, s, id).power ?? 0);
}

/** `has`'s reading with the caller's own context — `hasG` with a context that is not `CTX`. */
function hasIn(ctx: EngineContext, s: EngineState, id: string, name: KeywordSkill["name"]): boolean {
  return vmHasKeyword(withTokens(ctx), DBS_DEFINITION, s, id, name);
}

/** The face a card shows now: the printed values with every layer over them, as the four attributes a fixture reads. */
function cardNowG(s: EngineState, id: string, ctx: EngineContext = CTX): Pick<CardDef, "name" | "colors" | "traits" | "characters"> {
  const a = attrsNow(withTokens(ctx), DBS_DEFINITION, s, id);
  return { name: String(a.name ?? ""), colors: (a.colors ?? []) as CardDef["colors"], traits: (a.traits ?? []) as string[], characters: (a.characters ?? []) as string[] };
}

/** Does this card, as it stands, match the filter — the declared predicate over `attrsNow`. */
function matchesG(s: EngineState, id: string, filter: CardFilter, ctx: EngineContext = CTX): boolean {
  return vmPredicateOf(filter, DBS_DEFINITION)(attrsNow(withTokens(ctx), DBS_DEFINITION, s, id));
}

/** The play cost's two halves: the total and the coloured (specified) part, off `cardPrice`. */
function playCostG(s: EngineState, id: string): { total: number; specified: Partial<Record<string, number>> } {
  const p = vmCardPrice(withTokens(CTX), DBS_DEFINITION, s, id);
  return { total: p.total, specified: p.orbs };
}

/** 20-21's combo cost in force — the declared `comboCostOf` attribute. */
function comboCostOfG(s: EngineState, id: string): number {
  return Number(attrsNow(withTokens(CTX), DBS_DEFINITION, s, id).comboCostOf ?? 0);
}

/** 20-21's Z-Energy cost in force — the declared `zEnergyCostOf` attribute. */
function zEnergyCostOfG(s: EngineState, id: string): number {
  return Number(attrsNow(withTokens(CTX), DBS_DEFINITION, s, id).zEnergyCostOf ?? 0);
}

/** 20-14's prohibition reader. */
function forbidsG(s: EngineState, what: Parameters<typeof vmForbids>[3], opts: { player?: PlayerId; card?: string; bySkill?: boolean } = {}): boolean {
  return vmForbids(withTokens(CTX), DBS_DEFINITION, s, what, opts);
}

/** 9-1-5: are all of this card's skills negated. */
function skillsNegatedG(s: EngineState, id: string): boolean {
  return vmSkillsNegated(s, id);
}

/** Where a card is — which area and where in it — or null for a card under another card or out of every zone. */
function locateG(s: EngineState, id: string): { area: string; index: number } | null {
  const at = vmFindCard(s, id);
  return at ? { area: at.zone, index: at.index } : null;
}

/** 5-12: KO a card, the way a rule does — through the engine's own KO, with its moments and replacements. */
function koCardG(s: EngineState, id: string, ev: GameEvent[] = [], ctx: EngineContext = CTX): void {
  vmKoCard(withTokens(ctx), DBS_DEFINITION, s, ev, id);
}

/**
 * A fixture's own move of one card to a named area of a side through the rules
 * engine's one mover `moveCard`, which records a replacement and applies none.
 */
function moveG(s: EngineState, id: string, area: ZoneArea | "unison", side: PlayerId, opts: { position?: "top" | "bottom"; reason?: "effect" } = {}, ctx: EngineContext = CTX): void {
  void ctx;
  const r = moveCard(s, DBS_DEFINITION, id, area, { owner: side, position: opts.position });
  assert.ok(r.ok, `the fixture could not move ${id} to ${side}'s ${area}: ${r.ok ? "" : r.refused}`);
}

/** A rule-procedure move with no acting skill, used to check replacement cause scope. */
export function moveByRuleG(s: EngineState, id: string, area: ZoneArea, side: PlayerId, ctx: EngineContext = CTX): void {
  vmMoved(ctx, DBS_DEFINITION, s, [], id, area, { owner: side, reason: "rule" });
}

/** 20-15: write a delayed effect down. */
function scheduleG(s: EngineState, ev: GameEvent[], spec: Parameters<typeof vmSchedule>[2]): void {
  vmSchedule(s, ev, spec);
}

/**
 * The moment a trigger name stands for, as `dbs/triggers.rules`
 * declares it — only the two `verify/lang.ts` fires by hand.
 */
const MOMENT_FOR: Partial<Record<Trigger, (card: string, controller: PlayerId) => VmMoment>> = {
  played: (card, controller) => ({ event: "moved", card, controller, args: { to: "battle", asPlay: true } }),
  attacks: (card, controller) => ({ event: "attackDeclared", card, controller, args: { role: "attacker" } }),
};

/** Ask the board whether anything answers to `trigger` happening to `card`, and return how many [Auto] skills were pended — the declared moment fired. The pending list is cleared first. */
function pendedG(ctx: EngineContext, s: EngineState, trigger: Trigger, card: string): number {
  s.pending = [];
  const moment = MOMENT_FOR[trigger];
  assert.ok(moment, `pendedG has no declared moment for ${trigger}`);
  vmFire(withTokens(ctx), DBS_DEFINITION, s, moment(card, s.cards[card].owner));
  return s.pending.length;
}

/**
 * Every case a suite could not assert on the rules engine, named where it is
 * skipped. Each entry is a rules-engine gap a real game would hit too (an
 * unread static, a missing window), never a fixture that merely has not been
 * ported: `verify-arena.ts` prints the list at the end of a run.
 */
const RULES_GAPS: string[] = [];
function rulesGap(where: string, _what: string, _issue: string): boolean {
  if (!_what.trim() || !_issue.trim()) throw new Error(`rulesGap ${where} needs its behavior note and owner note`);
  const row = capabilityForSkip(where);
  const line = `${row.id} [${row.status}; ${row.citation}; owner #${row.ownerIssue}]: ${row.label} — ${row.detail}`;
  console.log(`  skipped case — ${line}`);
  RULES_GAPS.push(line);
  return true;
}

/** 19-1: is this instance a token — the id its definition is encoded in. */
function isTokenG(s: EngineState, id: string): boolean {
  return vmIsTokenCard(s.cards[id].cardId);
}

/** One side's whole board as plain data — every area, the Leader and Unison, the energy markers — for a fixture that asserts nothing about a side changed. */
function sideG(s: EngineState, p: PlayerId): Record<string, unknown> {
  return { leader: leaderOf(s, p), unison: unisonOf(s, p), energyMarkers: energyMarkersOf(s, p), ...Object.fromEntries(ZONE_AREAS.map((a) => [a, [...zoneOf(s, p, a)]])) };
}

/**
 * Pass every combo prompt a battle puts up, whoever it is put to, until the
 * battle moves on. The engine skips a combo step nobody can use
 * (`vm/battle.ts`'s `comboWork`, the probe sweep's `empty-combo-prompt` cause)
 * — so a fixture names the outcome rather than the number of questions.
 */
function passCombosG(s: EngineState): EngineState {
  for (let i = 0; i < 4 && s.prompt.kind === "combo"; i++) s = playG(s, { type: "pass", player: (s.prompt as { player: PlayerId }).player });
  return s;
}

export {
  COND_CLASS,
  COND_SCHEMA,
  CONDITIONS_OFF_A_CARD,
  CTX,
  DBS_DEFINITION,
  DEFAULT_LIGHTING,
  DEFS,
  EFFECT_LANGUAGE,
  KEYWORDS,
  LEADER_COLOURS,
  LIGHTING_VERSION,
  OP_CLASS,
  OP_SCHEMA,
  RIVAL,
  TONES,
  IMPL,
  actsG,
  addEffectG,
  appendBeats,
  arenaG,
  stagedG,
  assertConsistentAfterDropG,
  assertConsistentG,
  assertDisjointG,
  assertMenuInvariants,
  canActivateG,
  autoTriggerMatches,
  buildSnapshot,
  canonical,
  card,
  cardKeyOf,
  clauseShape,
  colourOf,
  compileCostProgram,
  compileSkill,
  condSignature,
  costIsOnlyOrbs,
  costText,
  defsFrom,
  describeCond,
  describeScript,
  describeTrigger,
  eitherOrbsIn,
  encodeLighting,
  energyMarkersOf,
  fifty,
  findG,
  passCombosG,
  isTokenG,
  sideG,
  rulesGap,
  RULES_GAPS,
  pendedG,
  forbidsG,
  cardNowG,
  comboCostOfG,
  hasIn,
  koCardG,
  locateG,
  matchesG,
  moveG,
  playCostG,
  powerIn,
  scheduleG,
  skillsNegatedG,
  zEnergyCostOfG,
  lifeReplacementChoicesForG,
  gameG,
  hasG,
  hoist,
  keywordOf,
  keywordPlays,
  keywordTagSpellings,
  keywordsByGroup,
  labelsG,
  leaderOf,
  lightingFrom,
  maskBeats,
  masterOfG,
  matches,
  mechanismOf,
  missingEnergyChip,
  missingEnergyChips,
  mix,
  narrate,
  opSignature,
  orbsIn,
  parseCondition,
  parseConditionClause,
  parseFilter,
  parseSkills,
  parseTarget,
  patternKey,
  pill,
  placeUnderG,
  rejectedActionsG,
  setEnergyMarkersG,
  playG,
  powerOfG,
  priceCondition,
  priceOf,
  priceX,
  programShape,
  refusal,
  rejectedFor,
  rulesFromCompiler,
  seedFrom,
  sentence,
  skillLines,
  skillNegatedG,
  skillRecords,
  splitClauses,
  stageMoveG,
  stepText,
  tagBody,
  tagParsesTo,
  toneFor,
  trailingTrigger,
  triggersOf,
  turnVars,
  unisonOf,
  validate,
  waitingFor,
  zoneOf,
};
export type { Action, Beat, Beats, CardDef, CardFilter, EngineState, NumberedBeat, PlayerId, RejectedAction, Requirement, SchemaOp, Snapshot, Trigger, VmState };
