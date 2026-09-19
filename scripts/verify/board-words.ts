/**
 * `board-words.ts`: the DBS zone/mode/colour vocabulary `wording.ts`,
 * `narration.ts` and `effects.ts` turn into English, checked against the
 * loaded ruleset and shown to produce identical output either way (issue
 * #159 — "words from config").
 *
 * There is no `words.rules` yet (#131), so `wordsFromRuleset` reads what the
 * declarations really do say (zones, phases/steps, the mode tokens, the
 * `colors` attribute) and validates `DBS_WORDS` against it, deriving the mode
 * words directly. This suite proves that check passes for the real DBS
 * ruleset today, and that every table gives the same sentence whichever
 * `BoardWords` it is handed — the comparison the issue asks for.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`.
 */
import assert from "node:assert/strict";
import { DBS_WORDS, wordsFromRuleset } from "../../src/lib/arena/board-words";
import { loadDbs } from "../../src/lib/arena/rulesets";
import { refusal, sentence } from "../../src/lib/arena/wording";
import { narrate, type Narrator } from "../../src/lib/arena/narration";
import { describeStatic } from "../../src/lib/arena/effects";

const dbs = loadDbs();
assert.ok(dbs.ok, `the DBS ruleset did not load: ${dbs.ok ? "" : JSON.stringify(dbs.errors, null, 2)}`);
if (!dbs.ok) throw new Error("unreachable");

// The check itself: DBS_WORDS still agrees with what game.rules/zones.rules/
// battle.rules/attributes.rules declare today. A zone renamed or a mode word
// added would throw here rather than drift silently into a wrong sentence.
const fromDef = wordsFromRuleset(dbs.definition);
assert.deepEqual(fromDef, DBS_WORDS, "wordsFromRuleset(dbs) should equal DBS_WORDS for the game both engines actually play");

// A ruleset that no longer declares a zone `wording.ts`/`narration.ts` name
// is a broken build, not a state to render around — the same choice
// `rulesets/words.ts`'s own `words()` makes.
{
  const broken = { ...dbs.definition, zones: { ...dbs.definition.zones } };
  delete (broken.zones as Record<string, unknown>).battle;
  assert.throws(() => wordsFromRuleset(broken), /zones\.rules no longer declares "battle"/);
}

// `refusal`'s "zone" case, on both sources: the same fact either way.
const zoneReq = { kind: "zone" as const, card: "c1", area: "battle" as const };
assert.equal(sentence(zoneReq, { name: "BT1-001", reaching: "activate" }), sentence(zoneReq, { name: "BT1-001", reaching: "activate" }, fromDef));
assert.match(refusal(zoneReq, { name: "BT1-001", reaching: "activate" }).fact, /your Battle Area/);

// `narrate`'s "move"/"mode"/"phase" cases, on both sources.
const n: Narrator = { viewer: "p1", them: "Claude", art: { c1: { cardId: "BT1-001", name: "BT1-001", imageUrl: null } } };
assert.equal(narrate({ t: "move", card: "c1", from: "hand", to: "energy", owner: "p1" }, n), narrate({ t: "move", card: "c1", from: "hand", to: "energy", owner: "p1" }, n, fromDef));
assert.equal(narrate({ t: "mode", card: "c1", mode: "rest" }, n), "BT1-001 switches to Rest Mode.");
assert.equal(narrate({ t: "mode", card: "c1", mode: "rest" }, n, fromDef), narrate({ t: "mode", card: "c1", mode: "rest" }, n));
assert.equal(narrate({ t: "phase", phase: "charge", player: "p1", turn: 1 }, n), "Your Charge Phase.");

// `describeStatic`'s "skip" case, on both sources.
const skipEffect = { source: "c1", target: "c1", kind: "skip" as const, value: { what: "offense" as const, player: "p1" as const } };
assert.equal(describeStatic(skipEffect, "p1").label, "skips its Offense Step");
assert.equal(describeStatic(skipEffect, "p1", fromDef).label, describeStatic(skipEffect, "p1").label);

console.log("  board-words: DBS_WORDS agrees with the loaded ruleset, and every table reads the same either way");
