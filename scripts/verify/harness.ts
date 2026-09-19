/**
 * What every arena check is built on: the synthetic cards, the staged game and
 * the assertions more than one file makes.
 *
 * The checks themselves live in the files beside this one and run in the order
 * `scripts/verify-arena.ts` imports them — which matters, because the blocks
 * add cards to `DEFS` as they go and `CTX` compiles them lazily.
 *
 * `--engine legacy|rules` on the command line picks the engine every suite
 * below creates and plays its games on, defaulting to `legacy` — the only
 * engine any of them has ever run on, and still what plain `npm test` runs
 * (`npm run test:rules` is `--engine rules`, `scripts/verify-arena.ts`).
 * Routing `createGame`/`apply`/`legalActions`/`rejectedActions` through
 * `engineFor(ENGINE)` here, once, is what lets `game()`, `arena()` and
 * `play()` stay engine-agnostic rather than every suite importing the switch
 * itself. `createGame` and `apply` still hand back a `GameState` — every
 * fixture below reads one directly (`s.prompt`, `s.players`, `move()`, …) —
 * so a state the rules engine dealt is named by `legacyState` as an
 * `EngineMismatch` rather than read field by field as `undefined`; that is
 * the whole of what "runs on rules" means for these suites today; `vm.ts` and
 * `rulesets.ts` name an engine explicitly instead of reading `ENGINE`,
 * because proving the switch itself must not depend on which side of it
 * happens to be selected.
 */
import assert from "node:assert/strict";
import {
  defsFrom,
  seedFrom,
  type Action,
  type CardDef,
  type EngineContext,
  type GameEvent,
  type GameOptions,
  type GameState,
  type LegalAction,
  type PlayerId,
  type RejectedAction,
  type Requirement,
} from "../../src/lib/arena/engine";
import { DEFAULT_ENGINE, engineFor, isEngineId, isVmState, legacyState, type EngineId, type EngineState } from "../../src/lib/arena/engines";
import type { VmState } from "../../src/lib/arena/vm/state";
import { moveCard } from "../../src/lib/arena/vm/zones";
import { attrsNow } from "../../src/lib/arena/vm/program";
import { addEffect as vmAddEffect, skillNegated as vmSkillNegated } from "../../src/lib/arena/vm/effects";
import { hasKeyword as vmHasKeyword } from "../../src/lib/arena/vm/program";
import { rulesetFor } from "../../src/lib/arena/rulesets";
import { appendBeats, maskBeats, toBeats, type Beat, type Beats, type NumberedBeat } from "../../src/lib/arena/beats";
import { buildSnapshot, rejectedFor, waitingFor, type Snapshot } from "../../src/lib/arena/snapshot";
import { boardView } from "../../src/lib/arena/view";
import { missingEnergyChip, missingEnergyChips, pill, priceOf, refusal, sentence, stepText } from "../../src/lib/arena/wording";
import { narrate } from "../../src/lib/arena/narration";
import { colourOf, DEFAULT_LIGHTING, encodeLighting, LEADER_COLOURS, lightingFrom, LIGHTING_VERSION, mix, RIVAL, toneFor, TONES, turnVars } from "../../src/lib/arena/lighting";
import { trailingTrigger, parseSkills, keywordOf, orbsIn, eitherOrbsIn, skillLines } from "../../src/lib/arena/engine/cards";
import { KEYWORDS, keywordTagSpellings, keywordsByGroup, tagBody, tagParsesTo } from "../../src/lib/arena/glossary";
import { parseFilter, matches, parseCondition, type CardFilter } from "../../src/lib/arena/engine/filters";
import { addEffect, schedule, move, locate, placeUnder, planPayment, playCost, powerOf, forbids, has, cardNow, comboCostOf, zEnergyCostOf, skillNegated, skillsNegated, lifeReplacementChoicesFor } from "../../src/lib/arena/engine/state";
import { compileCostProgram, compileSkill, costIsOnlyOrbs, costText, parseConditionClause, parseTarget, priceCondition, priceX, splitClauses } from "../../src/lib/arena/engine/compile";
import { COND_CLASS, COND_SCHEMA, CONDITIONS_OFF_A_CARD, OP_CLASS, OP_SCHEMA, condSignature, describeCond, describeScript, opSignature, validateProgram as validate, type Op as SchemaOp } from "../../src/lib/arena/engine/script";
import { autoTriggerMatches, koCard, masterOf } from "../../src/lib/arena/engine/triggers";
import { masterOf as vmMasterOf } from "../../src/lib/arena/vm/triggers";
import type { KeywordSkill, Trigger } from "../../src/lib/arena/engine/types";
import { canonical, hoist, patternKey, programShape, rulesFromCompiler, skillRecords } from "../../src/lib/arena/draft";
import { keywordPlays } from "../../src/lib/arena/glossary";
import { EFFECT_LANGUAGE } from "../../src/lib/arena/ai/opponent";
import { clauseShape, describeTrigger, mechanismOf, triggersOf } from "../../src/lib/arena/gaps";

