/**
 * The ruleset loader: what it resolves, and what it refuses.
 *
 * A `.rules` file parses on its own — the grammar is `lang/`'s, and
 * `scripts/verify/lang.ts` is where print-and-read-back is proved. What cannot
 * be checked without a *second* declaration is the loader's: a duplicate name,
 * a phase naming a step nothing declares, an action asking for a price that
 * does not exist, a trigger or a program naming a zone the game never
 * declared, a keyword hanging a body on a hook point the engine does not
 * offer. Each of those is a game that would load and then behave as if a line
 * of its own rules were not there, which is precisely the failure a
 * configuration-driven engine has to make loud.
 *
 * The DBS files are #133–#135 and the directory is empty today, so the set the
 * app actually loads is checked for the one thing an empty set can prove: that
 * it loads. #136 grows this file into the ruleset suite proper (whole-file
 * round trips, and every legacy union covered by a declaration).
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { loadRuleset, loadDbs, rulesetFor, HOOK_POINTS, type RulesetError } from "../../src/lib/arena/rulesets";

const lines = (...rows: string[]): string => rows.join("\n");

/** The errors of a load that was meant to fail, with a message a person could act on. */
function refused(files: Record<string, string>, what: string): RulesetError[] {
  const loaded = loadRuleset(files);
  assert.equal(loaded.ok, false, `${what} loaded, and it should not have`);
  const errors = loaded.ok ? [] : loaded.errors;
  assert.ok(errors.length > 0, `${what} was refused with no error to show`);
  for (const e of errors) {
    assert.ok(e.file, `${what}: an error with no file`);
    assert.ok(e.line >= 1 && e.col >= 1, `${what}: an error with no place (${e.line}:${e.col})`);
    assert.ok(e.message.length > 0, `${what}: an error with no message`);
  }
  return errors;
}

const says = (errors: RulesetError[], needle: string, what: string): RulesetError => {
  const hit = errors.find((e) => e.message.includes(needle));
  assert.ok(hit, `${what}: no error names ${JSON.stringify(needle)} — got ${JSON.stringify(errors.map((e) => e.message))}`);
  return hit;
};

// ── a ruleset that resolves ─────────────────────────────────────────────────

const WHOLE: Record<string, string> = {
  "game.rules": lines(
    "-- the game itself",
    "DEFINE GAME dbs",
    '  title: "Dragon Ball Super Card Game"',
    "  deck: 50",
    "  hand: 6",
    "  life: 8",
    "  phases: [main]",
    "",
    "DEFINE PHASE main",
    "  steps: [mainStart]",
    "  actions: [playCard]",
    '  text: "the phase a player takes their moves in (6-4)"',
    "",
    "DEFINE STEP mainStart",
    '  phase: "main"',
    "  DO {",
    '    note(text: "the moment [Auto] skills of the Main Phase answer to")',
    "  }",
  ),
  "zones.rules": lines(
    "DEFINE ZONE hand",
    "  owner: player",
    "  visibility: owner",
    '  text: "the cards a player holds (3-4)"',
    "",
    "DEFINE ZONE battle",
    "  owner: player",
    "  visibility: all",
    "  inPlay: true",
    "  modes: [active, rest]",
    '  text: "where Battle Cards are played (3-6)"',
  ),
  "play.rules": lines(
    "DEFINE COST energy",
    "  DO {",
    "    switchMode(target: [self], mode: rest)",
    "  }",
    '  text: "cards from the Energy Area, switched to Rest Mode (7-2)"',
    "",
    "DEFINE ACTION playCard",
    "  WHEN [main]",
    "  FOR 1 IN you.hand",
    "  COST [energy]",
    "  DO {",
    "    moveTo(target: $chosen, to: battle)",
    "  }",
    '  REFUSE "you cannot pay for that card"',
    "",
    "DEFINE TRIGGER played",
    "  ON moved(from: hand, to: battle)",
    '  BIND "subject"',
    '  text: "a card arrives in a Battle Area from outside play (9-6-9-4)"',
    "",
    "DEFINE KEYWORD Blocker",
    "  TAKES ()",
    '  text: "switch this card to Active Mode and make it the attack target (22-4)"',
    "  HOOK attackDeclared {}",
  ),
};

const whole = loadRuleset(WHOLE);
assert.ok(whole.ok, `the worked ruleset did not load: ${whole.ok ? "" : JSON.stringify(whole.errors, null, 2)}`);
if (whole.ok) {
  const { definition: def, vocabulary: vocab } = whole;
  assert.equal(def.id, "dbs");
  assert.equal(def.game?.title, "Dragon Ball Super Card Game");
  // The schema's defaults are the loader's to apply — the printer drops none,
  // so a field left out of the text is `undefined` until it gets here.
  assert.equal(def.game?.players, 2, "GAME's default player count was not applied");
  assert.deepEqual(Object.keys(def.zones), ["hand", "battle"]);
  assert.equal(def.sources["zone:battle"], "zones.rules", "a declaration does not know which file it came from");
  assert.equal(def.definitions.length, 9, "the ruleset does not hold every declaration it read");
  // The vocabulary is the definition's word lists, in the names the language's
  // hand-written constants use today (#137 makes those a re-export).
  assert.deepEqual(vocab.areas, ["hand", "battle"]);
  assert.deepEqual(vocab.keywordNames, ["Blocker"]);
  assert.deepEqual(vocab.triggers, ["played"]);
  assert.ok(vocab.durations.includes("turn") && vocab.sides.includes("opponent"), "the effect language's own words are missing");
  assert.equal(vocab.words["zone:battle"], "where Battle Cards are played (3-6)");
  assert.equal(vocab.words["game:dbs"], "Dragon Ball Super Card Game");
}

