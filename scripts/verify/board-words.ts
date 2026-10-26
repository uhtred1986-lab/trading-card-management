/**
 * `board-words.ts`: the zone, phase, mode, colour and phrase vocabulary
 * `wording.ts`, `narration.ts`, `effects.ts` and `lighting.ts` turn into
 * English and colour, read from `rulesets/dbs/words.rules` through the loaded
 * definition (issue #159 — "words from config").
 *
 * The acceptance is that moving the words out of TypeScript changed no
 * sentence, so `LEGACY` below is the hand-written tables as they stood on
 * `main` before #159, frozen here verbatim, and the suite compares the loaded
 * words to them field by field and then every table's output, over every key,
 * old against new. Part of `npm test`; run from `scripts/verify-arena.ts`.
 */
import assert from "node:assert/strict";
import { dbsWords, hasArea, wordsFor, wordsFromRuleset } from "../../src/lib/arena/board-words";
import { loadDbs, loadFusion } from "../../src/lib/arena/rulesets";
import { refusal, sentence, type Reaching } from "../../src/lib/arena/wording";
import { narrate, type Narrator } from "../../src/lib/arena/narration";
import { describeStatic, untilWords } from "../../src/lib/arena/effects";
import { colourOf, LEADER_COLOURS, TONES } from "../../src/lib/arena/lighting";
import { COLORS } from "../../src/lib/arena/vm/script-schema";
import type { Area, EffectUntil } from "../../src/lib/arena/types";

const dbs = loadDbs();
assert.ok(dbs.ok, `the DBS ruleset did not load: ${dbs.ok ? "" : JSON.stringify(dbs.errors, null, 2)}`);
if (!dbs.ok) throw new Error("unreachable");

// ── the tables as they were, before they came from words.rules ──────────────
const LEGACY_NARRATION_AREA: Record<Area, string> = {
  deck: "the deck",
  hand: "hand",
  drop: "the Drop",
  leader: "the Leader Area",
  battle: "the Battle Area",
  combo: "the Combo Area",
  energy: "the Energy Area",
  life: "life",
  warp: "the Warp",
  unison: "the Unison Area",
  zDeck: "the Z-Deck",
  zEnergy: "Z-Energy",
  removed: "out of the game",
};
const LEGACY_AREA: Record<Area, string> = {
  deck: "your deck",
  hand: "your hand",
  drop: "your Drop Area",
  leader: "the Leader Area",
  battle: "your Battle Area",
  combo: "your Combo Area",
  energy: "your Energy Area",
  life: "your Life Area",
  warp: "your Warp",
  unison: "the Unison Area",
  zDeck: "your Z-Deck",
  zEnergy: "your Z-Energy Area",
  removed: "out of the game",
};
const LEGACY_PHASE: Record<string, string> = {
  charge: "Charge Phase",
  main: "Main Phase",
  mainEnd: "Main Phase ends",
  end: "End Phase",
  declared: "Attack declared",
  offense: "Offense Step",
  defense: "Defense Step",
  damage: "Damage Step",
  battleEnd: "The battle ends",
  setup: "Setting up",
  over: "The game is over",
};
const LEGACY_VERB: Record<string, string> = {
  attack: "attack",
  combo: "combo",
  play: "be played",
  playUnison: "be played",
  playZ: "be played",
  activate: "use its skill",
  charge: "be charged",
  counter: "counter",
  block: "block",
  choose: "be chosen",
};
const LEGACY_WINDOW: Record<string, string> = {
  main: "Only in your Main Phase.",
  battle: "Only during a battle.",
  defense: "Only in the Defense Step of your opponent's turn.",
  nextTurn: "No attacks on the first turn — from your next turn on.",
};
const LEGACY_LEADER_COLOURS = ["Red", "Blue", "Green", "Yellow", "Black"];

/** `effects.ts`'s `untilWords` as it was: the phrases written into the switch. */
function legacyUntilWords(until: EffectUntil, o: { master: string | null; viewer: string; them: string; sourceName?: string | null }): string {
  const mine = o.master === o.viewer;
  switch (until) {
    case "turn":
      return "until the end of the turn";
    case "battle":
      return "for the battle";
    case "nextTurn":
      return mine ? "until the start of your next turn" : `until the start of ${o.them}'s next turn`;
    case "opponentTurn":
      return mine ? `until the start of ${o.them}'s next turn` : "until the start of your next turn";
    case "afterNextCharge":
      return "through the next Charge Phase";
    case "afterOpponentCharge":
      return mine ? `through ${o.them}'s next Charge Phase` : "through your next Charge Phase";
    // #1163: added with its words, never in the old switch — the master's own Main Phase.
    case "nextMain":
      return mine ? "until the start of your next Main Phase" : `until the start of ${o.them}'s next Main Phase`;
    // #930: added with its words — the end of the master's own turn.
    case "ownTurn":
      return mine ? "until the end of your turn" : `until the end of ${o.them}'s turn`;
    case "game":
      return "for the rest of the game";
    case "permanent":
      return o.sourceName ? `while ${o.sourceName} is in play` : "while its card is in play";
    case "whileSourceInPlay":
      return o.sourceName ? `while ${o.sourceName} is in a Battle Area` : "while its card is in a Battle Area";
  }
}