// ── the engine every suite below plays on ───────────────────────────────────

const engineArg = process.argv.indexOf("--engine");
const engineValue = engineArg >= 0 ? process.argv[engineArg + 1] : undefined;
if (engineValue !== undefined && !isEngineId(engineValue)) throw new Error(`--engine must be one of legacy, rules; got ${engineValue}`);
export const ENGINE: EngineId = engineValue ?? DEFAULT_ENGINE;
const IMPL = engineFor(ENGINE);

function createGame(ctx: EngineContext, options: GameOptions): { state: GameState; events: GameEvent[] } {
  const made = IMPL.createGame(ctx, options);
  return { state: legacyState(made.state), events: made.events };
}
function apply(ctx: EngineContext, state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  const made = IMPL.apply(ctx, state, action);
  return { state: legacyState(made.state), events: made.events };
}
function legalActions(ctx: EngineContext, state: GameState): LegalAction[] {
  return IMPL.legalActions(ctx, state);
}
function rejectedActions(ctx: EngineContext, state: GameState, legal: LegalAction[] = legalActions(ctx, state)): RejectedAction[] {
  return IMPL.rejectedActions(ctx, state, legal);
}

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

/**
 * §3.2, over two lists and nothing else.
 *
 * Taken as the two lists rather than as a state so the *same* assertion runs on
 * either engine: the legacy engine's fixtures below hand it a `GameState`'s
 * menu, and `verify/vm.ts` hands it a rules game's, which is built from
 * `DEFINE ACTION` declarations instead of from a predicate and its `whyNot`
 * twin (#144). One promise, one function, two interpreters — a second copy
 * would be the workflow spec asserted twice and agreed with once.
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

/** No action in both lists, and no rejection without a reason. Run over every state a fixture holds. */
function assertDisjoint(s: GameState, where: string): RejectedAction[] {
  const ctx = CTX;
  const legal = legalActions(ctx, s);
  const rejected = rejectedActions(ctx, s, legal);
  assertMenuInvariants(legal, rejected, where);
  return rejected;
}

// ── the state interface (#152): the same staging helpers, on either engine ──
//
// Everything above this line reads and writes `GameState` directly — `game`,
// `arena`, `play`, `find`, `labels` and the assertions built on them — and
// stays exactly as it was: every other suite (`setup`, `compiler`, `keywords`,
// `readings`, `wordings`, `contract`, `deck-api`, `language`) still imports
// those, still narrows through `legacyState`, and is still meant to read
// `skipped — EngineMismatch` under `--engine rules` until its own stage lands.
// Changing what they narrow to is not this issue's to do.
//
// What *is* this issue's: `battles.ts` and `workflow.ts` need the same fixture
// vocabulary — a board staged to a name, a card found by its catalog id, the
// menu read off it — built once, generically, rather than each suite (or each
// one, copying `verify/vm.ts`'s own local `stage`/`atMain`/`legacyBoard`)
// growing its own copy. The names below are deliberately the `G` (generic)
// twin of the function above them with the same job: `gameG`/`arenaG` for
// `game`/`arena`, `playG` for `play`, `findG` for `find`, `labelsG`/`actsG`/
// `canActivateG` for `labels`/`acts`/`canActivate`.
//
// **The fields that differ.** `EngineState`'s own doc (`engines.ts`) already
// names what the two shapes share by name — `prompt`, `battle`, `winner`,
// `overReason`, `phase`, `turn`, `turnPlayer`, `effects` — and #152 adds
// `cards[id].{mode,markers,under,flipped,faceUp,hidden,battledThisTurn}` to
// that list (the last one ported from `NARROWER` to real by this same issue,
// `vm/zones.ts`). Those are read directly off `EngineState` below with no
// branch, because they *are* the same field. What is not the same field is an
// **area**: `players[p][area]` (legacy) against `sides[p].zones[area]` (rules)
// — `zoneOf`/`leaderOf`/`unisonOf` are the one seam a caller needs, mirroring
// `sideName`/`damageTaken`'s own precedent in `engines.ts` for a field the two
// engines keep under a different name.
//
// **Why `arenaG`'s two branches stay two branches rather than one generic
// mover.** The legacy branch delegates to `arena` above, unchanged, because
// that fixture stages a card through the real `move()` — zone-entry moments
// included — and nothing about this issue asks it to stage more cheaply than
// it already does. The rules branch is `verify/vm.ts`'s own `stage`/`atMain`
// (§23/§24), moved here rather than copied a third time: a raw relabel-and-
// splice into the zone array, no moment fired, `mode` set active outside the
// hand — the same "kept local since only this suite needs it" fixture that
// file's own comment describes, now shared. The two fixtures were never going
// to produce identical events (one is the real move machinery, the other is a
// board built by hand for a test), so making them the same *function* would
// only hide that they are not the same *staging strategy* — the state
// interface is the seam, not a pretence that both engines set a table the
// same way.

