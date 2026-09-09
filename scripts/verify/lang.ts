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
import { parseRule, printRule, printCond, printOps, printSelector, validateRule, deepEqual, type Rule } from "../../src/lib/arena/lang";
import { parseCond } from "../../src/lib/arena/lang/parse";
import { CTX, DEFS, arena, find, parseFilter, rulesFromCompiler, skillRecords } from "./harness";

/** A rule with nothing but its steps, for the round trips that are about the program. */
const ruleOf = (ops: Op[], rest: Partial<Rule> = {}): Rule => ({ kind: "auto", trigger: [], cost: null, cond: null, ops, ...rest });

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

// ── every op and every condition, at its narrowest and at its widest ─────────
{
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
  const AMOUNTS: Amount[] = [
    1,
    { var: "n" },
    { count: { side: "you", area: "battle", count: 99 } },
    { count: { side: "you", area: "battle", count: 99 }, times: 5000 },
    { sumPower: { var: "rested" } },
    { handUpTo: 4 },
    { markers: { special: "self" } },
    { markers: { side: "opponent", area: "unison", count: 99 }, times: 5000 },
  ];
  for (const n of AMOUNTS) tripOps([{ op: "draw", n }], `draw amount ${JSON.stringify(n)}`);
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
  assert.ok(examples.length >= 5, `only ${examples.length} worked examples in the language doc`);
  for (const src of examples) {
    const parsed = parseRule(src);
    assert.ok(parsed.ok, `the doc's example does not parse: ${parsed.ok ? "" : `${parsed.error.clause} ${parsed.error.line}:${parsed.error.col} ${parsed.error.message}`}\n${src}`);
    assert.equal(printRule(parsed.value), src, `the doc's example is not how the printer writes it:\n${src}`);
  }
}

console.log("verify/lang: the rules language round-trips");
