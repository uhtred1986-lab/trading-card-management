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
import { IllegalAction, apply, createGame, legalActions, rejectedActions, type Action, type GameEvent, type GameState } from "../../src/lib/arena/engine";
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
import {
  FilterNeedsAttribute,
  MEASURES,
  NotYet,
  VM_STATE_VERSION,
  attrsOf,
  attributeGaps,
  attributesRead,
  cardAttributes,
  deferredMeasures,
  emptyZones,
  findCard,
  hostOf,
  inPlayZones,
  isVmState,
  attributesRequired,
  measuresUsed,
  moveCard,
  placeZones,
  playerAttributes,
  predicateOf,
  repeatAllowed,
  stepWorkNote,
  turnPhases,
  SETUP_ZONES,
  WORKED_STEPS,
  type Attrs,
  type VmState,
} from "../../src/lib/arena/vm";
import { loadRuleset, rulesetFor, type GameDefinition } from "../../src/lib/arena/rulesets";
import { FILTER_FIELD_NAMES } from "../../src/lib/arena/lang";
import { emptyFilter, type CardFilter } from "../../src/lib/arena/engine/filters";
import type { CardDef, PlayerId } from "../../src/lib/arena/engine/types";
import { CTX, DEFS, card, fifty, game, matches } from "./harness";

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
// shape rather than guessing about the other.
assert.equal(isVmState(game()), false, "a legacy state was read as the rules engine's");
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
  { what: "playing a card", run: () => rules.apply(CTX, state, { type: "play", player: "p1", card: "p1#1" }) },
  { what: "attacking", run: () => rules.apply(CTX, state, { type: "attack", player: "p1", attacker: "p1#0", target: "p2#0" }) },
  { what: "activating a skill", run: () => rules.apply(CTX, state, { type: "activate", player: "p1", card: "p1#1", skill: 0 }) },
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

// ── 5. a row is never replayed on the wrong interpreter ────────────────────

// The app around the six calls is still legacy-shaped (`games.ts` reads
// `state.turn`), so the seam is a check and not a cast: a rules state reaching
// it is named, not read field by field as `undefined`.
assert.throws(() => legacyState(state), EngineMismatch, "a rules state was read as the legacy engine's");
const legacy = game();
assert.equal(legacyState(legacy), legacy, "a legacy state did not pass the seam untouched");



// ── 6. a card is a bag of declared attributes ──────────────────────────────

const dbs = rulesetFor("dbs");
assert.ok(dbs.ok, `the DBS ruleset did not load: ${dbs.ok ? "" : JSON.stringify(dbs.errors, null, 2)}`);
const DBS: GameDefinition = dbs.ok ? dbs.definition : (undefined as never);

// The claim that makes every attribute reading below trustworthy: the catalog
// adapter and `attributes.rules` account for each other. Reported by name in
// both directions — a count would say something changed and nothing about what.
assert.deepEqual(attributeGaps(DBS), { unfilled: [], undeclared: [] }, "the catalog adapter and attributes.rules do not describe the same card");
assert.deepEqual(playerAttributes(DBS), ["energyMarkers"], "the player attributes of 1-14 are not what the game declares");
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
assert.deepEqual(fresh.sides.p1.attrs, { energyMarkers: 0 }, "a side does not start with the player attributes the game declares (1-14)");

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

console.log("verify/vm: ok");
