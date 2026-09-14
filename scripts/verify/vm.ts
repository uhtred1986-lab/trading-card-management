/**
 * The engine interface, and the rules engine's skeleton behind it.
 *
 * Two claims, and neither is about playing a game:
 *
 *  1. **An engine is six calls.** `snapshot.ts` needs a board drawn and
 *     `games.ts` needs beats made from a state neither can read, so those two
 *     belong to the interface beside the four that were always there. Both
 *     engines implement all six, and the legacy engine's are the very
 *     functions the old imports named — asserted by identity below, because
 *     "an adapter and nothing else" is a claim a test can actually check.
 *  2. **A rules game can be made, stored and read back.** `createGame` loads
 *     the DBS definition and returns a `VmState` that carries which engine
 *     wrote it and which game it was dealt from; it survives a round trip
 *     through JSON, which is what `arena_games.state` is. Every other call
 *     throws `NotYet` naming the issue that builds it, because a skeleton that
 *     answered 0 or `[]` would be indistinguishable from a game with nothing
 *     to do.
 *  3. **A card is a bag of declared attributes** (#139): the catalog adapter
 *     and `attributes.rules` account for each other in both directions, and a
 *     value the declarations do not describe costs that card one attribute and
 *     a line in the report — it does not stop a game.
 *  4. **A filter is a predicate over those attributes**, and it answers what
 *     the engine that has been playing answers. Asserted field by field over
 *     `FILTER_FIELDS`, because this is the one place the rules engine could
 *     start selecting *different* cards — which would show up as a card quietly
 *     doing the wrong thing rather than as a crash.
 *  5. **A side is a map of declared zones**, and `moveCard` is the only mover:
 *     what a zone's declaration says about single cards, modes, markers, order
 *     and hosting is honoured generically, and the replacement hook 9-10 needs
 *     is recorded rather than applied.
 *  6. **The opening board is the legacy engine's**, card for card, from the
 *     same seed. That is the measurement every later stage of the programme is
 *     taken against, which is why dealing came before the flow.
 *
 * What is deliberately *not* here: anything about how a rules game plays.
 * #140 runs the turn, #141 logs the events — and each brings its own suite.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { toBeats } from "../../src/lib/arena/beats";
import { IllegalAction, apply, createGame, legalActions, rejectedActions, type Action, type GameEvent, type GameState, type LegalAction } from "../../src/lib/arena/engine";
import {
  AVAILABLE_ENGINES,
  ENGINE_IDS,
  ENGINE_INFO,
  EngineMismatch,
  EngineNotBuilt,
  engineFor,
  legacyState,
  playableEngine,
  type Engine,
} from "../../src/lib/arena/engines";
import { boardView } from "../../src/lib/arena/view";
import { priceOf, refusal } from "../../src/lib/arena/wording";
import {
  FilterNeedsAttribute,
  actionCostOf,
  activeEnergy,
  cardPrice,
  chargeCost,
  chargesOf,
  freePrice,
  planCost,
  priceFor,
  type Price,
  type VmPayment,
  MEASURES,
  NotYet,
  RulesetBroken,
  VM_STATE_VERSION,
  actionsAt,
  applyDeclared,
  attrsOf,
  attributeGaps,
  attributesRead,
  cardAttributes,
  declaredLegalActions,
  declaredRejectedActions,
  deferredMeasures,
  emptyZones,
  findCard,
  hostOf,
  inPlayZones,
  isVmState,
  attributesRequired,
  fire,
  matchTriggers,
  measuresUsed,
  moveCard,
  moved,
  addEffect,
  attrsNow,
  dueDelays,
  forbids,
  endEffects,
  nextPending,
  permanents,
  placeZones,
  playerAttributes,
  predicateOf,
  repeatAllowed,
  run,
  stepWorkNote,
  turnPhases,
  schedule,
  vmHost,
  SETUP_ZONES,
  WORKED_STEPS,
  type Attrs,
  type VmState,
} from "../../src/lib/arena/vm";
import { loadRuleset, rulesetFor, type ActionDef, type GameDefinition } from "../../src/lib/arena/rulesets";
import { FILTER_FIELD_NAMES, parseDefinitions } from "../../src/lib/arena/lang";
import { emptyFilter, type CardFilter } from "../../src/lib/arena/engine/filters";
import { describePayment as legacyDescribe, paymentOptions as legacyOptions, planPayment, playCost, whyNotPay } from "../../src/lib/arena/engine/state";
import { paymentOptions as vmOptions } from "../../src/lib/arena/vm/costs";
import type { CardDef, Color, PlayerId, Requirement } from "../../src/lib/arena/engine/types";
import type { Op } from "../../src/lib/arena/engine/script";
import { CTX, DEFS, assertMenuInvariants, card, fifty, matches, parseSkills } from "./harness";

const DECKS = { seed: 11, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } };

// ── 1. an engine is six calls ──────────────────────────────────────────────

/** Every call the app makes through the switch. Typed off `Engine`, so widening the interface fails here until both engines implement it. */
const CALLS: (keyof Engine & string)[] = ["createGame", "apply", "legalActions", "rejectedActions", "boardView", "toBeats"];

for (const id of ENGINE_IDS) {
  const engine = engineFor(id);
  assert.equal(engine.id, id, `engineFor(${id}) handed back the ${engine.id} engine`);
  for (const call of CALLS) assert.equal(typeof engine[call], "function", `the ${id} engine has no ${call}`);
}

// The legacy engine is an adapter: each call *is* the function the old imports
// named, not a wrapper that could drift from it. This is what makes the
// contract fixtures and `arena:diff` a proof that widening the interface moved
// no behaviour.
{
  const legacy = engineFor("legacy");
  assert.equal(legacy.createGame, createGame, "the legacy adapter's createGame is not the engine's own");
  assert.equal(legacy.apply, apply, "the legacy adapter's apply is not the engine's own");
  assert.equal(legacy.legalActions, legalActions, "the legacy adapter's legalActions is not the engine's own");
  assert.equal(legacy.rejectedActions, rejectedActions, "the legacy adapter's rejectedActions is not the engine's own");
  assert.equal(legacy.boardView, boardView, "the legacy adapter's boardView is not view.ts's own");
  assert.equal(legacy.toBeats, toBeats, "the legacy adapter's toBeats is not beats.ts's own");
}

// ── 2. which engine may a new game be made on ──────────────────────────────

// Resolving the interpreter for a row and being allowed to start a game are
// two questions: `engineFor` answers the first for every id, `playableEngine`
// the second from the availability flag the `/arena` form greys the option by.
assert.equal(ENGINE_INFO.rules.available, false, "the rules engine says it is playable, and nothing plays on it yet");
assert.deepEqual(AVAILABLE_ENGINES, ["legacy"], "the engines a new game may be made on have changed");
assert.equal(playableEngine("legacy").id, "legacy", "the legacy engine is refused for a new game");
assert.throws(() => playableEngine("rules"), EngineNotBuilt, "a new game may be started on the rules engine");
assert.doesNotThrow(() => engineFor("rules"), "engineFor refuses the rules engine, so no row on it could ever be read");

// ── 3. a rules game can be made ────────────────────────────────────────────

const made = engineFor("rules").createGame(CTX, DECKS);
const state = made.state as VmState;

assert.ok(isVmState(state), "a rules game's state does not say which engine wrote it");
assert.equal(state.engine, "rules", "a rules game's state names the wrong engine");
// The definition's own id, read from `rulesets/dbs/`, not a literal repeated
// here: the arena plays the original game only (owner's decision, 4 Sep 2026).
assert.equal(state.game, "dbs", "a rules game was not dealt from the DBS definition");
assert.equal(state.seed, DECKS.seed, "a rules game did not keep the seed it was made from");
assert.equal(state.version, VM_STATE_VERSION, "a rules game's state does not say which shape it is written in");
// 6-2-1-4 is the first thing that happens and the only thing that has: the
// random method has picked who chooses, which the legacy engine logs the same
// way and at the same moment.
assert.deepEqual(made.events, [{ type: "gameStart", first: state.chooser, seed: DECKS.seed }], "a new rules game's log is not the one moment that has happened in it");
assert.equal(state.prompt.kind, "chooseFirst", "a new rules game is not waiting to be told who goes first (6-2-1-5)");
assert.equal(state.turn, 0, "a rules game has a turn number before the pre-game procedure has finished");

// `arena_games.state` is JSON, so a state that does not survive the round trip
// is a game that cannot be stored — the one property the skeleton must have.
assert.deepEqual(JSON.parse(JSON.stringify(state)), state, "a rules game's state does not round-trip through JSON");

// A legacy state carries no `engine` field, so the guard answers about one
// shape rather than guessing about the other. Built from the legacy
// `createGame` imported above rather than harness's `game()`, which this
// suite must not depend on: `game()` runs on whichever engine `--engine`
// named, and proving the switch cannot depend on which side of it is chosen.
assert.equal(isVmState(createGame(CTX, DECKS).state), false, "a legacy state was read as the rules engine's");
assert.equal(isVmState(null), false, "null was read as a rules state");
assert.equal(isVmState("rules"), false, "a string was read as a rules state");

// ── 4. what it cannot do yet says which issue builds it ───────────────────

