/**
 * The ruleset loader: what it resolves, what it refuses, and — the two halves
 * #136 adds — whether the DBS ruleset says everything the legacy engine's
 * unions say and nothing else, and whether a `.rules` file round-trips
 * through the printer.
 *
 * A `.rules` file parses on its own — the grammar is `lang/`'s, and
 * `scripts/verify/lang.ts` is where print-and-read-back is proved for one
 * rule. What cannot be checked without a *second* declaration is the
 * loader's: a duplicate name, a phase naming a step nothing declares, an
 * action asking for a price that does not exist, a trigger or a program
 * naming a zone the game never declared, a keyword hanging a body on a hook
 * point the engine does not offer. Each of those is a game that would load
 * and then behave as if a line of its own rules were not there, which is
 * precisely the failure a configuration-driven engine has to make loud.
 *
 * The DBS files have begun to arrive (#133: `game.rules`, `attributes.rules`,
 * `zones.rules`; #134: `triggers.rules`; #135: `keywords.rules`), so the set
 * the app actually loads is checked for what those five carry: that it loads,
 * that it is the game it says it is, that the areas of the manual's §3 are
 * all declared, that every moment a record's WHEN may name is a moment the
 * definition declares and no other, and that every keyword the parser reads
 * is declared with the same arity. Beyond that, the DBS ruleset is checked
 * for *completeness* against three more of the legacy engine's own
 * hard-coded unions — `PHASES`, `CARD_ATTRIBUTES` and, once one exists,
 * `PROMPT_KINDS` — by name, in both directions: nothing would otherwise
 * notice a case the definition forgot until Stage 4 fails to play a card
 * that uses it. `words.rules` and `prompts.rules` still wait on the owner's
 * word on DEFINE WORDS/PROMPT (#131), so that one check below **skips, with
 * a printed line**, until it does; every other completeness check here is
 * live — deleting one `ZONE` line from `zones.rules` makes `npm test` fail
 * naming that zone (the presence loop below, which covers all 15 of `AREAS`;
 * `AREA_NAMES` is the 13-name `Area` a card's own state actually has a field
 * for, checked separately against those 15 with the two effect-language-only
 * routes, `under` and `play`, set aside).
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { effectLanguage } from "../../src/lib/arena/ai/opponent";
import { AREA_NAMES, CARD_ATTRIBUTES, KEYWORD_NAMES, OP_CLASS, OP_SCHEMA, PHASES, PROMPT_KINDS, validateProgram, type Op } from "../../src/lib/arena/engine/script";
import type { CounterWindow } from "../../src/lib/arena/engine/types";
import { TRIGGERS, describeTrigger } from "../../src/lib/arena/gaps";
import { deepEqual, parseDefinitions, parseRule, printDefinitions, validateRule } from "../../src/lib/arena/lang";
import { loadRuleset, loadDbs, rulesetFor, DBS_FILES, MacroError, expandMacros, opsIn, HOOK_POINTS, type KeywordDef, type RulesetError } from "../../src/lib/arena/rulesets";
import { optionsFor, whenMoments, words } from "../../src/lib/arena/rulesets/words";

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
    '  prompt: "main"',
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
    "",
    "DEFINE ZONE energy",
    "  owner: player",
    "  visibility: all",
    "  modes: [active, rest]",
    '  text: "the energy a player pays costs with (3-8)"',
  ),
  "play.rules": lines(
    "DEFINE COST energy",
    "  consumes: energy",
    "  asks: choice",
    "  DO {",
    "    switchMode(target: IN you.energy active, mode: rest)",
    "  }",
    '  text: "cards from the Energy Area, switched to Rest Mode (7-2)"',
    "",
    "DEFINE ACTION playCard",
    "  WHEN [main]",
    "  prompts: [main]",
    "  FOR 1 IN you.hand",
    '  BIND "card"',
    "  COST [energy]",
    "  DO {",
    "    moveTo(target: $card, to: battle)",
    "  }",
    '  REFUSE cardType(needs: "a Battle Card") UNLESS count(FROM $card "battle card") >= 1',
    '  label: "Play"',
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
  assert.deepEqual(Object.keys(def.zones), ["hand", "battle", "energy"]);
  assert.equal(def.sources["zone:battle"], "zones.rules", "a declaration does not know which file it came from");
  assert.equal(def.definitions.length, 10, "the ruleset does not hold every declaration it read");
  // The vocabulary is the definition's word lists, in the names the language's
  // hand-written constants use today (#137 makes those a re-export).
  assert.deepEqual(vocab.areas, ["hand", "battle", "energy"]);
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

// An action offered at a question nothing asks can never be offered at all, so
// it is a dangling reference like any other (#144). The prompts are whatever
// the steps ask for, which is the same list `vocabularyOf` reports — there is
// no `DEFINE PROMPT` to resolve against until #131's question is answered.
says(
  refused({ "play.rules": lines("DEFINE ACTION endMain", "  WHEN [main]", "  prompts: [battleStep]", "  DO {}") }, "an action offered at a question nothing asks"),
  '"battleStep"',
  "an action offered at a question nothing asks",
);

// A refusal's condition selects cards, so it names zones — and one the game
// never declared is a move that could never be explained.
says(
  refused(
    { "play.rules": lines("DEFINE ACTION endMain", "  WHEN [main]", "  DO {}", "  REFUSE zone(area: warp) UNLESS count(IN you.warp) >= 1") },
    "a refusal looking in an undeclared zone",
  ),
  '"warp"',
  "a refusal looking in an undeclared zone",
);

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
  const ZONES = ["battle", "drop", "hand", "deck", "life"].map((z) => lines(`DEFINE ZONE ${z}`, "  owner: player", "  visibility: all")).join("\n\n");

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

  // ── holes: `$name` in every field position (#273) ──────────────────────
  //
  // A body writes the parameter where a duration, a side, an area, a closed
  // list, a list of strings, a whole program, a selector or a condition goes,
  // and in a selector's own count, `TOP n`, side and area, and the call fills
  // each. Every type `PARAM_TYPES` names is exercised here at least once.
  {
    const def = withMacros(
      lines("DEFINE OP power", "  TAKES (target: ref, amount: amount, until: duration)", "  DO {", "    modifyAttr(target: $target, attr: power, amount: $amount, until: $until)", "  }"),
      lines("DEFINE OP draw", "  TAKES (n: number, side: side)", "  DO {", "    moveTo(target: TOP $n IN $side.deck, to: hand)", "  }"),
      lines("DEFINE OP may", "  TAKES (ops: ops, reason: string)", "  DO {", '    chooseMode(modes: ["Do it" $ops, "Don\'t" {}], reason: $reason)', "  }"),
      lines("DEFINE OP gains", "  TAKES (target: ref, what: word, values: strings, until: duration)", "  DO {", "    modifyAttr(target: $target, attr: $what, values: $values, until: $until)", "  }"),
      lines("DEFINE OP lifeDownTo", "  TAKES (side: side)", "  DO {", "    moveTo(target: 1 IN $side.life, to: hand)", "  }"),
      lines("DEFINE OP reveal", "  TAKES (sel: selector, as: string)", "  DO {", "    choose(sel: $sel, as: $as)", "  }"),
      lines("DEFINE OP if", "  TAKES (cond: cond, then: ops, else: ops)", "  DO {", '    chooseMode(modes: ["Do it" $then, "Don\'t" $else], reason: "x")', "    forbid(what: attack, until: turn, unless: $cond)", "  }"),
      lines("DEFINE OP mill", "  TAKES (n: number, side: side, as: string)", "  DO {", '    choose(sel: TOP $n IN $side.deck, as: "milled", reason: $as)', "  }"),
      lines("DEFINE OP switchMode", "  TAKES (target: ref, mode: word)", "  DO {", "    moveTo(target: $target, to: battle, mode: $mode)", "  }"),
    );
    // A duration, in the field the header said could not be written.
    assert.deepEqual(expandMacros([{ op: "power", target: { var: "t" }, amount: 5000, until: "battle" } as unknown as Op], def), [{ op: "modifyAttr", target: { var: "t" }, attr: "power", amount: 5000, until: "battle" }]);
    // A selector's `TOP n` and side.
    assert.deepEqual(expandMacros([{ op: "draw", n: 2, side: "opponent" } as unknown as Op], def), [{ op: "moveTo", target: { sel: { take: 2, side: "opponent", area: "deck" } }, to: "hand" }]);
    // A whole program and a string, with a macro *inside* the argument lowered too.
    assert.deepEqual(expandMacros([{ op: "may", ops: [{ op: "power", target: { var: "t" }, amount: 1, until: "turn" }], reason: "r" } as unknown as Op], def), [
      { op: "chooseMode", modes: [{ label: "Do it", ops: [{ op: "modifyAttr", target: { var: "t" }, attr: "power", amount: 1, until: "turn" }] }, { label: "Don't", ops: [] }], reason: "r" },
    ]);
    // A macro handed its own name as an argument is two calls, not a cycle.
    assert.deepEqual(opsIn(expandMacros([{ op: "may", ops: [{ op: "may", ops: [{ op: "draw", n: 1 }], reason: "b" }], reason: "a" } as unknown as Op], def)), ["chooseMode", "chooseMode", "moveTo"]);
    // A closed list (`word`) and a list of strings.
    assert.deepEqual(expandMacros([{ op: "gains", target: { var: "t" }, what: "traits", values: ["Saiyan"], until: "game" } as unknown as Op], def), [{ op: "modifyAttr", target: { var: "t" }, attr: "traits", values: ["Saiyan"], until: "game" }]);
    // A selector's count from a number, and a whole selector.
    assert.deepEqual(expandMacros([{ op: "lifeDownTo", side: "you", n: 3 } as unknown as Op], def), [{ op: "moveTo", target: { sel: { count: 1, side: "you", area: "life" } }, to: "hand" }]);
    assert.deepEqual(expandMacros([{ op: "reveal", sel: { side: "you", area: "hand", count: 1 }, as: "r" } as unknown as Op], def), [{ op: "choose", sel: { side: "you", area: "hand", count: 1 }, as: "r" }]);
    // A condition and two programs, one of them a mode's whole body.
    assert.deepEqual(expandMacros([{ op: "if", cond: { kind: "isTurnPlayer" }, then: [{ op: "draw", n: 1 }], else: [] } as unknown as Op], def), [
      { op: "chooseMode", modes: [{ label: "Do it", ops: [{ op: "moveTo", target: { sel: { take: 1, side: "you", area: "deck" } }, to: "hand" }] }, { label: "Don't", ops: [] }], reason: "x" },
      { op: "forbid", what: "attack", until: "turn", unless: { kind: "isTurnPlayer" } },
    ]);
    // A hole for an optional field the call left out leaves the field out
    // (`as` on `mill`, `mode` on `switchMode`); the interpreter then assumes
    // for the expansion what it would have assumed for the call.
    assert.deepEqual(expandMacros([{ op: "mill", n: 1 } as unknown as Op], def), [{ op: "choose", sel: { take: 1, side: "you", area: "deck" }, as: "milled" }]);
    assert.deepEqual(expandMacros([{ op: "switchMode", target: { var: "t" }, mode: "rest" } as unknown as Op], def), [{ op: "moveTo", target: { var: "t" }, to: "battle", mode: "rest" }]);
    // …but a hole for a *required* field is a program with a hole in it.
    const noSide = withMacros(lines("DEFINE OP addLife", "  TAKES (n: amount, as: string)", "  DO {", "    look(n: $n, as: $as)", "  }"));
    assert.throws(() => expandMacros([{ op: "addLife", n: 1 } as unknown as Op], noSide), /reads \$as for as, which the call did not give/);
    // An argument that is not what the parameter says it takes is refused by
    // name — a duration where a side was declared, an expression where a number was.
    assert.throws(() => expandMacros([{ op: "draw", n: 1, side: "turn" } as unknown as Op], def), /draw's side is "turn", and this macro takes side as side/);
    assert.throws(() => expandMacros([{ op: "draw", n: { count: { side: "you", area: "hand" } } } as unknown as Op], def), /draw's n is .*and this macro takes n as number/);
    // A `word` is checked against the list of the field it lands in.
    assert.throws(() => expandMacros([{ op: "switchMode", target: { var: "t" }, mode: "sideways" } as unknown as Op], def), /\$mode is "sideways", and mode takes one of \[active, rest\]/);
    assert.throws(() => expandMacros([{ op: "gains", target: { var: "t" }, what: "sideways", values: ["x"], until: "turn" } as unknown as Op], def), /\$what is "sideways", and attr takes one of/);
    assert.throws(() => expandMacros([{ op: "gains", target: { var: "t" }, what: "traits", values: "Saiyan", until: "turn" } as unknown as Op], def), /gains's values is "Saiyan", and this macro takes values as strings/);
    // The lowering is a program.
    assert.ok(validateProgram(expandMacros([{ op: "power", target: { var: "t" }, amount: { count: { side: "you", area: "battle" }, times: 1000 }, until: "turn" } as unknown as Op], def)));
  }

  // The loader refuses a hole the macro does not take, and one whose declared
  // type is not what the slot holds — before the expander could ever fill it.
  {
    const refused = (decl: string): string => {
      const loaded = loadRuleset({ "ops.rules": decl, "zones.rules": ZONES });
      assert.ok(!loaded.ok, `the loader accepted:\n${decl}`);
      if (loaded.ok) throw new Error("unreachable");
      assert.equal(loaded.errors[0].file, "ops.rules");
      return loaded.errors[0].message;
    };
    assert.match(refused(lines("DEFINE OP power", "  TAKES (target: ref)", "  DO {", "    modifyAttr(target: $target, attr: power, amount: 1, until: $until)", "  }")), /writes \$until in modifyAttr.until, which is not a parameter it TAKES/);
    assert.match(refused(lines("DEFINE OP power", "  TAKES (target: ref, until: side)", "  DO {", "    modifyAttr(target: $target, attr: power, amount: 1, until: $until)", "  }")), /\$until in modifyAttr.until, which holds a duration, but TAKES it as side/);
    assert.match(refused(lines("DEFINE OP draw", "  TAKES (n: amount)", "  DO {", "    moveTo(target: TOP $n IN you.deck, to: hand)", "  }")), /\$n in moveTo.target.sel.take, which holds a number, but TAKES it as amount/);
    assert.match(refused(lines("DEFINE OP may", "  TAKES (ops: cond)", "  DO {", "    if(cond: isTurnPlayer(), then: $ops)", "  }")), /\$ops in if.then, which holds an ops, but TAKES it as cond/);
    assert.match(refused(lines("DEFINE OP switchMode", "  TAKES (mode: string)", "  DO {", "    moveTo(target: [self], to: battle, mode: $mode)", "  }")), /holds one of \[active, rest\], but TAKES it as string/);
    // A `{ var }` in an amount or ref position is checked only when the macro
    // takes the name: `$picked` below is the body's own binding.
    assert.match(refused(lines("DEFINE OP power", "  TAKES (amount: ref)", "  DO {", "    modifyAttr(target: [self], attr: power, amount: $amount, until: turn)", "  }")), /\$amount in modifyAttr.amount, which holds an amount, but TAKES it as ref/);
    const binding = loadRuleset({ "ops.rules": lines("DEFINE OP mill", "  TAKES (n: amount)", "  DO {", '    choose(sel: 1 IN you.battle, as: "picked")', "    moveTo(target: $picked, to: hand)", "  }"), "zones.rules": ZONES });
    assert.ok(binding.ok, "a body's own binding was refused as an undeclared parameter");
    // A hole is a `DEFINE OP` body's alone: anywhere else, `$name` is not a value.
    const elsewhere = parseDefinitions(lines("DEFINE STEP s", '  phase: "main"', "  DO {", "    power(target: [self], amount: 1, until: $until)", "  }"));
    assert.ok(!elsewhere.ok, "a hole was read outside a DEFINE OP body");
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
  // to name: `removed` (20-10), `under` (23-2) and `play` (9-1-3-1). The
  // presence loop runs before the length check so a single deleted `ZONE`
  // fails naming that zone, rather than only reporting a changed count.
  for (const zone of ["deck", "hand", "drop", "leader", "battle", "combo", "energy", "life", "warp", "unison", "zDeck", "zEnergy", "removed", "under", "play"]) {
    assert.ok(zone in def.zones, `no DEFINE ZONE for ${JSON.stringify(zone)}`);
  }
  assert.equal(Object.keys(def.zones).length, 15, `the DBS ruleset declares ${Object.keys(def.zones).length} zones, not 15`);
  assert.deepEqual(vocab.areas, Object.keys(def.zones), "the vocabulary's areas are not the zones the game declared");
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
  // `ops.rules` is in the set the app loads. Its header is the record of what
  // each of the thirty-one macro rows waits on, and a row that becomes
  // writable is a declaration in it and nothing else: every one declared is a
  // row `OP_CLASS` marks *macro*, and the sweep in verify/language.ts is what
  // proves each lowers over the whole harness. The first three are #273's;
  // #274 (a move told apart by its cause) adds only `ko` — `draw`, `discard`,
  // `damage` and `addLife` all take `n` as an `amount`, X included, and a
  // selector's count is typed a bare `number` (see `ops.rules`'s `count`).
  // #276 (one primitive under the four negation spellings) adds the next
  // four, #277 (a price is not a number) the next two, and #275 (a player
  // and the battle in progress, as subjects) the last ten.
  assert.ok("ops.rules" in DBS_FILES, "ops.rules is not in the set the app loads");
  assert.deepEqual(
    Object.keys(def.ops).sort(),
    [
      "addMarker",
      "altCost",
      "comboPower",
      "costReduction",
      "energyMarker",
      "faceUp",
      "flip",
      "gains",
      "grant",
      "hidden",
      "ko",
      "may",
      "negateKeyword",
      "negateOwnSkill",
      "negateSkills",
      "negateSkillsOfKind",
      "power",
      "redirectAttack",
      "removeMarker",
      "switchMode",
    ],
    "ops.rules declares a different set of macros than the tests expect",
  );
  for (const name of Object.keys(def.ops)) {
    assert.ok(name in OP_SCHEMA, `ops.rules declares ${name}, which is no op`);
    assert.notEqual(OP_CLASS[name as keyof typeof OP_CLASS], "primitive", `ops.rules declares ${name}, which the spec's table marks primitive`);
  }
  // `power`'s `until` is the duration the grammar could not write before
  // #273: declared as a hole, read as one, and filled by the call.
  assert.deepEqual(def.ops.power.takes, [
    { name: "target", type: "ref" },
    { name: "amount", type: "amount" },
    { name: "until", type: "duration" },
  ]);
  assert.deepEqual((def.ops.power.do[0] as unknown as { until: unknown }).until, { hole: "until" }, "power's until is not a hole");
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

// ── completeness against the legacy engine's remaining unions ───────────────
//
// The zone presence-loop, trigger set-equality and keyword set-equality
// above (and the arity table below) already give `AREAS`, `TRIGGERS` and
// `KEYWORD_NAMES` their own full, both-directions coverage against real
// files — `zones.rules` in particular declares all 15 of `AREAS` (including
// `under`/`play`), which is why it is a presence loop rather than a
// `PHASES`-style comparison against the narrower 13-name `Area`. What is
// left: `Area` itself (checked against the zones that are not those two
// effect-language-only routes), `PHASES` by name rather than only by count,
// and `CARD_ATTRIBUTES` in both directions rather than the one-directional
// presence check above (a derived attribute like `costOf` has no `CardDef`
// field and is deliberately not "extra" here).

/** Both directions, by name: what the engine has that the ruleset does not declare, and what the ruleset declares that the engine does not have. */
function completeness(actual: readonly string[], expected: readonly string[], what: string): void {
  const missing = expected.filter((e) => !actual.includes(e));
  const extra = actual.filter((a) => !expected.includes(a));
  assert.deepEqual(missing, [], `${what}: the ruleset does not declare ${JSON.stringify(missing)}`);
  assert.deepEqual(extra, [], `${what}: the ruleset declares ${JSON.stringify(extra)}, which the legacy engine does not have`);
}

