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
 * `zones.rules`), so the set the app actually loads is checked for what those
 * three carry: that it loads, that it is the game it says it is, and that the
 * areas of the manual's §3 are all declared. #136 grows this file into the
 * ruleset suite proper (whole-file round trips, and every legacy union covered
 * by a declaration — triggers and keywords among them, which are #134 and
 * #135).
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { DBS_FILES, loadRuleset, loadDbs, rulesetFor, expandMacros, opsIn, MacroError, HOOK_POINTS, type RulesetError } from "../../src/lib/arena/rulesets";
import { validateProgram, type Op } from "../../src/lib/arena/engine/script";
import { deepEqual, parseDefinitions, printDefinitions } from "../../src/lib/arena/lang";

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

// ── the macro expander ──────────────────────────────────────────────────────

/**
 * `expandMacros` lowers a program to the ops the interpreter knows. The DBS
 * `ops.rules` declares none yet — its header is the record of what each of the
 * thirty-one rows waits on — so the machinery is proved here against fixtures
 * instead, and the day a row becomes writable it is a declaration and nothing
 * else.
 *
 * Every fixture is named after a real `OP_SCHEMA` row, because that is the
 * only kind of macro there can be: the parser reads a body's steps against the
 * schema, so a `DEFINE OP` whose name is not an op could never be called. Two
 * of the bodies are what the row will mean once its primitive grows the field
 * it is missing (`ko` has no cause, `power` no way to write `$until`); they
 * are fixtures, and `ops.rules` is where the real ones will go.
 */
{
  /** The zones a macro body names: the loader resolves every area a program mentions, whichever declaration it sits in. */
  const ZONES = ["battle", "drop", "hand"].map((z) => lines(`DEFINE ZONE ${z}`, "  owner: player", "  visibility: all")).join("\n\n");

  /** A definition holding just these macros, which is all the expander reads. */
  const withMacros = (...decls: string[]) => {
    const loaded = loadRuleset({ "ops.rules": decls.join("\n\n"), "zones.rules": ZONES });
    assert.ok(loaded.ok, `the macro fixture did not load: ${loaded.ok ? "" : JSON.stringify(loaded.errors)}`);
    if (!loaded.ok) throw new Error("unreachable");
    return loaded.definition;
  };

  const KO = lines("DEFINE OP ko", "  TAKES (target: ref)", "  DO {", "    moveTo(target: $target, to: drop)", "  }", '  text: "to the owner\'s Drop"');
  const koCall = { op: "ko", target: { var: "t" } } as unknown as Op;

  // A call becomes its body, with the argument in the parameter's place.
  {
    const out = expandMacros([koCall], withMacros(KO));
    assert.deepEqual(out, [{ op: "moveTo", target: { var: "t" }, to: "drop" }], "a macro call did not expand to its body");
    assert.ok(validateProgram(out), "an expanded program is not a program");
    assert.deepEqual(opsIn(out), ["moveTo"], "a macro name survived the expansion");
  }

  // An op the game does not declare is passed through exactly as it is — which
  // is what lets the expander run before the whole table is declared.
  {
    const def = withMacros(KO);
    const program = [{ op: "power", target: { sel: { special: "self" } }, amount: 5000, until: "turn" }] as unknown as Op[];
    assert.deepEqual(expandMacros(program, def), program, "an op with no DEFINE OP was not left alone");
    assert.deepEqual(expandMacros([], def), [], "an empty program did not stay empty");
  }

  // Nested programs: a macro inside an `if`, inside a `may`, inside a mode.
  {
    const out = expandMacros(
      [
        { op: "if", cond: { kind: "count", sel: { side: "you", area: "battle" }, atLeast: 1 }, then: [koCall], else: [koCall] },
        { op: "may", ops: [koCall] },
        { op: "chooseMode", modes: [{ label: "KO it", ops: [koCall] }] },
      ] as unknown as Op[],
      withMacros(KO),
    );
    assert.deepEqual(opsIn(out), ["if", "moveTo", "moveTo", "may", "moveTo", "chooseMode", "moveTo"], "a macro nested in a program was not expanded");
    assert.ok(validateProgram(out), "an expanded nested program is not a program");
  }

  // An amount is an expression tree since 12 Sep 2026 (#122), so an argument
  // reaches the parameter wherever the tree names it, and a tree given as the
  // argument arrives whole.
  {
    const def = withMacros(lines("DEFINE OP power", "  TAKES (target: ref, amount: amount)", "  DO {", "    modifyAttr(target: $target, attr: power, amount: $amount, until: turn)", "  }"));
    const amount = { plus: [{ count: { side: "you", area: "battle" } }, 1] };
    const out = expandMacros([{ op: "power", target: { sel: { special: "self" } }, amount, until: "turn" } as unknown as Op], def);
    assert.deepEqual(out, [{ op: "modifyAttr", target: { sel: { special: "self" } }, attr: "power", amount, until: "turn" }], "an amount argument did not reach the parameter's place");
  }

  // A parameter the call leaves out falls back to its `OP_SCHEMA` default,
  // which is the value the interpreter would have assumed anyway — the reason
  // a macro's parameters are named exactly as the row's fields. What this
  // proves is that `negateKeyword`'s unwritten `target` (this card) arrived.
  {
    const def = withMacros(lines("DEFINE OP negateKeyword", "  TAKES (target: ref)", "  DO {", "    modifyAttr(target: $target, attr: power, amount: 0, until: turn)", "  }"));
    const out = expandMacros([{ op: "negateKeyword", keyword: "Blocker" } as unknown as Op], def);
    assert.deepEqual(out, [{ op: "modifyAttr", target: { sel: { special: "self" } }, attr: "power", amount: 0, until: "turn" }], "a left-out argument did not fall back to the row's default");
  }

  // A `$name` the macro does not take is the program's own binding — a
  // `choose`'s `as`, read by the step after it — and must survive untouched.
  {
    const def = withMacros(lines("DEFINE OP mill", "  TAKES (n: amount)", "  DO {", '    choose(sel: 1 IN you.battle, as: "picked")', "    moveTo(target: $picked, to: hand)", "  }"));
    const out = expandMacros([{ op: "mill", n: 1 } as unknown as Op], def);
    assert.deepEqual((out[1] as unknown as { target: unknown }).target, { var: "picked" }, "the macro's own binding was substituted as if it were a parameter");
  }

  // A macro over a macro, as many times over as it takes.
  {
    const def = withMacros(KO, lines("DEFINE OP comboFrom", "  TAKES (target: ref)", "  DO {", "    ko(target: $target)", "    ko(target: $target)", "  }"));
    assert.deepEqual(opsIn(expandMacros([{ op: "comboFrom", target: { var: "t" } } as unknown as Op], def)), ["moveTo", "moveTo"], "a macro calling a macro was not lowered all the way");
  }

  // The three programs that cannot be lowered, each named rather than hung on.
  {
    const cyclic = withMacros(lines("DEFINE OP flip", "  TAKES (target: ref)", "  DO {", "    flip(target: $target)", "  }"));
    assert.throws(() => expandMacros([{ op: "flip", target: { var: "t" } } as unknown as Op], cyclic), MacroError, "a macro that expands into itself did not say so");
    const mutual = withMacros(
      lines("DEFINE OP flip", "  TAKES (target: ref)", "  DO {", "    redirectAttack(target: $target)", "  }"),
      lines("DEFINE OP redirectAttack", "  TAKES (target: ref)", "  DO {", "    flip(target: $target)", "  }"),
    );
    assert.throws(() => expandMacros([{ op: "flip", target: { var: "t" } } as unknown as Op], mutual), MacroError, "two macros expanding into each other did not say so");
    assert.throws(() => expandMacros([{ op: "ko" } as unknown as Op], withMacros(KO)), MacroError, "a macro reading a parameter the call never gave did not say so");
  }
}

// ── what the app loads ──────────────────────────────────────────────────────

// The real DBS declarations, as far as they go. The completeness assertions —
// every `Area`, `Trigger`, keyword and `Phase` of the legacy engine declared
// and nothing it does not know — are #136's; these are the claims #133's three
// files make on their own.
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
  // `ops.rules` is in the set the app loads and declares nothing yet: its
  // header is the record of what each of the thirty-one macro rows waits on,
  // and a row that becomes writable is a declaration in it and nothing else.
  assert.ok("ops.rules" in DBS_FILES, "ops.rules is not in the set the app loads");
  assert.deepEqual(Object.keys(def.ops), [], "ops.rules declares a macro — the sweep in verify/language.ts is what proves it lowers");
  // Whole files, printed and read back: the round-trip promise over the
  // declarations the app actually loads.
  const printed = printDefinitions(def.definitions);
  const reread = parseDefinitions(printed);
  assert.ok(reread.ok, `the DBS ruleset does not re-parse after printing: ${reread.ok ? "" : JSON.stringify(reread.error)}`);
  if (reread.ok) assert.ok(deepEqual(reread.value, def.definitions), "printing the DBS ruleset and reading it back does not give the same declarations");
}
assert.equal(loadDbs(), dbs, "the ruleset is parsed again on every read");
assert.equal(rulesetFor("dbs").ok, true);
assert.equal(rulesetFor("fusion").ok, false, "Fusion World has no ruleset yet and must say so rather than load an empty one");

console.log("verify/rulesets: ok");