// All six calls are answered now (#140); what is still missing is the *moves*
// with a price and a program, and each of those names the issue that builds
// it rather than failing as an unrecognised action. `NotYet` is an
// `IllegalAction`, so the API answers `illegal_action` and the client shows
// the sentence — the refusal a caller really gets, not a shortcut past it.
const rules = engineFor("rules");
const notYet: { what: string; run: () => unknown }[] = [
  { what: "attacking", run: () => rules.apply(CTX, state, { type: "attack", player: "p1", attacker: "p1#0", target: "p2#0" }) },
];
for (const { what, run } of notYet) {
  assert.throws(
    run,
    (err: unknown) => {
      assert.ok(err instanceof NotYet, `${what} on the rules engine threw ${err instanceof Error ? err.name : typeof err}, not NotYet`);
      assert.match(err.issue, /^#\d+$/, `${what} does not name the issue that builds it`);
      assert.ok(err.message.includes(err.issue), `${what}'s NotYet does not say which issue builds it in its own message`);
      assert.ok(err instanceof IllegalAction, "a NotYet is not an IllegalAction, so the API would answer it as a crash");
      return true;
    },
    `${what} on the rules engine was accepted`,
  );
}

// A move that *is* declared is refused with a sentence rather than named as
// missing work: playing is #146's paragraph in `actions.rules` and using a
// skill is #147's, so either sent during the pre-game procedure is an ordinary
// `IllegalAction` and not a `NotYet`. The difference matters to a client: one
// says "not yet", the other says why this move cannot be made now.
for (const [what, action] of [
  ["playing a card", { type: "play", player: "p1", card: "p1#1" }],
  ["using a skill", { type: "activate", player: "p1", card: "p1#1", skill: 0 }],
] as [string, Action][]) {
  assert.throws(
    () => rules.apply(CTX, state, action),
    (err: unknown) => {
      assert.ok(err instanceof IllegalAction, `${what} threw ${err instanceof Error ? err.name : typeof err}, not an IllegalAction`);
      assert.equal(err instanceof NotYet, false, `${what} is declared and was still named as work not done`);
      return true;
    },
    `${what} was accepted during the pre-game procedure`,
  );
}

// ── 5. a row is never replayed on the wrong interpreter ────────────────────

// The app around the six calls is still legacy-shaped (`games.ts` reads
// `state.turn`), so the seam is a check and not a cast: a rules state reaching
// it is named, not read field by field as `undefined`.
assert.throws(() => legacyState(state), EngineMismatch, "a rules state was read as the legacy engine's");
const legacy = createGame(CTX, DECKS).state;
assert.equal(legacyState(legacy), legacy, "a legacy state did not pass the seam untouched");



// ── 6. a card is a bag of declared attributes ──────────────────────────────

const dbs = rulesetFor("dbs");
assert.ok(dbs.ok, `the DBS ruleset did not load: ${dbs.ok ? "" : JSON.stringify(dbs.errors, null, 2)}`);
const DBS: GameDefinition = dbs.ok ? dbs.definition : (undefined as never);

// The claim that makes every attribute reading below trustworthy: the catalog
// adapter and `attributes.rules` account for each other. Reported by name in
// both directions — a count would say something changed and nothing about what.
assert.deepEqual(attributeGaps(DBS), { unfilled: [], undeclared: [] }, "the catalog adapter and attributes.rules do not describe the same card");
assert.deepEqual(playerAttributes(DBS), ["energyMarkers", "charged", "grewUnison"], "the player attributes of 1-14, 7-2-11 and 13-3 are not what the game declares");
assert.ok(cardAttributes(DBS).includes("costOf"), "the derived cost of 20-21 is not a declared card attribute");

{
  const attrsFor = (id: string): Attrs => attrsOf(DEFS[id], DBS).attrs;

  const v1 = attrsFor("V1");
  assert.equal(v1.id, "V1", "a card's attributes do not carry its number (2-14)");
  assert.equal(v1.type, "BATTLE");
  assert.deepEqual(v1.colors, ["Red"]);
  assert.equal(v1.energyCost, 1);
  assert.equal(v1.back, false, "a card with no back side says it has one (1-9)");
  assert.deepEqual(v1.alsoNames, [], "a catalog row arrives with names a skill has not given it yet (20-1)");
  // One entry per orb, which is what the declaration asks for: a cost-1 red
  // card demands one red orb by the convention `playCost` charges.
  assert.deepEqual(v1.specifiedCost, ["Red"], "the specified cost is not one entry per orb (1-2-3)");

  // A Leader has no energy cost at all, and an absent attribute is not zero:
  // "this card costs 0" is a claim about a card that has a cost.
  const leader = attrsFor("L-RED");
  assert.equal("energyCost" in leader, false, "a Leader Card was given an energy cost");
  assert.equal(leader.back, true, "a Leader with an awakened face says it has none (1-9)");

  // An X cost is absent for the same reason, and for one more: read as 0 here,
  // every "energy cost of 1 or less" selector in the catalog would start
  // matching X-cost cards, which the engine playing today does not do. The
  // value is named when the cost is paid (1-2-2-2), which is #140's.
  const x = attrsFor("U1");
  assert.equal("energyCost" in x, false, "an X cost was read as a number before anyone chose one (1-2-2-2)");
  assert.equal("specifiedCost" in x, false, "an X cost with no recorded orbs was given a coloured requirement anyway");

  // A player attribute is the side's, never a card's.
  assert.equal("energyMarkers" in v1, false, "a card was given the player's energy markers (1-14)");
  // And a derived cost is the board's: it has layers and no face of its own.
  assert.equal("costOf" in v1, false, "a card carries a price the effect layers have not been applied to (20-21)");
}

// A value the declarations do not describe costs that one attribute and a line
// in the report. Never a throw: one odd row out of 6,500 must not be what stops
// a game (the issue's "list them once at load, do not crash a game").
{
  const odd = { ...card("ODD", {}), power: "lots" as unknown as number };
  const read = attrsOf(odd, DBS);
  assert.equal("power" in read.attrs, false, "a power of the wrong type was kept anyway");
  assert.equal(read.problems.length, 1, "a value of the wrong type was not reported");
  assert.deepEqual({ ...read.problems[0], got: "" }, { card: "ODD", attr: "power", declared: "number", got: "" }, "the report does not name the card and the attribute");
  assert.match(read.problems[0].got, /lots/, "the report does not say what arrived");
  assert.equal(read.attrs.name, "ODD", "one bad value cost the card its other attributes");

  // A colour word the game does not use is as wrong as a number: a filter
  // asking for blue would silently miss it.
  const wrongColour = { ...card("PUCE", {}), colors: ["Puce"] as unknown as CardDef["colors"] };
  const colours = attrsOf(wrongColour, DBS);
  assert.equal("colors" in colours.attrs, false, "a colour the game does not declare was kept");
  assert.equal(colours.problems[0]?.attr, "colors");
}

// ── 7. a filter is a predicate over those attributes ───────────────────────

// The two tables that describe a filter — the language's (for printing) and
// this engine's (for playing) — are one list. A field described for one and
// forgotten by the other is a measure that prints and does not select.
assert.deepEqual(Object.keys(MEASURES).sort(), [...FILTER_FIELD_NAMES].sort(), "MEASURES and FILTER_FIELDS do not describe the same filter");

/**
 * One filter per field of `CardFilter`, each using that field and nothing else
 * (`multiColor` needs colours to be multi-coloured *of*). Keyed by the field so
 * a new measure fails the typecheck here until it is exercised, which is the
 * same discipline the tables keep.
 */
const FILTER_SAMPLES: Record<keyof CardFilter, Partial<CardFilter>> = {
  colors: { colors: ["Blue"] },
  notColors: { notColors: ["Red"] },
  monoColor: { monoColor: true },
  multiColor: { multiColor: true, colors: ["Red", "Blue"] },
  characters: { characters: ["V1"] },
  notCharacters: { notCharacters: ["V1"] },
  charactersIncluding: { charactersIncluding: ["BLOCK"] },
  notCharactersIncluding: { notCharactersIncluding: ["BLOCK"] },
  traits: { traits: ["Saiyan"] },
  notTraits: { notTraits: ["Saiyan"] },
  names: { names: ["BIG"] },
  notNames: { notNames: ["BIG"] },
  namesIncluding: { namesIncluding: ["CRIT"] },
  notNamesIncluding: { notNamesIncluding: ["CRIT"] },
  keywords: { keywords: ["Blocker"] },
  notKeywords: { notKeywords: ["Blocker"] },
  noKeywords: { noKeywords: true },
  skillKind: { skillKind: "activate" },
  type: { type: "BATTLE" },
  notType: { notType: "LEADER" },
  token: { token: true },
  notToken: { notToken: true },
  z: { z: true },
  costMin: { costMin: 2 },
  costMax: { costMax: 2 },
  powerMin: { powerMin: 15000 },
  powerMax: { powerMax: 10000 },
  originalPowerMin: { originalPowerMin: 15000 },
  originalPowerMax: { originalPowerMax: 10000 },
  originallySkillLess: { originallySkillLess: true },
  faceUp: { faceUp: true },
  powerRel: { powerRel: { of: "self", cmp: "<=" } },
  unreadable: { unreadable: true },
};

/**
 * The cards the corpus is measured over: every synthetic card the arena suites
 * use, plus the shapes they do not have — a trait, a second character, a name a
 * skill gave in all areas (20-1), a token, a Z-card, a multicolour card and a
 * card with no text box at all.
 *
 * Built here rather than added to `DEFS`, which other suites count.
 */
const CORPUS: CardDef[] = [
  ...Object.values(DEFS),
  card("TRAITED", { traits: ["Saiyan", "God"], characters: ["Son Goku", "Son Goku : GT"] }),
  card("RENAMED", { alsoNames: ["Planet M-2"] }),
  card("TOK", { type: "TOKEN", skill: null }),
  card("ZED", { type: "Z-BATTLE", zEnergyCost: 2 }),
  card("RAINBOW", { colors: ["Red", "Blue"], energyCost: 4, power: 20000 }),
  card("MUTE", { skill: null, characters: [] }),
];

for (const field of FILTER_FIELD_NAMES) {
  const filter = FILTER_SAMPLES[field];
  assert.ok(measuresUsed(filter).includes(field), `the sample filter for ${field} does not actually measure it`);

  // Every attribute the measure reads is one the game declares — which is what
  // makes the refusal below a load-time error rather than a card that never
  // matches anything.
  for (const attr of attributesRead(filter)) assert.ok(attr in DBS.attributes, `a filter measuring ${field} reads ${attr}, which the DBS ruleset does not declare`);

  const predicate = predicateOf(filter, DBS);
  for (const def of CORPUS) {
    const over = attrsOf(def, DBS).attrs;
    assert.equal(
      predicate(over),
      matches(def, { ...emptyFilter(), ...filter }),
      `the rules engine and the legacy engine disagree about whether ${def.id} satisfies ${JSON.stringify(filter)}`,
    );
  }
}

// The three measures a card's attributes cannot answer say so by name, with the
// reason each is left to the selector — they are not silently ignored.
for (const field of ["faceUp", "powerRel", "unreadable"] as const) {
  const deferred = deferredMeasures(FILTER_SAMPLES[field]);
  assert.deepEqual(
    deferred.map((d) => d.field),
    [field],
    `${field} is not reported as a measure the selector answers`,
  );
  assert.ok(deferred[0].reason.length > 20, `${field} is deferred without saying why`);
  assert.deepEqual(attributesRead(FILTER_SAMPLES[field]), [], `${field} claims to read a card attribute`);
}

// A filter naming an attribute the game lacks fails when the predicate is
// built, with the field *and* the attribute in the message. A predicate that
// answered `false` instead would turn one missing declaration into a whole set
// of rules that quietly selects nothing.
{
  const thin = loadRuleset({ "attributes.rules": 'DEFINE ATTRIBUTE name\n  of: card\n  value: string\n  printed: true\n  text: "the card name"\n' }, "dbs");
  assert.ok(thin.ok, `the one-attribute ruleset did not load: ${thin.ok ? "" : JSON.stringify(thin.errors)}`);
  if (thin.ok) {
    // A name measure needs the printed name and *widens* with the names a skill
    // gave in all areas (20-1): a game with no such mechanic still measures
    // printed names, so `alsoNames` is read where it exists and not required.
    assert.deepEqual(attributesRequired({ names: ["BIG"] }), ["name"], "a name measure cannot be answered without the also-names of 20-1");
    assert.deepEqual(attributesRead({ names: ["BIG"] }), ["name", "alsoNames"], "a name measure does not say it reads the also-names of 20-1");
    assert.doesNotThrow(() => predicateOf({ names: ["BIG"] }, thin.definition), "a filter measuring only a declared attribute was refused");
    assert.equal(predicateOf({ names: ["BIG"] }, thin.definition)({ name: "BIG" }), true, "a printed name could not be measured by a game with no also-names");
    assert.throws(
      () => predicateOf({ traits: ["Saiyan"] }, thin.definition),
      (err: unknown) => {
        assert.ok(err instanceof FilterNeedsAttribute, `a filter naming a missing attribute threw ${err instanceof Error ? err.name : typeof err}`);
        assert.equal(err.field, "traits");
        assert.equal(err.attribute, "traits");
        assert.match(err.message, /traits/, "the refusal does not name the attribute");
        return true;
      },
      "a filter measuring an attribute the game lacks was built anyway",
    );
    // A measure the filter does not use costs nothing: only what it asks about
    // has to be declared.
    assert.doesNotThrow(() => predicateOf(emptyFilter(), thin.definition), "a filter that measures nothing needed an attribute");
  }
}

// ── 8. a side is a map of declared zones ───────────────────────────────────

// The twelve areas of §3 plus `removed` (20-10). `play` and `under` are
// declared and are *not* places: the first is the word for three zones at once
// (9-1-3-1), the second the pile hanging off one card (23-2-2-2). Without the
// `place:` line this engine would have to know those two names.
{
  const places = placeZones(DBS);
  assert.equal(places.length, 13, `a side has ${places.length} zones, not 13`);
  for (const zone of ["deck", "hand", "drop", "leader", "battle", "combo", "energy", "life", "warp", "unison", "zDeck", "zEnergy", "removed"]) {
    assert.ok(places.includes(zone), `a side has no ${zone}`);
  }
  for (const zone of ["play", "under"]) {
    assert.ok(zone in DBS.zones, `the ruleset stopped declaring ${zone}, which programs name`);
    assert.equal(places.includes(zone), false, `${zone} is a pile cards are put in, and it is not one`);
  }
  assert.deepEqual(Object.keys(emptyZones(DBS)), places, "an empty side's zones are not the zones the game declares");
  // What the word `play` stands for, derived rather than listed (9-1-3-1).
  assert.deepEqual(inPlayZones(DBS), ["leader", "battle", "unison"], "the areas a card's own skills are valid in are not the three of 9-1-3-1");
}

// ── 9. the opening board is the legacy engine's ────────────────────────────

// Seed 7 and the harness decks, the pairing the issue names. Both engines deal
// the same procedure at the same moments now (#140 moved the rules engine's
// life and mulligan into the flow, where 6-2-1 puts them), so the same three
// answers are given to each and the boards are compared after them.
const SEED = 7;
const SAME = { seed: SEED, p1: { name: "You", leader: "L-RED", main: fifty("V1") }, p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") } };

const fresh = engineFor("rules").createGame(CTX, SAME).state as VmState;
assert.deepEqual(fresh.sides.p1.attrs, { energyMarkers: 0, charged: false, grewUnison: false }, "a side does not start with the player attributes the game declares (1-14, 7-2-11, 13-3)");

let oracle = createGame(CTX, SAME).state;
const chooser = (oracle.prompt as { player: PlayerId }).player;
assert.equal(fresh.chooser, chooser, "the two engines chose a different player to decide who goes first (6-2-1-4)");
assert.equal(fresh.firstPlayer, null, "the rules engine decided who goes first, which is a choice and needs a prompt (6-2-1-5)");

/** The three answers the pre-game procedure asks for, given to either engine. */
const OPENING: Action[] = [
  { type: "chooseFirst", player: chooser, first: "p1" },
  { type: "mulligan", player: "p1", redraw: false },
  { type: "mulligan", player: "p2", redraw: false },
];
for (const action of OPENING) oracle = apply(CTX, oracle, action).state;
let dealt = fresh;
for (const action of OPENING) dealt = engineFor("rules").apply(CTX, dealt, action).state as VmState;

// 6-2-1-11: the player who goes second starts with one energy marker, and the
// one who goes first with none — the rule `startMarkers:` cannot state, so the
// step says it and this is where that is checked.
assert.equal(dealt.sides.p2.attrs.energyMarkers, 1, "the player going second did not place an energy marker (6-2-1-11)");
assert.equal(dealt.sides.p1.attrs.energyMarkers, 0, "the player going first placed an energy marker (6-2-1-11)");
assert.equal(dealt.turn, 1, "the first turn did not begin once the pre-game procedure finished (6-2-1-12)");
assert.equal(dealt.turnPlayer, "p1", "the player who was chosen to go first is not the turn player");

for (const p of ["p1", "p2"] as PlayerId[]) {
  const side = dealt.sides[p];
  const them = oracle.players[p];
  assert.deepEqual(side.zones.hand, them.hand, `${p}'s opening hand is not the hand the legacy engine dealt from seed ${SEED}`);
  assert.deepEqual(side.zones.life, them.life, `${p}'s life pile is not the pile the legacy engine dealt from seed ${SEED}`);
  assert.deepEqual(side.zones.deck, them.deck, `${p}'s deck is not in the order the legacy engine shuffled it into from seed ${SEED}`);
  assert.deepEqual(side.zones.leader, [them.leader], `${p}'s Leader Card is not the one the legacy engine placed (6-2-1-2)`);
  assert.equal(side.zones.hand.length, DBS.game?.hand, "the opening hand is not the size the game declares (6-2-1-9)");
  assert.equal(side.zones.life.length, DBS.game?.life, "the life is not the size the game declares (6-2-1-10)");
}

// Every card in the game is in exactly one place, the invariant the fuzzer
// checks on the legacy engine after every move (3-1).
{
  const seen = new Map<string, number>();
  for (const p of ["p1", "p2"] as PlayerId[]) {
    for (const zone of Object.values(dealt.sides[p].zones)) for (const id of zone) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const c of Object.values(dealt.cards)) for (const u of c.under) seen.set(u, (seen.get(u) ?? 0) + 1);
  for (const id of Object.keys(dealt.cards)) assert.equal(seen.get(id), 1, `${id} is in ${seen.get(id) ?? 0} places, not 1 (3-1)`);
}

// ── 10. the one mover, on the board it just dealt ──────────────────────────

{
  let board = engineFor("rules").createGame(CTX, SAME).state as VmState;
  for (const action of OPENING) board = engineFor("rules").apply(CTX, board, action).state as VmState;
  const hand = board.sides.p1.zones.hand;
  const first = hand[0];

  // A zone's declared modes say what a card arriving is: the first of them, or
  // nothing at all where the zone declares none (1-10).
  assert.equal(board.cards[first].mode, null, "a card in the hand has a position, and the hand declares none");
  assert.ok(moveCard(board, DBS, first, "battle").ok);
  assert.equal(board.cards[first].mode, "active", "a card arriving in the Battle Area is not in the first mode it declares (3-6-1)");
  assert.deepEqual(findCard(board, first), { owner: "p1", zone: "battle", index: 0 });

  // A mode the zone does not declare is refused rather than written down.
  const nonsense = moveCard(board, DBS, first, "hand", { mode: "rest" });
  assert.equal(nonsense.ok, false, "a card was put in the hand in Rest Mode");
  if (!nonsense.ok) assert.match(nonsense.refused, /never rest/, "the refusal does not say what is wrong");

  // `single` is the leader and the Unison Area, and it is the declaration that
  // says so — not a `string | null` field (3-5-1, 3-11-4).
  const second = board.sides.p1.zones.hand[0];
  const squeezed = moveCard(board, DBS, second, "leader");
  assert.equal(squeezed.ok, false, "a second card was placed in the Leader Area");
  if (!squeezed.ok) assert.match(squeezed.refused, /holds one/, "the refusal does not say the zone holds one card");

  // Markers survive only where a zone declares them (1-11, 3-11-4).
  assert.ok(moveCard(board, DBS, second, "unison").ok);
  board.cards[second].markers = 3;
  assert.ok(moveCard(board, DBS, second, "drop").ok);
  assert.equal(board.cards[second].markers, 0, "markers followed a card into a zone that declares none (3-1-4)");

  // `ordered` piles are built from either end, and the rule being played says
  // which: the life is taken from the top of the deck and placed on top of the
  // pile (6-2-1-10), the way the legacy engine does it.
  const top = board.sides.p1.zones.drop[0];
  const other = board.sides.p1.zones.hand[0];
  assert.ok(moveCard(board, DBS, other, "drop", { position: "bottom" }).ok);
  assert.equal(board.sides.p1.zones.drop[0], top, "a card arriving at the bottom of a pile went on top of it");

  // 23-2: under a card that is in a zone declared `host: true`, and in no zone
  // of its own once it is there.
  const host = board.sides.p1.zones.battle[0];
  const buried = board.sides.p1.zones.hand[0];
  const under = moveCard(board, DBS, buried, "battle", { under: host });
  assert.ok(under.ok, `a card could not be placed under another: ${under.ok ? "" : under.refused}`);
  if (under.ok) assert.equal(under.move.under, host, "the move does not record which card it went under");
  assert.deepEqual(board.cards[host].under, [buried], "the host does not carry the card under it");
  assert.equal(findCard(board, buried), null, "a card under another card is in a zone of its own (3-1-4)");
  assert.equal(hostOf(board, buried), host, "the card under another cannot be found from the board at all");
  // And from one pile to another: a card is in a zone or in a pile, never both,
  // so the old host must let go of it.
  const secondHost = board.sides.p1.zones.hand[0];
  assert.ok(moveCard(board, DBS, secondHost, "battle").ok);
  assert.ok(moveCard(board, DBS, buried, "battle", { under: secondHost }).ok);
  assert.deepEqual(board.cards[host].under, [], "a card moved from one pile to another is still in the first one");
  assert.deepEqual(board.cards[secondHost].under, [buried], "the new host does not carry the card");
  // And out again: it arrives as a card in its own right.
  assert.ok(moveCard(board, DBS, buried, "hand").ok);
  assert.deepEqual(board.cards[secondHost].under, [], "the host still carries a card that left its pile");

  // A zone the game does not declare, and one it declares as no place at all.
  const nowhere = moveCard(board, DBS, buried, "sideboard");
  assert.equal(nowhere.ok, false, "a card was moved to a zone the game never declared");
  const toPlay = moveCard(board, DBS, buried, "play");
  assert.equal(toPlay.ok, false, "a card was put in `play`, which is a word for three zones and not one of them");
  if (!toPlay.ok) assert.match(toPlay.refused, /not a place/, "the refusal does not say why `play` holds nothing");

  // 3-1-6-1: only an in-play or combo area holds a card that is not its
  // master's. Anywhere else the card goes to its owner's copy of the zone.
  assert.ok(moveCard(board, DBS, buried, "battle", { owner: "p2" }).ok);
  assert.equal(findCard(board, buried)?.owner, "p2", "a card played into the opponent's Battle Area stayed in its owner's (3-1-6-1)");
  assert.ok(moveCard(board, DBS, buried, "drop", { owner: "p2" }).ok);
  assert.equal(findCard(board, buried)?.owner, "p1", "a card went to the opponent's Drop Area, which belongs to its master (3-1-6-1)");

  // The replacement hook 9-10 needs: recorded on the move, and *not* applied.
  // The language has the `replace` op (#125); this engine has no effects in
  // force to read one from until #142, and a mover that honoured a replacement
  // it had not been taught would be the harder bug to find.
  const asked = moveCard(board, DBS, buried, "drop", { replacement: { source: "p1#1", to: "warp" } });
  assert.ok(asked.ok);
  if (asked.ok) {
    assert.equal(asked.move.to, "drop", "the mover applied a replacement nothing has taught it to apply yet");
    assert.deepEqual(asked.move.replacement, { source: "p1#1", to: "warp" }, "the replacement the caller asked for was not recorded");
  }
}
// ── 11. the turn, run as a program ─────────────────────────────────────────
//
// The claim #140 makes: a game on the rules engine plays turn to turn from the
// `DEFINE PHASE` and `DEFINE STEP` declarations, and what it logs doing so is
// what the engine that has been playing logs. Asserted here rather than left
// to `arena:diff`, which needs a database and real saved games: the same
// comparison, over the harness decks, in `npm test`.

/** Everything the turn asks for, answered with the move that takes none of what is offered. */
function passOnly(engine: ReturnType<typeof engineFor>, start: unknown, first: PlayerId): { events: GameEvent[]; actions: Action[]; state: unknown } {
  let state = start;
  const events: GameEvent[] = [];
  const actions: Action[] = [];
  for (let i = 0; i < 4000; i++) {
    const legal = engine.legalActions(CTX, state as never);
    if (!legal.length) break;
    const pick =
      legal.find((l) => l.action.type === "chooseFirst" && l.action.first === first) ??
      legal.find((l) => l.action.type === "mulligan" && !l.action.redraw) ??
      legal.find((l) => l.action.type === "charge" && l.action.card === null) ??
      legal.find((l) => l.action.type === "endMain") ??
      legal[0];
    actions.push(pick.action);
    const r = engine.apply(CTX, state as never, pick.action);
    state = r.state;
    events.push(...r.events);
  }
  return { events, actions, state };
}

{
  const rulesEngine = engineFor("rules");
  const legacyEngine = engineFor("legacy");
  const born = rulesEngine.createGame(CTX, SAME);
  const legacyBorn = legacyEngine.createGame(CTX, SAME);

  const played = passOnly(rulesEngine, born.state, "p1");
  const oracled = passOnly(legacyEngine, legacyBorn.state, "p1");
  const end = played.state as VmState;
  const legacyEnd = oracled.state as GameState;

  // The same questions in the same order, which is what makes one action log
  // replayable on either engine — the property `arena:diff` is built on.
  assert.deepEqual(played.actions, oracled.actions, "a pass-only game asks the two engines for different answers");

  // The whole log, event for event, creation included. `reason` is the one
  // field left out of the comparison: the rules engine says why a player lost
  // in the words of the `DEFINE WIN` that ended it, and the legacy engine in
  // its own — which is the difference the programme exists to make, and Stage
  // 8 is where every word comes from the definition.
  const shown = (list: GameEvent[]) => JSON.parse(JSON.stringify(list.map((e) => (e.type === "gameOver" ? { ...e, reason: "…" } : e))));
  assert.deepEqual(shown([...born.events, ...played.events]), shown([...legacyBorn.events, ...oracled.events]), "a pass-only game does not log the same thing on the two engines");

  // …and it really did play a game: to a deck-out, on the turn the legacy
  // engine gets there, with the same winner.
  assert.equal(end.phase, "over", "a pass-only game on the rules engine never ended");
  assert.equal(end.turn, legacyEnd.turn, "the two engines' pass-only games ran for a different number of turns");
  assert.equal(end.winner, legacyEnd.winner, "the two engines' pass-only games ended with a different winner");
  assert.ok(end.turn > 60, `a pass-only game ended on turn ${end.turn}, which is far too soon for a 50-card deck to run out`);
  assert.match(end.overReason ?? "", /Deck Area/, "a pass-only game did not end on a deck-out");
  assert.deepEqual(rulesEngine.legalActions(CTX, end), [], "a finished game still offers moves");
  assert.equal(end.prompt.kind, "gameOver", "a finished game is not asking the question nobody answers");

  // The frame is the suspension: a game stored mid-decision and read back is
  // the same game, and the flow says which step it stopped at.
  let mid = born.state as VmState;
  mid = rulesEngine.apply(CTX, mid, { type: "chooseFirst", player: mid.chooser, first: "p1" }).state as VmState;
  assert.deepEqual(JSON.parse(JSON.stringify(mid)), mid, "a game waiting on a prompt does not round-trip through JSON");
  assert.equal(mid.prompt.kind, "mulligan", "the answer to who goes first did not lead to the mulligan (6-2-1-9-1)");
  assert.deepEqual(
    mid.flow.map((f) => f.phase),
    ["setup"],
    "a game in the pre-game procedure is in some other phase",
  );
  // Both players are asked, beginning with the one who goes first (6-2-1-9-1).
  assert.deepEqual(mid.flow[0].asking, ["p1", "p2"], "the mulligan is not put to both players beginning with the first");
  assert.equal((mid.prompt as { player: PlayerId }).player, "p1", "the first player is not the first to be asked about a mulligan");

  // A mulligan really redraws, and redraws the hand the legacy engine redraws:
  // the hand goes back to a deck the life has not been taken off yet, which is
  // why the deal had to move into the flow at all (6-2-1-9-1 before 6-2-1-10).
  const redrawn = rulesEngine.apply(CTX, mid, { type: "mulligan", player: "p1", redraw: true }).state as VmState;
  let legacyRedrawn = legacyEngine.createGame(CTX, SAME).state;
  legacyRedrawn = legacyEngine.apply(CTX, legacyRedrawn, { type: "chooseFirst", player: mid.chooser, first: "p1" }).state;
  legacyRedrawn = legacyEngine.apply(CTX, legacyRedrawn, { type: "mulligan", player: "p1", redraw: true }).state;
  assert.deepEqual(
    (redrawn as VmState).sides.p1.zones.hand,
    (legacyRedrawn as GameState).players.p1.hand,
    "a mulligan on the rules engine draws a different hand from the one the legacy engine draws",
  );

  // Conceding is answered wherever the game has got to (0-1-3-4), and leaves
  // the game in its over phase rather than in the middle of the question it
  // was asking.
  const conceded = rulesEngine.apply(CTX, mid, { type: "concede", player: "p2" }).state as VmState;
  assert.equal(conceded.winner, "p1", "conceding did not give the game to the other player");
  assert.equal(conceded.prompt.kind, "gameOver", "a conceded game is still asking the question it was in the middle of");
  assert.equal(conceded.phase, DBS.game?.overPhase, "a conceded game did not come to rest in the phase the game names");

  // `pass` is the generic decline: the same answer as the three named moves,
  // played through every question a turn asks.
  let byPass = born.state as VmState;
  byPass = rulesEngine.apply(CTX, byPass, { type: "chooseFirst", player: byPass.chooser, first: "p1" }).state as VmState;
  for (let i = 0; i < 40 && byPass.phase !== "over"; i++) {
    byPass = rulesEngine.apply(CTX, byPass, { type: "pass", player: (byPass.prompt as { player: PlayerId }).player }).state as VmState;
  }
  assert.ok(byPass.turn >= 3, `passing forty times reached turn ${byPass.turn}, and a turn of nothing but passing is four questions long`);

  // The board a client is handed, from a state it cannot read.
  const view = rulesEngine.boardView(CTX, byPass, "p1", {});
  assert.equal(view.turnPlayer, byPass.turnPlayer, "the board names a different turn player from the state");
  assert.equal(view.you.player, "p1", "the board was not drawn for the side it was asked for");
  assert.equal(view.them.hand, null, "the board shows the opponent's hand (3-3-3)");
  assert.equal(view.them.handCount, byPass.sides.p2.zones.hand.length, "the board does not say how big the opponent's hand is");
  assert.equal(view.you.life, byPass.sides.p1.zones.life.length, "the board does not count the life the state holds");
  assert.equal(view.you.leader?.id, byPass.sides.p1.zones.leader[0], "the board does not show the Leader the state placed");
  assert.equal(view.battle, null, "the board shows a battle, and this engine has never started one");

  // …and the beats a client animates from, which cover the moments a turn of
  // passing has: a phase beginning, a card drawn, a card moving.
  const turn = rulesEngine.apply(CTX, byPass, { type: "pass", player: (byPass.prompt as { player: PlayerId }).player });
  const beats = rulesEngine.toBeats(CTX, turn.state, turn.events, 7);
  assert.ok(beats.list.length > 0, "a turn of the rules engine produced no beats at all");
  assert.equal(beats.list[0].n, 8, "beats are not numbered on from the sequence they were asked to continue");
  assert.equal(beats.seq, 7 + beats.list.length, "the beat sequence does not end where the list does");
  for (const beat of beats.list) assert.ok(["phase", "draw", "move", "mode", "over"].includes(beat.t), `a turn of passing produced a ${beat.t} beat, which nothing in it can cause`);
}

// ── 12. the bounded repeat (7-4-4) ─────────────────────────────────────────
//
// The End Phase is carried out again when a skill newly answers to the end of
// the turn, and `LIMIT` is the ceiling on that. Nothing can pend yet — a
// trigger becomes pending when an event matches its pattern, which is #141 —
// so the loop turns zero times today and the thing worth asserting is the
// bound itself: a mis-declared trigger must not be able to hang a game.
{
  const repeat = Object.values(DBS.steps).filter((step) => step.limit !== undefined);
  assert.equal(repeat.length, 1, `${repeat.length} steps declare a LIMIT, and 7-4-4 is the one repeat the game has`);
  const step = repeat[0];
  assert.equal(step.phase, "end", "the bounded repeat is not a step of the End Phase (7-4-4)");
  assert.ok((step.limit ?? 0) > 0, "the End Phase repeat is declared with no repeats at all");
  for (let i = 0; i < (step.limit ?? 0); i++) {
    assert.equal(repeatAllowed(step, { phase: "end", index: 0, repeats: i }), true, `the End Phase refused to repeat after ${i} passes, and it declares ${step.limit}`);
  }
  assert.equal(repeatAllowed(step, { phase: "end", index: 0, repeats: step.limit ?? 0 }), false, "the End Phase repeats past the ceiling its own declaration states");
  // A step with no `LIMIT` declares no repeat, which is what stops a game
  // needing the field everywhere.
  const plain = Object.values(DBS.steps).find((s) => s.limit === undefined)!;
  assert.equal(repeatAllowed(plain, { phase: plain.phase, index: 0, repeats: 0 }), false, "a step that declares no LIMIT repeated anyway");
}

// ── 13. what the interpreter still does itself ─────────────────────────────
//
// Two constants in `vm/` name pieces of the DBS definition, and both are
// checked against it rather than trusted: `SETUP_ZONES` (#139's) and the steps
// the runner carries out because they have no `DO` program yet. A row naming a
// step nothing declares is work that would silently never happen, and each row
// says what it is waiting on so the gap can be read without opening the file.
{
  for (const zone of Object.values(SETUP_ZONES)) assert.ok(zone in DBS.zones, `the interpreter puts cards in the ${zone}, which the game declares no zone for`);
  for (const name of WORKED_STEPS) {
    assert.ok(name in DBS.steps, `the interpreter carries out a step called ${name}, which nothing declares`);
    assert.match(stepWorkNote(name) ?? "", /\d-\d/, `${name} does not say which manual section it is`);
  }
  assert.deepEqual(turnPhases(DBS), ["charge", "main", "mainEnd", "end"], "the turn is not the phases the game declares (7-1)");
}

// ── 14. the moment, and what answers to it (#141) ──────────────────────────
//
// The claim: an [Auto]'s moment is an **event pattern** the game declares, not
// a name the engine fires. The runner says what happened in the words
// `triggers.rules` is written in; the declarations decide which cards that is a
// moment for, which name it carries, and what the moment's card is called
// inside the program. Nothing below names a trigger to the engine — every
// trigger name in this section is an *expectation*, read back out of the queue.

// Two watchers, added here rather than to the harness: this is the only suite
// that needs a card whose moment is another card's. `vm` runs last, so `DEFS`
// is no longer being counted by anything.
DEFS.WATCHER = card("WATCHER", { energyCost: 1, skill: "[Auto] When you play a Battle Card, draw 1 card." });
DEFS.THEIRS = card("THEIRS", { energyCost: 1, colors: ["Blue"], skill: "[Auto] When your opponent plays a Battle Card, draw 1 card." });
DEFS.CHARGER = card("CHARGER", { energyCost: 1, skill: "[Auto] At the start of your charge phase, draw 1 card." });
DEFS.COMBOER = card("COMBOER", { energyCost: 1, skill: "[Auto] When this card is used in a combo, draw 1 card." });

{
  const rulesEngine = engineFor("rules");

  /** A game gone as far as p1's Main Phase, which is where a card is played (7-3). */
  function mainPhase(): VmState {
    let s = rulesEngine.createGame(CTX, SAME).state as VmState;
    s = rulesEngine.apply(CTX, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
    for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) {
      s = rulesEngine.apply(CTX, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
    }
    assert.equal(s.prompt.kind, "main", "a rules game did not reach a Main Phase to stage a play in");
    assert.deepEqual(s.pending, [], "a game of cards with no [Auto] reached its Main Phase with something pending");
    return s;
  }

  /** The copy in a player's hand, made into the card the test is about. Cheaper than a second decklist, and the instance ids stay the ones the deal gave. */
  function handed(s: VmState, p: PlayerId, cardId: string): string {
    const id = s.sides[p].zones.hand[0];
    assert.ok(id, `${p} has no card in hand to stage`);
    s.cards[id].cardId = cardId;
    return id;
  }

  /** Stage a card of this id in a player's Battle Area, and forget whatever pended on the way. */
  function staged(s: VmState, p: PlayerId, cardId: string): string {
    const id = handed(s, p, cardId);
    assert.ok(moveCard(s, DBS, id, "battle", { owner: p }).ok, `${cardId} could not be staged in ${p}'s Battle Area`);
    s.pending = [];
    return id;
  }

  // ── 9-6-9-4: played into a Battle Area, and not merely moved somewhere ────
  {
    const s = mainPhase();
    const drawer = handed(s, "p1", "DRAWER");
    moved(CTX, DBS, s, [], drawer, "battle", { owner: "p1", asPlay: true });
    assert.deepEqual(
      s.pending,
      [{ card: drawer, skillIndex: 0, master: "p1", trigger: "played" }],
      "a card played into a Battle Area did not pend its own [Auto] under the moment triggers.rules declares for it (9-6-9-4)",
    );

    // The same card, the same `asPlay`, a different place: the declaration says
    // `to: [battle, unison]`, so the Energy Area is not that moment. This is the
    // whole of what "matched against the pattern" buys — the engine did not
    // decide it, and a game that declared otherwise would get otherwise.
    const energy = mainPhase();
    const elsewhere = handed(energy, "p1", "DRAWER");
    moved(CTX, DBS, energy, [], elsewhere, "energy", { owner: "p1", asPlay: true });
    assert.deepEqual(energy.pending, [], "a card put in the Energy Area pended a skill that answers to being played (9-6-9-4)");

    // And a card *placed* in a Battle Area rather than played: `played` asks for
    // `asPlay: true` and gets `false`, which never matches — the reason every
    // move states the field rather than leaving it out.
    const placed = mainPhase();
    const put = handed(placed, "p1", "DRAWER");
    moved(CTX, DBS, placed, [], put, "battle", { owner: "p1" });
    assert.deepEqual(placed.pending, [], "a card placed in a Battle Area pended a skill that answers to being played (5-5-4)");
  }

  // ── 9-6-6: the turn player's first, then the other player's ──────────────
  {
    const s = mainPhase();
    const mine = staged(s, "p1", "WATCHER");
    const theirs = staged(s, "p2", "THEIRS");
    const played = handed(s, "p1", "V1");
    moved(CTX, DBS, s, [], played, "battle", { owner: "p1", asPlay: true });

    // One moment, two declarations, one watcher each side of the table — and
    // the card that moved is the `subject` of both, because both `BIND
    // "subject"`.
    assert.deepEqual(
      [...s.pending].sort((a, b) => a.card.localeCompare(b.card)).map((p) => ({ card: p.card, master: p.master, trigger: p.trigger, subject: p.subject })),
      [
        { card: mine, master: "p1", trigger: "youPlayed", subject: played },
        { card: theirs, master: "p2", trigger: "opponentPlayed", subject: played },
      ].sort((a, b) => a.card.localeCompare(b.card)),
      "one card being played did not put the moment to the watcher on each side of the table (5-5)",
    );

    // The order is by *master* and by nothing else, which is what makes it the
    // legacy engine's: the same queue read on the other player's turn comes out
    // the other way round.
    const ours = { ...s, pending: [...s.pending], turnPlayer: "p1" as PlayerId };
    assert.deepEqual([nextPending(ours)?.card, nextPending(ours)?.card], [mine, theirs], "the turn player's pending [Auto] did not resolve first (9-6-6)");
    assert.equal(nextPending(ours), null, "the queue handed out a third skill from two");
    const yours = { ...s, pending: [...s.pending], turnPlayer: "p2" as PlayerId };
    assert.deepEqual([nextPending(yours)?.card, nextPending(yours)?.card], [theirs, mine], "the queue is ordered by when a skill pended rather than by whose turn it is (9-6-6)");

    // …and the checkpoint really resolves it, through the engine rather than by
    // hand: a pass at the Main Phase runs the flow, the flow reaches 4-2-2, and
    // the program on the record is run on the interpreter both engines share
    // (#142). Until then this drained into a note.
    const after = rulesEngine.apply(CTX, s, { type: "pass", player: "p1" });
    assert.deepEqual((after.state as VmState).pending, [], "a pended [Auto] survived the checkpoint that is supposed to resolve it (4-2-2)");
    const resolved = after.events.flatMap((e) => (e.type === "skill" ? [e.card] : []));
    assert.deepEqual(resolved, [mine, theirs], "the checkpoint did not resolve the turn player's skill first and the other player's second (9-6-6)");
    // …and "draw 1 card" really drew. The first two draws of the batch are the
    // two skills'; everything after them belongs to the turn that follows.
    const drew = after.events.flatMap((e) => (e.type === "draw" ? [e.player] : []));
    assert.deepEqual(drew.slice(0, 2), ["p1", "p2"], "a resolved [Auto] that says 'draw 1 card' did not draw one");
  }

  // ── WHERE: a condition on the answering side, never on the event (7-1) ────
  {
    const s = mainPhase();
    const mine = staged(s, "p1", "CHARGER");
    const theirs = staged(s, "p2", "CHARGER");
    assert.equal(s.turnPlayer, "p1", "the staged game is not on the turn the rest of this block assumes");
    fire(CTX, DBS, s, { event: "phaseStart", controller: s.turnPlayer, args: { phase: "charge" } });
    assert.deepEqual(
      s.pending.map((p) => ({ card: p.card, trigger: p.trigger })),
      [{ card: mine, trigger: "chargeStart" }],
      "'at the start of your Charge Phase' was put to both players, and `your` is the card's controller (7-1)",
    );
    // The same moment on the other player's turn is the other card's.
    const s2: VmState = { ...s, pending: [], turnPlayer: "p2" };
    fire(CTX, DBS, s2, { event: "phaseStart", controller: s2.turnPlayer, args: { phase: "charge" } });
    assert.deepEqual(
      s2.pending.map((p) => p.card),
      [theirs],
      "the same phase moment did not follow the turn to the other player's card (7-1)",
    );
  }

  // ── 9-1-3-1, and the exception derived from the declaration ──────────────
  {
    const s = mainPhase();

    // A moment whose pattern names no place asks a card only where its skills
    // are valid: a card in hand is not in play, so it never answers.
    const inHand = handed(s, "p1", "DRAWER");
    fire(CTX, DBS, s, { event: "ko", card: inHand, controller: "p1", args: {} });
    assert.deepEqual(s.pending, [], "a card in hand answered to a moment whose declaration names no place (9-1-3-1)");

    // A moment whose pattern *does* name a place has already said where the
    // card is, so it answers from there — which is the legacy engine's list of
    // eleven `elsewhere` triggers, derived instead of copied. `comboed` is
    // declared `ON moved(from: combo)`, and the card is in the Drop by the time
    // it is asked.
    const comboer = handed(s, "p1", "COMBOER");
    assert.ok(moveCard(s, DBS, comboer, "combo", { owner: "p1" }).ok);
    s.pending = [];
    moved(CTX, DBS, s, [], comboer, "drop", { owner: "p1" });
    assert.deepEqual(
      s.pending.map((p) => ({ card: p.card, trigger: p.trigger })),
      [{ card: comboer, trigger: "comboed" }],
      "a card whose moment names the place it came from did not answer from outside play (9-1-3-1)",
    );
  }

  // ── the matcher answers about declarations, and says nothing else ────────
  {
    const s = mainPhase();
    const id = staged(s, "p1", "DRAWER");
    // An event word nothing declares is nobody's moment — and not an error: a
    // game fires what it fires, and which of those are moments is the
    // definition's business (`triggers.rules`' own header).
    assert.deepEqual(matchTriggers(DBS, s, { event: "somethingElse", card: id, controller: "p1", args: {} }), [], "a moment nothing declares matched a trigger");
    // A pattern argument the moment does not carry never matches.
    assert.deepEqual(matchTriggers(DBS, s, { event: "moved", card: id, controller: "p1", args: { to: "battle" } }).map((m) => m.trigger), [], "a `moved` moment that does not say whether it was a play matched a declaration that asks");
    // A declaration that watches a side cannot be answered by a moment that
    // says whose it is nowhere — said loudly, because a silent empty list here
    // is a skill that never fires with nothing to explain it.
    assert.throws(
      () => matchTriggers(DBS, s, { event: "moved", card: id, args: { to: "battle", asPlay: true } }),
      RulesetBroken,
      "a moment with no side was matched against a declaration that asks for the controller's cards",
    );
    // The pend list is state, so a game stopped between a moment and its
    // checkpoint is a game that can be stored.
    moved(CTX, DBS, s, [], handed(s, "p1", "DRAWER"), "battle", { owner: "p1", asPlay: true });
    assert.ok(s.pending.length > 0);
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s, "a game with something pending does not round-trip through JSON");
  }

  // ── 9-5-1 and 9-9-1: a [Permanent] read through the declared layers ───────
  //
  // A [Permanent] is never resolved and never stored: it is *read* whenever a
  // value is asked for, and it stops being read the moment its card is no
  // longer where its skills are valid (9-1-3-1). Nothing expires, because
  // nothing was ever put in force.
  {
    const s = mainPhase();
    const plain = staged(s, "p1", "V1");
    assert.equal(attrsNow(CTX, DBS, s, plain).power, 10000, "a card with nothing in force does not read its printed power");
    const aura = staged(s, "p1", "AURA");
    assert.equal(attrsNow(CTX, DBS, s, plain).power, 15000, "a [Permanent] in play did not reach the card it is about (9-9-1-2)");
    assert.ok(
      permanents(
        CTX,
        DBS,
        s,
        (frame) => [frame.card],
        () => true,
        () => 0,
      ).length > 0,
      "the [Permanent] walk found no standing change on a board holding one",
    );
    assert.ok(moveCard(s, DBS, aura, "drop", { owner: "p1" }).ok, "the [Permanent] could not be moved out of play");
    assert.equal(attrsNow(CTX, DBS, s, plain).power, 10000, "a [Permanent] went on standing after its card left play (9-1-3-1)");
  }

  // ── 9-1-5: negation is one reading, and every reader of it uses it ────────
  //
  // A [Permanent] read by a walk of its own is the place this rule is easiest
  // to forget: the [Auto]s of a negated card correctly stopped answering while
  // its standing power boost went on standing. So the rule is one function in
  // `vm/effects.ts` and the three readers — the walk, the checkpoint and the
  // moment that pends — all go through it.
  {
    const s = mainPhase();
    const plain = staged(s, "p1", "V1");
    const aura = staged(s, "p1", "AURA");
    assert.equal(attrsNow(CTX, DBS, s, plain).power, 15000, "the fixture's [Permanent] is not standing, so this block proves nothing");

    addEffect(s, [], { target: aura, kind: "negateSkills", value: 0, until: "game", source: aura });
    assert.equal(attrsNow(CTX, DBS, s, plain).power, 10000, "a [Permanent] on a card whose skills are negated went on standing (9-1-5)");

    // The narrower half: one skill by its printed index, not the whole card.
    const one = mainPhase();
    const bystander = staged(one, "p1", "V1");
    const boost = staged(one, "p1", "AURA");
    addEffect(one, [], { target: boost, kind: "negateSkill", value: 0, until: "turn", source: boost });
    assert.equal(attrsNow(CTX, DBS, one, bystander).power, 10000, "a [Permanent] negated by its own index went on standing (9-1-5)");

    // …and an [Auto] on a negated card does not answer to its moment either,
    // which is the half that was already right and is now the same reading.
    const watcher = staged(s, "p1", "WATCHER");
    addEffect(s, [], { target: watcher, kind: "negateSkills", value: 0, until: "game", source: watcher });
    moved(CTX, DBS, s, [], handed(s, "p1", "V1"), "battle", { owner: "p1", asPlay: true });
    assert.deepEqual(s.pending, [], "an [Auto] on a card whose skills are negated was pended anyway (9-1-5)");
  }

  // ── 9-1-4 and 7-4-5: a continuous effect, and the turn it ends with ───────
  {
    const s = mainPhase();
    const target = staged(s, "p1", "V1");
    const ev: GameEvent[] = [];
    addEffect(s, ev, { target, kind: "power", value: 3000, until: "turn", source: target });
    assert.deepEqual(
      ev.map((e) => e.type),
      ["effect"],
      "putting an effect in force did not log the beat a board draws the surge from",
    );
    assert.equal(attrsNow(CTX, DBS, s, target).power, 13000, "a continuous effect did not reach the layer above the printed power (9-9-1-3)");

    // …and it ends at the step the End Phase declares for it, through the
    // engine rather than by hand.
    const after = rulesEngine.apply(CTX, s, { type: "pass", player: "p1" });
    assert.deepEqual((after.state as VmState).effects, [], "an effect that lasts 'for the turn' survived the turn (7-4-5)");
    assert.ok(
      after.events.some((e) => e.type === "effectEnded"),
      "an effect ended with no beat, so a board has nothing to draw the settle from",
    );

    // The two turn-relative durations are read against the effect's own
    // master and never against whose turn it happened to be made on (7-2-4) —
    // so on p1's turn they point opposite ways, and one pass separates them.
    const mine = mainPhase();
    const card = staged(mine, "p1", "V1");
    addEffect(mine, [], { target: card, kind: "power", value: 1000, until: "opponentTurn", master: "p1", source: card });
    addEffect(mine, [], { target: card, kind: "comboPower", value: 1000, until: "nextTurn", master: "p1", source: card });
    const next = rulesEngine.apply(CTX, mine, { type: "pass", player: "p1" }).state as VmState;
    assert.equal(next.turnPlayer, "p2", "one pass did not hand the turn over, so this block proves nothing");
    assert.deepEqual(
      next.effects.map((e) => e.until),
      ["nextTurn"],
      "the two turn-relative durations were not read against the effect's own master as p1's turn ended (7-2-4)",
    );
  }

  // ── 20-15: a program written down now for a moment later ─────────────────
  {
    const s = mainPhase();
    const card = staged(s, "p1", "V1");
    schedule(s, [], { at: "turnEnd", scope: "thisTurn", ops: [{ op: "note", text: "the delayed half happened" }], card, master: "p1", vars: {}, label: "at the end of the turn" });
    assert.equal(dueDelays({ ...s, delayed: [...s.delayed] }, "mainStart").length, 0, "a delayed effect came due at a timing it does not name");
    const after = rulesEngine.apply(CTX, s, { type: "pass", player: "p1" });
    assert.ok(
      after.events.some((e) => e.type === "note" && e.text === "the delayed half happened"),
      "a delayed effect did not run at the step its timing names (7-4-2)",
    );
    assert.deepEqual((after.state as VmState).delayed, [], "a delayed effect that ran stayed on the list");
  }

  // ── 5-2 and 20-2: a skill that stops to ask ──────────────────────────────
  //
  // The whole of step 4: the question is the contract's own `Prompt`, the menu
  // is one move per candidate, the frame is the suspension — so the game is
  // storable mid-decision — and answering resumes the very program that asked.
  {
    const s = mainPhase();
    const mine = staged(s, "p1", "V1");
    const spared = staged(s, "p2", "V1");
    const chosen = staged(s, "p2", "BLOCKER");
    const ops: Op[] = [
      { op: "choose", sel: { side: "opponent", area: "battle", count: 1 }, as: "picked", reason: "choose one" },
      { op: "power", target: { var: "picked" }, amount: -5000, until: "turn" },
    ];
    s.programs.push({ ops, ip: 0, vars: {}, card: mine, master: "p1" });
    run(CTX, DBS, s, []);

    assert.equal(s.prompt.kind, "chooseCards", "a program with a choice in it did not put the question");
    const asking = s.prompt.kind === "chooseCards" ? s.prompt.choice : null;
    assert.deepEqual(asking?.candidates.slice().sort(), [spared, chosen].sort(), "the question offered cards the selector does not name");
    assert.deepEqual({ min: asking?.min, max: asking?.max }, { min: 1, max: 1 }, "a 'choose 1' was not asked one card at a time");
    assert.deepEqual(JSON.parse(JSON.stringify(s)), s, "a game waiting inside a skill does not round-trip through JSON");
    assert.equal(s.programs.length, 1, "the program that asked did not put itself back to be resumed");

    const menu = rulesEngine.legalActions(CTX, s);
    assert.deepEqual(
      menu.map((m) => m.action.type),
      ["choose", "choose"],
      "the menu at a program's question is not one move per candidate",
    );

    const after = rulesEngine.apply(CTX, s, { type: "choose", player: "p1", cards: [chosen] }).state as VmState;
    assert.equal(attrsNow(CTX, DBS, after, chosen).power, 5000, "the card the player chose was not the card the rest of the program acted on");
    assert.equal(attrsNow(CTX, DBS, after, spared).power, 10000, "a card nobody chose was changed as well");
    assert.deepEqual(after.programs, [], "the program did not finish once its question was answered");
    assert.equal(after.prompt.kind, "main", "the step's own question did not come back after the skill it was interrupted by finished");

    // And the host is the one the interpreter ran on: the same interface the
    // legacy engine implements, over this state.
    assert.equal(vmHost(CTX, DBS, after, []).masterOf(chosen), "p2", "the rules engine's host reads control off the zone a card stands in (20-9)");
  }

  // 7-4-5 is a *step*, so the work the interpreter still does itself is named
  // beside the rest of it rather than hidden in the runner.
  {
    for (const name of ["chargeTurnEffects", "chargeContinuousEnd", "mainPending", "endPending", "endEffects"]) {
      assert.ok(WORKED_STEPS.includes(name), `${name} carries out work the interpreter does and is not in the table that says so`);
      assert.ok(stepWorkNote(name), `${name} does not say what it is waiting on`);
    }
    assert.equal(endEffects({ ...mainPhase(), effects: [] }, [], "turn").length, 0, "ending a duration nothing is in force for reported something ending");
  }
}

// ── 15. a move and its refusal, off one declaration (#144) ─────────────────
//
// The claim Stage 5 rests on: `legalActions` and `rejectedActions` are two
// readings of one `DEFINE ACTION` paragraph — the candidates whose `REFUSE`
// lines are all satisfied, and the first requirement that stopped each of the
// rest — so a move added to a game is a paragraph in `actions.rules` and the
// refusal comes for free. No `whyNot*` twin, and therefore nothing to drift.
//
// The fixture is the language's own worked example: three candidates in a hand
// and two refusals, one of which the third candidate also fails, so the order
// the lines are read in is a thing this proves rather than a thing it assumes.
{
  const rulesEngine = engineFor("rules");

  /** The DBS definition with one more action in it. Parsed rather than hand-built, so the grammar is what the interpreter is fed. */
  function withAction(text: string): GameDefinition {
    const parsed = parseDefinitions(text);
    assert.ok(parsed.ok, `the fixture action does not parse: ${parsed.ok ? "" : `${parsed.error.clause} ${parsed.error.line}:${parsed.error.col} ${parsed.error.message}`}`);
    const defs = parsed.ok ? parsed.value : [];
    const actions = { ...DBS.actions };
    for (const def of defs) {
      assert.equal(def.define, "ACTION", "the fixture declares something other than an action");
      // The loader's defaults, applied the way `loadRuleset` applies them: the
      // printer drops none, so a field left out of the text is `undefined`.
      actions[def.name] = { listed: true, ...(def as ActionDef) };
    }
    return { ...DBS, actions };
  }

  const PLAY = [
    "DEFINE ACTION play",
    "  WHEN [main]",
    "  prompts: [main]",
    "  FOR 1 IN you.hand",
    '  BIND "card"',
    "  DO {",
    '    note(text: "played")',
    "  }",
    '  REFUSE cardType(needs: "a Battle Card") UNLESS count(FROM $card "battle card") >= 1',
    '  REFUSE condition(text: "a red card") UNLESS count(FROM $card "red card") >= 1',
    '  label: "Play"',
  ].join("\n");

  /** p1's Main Phase with exactly three cards in hand, in this order. */
  function threeInHand(...cardIds: string[]): VmState {
    let s = rulesEngine.createGame(CTX, SAME).state as VmState;
    s = rulesEngine.apply(CTX, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
    for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) s = rulesEngine.apply(CTX, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
    assert.equal(s.prompt.kind, "main", "a rules game did not reach a Main Phase to offer a move in");
    const hand = s.sides.p1.zones.hand.slice(0, cardIds.length);
    assert.equal(hand.length, cardIds.length, "the opening hand is too small to stage the fixture in");
    hand.forEach((id, i) => (s.cards[id].cardId = cardIds[i]));
    s.sides.p1.zones.hand = hand;
    return s;
  }

  // V1 is a red Battle Card and satisfies both lines; V-BLUE is a Battle Card
  // that is not red; L-BLUE is neither, and answers with the *first* line.
  const game = withAction(PLAY);
  const s = threeInHand("V1", "V-BLUE", "L-BLUE");
  const [good, wrongColour, neither] = s.sides.p1.zones.hand;

  const legal = declaredLegalActions(CTX, game, s);
  const rejected = declaredRejectedActions(CTX, game, s, legal);
  // The fixture's own action, against a definition that declares the game's
  // real moves as well: what the Main Phase offers besides it is `endMain`
  // (#145), and this block is about the three candidates of one paragraph.
  const plays = legal.filter((l) => l.action.type === "play");
  // …and what it *refuses* besides it is the charge, which 7-2-11 offers for
  // every card in hand at this question and refuses for each of them (#145).
  const refusedPlays = rejected.filter((r) => r.action.type === "play");

  assert.deepEqual(
    plays.map((l) => l.action),
    [{ type: "play", player: "p1", card: good }],
    "the only candidate both refusals let through is not the only move offered",
  );
  assert.equal(plays[0].label, "Play V1", "a declared move's label is not its `label:` and the card's name");

  assert.deepEqual(
    refusedPlays.map((r) => ({ card: (r.action as { card?: string }).card, why: r.why })),
    [
      { card: wrongColour, why: [{ kind: "condition", text: "a red card" }] },
      // The first line that fails and no further: this card is not a Battle
      // Card *and* not red, and it is owed the answer the check stopped at.
      { card: neither, why: [{ kind: "cardType", needs: "a Battle Card", card: neither }] },
    ],
    "the refusals are not the requirements the declaration names, in the order it names them",
  );

  // §3.2, asserted by the very function the legacy fixtures assert it with.
  assertMenuInvariants(legal, rejected, "a declared action over three candidates");
  assert.equal(plays.length + refusedPlays.length, 3, "the three candidates did not each get exactly one answer");

  // The `Requirement` shapes are the engine's own, so the board words a
  // rules-engine refusal with the table it words a legacy one with — never a
  // second wording table, which is the rule Stage 5's tracking issue fixes.
  for (const r of refusedPlays) {
    const said = refusal(r.why[0], { name: r.label.replace(/^Play /, ""), reaching: "play" });
    assert.ok(said.fact.length > 0, `a declared refusal has no words: ${JSON.stringify(r.why[0])}`);
  }

  // `apply` takes the one that was offered, queues its `DO`, and refuses the
  // two that were not — the contract's "a client picks a move by index" rests
  // on a move that was not offered being refused rather than quietly taken.
  {
    const ev: GameEvent[] = [];
    const played = structuredClone(s);
    assert.equal(applyDeclared(CTX, game, played, ev, { type: "play", player: "p1", card: good }), "done", "a declared move was not recognised by apply");
    // The program goes on the queue rather than running here (#142): an action's
    // `DO` and a skill's are one language on one interpreter, and a question
    // inside either has to be held by the runner or it is lost.
    assert.deepEqual(ev, [], "a declared move's DO ran inline, where a question inside it could not be asked");
    assert.deepEqual(
      played.programs.map((f) => f.ops),
      [game.actions.play.do],
      "a declared move's DO program did not reach the queue the runner steps",
    );
    for (const card of [wrongColour, neither]) {
      assert.throws(() => applyDeclared(CTX, game, structuredClone(s), [], { type: "play", player: "p1", card }), IllegalAction, "a refused candidate was played anyway");
    }
    assert.throws(() => applyDeclared(CTX, game, structuredClone(s), [], { type: "play", player: "p2", card: good }), IllegalAction, "the player who was not asked took the move");
  }

  // A priced action is **charged** (#148): the price comes off `costs.rules`,
  // the refusal is the shortfall in the engine's own `Requirement` shapes, and
  // a move that cannot be paid for is off the menu with that reason on it.
  {
    const priced = withAction(PLAY.replace("  prompts: [main]", "  prompts: [main]\n  COST [energy]"));
    // V1 costs 1 energy and demands one red orb, and nothing has been charged
    // into the Energy Area yet — so the answer is the shortfall, not "#148".
    const menu = declaredLegalActions(CTX, priced, s);
    assert.deepEqual(
      menu.filter((l) => l.action.type === "play"),
      [],
      "a move whose price cannot be paid is on the menu",
    );
    const why = declaredRejectedActions(CTX, priced, s, menu).filter((r) => r.action.type === "play");
    assert.equal(why.length, 3, "a priced move is not explained for every card it is about");
    const shortfall = why.find((r) => (r.action as { card?: string }).card === good)!;
    assert.deepEqual(shortfall.why[0], { kind: "energy", need: 1, have: 0 }, "an unpayable price is not the shortfall the legacy engine reports");
    assert.throws(() => applyDeclared(CTX, priced, structuredClone(s), [], { type: "play", player: "p1", card: good }), IllegalAction, "a move nobody can pay for was taken anyway");

    // One red energy in the Energy Area, and the same paragraph offers it, says
    // what it costs, and charges exactly that.
    const paid = structuredClone(s);
    const coin = paid.sides.p1.zones.deck.shift()!;
    paid.cards[coin].cardId = "V1";
    paid.cards[coin].mode = "active";
    paid.sides.p1.zones.energy.push(coin);
    const offered = declaredLegalActions(CTX, priced, paid).find((l) => l.action.type === "play" && (l.action as { card?: string }).card === good);
    assert.ok(offered, "a price the board can meet is still not offered");
    assert.deepEqual(offered!.cost, { energy: 1, orbs: { Red: 1 }, describe: "1 energy (1 red)" }, "the row does not wear the price the charge is taken from");
    assert.deepEqual(
      declaredRejectedActions(CTX, priced, paid, declaredLegalActions(CTX, priced, paid)).filter((r) => r.action.type === "play" && (r.action as { card?: string }).card === good),
      [],
      "a move on the menu is also on the list of refusals",
    );

    const ev: GameEvent[] = [];
    const took = structuredClone(paid);
    assert.equal(applyDeclared(CTX, priced, took, ev, { type: "play", player: "p1", card: good }), "done", "a priced move was not taken");
    assert.equal(took.cards[coin].mode, "rest", "the energy the price was planned against was not rested");
    // The payment happens here; the `DO` goes on the runner's queue (#142). So
    // the log at this point is the price and nothing else, and the program is
    // waiting — which is the order that matters: a move whose program was
    // queued before its price was settled would be a board no replay reaches.
    assert.deepEqual(ev, [{ type: "mode", card: coin, mode: "rest" }], "a priced move does not log the payment, and only the payment, before its program is queued");
    assert.deepEqual(
      took.programs.map((f) => f.ops),
      [priced.actions.play.do],
      "a priced move's program did not reach the queue the runner steps",
    );
  }

  // And the declaration the DBS files really carry: `pass` re-declared (#144).
  // It is accepted and never enumerated — `listed: false`, the concede rule
  // written down — so the menu is what it was before this issue.
  {
    assert.ok(DBS.actions.pass, "actions.rules does not declare pass");
    assert.equal(DBS.actions.pass.listed, false, "pass is on the menu, and the engine that has been playing never lists it");
    assert.deepEqual(
      actionsAt(DBS, s)
        .map((a) => a.name)
        .sort(),
      // `charge` is here because 7-2-11's "one charge a turn" is a *refusal* at
      // this question rather than a silence (#145): the move is declared in
      // both phases and refused in this one. `growUnison` is 13-3 (#269).
      ["activate", "charge", "concede", "endMain", "growUnison", "pass", "play", "playUnison", "playZ"],
      "the Main Phase offers a declared action other than the ones the files declare",
    );
    const menu = declaredLegalActions(CTX, DBS, s);
    assert.deepEqual(
      menu.map((l) => l.action),
      [{ type: "endMain", player: "p1" }],
      "an unlisted action reached the menu, or the one listed move of the Main Phase is not on it",
    );
    // The play family is declared (#146), and this board has no energy — so
    // every Battle Card in hand is on the *refused* list with the price that
    // stopped it; the charge is refused for every card in hand because its one
    // turn has gone (#145); `growUnison` is refused with no Unison in play
    // (#269); and `pass` and `concede` are on neither list because a refusal
    // explains a move a player can see.
    const refused = declaredRejectedActions(CTX, DBS, s, menu);
    assert.deepEqual(
      [...new Set(refused.map((r) => r.action.type))].sort(),
      ["charge", "growUnison", "play"],
      "an unlisted action reached the list of refusals, or a Main Phase move other than a play, a charge or growUnison was refused",
    );
    assert.ok(
      refused.filter((r) => r.action.type === "play").every((r) => r.why[0]?.kind === "energy"),
      "a card was refused a play on an empty board for something other than the price",
    );
    assert.ok(
      refused.filter((r) => r.action.type === "charge").every((r) => r.why[0]?.kind === "oncePerTurn"),
      "a card was refused the charge in the Main Phase for something other than the one charge a turn",
    );
    assert.equal(
      refused.some((r) => r.action.type === "charge" && (r.action as { card?: string | null }).card === null),
      false,
      "the Skip charge ghost is drawn at a question the charge does not answer",
    );
    // …and it is still the move that answers the question.
    const after = rulesEngine.apply(CTX, s, { type: "pass", player: "p1" });
    assert.notEqual((after.state as VmState).phase, "main", "pass did not answer the Main Phase's question");
    // A move no declaration claims names the issue that declares it.
    assert.throws(() => rulesEngine.apply(CTX, s, { type: "attack", player: "p1", attacker: good, target: "p2#0" }), NotYet, "a move nothing declares was accepted");
  }
}

// ── 16. the moves that need no payment: charge, endMain, concede (#145) ─────
//
// The first four `DEFINE ACTION`s on the real turn, and the claim is the one
// Stage 5 rests on: what the interpreter used to do in a `case` of its own it
// now does because `actions.rules` says so — the same menu, the same log, the
// same board. Measured against the engine that has been playing, move for move,
// the way §11 measures a game of nothing but passing.
{
  const rulesEngine = engineFor("rules");
  const legacyEngine = engineFor("legacy");

  /** Everything the turn asks for, answered by charging the first card offered and declining the rest. */
  function chargeAndPass(engine: ReturnType<typeof engineFor>, start: unknown, first: PlayerId): { events: GameEvent[]; actions: Action[]; state: unknown } {
    let state = start;
    const events: GameEvent[] = [];
    const actions: Action[] = [];
    for (let i = 0; i < 4000; i++) {
      const legal = engine.legalActions(CTX, state as never);
      if (!legal.length) break;
      const pick =
        legal.find((l) => l.action.type === "chooseFirst" && l.action.first === first) ??
        legal.find((l) => l.action.type === "mulligan" && !l.action.redraw) ??
        legal.find((l) => l.action.type === "charge" && l.action.card !== null) ??
        legal.find((l) => l.action.type === "endMain") ??
        legal[0];
      actions.push(pick.action);
      const r = engine.apply(CTX, state as never, pick.action);
      state = r.state;
      events.push(...r.events);
    }
    return { events, actions, state };
  }

  const born = rulesEngine.createGame(CTX, SAME);
  const legacyBorn = legacyEngine.createGame(CTX, SAME);
  const played = chargeAndPass(rulesEngine, born.state, "p1");
  const oracled = chargeAndPass(legacyEngine, legacyBorn.state, "p1");
  const end = played.state as VmState;
  const legacyEnd = oracled.state as GameState;

  // The same questions answered by the same cards: a scripted game of charges
  // and passes is one action log, replayable on either engine.
  assert.deepEqual(played.actions, oracled.actions, "a game of charging and passing asks the two engines for different answers");
  assert.ok(
    played.actions.filter((a) => a.type === "charge" && a.card !== null).length > 50,
    `only ${played.actions.filter((a) => a.type === "charge" && a.card !== null).length} cards were charged in a whole game, and every turn offers one`,
  );
  const shownEvents = (list: GameEvent[]) => JSON.parse(JSON.stringify(list.map((e) => (e.type === "gameOver" ? { ...e, reason: "…" } : e))));
  assert.deepEqual(
    shownEvents([...born.events, ...played.events]),
    shownEvents([...legacyBorn.events, ...oracled.events]),
    "a game of charging and passing does not log the same thing on the two engines",
  );
  assert.equal(end.phase, "over", "a game of charging and passing on the rules engine never ended");
  assert.equal(end.turn, legacyEnd.turn, "the two engines' charging games ran for a different number of turns");
  assert.deepEqual(end.sides.p1.zones.energy, legacyEnd.players.p1.energy, "the two engines' Energy Areas hold different cards, or hold them in a different order");

  /** A rules game at its first Charge Phase question, with `cardIds` at the front of p1's hand. */
  function atCharge(...cardIds: string[]): VmState {
    let s = rulesEngine.createGame(CTX, SAME).state as VmState;
    s = rulesEngine.apply(CTX, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
    for (let i = 0; i < 20 && s.prompt.kind !== "charge"; i++) s = rulesEngine.apply(CTX, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
    assert.equal(s.prompt.kind, "charge", "a rules game did not reach a Charge Phase to offer the charge in");
    const hand = s.sides.p1.zones.hand;
    assert.ok(hand.length > cardIds.length, "the opening hand is too small to stage the fixture in");
    cardIds.forEach((cardId, i) => (s.cards[hand[i]].cardId = cardId));
    return s;
  }

  {
    const s = atCharge();
    const legal = rulesEngine.legalActions(CTX, s);
    const hand = s.sides.p1.zones.hand;
    // One entry per card in hand, in the hand's own order, and the answer that
    // takes no card last — the ghost button, which is a candidate of its own
    // rather than the absence of one (`docs/arena-hud-spec.md` §2.3).
    assert.deepEqual(
      legal.map((l) => l.action),
      [...hand.map((card) => ({ type: "charge", player: "p1", card })), { type: "charge", player: "p1", card: null }],
      "the Charge Phase does not offer every card in hand and the skip",
    );
    assert.deepEqual(legal.map((l) => l.label), [...hand.map(() => "Charge V1"), "Skip charge"], "the charge's menu words are not the declaration's `label:` and its `decline:`");
    assert.deepEqual(rulesEngine.rejectedActions(CTX, s, legal), [], "a card in hand was refused the charge for a reason of its own");
    assertMenuInvariants(legal, rulesEngine.rejectedActions(CTX, s, legal), "the charge over a whole hand");

    // Taking it: the card is in the Energy Area, face up to both players, and
    // the move is the one event the board animates.
    const chosen = hand[2];
    const done = rulesEngine.apply(CTX, s, { type: "charge", player: "p1", card: chosen });
    const after = done.state as VmState;
    assert.deepEqual(after.sides.p1.zones.energy, [chosen], "the charged card is not in the Energy Area");
    assert.equal(after.sides.p1.zones.hand.includes(chosen), false, "the charged card is still in hand as well");
    assert.deepEqual(
      done.events.filter((e) => e.type === "move"),
      [{ type: "move", card: chosen, from: "hand", to: "energy", owner: "p1", reveal: true }],
      "a charge is not logged as one face-up move from the hand to the Energy Area (7-2-11)",
    );
    assert.equal(after.prompt.kind, "main", "the charge did not answer the Charge Phase's question");

    // …and declining moves nothing, though it answers the same question: one
    // paragraph, two halves, and the `DO` runs over no cards.
    const skipped = rulesEngine.apply(CTX, s, { type: "charge", player: "p1", card: null });
    assert.deepEqual((skipped.state as VmState).sides.p1.zones.energy, [], "declining the charge placed a card anyway");
    assert.deepEqual(skipped.events.filter((e) => e.type === "move"), [], "declining the charge logged a move");
    assert.equal((skipped.state as VmState).prompt.kind, "main", "declining the charge did not answer the question");
    assert.equal(
      (skipped.state as VmState).sides.p1.zones.hand.length,
      s.sides.p1.zones.hand.length,
      "declining the charge changed the hand",
    );
  }

  // 3-1-2: a Leader Card does not leave the Leader Area, so it is not a card
  // the charge can be made about — and the player reaching for it is owed the
  // requirement that says so, in the shape `wording.ts` already words.
  {
    const s = atCharge("L-BLUE");
    const leader = s.sides.p1.zones.hand[0];
    const legal = rulesEngine.legalActions(CTX, s);
    assert.equal(legal.some((l) => (l.action as { card?: string | null }).card === leader), false, "a Leader Card in hand was offered as a charge");
    const rejected = rulesEngine.rejectedActions(CTX, s, legal);
    assert.deepEqual(
      rejected.map((r) => ({ card: (r.action as { card?: string }).card, why: r.why })),
      [{ card: leader, why: [{ kind: "cardType", needs: "a card that is not a Leader Card", card: leader }] }],
      "the Leader in hand is not refused the charge, or is refused something else",
    );
    assert.ok(refusal(rejected[0].why[0], { name: "L-BLUE", reaching: "charge" }).fact.length > 0, "the charge's refusal has no words");
    assertMenuInvariants(legal, rejected, "the charge with a Leader in hand");
  }

  // 7-2-11's "one charge a turn", which is a **refusal** at the Main Phase
  // question and not a silence: the paragraph is declared in both phases and
  // its first `REFUSE` line asks which question is on the table. Measured
  // against the legacy engine card for card, because "the same requirement, in
  // the same shape, for the same board" is the whole claim.
  {
    const charged = atCharge();
    const s = rulesEngine.apply(CTX, charged, { type: "charge", player: "p1", card: null }).state as VmState;
    assert.equal(s.prompt.kind, "main", "the game is not at the Main Phase question");
    assert.ok(actionsAt(DBS, s).some((a) => a.name === "charge"), "the charge is not offered at the question 7-2-11 refuses it at");
    assert.throws(() => rulesEngine.apply(CTX, s, { type: "charge", player: "p1", card: s.sides.p1.zones.hand[0] }), IllegalAction, "a card was charged in the Main Phase");

    // Every card in hand, refused with the requirement the legacy engine gives
    // — including a Leader, because `whyNotCharge` reads the question before it
    // reads the card and the declaration's lines are in that order.
    s.cards[s.sides.p1.zones.hand[0]].cardId = "L-BLUE";
    const legal = rulesEngine.legalActions(CTX, s);
    const charges = rulesEngine.rejectedActions(CTX, s, legal).filter((r) => r.action.type === "charge");
    assert.deepEqual(
      charges.map((r) => ({ card: (r.action as { card?: string | null }).card, why: r.why })),
      s.sides.p1.zones.hand.map((card) => ({ card, why: [{ kind: "oncePerTurn", what: "charge" }] })),
      "the Main Phase does not refuse the charge for every card in hand with the one charge a turn",
    );
    // The words the player is given are `wording.ts`'s, which is the table the
    // legacy engine's own refusal is worded by — never a second one.
    assert.ok(refusal(charges[0].why[0], { name: "L-BLUE", reaching: "charge" }).fact.length > 0, "the once-per-turn refusal has no words");
    // …and the ghost button is not drawn at all: a refusal explains a move a
    // player can see, and there is no skip button at this question.
    assert.equal(
      charges.some((r) => (r.action as { card?: string | null }).card === null),
      false,
      "the Skip charge ghost is refused at a question the charge does not answer, rather than left undrawn",
    );
    assertMenuInvariants(legal, rulesEngine.rejectedActions(CTX, s, legal), "the charge at the Main Phase question");

    // The legacy engine, on the same board, gives the same answer for the same
    // cards — requirement for requirement.
    {
      let l = createGame(CTX, SAME).state;
      for (let i = 0; i < 20 && l.prompt.kind !== "charge"; i++) {
        const pr = l.prompt as { kind: string; player: PlayerId };
        const a: Action = pr.kind === "chooseFirst" ? { type: "chooseFirst", player: pr.player, first: "p1" } : { type: "mulligan", player: pr.player, redraw: false };
        l = apply(CTX, l, a).state;
      }
      l = apply(CTX, l, { type: "charge", player: "p1", card: null }).state;
      assert.equal(l.prompt.kind, "main", "the legacy game is not at the Main Phase question");
      const legacyCharges = rejectedActions(CTX, l, legalActions(CTX, l)).filter((r) => r.action.type === "charge");
      assert.deepEqual(
        legacyCharges.map((r) => r.why),
        charges.map((r) => r.why),
        "the two engines refuse the Main Phase charge with different requirements",
      );
    }

    // …and the Main Phase's own moves: ending the turn, and every card in hand
    // this player can afford to play (#146). The opening board has no energy,
    // so on this one there is nothing to afford.
    const menu = rulesEngine.legalActions(CTX, rulesEngine.apply(CTX, charged, { type: "charge", player: "p1", card: null }).state as VmState);
    assert.deepEqual(menu.map((l) => ({ action: l.action, label: l.label })), [{ action: { type: "endMain", player: "p1" }, label: "End turn" }], "the Main Phase offers something other than ending the turn");
    const ended = rulesEngine.apply(CTX, s, { type: "endMain", player: "p1" }).state as VmState;
    assert.notEqual(ended.phase, "main", "ending the Main Phase did not leave it");
  }

  // Conceding is a declaration too — accepted at any prompt, on neither list,
  // and its phases are the phases a game is still being played in (0-1-3-4).
  {
    const declared = DBS.actions.concede;
    assert.ok(declared, "actions.rules does not declare conceding");
    assert.equal(declared.listed, false, "conceding is enumerated, and a client shows it as a button of its own");
    assert.deepEqual(declared.do, [], "conceding declares a program, and ending a game is not something a program can say yet");
    assert.equal(declared.when.includes(DBS.game?.overPhase ?? "over"), false, "conceding is declared in the phase a finished game rests in");
    const s = atCharge();
    // The opponent's, at a prompt that is not theirs.
    const conceded = rulesEngine.apply(CTX, s, { type: "concede", player: "p2" }).state as VmState;
    assert.equal(conceded.winner, "p1", "conceding did not give the game to the other player");
    assert.equal(conceded.phase, DBS.game?.overPhase, "a conceded game did not come to rest in the phase the game names");
    assert.throws(() => rulesEngine.apply(CTX, conceded, { type: "concede", player: "p1" }), IllegalAction, "a finished game was conceded again");
  }
}



// ── 17. the price, off the declarations (#148) ──────────────────────────────
//
// Four claims, and the first is the one the rest rest on.
//
//  1. **The planner answers what `planPayment` answers.** Board for board and
//     price for price: payable or not, the *same* `Requirement`s when not, the
//     same cards rested, the same options offered and the same words for them.
//     The legacy search is the oracle (`docs/arena-tooling.md`), and a planner
//     driven by `costs.rules` that quietly rested a different card would be a
//     divergence no coverage number catches.
//  2. **Every declared kind is charged**, not only energy: markers off the card
//     paying (13-4), life to the Drop (21-3), the card's own mode (1-10-1), the
//     20-19 payers, and the price declared `consumes: unreadable`, which is
//     *refused* rather than charged — the reason `text` is a declaration at all.
//  3. **The price shown is the price charged.** One `Price` becomes the
//     `ActionCost` the row wears and the payment that is taken, and the figure
//     it carries is the legacy engine's own, card for card over the harness.
//  4. **The question is the existing one.** 3-8-2's "which energy" is the
//     `payCost` prompt, its options are legacy `Payment` values, and answering
//     it charges exactly what was picked — no new `Prompt` kind, so nothing in
//     `contract/fixtures/` moves.
{
  const rulesEngine = engineFor("rules");

  // Energy in colours the DBS fixtures do not otherwise stage. Added here, as
  // §16's CHARGER is: this suite runs last, so nothing before it sees them.
  DEFS["E-RED"] = card("E-RED", { colors: ["Red"] });
  DEFS["E-BLUE"] = card("E-BLUE", { colors: ["Blue"] });
  DEFS["E-GREEN"] = card("E-GREEN", { colors: ["Green"] });
  DEFS["E-DUAL"] = card("E-DUAL", { colors: ["Red", "Blue"] });
  // A cost-2 card that demands no colour, so both colours of energy are a
  // genuinely different way to pay it — which is what 3-8-2 asks about.
  DEFS["COST2"] = card("COST2", { energyCost: 2, colors: ["Colorless"] });

  /** One staged board, described once and built on both engines so the two are the same game. */
  interface Staged {
    energy: string[];
    markers: number;
    leader: string;
  }

  /** The instance ids the energy takes. `p1#0` is the Leader on both engines (#139's dealing order). */
  const energyIds = (n: number): string[] => Array.from({ length: n }, (_, i) => `p1#${i + 1}`);

  function rulesBoard(b: Staged): VmState {
    const s = rulesEngine.createGame(CTX, DECKS).state as VmState;
    const ids = energyIds(b.energy.length);
    ids.forEach((id, i) => {
      s.cards[id].cardId = b.energy[i];
      s.cards[id].mode = "active";
    });
    s.sides.p1.zones.deck = s.sides.p1.zones.deck.filter((id) => !ids.includes(id));
    s.sides.p1.zones.energy = ids;
    s.sides.p1.attrs.energyMarkers = b.markers;
    s.cards[s.sides.p1.zones.leader[0]].cardId = b.leader;
    return s;
  }

  function legacyBoard(b: Staged): GameState {
    const s = createGame(CTX, DECKS).state;
    const ids = energyIds(b.energy.length);
    ids.forEach((id, i) => {
      s.cards[id].cardId = b.energy[i];
      s.cards[id].mode = "active";
    });
    s.players.p1.deck = s.players.p1.deck.filter((id) => !ids.includes(id));
    s.players.p1.energy = ids;
    s.players.p1.energyMarkers = b.markers;
    s.cards[s.players.p1.leader!].cardId = b.leader;
    return s;
  }

  const BOARDS: Staged[] = [
    { energy: ["E-RED", "E-RED", "E-BLUE"], markers: 0, leader: "L-RED" },
    { energy: ["E-RED", "E-BLUE", "E-GREEN"], markers: 1, leader: "L-RED" },
    { energy: [], markers: 2, leader: "L-RED" },
    { energy: ["E-DUAL", "E-DUAL"], markers: 0, leader: "L-BLUE" },
    { energy: ["E-RED", "E-RED", "E-RED", "E-BLUE", "E-GREEN"], markers: 1, leader: "L-RED" },
  ];

  /** A price in the two engines' own terms: the legacy triple, and the `Price` the declarations are charged from. */
  const PRICES: { total: number; specified: Partial<Record<Color, number>>; either: Color[][] }[] = [
    { total: 0, specified: {}, either: [] },
    { total: 1, specified: {}, either: [] },
    { total: 2, specified: { Red: 1 }, either: [] },
    { total: 3, specified: { Red: 1, Blue: 1 }, either: [] },
    { total: 2, specified: { Blue: 2 }, either: [] },
    // 22-13: "{r}/{u}", one orb payable with either colour.
    { total: 2, specified: {}, either: [["Red", "Blue"]] },
    { total: 3, specified: { Red: 1 }, either: [["Blue", "Green"]] },
    { total: 5, specified: {}, either: [] },
    // A price demanding more orbs than it charges energy: unpayable as stated
    // rather than payable at a silently higher figure.
    { total: 2, specified: { Red: 3 }, either: [] },
  ];

  for (const b of BOARDS) {
    const vm = rulesBoard(b);
    const legacy = legacyBoard(b);
    const where = `${b.energy.join("+") || "no energy"} and ${b.markers} marker(s) under ${b.leader}`;
    for (const p of PRICES) {
      const price: Price = { ...freePrice(), energy: p.total, orbs: { ...p.specified }, either: p.either.map((o) => o.slice()) };
      const what = `${p.total} energy ${JSON.stringify(p.specified)}${p.either.length ? ` either ${JSON.stringify(p.either)}` : ""} on ${where}`;

      const oracle = planPayment(CTX, legacy, "p1", p.total, p.specified, undefined, p.either);
      const plan = planCost(CTX, DBS, vm, "p1", price, null);
      assert.equal(plan.ok, oracle !== null, `the two engines disagree about whether a price can be paid: ${what}`);

      if (!oracle) {
        // …and the refusal is the legacy `whyNotPay`'s, requirement for
        // requirement, so `wording.ts` says one sentence and not two.
        assert.deepEqual(plan.ok ? [] : plan.why, whyNotPay(CTX, legacy, "p1", p.total, p.specified, p.either), `the shortfall is not the one the legacy engine reports: ${what}`);
        continue;
      }
      assert.ok(plan.ok);
      assert.deepEqual({ rest: plan.payment.rest, markers: plan.payment.energyMarkers }, oracle, `a different payment was planned: ${what}`);
      // 3-8-2: the genuinely different ways to pay, and the words for each.
      assert.deepEqual(vmOptions(CTX, DBS, vm, "p1", price), legacyOptions(CTX, legacy, "p1", p.total, p.specified), `the payment options differ: ${what}`);
      assert.equal(plan.describe, legacyDescribe(CTX, legacy, oracle), `the payment is described differently: ${what}`);
    }
  }

  // The energy the planner may reach for comes off `costs.rules` — the zone and
  // the mode are the `energy` price's own `DO`, not a name in the interpreter.
  {
    const vm = rulesBoard(BOARDS[0]);
    assert.deepEqual(activeEnergy(DBS, vm, "p1"), energyIds(3), "the active energy is not what the declaration's pool finds");
    vm.cards[energyIds(3)[0]].mode = "rest";
    assert.deepEqual(activeEnergy(DBS, vm, "p1"), energyIds(3).slice(1), "a rested card still counts as energy the price can be paid with");
    const charge = chargesOf(DBS).energy;
    assert.deepEqual(charge.from, { side: "you", area: "energy", mode: "active" }, "the energy price's pool is not read off its declaration");
    assert.equal(charge.asks, "choice", "the energy price does not say the payer is asked which energy to rest (3-8-2)");
  }

  // ── every declared kind ───────────────────────────────────────────────────
  {
    const vm = rulesBoard({ energy: ["E-RED"], markers: 0, leader: "L-RED" });
    const subject = vm.sides.p1.zones.deck[0];
    vm.cards[subject].markers = 2;

    // 13-4: markers off the card whose skill is being used, and a card cannot
    // be taken below none. The words of the refusal are the legacy engine's.
    const twoMarkers: Price = { ...freePrice(), markers: -2 };
    const paidMarkers = planCost(CTX, DBS, vm, "p1", twoMarkers, subject);
    assert.ok(paidMarkers.ok, "a marker price the card can pay was refused");
    const threeMarkers = planCost(CTX, DBS, vm, "p1", { ...freePrice(), markers: -3 }, subject);
    assert.deepEqual(threeMarkers.ok ? [] : threeMarkers.why, [{ kind: "other", detail: "needs 3 markers (2 on it)" }], "a marker shortfall is not worded as the legacy engine words it");

    // 21-3: life to the Drop, and a life the player does not have.
    const life = planCost(CTX, DBS, vm, "p1", { ...freePrice(), life: 1 }, subject);
    assert.equal(life.ok, false, "a life price was planned against a board with no life dealt yet");

    // 1-10-1: a card already in Rest Mode has nothing left to rest.
    vm.cards[subject].mode = "rest";
    const resting = planCost(CTX, DBS, vm, "p1", { ...freePrice(), rest: true }, subject);
    assert.deepEqual(resting.ok ? [] : resting.why, [{ kind: "mode", card: subject, mode: "rest" }], "a rest price is not refused by the mode requirement a client already draws");
    vm.cards[subject].mode = "active";
    const rests = planCost(CTX, DBS, vm, "p1", { ...freePrice(), rest: true }, subject);
    assert.ok(rests.ok && rests.payment.restsSelf, "a rest price the card can pay was refused");

    // 20-19: a card outside the Energy Area, rested where it stands. The energy
    // is tried first — resting a Battle Card to pay for what the Energy Area
    // could have covered is a cost the player never agreed to.
    const payer = vm.sides.p1.zones.deck[1];
    vm.cards[payer].cardId = "E-BLUE";
    vm.cards[payer].mode = "active";
    vm.sides.p1.zones.deck = vm.sides.p1.zones.deck.filter((id) => id !== payer);
    vm.sides.p1.zones.battle.push(payer);
    const oneRed: Price = { ...freePrice(), energy: 1, orbs: { Red: 1 } };
    const fromEnergy = planCost(CTX, DBS, vm, "p1", { ...oneRed, payers: [{ id: payer, colors: ["Blue"] }] }, subject);
    assert.ok(fromEnergy.ok && fromEnergy.payment.rest[0] === energyIds(1)[0], "a payer was rested for a price the Energy Area could pay");
    const oneBlue: Price = { ...freePrice(), energy: 1, orbs: { Blue: 1 }, payers: [{ id: payer, colors: ["Blue"] }] };
    const fromPayer = planCost(CTX, DBS, vm, "p1", oneBlue, subject);
    assert.ok(fromPayer.ok && fromPayer.payment.rest[0] === payer, "20-19's payer was not reached for by a price only it can pay");
    assert.deepEqual(
      planCost(CTX, DBS, vm, "p1", { ...oneBlue, payers: [] }, subject).ok,
      false,
      "the same price is payable with no payer in force, so 20-19 is doing nothing",
    );

    // The price no engine charges itself: refused, with the card named.
    const unreadable = planCost(CTX, DBS, vm, "p1", { ...freePrice(), unreadable: "text" }, subject);
    assert.deepEqual(unreadable.ok ? [] : unreadable.why, [{ kind: "unread", card: subject }], "a price declared unreadable is not refused as unread");

    // …and charging really does what the declarations say it does.
    const ev: GameEvent[] = [];
    const payment: VmPayment = { rest: [energyIds(1)[0]], energyMarkers: 0, markers: -2, life: [], pooled: [], restsSelf: true };
    chargeCost(CTX, DBS, vm, ev, "p1", payment, subject, ["energy", "marker", "rest"]);
    assert.equal(vm.cards[energyIds(1)[0]].mode, "rest", "the energy was not rested");
    assert.equal(vm.cards[subject].markers, 0, "the markers were not taken off the card");
    assert.equal(vm.cards[subject].mode, "rest", "the card the price rests was not rested");
    assert.deepEqual(
      ev,
      [
        { type: "mode", card: energyIds(1)[0], mode: "rest" },
        { type: "markers", card: subject, delta: -2, total: 0 },
        { type: "mode", card: subject, mode: "rest" },
      ],
      "charging a price does not log what the legacy engine logs for the same payment",
    );
  }

  // ── the price shown is the price charged ──────────────────────────────────
  //
  // Card for card over every harness card with a printed cost: the figure this
  // engine reads, the figure the legacy engine charges, and the sentence a row
  // wears are one. The row's words go through `priceOf`, which is the only
  // place a price becomes a sentence on either engine.
  {
    const vm = rulesBoard(BOARDS[0]);
    const legacy = legacyBoard(BOARDS[0]);
    const held = vm.sides.p1.zones.deck[0];
    let checked = 0;
    for (const [cardId, def] of Object.entries(DEFS)) {
      if (def.type === "LEADER" || def.type === "TOKEN") continue;
      vm.cards[held].cardId = cardId;
      legacy.cards[held].cardId = cardId;
      const mine = cardPrice(CTX, DBS, vm, held);
      const theirs = playCost(CTX, legacy, held);
      assert.equal(mine.total, theirs.total, `${cardId}: the two engines read a different total cost`);
      assert.deepEqual(mine.orbs, theirs.specified, `${cardId}: the two engines read a different coloured requirement`);
      // The sentence, assembled from this engine's one `Price`. A play's total
      // comes off the card and its orbs off the row, which is why `priceOf`
      // takes both (issue #96).
      const view = { cost: def.energyCost === null ? undefined : String(def.energyCost), comboCost: def.comboCost ?? undefined, comboPower: def.comboPower ?? undefined } as never;
      const price: Price = { ...freePrice(), energy: mine.total, orbs: mine.orbs };
      const said = priceOf({ type: "play", player: "p1", card: held }, view, "Play", actionCostOf(price));
      assert.ok(said && said.length > 0, `${cardId}: a play has no price sentence`);
      checked++;
    }
    assert.ok(checked > 50, `only ${checked} harness cards were priced on both engines`);
  }

  // ── 3-8-2: the question, and answering it ─────────────────────────────────
  //
  // The existing `payCost` prompt, whose options are legacy `Payment` values —
  // so one client answers either engine and no fixture in `contract/` moves.
  {
    const PRICED = [
      "DEFINE ACTION play",
      "  WHEN [main]",
      "  prompts: [main]",
      "  FOR 1 IN you.hand",
      '  BIND "card"',
      "  COST [energy]",
      "  DO {",
      '    note(text: "played")',
      "  }",
      '  label: "Play"',
    ].join("\n");
    const parsed = parseDefinitions(PRICED);
    assert.ok(parsed.ok, "the priced fixture action does not parse");
    const priced: GameDefinition = { ...DBS, actions: { ...DBS.actions, play: { listed: true, ...((parsed.ok ? parsed.value[0] : null) as ActionDef) } } };

    // A cost-2 card and two colours of energy to pay it with: two genuinely
    // different answers, so the payment is asked about rather than assumed.
    let s = rulesEngine.createGame(CTX, DECKS).state as VmState;
    s = rulesEngine.apply(CTX, s, { type: "chooseFirst", player: s.chooser, first: "p1" }).state as VmState;
    for (let i = 0; i < 20 && s.prompt.kind !== "main"; i++) s = rulesEngine.apply(CTX, s, { type: "pass", player: (s.prompt as { player: PlayerId }).player }).state as VmState;
    assert.equal(s.prompt.kind, "main", "a rules game did not reach a Main Phase to price a move in");
    const hand = s.sides.p1.zones.hand.slice(0, 1);
    s.cards[hand[0]].cardId = "COST2";
    s.sides.p1.zones.hand = hand;
    const colours = ["E-RED", "E-BLUE", "E-GREEN"];
    const energy = s.sides.p1.zones.deck.splice(0, colours.length);
    energy.forEach((id, i) => {
      s.cards[id].cardId = colours[i];
      s.cards[id].mode = "active";
    });
    s.sides.p1.zones.energy = energy;

    const offered = declaredLegalActions(CTX, priced, s).find((l) => l.action.type === "play");
    assert.ok(offered, "a cost-2 card with three energy active is not offered");
    assert.deepEqual(offered!.cost, { energy: 2, describe: "2 energy" }, "a colourless cost-2 card's row does not carry its price");

    // The one reading: what the action asks of this candidate is the card's own
    // cost, and it is the very value the row above wears and the charge below
    // is taken from.
    assert.deepEqual(priceFor(CTX, priced, s, priced.actions.play, hand[0]), { ...freePrice(), energy: 2 }, "an action's price is not the cost of the card it is about");
    assert.deepEqual(priceFor(CTX, priced, s, DBS.actions.charge, hand[0]), freePrice(), "a move that names no price costs something");

    // …and the three prices whose amount has nowhere to come from are refused
    // **by name** rather than charged as nothing, which is the whole reason
    // this issue exists: a declared price with no amount would be free.
    for (const name of ["marker", "life", "payWith"]) {
      const asks = { ...priced.actions.play, cost: [name] };
      assert.throws(() => priceFor(CTX, priced, s, asks, hand[0]), NotYet, `the price ${name} was read as nothing rather than refused by name`);
    }

    const ev: GameEvent[] = [];
    const asking = structuredClone(s);
    assert.equal(applyDeclared(CTX, priced, asking, ev, { type: "play", player: "p1", card: hand[0] }), "asked", "a price with two answers was taken without asking which");
    assert.equal(asking.prompt.kind, "payCost", "the payment does not put the prompt the legacy engine puts");
    assert.deepEqual(ev, [], "a move that stopped to ask which energy had already charged something");
    const prompt = asking.prompt as { options: { rest: string[]; markers: number }[]; describe: string };
    assert.equal(prompt.describe, "play COST2", "the payment prompt is not described the way the legacy engine describes it");
    assert.ok(prompt.options.length > 1, "a payment worth asking about has only one answer");

    // One answer per option, worded as the legacy engine words them…
    const answers = rulesEngine.legalActions(CTX, asking);
    assert.deepEqual(
      answers.map((a) => a.action),
      prompt.options.map((_, i) => ({ type: "payCost", player: "p1", option: i })),
      "the payment prompt does not offer one answer per option",
    );
    assert.ok(
      answers.every((a) => a.label.startsWith("Rest ")),
      "a payment answer is not worded as a rest",
    );

    // …and the answer coming back charges exactly what it named, then runs the
    // move. The one picked keeps the red energy active, which is the whole
    // point of being asked: a player saves the colour they need next.
    const keepRed = prompt.options.findIndex((o) => !o.rest.includes(energy[0]) && o.rest.length === 2);
    assert.ok(keepRed >= 0, "keeping the red energy is not one of the answers");
    const after = structuredClone(s);
    const paidEv: GameEvent[] = [];
    assert.equal(
      applyDeclared(CTX, priced, after, paidEv, { type: "play", player: "p1", card: hand[0], pay: prompt.options[keepRed].rest }),
      "done",
      "the payment the player chose did not take the move",
    );
    assert.equal(after.cards[energy[1]].mode, "rest", "the energy the player picked was not the energy rested");
    assert.equal(after.cards[energy[2]].mode, "rest", "the energy the player picked was not the energy rested");
    assert.equal(after.cards[energy[0]].mode, "active", "an energy the player did not pick was rested as well");
    assert.deepEqual(
      after.programs.map((f) => f.ops),
      [priced.actions.play.do],
      "the move's program did not reach the runner's queue once its price was paid",
    );
    assert.notEqual(after.prompt.kind, "payCost", "the game is still asking about a payment it has taken");

    // The whole round trip through `apply` — the prompt answered by re-sending
    // the move the flow was suspended in the middle of. `apply` reads the
    // *real* DBS definition, so this is the declared `play` of #146 rather than
    // the fixture above: the answer is carried into the move, the move is
    // taken, and the card is where a play puts it.
    const roundTrip = rulesEngine.apply(CTX, asking, { type: "payCost", player: "p1", option: keepRed });
    const round = roundTrip.state as VmState;
    assert.deepEqual(round.sides.p1.zones.battle, [hand[0]], "answering the payment did not re-send the move it was suspended in");
    assert.equal(round.cards[energy[0]].mode, "active", "the energy the player kept was rested by the re-sent move");
    assert.notEqual(round.prompt.kind, "payCost", "the game is still asking about a payment it has taken");
  }
}



// ── 18. playing a card, off the declarations (#146) ─────────────────────────
//
// Four claims, and the first is the one the acceptance is written against.
//
//  1. **The same events.** A play, a Unison play and a Z-card play are logged
//     event for event as the legacy engine logs them, from the same staged
//     board: the energy rested, the card's move, the markers it arrives with,
//     the Z-Energy spent — and the [Auto] that answers to the arrival, which is
//     the point of firing `moved(asPlay: true)` rather than pending a trigger
//     by name.
//  2. **The same first refusal per card.** Every play the legacy engine refuses
//     on a board, this one refuses with the very same `Requirement` — and
//     `wording.ts` says the same sentence about it, because there is one
//     table and one refusal shape.
//  3. **The free timing is a declaration.** 7-3-4: a play leaves the Main
//     Phase's question on the table (`again: true`) and ending the turn does
//     not, so a player may play twice and the phase ends when they say so.
//  4. **What the declarations cannot say is refused, not offered free.** An X
//     cost has no total until its master names one (1-2-2-2), and a candidate
//     is a card and nothing else — so such a card is `unread` rather than a
//     move taken for nothing.
{
  const rulesEngine = engineFor("rules");

  // The cards this block stages with. Added here, as §16's and §17's are: this
  // suite runs last, so nothing before it sees them.
  DEFS["P-RED"] = card("P-RED", { energyCost: 1 });
  DEFS["P-BIG"] = card("P-BIG", { energyCost: 4 });
  DEFS["P-ARRIVES"] = card("P-ARRIVES", { energyCost: 1, skill: "[Auto] When this card is played, draw 1 card." });
  DEFS["P-UNISON"] = card("P-UNISON", { type: "UNISON", energyCost: 2, power: 5000, comboCost: null, comboPower: null });
  DEFS["P-UNISON-1"] = card("P-UNISON-1", { type: "UNISON", energyCost: 1, power: 5000, comboCost: null, comboPower: null });
  DEFS["P-Z"] = card("P-Z", { type: "Z-BATTLE", energyCost: 1, zEnergyCost: 2 });
  DEFS["P-ZLEADER"] = card("P-ZLEADER", { type: "Z-LEADER", energyCost: null, zEnergyCost: 3, comboCost: null, comboPower: null });
  DEFS["P-X"] = card("P-X", { energyCost: "X" as unknown as number });
  DEFS["P-E-RED"] = card("P-E-RED", { colors: ["Red"] });
  DEFS["P-E-BLUE"] = card("P-E-BLUE", { colors: ["Blue"] });

  const PLAY_DECKS = {
    seed: 11,
    p1: { name: "You", leader: "L-RED", main: fifty("V1"), z: ["P-Z", "P-ZLEADER"] },
    p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") },
  };

  /** The pre-game answers, the same on either engine, up to p1's first Main Phase. */
  const toMain = (prompt: { kind: string; player?: PlayerId }): Action | null => {
    const pr = prompt as { kind: string; player: PlayerId };
    if (pr.kind === "chooseFirst") return { type: "chooseFirst", player: pr.player, first: "p1" };
    if (pr.kind === "mulligan") return { type: "mulligan", player: pr.player, redraw: false };
    if (pr.kind === "charge") return { type: "charge", player: pr.player, card: null };
    return null;
  };

  /**
   * One staged Main Phase, built on **both** engines from the same seed and
   * then given the same hand, energy and Z-Energy — the instance ids are a
   * function of the decklist alone (#139), so "the same cards" is literal.
   */
  function staged(hand: string[], energy: string[], zEnergy = 0): { r: VmState; l: GameState } {
    let r = rulesEngine.createGame(CTX, PLAY_DECKS).state as VmState;
    let l = createGame(CTX, PLAY_DECKS).state;
    for (let i = 0; i < 30; i++) {
      const a = toMain(r.prompt);
      if (!a) break;
      r = rulesEngine.apply(CTX, r, a).state as VmState;
      l = apply(CTX, l, a).state;
    }
    assert.equal(r.prompt.kind, "main", "the rules game did not reach a Main Phase to play in");
    assert.equal(l.prompt.kind, "main", "the legacy game did not reach a Main Phase to play in");
    assert.deepEqual(r.sides.p1.zones.hand, l.players.p1.hand, "the two engines dealt different hands from the same seed");

    hand.forEach((cardId, i) => {
      const id = r.sides.p1.zones.hand[i];
      r.cards[id].cardId = cardId;
      l.cards[id].cardId = cardId;
    });
    const energyIds = r.sides.p1.zones.deck.slice(0, energy.length);
    energyIds.forEach((id, i) => {
      r.cards[id].cardId = energy[i];
      r.cards[id].mode = "active";
      l.cards[id].cardId = energy[i];
      l.cards[id].mode = "active";
    });
    const zIds = r.sides.p1.zones.deck.slice(energy.length, energy.length + zEnergy);
    const taken = new Set([...energyIds, ...zIds]);
    r.sides.p1.zones.deck = r.sides.p1.zones.deck.filter((id) => !taken.has(id));
    l.players.p1.deck = l.players.p1.deck.filter((id) => !taken.has(id));
    r.sides.p1.zones.energy = energyIds;
    l.players.p1.energy = energyIds;
    r.sides.p1.zones.zEnergy = zIds;
    l.players.p1.zEnergy = zIds;
    return { r, l };
  }

  /**
   * The same move on both engines, with the events each logged.
   *
   * The logs are compared through JSON, as §16's `shownEvents` compares them:
   * the legacy engine spreads an absent `reveal` as an explicit `undefined`
   * key, and a strict comparison would call that a divergence when what
   * reaches a client — and what `arena:diff` stores — has no such key at all.
   */
  const logged = (list: GameEvent[]): unknown => JSON.parse(JSON.stringify(list));
  function both(board: { r: VmState; l: GameState }, action: Action): { r: { state: VmState; events: unknown }; l: { state: GameState; events: unknown } } {
    const r = rulesEngine.apply(CTX, board.r, action);
    const l = apply(CTX, board.l, action);
    return { r: { state: r.state as VmState, events: logged(r.events) }, l: { state: l.state, events: logged(l.events) } };
  }

  // 8-3-2: a Battle Card paid for out of the Energy Area. The whole log, not a
  // filtered one — an event either engine logged and the other did not is
  // exactly the divergence the oracle exists to catch.
  {
    const board = staged(["P-RED"], ["P-E-RED"]);
    const target = board.r.sides.p1.zones.hand[0];
    const offered = rulesEngine.legalActions(CTX, board.r).find((a) => a.action.type === "play");
    assert.ok(offered, "a Battle Card the player can pay for is not offered as a play");
    assert.deepEqual(offered!.action, { type: "play", player: "p1", card: target }, "the play offered is not the shape a client sends");
    assert.deepEqual(offered!.cost, { energy: 1, orbs: { Red: 1 }, describe: "1 energy (1 red)" }, "the play's row does not wear the card's own price");

    const done = both(board, { type: "play", player: "p1", card: target });
    assert.deepEqual(done.r.events, done.l.events, "a play does not log the same thing on the two engines");
    assert.deepEqual(done.r.state.sides.p1.zones.battle, done.l.state.players.p1.battle, "a play does not leave the card in the same place on the two engines");
    // 7-3-4: the free timing is granted again, which is what `again: true` says.
    assert.equal(done.r.state.prompt.kind, "main", "a play ended the Main Phase, and 7-3-4 grants the timing again");
    assert.equal(done.l.state.prompt.kind, "main", "the legacy engine ended the Main Phase on a play");
    // …and ending the turn is the move that does not, so the phase can be left.
    const ended = rulesEngine.apply(CTX, done.r.state, { type: "endMain", player: "p1" }).state as VmState;
    assert.notEqual(ended.phase, "main", "ending the Main Phase did not leave it");
  }

  // 9-6-9-4: the arrival is a moment, and the [Auto] that answers to it
  // resolves through the shared interpreter — nothing pends a trigger by name.
  {
    const board = staged(["P-ARRIVES"], ["P-E-RED"]);
    const target = board.r.sides.p1.zones.hand[0];
    const done = both(board, { type: "play", player: "p1", card: target });
    assert.deepEqual(done.r.events, done.l.events, "a played card's [Auto] does not log the same thing on the two engines");
    assert.ok(
      (done.r.events as { type: string; card?: string }[]).some((e) => e.type === "skill" && e.card === target),
      "nothing answered to the card being played",
    );
    assert.equal(done.r.state.sides.p1.zones.hand.length, done.l.state.players.p1.hand.length, "the [Auto]'s draw left the two hands a different size");
  }

  // 13-2: a Unison arrives carrying the energy paid for it as markers, and
  // 3-11-5 sends the Unison already there to the Drop — read off the zone's
  // own `single:`, not off the card's type.
  {
    const board = staged(["P-UNISON", "P-UNISON-1"], ["P-E-RED", "P-E-RED", "P-E-RED"]);
    const first = board.r.sides.p1.zones.hand[0];
    const second = board.r.sides.p1.zones.hand[1];
    const one = both(board, { type: "playUnison", player: "p1", card: first, x: 2 });
    assert.deepEqual(one.r.events, one.l.events, "a Unison play does not log the same thing on the two engines");
    assert.deepEqual(one.r.state.sides.p1.zones.unison, [first], "the Unison is not in the Unison Area");
    assert.equal(one.r.state.cards[first].markers, 2, "the Unison did not arrive with the energy paid for it as markers (13-2-3)");
    assert.equal(one.r.state.cards[first].markers, one.l.state.cards[first].markers, "the two engines gave the Unison a different number of markers");

    const two = both({ r: one.r.state, l: one.l.state }, { type: "playUnison", player: "p1", card: second, x: 1 });
    assert.deepEqual(two.r.events, two.l.events, "replacing a Unison does not log the same thing on the two engines");
    assert.deepEqual(two.r.state.sides.p1.zones.unison, [second], "the second Unison did not take the area");
    assert.ok(two.r.state.sides.p1.zones.drop.includes(first), "the Unison already in play did not go to the Drop Area (3-11-5)");
  }

  // 16-2: a Z-card pays two prices, and in the order the engine that has been
  // playing charges them — the Z-Energy first, then the energy.
  {
    const board = staged([], ["P-E-RED"], 2);
    const zCard = board.r.sides.p1.zones.zDeck.find((id) => board.r.cards[id].cardId === "P-Z")!;
    const offered = rulesEngine.legalActions(CTX, board.r).find((a) => a.action.type === "playZ");
    assert.ok(offered, "a Z-card with the Z-Energy for it is not offered");
    assert.equal(offered!.cost?.describe, "1 energy (1 red) · 2 zEnergy", "a Z-card's row does not say what it costs in Z-Energy");
    const done = both(board, { type: "playZ", player: "p1", card: zCard });
    assert.deepEqual(done.r.events, done.l.events, "a Z-card play does not log the same thing on the two engines");
    assert.equal(done.r.state.sides.p1.zones.zEnergy.length, 0, "the Z-Energy was not spent");

    // 5-4-2: and it is refused when the Z-Energy is not there, in the words of
    // the zone the game declares.
    const poor = staged([], ["P-E-RED"], 1);
    const refusedZ = rulesEngine.rejectedActions(CTX, poor.r, rulesEngine.legalActions(CTX, poor.r)).find((x) => x.action.type === "playZ" && (x.action as { card: string }).card === zCard);
    assert.ok(refusedZ, "a Z-card with too little Z-Energy is neither offered nor refused");
    assert.deepEqual(refusedZ!.why[0], { kind: "other", detail: "needs 2 in your zEnergy (1 there)" }, "a Z-card short of Z-Energy is refused for something else");

    // 6-1-4: a Z-Leader is not played at all, and the player reaching for it is
    // owed the requirement that says so.
    const zLeader = board.r.sides.p1.zones.zDeck.find((id) => board.r.cards[id].cardId === "P-ZLEADER")!;
    const refusedLeader = rulesEngine.rejectedActions(CTX, board.r, rulesEngine.legalActions(CTX, board.r)).find((x) => x.action.type === "playZ" && (x.action as { card?: string }).card === zLeader);
    assert.ok(refusedLeader, "a Z-Leader in the Z-Deck is neither offered nor refused");
    assert.deepEqual(refusedLeader!.why[0], { kind: "cardType", needs: "a Z-Battle Card or a Z-Extra Card", card: zLeader }, "a Z-Leader is refused for something other than being one");
  }

  // The refusals, card for card against the legacy engine — the shape and the
  // sentence. One blue energy on a red board: the cheap cards are short of the
  // colour, the expensive one short of the total.
  {
    const board = staged(["P-RED", "P-BIG", "P-RED"], ["P-E-BLUE"]);
    const mine = rulesEngine.rejectedActions(CTX, board.r, rulesEngine.legalActions(CTX, board.r));
    const theirs = rejectedActions(CTX, board.l, legalActions(CTX, board.l));
    const firstOf = (list: { action: Action; why: Requirement[] }[]) =>
      new Map(list.filter((x) => x.action.type === "play").map((x) => [(x.action as { card: string }).card, x.why[0]]));
    const ours = firstOf(mine);
    const legacyFirst = firstOf(theirs);
    let compared = 0;
    for (const [cardId, why] of legacyFirst) {
      const got = ours.get(cardId);
      assert.ok(got, `${cardId} is refused a play by the legacy engine and neither offered nor refused by this one`);
      assert.deepEqual(got, why, `${cardId}: the two engines give a different first reason for refusing a play`);
      // One wording table, so the sentence is the same sentence.
      const about = { name: "P-RED", reaching: "play" as const };
      assert.deepEqual(refusal(got!, about), refusal(why, about), `${cardId}: the same requirement reads differently on the two engines`);
      compared++;
    }
    assert.ok(compared >= 3, `only ${compared} play refusals were compared against the legacy engine`);
    assertMenuInvariants(rulesEngine.legalActions(CTX, board.r), mine, "the play menu with the wrong colour of energy");
  }

  // 1-2-2-2: an X cost. The value is an answer to a question and a candidate is
  // a card, so the card is refused as `unread` rather than offered for nothing
  // — the 8 Sep 2026 precedent, applied to a price instead of to a skill.
  {
    const board = staged(["P-X"], ["P-E-RED", "P-E-RED"]);
    const xCard = board.r.sides.p1.zones.hand[0];
    assert.equal(
      rulesEngine.legalActions(CTX, board.r).some((a) => a.action.type === "play" && (a.action as { card?: string }).card === xCard),
      false,
      "a card whose cost is X was offered at a price nobody named",
    );
    const why = rulesEngine.rejectedActions(CTX, board.r, rulesEngine.legalActions(CTX, board.r)).find((x) => x.action.type === "play" && (x.action as { card?: string }).card === xCard);
    assert.deepEqual(why?.why[0], { kind: "unread", card: xCard }, "a card whose cost is X is not refused as a price this engine cannot read");
    // The legacy engine offers it once per value of X, which is the divergence
    // this names rather than hides: `DECLARABLE_ACTIONS` has no shape that
    // carries an answer, and #147 is where a move's price takes arguments.
    assert.ok(
      legalActions(CTX, board.l).some((a) => a.action.type === "play" && (a.action as { card: string }).card === xCard),
      "the legacy engine stopped offering an X cost, and this divergence is recorded on the assumption that it does",
    );
  }
}

// ── 19. using a skill, off the declarations (#147) ──────────────────────────
//
// The move whose candidate is a **line** rather than a card, and therefore the
// one §3.2 of `docs/arena-workflow-spec.md` counts per line. Five claims:
//
//  1. **The same events.** A skill used on a staged board logs what the legacy
//     engine logs, event for event: the energy rested, the `skill` beat with
//     the line as printed, and the effects the record's program makes — which
//     is the point of running that program on the one shared interpreter
//     (#142) rather than on a second reading of it.
//  2. **One rejection per skill line, on both engines.** A card with three
//     [Activate: Main] lines is asked about three times and answered three
//     times, and the two engines file them under the same three keys.
//  3. **The same first refusal per line.** Negated, used up, the wrong window,
//     a condition that does not hold, a price too dear, an effect the compiler
//     could not read, the wrong area: whatever stopped the line first, both
//     engines say the same `Requirement` about it and `wording.ts` says the
//     same sentence.
//  4. **A price that is not read is refused, never played free.** The 8 Sep
//     2026 precedent: a skill with no record has an unknown price, and one
//     whose price is an X or an action price is `unread` rather than free.
//  5. **`contract/fixtures/activate.json`'s own board.** The fixture the client
//     contract is emitted from — PUMPCRIT's pump-and-grant in the Battle Area
//     with one energy — plays to the same events and the same board on both.
//
// `arena:diff` cannot be the instrument for any of this yet: it replays a saved
// row, and a legacy row handed to the rules engine is an `EngineMismatch` until
// #164 replays them. So the oracle here is the two engines run side by side on
// one staged board, which is what §16, §17 and §18 do.
{
  const rulesEngine = engineFor("rules");

  // The cards this block stages with, added here as §16–§18's are.
  DEFS["A-FREE"] = card("A-FREE", { energyCost: 1, skill: "[Activate: Main] Draw 1 card." });
  DEFS["A-ORBS"] = card("A-ORBS", { energyCost: 1, skill: "[Activate: Main] {r}: Draw 1 card." });
  DEFS["A-BLUE-ORB"] = card("A-BLUE-ORB", { energyCost: 1, skill: "[Activate: Main] {u}: Draw 1 card." });
  DEFS["A-ONCE"] = card("A-ONCE", { energyCost: 1, skill: "[Activate: Main][Once per turn] Draw 1 card." });
  DEFS["A-BATTLE"] = card("A-BATTLE", { energyCost: 1, skill: "[Activate: Battle] Draw 1 card." });
  DEFS["A-UNREAD"] = card("A-UNREAD", { energyCost: 1, skill: "[Activate: Main] Bend the fabric of reality to your will." });
  // Three lines on one card: the whole of claim 2, and the reason §3.2 has an
  // exception at all.
  DEFS["A-THREE"] = card("A-THREE", {
    energyCost: 1,
    skill: "[Activate: Main] Draw 1 card.<br>[Activate: Main] {u}: Draw 1 card.<br>[Activate: Battle] Draw 1 card.",
  });
  DEFS["A-EXTRA"] = card("A-EXTRA", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 1 card." });
  DEFS["A-EXTRA-ORB"] = card("A-EXTRA-ORB", { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] {r}: Draw 1 card." });
  DEFS["A-E-RED"] = card("A-E-RED", { colors: ["Red"] });
  DEFS["A-E-BLUE"] = card("A-E-BLUE", { colors: ["Blue"] });

  const ACT_DECKS = {
    seed: 12,
    p1: { name: "You", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") },
  };

  const toMainPhase = (prompt: { kind: string; player?: PlayerId }): Action | null => {
    const pr = prompt as { kind: string; player: PlayerId };
    if (pr.kind === "chooseFirst") return { type: "chooseFirst", player: pr.player, first: "p1" };
    if (pr.kind === "mulligan") return { type: "mulligan", player: pr.player, redraw: false };
    if (pr.kind === "charge") return { type: "charge", player: pr.player, card: null };
    return null;
  };

  /**
   * One Main Phase on **both** engines with the same cards in the same places.
   *
   * The instance ids are a function of the decklist alone (#139), so "the same
   * board" is literal: the cards are renamed in place on either state and the
   * two engines are then asked the same questions about the same ids.
   */
  function stagedFor(battle: string[], energy: string[], hand: string[] = []): { r: VmState; l: GameState } {
    let r = rulesEngine.createGame(CTX, ACT_DECKS).state as VmState;
    let l = createGame(CTX, ACT_DECKS).state;
    for (let i = 0; i < 30; i++) {
      const a = toMainPhase(r.prompt);
      if (!a) break;
      r = rulesEngine.apply(CTX, r, a).state as VmState;
      l = apply(CTX, l, a).state;
    }
    assert.equal(r.prompt.kind, "main", "the rules game did not reach a Main Phase to use a skill in");
    assert.equal(l.prompt.kind, "main", "the legacy game did not reach a Main Phase to use a skill in");

    hand.forEach((cardId, i) => {
      const id = r.sides.p1.zones.hand[i];
      r.cards[id].cardId = cardId;
      l.cards[id].cardId = cardId;
    });
    const take = (n: number, from: number): string[] => r.sides.p1.zones.deck.slice(from, from + n);
    const battleIds = take(battle.length, 0);
    const energyIds = take(energy.length, battle.length);
    battleIds.forEach((id, i) => {
      for (const st of [r.cards[id], l.cards[id]]) {
        st.cardId = battle[i];
        st.mode = "active";
      }
    });
    energyIds.forEach((id, i) => {
      for (const st of [r.cards[id], l.cards[id]]) {
        st.cardId = energy[i];
        st.mode = "active";
      }
    });
    const taken = new Set([...battleIds, ...energyIds]);
    r.sides.p1.zones.deck = r.sides.p1.zones.deck.filter((id) => !taken.has(id));
    l.players.p1.deck = l.players.p1.deck.filter((id) => !taken.has(id));
    r.sides.p1.zones.battle = battleIds;
    l.players.p1.battle = battleIds;
    r.sides.p1.zones.energy = energyIds;
    l.players.p1.energy = energyIds;
    return { r, l };
  }

  const asJson = (list: GameEvent[]): unknown => JSON.parse(JSON.stringify(list));
  function bothUse(board: { r: VmState; l: GameState }, action: Action): { r: { state: VmState; events: unknown }; l: { state: GameState; events: unknown } } {
    const r = rulesEngine.apply(CTX, board.r, action);
    const l = apply(CTX, board.l, action);
    return { r: { state: r.state as VmState, events: asJson(r.events) }, l: { state: l.state, events: asJson(l.events) } };
  }

  /** Every activation either engine names, keyed the way §3.2 keys one: the card and the line. */
  const byLine = (list: { action: Action }[]): Map<string, Action> =>
    new Map(list.filter((x) => x.action.type === "activate").map((x) => [`${(x.action as { card: string }).card}#${(x.action as { skill: number }).skill}`, x.action]));

  // 1. A free skill: the same events, the same board, and the same free timing
  //    afterwards (7-3-4 — using a skill leaves the Main Phase's question up).
  {
    const board = stagedFor(["A-FREE"], []);
    const user = board.r.sides.p1.zones.battle[0];
    const offered = rulesEngine.legalActions(CTX, board.r).find((a) => a.action.type === "activate" && (a.action as { card: string }).card === user);
    assert.ok(offered, "a skill with no price is not offered on the rules engine");
    assert.deepEqual(offered!.action, { type: "activate", player: "p1", card: user, skill: 0 }, "the activation offered is not the shape a client sends");
    assert.ok(offered!.label.includes("Draw 1 card"), `an activation's row does not say which line it is: ${offered!.label}`);

    const done = bothUse(board, { type: "activate", player: "p1", card: user, skill: 0 });
    assert.deepEqual(done.r.events, done.l.events, "using a skill does not log the same thing on the two engines");
    assert.equal(done.r.state.sides.p1.zones.hand.length, done.l.state.players.p1.hand.length, "the skill's draw left the two hands a different size");
    assert.equal(done.r.state.prompt.kind, "main", "using a skill ended the Main Phase, and 7-3-4 grants the timing again");
  }

  // 2. A price in orbs: charged out of the Energy Area exactly as the legacy
  //    engine charges it, and the row wears the figure that was charged.
  {
    const board = stagedFor(["A-ORBS"], ["A-E-RED"]);
    const user = board.r.sides.p1.zones.battle[0];
    const coin = board.r.sides.p1.zones.energy[0];
    const offered = rulesEngine.legalActions(CTX, board.r).find((a) => a.action.type === "activate" && (a.action as { card: string }).card === user);
    assert.ok(offered, "a skill whose orbs the board can pay is not offered");
    assert.deepEqual(offered!.cost, { energy: 1, orbs: { Red: 1 }, describe: "1 energy (1 red)" }, "an activation's row does not wear the line's own price");
    const done = bothUse(board, { type: "activate", player: "p1", card: user, skill: 0 });
    assert.deepEqual(done.r.events, done.l.events, "a priced activation does not log the same thing on the two engines");
    assert.equal(done.r.state.cards[coin].mode, "rest", "the energy the price was planned against was not rested");
  }

  // 3. Three lines, three answers — on both engines, for one board. The whole
  //    of §3.2's exception: the first line is playable, the second is short of
  //    a blue orb, the third belongs to another window.
  {
    const board = stagedFor(["A-THREE"], ["A-E-RED"]);
    const user = board.r.sides.p1.zones.battle[0];
    const mine = rulesEngine.legalActions(CTX, board.r);
    const theirs = legalActions(CTX, board.l);
    const refusedMine = rulesEngine.rejectedActions(CTX, board.r, mine);
    const refusedTheirs = rejectedActions(CTX, board.l, theirs);
    // The index is the line's own — its offset in the printed text, stable
    // across games (`Skill.index`) — so the three keys are compared as a set of
    // three rather than as 0, 1, 2.
    const seen = (legal: { action: Action }[], refused: { action: Action }[]) => [...byLine(legal).keys(), ...byLine(refused).keys()].filter((k) => k.startsWith(`${user}#`)).sort();
    assert.equal(seen(mine, refusedMine).length, 3, "a card with three [Activate] lines is not answered about three times on the rules engine");
    assert.equal(new Set(seen(mine, refusedMine)).size, 3, "two of a card's three skill lines were answered under one key");
    assert.deepEqual(seen(mine, refusedMine), seen(theirs, refusedTheirs), "the two engines answer about a different set of skill lines");
    assert.equal(byLine(refusedMine).size, 2, "a card with one playable line and two refused ones does not show two rejections");
    assertMenuInvariants(mine, refusedMine, "the activation menu of a card with three skill lines");
    assertMenuInvariants(theirs, refusedTheirs, "the legacy activation menu of a card with three skill lines");
  }

  // 4. The first refusal, line for line against the legacy engine — the shape
  //    and the sentence. A board built to stop every gate this stage reads.
  {
    const board = stagedFor(["A-BATTLE", "A-BLUE-ORB", "A-UNREAD"], ["A-E-RED"], ["A-FREE"]);
    const mine = rulesEngine.rejectedActions(CTX, board.r, rulesEngine.legalActions(CTX, board.r));
    const theirs = rejectedActions(CTX, board.l, legalActions(CTX, board.l));
    const firstOf = (list: { action: Action; why: Requirement[] }[]) =>
      new Map(
        list
          .filter((x) => x.action.type === "activate")
          .map((x) => [`${(x.action as { card: string }).card}#${(x.action as { skill: number }).skill}`, x.why[0]] as const),
      );
    const ours = firstOf(mine);
    const legacyFirst = firstOf(theirs);
    let compared = 0;
    for (const [key, why] of legacyFirst) {
      const got = ours.get(key);
      // The one difference this stage records rather than hides: a keyword's
      // own activation ([Awaken] and the eleven like it) is a `DEFINE KEYWORD`
      // hook body, which is Stage 7's (#153–#157) — the legacy engine answers
      // about such a line and this one does not name it at all.
      if (!got) {
        const [cardOf, indexOf] = key.split("#").slice(-2);
        void cardOf;
        const inst = board.r.cards[key.slice(0, key.lastIndexOf("#"))];
        const line = parseSkills(CTX.defs[inst.cardId].skill ?? null).find((sk) => sk.index === Number(indexOf));
        assert.ok(line?.keyword, `${key} is refused an activation by the legacy engine and neither offered nor refused by this one`);
        continue;
      }
      assert.deepEqual(got, why, `${key}: the two engines give a different first reason for refusing an activation`);
      const about = { name: "A-THREE", reaching: "activate" as const };
      assert.deepEqual(refusal(got!, about), refusal(why, about), `${key}: the same requirement reads differently on the two engines`);
      compared++;
    }
    assert.ok(compared >= 3, `only ${compared} activation refusals were compared against the legacy engine`);
    assertMenuInvariants(rulesEngine.legalActions(CTX, board.r), mine, "the activation menu of a board that stops every gate");
  }

  // 5. 22-44-3: a line used once is used up, and the card's *other* lines are
  //    untouched — which is the whole reason the count is per line.
  {
    const board = stagedFor(["A-ONCE"], []);
    const user = board.r.sides.p1.zones.battle[0];
    const done = bothUse(board, { type: "activate", player: "p1", card: user, skill: 0 });
    assert.deepEqual(done.r.events, done.l.events, "a [Once per turn] skill does not log the same thing on the two engines");
    const usedUp = (x: { action: Action }) => x.action.type === "activate" && (x.action as { card: string }).card === user;
    const again = rulesEngine.rejectedActions(CTX, done.r.state, rulesEngine.legalActions(CTX, done.r.state)).find(usedUp);
    const legacyAgain = rejectedActions(CTX, done.l.state, legalActions(CTX, done.l.state)).find(usedUp);
    assert.deepEqual(again?.why[0], { kind: "oncePerTurn", what: "skill" }, "a [Once per turn] skill used once is not refused as used up");
    assert.deepEqual(again?.why[0], legacyAgain?.why[0], "the two engines refuse a used-up skill differently");
    // …and the turn ending gives it back, which is what `endTurn` empties.
    let next = rulesEngine.apply(CTX, done.r.state, { type: "endMain", player: "p1" }).state as VmState;
    for (let i = 0; i < 40 && next.turnPlayer !== "p1"; i++) {
      const pr = next.prompt as { kind: string; player?: PlayerId };
      if (!pr.player) break;
      next = rulesEngine.apply(CTX, next, pr.kind === "charge" ? { type: "charge", player: pr.player, card: null } : { type: "endMain", player: pr.player }).state as VmState;
    }
    assert.deepEqual(next.cards[user].usedThisTurn, [], "the turn passing did not give a [Once per turn] skill back");
  }

  // 6. A skill nobody drafted, and one whose effect the compiler could not
  //    read: refused rather than resolved for nothing (the 8 Sep 2026
  //    precedent, applied to a move).
  {
    const board = stagedFor(["A-UNREAD"], []);
    const user = board.r.sides.p1.zones.battle[0];
    assert.equal(
      rulesEngine.legalActions(CTX, board.r).some((a) => a.action.type === "activate" && (a.action as { card: string }).card === user),
      false,
      "a skill whose effect the compiler could not read was offered",
    );
    const why = rulesEngine.rejectedActions(CTX, board.r, rulesEngine.legalActions(CTX, board.r)).find((x) => x.action.type === "activate" && (x.action as { card: string }).card === user);
    assert.deepEqual(why?.why[0], { kind: "unread", card: user }, "a skill this engine cannot resolve is refused for something other than being unread");
  }

  // 7. 4-2 / 12-2-2: an Extra Card used from the hand. Its price is the skill's
  //    orbs **and** the card's own energy cost, because using one is how an
  //    Extra is played at all — and the card goes to the Drop Area as it
  //    resolves. The one branch where a line's price is not the line's alone.
  {
    const board = stagedFor([], ["A-E-RED"], ["E-MYSTERY", "A-FREE"]);
    const mystery = board.r.sides.p1.zones.hand[0];
    const inHand = board.r.sides.p1.zones.hand[1];
    // The Extra's effect is one the compiler cannot read, so it is refused —
    // and refused for *that*, not for the price it could in fact pay.
    const why = rulesEngine.rejectedActions(CTX, board.r, rulesEngine.legalActions(CTX, board.r)).find((x) => x.action.type === "activate" && (x.action as { card: string }).card === mystery);
    assert.deepEqual(why?.why[0], { kind: "unread", card: mystery }, "an Extra in hand whose effect cannot be read is refused for something else");
    // 9-1-3-1: an ordinary Battle Card's line in the hand is refused with the
    // area it is valid in, and that is the difference between the two.
    const battleCard = rulesEngine.rejectedActions(CTX, board.r, rulesEngine.legalActions(CTX, board.r)).find((x) => x.action.type === "activate" && (x.action as { card: string }).card === inHand);
    assert.deepEqual(battleCard?.why[0], { kind: "zone", card: inHand, area: "battle" }, "a Battle Card's skill in the hand is not refused with the area it is valid in");
    const legacyBattleCard = rejectedActions(CTX, board.l, legalActions(CTX, board.l)).find((x) => x.action.type === "activate" && (x.action as { card: string }).card === inHand);
    assert.deepEqual(battleCard?.why[0], legacyBattleCard?.why[0], "the two engines refuse a hand-bound Battle Card skill differently");

    // …and one whose effect *can* be read: offered at the card's own cost, and
    // the card is in the Drop when it has resolved, on both engines.
    const usable = stagedFor([], ["A-E-RED"], ["A-EXTRA"]);
    const extra = usable.r.sides.p1.zones.hand[0];
    const offered = rulesEngine.legalActions(CTX, usable.r).find((a) => a.action.type === "activate" && (a.action as { card: string }).card === extra);
    assert.ok(offered, "an Extra Card in hand whose skill the engine can resolve is not offered");
    assert.equal(offered!.cost?.energy, 1, "an Extra's activation is not charged the card's own energy cost as well as the skill's orbs (12-2-2)");
    const used = bothUse(usable, { type: "activate", player: "p1", card: extra, skill: 0 });
    assert.deepEqual(used.r.events, used.l.events, "using an Extra Card from hand does not log the same thing on the two engines");
    assert.ok(used.r.state.sides.p1.zones.drop.includes(extra), "the Extra did not go to the Drop Area as it was used (12-2-2)");
    assert.equal(used.r.state.sides.p1.zones.drop.includes(extra), used.l.state.players.p1.drop.includes(extra), "the two engines left the used Extra in different places");

    // 12-2-2 with orbs as well: the card's energy cost and the skill's orbs are
    // **one** price, colours included, on both engines. The legacy
    // `activatable` used to add the two totals and then plan against the *play
    // cost's* colours alone, so on a board short of the skill's colour it
    // offered a skill it could not pay the orbs of — a divergence this block
    // recorded rather than copied. The owner ruled this engine right (13 Sep
    // 2026) and the legacy engine was fixed as the bug it was (#271), so what is
    // asserted now is the agreement: the same offer where the colour is there,
    // and the same first requirement where the total is there and the colour
    // is not.
    const both2 = stagedFor([], ["A-E-RED", "A-E-RED"], ["A-EXTRA-ORB"]);
    const orbExtra = both2.r.sides.p1.zones.hand[0];
    const findOrb = (list: LegalAction[]) => list.find((a) => a.action.type === "activate" && (a.action as { card: string }).card === orbExtra);
    const orbOffer = findOrb(rulesEngine.legalActions(CTX, both2.r));
    assert.deepEqual(orbOffer?.cost, { energy: 2, orbs: { Red: 2 }, describe: "2 energy (2 red)" }, "an Extra's activation does not add its energy cost to the skill's orbs, colours and all");
    const legacyOrbOffer = findOrb(legalActions(CTX, both2.l));
    assert.ok(legacyOrbOffer, "the legacy engine does not offer an Extra with orbs on a board that can pay both halves");
    assert.deepEqual(legacyOrbOffer!.cost, orbOffer!.cost, "the two engines price an Extra's orbs and energy cost differently");
    // The total but not the colour: two blue energy for a red card's {r}. Both
    // engines refuse, and refuse for the colour — not "1 short", and not the
    // orbs alone (#271's `A-EXTRA-ORB`, "both halves").
    const blue = stagedFor([], ["A-E-BLUE", "A-E-BLUE"], ["A-EXTRA-ORB"]);
    const blueExtra = blue.r.sides.p1.zones.hand[0];
    assert.equal(findOrb(rulesEngine.legalActions(CTX, blue.r)), undefined, "the rules engine offered an Extra whose orb colour the board cannot pay");
    assert.equal(findOrb(legalActions(CTX, blue.l)), undefined, "the legacy engine offered an Extra whose orb colour the board cannot pay (4-2, 12-2-2)");
    const blueWhy = rulesEngine.rejectedActions(CTX, blue.r, rulesEngine.legalActions(CTX, blue.r)).find((x) => x.action.type === "activate" && (x.action as { card: string }).card === blueExtra);
    const legacyBlueWhy = rejectedActions(CTX, blue.l, legalActions(CTX, blue.l)).find((x) => x.action.type === "activate" && (x.action as { card: string }).card === blueExtra);
    assert.deepEqual(blueWhy?.why[0], { kind: "energyColour", colour: "Red", need: 2, have: 0 }, "an Extra short of its colour is not refused for the colour of the whole price");
    assert.deepEqual(legacyBlueWhy?.why[0], blueWhy?.why[0], "the two engines refuse an Extra short of its orb colour with a different first requirement");
    // …and one red among the two: the colour is still short, by the one orb
    // the play cost's convention does not cover, and both say so alike.
    const mixed = stagedFor([], ["A-E-RED", "A-E-BLUE"], ["A-EXTRA-ORB"]);
    const mixedExtra = mixed.r.sides.p1.zones.hand[0];
    const mixedWhy = rulesEngine.rejectedActions(CTX, mixed.r, rulesEngine.legalActions(CTX, mixed.r)).find((x) => x.action.type === "activate" && (x.action as { card: string }).card === mixedExtra);
    const legacyMixedWhy = rejectedActions(CTX, mixed.l, legalActions(CTX, mixed.l)).find((x) => x.action.type === "activate" && (x.action as { card: string }).card === mixedExtra);
    assert.deepEqual(mixedWhy?.why[0], { kind: "energyColour", colour: "Red", need: 2, have: 1 }, "an Extra one red short is not refused for that one red");
    assert.deepEqual(legacyMixedWhy?.why[0], mixedWhy?.why[0], "the two engines refuse an Extra one orb short with a different first requirement");
    // No energy at all: the whole price is what is short, on both — not the
    // orbs alone, which is what the legacy twin used to say first.
    const bare = stagedFor([], [], ["A-EXTRA-ORB"]);
    const bareExtra = bare.r.sides.p1.zones.hand[0];
    const bareWhy = rulesEngine.rejectedActions(CTX, bare.r, rulesEngine.legalActions(CTX, bare.r)).find((x) => x.action.type === "activate" && (x.action as { card: string }).card === bareExtra);
    const legacyBareWhy = rejectedActions(CTX, bare.l, legalActions(CTX, bare.l)).find((x) => x.action.type === "activate" && (x.action as { card: string }).card === bareExtra);
    assert.deepEqual(bareWhy?.why[0], { kind: "energy", need: 2, have: 0 }, "an Extra on an empty board is not refused for the whole of its price");
    assert.deepEqual(legacyBareWhy?.why[0], bareWhy?.why[0], "the two engines count an Extra's whole price differently on an empty board");
    const orbUsed = bothUse(both2, { type: "activate", player: "p1", card: orbExtra, skill: 0 });
    assert.deepEqual(orbUsed.r.events, orbUsed.l.events, "using an Extra with orbs as well does not log the same thing on the two engines");
    assert.deepEqual(
      (orbUsed.r.state.sides.p1.zones.energy ?? []).map((id) => orbUsed.r.state.cards[id].mode),
      ["rest", "rest"],
      "an Extra's combined price did not rest both energy",
    );
    assert.ok(orbUsed.r.state.sides.p1.zones.drop.includes(orbExtra), "an Extra with orbs did not reach the Drop Area");
  }

  // 8. `contract/fixtures/activate.json`'s own board: the pump-and-grant the
  //    client contract is emitted from, played on both engines.
  {
    const board = stagedFor(["PUMPCRIT"], ["A-E-RED"]);
    const pump = board.r.sides.p1.zones.battle[0];
    const done = bothUse(board, { type: "activate", player: "p1", card: pump, skill: 0 });
    assert.deepEqual(done.r.events, done.l.events, "the contract fixture's activation does not log the same thing on the two engines");
    // …and the rules the skill put in force are the same rules, read off the
    // state rather than off the board: `vm/view.ts` still draws a card's
    // *printed* attributes, so what a client would see of them is #149's parity
    // work and not this issue's. The contract itself is untouched either way —
    // no `Snapshot` field moved, so `npm run contract:emit` writes no change.
    const inForce = (list: { kind: string; value: unknown; until: string; target: string; source?: string }[]) => list.map((e) => [e.kind, JSON.stringify(e.value), e.until, e.target, e.source ?? null]);
    assert.deepEqual(inForce(done.r.state.effects), inForce(done.l.state.effects), "the two engines put different rules in force from one skill");
    assert.equal(done.r.state.effects.length, 2, "the pump and the keyword it grants are not both in force on the rules engine");
  }
}

console.log("verify/vm: ok");

// ── 20. a cost reducer in force (#148 Build 2, #146's seam) ─────────────────
//
// 20-21: "reduce the energy cost of your red cards in your hand by 1" is a
// [Permanent], and a [Permanent] could not be in play on this engine until a
// card could be played (#146). Now one can, so the four pieces of layer
// machinery `vm/costs.ts`'s header named are built and this is what they claim:
//
//  1. **A price is read through its declared layers and nowhere else.** A
//     reducer in force lowers `costOf` and the price a play is charged follows,
//     because `DEFINE COST energy` names that attribute and `amountOn` reads it
//     through `attrsNow`. Nothing in `vm/costs.ts` knows the word "reduction".
//  2. **20-21-2 floors at zero, and takes the colours down with it.** A flat
//     reduction removes one orb of the coloured requirement for each energy it
//     removes from the total — which is what makes an unpayable play payable
//     rather than merely cheaper.
//  3. **The coloured half moves on its own.** The owner's BT19-039 ruling
//     (9 Sep 2026): "reduce the specified cost by {r}" relaxes which colours
//     are demanded and moves the total *nothing*. That is why `specified` is a
//     layer of `specifiedCost` and of no numeric attribute.
//  4. **Both engines charge the same price and ask the same question.** The row
//     the menu wears, the `Requirement` a shortfall answers with, the payment
//     prompt and the cards actually rested — compared against the legacy
//     `playCost`/`planPayment` on the same staged board.
//
// What is deliberately *not* here: 22-19's [Warrior of Universe 7], which
// clears a ≪Universe 7≫ card's specified cost outright. It is a **keyword**
// rather than a `costReduction` op, so it is a `DEFINE KEYWORD` hook body and
// Stage 7's (#153–#157) — `keywords.rules` declares no hook bodies at all yet,
// and reading one keyword by name in `vm/costs.ts` would be the branch this
// whole module exists to remove.
{
  const rulesEngine = engineFor("rules");

  // The cards this block stages with, added here as §16–§19's are.
  DEFS["R-CUT"] = card("R-CUT", { energyCost: 3, skill: "[Permanent] Reduce the energy cost of your red cards in your hand by 1." });
  DEFS["R-CUT-COLOUR"] = card("R-CUT-COLOUR", { energyCost: 3, skill: "[Permanent] Reduce the specified cost of your red cards in your hand by {r}." });
  DEFS["R-BYSTANDER"] = card("R-BYSTANDER", { energyCost: 3 });
  DEFS["R-TWO"] = card("R-TWO", { energyCost: 2 });
  DEFS["R-E-BLUE"] = card("R-E-BLUE", { colors: ["Blue"] });

  const CUT_DECKS = {
    seed: 13,
    p1: { name: "You", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") },
  };

  /** One staged Main Phase on both engines: a card in hand, a [Permanent] in the Battle Area, and some energy. */
  function withReducer(inHand: string, inPlay: string, energy: string[]): { r: VmState; l: GameState; card: string; source: string } {
    let r = rulesEngine.createGame(CTX, CUT_DECKS).state as VmState;
    let l = createGame(CTX, CUT_DECKS).state;
    for (let i = 0; i < 30; i++) {
      const pr = r.prompt as { kind: string; player: PlayerId };
      const a: Action | null =
        pr.kind === "chooseFirst"
          ? { type: "chooseFirst", player: pr.player, first: "p1" }
          : pr.kind === "mulligan"
            ? { type: "mulligan", player: pr.player, redraw: false }
            : pr.kind === "charge"
              ? { type: "charge", player: pr.player, card: null }
              : null;
      if (!a) break;
      r = rulesEngine.apply(CTX, r, a).state as VmState;
      l = apply(CTX, l, a).state;
    }
    assert.equal(r.prompt.kind, "main", "the rules game did not reach a Main Phase to price a play in");
    assert.equal(l.prompt.kind, "main", "the legacy game did not reach a Main Phase to price a play in");
    // The whole hand is one known card, so the only price under test is the one
    // the assertions name — an opening hand of five different costs would make
    // "the menu" a different claim on every seed.
    for (const id of r.sides.p1.zones.hand) {
      r.cards[id].cardId = inHand;
      l.cards[id].cardId = inHand;
    }
    const target = r.sides.p1.zones.hand[0];
    const source = r.sides.p1.zones.deck[0];
    const energyIds = r.sides.p1.zones.deck.slice(1, 1 + energy.length);
    for (const st of [r.cards[source], l.cards[source]]) {
      st.cardId = inPlay;
      st.mode = "active";
    }
    energyIds.forEach((id, i) => {
      for (const st of [r.cards[id], l.cards[id]]) {
        st.cardId = energy[i];
        st.mode = "active";
      }
    });
    const taken = new Set([source, ...energyIds]);
    r.sides.p1.zones.deck = r.sides.p1.zones.deck.filter((id) => !taken.has(id));
    l.players.p1.deck = l.players.p1.deck.filter((id) => !taken.has(id));
    r.sides.p1.zones.battle = [source];
    l.players.p1.battle = [source];
    r.sides.p1.zones.energy = energyIds;
    l.players.p1.energy = energyIds;
    return { r, l, card: target, source };
  }

  /**
   * What the two engines say a play of this card costs, and what each refuses it
   * with.
   *
   * The legacy menu carries no `cost` on a play — only an activation wears one
   * — so the figure it is compared against is `playCost` itself, which is the
   * function every legacy site that charges a play goes through. That is the
   * comparison that matters: a row whose figure came from a second reading is
   * the drift `vm/costs.ts` exists to prevent, and here the two readings are on
   * two different engines.
   */
  function priced(board: { r: VmState; l: GameState; card: string }): {
    cost: { energy: number; orbs?: Partial<Record<string, number>>; describe: string } | undefined;
    legacyCost: { total: number; specified: Partial<Record<string, number>> };
    why: Requirement | undefined;
    legacyWhy: Requirement | undefined;
    offered: boolean;
    legacyOffered: boolean;
  } {
    const rLegal = rulesEngine.legalActions(CTX, board.r);
    const lLegal = legalActions(CTX, board.l);
    const isThis = (x: { action: Action }) => x.action.type === "play" && (x.action as { card: string }).card === board.card;
    const mine = rLegal.find(isThis);
    const myWhy = rulesEngine.rejectedActions(CTX, board.r, rLegal).find(isThis);
    const theirWhy = rejectedActions(CTX, board.l, lLegal).find(isThis);
    return {
      cost: mine?.cost as { energy: number; orbs?: Partial<Record<string, number>>; describe: string } | undefined,
      legacyCost: playCost(CTX, board.l, board.card),
      why: myWhy?.why[0],
      legacyWhy: theirWhy?.why[0],
      offered: !!mine,
      legacyOffered: lLegal.some(isThis),
    };
  }

  /** The rules engine's row, said in the legacy engine's own terms, so the two are one comparison. */
  const asLegacy = (cost: { energy: number; orbs?: Partial<Record<string, number>> } | undefined) => ({ total: cost?.energy ?? 0, specified: cost?.orbs ?? {} });

  // The baseline, so the rest is a *change* and not a coincidence: a red card
  // costing 2 with one red orb, one blue energy, and nothing in force.
  {
    const board = withReducer("R-TWO", "R-BYSTANDER", ["R-E-BLUE"]);
    const both = priced(board);
    assert.equal(both.offered, false, "a card nobody can pay for is on the menu");
    assert.deepEqual(both.legacyCost, { total: 2, specified: { Red: 1 } }, "the fixture is not the printed price this block is measuring a change against");
    assert.deepEqual(both.why, { kind: "energy", need: 2, have: 1 }, "the unreduced price is not the shortfall the legacy engine reports");
    assert.deepEqual(both.why, both.legacyWhy, "the two engines refuse an unreduced price differently");
    assert.equal(
      attrsNow(CTX, DBS, board.r, board.card).costOf,
      2,
      "a card with no reducer in force does not read its printed cost as the price",
    );
  }

  // 20-21-1 and 20-21-2 together, which is claim 1 and claim 2: the reducer
  // takes the total to 1 **and** the one red orb with it, so a board that could
  // not pay the printed price can pay this one.
  {
    const board = withReducer("R-TWO", "R-CUT", ["R-E-BLUE"]);
    assert.equal(attrsNow(CTX, DBS, board.r, board.card).costOf, 1, "a [Permanent] cost reducer in play did not reach the card it is about (20-21)");
    assert.deepEqual(attrsNow(CTX, DBS, board.r, board.card).specifiedCost, [], "a flat reduction did not take the coloured requirement down with the total (20-21-2)");
    const both = priced(board);
    assert.deepEqual(both.cost, { energy: 1, describe: "1 energy" }, "the row does not wear the reduced price");
    assert.deepEqual(asLegacy(both.cost), both.legacyCost, "the two engines put a different price on the same reduced play");
    assert.equal(both.why, undefined, "a play the reducer made affordable is still refused");
    assert.equal(both.legacyWhy, undefined, "the legacy engine refuses a play the reducer made affordable");

    // …and the charge is the reduced one: one card rested, and the same card on
    // both engines, which is the promise `arena:diff` exists to keep.
    const r = rulesEngine.apply(CTX, board.r, { type: "play", player: "p1", card: board.card });
    const l = apply(CTX, board.l, { type: "play", player: "p1", card: board.card });
    assert.deepEqual(JSON.parse(JSON.stringify(r.events)), JSON.parse(JSON.stringify(l.events)), "a play at a reduced price does not log the same thing on the two engines");
    assert.deepEqual((r.state as VmState).sides.p1.zones.energy, (l.state as GameState).players.p1.energy, "the two engines rested different energy for the same reduced price");
  }

  // 20-21-2's floor: a reduction bigger than the price is 0 and never less, and
  // a free play is a play — so the card is offered with no price at all.
  {
    const board = withReducer("V1", "R-CUT", []);
    assert.equal(attrsNow(CTX, DBS, board.r, board.card).costOf, 0, "a reduction bigger than the printed cost did not floor at zero (20-21-2)");
    const both = priced(board);
    assert.equal(both.cost, undefined, "a play reduced to nothing wears a price");
    assert.deepEqual(both.legacyCost, { total: 0, specified: {} }, "the legacy engine does not read the same floor at zero");
    assert.equal(both.offered, true, "a play reduced to nothing is not offered");
    assert.equal(both.why, undefined, "a play reduced to nothing is refused");
    assert.equal(both.legacyWhy, undefined, "the legacy engine refuses a play reduced to nothing");
  }

  // Claim 3, and the owner's BT19-039 ruling written as a test: the coloured
  // half alone. Two blue energy, a card demanding one red orb — refused for the
  // colour, and offered once the colour is relaxed, with the **total** exactly
  // where it was.
  {
    const plain = withReducer("R-TWO", "R-BYSTANDER", ["R-E-BLUE", "R-E-BLUE"]);
    const colourWhy = priced(plain);
    assert.deepEqual(colourWhy.why, { kind: "energyColour", colour: "Red", need: 1, have: 0 }, "a card short of a colour is not refused for it");
    assert.deepEqual(colourWhy.why, colourWhy.legacyWhy, "the two engines refuse a colour differently");

    const relaxed = withReducer("R-TWO", "R-CUT-COLOUR", ["R-E-BLUE", "R-E-BLUE"]);
    assert.equal(attrsNow(CTX, DBS, relaxed.r, relaxed.card).costOf, 2, "relaxing the specified cost moved the total, and the owner's BT19-039 ruling says it moves nothing");
    assert.deepEqual(attrsNow(CTX, DBS, relaxed.r, relaxed.card).specifiedCost, [], "relaxing the specified cost did not take the orb it named");
    const both = priced(relaxed);
    assert.deepEqual(both.cost, { energy: 2, describe: "2 energy" }, "the row does not wear the relaxed requirement at the printed total");
    assert.deepEqual(asLegacy(both.cost), both.legacyCost, "the two engines put a different price on the same relaxed play");
    assert.equal(both.why, undefined, "a play the relaxed colour made payable is still refused");
    assert.equal(both.legacyWhy, undefined, "the legacy engine refuses a play the relaxed colour made payable");
  }

  // A reducer whose filter does not match asks nothing of the price: the
  // `costReduction` reaches the cards its selector finds and no others, which is
  // the one thing a static collected into a list nothing filters would get
  // wrong.
  {
    const board = withReducer("V-BLUE", "R-CUT", ["R-E-BLUE"]);
    assert.equal(attrsNow(CTX, DBS, board.r, board.card).costOf, 1, "a reducer scoped to red cards reduced a blue one");
  }
}

// ── 21. a prohibition in force (#146 and #147's 20-14 gap) ──────────────────
//
// 20-14 is a *legality*, not a value, and until a card could be put in play
// (#146) there was nothing on this engine to put one in force: `permanents`
// refused `forbid` by name and the host answered "nothing forbids it" to every
// question. Both are now the board's answer, and this is what that claims:
//
//  1. **The same first refusal.** A [Permanent] saying "you can't play Battle
//     Cards", a card's own "this card can't be played from any area except by
//     skills" (9-1-3-3, which holds wherever the card sits), a ban on the
//     charge and a turn-long ban on using skills: each refuses the move on both
//     engines with the same `Requirement`, naming the same card and the same
//     duration, so `wording.ts` says the same sentence about it.
//  2. **One predicate, two lists.** The move is off the menu *because* it is
//     refused — the very reading `legalActions` and `rejectedActions` are two
//     views of — and the host's `forbids` is that same reading, so a program
//     that asks 0-2-5's question gets the board's answer rather than `false`.
//  3. **Both origins.** A prohibition standing from a [Permanent] and one put
//     in force for the turn by a skill are the same rule to every reader, which
//     is why the timed half is staged as the `ContinuousEffect` both engines
//     keep rather than as a second mechanism.
//
// One ordering is deliberately *not* matched and is asserted as it stands: for
// a plain Battle Card the legacy `whyNotPlayFromHand` puts the price before the
// prohibition, and for a Unison or an X cost it puts the prohibition first.
// This engine reads a `REFUSE` before the price throughout. The two only differ
// on a board that is both short of energy and forbidden; see `actions.rules`.
{
  const rulesEngine = engineFor("rules");

  DEFS["F-NO-PLAY"] = card("F-NO-PLAY", { energyCost: 3, skill: "[Permanent] You can't play Battle Cards." });
  DEFS["F-NO-CHARGE"] = card("F-NO-CHARGE", { energyCost: 3, skill: "[Permanent] You can't place cards in your Energy Area." });
  DEFS["F-QUIET"] = card("F-QUIET", { energyCost: 3 });
  DEFS["F-UNPLAYABLE"] = card("F-UNPLAYABLE", { skill: "[Permanent] This card can't be played from any area except by skills." });
  DEFS["F-SKILL"] = card("F-SKILL", { energyCost: 1, skill: "[Activate: Main] Draw 1 card." });
  DEFS["F-E-RED"] = card("F-E-RED", { colors: ["Red"] });

  const BAN_DECKS = {
    seed: 14,
    p1: { name: "You", leader: "L-RED", main: fifty("V1") },
    p2: { name: "Claude", leader: "L-BLUE", main: fifty("V-BLUE") },
  };

  /** A Main Phase on both engines: one card in hand, one in the Battle Area, and enough energy that only a rule can stop the move. */
  function banned(inHand: string, inPlay: string, energy = 2): { r: VmState; l: GameState; card: string; source: string } {
    let r = rulesEngine.createGame(CTX, BAN_DECKS).state as VmState;
    let l = createGame(CTX, BAN_DECKS).state;
    for (let i = 0; i < 30; i++) {
      const pr = r.prompt as { kind: string; player: PlayerId };
      const a: Action | null =
        pr.kind === "chooseFirst"
          ? { type: "chooseFirst", player: pr.player, first: "p1" }
          : pr.kind === "mulligan"
            ? { type: "mulligan", player: pr.player, redraw: false }
            : pr.kind === "charge"
              ? { type: "charge", player: pr.player, card: null }
              : null;
      if (!a) break;
      r = rulesEngine.apply(CTX, r, a).state as VmState;
      l = apply(CTX, l, a).state;
    }
    assert.equal(r.prompt.kind, "main", "the rules game did not reach a Main Phase to forbid a move in");
    for (const id of r.sides.p1.zones.hand) {
      r.cards[id].cardId = inHand;
      l.cards[id].cardId = inHand;
    }
    const target = r.sides.p1.zones.hand[0];
    const source = r.sides.p1.zones.deck[0];
    const energyIds = r.sides.p1.zones.deck.slice(1, 1 + energy);
    for (const id of [source, ...energyIds]) {
      for (const st of [r.cards[id], l.cards[id]]) {
        st.cardId = id === source ? inPlay : "F-E-RED";
        st.mode = "active";
      }
    }
    const taken = new Set([source, ...energyIds]);
    r.sides.p1.zones.deck = r.sides.p1.zones.deck.filter((id) => !taken.has(id));
    l.players.p1.deck = l.players.p1.deck.filter((id) => !taken.has(id));
    r.sides.p1.zones.battle = [source];
    l.players.p1.battle = [source];
    r.sides.p1.zones.energy = energyIds;
    l.players.p1.energy = energyIds;
    return { r, l, card: target, source };
  }

  /** The first requirement each engine gives for a move about this card, or undefined when it is offered. */
  function firstRefusal(board: { r: VmState; l: GameState }, type: Action["type"], card: string): { mine: Requirement | undefined; theirs: Requirement | undefined; offered: boolean; legacyOffered: boolean } {
    const rLegal = rulesEngine.legalActions(CTX, board.r);
    const lLegal = legalActions(CTX, board.l);
    const isThis = (x: { action: Action }) => x.action.type === type && (x.action as { card?: string | null }).card === card;
    return {
      mine: rulesEngine.rejectedActions(CTX, board.r, rLegal).find(isThis)?.why[0],
      theirs: rejectedActions(CTX, board.l, lLegal).find(isThis)?.why[0],
      offered: rLegal.some(isThis),
      legacyOffered: lLegal.some(isThis),
    };
  }

  // The control: the same board with a [Permanent] that forbids nothing, so
  // every assertion below is a *change* and not the board being unplayable.
  {
    const board = banned("V1", "F-QUIET");
    const play = firstRefusal(board, "play", board.card);
    assert.equal(play.offered, true, "the control board cannot play the card at all, so nothing below measures a prohibition");
    assert.equal(play.legacyOffered, true, "the legacy control board cannot play the card either");
  }

  // 20-14 about the player: "you can't play Battle Cards", standing from a
  // [Permanent] in the Battle Area. Off the menu on both engines, and refused
  // with the same requirement naming the same card.
  {
    const board = banned("V1", "F-NO-PLAY");
    const play = firstRefusal(board, "play", board.card);
    assert.equal(play.offered, false, "a play a [Permanent] forbids is on the menu");
    assert.equal(play.legacyOffered, false, "the legacy engine offers a play its own [Permanent] forbids");
    assert.deepEqual(play.mine, { kind: "forbidden", by: "F-NO-PLAY", until: "permanent" }, "a forbidden play is not refused with the rule that forbids it");
    assert.deepEqual(play.mine, play.theirs, "the two engines refuse a forbidden play differently");
    assert.ok(refusal(play.mine!, { name: "V1", reaching: "play" }).fact.length > 0, "a prohibition's refusal has no words");
    assert.throws(() => rulesEngine.apply(CTX, board.r, { type: "play", player: "p1", card: board.card }), IllegalAction, "a forbidden play was taken anyway");
  }

  // 9-1-3-3: the card's own rule about itself, read wherever it sits — here in
  // the hand, where no [Permanent] of it is otherwise valid (9-1-3-1). It is
  // `bySkill: false`, so it bans the play a player declares and nothing else.
  {
    const board = banned("F-UNPLAYABLE", "F-QUIET");
    const play = firstRefusal(board, "play", board.card);
    assert.equal(play.offered, false, "a card whose own rule forbids playing it is on the menu");
    assert.deepEqual(play.mine, { kind: "forbidden", by: "F-UNPLAYABLE", until: "permanent" }, "a card's own prohibition is not read from the hand (9-1-3-3)");
    assert.deepEqual(play.mine, play.theirs, "the two engines read a card's own prohibition differently");
  }

  // The charge, at its own question: 7-2-11's move refused by 20-14 rather than
  // by the one-a-turn rule, which is `whyNotCharge`'s second test.
  {
    const board = banned("V1", "F-NO-CHARGE");
    // Back to a Charge Phase question: the staged board is at the Main Phase,
    // where the charge is refused for a different reason entirely (#145).
    const toCharge = (s: VmState) => {
      const next = structuredClone(s);
      next.phase = "charge";
      next.prompt = { kind: "charge", player: "p1" };
      // `banned` stages its board via the Main Phase, where `charged` is
      // already true for p1 (#269) — rewinding the phase by hand has to
      // rewind that too, or the once-per-turn refusal fires ahead of the one
      // this block means to test.
      next.sides.p1.attrs.charged = false;
      return next;
    };
    const r = toCharge(board.r);
    const l = structuredClone(board.l);
    l.phase = "charge";
    l.prompt = { kind: "charge", player: "p1" };
    const rLegal = rulesEngine.legalActions(CTX, r);
    const lLegal = legalActions(CTX, l);
    const carded = (list: { action: Action }[]) => list.filter((x) => x.action.type === "charge" && (x.action as { card: string | null }).card !== null);
    assert.deepEqual(carded(rLegal), [], "a charge a [Permanent] forbids is on the menu");
    assert.deepEqual(carded(lLegal), [], "the legacy engine offers a charge its own [Permanent] forbids");
    const mine = rulesEngine.rejectedActions(CTX, r, rLegal).find((x) => x.action.type === "charge")?.why[0];
    const theirs = rejectedActions(CTX, l, lLegal).find((x) => x.action.type === "charge")?.why[0];
    assert.deepEqual(mine, { kind: "forbidden", by: "F-NO-CHARGE", until: "permanent" }, "a forbidden charge is not refused with the rule that forbids it");
    assert.deepEqual(mine, theirs, "the two engines refuse a forbidden charge differently");
    // …and the skip stays. 7-2-11 is a *may*, and taking nothing places no card,
    // so nothing about 20-14 touches it: the legacy engine offers it under the
    // same ban, which is why `mentionsCandidate` reads a prohibition as a
    // question about the candidate rather than about the board.
    const skip = (list: { action: Action }[]) => list.some((x) => x.action.type === "charge" && (x.action as { card: string | null }).card === null);
    assert.equal(skip(rLegal), true, "the skip went with the cards when the charge was forbidden");
    assert.equal(skip(lLegal), true, "the legacy engine stopped offering the skip under a placeEnergy ban");
  }

  // Claim 3: the same rule put in force for the turn by a skill instead of
  // standing from a [Permanent]. Staged as the `ContinuousEffect` **both**
  // engines keep, which is the point — one shape, one reading, two engines.
  {
    const board = banned("V1", "F-SKILL", 2);
    const ban = {
      id: 900,
      target: "",
      kind: "forbid" as const,
      value: 0,
      forbid: { what: "activateSkill" as const, player: "p1" as const },
      until: "turn" as const,
      source: board.source,
      createdTurn: board.r.turn,
      ownerTurn: "p1" as const,
      master: "p1" as const,
    };
    board.r.effects.push(ban);
    board.l.effects.push(ban);
    const skillCard = board.source;
    const mine = firstRefusal(board, "activate", skillCard);
    assert.equal(mine.offered, false, "a skill a turn-long rule forbids is on the menu");
    assert.equal(mine.legacyOffered, false, "the legacy engine offers a skill its own effect forbids");
    assert.deepEqual(mine.mine, { kind: "forbidden", by: "F-SKILL", until: "turn" }, "a forbidden activation is not refused with the rule that forbids it");
    assert.deepEqual(mine.mine, mine.theirs, "the two engines refuse a forbidden activation differently");
  }

  // The ordering this engine does not match, asserted so it cannot drift
  // unnoticed: short of energy **and** forbidden, the legacy engine answers
  // about the price and this one about the ban.
  {
    const board = banned("V1", "F-NO-PLAY", 0);
    const play = firstRefusal(board, "play", board.card);
    assert.deepEqual(play.mine, { kind: "forbidden", by: "F-NO-PLAY", until: "permanent" }, "a forbidden play short of energy does not answer about the ban");
    assert.deepEqual(play.theirs, { kind: "energy", need: 1, have: 0 }, "the legacy engine stopped answering about the price first, and this divergence is recorded on the assumption that it does");
  }

  // Claim 2, from the other side: the host's own 0-2-5 question reads the
  // board, so an instruction and a menu cannot disagree about what is banned.
  {
    const board = banned("V1", "F-NO-PLAY");
    assert.equal(forbids(CTX, DBS, board.r, "play", { player: "p1", card: board.card }), true, "the rules engine's own `forbids` does not see a [Permanent] in play");
    assert.equal(forbids(CTX, DBS, board.r, "attack", { player: "p1", card: board.card }), false, "a rule about playing forbids attacking as well");
  }

  // 13-3's growUnison, declared over the player attribute #269 added
  // (`grewUnison`) — staged like `banned`, except the "in play" card goes to
  // the Unison Area rather than the Battle Area, since that is the one area
  // this move reads. P-UNISON is the card the play-family tests above
  // already declared.
  {
    function growBoard(): { r: VmState; l: GameState; unison: string; copy: string } {
      let r = rulesEngine.createGame(CTX, BAN_DECKS).state as VmState;
      let l = createGame(CTX, BAN_DECKS).state;
      for (let i = 0; i < 30; i++) {
        const pr = r.prompt as { kind: string; player: PlayerId };
        const a: Action | null =
          pr.kind === "chooseFirst"
            ? { type: "chooseFirst", player: pr.player, first: "p1" }
            : pr.kind === "mulligan"
              ? { type: "mulligan", player: pr.player, redraw: false }
              : pr.kind === "charge"
                ? { type: "charge", player: pr.player, card: null }
                : null;
        if (!a) break;
        r = rulesEngine.apply(CTX, r, a).state as VmState;
        l = apply(CTX, l, a).state;
      }
      assert.equal(r.prompt.kind, "main", "the rules game did not reach a Main Phase to grow a Unison in");
      const unison = r.sides.p1.zones.deck[0];
      const copy = r.sides.p1.zones.hand[0];
      for (const id of [unison, copy]) {
        r.cards[id].cardId = "P-UNISON";
        l.cards[id].cardId = "P-UNISON";
      }
      r.sides.p1.zones.deck = r.sides.p1.zones.deck.filter((id) => id !== unison);
      l.players.p1.deck = l.players.p1.deck.filter((id) => id !== unison);
      r.sides.p1.zones.unison = [unison];
      l.players.p1.unison = unison;
      return { r, l, unison, copy };
    }

    // No Unison in play at all: refused board-level, before any card is asked
    // about — `whyNotCharge`'s own order, which `whyNotGrowUnison` (added
    // beside it) now follows too.
    {
      const bare = rulesEngine.createGame(CTX, BAN_DECKS).state as VmState;
      const bareLegacy = createGame(CTX, BAN_DECKS).state;
      let r = bare;
      let l = bareLegacy;
      for (let i = 0; i < 30; i++) {
        const pr = r.prompt as { kind: string; player: PlayerId };
        const a: Action | null =
          pr.kind === "chooseFirst"
            ? { type: "chooseFirst", player: pr.player, first: "p1" }
            : pr.kind === "mulligan"
              ? { type: "mulligan", player: pr.player, redraw: false }
              : pr.kind === "charge"
                ? { type: "charge", player: pr.player, card: null }
                : null;
        if (!a) break;
        r = rulesEngine.apply(CTX, r, a).state as VmState;
        l = apply(CTX, l, a).state;
      }
      const rLegal = rulesEngine.legalActions(CTX, r);
      const lLegal = legalActions(CTX, l);
      assert.equal(rLegal.some((x) => x.action.type === "growUnison"), false, "growUnison is offered with no Unison in play");
      assert.equal(lLegal.some((x) => x.action.type === "growUnison"), false, "the legacy engine offers growUnison with no Unison in play");
      const mine = rulesEngine.rejectedActions(CTX, r, rLegal).find((x) => x.action.type === "growUnison")?.why[0];
      assert.deepEqual(mine, { kind: "target", reason: "no Unison Card in play to grow" }, "growUnison with no Unison in play is not refused by name");
    }

    // Staged: legal on both engines, over the same board.
    const board = growBoard();
    const grow = { type: "growUnison" as const, player: "p1" as const, card: board.copy };
    const rLegal = rulesEngine.legalActions(CTX, board.r);
    const lLegal = legalActions(CTX, board.l);
    assert.ok(
      rLegal.some((x) => x.action.type === "growUnison" && (x.action as { card: string }).card === board.copy),
      "growing the staged Unison from its own copy in hand is not offered",
    );
    assert.ok(
      lLegal.some((x) => x.action.type === "growUnison" && (x.action as { card: string }).card === board.copy),
      "the legacy engine does not offer growing the staged Unison",
    );

    // Taking it completes on the legacy engine — a marker, the copy under the
    // Unison, the once-a-turn fact set (`ps.grewUnisonThisTurn`, read by
    // `setPlayerAttr`'s legacy case).
    const l2 = apply(CTX, board.l, grow);
    assert.equal((l2.state as GameState).cards[board.unison].markers, 1, "the Unison did not gain a marker on the legacy engine");
    assert.deepEqual((l2.state as GameState).cards[board.unison].under, [board.copy], "the copy did not go under the Unison on the legacy engine");

    // The rules engine's own move-under primitive is not built yet
    // (`vm/host.ts`'s `placeUnder`, throwing `NotYet("#146")` unconditionally)
    // — declaring growUnison over the player attribute #269 adds is what
    // finally offers the move at all, and the `NotYet` it hits partway through
    // the `DO` is caught at the one program boundary `stepProgram` already has
    // for exactly this (`vm/flow.ts`): logged as a note naming the issue that
    // finishes it, the program dropped, the rest of the turn unaffected —
    // "stops that one skill rather than the game". Nothing after the failed
    // `moveTo` ran, so neither the marker nor the once-a-turn fact is set;
    // that half is `arena-fuzz --engine rules` and #146's to close, not this
    // issue's — `ENGINE_INFO.rules.available` is still false, so no real game
    // can reach this today.
    const r2 = rulesEngine.apply(CTX, board.r, grow);
    assert.ok(
      r2.events.some((e) => e.type === "note" && typeof (e as { text?: string }).text === "string" && (e as { text: string }).text.includes("#146")),
      "growing a Unison on the rules engine did not note the move-under gap and name #146",
    );
    assert.equal((r2.state as VmState).cards[board.unison].markers, 0, "the Unison gained a marker despite the DO stopping before addMarker ran");
    assert.equal((r2.state as VmState).sides.p1.attrs.grewUnison, false, "the once-a-turn fact was set despite the DO stopping before setPlayerAttr ran");

    // Once a turn: a second copy, staged the same way, is refused before the
    // move-under gap is ever reached — the once-a-turn requirement is a fact
    // about the *player*, not about what the interpreter can finish, so it is
    // checked (and can refuse) without needing the rest built. Set by hand,
    // since taking the real move never reaches `setPlayerAttr` today.
    {
      const second = board.r.sides.p1.zones.hand[1];
      board.r.cards[second].cardId = "P-UNISON";
      board.r.sides.p1.attrs.grewUnison = true;
      const legal = rulesEngine.legalActions(CTX, board.r);
      assert.equal(legal.some((x) => x.action.type === "growUnison"), false, "a second Unison growth this turn is offered");
      const why = rulesEngine.rejectedActions(CTX, board.r, legal).find((x) => x.action.type === "growUnison")?.why[0];
      assert.deepEqual(why, { kind: "oncePerTurn", what: "grow a Unison" }, "a second growth this turn is not refused with the once-a-turn requirement");
    }

    // A hand card that is not a copy of the Unison: refused by name, the last
    // gate `whyNotGrowUnison` asks.
    {
      const fresh = growBoard();
      fresh.r.cards[fresh.copy].cardId = "V1";
      const legal = rulesEngine.legalActions(CTX, fresh.r);
      assert.equal(legal.some((x) => x.action.type === "growUnison" && (x.action as { card: string }).card === fresh.copy), false, "growing with a card that is not the Unison is offered");
      const why = rulesEngine.rejectedActions(CTX, fresh.r, legal).find((x) => x.action.type === "growUnison" && (x.action as { card: string }).card === fresh.copy)?.why[0];
      assert.deepEqual(why, { kind: "cardType", card: fresh.copy, needs: "a copy of the Unison Card in play" }, "the wrong card is not refused by name");
    }
  }
}
