/**
 * The rules language's own vocabulary, as one generated table.
 *
 * `/arena/rules/language` (`src/app/arena/rules/language/page.tsx`) reads this and
 * nothing else to answer "what can I write after THEN" — the question `docs/arena-
 * rules-language.md` §3 deliberately leaves unanswered ("statements and conditions
 * are not listed here and never will be: they are generated from `OP_SCHEMA` and
 * `COND_SCHEMA`"). Every row below comes off a table the interpreter, the printer
 * and the parser already read: `OP_SCHEMA`/`COND_SCHEMA` (`engine/script-schema.ts`,
 * the legacy engine's own vocabulary — still the truth for what an op or a
 * condition *is*), the selector/filter/expression/cost tables in `lang/ast.ts`
 * and `lang/parse.ts`, and the areas, durations, sides, keyword names and WHEN
 * moments off `rulesets/words.ts` — **the game's own words**, not a copy kept
 * here or in the engine's arrays (see CLAUDE.md's "The game's words are the
 * only words", 12 Sep 2026). Nothing here is a second, hand-kept copy of the
 * language, so a schema or a ruleset change shows up here without an edit of
 * its own.
 *
 * Pure and client-safe, like the rest of `lang/` (see `lang/index.ts`).
 */
import { emptyFilter, parseFilter, type CardFilter } from "../engine/filters";
import {
  COND_CLASS,
  COND_SCHEMA,
  OP_CLASS,
  OP_SCHEMA,
  SPECIAL_TARGETS,
  condSignature,
  describeCond,
  describeFilter,
  describeScript,
  opSignature,
  type Cond,
  type FieldType,
  type Op,
  type OpClass,
  type OpField,
} from "../engine/script";
import { whenMoments, words } from "../rulesets/words";
import { COST_ITEMS, EXPR_ATTRS, EXPR_LITERALS, EXPR_SCHEMA, FILTER_FIELDS, SELECTOR_FIELDS, type FilterFieldType } from "./ast";
import { SELECTOR_FLAGS } from "./parse";

// ── one field, as a table row ───────────────────────────────────────────────

export interface RefField {
  name: string;
  /** The field's own type name (`"amount"`, `"ref"`, …), or `"enum"` / `"list"` when `FieldType` names a shape rather than a scalar. */
  type: string;
  required: boolean;
  nullable: boolean;
  /** For an `enum` field, or a `list` of one: the values it may hold. */
  enumValues?: string[];
  /** For a `list` field: what each item is. */
  listOf?: "string" | "enum";
  /** What the interpreter assumes when the field is left out, printed as JSON — `undefined` itself is not a value, so its absence here means there is no default. */
  defaultText?: string;
}

function refField(f: OpField): RefField {
  const t = f.type;
  const base = { name: f.name, required: !!f.required, nullable: !!f.nullable, defaultText: f.default === undefined ? undefined : JSON.stringify(f.default) };
  if (typeof t === "object") {
    if ("enum" in t) return { ...base, type: "enum", enumValues: [...t.enum] };
    return t.list === "string" ? { ...base, type: "list", listOf: "string" } : { ...base, type: "list", listOf: "enum", enumValues: [...t.list.enum] };
  }
  return { ...base, type: t };
}

// ── minimal instances, for the worked "sentence" example ───────────────────
//
// The same technique `scripts/verify/language.ts` uses to prove every row of
// `OP_SCHEMA`/`COND_SCHEMA` renders: a minimal instance built from only the
// op's or condition's own *required* fields. One value per `FieldType`, so a
// field type the language gains needs one more entry here — the same "one
// more row" cost as everywhere else in this module.

const SAMPLE: Record<string, unknown> = {
  amount: 1,
  ref: { sel: { special: "self" } },
  selector: { side: "you", area: "battle", count: 1 },
  side: "you",
  area: "drop",
  duration: "turn",
  cond: { kind: "isTurnPlayer" },
  conds: [{ kind: "isTurnPlayer" }],
  ops: [{ op: "draw", n: 1 }],
  string: "x",
  number: 1,
  boolean: true,
  keyword: { name: "Blocker" },
  filter: parseFilter("red card"),
  modes: [{ label: "a", ops: [{ op: "draw", n: 1 }] }],
};

