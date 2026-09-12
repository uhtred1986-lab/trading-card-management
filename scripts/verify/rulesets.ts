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
 * The DBS files are #133–#135. `triggers.rules` is in (#134), so the set the
 * app actually loads is held to the claim that file makes: every moment a
 * record's WHEN may name is a moment the definition declares, and no other.
 * #136 grows this file into the ruleset suite proper (whole-file round trips,
 * and every legacy union covered by a declaration).
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { loadRuleset, loadDbs, rulesetFor, DBS_FILES, HOOK_POINTS, type RulesetError } from "../../src/lib/arena/rulesets";
import { TRIGGERS, describeTrigger } from "../../src/lib/arena/gaps";
import type { CounterWindow } from "../../src/lib/arena/engine/types";

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

/**
 * The counter windows (4-3, 9-7). A [Counter] answers to a *window* rather
 * than to a card's own moment, so `triggers.rules` declares these five beside
 * the fifty-three and they are the only names in it a record's WHEN never
 * says. The list is held to the engine's union by the `satisfies`, so a sixth
 * window fails the typecheck here before it can go missing from the file.
 */
const COUNTER_WINDOWS = ["play", "attack", "battleCardAttack", "counter", "skill"] as const satisfies readonly CounterWindow[];

const dbs = loadDbs();

/**
 * #133's `zones.rules` is not merged yet, and a trigger's `to: battle` names a
 * zone nothing declares until it is — so what this branch can load is the same
 * files with those zones supplied. The failure is held to exactly that: an
 * error that is not a zone the declarations name is a real one, and the list
 * below is the zones #133 has to declare for this to resolve on its own.
 * Delete the stub, and this comment, with that merge.
 */
const MISSING_ZONE = /names a zone called "([^"]+)"/;
const missingZones = dbs.ok ? [] : [...new Set(dbs.errors.map((e) => MISSING_ZONE.exec(e.message)?.[1] ?? null))];
assert.ok(
  dbs.ok || (missingZones.length > 0 && missingZones.every((z) => z !== null)),
  `the DBS ruleset fails for something other than #133's missing zones: ${dbs.ok ? "" : JSON.stringify(dbs.errors.map((e) => e.message), null, 2)}`,
);
const zonesStub = missingZones.map((z) => lines(`DEFINE ZONE ${z}`, "  owner: player", "  visibility: all")).join("\n\n");
const loaded = dbs.ok ? dbs : loadRuleset({ ...DBS_FILES, "0-zones-until-133.rules": zonesStub });
assert.ok(loaded.ok, `the DBS ruleset did not load: ${loaded.ok ? "" : JSON.stringify(loaded.errors, null, 2)}`);

if (loaded.ok) {
  assert.equal(loaded.definition.id, "dbs");

  // The assertion this issue exists for: the moments the record's WHEN is
  // validated against (`TRIGGERS`, which `lang/validate.ts` reads) and the
  // moments the definition declares are one list. Reported both ways by name,
  // because "53 !== 58" says nothing about which one went missing.
  const declared = Object.keys(loaded.definition.triggers);
  const wanted = [...TRIGGERS, ...COUNTER_WINDOWS.map((w) => `counter:${w}`)];
  const undeclared = wanted.filter((t) => !declared.includes(t));
  const unanswerable = declared.filter((t) => !wanted.includes(t));
  assert.deepEqual(undeclared, [], `the record's WHEN can name moments triggers.rules does not declare: ${undeclared.join(", ")}`);
  assert.deepEqual(unanswerable, [], `triggers.rules declares moments no record's WHEN can name: ${unanswerable.join(", ")}`);
  assert.equal(declared.length, wanted.length, "a moment is declared twice");

  // And the same list in *words*: a declaration's `text:` is the WHEN line the
  // board would print, so #137 can make `TRIGGER_IN_WORDS` a re-export of the
  // vocabulary rather than a second copy that drifts.
  for (const t of TRIGGERS) {
    assert.equal(loaded.vocabulary.words[`trigger:${t}`], describeTrigger([t]), `the declaration of ${t} does not say in words what the record's WHEN says`);
  }
  for (const w of COUNTER_WINDOWS) assert.ok(loaded.vocabulary.words[`trigger:counter:${w}`], `the ${w} counter window is declared with no words for it`);

  // Every zone a trigger's pattern names is resolved — the whole reason the
  // file cannot load before #133. These are the zones it asks that game for.
  assert.ok(loaded.vocabulary.areas.includes("battle"), "the triggers name no Battle Area, so nothing was resolved");
}

assert.equal(loadDbs(), dbs, "the ruleset is parsed again on every read");
assert.equal(rulesetFor("dbs"), dbs, "a game's ruleset is not the one the loader cached");
assert.equal(rulesetFor("fusion").ok, false, "Fusion World has no ruleset yet and must say so rather than load an empty one");

console.log("verify/rulesets: ok");