// attributes.rules also declares derived `of: card` attributes with no
// `CardDef` field at all: three the board computes (20-21: the cost as it
// stands after reductions), and six that live on the card sitting on the
// table rather than on the catalog row (spec §2.5-1/§2.5-3, #275) — set
// aside by name rather than counted as unions the legacy engine's `CardDef`
// does not have.
const DERIVED_CARD_ATTRIBUTES = ["costOf", "comboCostOf", "zEnergyCostOf", "mode", "markers", "keywords", "hidden", "faceUp", "flipped"];

if (dbs.ok) {
  const { vocabulary: vocab, definition: def } = dbs;
  completeness(
    vocab.areas.filter((a) => a !== "under" && a !== "play"),
    AREA_NAMES,
    "zones (excluding the effect language's own under/play routes)",
  );
  completeness(Object.keys(def.phases), PHASES, "phases");
  completeness(
    Object.entries(def.attributes)
      .filter(([name, a]) => a.of === "card" && !DERIVED_CARD_ATTRIBUTES.includes(name))
      .map(([name]) => name),
    CARD_ATTRIBUTES,
    "card attributes",
  );
  // `game.rules` already names five (`chooseFirst`, `mulligan`, `charge`,
  // `main`, `gameOver`, on the steps it declares), but no file declares
  // `DEFINE PROMPT` and #131 is still open on whether one ever will, or
  // whether a prompt is a field of `DEFINE ACTION` instead — and the rest of
  // `PROMPT_KINDS` belongs to steps Stage 5/6's `actions.rules` and
  // `battle.rules` have not written yet. So this stays an unconditional skip
  // (not "empty, so skip": `vocab.promptKinds` already has five entries)
  // until that question is answered and every step exists to ask it of.
  console.log(`  skipped: prompt kinds — prompts.rules not yet written (${vocab.promptKinds.length} of ${PROMPT_KINDS.length} named by steps so far)`);
}