function sampleFor(t: FieldType): unknown {
  if (typeof t === "object") return "enum" in t ? t.enum[0] : [];
  return SAMPLE[t];
}

function minimalInstance(key: string, keyField: "op" | "kind", spec: { fields: OpField[] }): Record<string, unknown> {
  const out: Record<string, unknown> = { [keyField]: key };
  for (const f of spec.fields) if (f.required) out[f.name] = sampleFor(f.type);
  return out;
}

// ── ops and conditions ──────────────────────────────────────────────────────

export interface RefOp {
  name: string;
  class: OpClass;
  /** `{"op":"draw","n":AMOUNT,"side"?:"you"|"opponent"}` — the shape the referee is shown. */
  signature: string;
  fields: RefField[];
  /** How a minimal instance reads, in plain English. */
  sentence: string;
  doc?: string;
}

export interface RefCond {
  kind: string;
  class: OpClass;
  signature: string;
  fields: RefField[];
  sentence: string;
  doc?: string;
}

function refOps(): RefOp[] {
  return Object.entries(OP_SCHEMA).map(([name, spec]) => ({
    name,
    class: OP_CLASS[name as Op["op"]],
    signature: opSignature(name as Op["op"]),
    fields: spec.fields.map(refField),
    sentence: describeScript([minimalInstance(name, "op", spec) as unknown as Op]),
    doc: spec.doc,
  }));
}

function refConds(): RefCond[] {
  return Object.entries(COND_SCHEMA).map(([kind, spec]) => ({
    kind,
    class: COND_CLASS[kind as Cond["kind"]],
    signature: condSignature(kind as Cond["kind"]),
    fields: spec.fields.map(refField),
    sentence: describeCond(minimalInstance(kind, "kind", spec) as unknown as Cond),
    doc: spec.doc,
  }));
}

// ── the selector: its parts, and the literal flag words ────────────────────

export interface RefSelectorField {
  field: string;
  /** Which positional part of a printed selector this field is — `ast.ts`'s `SelectorPart`. */
  part: string;
}

function refSelectorFields(): RefSelectorField[] {
  return Object.entries(SELECTOR_FIELDS).map(([field, part]) => ({ field, part }));
}

/** What each flag word sets. The set of words is `Object.keys(SELECTOR_FLAGS)` (`lang/parse.ts`); a word added there and not here fails the typecheck. */
const SELECTOR_FLAG_DOCS: Record<keyof typeof SELECTOR_FLAGS, string> = {
  any: "no filter, no count — every card the area holds (the printer's own word for an empty selector)",
  active: "cards in Active Mode",
  rest: "cards in Rest Mode",
  hidden: "cards in Hidden Mode (23-5)",
  revealed: "cards in Revealed Mode (23-5)",
  fromEnd: "count from the bottom of the area's order instead of the top",
  ignoringBarrier: "may target a card with [Barrier] all the same",
  otherThanSelf: "excludes this card",
  otherThanCopies: "excludes every copy of this card, not only this one",
};

export interface RefSelectorFlag {
  word: string;
  doc: string;
}

function refSelectorFlags(): RefSelectorFlag[] {
  return (Object.keys(SELECTOR_FLAGS) as (keyof typeof SELECTOR_FLAGS)[]).map((word) => ({ word, doc: SELECTOR_FLAG_DOCS[word] }));
}

// ── the card filter: its fields, in the printed words `describeFilter` makes ─

/** One representative value per `FilterFieldType`, so every field's printed words can be read off the real `describeFilter` rather than guessed at. */
function sampleFilterValue(t: FilterFieldType): unknown {
  switch (t) {
    case "strings":
      return ["Saiyan"];
    case "colors":
      return ["Red"];
    case "keywords":
      return ["Blocker"];
    case "cardType":
      return "BATTLE";
    case "skillKind":
      return "activate";
    case "boolean":
    case "tri":
      return true;
    case "number":
      return 3;
    case "powerRel":
      return { cmp: "<=", of: "self" };
  }
}

export interface RefFilterField {
  field: string;
  type: FilterFieldType;
  /** `describeFilter` on a filter carrying only this field — the words it alone contributes. */
  printed: string;
}

