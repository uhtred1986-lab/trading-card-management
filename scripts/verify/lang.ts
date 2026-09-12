/**
 * The rules language: printed, read back, and the same object again.
 *
 * The promise the workbench's text view rests on is an *equality*, not a
 * likeness — `parse(print(x))` deep-equals `x` — because the text view saves
 * what it parsed. Anything the printer says loosely and the parser reads
 * generously would quietly widen a card's rule on the next save, which is the
 * one failure a person editing rules could not see happening.
 *
 * So this file checks the round trip over everything the language can say: a
 * minimal and a maximal instance of every row of `OP_SCHEMA` and
 * `COND_SCHEMA`, every sugar in both directions, every field of a `Selector`
 * and a `CardFilter`, every keyword literal, and then every program and every
 * record the compiler actually produces for the harness's cards.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { emptyFilter, type CardFilter } from "../../src/lib/arena/engine/filters";
import { AREAS, COND_SCHEMA, KEYWORD_NAMES, OP_SCHEMA, SPECIAL_TARGETS, type Amount, type Cond, type CostRecord, type FieldType, type Op, type OpField, type Selector } from "../../src/lib/arena/engine/script";
import { pendTriggers } from "../../src/lib/arena/engine/triggers";
import type { CardScripts, GameState, KeywordSkill, Trigger } from "../../src/lib/arena/engine";
import { DEFINE_KINDS, DEFINE_SCHEMA, EXPR_ATTRS, EXPR_LITERALS, EXPR_SCHEMA, fieldsOf, parseDefinitions, parseRule, printDefinition, printDefinitions, printRule, printCond, printOps, printSelector, validateRule, deepEqual, type Definition, type DefineFieldType, type DefineKind, type Rule } from "../../src/lib/arena/lang";
import { parseCond } from "../../src/lib/arena/lang/parse";
import { CTX, DEFS, arena, find, parseFilter, rulesFromCompiler, skillRecords } from "./harness";

/** A rule with nothing but its steps, for the round trips that are about the program. */
const ruleOf = (ops: Op[], rest: Partial<Rule> = {}): Rule => ({ kind: "auto", trigger: [], cost: null, cond: null, ops, ...rest });

/** A price with nothing in it, for the round trips that are about one field of one. */
const BARE_COST: CostRecord = { text: "", orbs: {}, either: [], marker: null, burst: null, spiritBoost: null, condition: null, program: null };

/** print → parse → the same object. The failure message carries the text, which is what a person would be looking at. */
function trip(rule: Rule, what: string): void {
  const text = printRule(rule);
  const back = parseRule(text);
  assert.ok(back.ok, `${what}: ${back.ok ? "" : `${back.error.clause} ${back.error.line}:${back.error.col} ${back.error.message}`}\n${text}`);
  // `deepEqual` is the language's own equality: keys sorted, `undefined`
  // dropped, and a selector switch written `false` read as the absence it
  // means (`MEANINGLESS_WHEN_FALSE` in `print.ts`).
  assert.ok(deepEqual(back.value, rule), `${what} came back different:\n${text}\n  was: ${JSON.stringify(rule)}\n  now: ${JSON.stringify(back.ok ? back.value : null)}`);
  // …and printing what came back gives the same text, so the form is settled
  // after one pass and a record does not churn its own version on every save.
  assert.equal(printRule(back.value), text, `${what} does not print the same way twice`);
}

const tripOps = (ops: Op[], what: string) => trip(ruleOf(ops), what);
const tripCond = (cond: Cond, what: string) => trip(ruleOf([], { cond }), what);
const tripSelector = (sel: Selector, what: string) => tripOps([{ op: "choose", sel, as: "t" }], what);
const tripFilter = (filter: CardFilter, what: string) => tripSelector({ side: "you", area: "battle", count: 1, filter }, what);

/**
 * A value for each field type. `wide` picks a different one wherever the
 * type has more than one shape, so the maximal instance is not the minimal
 * one with extra keys — a nested program, a bound-variable amount, an
 * `areas` list instead of an `area`.
 */
const sample = (t: FieldType, wide: boolean): unknown => {
  if (typeof t === "object") {
    if ("enum" in t) return t.enum[wide ? t.enum.length - 1 : 0];
    return t.list === "string" ? ["Saiyan", "Son Goku: GT"] : [t.list.enum[0]];
  }
  switch (t) {
    case "amount":
      return wide ? { count: { side: "you", areas: ["battle", "unison"] as const, count: 99 }, times: 5000 } : 1;
    case "ref":
      return wide ? { var: "looked", minus: "kept" } : { sel: { special: "self" as const } };
    case "selector":
      return wide ? { side: "opponent" as const, area: "battle" as const, count: 2, upTo: true, mode: "rest" as const, notSelf: "copies" as const, ignoreBarrier: true } : { side: "you" as const, area: "battle" as const, count: 1 };
    case "side":
      return wide ? "both" : "you";
    case "area":
      return wide ? "zEnergy" : "drop";
    case "duration":
      return wide ? "afterNextCharge" : "turn";
    case "cond":
      return wide ? { kind: "not", cond: { kind: "isTurnPlayer", who: "opponent" } } : { kind: "isTurnPlayer" };
    case "conds":
      return [{ kind: "isTurnPlayer" }, { kind: "life", side: "you", atMost: 4 }];
    case "ops":
      return [{ op: "draw", n: 1 }, { op: "shuffle" }];
    case "string":
      return wide ? 'a name with "quotes" and a comma, too' : "t";
    case "number":
      return wide ? 3 : 1;
    case "boolean":
      return wide;
    case "keyword":
      return wide ? { name: "Empower", color: "Red", x: 1 } : { name: "Blocker" };
    case "filter":
      return parseFilter(wide ? "blue non-token Battle Card with an energy cost of 3 or less" : "red card");
    case "modes":
      return [
        { label: "Draw 1 card.", ops: [{ op: "draw", n: 1 }] },
        { label: "Your opponent discards 1 card.", ops: [{ op: "discard", n: 1, side: "opponent" }] },
      ];
  }
};