type ZoneArea = "deck" | "hand" | "energy" | "battle" | "drop" | "warp" | "life" | "combo" | "zDeck" | "zEnergy" | "removed";
const ZONE_AREAS: ZoneArea[] = ["deck", "hand", "energy", "battle", "drop", "warp", "life", "combo", "zDeck", "zEnergy", "removed"];

/** A side's named area, off whichever shape wrote this state. The one seam every staging helper below goes through instead of reaching into `players`/`sides` itself. */
function zoneOf(s: EngineState, p: PlayerId, area: ZoneArea): string[] {
  return isVmState(s) ? (s.sides[p].zones[area] ??= []) : s.players[p][area];
}

/** The one card in the Leader Area — a scalar field on the legacy engine, a single-entry zone on the rules engine (8-1-1's own `zones.leader?.[0]` reading). */
function leaderOf(s: EngineState, p: PlayerId): string {
  return isVmState(s) ? s.sides[p].zones.leader![0] : s.players[p].leader;
}

/** The Unison in play, or none — the same scalar/zone difference `leaderOf` bridges. */
function unisonOf(s: EngineState, p: PlayerId): string | null {
  return isVmState(s) ? (s.sides[p].zones.unison?.[0] ?? null) : s.players[p].unison;
}

/** 1-14 energy markers — `state.sides[p].attrs.energyMarkers` (a declared `of: player` attribute) on the rules engine, `state.players[p].energyMarkers` on the legacy one. Read-only: a fixture that wants to set it uses `setEnergyMarkersG`. */
function energyMarkersOf(s: EngineState, p: PlayerId): number {
  return isVmState(s) ? Number(s.sides[p].attrs.energyMarkers ?? 0) : s.players[p].energyMarkers;
}
function setEnergyMarkersG(s: EngineState, p: PlayerId, n: number): void {
  if (isVmState(s)) s.sides[p].attrs.energyMarkers = n;
  else s.players[p].energyMarkers = n;
}

/** A fresh game on whichever engine `--engine` named — `IMPL.createGame` itself, undressed of the `legacyState` narrowing `game()` above applies. */
function gameG(seed = 1, p1 = fifty("V1"), p2 = fifty("V-BLUE"), z: string[] = []): EngineState {
  return IMPL.createGame(CTX, { seed, p1: { name: "You", leader: "L-RED", main: p1, z }, p2: { name: "Claude", leader: "L-BLUE", main: p2 } }).state;
}

/** Apply a list of actions on whichever engine `--engine` named, asserting each is legal (`IllegalAction`/`RulesetBroken` throw on their own). */
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

/** `verify/vm.ts` §23/§24's own `stage`, moved here so `battles.ts` and `workflow.ts` do not each grow a copy: one card moved from the deck into a named area, cardId swapped, mode set active outside the hand — a raw fixture, no moment fired. */
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

/** `verify/vm.ts` §23/§24's own `atMain`: p1's Main Phase, their second turn, on the rules engine. */
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

/** `arena()` above, on whichever engine `--engine` named — see the header comment above this section for why the two branches stage a board differently rather than sharing one mover. */
function arenaG(opts: ArenaOpts = {}): EngineState {
  return ENGINE === "rules" ? arenaOnRules(opts) : arena(opts);
}

/** Every card instance is in exactly one area (3-1) — `assertConsistent` above, generic over the area names `zoneOf` reads. */
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

/** `assertConsistentAfterDrop` above, generic: a fixture that removed life cards outright by splicing the array puts them in the Drop so the invariant holds. */
function assertConsistentAfterDropG(s: EngineState): void {
  const gone = Object.keys(s.cards).filter((id) => s.cards[id].owner === "p1" && !isPlacedG(s, id));
  zoneOf(s, "p1", "drop").push(...gone);
}

/** `assertDisjoint` above, over `IMPL` rather than the legacy-narrowed `legalActions`/`rejectedActions` module functions — the same §3.2 promise, on whichever engine staged the board. */
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

/**
 * `placeUnder` (`engine/state`) on whichever engine `--engine` named — a
 * fixture reaching for 23-2 directly, the way a card's own skill does through
 * `moveCard`'s `under` option (`vm/host.ts`'s `placeUnder`, #152).
 */