// ── whole-file round trip ────────────────────────────────────────────────────
//
// `scripts/verify/lang.ts` proves `parse(print(x)) === x` for one rule; the
// round trip over `def.definitions` above is the same promise for the
// merged, deduplicated set the app actually loads. This is the same promise
// again, per `.rules` file rather than merged — the shape a future workbench
// ruleset editor would actually save one back as.
const dbsFiles = Object.keys(DBS_FILES);
for (const name of dbsFiles) {
  const text = DBS_FILES[name];
  const parsed = parseDefinitions(text);
  assert.ok(parsed.ok, `${name} does not parse: ${parsed.ok ? "" : `${parsed.error.clause} ${parsed.error.line}:${parsed.error.col} ${parsed.error.message}`}`);
  if (!parsed.ok) continue;
  const printed = printDefinitions(parsed.value);
  const reparsed = parseDefinitions(printed);
  assert.ok(reparsed.ok, `${name}, printed back, does not re-parse: ${reparsed.ok ? "" : reparsed.error.message}`);
  assert.ok(reparsed.ok && deepEqual(reparsed.value, parsed.value), `${name} does not round-trip through the printer:\n${printed}`);
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

// ── one word list, four readers ─────────────────────────────────────────────
//
// The other half of #137. The language, the workbench's chip editor and the
// referee's prompt each used to carry their own copy of the closed lists —
// four copies of the areas, since the prompt wrote them out twice — and
// `validateRule` a fourth of the moments. The claim now is that they carry
// none, and that a word deleted from the game's declarations is gone from all
// of them at once. So the test is one deletion and a set of questions, not a
// test per reader.
{
  const vocab = words();

  // An area, which the parser, the chip editor and the referee's prompt read.
  const gone = "warp";
  assert.ok(vocab.areas.includes(gone), `the DBS ruleset no longer declares ${JSON.stringify(gone)}, so this test asks nothing`);
  const mutated = { ...vocab, areas: vocab.areas.filter((a) => a !== gone) };
  const rule = `WHEN [auto] played\nTHEN\n  moveTo(target: $t, to: ${gone})`;

  assert.equal(parseRule(rule).ok, true, "the parser does not read an area the game declares");
  assert.ok(optionsFor("area").includes(gone), "the chip editor does not offer an area the game declares");
  // The prompt's own AREA line, not the whole prompt: `discard`'s `to` field
  // is an `OP_SCHEMA` enum of one value ("warp"), which is a field's closed
  // list and not the game's word list.
  const areaLine = (text: string) => text.split("\n").find((l) => l.startsWith("AREA: ")) ?? "";
  assert.ok(areaLine(effectLanguage()).includes(`"${gone}"`), "the referee is not told about an area the game declares");

  const refused = parseRule(rule, mutated);
  assert.equal(refused.ok, false, "the parser still read an area the game no longer declares");
  if (!refused.ok) assert.ok(refused.error.expected.includes("hand"), "the parser's list of what could have stood there is not the game's areas");
  assert.ok(!optionsFor("area", mutated).includes(gone), "the chip editor still offers an area the game no longer declares");
  assert.ok(!areaLine(effectLanguage(mutated)).includes(`"${gone}"`), "the referee is still told about an area the game no longer declares");

  // A keyword, which the parser and the chip editor read. The referee hears
  // about keywords through `OP_SCHEMA`'s own `negateKeyword` enum, a field's
  // closed list rather than the game's word list.
  const noKeyword = "Blocker";
  assert.ok(vocab.keywordNames.includes(noKeyword), `the DBS ruleset no longer declares [${noKeyword}], so this test asks nothing`);
  const withoutKeyword = { ...vocab, keywordNames: vocab.keywordNames.filter((k) => k !== noKeyword) };
  const grant = `WHEN [auto] played\nTHEN\n  grant(target: $t, keyword: [${noKeyword}], until: turn)`;
  assert.equal(parseRule(grant).ok, true, "the parser does not read a keyword the game declares");
  assert.ok(optionsFor("keyword").includes(noKeyword), "the chip editor does not offer a keyword the game declares");
  assert.equal(parseRule(grant, withoutKeyword).ok, false, "the parser still read a keyword the game no longer declares");
  assert.ok(!optionsFor("keyword", withoutKeyword).includes(noKeyword), "the chip editor still offers a keyword the game no longer declares");

  // And a moment, which `validateRule` reads. `whenMoments` is the game's
  // triggers less the counter windows — a [Counter] answers to a window and
  // not to a card's own moment, and those five are the only names in
  // `triggers.rules` a record's WHEN never says (the set equality above is
  // what holds that to the engine's `Trigger` union, in both directions).
  assert.deepEqual([...whenMoments()].sort(), [...TRIGGERS].sort(), "the moments a WHEN may name are no longer the engine's triggers");
  for (const w of COUNTER_WINDOWS) assert.ok(!whenMoments().includes(`counter:${w}`), `a record's WHEN may name the ${w} counter window, which the engine never fires`);
  const ruleOf = (trigger: string) => ({ kind: "auto", trigger: [trigger], cost: null, cond: null, ops: [] });
  assert.equal(validateRule(ruleOf("played"), "auto"), null, "validateRule refuses a moment the game declares");
  assert.equal(validateRule(ruleOf("counter:play"), "auto")?.field, "trigger", "validateRule accepts a counter window as a WHEN, which the engine never fires");
  assert.equal(validateRule(ruleOf("nosuchmoment"), "auto")?.field, "trigger", "validateRule accepts a moment nothing declares");
}

console.log("verify/rulesets: ok");
