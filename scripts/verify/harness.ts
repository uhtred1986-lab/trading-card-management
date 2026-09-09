/**
 * What every arena check is built on: the synthetic cards, the staged game and
 * the assertions more than one file makes.
 *
 * The checks themselves live in the files beside this one and run in the order
 * `scripts/verify-arena.ts` imports them — which matters, because the blocks
 * add cards to `DEFS` as they go and `CTX` compiles them lazily.
 */
import assert from "node:assert/strict";
import {
  apply,
  createGame,
  defsFrom,
  legalActions,
  rejectedActions,
  seedFrom,
  type Action,
  type CardDef,
  type GameState,
  type PlayerId,
  type RejectedAction,
  type Requirement,
} from "../../src/lib/arena/engine";
import { appendBeats, maskBeats, toBeats, type Beat, type Beats, type NumberedBeat } from "../../src/lib/arena/beats";
import { buildSnapshot, rejectedFor, waitingFor, type Snapshot } from "../../src/lib/arena/snapshot";
import { boardView } from "../../src/lib/arena/view";
import { pill, priceOf, refusal, sentence, stepText } from "../../src/lib/arena/wording";
import { narrate } from "../../src/lib/arena/narration";
import { colourOf, DEFAULT_LIGHTING, encodeLighting, LEADER_COLOURS, lightingFrom, LIGHTING_VERSION, mix, RIVAL, toneFor, TONES, turnVars } from "../../src/lib/arena/lighting";
import { trailingTrigger, parseSkills, keywordOf, orbsIn, eitherOrbsIn, skillLines } from "../../src/lib/arena/engine/cards";
import { KEYWORDS, keywordTagSpellings, keywordsByGroup, tagBody, tagParsesTo } from "../../src/lib/arena/glossary";
import { parseFilter, matches, parseCondition, type CardFilter } from "../../src/lib/arena/engine/filters";
import { addEffect, schedule, move, locate, placeUnder, playCost, powerOf, forbids, has, cardNow, comboCostOf, skillNegated, skillsNegated } from "../../src/lib/arena/engine/state";
import { compileCostProgram, compileSkill, costIsOnlyOrbs, costText, parseConditionClause, parseTarget, priceCondition, splitClauses } from "../../src/lib/arena/engine/compile";
import { COND_SCHEMA, OP_SCHEMA, condSignature, describeCond, describeScript, opSignature, validateProgram as validate, type Op as SchemaOp } from "../../src/lib/arena/engine/script";
import { autoTriggerMatches, koCard } from "../../src/lib/arena/engine/triggers";
import type { Trigger } from "../../src/lib/arena/engine/types";
import { canonical, hoist, patternKey, programShape, rulesFromCompiler, skillRecords } from "../../src/lib/arena/draft";
import { keywordPlays } from "../../src/lib/arena/glossary";
import { EFFECT_LANGUAGE } from "../../src/lib/arena/ai/opponent";
import { clauseShape, describeTrigger, mechanismOf, triggersOf } from "../../src/lib/arena/gaps";
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
  card("EVO", { energyCost: 3, power: 20000, skill: "[Evolve]{1}: <V1>" }),
  // 22-22: swaps itself for a cost-3 Battle Card in hand. "BIG" is the only
  // cost-3 card in DEFS, so a hand without one has nothing to reveal.
  card("SWAPPER", { energyCost: 2, power: 15000, skill: "[Swap 3]{1}: Red <V1> with an energy cost of 3." }),
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
]);
// What a real game gets from `card_rules` once every card is drafted: the
// tests need no database, so the drafter's own compile stands in for the rows
// (lazily, because tests below add cards to DEFS as they go).
const CTX = { defs: DEFS, scripts: rulesFromCompiler(DEFS) };

const fifty = (id: string) => Array.from({ length: 50 }, () => id);

function game(seed = 1, p1 = fifty("V1"), p2 = fifty("V-BLUE"), z: string[] = []) {
  return createGame(CTX, { seed, p1: { name: "You", leader: "L-RED", main: p1, z }, p2: { name: "Claude", leader: "L-BLUE", main: p2 } }).state;
}

/** Apply a list of actions, asserting each is legal. */
function play(s: GameState, ...actions: Action[]): GameState {
  for (const a of actions) s = apply(CTX, s, a).state;
  return s;
}

function labels(s: GameState): string[] {
  return legalActions(CTX, s).map((a) => a.label);
}

/** Every card instance is in exactly one area (3-1). */
function assertConsistent(s: GameState): void {
  const seen = new Map<string, number>();
  for (const p of ["p1", "p2"] as PlayerId[]) {
    const ps = s.players[p];
    const all = [ps.leader, ps.unison, ...ps.deck, ...ps.hand, ...ps.drop, ...ps.warp, ...ps.life, ...ps.battle, ...ps.combo, ...ps.energy, ...ps.zDeck, ...ps.zEnergy, ...ps.removed].filter(
      Boolean,
    ) as string[];
    for (const id of all) seen.set(id, (seen.get(id) ?? 0) + 1);
    for (const id of all) for (const u of s.cards[id].under) seen.set(u, (seen.get(u) ?? 0) + 1);
    // 3-9 sets no ceiling on life: [Rejuvenate] and "place the top card of
    // your deck in your Life Area" can take it past the 8 it starts with.
  }
  for (const id of Object.keys(s.cards)) assert.equal(seen.get(id), 1, `${id} is in exactly one place (found ${seen.get(id) ?? 0})`);
}