function refFilterFields(): RefFilterField[] {
  return Object.entries(FILTER_FIELDS).map(([field, type]) => {
    const filter = { ...emptyFilter(), [field]: sampleFilterValue(type as FilterFieldType) } as CardFilter;
    return { field, type: type as FilterFieldType, printed: describeFilter(filter) };
  });
}

// ── expressions, the price's items, the triggers, the literals ─────────────

export interface RefExpr {
  key: string;
  call: string;
  args: readonly string[];
  example: string;
  maxExample?: string;
}

function refExpressions(): RefExpr[] {
  return EXPR_SCHEMA.map((e) => ({ key: e.key, call: e.call, args: e.args, example: e.example, maxExample: e.maxExample }));
}

export interface RefLiteralExpr {
  key: string;
  syntax: string;
}

function refExprLiterals(): RefLiteralExpr[] {
  return Object.entries(EXPR_LITERALS).map(([key, syntax]) => ({ key, syntax }));
}

export interface RefTrigger {
  name: string;
  words: string;
}

/**
 * `whenMoments()` is the same list `validateRule` (`lang/validate.ts`) checks
 * a rule's WHEN against — the game's own triggers, less the five `counter:`
 * windows a [Counter] answers in rather than a WHEN. Each moment's words are
 * its declaration's own `text:` (`words()["trigger:" + name]`), the same
 * source the record's WHEN line reads.
 */
function refTriggers(): RefTrigger[] {
  const v = words();
  return whenMoments(v).map((name) => ({ name, words: v.words[`trigger:${name}`] ?? name }));
}

export interface RefLiteral {
  written: string;
  is: string;
}

/**
 * `docs/arena-rules-language.md` §3's "Literals" table. Where a row names an
 * actual closed vocabulary the words come off the game's own `words()`
 * (`rulesets/words.ts`) — the side, zone and duration words the parser reads
 * a selector against, and the keyword names it reads `[…]` against — except
 * `SPECIAL_TARGETS`, the one list with no `Vocabulary` field and no `DEFINE`
 * kind that could declare it, which stays the engine's own
 * (`engine/script-schema.ts`). Where the row is pure syntax with no table
 * behind it (a keyword's parameters, a bound variable, a text/null/true/list
 * literal) the syntax is written out, the same way `EXPR_LITERALS` writes out
 * the two expression literals no call name covers.
 */
function refLiterals(): RefLiteral[] {
  const v = words();
  return [
    { written: SPECIAL_TARGETS.map((s) => `[${s}]`).join("  "), is: "a special target" },
    { written: "[Blocker]   [Strike x: 3]   [Empower color: Red, x: 2]", is: `a keyword skill, with its parameters — one of the ${v.keywordNames.length} keywords the parser knows (/arena/rules/keywords)` },
    { written: "[auto]   [activate:main]   [counter:attack]   [permanent]", is: "the printed skill tag, in WHEN — read-only" },
    { written: "$t,  $looked MINUS $kept", is: "cards bound by an earlier step" },
    { written: `${v.sides.join(" · ")}   |   ${v.areas.join(" · ")}   |   ${v.durations.join(" · ")}`, is: "a side, a zone, a duration" },
    { written: `"…"   null   true   [Red, Blue]`, is: "a text, an absent value, a flag, a list" },
  ];
}

// ── the whole table ──────────────────────────────────────────────────────────

export interface LanguageReference {
  ops: RefOp[];
  conds: RefCond[];
  selectorFields: RefSelectorField[];
  selectorFlags: RefSelectorFlag[];
  filterFields: RefFilterField[];
  expressions: RefExpr[];
  exprLiterals: RefLiteralExpr[];
  exprAttrs: readonly string[];
  costItems: readonly { syntax: string; doc: string }[];
  triggers: RefTrigger[];
  literals: RefLiteral[];
}

export function languageReference(): LanguageReference {
  return {
    ops: refOps(),
    conds: refConds(),
    selectorFields: refSelectorFields(),
    selectorFlags: refSelectorFlags(),
    filterFields: refFilterFields(),
    expressions: refExpressions(),
    exprLiterals: refExprLiterals(),
    exprAttrs: EXPR_ATTRS,
    costItems: COST_ITEMS,
    triggers: refTriggers(),
    literals: refLiterals(),
  };
}
