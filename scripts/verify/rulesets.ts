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
 * The DBS files have begun to arrive (#133: `game.rules`, `attributes.rules`,
 * `zones.rules`; #134: `triggers.rules`; #135: `keywords.rules`), so the set
 * the app actually loads is checked for what those five carry: that it loads,
 * that it is the game it says it is, that the areas of the manual's §3 are
 * all declared, that every moment a record's WHEN may name is a moment the
 * definition declares and no other, and that every keyword the parser reads
 * is declared with the same arity. `words.rules` and `prompts.rules` still
 * wait on the owner's word on DEFINE WORDS/PROMPT (#131). #136 grows this
 * file into the ruleset suite proper (whole-file round trips beyond the DBS
 * set, and every remaining legacy union covered by a declaration).
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { loadRuleset, loadDbs, rulesetFor, HOOK_POINTS, type KeywordDef, type RulesetError } from "../../src/lib/arena/rulesets";
import { optionsFor, words } from "../../src/lib/arena/rulesets/words";
import { effectLanguage } from "../../src/lib/arena/ai/opponent";
import { deepEqual, parseDefinitions, parseRule, printDefinitions } from "../../src/lib/arena/lang";
import { KEYWORD_NAMES } from "../../src/lib/arena/engine/script-schema";
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

// The real DBS declarations, as far as they go. The completeness assertions —
// every `Area`, keyword and `Phase` of the legacy engine declared and nothing
// it does not know — are #136's; these are the claims #133's three files,
// #134's `triggers.rules` and #135's `keywords.rules` make on their own.
// words.rules and prompts.rules still wait on the owner's word on DEFINE
// WORDS/PROMPT (#131).
const dbs = loadDbs();
assert.ok(dbs.ok, `the DBS ruleset did not load: ${dbs.ok ? "" : JSON.stringify(dbs.errors, null, 2)}`);
if (dbs.ok) {
  const { definition: def, vocabulary: vocab } = dbs;
  assert.equal(def.id, "dbs");
  assert.equal(def.game?.title, "Dragon Ball Super Card Game", "the DBS ruleset does not say which game it is");
  // The setup numbers of the manual's 6-1 and 6-2-1, which are the whole
  // reason `DEFINE GAME` has fields rather than a title.
  assert.equal(def.game?.players, 2);
  assert.equal(def.game?.deck, 50, "the deck size of 6-1-3");
  assert.equal(def.game?.hand, 6, "the opening hand of 6-2-1-9");
  assert.equal(def.game?.life, 8, "the life of 6-2-1-10");
  assert.equal(def.game?.mulligan, true, "the redraw of 6-2-1-9-1");
  // Twelve areas in the manual's §3, plus the three a program has to be able
  // to name: `removed` (20-10), `under` (23-2) and `play` (9-1-3-1).
  assert.equal(Object.keys(def.zones).length, 15, `the DBS ruleset declares ${Object.keys(def.zones).length} zones, not 15`);
  assert.deepEqual(vocab.areas, Object.keys(def.zones), "the vocabulary's areas are not the zones the game declared");
  for (const zone of ["deck", "hand", "drop", "leader", "battle", "combo", "energy", "life", "warp", "unison", "zDeck", "zEnergy", "removed", "under", "play"]) {
    assert.ok(zone in def.zones, `no DEFINE ZONE for ${JSON.stringify(zone)}`);
  }
  assert.equal(def.zones.battle.inPlay, true, "the Battle Area is where a card is in play (9-1-3-1)");
  assert.equal(def.zones.unison.single, true, "only one card is in a Unison Area at a time (3-11-4)");
  assert.equal(def.zones.deck.visibility, "none", "the Deck Area is a secret area (3-2-2)");
  // Every phase of the turn the GAME names is declared, and the two that are
  // not a turn's (`setup`, `over`) are declared beside them.
  for (const phase of def.game?.phases ?? []) assert.ok(phase in def.phases, `DEFINE GAME names a phase ${JSON.stringify(phase)} with no declaration`);
  assert.equal(Object.keys(def.phases).length, 6, "the six phases the engine knows are not all declared");
  // The two defeat conditions of 0-1-3-2. Conceding and a card that ends the
  // game are gaps, recorded in the history entry of 12 Sep 2026.
  assert.deepEqual(Object.keys(def.wins).sort(), ["deckOut", "lifeOut"]);
  assert.equal(def.wins.lifeOut.result, "lose");
  // Every field of `CardDef` has a card attribute, so #136 has nothing to
  // report about this file; the derived ones beside them have no printed
  // counterpart, which is why the check is one-directional.
  for (const attr of ["id", "name", "type", "colors", "energyCost", "specifiedCost", "zEnergyCost", "power", "comboCost", "comboPower", "characters", "traits", "skill", "back", "alsoNames"]) {
    assert.ok(attr in def.attributes, `no DEFINE ATTRIBUTE for CardDef's ${JSON.stringify(attr)}`);
  }
  assert.equal(def.attributes.power.layers?.[0], "printed", "power does not say the printed value is its base (9-9-1-1)");
  assert.equal(def.sources["zone:battle"], "zones.rules");
  assert.equal(def.sources["game:dbs"], "game.rules");
  assert.equal(def.sources["attribute:power"], "attributes.rules");
  // Whole files, printed and read back: the round-trip promise over the
  // declarations the app actually loads.
  const printed = printDefinitions(def.definitions);
  const reread = parseDefinitions(printed);
  assert.ok(reread.ok, `the DBS ruleset does not re-parse after printing: ${reread.ok ? "" : JSON.stringify(reread.error)}`);
  if (reread.ok) assert.ok(deepEqual(reread.value, def.definitions), "printing the DBS ruleset and reading it back does not give the same declarations");

  // ── #134's triggers ──────────────────────────────────────────────────────
  // The assertion that issue exists for: the moments the record's WHEN is
  // validated against (`TRIGGERS`, which `lang/validate.ts` reads) and the
  // moments the definition declares are one list. Reported both ways by name,
  // because "53 !== 58" says nothing about which one went missing.
  const declaredTriggers = Object.keys(def.triggers);
  const wantedTriggers = [...TRIGGERS, ...COUNTER_WINDOWS.map((w) => `counter:${w}`)];
  const undeclared = wantedTriggers.filter((t) => !declaredTriggers.includes(t));
  const unanswerable = declaredTriggers.filter((t) => !wantedTriggers.includes(t));
  assert.deepEqual(undeclared, [], `the record's WHEN can name moments triggers.rules does not declare: ${undeclared.join(", ")}`);
  assert.deepEqual(unanswerable, [], `triggers.rules declares moments no record's WHEN can name: ${unanswerable.join(", ")}`);
  assert.equal(declaredTriggers.length, wantedTriggers.length, "a moment is declared twice");
  assert.deepEqual(vocab.triggers, declaredTriggers, "the vocabulary's triggers are not the moments the game declared");

  // And the same list in *words*: a declaration's `text:` is the WHEN line the
  // board would print, so #137 can make `TRIGGER_IN_WORDS` a re-export of the
  // vocabulary rather than a second copy that drifts.
  for (const t of TRIGGERS) {
    assert.equal(vocab.words[`trigger:${t}`], describeTrigger([t]), `the declaration of ${t} does not say in words what the record's WHEN says`);
  }
  for (const w of COUNTER_WINDOWS) assert.ok(vocab.words[`trigger:counter:${w}`], `the ${w} counter window is declared with no words for it`);

  // The nine zones a trigger's pattern names resolve against `zones.rules` —
  // the one thing about this file that needed #133, and the reason the DBS set
  // loads rather than merely parses.
  assert.equal(def.sources["trigger:played"], "triggers.rules");
  for (const zone of ["battle", "combo", "drop", "energy", "hand", "leader", "life", "unison", "zEnergy"]) {
    assert.ok(zone in def.zones, `the triggers name ${JSON.stringify(zone)}, which no DEFINE ZONE declares`);
  }

}

assert.equal(loadDbs(), dbs, "the ruleset is parsed again on every read");
assert.equal(rulesetFor("dbs"), dbs, "a game's ruleset is not the one the loader cached");
assert.equal(rulesetFor("fusion").ok, false, "Fusion World has no ruleset yet and must say so rather than load an empty one");

// ── one word list, three readers ────────────────────────────────────────────
//
// The other half of #137. The language, the workbench's chip editor and the
// referee's prompt each used to carry their own copy of the closed lists; the
// claim now is that they carry none, and that a word deleted from the game's
// declarations is gone from all three at once. So the test is one deletion and
// three questions, not three tests.
{
  const vocab = words();
  const gone = "warp";
  assert.ok(vocab.areas.includes(gone), `the DBS ruleset no longer declares ${JSON.stringify(gone)}, so this test asks nothing`);
  const mutated = { ...vocab, areas: vocab.areas.filter((a: string) => a !== gone) };
  const rule = `WHEN [auto] played\nTHEN\n  moveTo(target: $t, to: ${gone})`;

  // As it stands, all three know the word.
  assert.equal(parseRule(rule).ok, true, "the parser does not read an area the game declares");
  assert.ok(optionsFor("area").includes(gone), "the chip editor does not offer an area the game declares");
  // The prompt's own AREA line, not the whole prompt: `discard`'s `to` field
  // is an `OP_SCHEMA` enum of one value ("warp"), which is a field's closed
  // list and not the game's word list.
  const areaLine = (text: string) => text.split("\n").find((l) => l.startsWith("AREA: ")) ?? "";
  assert.ok(areaLine(effectLanguage()).includes(`"${gone}"`), "the referee is not told about an area the game declares");

  // With it deleted, none of them does — and nothing but the vocabulary was
  // touched to make that true.
  const refused = parseRule(rule, mutated);
  assert.equal(refused.ok, false, "the parser still read an area the game no longer declares");
  if (!refused.ok) assert.ok(refused.error.expected.includes("hand"), "the parser's list of what could have stood there is not the game's areas");
  assert.ok(!optionsFor("area", mutated).includes(gone), "the chip editor still offers an area the game no longer declares");
  assert.ok(!areaLine(effectLanguage(mutated)).includes(`"${gone}"`), "the referee is still told about an area the game no longer declares");

  // And again for the keyword names, which are `keywords.rules`' since #135 —
  // two readers this time, the parser and the chip editor. The referee is told
  // about keywords through `OP_SCHEMA`'s own `negateKeyword` enum, which is a
  // field's closed list rather than the game's word list.
  const noKeyword = "Blocker";
  assert.ok(vocab.keywordNames.includes(noKeyword), `the DBS ruleset no longer declares [${noKeyword}], so this test asks nothing`);
  const withoutKeyword = { ...vocab, keywordNames: vocab.keywordNames.filter((k: string) => k !== noKeyword) };
  const grant = `WHEN [auto] played\nTHEN\n  grant(target: $t, keyword: [${noKeyword}], until: turn)`;
  assert.equal(parseRule(grant).ok, true, "the parser does not read a keyword the game declares");
  assert.ok(optionsFor("keyword").includes(noKeyword), "the chip editor does not offer a keyword the game declares");
  assert.equal(parseRule(grant, withoutKeyword).ok, false, "the parser still read a keyword the game no longer declares");
  assert.ok(!optionsFor("keyword", withoutKeyword).includes(noKeyword), "the chip editor still offers a keyword the game no longer declares");

  // The one list of the five that is still the engine's, named here rather
  // than left to be discovered: `triggers` is a superset, by exactly the five
  // counter windows above. They are a `CounterWindow` and not a `Trigger` the
  // engine fires, so `validateRule` reading them would let a rule carry a WHEN
  // that never happens — the one thing that check exists to stop. #136 has to
  // make the two one list first.
  assert.deepEqual(
    vocab.triggers.filter((t: string) => !(TRIGGERS as readonly string[]).includes(t)),
    COUNTER_WINDOWS.map((w) => `counter:${w}`),
    "the moments the game declares and the engine's `Trigger` union does not have changed — until they are one list, `lang/validate.ts` reads the engine's",
  );
}

// ── keywords.rules against KEYWORD_NAMES, both directions ──────────────────

/**
 * The parameters `keywordOf` (`engine/cards.ts`) builds for each keyword, as
 * `keywords.rules`' own `TAKES` should read them. Hand-written against the
 * `KeywordSkill` union (`engine/types.ts`) rather than derived from it — a
 * union has no runtime shape to walk — but `Record` over `KEYWORD_NAMES`'
 * own element type means a keyword added to one list and not the other
 * fails `npm run typecheck` before this file ever runs, the same guard
 * `npm test` already has for the glossary.
 */
const KEYWORD_ARITY: Record<(typeof KEYWORD_NAMES)[number], { name: string; type: string }[]> = {
  Awaken: [{ name: "surge", type: "boolean" }],
  Wish: [],
  Field: [],
  Blocker: [],
  Critical: [],
  Strike: [{ name: "x", type: "number" }],
  Attack: [{ name: "x", type: "number" }],
  Revenge: [],
  Indestructible: [],
  Barrier: [],
  Deflect: [],
  Unique: [],
  Servant: [],
  "Energy-Exhaust": [],
  "Victory Strike": [],
  "Warrior of Universe 7": [],
  Ultimate: [],
  "Super Combo": [],
  "Dragon Ball": [],
  Wormhole: [],
  Invoker: [],
  Heroic: [],
  Villainous: [],
  Offering: [],
  Evolve: [{ name: "variant", type: "string" }],
  Union: [{ name: "variant", type: "string" }],
  "Over Realm": [
    { name: "x", type: "number" },
    { name: "dark", type: "boolean" },
  ],
  Swap: [{ name: "x", type: "number" }],
  Arrival: [{ name: "colors", type: "colors" }],
  Aegis: [{ name: "colors", type: "colors" }],
  Alliance: [{ name: "colors", type: "colors" }],
  Revive: [{ name: "colors", type: "colors" }],
  Successor: [],
  Overlord: [],
  Rejuvenate: [],
  "Spirit Boost": [{ name: "x", type: "number" }],
  Empower: [
    { name: "color", type: "color" },
    { name: "x", type: "number" },
  ],
  "Z-Awaken": [],
  "Z-Stack": [{ name: "x", type: "number" }],
};

if (dbs.ok) {
  const declared = Object.keys(dbs.definition.keywords).sort();
  const expected = [...KEYWORD_NAMES].sort();
  assert.deepEqual(declared, expected, "keywords.rules and KEYWORD_NAMES do not name the same keywords");
  for (const name of KEYWORD_NAMES) {
    const keyword: KeywordDef | undefined = dbs.definition.keywords[name];
    assert.ok(keyword, `keywords.rules has no DEFINE KEYWORD ${JSON.stringify(name)}`);
    assert.deepEqual(keyword.takes ?? [], KEYWORD_ARITY[name], `DEFINE KEYWORD ${name} TAKES the wrong parameters for what keywordOf reads`);
  }
}

console.log("verify/rulesets: ok");