/** A game already in p1's Main Phase on turn 3 with a chosen hand and energy. */
function arena(opts: { hand?: string[]; energy?: string[]; battle?: string[]; oppHand?: string[]; oppBattle?: string[]; oppEnergy?: string[]; z?: string[] } = {}): GameState {
  let s = game(7, fifty("V1"), fifty("V-BLUE"), opts.z);
  const chooser = (s.prompt as { player: PlayerId }).player;
  s = play(s, { type: "chooseFirst", player: chooser, first: "p1" }, { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false });
  s = play(s, { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" });
  s = play(s, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" });
  s = play(s, { type: "charge", player: "p1", card: null });
  assert.equal(s.prompt.kind, "main");
  // Set the table by hand: swap deck cards for the wanted definitions and move them.
  const ctx = CTX;
  const give = (p: PlayerId, ids: string[], area: "hand" | "energy" | "battle") => {
    for (const cardId of ids) {
      const inst = s.players[p].deck.find((id) => s.cards[id].cardId === "V1" || s.cards[id].cardId === "V-BLUE")!;
      s.cards[inst].cardId = cardId;
      move(ctx, s, [], inst, area, p);
    }
  };
  give("p1", opts.hand ?? [], "hand");
  give("p1", opts.energy ?? [], "energy");
  give("p1", opts.battle ?? [], "battle");
  give("p2", opts.oppHand ?? [], "hand");
  give("p2", opts.oppEnergy ?? [], "energy");
  give("p2", opts.oppBattle ?? [], "battle");
  for (const id of s.players.p1.hand.slice()) if (s.cards[id].cardId === "V1" && !(opts.hand ?? []).includes("V1")) move(ctx, s, [], id, "deck", "p1", { position: "bottom" });
  for (const id of s.players.p2.hand.slice()) if (s.cards[id].cardId === "V-BLUE") move(ctx, s, [], id, "deck", "p2", { position: "bottom" });
  return s;
}

const find = (s: GameState, p: PlayerId, area: "hand" | "battle" | "energy" | "zDeck", cardId: string) => s.players[p][area].find((id) => s.cards[id].cardId === cardId)!;

function assertConsistentAfterDrop(s: GameState) {
  // The test removed life cards outright; put them in the drop so the invariant holds.
  const gone = Object.keys(s.cards).filter((id) => s.cards[id].owner === "p1" && !locate(s, id));
  s.players.p1.drop.push(...gone);
}

const acts = (s: GameState) => legalActions(CTX, s).map((a) => a.action);
const canActivate = (s: GameState, card: string) => acts(s).some((a) => a.type === "activate" && a.card === card);

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

/** No action in both lists, and no rejection without a reason. Run over every state a fixture holds. */
function assertDisjoint(s: GameState, where: string): RejectedAction[] {
  const ctx = CTX;
  const legal = legalActions(ctx, s);
  const rejected = rejectedActions(ctx, s, legal);
  const offered = new Set(legal.map((l) => JSON.stringify(l.action)));
  const keys = new Set<string>();
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
  return rejected;
}

export {
  COND_SCHEMA,
  CTX,
  DEFAULT_LIGHTING,
  DEFS,
  EFFECT_LANGUAGE,
  KEYWORDS,
  LEADER_COLOURS,
  LIGHTING_VERSION,
  OP_SCHEMA,
  RIVAL,
  TONES,
  acts,
  addEffect,
  appendBeats,
  apply,
  arena,
  assertConsistent,
  assertConsistentAfterDrop,
  assertDisjoint,
  autoTriggerMatches,
  boardView,
  buildSnapshot,
  canActivate,
  canonical,
  card,
  cardKeyOf,
  cardNow,
  clauseShape,
  colourOf,
  comboCostOf,
  compileCostProgram,
  compileSkill,
  condSignature,
  costIsOnlyOrbs,
  costText,
  createGame,
  defsFrom,
  describeCond,
  describeScript,
  describeTrigger,
  eitherOrbsIn,
  encodeLighting,
  fifty,
  find,
  forbids,
  game,
  has,
  hoist,
  keywordOf,
  keywordPlays,
  keywordTagSpellings,
  keywordsByGroup,
  koCard,
  labels,
  legalActions,
  lightingFrom,
  locate,
  maskBeats,
  matches,
  mechanismOf,
  mix,
  move,
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
  placeUnder,
  play,
  playCost,
  powerOf,
  priceCondition,
  priceOf,
  programShape,
  refusal,
  rejectedActions,
  rejectedFor,
  rulesFromCompiler,
  schedule,
  seedFrom,
  sentence,
  skillLines,
  skillNegated,
  skillRecords,
  skillsNegated,
  splitClauses,
  stepText,
  tagBody,
  tagParsesTo,
  toBeats,
  toneFor,
  trailingTrigger,
  triggersOf,
  turnVars,
  validate,
  waitingFor,
};
export type { Action, Beat, Beats, CardDef, CardFilter, GameState, NumberedBeat, PlayerId, RejectedAction, Requirement, SchemaOp, Snapshot, Trigger };