// ── a dangling reference ────────────────────────────────────────────────────

const dangling = refused({ "triggers.rules": lines("DEFINE TRIGGER played", "  ON moved(to: battle)", '  text: "a card arrives in a Battle Area"') }, "a trigger naming an undeclared zone");
const danglingZone = says(dangling, '"battle"', "a trigger naming an undeclared zone");
assert.match(danglingZone.message, /TRIGGER "played"/, "the error does not name the declaration the dangling name is in");
assert.match(danglingZone.message, /zone/i, "the error does not say what kind of name is missing");
assert.equal(danglingZone.clause, "TRIGGER", "the error's clause is not the DEFINE kind");
assert.equal(danglingZone.line, 2, "the error does not point at the line the name is on");

// The same shape for the other two references the plan names: an action's
// price, and a phase's steps.
says(
  refused({ "play.rules": lines("DEFINE ACTION playCard", "  WHEN [main]", "  COST [energy]", "  DO {", "    draw(n: 1)", "  }") }, "an action asking for an undeclared price"),
  '"energy"',
  "an action asking for an undeclared price",
);
says(refused({ "turn.rules": lines("DEFINE PHASE main", "  steps: [mainStart]") }, "a phase naming an undeclared step"), '"mainStart"', "a phase naming an undeclared step");

// An area named deep inside a program is a dangling zone too — the check reads
// the schema rows, so it sees a `moveTo`'s `to` nested in an `if`.
says(
  refused(
    {
      "zones.rules": lines("DEFINE ZONE battle", "  owner: player", "  visibility: all"),
      "play.rules": lines("DEFINE STEP mainStart", '  phase: "main"', "  DO {", "    moveTo(target: [self], to: warp)", "  }"),
    },
    "a program moving a card to an undeclared zone",
  ),
  '"warp"',
  "a program moving a card to an undeclared zone",
);

// ── a duplicate ─────────────────────────────────────────────────────────────

const zone = lines("DEFINE ZONE battle", "  owner: player", "  visibility: all");
const twice = refused({ "zones.rules": lines(zone, "", zone) }, "a zone declared twice");
const duplicate = says(twice, '"battle"', "a zone declared twice");
assert.match(duplicate.message, /already/, "a duplicate does not read as one");
assert.match(duplicate.message, /zones\.rules/, "a duplicate does not say where the first one is");
assert.equal(duplicate.line, 5, "a duplicate points at the first declaration rather than the second");

// Two files can each declare a zone of the same name; the loader names the
// file the first is in, because that is the half a person does not have open.
const across = refused({ "a-zones.rules": zone, "b-more-zones.rules": zone }, "a zone declared in two files");
assert.match(says(across, '"battle"', "a zone declared in two files").message, /a-zones\.rules/, "the duplicate does not name the file it clashes with");

// ── an unknown hook point ───────────────────────────────────────────────────

const hooks = refused(
  { "keywords.rules": lines("DEFINE KEYWORD Blocker", '  text: "switch this card to Active Mode (22-4)"', "  HOOK whenTheMoodTakesIt {}") },
  "a keyword body on an unknown hook point",
);
const unknownHook = says(hooks, '"whenTheMoodTakesIt"', "a keyword body on an unknown hook point");
assert.match(unknownHook.message, /KEYWORD "Blocker"/, "the error does not name the keyword");
assert.match(unknownHook.message, /hook point/, "the error does not say what a hook point is");
assert.ok(unknownHook.expected.length === HOOK_POINTS.length, "the error does not offer the hook points there are");
assert.equal(unknownHook.clause, "KEYWORD");

// ── what the app loads ──────────────────────────────────────────────────────

// Empty until #133–#135 write the files; the claim an empty set can carry is
// that the path the app takes works at all.
const dbs = loadDbs();
assert.ok(dbs.ok, `the DBS ruleset did not load: ${dbs.ok ? "" : JSON.stringify(dbs.errors, null, 2)}`);
if (dbs.ok) {
  assert.equal(dbs.definition.id, "dbs");
  assert.deepEqual(dbs.definition.definitions, [], "the DBS ruleset has files now — grow this check with them (#136)");
  assert.deepEqual(dbs.vocabulary.areas, []);
}
assert.equal(loadDbs(), dbs, "the ruleset is parsed again on every read");
assert.equal(rulesetFor("dbs").ok, true);
assert.equal(rulesetFor("fusion").ok, false, "Fusion World has no ruleset yet and must say so rather than load an empty one");

console.log("verify/rulesets: ok");