// ── the loaded words equal the old tables, field by field ───────────────────
const fromDef = wordsFromRuleset(dbs.definition);
// #782: dbsWords() is the table `npm run arena:rulesets` generated (rulesets/dbs/board-words.ts), so the browser
// never parses the ruleset for it; this is what keeps that table equal to words.rules.
assert.deepEqual(dbsWords(), fromDef, "dbsWords() (the generated rulesets/dbs/board-words.ts) is wordsFromRuleset over the loaded DBS ruleset: run `npm run arena:rulesets` after editing a .rules file");
assert.deepEqual(fromDef.area, LEGACY_AREA);
assert.deepEqual(fromDef.narrationArea, LEGACY_NARRATION_AREA);
assert.deepEqual(fromDef.phase, LEGACY_PHASE);
assert.deepEqual(fromDef.mode, { active: "Active Mode", rest: "Rest Mode" });
assert.deepEqual(fromDef.leaderColours, LEGACY_LEADER_COLOURS);
assert.deepEqual(fromDef.verb, LEGACY_VERB);
assert.deepEqual(fromDef.window, LEGACY_WINDOW);

// ── ...and so does every table's output, old against new ────────────────────
const UNTILS: EffectUntil[] = ["turn", "battle", "nextTurn", "opponentTurn", "afterNextCharge", "afterOpponentCharge", "nextMain", "ownTurn", "game", "permanent", "whileSourceInPlay"];
assert.deepEqual(Object.keys(fromDef.until).sort(), [...UNTILS].sort(), "words.rules declares one `until` word per duration, and no other");
for (const until of UNTILS) {
  for (const master of ["p1", "p2", null] as const) {
    for (const sourceName of [undefined, null, "Son Goku"]) {
      const o = { master, viewer: "p1" as const, them: "Claude", sourceName };
      assert.equal(untilWords(until, o), legacyUntilWords(until, o), `untilWords(${until}, master ${master}, source ${sourceName})`);
      assert.equal(untilWords(until, o, fromDef), legacyUntilWords(until, o));
    }
  }
}

// `wording.ts`: every verb and window, for the requirement kinds that use them.
const REACHING = [...Object.keys(LEGACY_VERB), "mulligan"] as Reaching[];
const who = { name: "BT1-001" };
for (const reaching of REACHING) {
  for (const window of [...Object.keys(LEGACY_WINDOW), "somethingElse"]) {
    const s = sentence({ kind: "timing", window } as never, { ...who, reaching }, fromDef);
    const verb = LEGACY_VERB[reaching] ?? "do that";
    const fact = window === "nextTurn" ? `${who.name} cannot attack yet.` : `${who.name} cannot ${verb} now.`;
    assert.equal(s, `${fact} ${LEGACY_WINDOW[window] ?? `Only in the ${window}.`}`, `timing refusal for ${reaching} in ${window}`);
  }
  assert.equal(sentence({ kind: "mode", card: "c1", locked: false } as never, { ...who, reaching }), `${who.name} is in Rest Mode — it cannot ${LEGACY_VERB[reaching] ?? "do that"}. It stands back up at the start of your next turn.`);
}
// Every area in `zone`'s sentence, and every `until` through `forbidden`/`immune`.
for (const area of Object.keys(LEGACY_AREA) as Area[]) {
  assert.equal(refusal({ kind: "zone", card: "c1", area } as never, { ...who, reaching: "activate" }).fact, `${who.name} has to be in ${LEGACY_AREA[area]} for that.`);
}
for (const until of UNTILS) {
  const w = legacyUntilWords(until, { master: null, viewer: "p1", them: "your opponent", sourceName: "Son Goku" });
  assert.equal(refusal({ kind: "forbidden", by: "Son Goku", until } as never, { ...who, reaching: "attack" }).remedy, `${w.charAt(0).toUpperCase()}${w.slice(1)}.`);
}

// `narration.ts`: every move between every pair of areas, every phase, both modes.
// The full log (#463): the table's own narration says too little of these to compare them by.
const FULL = { full: true };
const n: Narrator = { viewer: "p1", them: "Claude", art: { c1: { cardId: "BT1-001", name: "BT1-001", imageUrl: null } } };
const areas = Object.keys(LEGACY_AREA) as Area[];
for (const from of areas) {
  for (const to of areas) {
    for (const owner of ["p1", "p2"] as const) {
      const b = { t: "move" as const, card: "c1", from, to, owner };
      assert.equal(narrate(b, n, undefined, FULL), narrate(b, n, fromDef, FULL));
    }
  }
}
for (const phase of Object.keys(LEGACY_PHASE)) {
  const b = { t: "phase" as const, phase, player: "p1" as const, turn: 1 };
  assert.equal(narrate(b as never, n, undefined, FULL), narrate(b as never, n, fromDef, FULL));
}
assert.equal(narrate({ t: "phase", phase: "charge", player: "p1", turn: 1 }, n, undefined, FULL), "Your Charge Phase.");
assert.equal(narrate({ t: "mode", card: "c1", mode: "rest" }, n, undefined, FULL), "BT1-001 switches to Rest Mode.");
assert.equal(narrate({ t: "mode", card: "c1", mode: "active" }, n, undefined, FULL), "BT1-001 switches to Active Mode.");
// What the table hears of the same three: the turn beginning, and nothing for a mode switch it can see.
assert.equal(narrate({ t: "phase", phase: "charge", player: "p1", turn: 1 }, n), "Your turn begins.");
assert.equal(narrate({ t: "mode", card: "c1", mode: "rest" }, n), null);