const instance = (fields: OpField[], wide: boolean): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (!wide && !f.required) continue;
    // A nullable field is where the language has to say "null" out loud, so
    // the wide instance is the one that does.
    out[f.name] = wide && f.nullable ? null : sample(f.type, wide);
  }
  return out;
};

// ── every op and every condition, at its narrowest and at its widest ─────────
{
  for (const [name, spec] of Object.entries(OP_SCHEMA)) {
    for (const wide of [false, true]) {
      const op = { op: name, ...instance(spec.fields, wide) } as unknown as Op;
      tripOps([op], `${name} (${wide ? "every field" : "required fields only"})`);
    }
  }
  for (const [kind, spec] of Object.entries(COND_SCHEMA)) {
    for (const wide of [false, true]) {
      // `not`, `any` and `all` are the operators; their general form is checked
      // below, and a maximal `not` of a maximal `not` says nothing extra.
      const cond = { kind, ...instance(spec.fields, wide) } as unknown as Cond;
      tripCond(cond, `${kind} (${wide ? "every field" : "required fields only"})`);
    }
  }

  // Every `Amount` shape, at least once — `sample("amount", …)` above only
  // ever returns a flat number or a `count`, so `sumPower` and `handUpTo` had
  // no round-trip coverage at all until this loop, and a bare `markers` union
  // member could be added, typecheck, and never once be printed or parsed.
  //
  // Minimal *and* maximal for every shape that has an optional part: an `x`
  // with and without its multiplier, an `attr` and a `sumOf` likewise. The
  // whole expression tree of 20-5 is written out here, because the sampler
  // never reaches any of it.
  const AMOUNTS: Amount[] = [
    1,
    { var: "n" },
    { count: { side: "you", area: "battle", count: 99 } },
    { count: { side: "you", area: "battle", count: 99 }, times: 5000 },
    { sumPower: { var: "rested" } },
    { handUpTo: 4 },
    { markers: { special: "self" } },
    { markers: { side: "opponent", area: "unison", count: 99 }, times: 5000 },
    { x: true },
    { x: true, times: 1000 },
    { life: "you" },
    { life: "both", times: 2 },
    { attr: { var: "t" }, name: "energyCost" },
    { attr: { sel: { special: "self" } }, name: "power", times: 1000 },
    { sumOf: { fromVar: "discarded" }, attr: "comboPower" },
    { sumOf: { side: "you", area: "drop", count: 99 }, attr: "energyCost", times: 2 },
    { plus: [{ count: { side: "you", area: "drop", count: 99 } }, 1] },
    { plus: [{ x: true }, 2] },
    // Nested: the operator is left-associative, so "X + 1 + 2" is one sum
    // inside another and has to come back the same way round.
    { plus: [{ plus: [{ x: true }, 1] }, 2] },
  ];
  for (const n of AMOUNTS) tripOps([{ op: "draw", n }], `draw amount ${JSON.stringify(n)}`);

  // Every row of `EXPR_SCHEMA` is reached by the list above. The table is what
  // the printer and the parser both walk, so a row nothing exercises is a
  // shape that could print one way and read back another and no test would
  // know — the same hole this block was written to close for `sumPower`.
  {
    const written = new Set<string>();
    const mark = (a: Amount) => {
      if (typeof a !== "object") return;
      if ("plus" in a) return mark(a.plus[0]);
      for (const spec of EXPR_SCHEMA) {
        const fields = spec.fields ?? [spec.key];
        if (fields.every((f) => f in (a as Record<string, unknown>))) {
          written.add(spec.key);
          if (spec.times && "times" in (a as Record<string, unknown>)) written.add(`${spec.key}*`);
          return;
        }
      }
    };
    AMOUNTS.forEach(mark);
    const wanted = EXPR_SCHEMA.flatMap((spec) => [spec.key, ...(spec.times ? [`${spec.key}*`] : [])]);
    assert.deepEqual(
      wanted.filter((k) => !written.has(k)),
      [],
      "every EXPR_SCHEMA row, with and without its multiplier, is round-tripped above",
    );
  }

  // 20-5: the price that binds X, minimal and with both its bounds.
  for (const x of [{}, { min: 1 }, { max: 5 }, { min: 1, max: 5 }]) {
    trip(ruleOf([{ op: "draw", n: { x: true } }], { kind: "activate:main", cost: { ...BARE_COST, x } }), `an X price ${JSON.stringify(x)}`);
  }
  // `bindX` on a choose, which is the other way X gets a value.
  tripOps([{ op: "choose", sel: { side: "you", area: "hand", count: 99, upTo: true }, as: "c", bindX: true }], "choose with bindX");

  // A counted, conditional prohibition (20-14): the schema loop above already
  // builds a maximal `forbid`, but it builds one generic value per field type.
  // This is the shape the cards actually print and the one
  // `docs/arena-rules-language.md` shows — a budget of one use and a count
  // escape — written out so the doc's example is a test rather than prose.
  tripOps(
    [{ op: "forbid", what: "attack", until: "turn", side: "opponent", filter: parseFilter("battle card"), uses: 1, unless: { kind: "count", sel: { side: "opponent", area: "energy", count: 99 }, atLeast: 3 } }],
    "forbid with uses and unless",
  );
}