function placeUnderG(s: EngineState, id: string, host: string): boolean {
  if (isVmState(s)) return moveCard(s, DBS_DEFINITION, id, "drop", { under: host }).ok;
  return placeUnder(CTX, s, [], id, host);
}

/** `addEffect` above, on whichever engine `--engine` named — both take the identical `EffectSpec`/`Omit<ContinuousEffect,…>` shape, so a fixture's call site needs no change beyond which state it hands in. */
function addEffectG(s: EngineState, ev: GameEvent[], e: Parameters<typeof addEffect>[2]): void {
  if (isVmState(s)) vmAddEffect(s, ev, e);
  else addEffect(s, ev, e);
}

/** `powerOf` above, on whichever engine `--engine` named — `battle.ts`'s own local reading of `attrsNow(...).power`, the declared attribute rather than the legacy engine's own computed one. */
function powerOfG(s: EngineState, id: string): number {
  return isVmState(s) ? Number(attrsNow(CTX, DBS_DEFINITION, s, id).power ?? 0) : powerOf(CTX, s, id);
}

/** `has` above, on whichever engine `--engine` named — `hasKeyword` (`vm/program.ts`) reads the same three sources `has` does: a printed skill still showing, a `keyword`-kind effect, and a [Permanent] static, so a keyword copied on by `copySkills` reads the same way a printed one does. */
function hasG(s: EngineState, id: string, name: KeywordSkill["name"]): boolean {
  return isVmState(s) ? vmHasKeyword(CTX, DBS_DEFINITION, s, id, name) : has(CTX, s, id, name);
}

/** `skillNegated` above, on whichever engine `--engine` named. */
function skillNegatedG(s: EngineState, id: string, index: number): boolean {
  return isVmState(s) ? vmSkillNegated(s, id, index) : skillNegated(s, id, index);
}

/** `masterOf` above, on whichever engine `--engine` named — 3-1-6, the side whose in-play area currently holds the card, else its owner. The rules engine's own `masterOf` needs the `GameDefinition` triggers.ts already threads through everywhere else, so `DBS_DEFINITION` is bound here exactly as `powerOfG` binds it. */
function masterOfG(s: EngineState, id: string): PlayerId {
  return isVmState(s) ? vmMasterOf(DBS_DEFINITION, s, id) : masterOf(s, id);
}

/**
 * Test-only staging: relocate a card instance into a named zone, on whichever
 * engine `--engine` named — a raw splice like `stageOnRules`'s own above, not
 * a move a rule would make (no event, no moment, no reason). Used where a
 * fixture needs a card in the Drop or at the bottom of the deck before the
 * move under test runs, and the *how it got there* is not itself part of what
 * is being checked — `move(CTX, …)` remains the right call for a fixture that
 * needs the real thing (a reason, a position, an event log).
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

export {
  COND_CLASS,
  COND_SCHEMA,
  CONDITIONS_OFF_A_CARD,
  CTX,
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
  acts,
  actsG,
  addEffect,
  addEffectG,
  appendBeats,
  apply,
  arena,
  arenaG,
  assertConsistent,
  assertConsistentAfterDrop,
  assertConsistentAfterDropG,
  assertConsistentG,
  assertDisjoint,
  assertDisjointG,
  assertMenuInvariants,
  canActivateG,
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
  energyMarkersOf,
  fifty,
  find,
  findG,
  forbids,
  lifeReplacementChoicesFor,
  game,
  gameG,
  has,
  hasG,
  hoist,
  keywordOf,
  keywordPlays,
  keywordTagSpellings,
  keywordsByGroup,
  koCard,
  labels,
  labelsG,
  leaderOf,
  legalActions,
  lightingFrom,
  locate,
  maskBeats,
  masterOfG,
  matches,
  mechanismOf,
  missingEnergyChip,
  missingEnergyChips,
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
  placeUnderG,
  planPayment,
  rejectedActionsG,
  setEnergyMarkersG,
  play,
  playCost,
  playG,
  powerOf,
  powerOfG,
  priceCondition,
  priceOf,
  priceX,
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
  skillNegatedG,
  skillRecords,
  skillsNegated,
  splitClauses,
  stageMoveG,
  stepText,
  tagBody,
  tagParsesTo,
  toBeats,
  toneFor,
  trailingTrigger,
  triggersOf,
  turnVars,
  unisonOf,
  validate,
  waitingFor,
  zEnergyCostOf,
  zoneOf,
};
export type { Action, Beat, Beats, CardDef, CardFilter, EngineState, GameState, NumberedBeat, PlayerId, RejectedAction, Requirement, SchemaOp, Snapshot, Trigger, VmState };