// `describeStatic`'s "skip": every phase word it can say.
for (const what of ["offense", "defense", "charge", "main", "end", "turn", "span"]) {
  const e = { source: "c1", target: "c1", kind: "skip" as const, value: { what, player: "p1" as const } };
  assert.equal(describeStatic(e as never, "p1").label, describeStatic(e as never, "p1", fromDef).label);
}
assert.equal(describeStatic({ source: "c1", target: "c1", kind: "skip" as const, value: { what: "offense" as const, player: "p1" as const } }, "p1").label, "skips its Offense Step");

// `lighting.ts`: the colours that light a room are `words.rules`' `room: true`,
// and the palette has a tone for exactly those.
assert.deepEqual([...LEADER_COLOURS], fromDef.leaderColours, "lighting's TONES and words.rules' room: true colours are one list");
assert.deepEqual(Object.keys(TONES).sort(), [...fromDef.leaderColours].sort());
for (const c of COLORS) {
  const expected = LEGACY_LEADER_COLOURS.includes(c) ? c : "Black";
  assert.equal(colourOf([c]), expected, `colourOf([${c}])`);
  assert.equal(colourOf([c], fromDef.leaderColours), expected);
}
assert.equal(colourOf([]), null);
// A ruleset that lights no room for Red sends it to Black, and one that lights a room the palette has no tone for does too.
assert.equal(colourOf(["Red"], ["Blue"]), "Black");
assert.equal(colourOf(["Purple"], ["Purple"]), "Black");

// ── a ruleset that stops agreeing is a broken build ─────────────────────────
{
  const broken = { ...dbs.definition, zones: { ...dbs.definition.zones } };
  delete (broken.zones as Record<string, unknown>).battle;
  assert.throws(() => wordsFromRuleset(broken), /zones\.rules no longer declares "battle"/);
}
for (const gone of ["battle", "charge", "active"]) {
  const rest = { ...dbs.definition.words };
  delete rest[gone];
  assert.throws(() => wordsFromRuleset({ ...dbs.definition, words: rest }), new RegExp(`no DEFINE WORDS ${gone}`), `a missing ${gone} word`);
}
// A phrase with no word is said by the shape's own default, not thrown over.
{
  const rest = { ...dbs.definition.words };
  delete rest.verbAttack;
  assert.equal(wordsFromRuleset({ ...dbs.definition, words: rest }).verb.attack, undefined);
}
{
  // No `room: true` anywhere means no leader could light a room.
  const words = Object.fromEntries(Object.entries(dbs.definition.words).map(([k, w]) => [k, w.of === "color" ? { ...w, room: false } : w]));
  assert.throws(() => wordsFromRuleset({ ...dbs.definition, words }), /marks no colour room: true/);
}

// F1-06: a game that does not declare an area gets no word for it, and the board reads that as "no such area".
{
  const fusion = loadFusion();
  assert.ok(fusion.ok, "the Fusion World ruleset did not load");
  if (!fusion.ok) throw new Error("unreachable");
  const fw = wordsFromRuleset(fusion.definition);
  assert.deepEqual(wordsFor("fusion"), fw, "wordsFor(fusion) is the generated table (npm run arena:rulesets)");
  assert.equal(wordsFor("dbs"), dbsWords());
  for (const a of ["warp", "unison", "zDeck", "zEnergy"] as const) {
    assert.ok(!hasArea(fw, a), `Fusion World has no ${a} area`);
    assert.ok(!(a in fw.narrationArea), `Fusion World has no narration word for ${a}`);
    assert.ok(hasArea(dbsWords(), a), `DBS still has ${a}`);
  }
  for (const a of ["deck", "hand", "drop", "leader", "battle", "combo", "energy", "life", "removed"] as const) assert.ok(hasArea(fw, a), `Fusion World words ${a}`);
  assert.deepEqual(fw.mode, { active: "Active Mode", rest: "Rest Mode" });
  // A word for an area the game does not declare is a stale declaration, not a quiet extra.
  const words = { ...fusion.definition.words, warp: { ...dbs.definition.words.warp } };
  assert.throws(() => wordsFromRuleset({ ...fusion.definition, words }), /does not declare/);
}

console.log("  board-words: the board's words are read from words.rules and every table says what it said before");