/**
 * The three shapes a card's rule never carries, and so the three the op
 * schema has no field type for: a trigger's event pattern, a macro's
 * parameter list, and a keyword's hook bodies. Everything else a declaration
 * holds is an `OP_SCHEMA` field type and comes from `sample` above, so the
 * definition grammar is checked with the same values the effect language is.
 */
const defineSample = (t: DefineFieldType, wide: boolean): unknown => {
  if (t === "pattern") return wide ? { event: "moved", args: { by: "you", from: "hand", to: "battle", faceUp: true, n: 1, of: ["Red", "Blue"], host: null } } : { event: "attacked", args: {} };
  if (t === "params") return wide ? [{ name: "target", type: "ref" as const }, { name: "amount", type: "amount" as const }, { name: "color", type: "color" as const }] : [];
  if (t === "hooks")
    return wide
      ? [
          { at: "blockDeclared", ops: [{ op: "draw", n: 1 }] },
          { at: "attackDeclared", ops: [] },
        ]
      : [{ at: "played", ops: [] }];
  return sample(t, wide);
};

const declaration = (kind: DefineKind, wide: boolean): Definition => {
  const out: Record<string, unknown> = { define: kind, name: wide ? "Energy-Exhaust" : "thing" };
  for (const f of fieldsOf(kind)) {
    if (!wide && !f.required) continue;
    out[f.name] = wide && f.nullable ? null : defineSample(f.type, wide);
  }
  return out as unknown as Definition;
};

// ── every DEFINE kind, at its narrowest and at its widest ───────────────────
{
  /** print → parse → the same declarations, and the same text a second time. */
  const tripDefs = (defs: Definition[], what: string): void => {
    const text = printDefinitions(defs);
    const back = parseDefinitions(text);
    assert.ok(back.ok, `${what}: ${back.ok ? "" : `${back.error.clause} ${back.error.line}:${back.error.col} ${back.error.message}`}\n${text}`);
    assert.ok(deepEqual(back.value, defs), `${what} came back different:\n${text}\n  was: ${JSON.stringify(defs)}\n  now: ${JSON.stringify(back.ok ? back.value : null)}`);
    assert.equal(printDefinitions(back.value), text, `${what} does not print the same way twice`);
  };

  const all: Definition[] = [];
  for (const kind of DEFINE_KINDS) {
    for (const wide of [false, true]) {
      const def = declaration(kind, wide);
      tripDefs([def], `DEFINE ${kind} (${wide ? "every field" : "required fields only"})`);
      all.push(def);
    }
  }
  // …and a whole file at once, which is how a ruleset is actually read: the
  // declarations have to end at each other without a bracket to say so.
  tripDefs(all, "a whole file of declarations");

  // The layout, written out once. A declaration is a header line and one line
  // per field — a word for the clause fields, `name: value` for the rest — and
  // a nested program is a block at one more indent, exactly as a rule's is.
  assert.equal(
    printDefinition({ define: "ZONE", name: "battle", owner: "player", visibility: "all", ordered: false, inPlay: true, modes: ["active", "rest"] }),
    ["DEFINE ZONE battle", "  owner: player", "  visibility: all", "  ordered: false", "  inPlay: true", "  modes: [active, rest]"].join("\n"),
  );
  assert.equal(
    printDefinition({ define: "TRIGGER", name: "played", on: { event: "moved", args: { to: "battle" } }, where: { kind: "isTurnPlayer" }, bind: "subject" }),
    ["DEFINE TRIGGER played", "  ON moved(to: battle)", "  WHERE isTurnPlayer()", '  BIND "subject"'].join("\n"),
  );
  assert.equal(
    printDefinition({ define: "OP", name: "koAll", takes: [{ name: "target", type: "ref" }], do: [{ op: "ko", target: { var: "t" } }], text: "KO them" }),
    ["DEFINE OP koAll", "  TAKES (target: ref)", "  DO {", "    ko(target: $t)", "  }", '  text: "KO them"'].join("\n"),
  );
  // A keyword's bodies are one `HOOK` line each rather than a list, so a diff
  // of a ruleset shows the hook that changed and not the whole keyword.
  assert.equal(
    printDefinition({ define: "KEYWORD", name: "Blocker", takes: [], text: "may block", hooks: [{ at: "blockDeclared", ops: [] }, { at: "attackDeclared", ops: [{ op: "draw", n: 1 }] }] }),
    ["DEFINE KEYWORD Blocker", "  TAKES ()", '  text: "may block"', "  HOOK blockDeclared {}", "  HOOK attackDeclared {", "    draw(n: 1)", "  }"].join("\n"),
  );
  // A name with a hyphen is quoted, as every other value with one is.
  assert.match(printDefinition(declaration("KEYWORD", true)), /^DEFINE KEYWORD "Energy-Exhaust"$/m);

  // The parser is the generous one here too: the kind and the clause words in
  // any case, the fields in any order, and `--` comments dropped on the way.
  const loose = parseDefinitions(['-- the battle area (3-6)', 'define zone battle', '  visibility: all   -- both players see it', '  owner: player', '', 'DEFINE WIN deckOut', '  result: lose', '  if life(you) <= 0'].join("\n"));
  assert.ok(loose.ok, `a loosely typed file is still read: ${loose.ok ? "" : loose.error.message}`);
  assert.ok(
    deepEqual(loose.ok ? loose.value : null, [
      { define: "ZONE", name: "battle", owner: "player", visibility: "all" },
      { define: "WIN", name: "deckOut", if: { kind: "life", side: "you", atMost: 0 }, result: "lose" },
    ]),
    `a loosely typed file reads as ${JSON.stringify(loose.ok ? loose.value : null)}`,
  );
  const empty = parseDefinitions("");
  assert.ok(empty.ok && empty.value.length === 0, "an empty file holds no declarations");
  assert.equal(parseDefinitions("-- nothing but a note\n").ok, true, "a file of comments is an empty file");
}

// ── a declaration that is missing something says which, and where ───────────
{
  const bad = (src: string) => {
    const r = parseDefinitions(src);
    assert.ok(!r.ok, `${src} should not parse`);
    return r.ok ? null! : r.error;
  };

  // One case per kind, as the acceptance asks: drop a required field and the
  // error names the kind it was in, so the editor can point at the declaration
  // rather than at the file.
  for (const kind of DEFINE_KINDS) {
    for (const missing of fieldsOf(kind).filter((f) => f.required)) {
      const def = { ...declaration(kind, false) } as Record<string, unknown>;
      delete def[missing.name];
      const text = printDefinitions([def as unknown as Definition]);
      const e = bad(text);
      assert.equal(e.clause, kind, `a ${kind} missing ${missing.name} is reported against ${e.clause}\n${text}`);
      assert.match(e.message, new RegExp(`needs .*${missing.name}`), `the error names the missing field:\n${text}\n${e.message}`);
      assert.ok(e.expected.includes(missing.name), "…and offers it as what could have stood there");
    }
  }

  assert.equal(bad("DEFINE NONSENSE x").clause, "DEFINE", "a kind the language has no row for is not inside any declaration");
  assert.match(bad("DEFINE NONSENSE x").message, /nothing called DEFINE NONSENSE/);
  assert.deepEqual(bad("ZONE battle").expected, ["DEFINE"], "a file starts with DEFINE");
  const unknown = bad("DEFINE ZONE battle\n  owner: player\n  visibility: all\n  colour: red");
  assert.equal(unknown.clause, "ZONE");
  assert.equal(unknown.line, 4);
  assert.match(unknown.message, /no field called "colour"/);
  assert.ok(unknown.expected.includes("owner:"), "the message names the fields as they are written");
  assert.match(bad("DEFINE TRIGGER played\n  ON moved(to: battle)\n  NOPE 1").message, /"NOPE" says nothing/);
  assert.match(bad("DEFINE ZONE battle\n  owner: player\n  owner: shared\n  visibility: all").message, /"owner" is said twice/);
  assert.match(bad("DEFINE ZONE battle\n  owner: player ordered: false\n  visibility: all").message, /runs on past the end of its line/);
  assert.match(bad("DEFINE ZONE battle\n  owner: nobody\n  visibility: all").message, /not one of these/);
  assert.match(bad("DEFINE OP koAll\n  TAKES (target: nonsense)\n  DO {}").message, /not one of these/);
  assert.match(bad("DEFINE TRIGGER played\n  ON moved(to: battle, to: hand)").message, /"to" is said twice/);
}

// ── the sugars, both ways ───────────────────────────────────────────────────
{
  // One bound is the comparison; two bounds and no bound keep the general
  // form, so there is never a choice of how to print one object.
  const sel: Selector = { side: "you", area: "battle", count: 99 };
  assert.equal(printCond({ kind: "count", sel, atLeast: 2 }), "count(99 IN you.battle) >= 2");
  assert.equal(printCond({ kind: "count", sel, atMost: 0 }), "count(99 IN you.battle) <= 0");
  assert.equal(printCond({ kind: "life", side: "opponent", atMost: 4 }), "life(opponent) <= 4");
  assert.equal(printCond({ kind: "markers", sel, atLeast: 3 }), "markers(99 IN you.battle) >= 3");
  assert.equal(printCond({ kind: "power", sel, atMost: 15000 }), "power(99 IN you.battle) <= 15000");
  assert.match(printCond({ kind: "count", sel, atLeast: 1, atMost: 3 }), /^count\(sel:/, "two bounds keep the general form");
  assert.match(printCond({ kind: "count", sel }), /^count\(sel:/, "no bound keeps the general form");
  // A bound *and* another field is the general form too: the comparison has
  // nowhere to put the role, and printing it anyway would drop the field.
  assert.match(printCond({ kind: "power", sel, atLeast: 1 }), /^power\(99 IN you.battle\) >= 1$/);

  for (const [text, want] of [
    ["count(1 IN you.battle) >= 2", { kind: "count", sel: { count: 1, side: "you", area: "battle" }, atLeast: 2 }],
    ["count(sel: 1 IN you.battle, atLeast: 2)", { kind: "count", sel: { count: 1, side: "you", area: "battle" }, atLeast: 2 }],
    ["life(you) <= 4", { kind: "life", side: "you", atMost: 4 }],
    ["life(side: you, atMost: 4)", { kind: "life", side: "you", atMost: 4 }],
    ["NOT isTurnPlayer()", { kind: "not", cond: { kind: "isTurnPlayer" } }],
    ["not(cond: isTurnPlayer())", { kind: "not", cond: { kind: "isTurnPlayer" } }],
  ] as [string, Cond][]) {
    const got = parseCond(text);
    assert.ok(got.ok, `${text}: ${got.ok ? "" : got.error.message}`);
    assert.ok(deepEqual(got.value, want), `${text} reads as ${JSON.stringify(got.value)}`);
  }

  // The one asymmetry the language allows: the parser takes the first required
  // field positionally, the printer always writes it out.
  const positional = parseRule("WHEN [auto] played\nTHEN\n  ko($t)\n  draw(2)");
  assert.ok(positional.ok, "a positional first argument is read");
  assert.equal(printOps(positional.ok ? positional.value.ops : []), "ko(target: $t)\ndraw(n: 2)");

  // Precedence, and the brackets the printer adds to keep it.
  const a: Cond = { kind: "isTurnPlayer" };
  const b: Cond = { kind: "leaderFlipped" };
  const c: Cond = { kind: "did", what: "draw" };
  assert.equal(printCond({ kind: "any", conds: [{ kind: "all", conds: [a, b] }, c] }), "isTurnPlayer() AND leaderFlipped() OR did(what: draw)");
  assert.equal(printCond({ kind: "all", conds: [a, { kind: "any", conds: [b, c] }] }), "isTurnPlayer() AND (leaderFlipped() OR did(what: draw))");
  assert.equal(printCond({ kind: "not", cond: { kind: "all", conds: [a, b] } }), "NOT (isTurnPlayer() AND leaderFlipped())");
  // A one-member AND is not an AND at all in the text, so it keeps the general
  // form; printed as its member it would come back as the bare condition.
  assert.match(printCond({ kind: "all", conds: [a] }), /^all\(conds: \[/);
  for (const cond of [
    { kind: "any", conds: [{ kind: "all", conds: [a, b] }, c] },
    { kind: "all", conds: [a, { kind: "any", conds: [b, c] }] },
    { kind: "all", conds: [a, { kind: "all", conds: [b, c] }] },
    { kind: "not", cond: { kind: "not", cond: a } },
    { kind: "all", conds: [a] },
    { kind: "any", conds: [a] },
  ] as Cond[])
    tripCond(cond, `nesting: ${printCond(cond)}`);
}

// ── the selector, field by field ────────────────────────────────────────────
{
  for (const sel of [
    {},
    { special: "self" as const },
    ...SPECIAL_TARGETS.map((special) => ({ special })),
    { fromVar: "looked" },
    { area: "under", underHost: { special: "leader" as const } },
    { count: 1 },
    { count: 2, upTo: true },
    { upTo: true },
    { take: 3 },
    { take: 3, fromEnd: true },
    { fromEnd: true },
    { side: "opponent" as const },
    ...AREAS.map((area) => ({ area })),
    { areas: ["hand", "drop"] as const },
    // A one-area list is the shape that would print exactly like `area`; it is
    // marked instead, or the field would change on the way back.
    { areas: ["hand"] as const },
    { side: "both" as const, areas: ["battle", "unison", "leader"] as const },
    { mode: "active" as const },
    { mode: "rest" as const },
    { hidden: true },
    { hidden: false },
    { ignoreBarrier: true },
    { notSelf: "card" as const },
    { notSelf: "copies" as const },
    { special: "self" as const, mode: "rest" as const, count: 1 },
  ] as Selector[])
    tripSelector(sel, `selector ${printSelector(sel)}`);

  assert.equal(printSelector({}), "any", "a selector with nothing in it still has to be written down");
  assert.equal(printSelector({ areas: ["hand"] }), "IN ANY(hand)");
  assert.equal(printSelector({ area: "hand" }), "IN hand");
  assert.equal(printSelector({ side: "you" }), "OF you", "a side with no area is still a side");
}

// ── the card filter, field by field ─────────────────────────────────────────
{
  // Every field of a `CardFilter` set away from its default, one at a time:
  // the round trip either finds printed words that read back equal or falls to
  // the field form, and a field neither of those covers would be lost here.
  const one = (patch: Partial<CardFilter>): CardFilter => ({ ...emptyFilter(), ...patch });
  const cases: Partial<CardFilter>[] = [
    {},
    { colors: ["Blue"] },
    { notColors: ["Black"] },
    { monoColor: true },
    { multiColor: true },
    { characters: ["Son Goku"] },
    { notCharacters: ["Turles"] },
    { charactersIncluding: ["GT"] },
    { notCharactersIncluding: ["Turles"] },
    { traits: ["Saiyan"] },
    { notTraits: ["Great Ape"] },
    { names: ["Vegito, Powers Combined"] },
    { notNames: ["Vegito, Powers Combined"] },
    { namesIncluding: ["Baby"] },
    { notNamesIncluding: ["Baby"] },
    { keywords: ["Blocker"] },
    { notKeywords: ["Super Combo"] },
    { type: "BATTLE" },
    { notType: "LEADER" },
    { skillKind: "counter" },
    { unreadable: true },
    { noKeywords: true },
    { faceUp: true },
    { token: true },
    { notToken: true },
    { costMin: 1 },
    { costMax: 3 },
    { costMin: 2, costMax: 2 },
    { powerMin: 10000 },
    { powerMax: 15000 },
    { powerRel: { of: "self", cmp: "<=" } },
    // "…the chosen card's power" (BT19-096): measured against a bound
    // variable, not this card — the shape `compileClause` builds by filling
    // in `var` after `parseFilter` returns.
    { powerRel: { of: "chosen", cmp: "<=", var: "c1" } },
    { z: true },
    { z: false },
    { colors: ["Blue"], traits: ["Saiyan"], type: "BATTLE", costMax: 3 },
  ];
  for (const patch of cases) tripFilter(one(patch), `filter ${JSON.stringify(patch)}`);
  // …and the filters the target grammar actually produces, which is the set
  // the printed form has to cover for a record to stay readable.
  for (const text of [
    "red card",
    "blue <Son Goku> card with an energy cost of 3 or less",
    "yellow non-≪Great Ape≫ <Son Goku: Childhood> card with an energy cost of 3 or less",
    "≪Saiyan≫ Battle Card",
    "{Four-Star Ball, Parasitic Darkness}",
    "Extra Card with 15000 power or less",
  ])
    tripFilter(parseFilter(text), `filter from "${text}"`);
}

// ── keyword literals ────────────────────────────────────────────────────────
{
  // Every keyword the language may name, at least in its bare form; the
  // parameterised ones carry their parameters through as well. Half of these
  // names have a space or a hyphen in them, which the lexer breaks apart and
  // the parser puts back from the source.
  for (const name of KEYWORD_NAMES) tripOps([{ op: "grant", target: { var: "t" }, keyword: { name } as KeywordSkill, until: "turn" }], `keyword [${name}]`);
  for (const keyword of [
    { name: "Awaken", surge: true },
    { name: "Strike", x: 3 },
    { name: "Evolve", variant: "Xeno-Evolve" },
    { name: "Union", variant: "Potara" },
    { name: "Over Realm", x: 2, dark: true },
    { name: "Arrival", colors: ["Red", "Blue"] },
    { name: "Empower", color: null, x: 2 },
    { name: "Z-Stack", x: 1 },
  ] as KeywordSkill[])
    tripOps([{ op: "grant", target: { var: "t" }, keyword, until: "game" }], `keyword [${keyword.name}] with its parameters`);
}

// ── WHEN, COST and the whole rule ───────────────────────────────────────────
{
  const cost = (patch: Partial<CostRecord> = {}): CostRecord => ({ text: "", orbs: {}, either: [], marker: null, burst: null, spiritBoost: null, condition: null, program: null, ...patch });
  for (const rule of [
    ruleOf([]),
    ruleOf([], { kind: "permanent" }),
    ruleOf([], { kind: "activate:main" }),
    ruleOf([], { kind: "counter:attack" }),
    ruleOf([], { kind: "activate:main/battle" }),
    ruleOf([{ op: "draw", n: 1 }], { trigger: ["played"] as Trigger[] }),
    ruleOf([{ op: "draw", n: 1 }], { trigger: ["played", "attacks", "battleEnd"] as Trigger[] }),
    ruleOf([{ op: "draw", n: 1 }], { trigger: ["evolveFromHandActivated", "unionAbsorbActivated", "counterFreeFromHand"] as Trigger[] }),
    ruleOf([{ op: "draw", n: 1 }], { cost: cost({ orbs: { Red: 2, any: 1 } }) }),
    ruleOf([{ op: "draw", n: 1 }], { cost: cost({ either: [["Red", "Blue"]] }) }),
    ruleOf([{ op: "draw", n: 1 }], { cost: cost({ orbs: { Red: 1 }, either: [["Green", "Yellow"], ["Red", "Black"]], marker: -1, burst: 2, spiritBoost: 1 }) }),
    ruleOf([{ op: "draw", n: 1 }], { cost: cost({ marker: 1 }) }),
    ruleOf([{ op: "draw", n: 1 }], { cost: cost({ text: 'switch this card to Rest Mode, "as it were"' }) }),
    ruleOf([{ op: "draw", n: 1 }], { cost: cost({ condition: { kind: "leaderColor", color: "Red" } }) }),
    ruleOf([{ op: "draw", n: 1 }], { cost: cost({ program: [{ op: "switchMode", target: { sel: { special: "self" } }, mode: "rest" }] }) }),
    ruleOf([{ op: "draw", n: 1 }], { cost: cost() }),
    ruleOf([{ op: "ko", target: { var: "t" } }], { trigger: ["attacks"] as Trigger[], cost: cost({ orbs: { Red: 1 } }), cond: { kind: "life", side: "you", atMost: 4 } }),
  ])
    trip(rule, `rule ${JSON.stringify(rule.trigger)}`);

  assert.equal(
    printRule(ruleOf([{ op: "draw", n: 1 }], { trigger: ["played", "comboed"] as Trigger[], cost: cost({ orbs: { Red: 2 } }), cond: { kind: "life", side: "you", atMost: 4 } })),
    ["WHEN [auto] played | comboed", "COST {Red}{Red}", "IF life(you) <= 4", "THEN", "  draw(n: 1)"].join("\n"),
    "the shape of a record, in the language",
  );
  assert.equal(printRule(ruleOf([])), "WHEN [auto]\nTHEN", "a rule that does nothing still says so");

  // A nested program is a block, indented; that is the whole of the layout.
  assert.equal(
    printOps([{ op: "if", cond: { kind: "isTurnPlayer" }, then: [{ op: "draw", n: 1 }], else: [] }]),
    "if(cond: isTurnPlayer(), then: {\n  draw(n: 1)\n}, else: {})",
  );
}

// ── errors say where, in which clause, and what could have stood there ──────
{
  const bad = (src: string) => {
    const r = parseRule(src);
    assert.ok(!r.ok, `${src} should not parse`);
    return r.ok ? null! : r.error;
  };
  assert.equal(bad("THEN").clause, "WHEN");
  assert.deepEqual(bad("THEN").expected, ["WHEN"]);
  const e = bad("WHEN [auto] played\nTHEN\n  nosuchstep()");
  assert.equal(e.clause, "THEN");
  assert.equal(e.line, 3);
  assert.equal(e.col, 3);
  assert.match(e.message, /no step called "nosuchstep"/);
  assert.ok(e.expected.includes("draw"), "the message names what could have stood there");
  assert.equal(e.lineText, "  nosuchstep()");
  assert.equal(bad("WHEN [auto] played\nCOST {Red\nTHEN").clause, "COST");
  assert.equal(bad("WHEN [auto] played\nIF nosuchcondition()\nTHEN").clause, "IF");
  assert.match(bad("WHEN [auto] played\nTHEN\n  ko()").message, /required/i);
  assert.match(bad("WHEN [auto] played\nTHEN\n  draw(n: 1, nope: 2)").message, /no field called "nope"/);
  assert.match(bad("WHEN [auto] played\nTHEN\n  draw(n: 1, side: them)").message, /not one of these/);
  assert.match(bad("WHEN [auto] played\nTHEN\n  choose(sel: 1 IN you.nowhere, as: \"t\")").message, /not one of these/);
  assert.match(bad("WHEN [auto] played\nTHEN\n  grant(target: $t, keyword: [Nonsense], until: turn)").message, /not a keyword skill/);
  assert.match(bad("WHEN [auto] played\nTHEN\n  token(name: \"x\", power: 1, comboCost: 1, comboPower: 1, colors: [], n: null)").message, /cannot be null/);
}

// ── validation: what parses is not yet what the engine can play ─────────────
{
  const ok = (src: string, kind = "auto") => {
    const r = parseRule(src);
    assert.ok(r.ok, `${src}: ${r.ok ? "" : r.error.message}`);
    return validateRule(r.ok ? r.value : ruleOf([]), kind);
  };
  assert.equal(ok("WHEN [auto] played\nTHEN\n  draw(n: 1)"), null);
  assert.equal(ok("WHEN [auto] played\nTHEN\n  draw(n: 1)", "permanent")?.field, "kind", "the printed tag comes off the card and is not editable");
  assert.equal(ok("WHEN [auto] whenever\nTHEN")?.field, "trigger", "a moment the engine never fires is a skill that never happens");
  assert.equal(ok("WHEN [auto] evolveFromHandActivated | unionAbsorbActivated | counterFreeFromHand\nTHEN"), null);
  assert.equal(ok("WHEN [auto] played | played\nTHEN")?.field, "trigger");
  assert.equal(ok("WHEN [auto] played\nCOST {Red/Red}\nTHEN"), null, "two of the same colour is odd but sayable");
  assert.equal(ok("WHEN [auto] played\nTHEN"), null, "a rule that does nothing is valid");
}

// ── every program and every record the compiler writes, round-tripped ───────
{
  const scripts = rulesFromCompiler(DEFS) as Record<string, CardScripts>;
  let programs = 0;
  let records = 0;
  for (const id of Object.keys(DEFS)) {
    for (const key of [id, `${id}#back`]) {
      const cs = scripts[key];
      if (!cs) continue;
      for (const [index, script] of Object.entries(cs.bySkill)) {
        tripOps(script.ops, `${key} skill ${index}`);
        programs++;
      }
    }
    for (const rec of skillRecords(DEFS[id])) {
      trip({ kind: rec.kind, trigger: rec.trigger as Trigger[], cost: rec.cost, cond: rec.cond, ops: rec.ops }, `record ${rec.cardId} [${rec.skillIndex}]`);
      records++;
    }
  }
  assert.ok(programs > 50, `only ${programs} compiled programs were round-tripped`);
  assert.ok(records > 50, `only ${records} records were round-tripped`);
}

// ── the engine plays the record's WHEN, not the printed text ────────────────
{
  // The point of an editable WHEN: a card that prints "when you play this
  // card" whose record says `attacks` has to fire on the attack and not on the
  // play. Read off the text — which is what the engine did until 9 Sep 2026 —
  // both of these would be the other way round, and the workbench would have
  // been telling a story about a skill it could not move.
  const printed = rulesFromCompiler(DEFS) as Record<string, CardScripts>;
  const recorded = (trigger: Trigger[]): Record<string, CardScripts> => ({
    ...printed,
    // `DRAWER` prints "[Auto] When you play this card, draw 1 card." — an
    // existing harness card rather than a new one, so the probe digests this
    // suite guards stay exactly as they were.
    DRAWER: { ...printed.DRAWER, bySkill: { 0: { ...printed.DRAWER.bySkill[0], trigger } } },
  });

  const pendedOn = (scripts: Record<string, CardScripts> | undefined, trigger: Trigger): number => {
    const s: GameState = arena({ battle: ["DRAWER"] });
    const id = find(s, "p1", "battle", "DRAWER");
    const ctx = scripts ? { defs: DEFS, scripts } : CTX;
    s.pending = [];
    pendTriggers(ctx, s, trigger, id);
    return s.pending.length;
  };

  assert.equal(pendedOn(undefined, "played"), 1, "with no record the printed text still decides");
  assert.equal(pendedOn(undefined, "attacks"), 0);
  assert.equal(pendedOn(recorded(["attacks"]), "played"), 0, "the record moved the moment off the play");
  assert.equal(pendedOn(recorded(["attacks"]), "attacks"), 1, "…and onto the attack");
  assert.equal(pendedOn(recorded([]), "played"), 0, "an empty WHEN is a record that says: no moment");
  assert.equal(pendedOn(recorded(["played", "attacks"]), "played"), 1, "a WHEN may name more than one");
  assert.equal(pendedOn(recorded(["played", "attacks"]), "attacks"), 1);
}

// ── the grammar's own documentation ─────────────────────────────────────────
{
  // Every worked example in `docs/arena-rules-language.md` parses, and prints
  // back exactly as it is written. A grammar reference nobody checks is the
  // first thing to go stale, and a wrong example there costs more than no
  // example: it is what a person copies when they are stuck.
  // Git's `core.autocrlf` is on by default on Windows, so the checked-out doc
  // has CRLF endings and every pattern below — which the printer writes with
  // LF — matched nothing. The whole check then failed on the count, on a
  // machine where nothing was wrong: the gate has to be runnable where the
  // work happens.
  const doc = fs.readFileSync(path.join(__dirname, "../../docs/arena-rules-language.md"), "utf8").replace(/\r\n/g, "\n");
  const examples = [...doc.matchAll(/```\n(WHEN[\s\S]*?)```/g)].map((m) => m[1].replace(/\s+$/, ""));
  // The definition grammar's own examples (§3b), the same way: they are what a
  // person copies when they are writing a ruleset, so a wrong one costs more
  // than none. Printed back exactly as written, which also proves the doc was
  // not hand-edited away from the printer's form.
  const defExamples = [...doc.matchAll(/```\n(DEFINE[\s\S]*?)```/g)].map((m) => m[1].replace(/\s+$/, ""));
  assert.equal(defExamples.length, DEFINE_KINDS.length, `§3b should show one example per DEFINE kind, not ${defExamples.length}`);
  for (const src of defExamples) {
    const parsed = parseDefinitions(src);
    assert.ok(parsed.ok, `the doc's declaration does not parse: ${parsed.ok ? "" : `${parsed.error.clause} ${parsed.error.line}:${parsed.error.col} ${parsed.error.message}`}\n${src}`);
    assert.equal(printDefinitions(parsed.value), src, `the doc's declaration is not how the printer writes it:\n${src}`);
  }

  // …and §3b names every row of `DEFINE_SCHEMA`, field by field, as the op list
  // is checked against the effect-language legend. A kind or a field the
  // grammar has and the doc does not is a reference that has started lying.
  const section = doc.slice(doc.indexOf("## 3b."), doc.indexOf("## 4."));
  assert.ok(section.length > 1000, "§3b is missing from the language doc");
  for (const kind of DEFINE_KINDS) {
    assert.ok(section.includes(`DEFINE ${kind}`), `§3b does not mention DEFINE ${kind}`);
    assert.ok(section.includes(DEFINE_SCHEMA[kind].doc.slice(0, 24)), `§3b does not say what a ${kind} is for`);
    for (const f of fieldsOf(kind)) {
      const written = f.word ?? `${f.name}:`;
      assert.ok(section.includes(written), `§3b does not name the ${kind} field written ${JSON.stringify(written)}`);
    }
  }
  // §3's `expr` production names every expression the language can write, the
  // same way §3b names every `DEFINE` kind. A shape in `EXPR_SCHEMA` that the
  // grammar does not show is a reference that has started lying — and this is
  // the production a person reads before writing an amount by hand.
  {
    const grammar = doc.slice(doc.indexOf("## 3. The grammar"), doc.indexOf("## 3b."));
    assert.ok(grammar.length > 500, "§3 is missing from the language doc");
    for (const spec of EXPR_SCHEMA) assert.ok(grammar.includes(`"${spec.call}"`), `§3's expr production does not name ${spec.call}`);
    for (const attr of EXPR_ATTRS) assert.ok(grammar.includes(`"${attr}"`), `§3's attr production does not name ${attr}`);
    // The two literals and the one operator have no call name to look for, so
    // the production is checked against the forms `EXPR_LITERALS` names.
    assert.ok(grammar.includes('"$" name'), "§3's expr production does not show a $variable");
    assert.ok(grammar.includes('( "+" number )'), "§3's expr production does not show the + operator");
    assert.ok(grammar.includes("term   := number"), "§3's expr production does not show a bare number");
    assert.equal(Object.keys(EXPR_LITERALS).join(","), "number,var,plus", "EXPR_LITERALS names the three forms this check covers");
  }

  assert.ok(examples.length >= 5, `only ${examples.length} worked examples in the language doc`);
  for (const src of examples) {
    const parsed = parseRule(src);
    assert.ok(parsed.ok, `the doc's example does not parse: ${parsed.ok ? "" : `${parsed.error.clause} ${parsed.error.line}:${parsed.error.col} ${parsed.error.message}`}\n${src}`);
    assert.equal(printRule(parsed.value), src, `the doc's example is not how the printer writes it:\n${src}`);
  }
}

console.log("verify/lang: the rules language round-trips");
