/**
 * A rule as blocks (#469): WHEN · COST · IF · THEN, each a list of blocks, each
 * block a sentence whose blanks are the fields of one schema row.
 *
 * Nothing here knows an op, a condition or a price item by name. What can go
 * in a clause is read off `OP_SCHEMA`/`COND_SCHEMA` (less the rows no printed
 * card says), `whenMoments()` and `COST_ITEMS`; what control a blank gets is
 * read off its `FieldType`; a selector's parts off `SELECTOR_FIELDS` and
 * `SELECTOR_FLAGS`; a filter's off `FILTER_FIELDS`; an amount's off
 * `EXPR_SCHEMA`. A row added to any of those appears in the builder with no
 * edit here — the one exception is the price, whose nine items are a fixed
 * grammar rather than a table (`COST_ITEMS`' own comment), so each gets one row
 * in `COST_ITEM_SPECS` below, typed so that a new item fails the typecheck
 * until it has one.
 *
 * Every block is addressed by a `RulePath` (`./path`), the address Try it
 * (#470) and the review queue (#472) use too.
 *
 * Pure and client-safe, like the rest of `lang/`. The builder's components
 * (`components/arena/rules/Blocks.tsx`) are a rendering of what is here, and
 * `scripts/verify/blocks.ts` proves the logic without a browser.
 */
import { emptyFilter, type CardFilter } from "../text/filters";
import {
  COLORS,
  COND_SCHEMA,
  CONDITIONS_OFF_A_CARD,
  OP_CLASS,
  OP_SCHEMA,
  SPECIAL_TARGETS,
  costSentence,
  describeCond,
  describeFilter,
  describeScript,
  describeSelector,
  validateProgram,
  type Cond,
  type CostRecord,
  type FieldType,
  type Op,
  type OpField,
  type Selector,
} from "../vm/script";
import { describeTrigger } from "../gaps";
import { dbsWords } from "../board-words";
import { optionsFor, whenMoments, words } from "../rulesets/words";
import { COST_ITEMS, EXPR_ATTRS, EXPR_SCHEMA, FILTER_FIELDS, SELECTOR_FIELDS, type ExprArg, type ExprSpec, type FilterFieldType, type Rule } from "./ast";
import { SELECTOR_FLAGS } from "./parse";
import { RULE_CLAUSES, childPath, clauseOf, parsePath, resolvePath, type PathStep, type RuleClause, type RulePath } from "./path";
import { minimalInstance, sampleFilterValue, sampleFor } from "./reference";
import { validateRule } from "./validate";

type Loose = Record<string, unknown>;
const isObject = (v: unknown): v is Loose => !!v && typeof v === "object" && !Array.isArray(v);

// ── what can go in a clause ─────────────────────────────────────────────────

/** One entry of a clause's "add" list: the row's key, its words, and the heading it is listed under. */
export interface Choice {
  key: string;
  /** How a minimal instance reads, or the moment's own words. */
  label: string;
  group: string;
  doc?: string;
}

/** "macro over `move`" → "built on move"; a primitive is a primitive. */
const groupWords = (c: string): string => (c === "primitive" ? "primitives" : `built on ${c.replace(/^macro over /, "").replace(/`/g, "")}`);

const safe = (f: () => string, fallback: string): string => {
  try {
    return f() || fallback;
  } catch {
    return fallback;
  }
};

/** THEN: every op a card can say — not the `offCard` ones a keyword's own program writes — grouped by `OP_CLASS`. */
export function thenChoices(): Choice[] {
  return (Object.keys(OP_SCHEMA) as Op["op"][])
    .filter((k) => !OP_SCHEMA[k].offCard)
    .map((k) => ({ key: k, label: safe(() => describeScript([minimalInstance(k, "op", OP_SCHEMA[k]) as unknown as Op]), k), group: groupWords(OP_CLASS[k]), doc: OP_SCHEMA[k].doc }));
}

/** IF: every condition except the ones no printed card says (`CONDITIONS_OFF_A_CARD`). */
export function ifChoices(): Choice[] {
  return (Object.keys(COND_SCHEMA) as Cond["kind"][])
    .filter((k) => !CONDITIONS_OFF_A_CARD.includes(k))
    .map((k) => ({ key: k, label: safe(() => describeCond(minimalInstance(k, "kind", COND_SCHEMA[k]) as unknown as Cond), k), group: "conditions", doc: COND_SCHEMA[k].doc }));
}

/** WHEN: the game's moments, each in its declaration's own words. */
export function whenChoices(): Choice[] {
  const w = words();
  return whenMoments(w).map((t) => ({ key: t, label: w.words[`trigger:${t}`] ?? describeTrigger([t]), group: "moments" }));
}

/** COST: the price's items. */
export function costChoices(): Choice[] {
  return COST_ITEMS.map((c) => ({ key: c.syntax, label: c.doc, group: "price" }));
}

/** The list for one clause. */
export function choicesFor(clause: RuleClause): Choice[] {
  return clause === "trigger" ? whenChoices() : clause === "cost" ? costChoices() : clause === "cond" ? ifChoices() : thenChoices();
}

/** The searchable list: a choice matches when every word typed is in its key, its words or its heading. */
export function searchChoices(choices: Choice[], query: string): Choice[] {
  const want = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!want.length) return choices;
  return choices.filter((c) => {
    const hay = `${c.key} ${c.label} ${c.group}`.toLowerCase();
    return want.every((w) => hay.includes(w));
  });
}

// ── a blank, by field type ──────────────────────────────────────────────────

/** The control a blank is, picked by its `FieldType` and never by the op it belongs to. */
export type Control = "select" | "multi" | "strings" | "number" | "amount" | "toggle" | "text" | "filter" | "selector" | "ref" | "cond" | "conds" | "ops" | "modes";

export function controlFor(t: FieldType): Control {
  if (typeof t === "object") return "enum" in t ? "select" : t.list === "string" ? "strings" : "multi";
  switch (t) {
    case "side":
    case "area":
    case "duration":
    case "keyword":
      return "select";
    case "amount":
      return "amount";
    case "number":
      return "number";
    case "boolean":
      return "toggle";
    case "string":
      return "text";
    case "filter":
      return "filter";
    case "selector":
      return "selector";
    case "ref":
      return "ref";
    case "cond":
      return "cond";
    case "conds":
      return "conds";
    case "ops":
      return "ops";
    case "modes":
      return "modes";
  }
}

/** The values a select or a multi-select offers: the game's own words for a side, an area, a duration or a keyword. */
export function optionsOf(t: FieldType): string[] {
  if (typeof t === "object") return "enum" in t ? [...t.enum] : t.list === "string" ? [] : [...t.list.enum];
  if (t === "side" || t === "area" || t === "duration" || t === "keyword") return optionsFor(t);
  return [];
}

/** A keyword field holds `{ name }`; every other select holds the word. */
export const selectValue = (t: FieldType, v: unknown): string => (t === "keyword" ? ((v as { name?: string } | undefined)?.name ?? "") : typeof v === "string" ? v : "");
export const selectWrite = (t: FieldType, word: string): unknown => (word === "" ? undefined : t === "keyword" ? { name: word } : word);

/** A field shown in a blank. One a keyword's own body writes (`offCard`) is shown only when a record already carries it, so nothing is hidden and lost. */
export const shownFields = (fields: readonly OpField[], node: Loose): OpField[] => fields.filter((f) => !f.offCard || node[f.name] !== undefined);

/** The names the `as` fields of the steps before a place have bound — what a `ref` blank offers as `$name`. */
const BINDING_FIELD = "as";

/** A fresh name for a step that binds: `t`, then `t2`, `t3`… so two choices never collide. */
export function freshName(taken: readonly string[]): string {
  if (!taken.includes("t")) return "t";
  for (let i = 2; ; i++) if (!taken.includes(`t${i}`)) return `t${i}`;
}

/**
 * A new block of a row: every required field left empty — a visible "fill
 * this" — except the four whose empty value is itself a value (a list of steps,
 * a list of conditions, a modal's options, a filter that matches anything) and
 * a binding name, which is made fresh so it can be pointed at at once.
 */
export function blankNode(keyField: "op" | "kind", key: string, fields: readonly OpField[], taken: readonly string[] = []): Loose {
  const out: Loose = { [keyField]: key };
  for (const f of fields) {
    if (!f.required) continue;
    if (f.type === "ops") out[f.name] = [];
    else if (f.type === "conds") out[f.name] = [];
    else if (f.type === "modes")
      out[f.name] = [
        { label: "", ops: [] },
        { label: "", ops: [] },
      ];
    else if (f.type === "filter") out[f.name] = emptyFilter();
    else if (f.type === "string" && f.name === BINDING_FIELD) out[f.name] = freshName(taken);
  }
  return out;
}

export const blankOp = (name: Op["op"], taken: readonly string[] = []): Op => blankNode("op", name, OP_SCHEMA[name].fields, taken) as unknown as Op;
export const blankCond = (kind: Cond["kind"]): Cond => blankNode("kind", kind, COND_SCHEMA[kind].fields) as unknown as Cond;

// ── the price, item by item ─────────────────────────────────────────────────

/** One `COST_ITEMS` row as blanks: its fields, how to find it in a price, and how to put it back. */
export interface CostItemSpec {
  fields: OpField[];
  /**
   * A new instance. A price has no room for an empty blank — an orb of no
   * colour is simply no orb — so an item arrives holding the plainest value
   * its fields can take, and the IF item a condition the builder asks for at
   * once (`Blocks.tsx` opens the IF list when it is picked).
   */
  blank: () => Loose;
  /** Every instance of the item in a price, as a bag of its fields, with the path it lives at. */
  read: (c: CostRecord) => { path: RulePath; values: Loose }[];
  /** Fold one instance into a price being built. */
  write: (c: CostRecord, values: Loose) => void;
}

export type CostSyntax = (typeof COST_ITEMS)[number]["syntax"];
const ORB_COLORS = ["any", ...COLORS] as const;
/** What a payer stands in for, off the `payWith` op as `validate.ts` reads it. */
const PAY_AS = (OP_SCHEMA.payWith.fields.find((f) => f.name === "as")!.type as { enum: readonly string[] }).enum;

export const COST_ITEM_SPECS: Record<CostSyntax, CostItemSpec> = {
  "{Red}": {
    fields: [
      { name: "color", type: { enum: ORB_COLORS }, required: true },
      { name: "n", type: "number", required: true },
    ],
    blank: () => ({ color: "any", n: 1 }),
    read: (c) => Object.entries(c.orbs).map(([color, n]) => ({ path: `cost.orbs.${color}`, values: { color, n } })),
    write: (c, v) => {
      if (typeof v.color !== "string") return;
      c.orbs[v.color] = (c.orbs[v.color] ?? 0) + (typeof v.n === "number" ? v.n : 0);
    },
  },
  "{Red/Blue}": {
    fields: [{ name: "colors", type: { list: { enum: COLORS } }, required: true }],
    blank: () => ({ colors: ["Red", "Blue"] }),
    read: (c) => c.either.map((colors, i) => ({ path: `cost.either[${i}]`, values: { colors } })),
    write: (c, v) => void c.either.push(Array.isArray(v.colors) ? (v.colors as string[]) : []),
  },
  "+1 marker": {
    fields: [{ name: "n", type: "number", required: true }],
    blank: () => ({ n: 1 }),
    read: (c) => (c.marker != null ? [{ path: "cost.marker", values: { n: c.marker } }] : []),
    write: (c, v) => void (c.marker = typeof v.n === "number" ? v.n : (null as unknown as number)),
  },
  "burst N": {
    fields: [{ name: "n", type: "number", required: true }],
    blank: () => ({ n: 1 }),
    read: (c) => (c.burst != null ? [{ path: "cost.burst", values: { n: c.burst } }] : []),
    write: (c, v) => void (c.burst = typeof v.n === "number" ? v.n : (null as unknown as number)),
  },
  "spiritBoost N": {
    fields: [{ name: "n", type: "number", required: true }],
    blank: () => ({ n: 1 }),
    read: (c) => (c.spiritBoost != null ? [{ path: "cost.spiritBoost", values: { n: c.spiritBoost } }] : []),
    write: (c, v) => void (c.spiritBoost = typeof v.n === "number" ? v.n : (null as unknown as number)),
  },
  X: {
    fields: [
      { name: "min", type: "number" },
      { name: "max", type: "number" },
    ],
    blank: () => ({}),
    read: (c) => (c.x ? [{ path: "cost.x", values: { ...c.x } }] : []),
    write: (c, v) => {
      c.x = {};
      if (typeof v.min === "number") c.x.min = v.min;
      if (typeof v.max === "number") c.x.max = v.max;
    },
  },
  PAYWITH: {
    fields: [
      { name: "sel", type: "selector", required: true },
      { name: "as", type: { enum: PAY_AS }, required: true },
    ],
    blank: () => ({ sel: { count: 1 }, as: "energy" }),
    read: (c) => (c.payWith ?? []).map((pw, i) => ({ path: `cost.payWith[${i}]`, values: { sel: pw.sel, as: pw.as } })),
    write: (c, v) => void (c.payWith = [...(c.payWith ?? []), { sel: v.sel as Selector, as: v.as as "energy" }]),
  },
  TEXT: {
    fields: [{ name: "text", type: "string", required: true }],
    blank: () => ({ text: "the price as printed" }),
    read: (c) => (c.text ? [{ path: "cost.text", values: { text: c.text } }] : []),
    write: (c, v) => void (c.text = typeof v.text === "string" ? v.text : ""),
  },
  IF: {
    fields: [{ name: "condition", type: "cond", required: true }],
    blank: () => ({ condition: { kind: "isTurnPlayer" } }),
    read: (c) => (c.condition ? [{ path: "cost.condition", values: { condition: c.condition } }] : []),
    write: (c, v) => void (c.condition = (v.condition as Cond) ?? null),
  },
  DO: {
    fields: [{ name: "program", type: "ops", required: true }],
    blank: () => ({ program: [] }),
    read: (c) => (c.program ? [{ path: "cost.program", values: { program: c.program } }] : []),
    write: (c, v) => void (c.program = (v.program as Op[]) ?? null),
  },
};

export const COST_SYNTAXES = COST_ITEMS.map((c) => c.syntax) as CostSyntax[];

/** A price with nothing in it — the parser's own starting record. */
export const bareCost = (): CostRecord => ({ text: "", orbs: {}, either: [], marker: null, burst: null, spiritBoost: null, condition: null, program: null });

export interface CostItem {
  key: CostSyntax;
  path: RulePath;
  values: Loose;
}

/** A price as its items, in `COST_ITEMS` order (the order the printer writes). */
export function costItems(cost: CostRecord | null): CostItem[] {
  if (!cost) return [];
  return COST_SYNTAXES.flatMap((key) => COST_ITEM_SPECS[key].read(cost).map((it) => ({ key, ...it })));
}

/** …and the items back as a price. */
export function costFrom(items: readonly Pick<CostItem, "key" | "values">[]): CostRecord {
  const c = bareCost();
  for (const it of items) COST_ITEM_SPECS[it.key].write(c, it.values);
  return c;
}

/** A new item of a price. */
export const blankCostItem = (key: CostSyntax): Loose => COST_ITEM_SPECS[key].blank();

/**
 * The price with one more item. Each spec's `write` decides what a second one
 * means — a second orb of a colour adds to its count, a second marker count
 * replaces the first — so nothing here knows which items repeat.
 */
export function addCostItem(cost: CostRecord | null, key: CostSyntax, values: Loose = blankCostItem(key)): CostRecord {
  return costFrom([...costItems(cost), { key, values }]);
}

/** The price with the item at `index` (in `costItems` order) changed, or taken out with `null`. */
export function editCostItem(cost: CostRecord | null, index: number, values: Loose | null): CostRecord {
  const items = costItems(cost);
  return costFrom(values === null ? items.filter((_, i) => i !== index) : items.map((it, i) => (i === index ? { ...it, values } : it)));
}

/** The price with only this item in it, for its own reading and its own check. */
export const costOfOne = (item: Pick<CostItem, "key" | "values">): CostRecord => costFrom([item]);

// ── the selector, as a query ────────────────────────────────────────────────

/** `[how many] [which cards] IN [whose].[zone] [flags]`: the positional parts of `SELECTOR_FIELDS`, in the order a selector is printed. */
export const SELECTOR_PARTS = [...new Set(Object.values(SELECTOR_FIELDS))];
export const selectorFieldsOf = (part: (typeof SELECTOR_PARTS)[number]): (keyof Selector)[] =>
  (Object.keys(SELECTOR_FIELDS) as (keyof Selector)[]).filter((k) => SELECTOR_FIELDS[k] === part);

/** The flag words a selector may carry, less `any` (an empty selector's own word, not a flag) and the keyword-body word no card's record writes. */
export const SELECTOR_FLAG_WORDS = Object.keys(SELECTOR_FLAGS).filter((w) => w !== "any" && w !== "asPrinted");

/** What a flag word sets, read by running it on an empty selector. */
const flagEffect = (word: string): Loose => {
  const s: Selector = {};
  SELECTOR_FLAGS[word](s);
  return s as Loose;
};

export function flagOn(sel: Selector, word: string): boolean {
  const eff = flagEffect(word);
  return Object.entries(eff).every(([k, v]) => (sel as Loose)[k] === v);
}

export function setFlag(sel: Selector, word: string, on: boolean): Selector {
  const next: Loose = { ...sel };
  for (const [k, v] of Object.entries(flagEffect(word))) {
    if (on) next[k] = v;
    else if (next[k] === v) delete next[k];
  }
  return next as Selector;
}

/** How many a selector takes, as one choice: a choice of N, up to N, the top N, all of them, or nothing said. */
export type HowMany = "any" | "count" | "upTo" | "take" | "all";
/** "All" is the language's own `99` (`describeSelector` reads it as "all"). */
export const ALL = 99;

export function howMany(sel: Selector): HowMany {
  if (sel.take !== undefined) return "take";
  if (sel.count === undefined) return "any";
  if (sel.count === ALL && !sel.upTo) return "all";
  return sel.upTo ? "upTo" : "count";
}

export function setHowMany(sel: Selector, how: HowMany): Selector {
  const n = sel.count !== undefined && sel.count !== ALL ? sel.count : (sel.take ?? 1);
  const next: Selector = { ...sel };
  delete next.count;
  delete next.upTo;
  delete next.take;
  delete next.fromEnd;
  if (how === "count") next.count = n;
  if (how === "upTo") Object.assign(next, { count: n, upTo: true });
  if (how === "take") next.take = n;
  if (how === "all") next.count = ALL;
  return next;
}

/** A special target is a selector of its own (`[self]`); a selector's reading, safely. */
export const SELECTOR_SPECIALS = SPECIAL_TARGETS;
export const selectorReading = (sel: Selector | undefined): string => (sel ? safe(() => describeSelector(sel), "any card") : "");

// ── the card filter ─────────────────────────────────────────────────────────

const EMPTY = emptyFilter();
const SKILL_KINDS_PREFIX = (OP_SCHEMA.negateSkillsOfKind.fields.find((f) => f.name === "kind")!.type as { enum: readonly string[] }).enum;
const CARD_TYPES = ["LEADER", "BATTLE", "EXTRA", "UNISON"] as const satisfies readonly NonNullable<CardFilter["type"]>[];

/** The fields a filter says something with: the ones off their resting value. */
export function filterFieldsSet(f: CardFilter | undefined): (keyof CardFilter)[] {
  if (!f) return [];
  return (Object.keys(FILTER_FIELDS) as (keyof CardFilter)[]).filter((k) => JSON.stringify(f[k] ?? EMPTY[k]) !== JSON.stringify(EMPTY[k]));
}

/** The words a filter field picks from, by its `FilterFieldType`; `null` for a free list of names or a number. */
export function filterOptions(t: FilterFieldType): readonly string[] | null {
  switch (t) {
    case "colors":
      return COLORS;
    case "keywords":
      return optionsFor("keyword");
    case "cardType":
      return CARD_TYPES;
    case "skillKind":
      return SKILL_KINDS_PREFIX;
    case "strings":
    case "boolean":
    case "tri":
    case "number":
    case "powerRel":
      return null;
  }
}

/** A field just added to a filter: on, but saying nothing yet where its value has to be chosen. */
export function blankFilterValue(t: FilterFieldType): unknown {
  switch (t) {
    case "strings":
    case "colors":
    case "keywords":
      return [];
    case "cardType":
    case "skillKind":
      return null;
    case "boolean":
    case "tri":
      return true;
    case "number":
      return null;
    case "powerRel":
      return { of: "self", cmp: "<=" };
  }
}

/** One filter field set (or reset, with `undefined`). A filter left saying nothing is no filter at all. */
export function setFilterField(f: CardFilter | undefined, key: keyof CardFilter, value: unknown): CardFilter | undefined {
  const next = { ...(f ?? emptyFilter()), [key]: value === undefined ? EMPTY[key] : value } as CardFilter;
  return filterFieldsSet(next).length || f ? next : undefined;
}

export const filterReading = (f: CardFilter | undefined): string => (f ? safe(() => describeFilter(f), "any card") : "any card");

/**
 * One filter field as the words it adds to the phrase, read off `describeFilter`
 * on a filter holding only that field: "blue" stands before the noun, "with an
 * energy cost of 4 or less" after it. The noun itself is `type`'s (`nounWords`).
 */
export function filterFieldWords(key: keyof CardFilter, value: unknown): { words: string; after: boolean } {
  // A field still blank is placed where its words will stand once it is filled, so its chip does not jump.
  const resting = value == null || (Array.isArray(value) && !value.length) || value === false;
  const said = safe(() => describeFilter({ ...emptyFilter(), [key]: resting ? sampleFilterValue(FILTER_FIELDS[key]) : value } as CardFilter), String(key));
  if (resting) return { words: fieldWords(String(key)), after: said.startsWith("card ") };
  if (said === "card") return { words: fieldWords(String(key)), after: false };
  if (said.startsWith("card ")) return { words: said.slice(5), after: true };
  return { words: said.replace(/\s*card$/, ""), after: false };
}

/** The noun a filter's `type` makes: "cards", "Battle Cards", "non-Leader cards". */
export function nounWords(type: CardFilter["type"], notType: CardFilter["notType"] = null): string {
  const title = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();
  if (type) return `${title(type)} Cards`;
  if (notType) return `non-${title(notType)} cards`;
  return "cards";
}
export const NOUN_TYPES = CARD_TYPES;

// ── an amount ───────────────────────────────────────────────────────────────

/** The shapes an amount may take: a number, `$name`, `+ n`, and one per `EXPR_SCHEMA` row. */
export type AmountShape = "number" | "var" | "plus" | string;

export function amountShape(v: unknown): AmountShape {
  if (typeof v === "number" || !isObject(v)) return "number";
  if ("plus" in v) return "plus";
  if ("var" in v) return "var";
  // `sumOf` before `attr`: the two share an `attr` key, and the row with more fields is the more specific.
  const rows = [...EXPR_SCHEMA].sort((a, b) => (b.fields?.length ?? 1) - (a.fields?.length ?? 1));
  return rows.find((r) => r.key in v)?.key ?? "number";
}

export const exprSpec = (key: string): ExprSpec | undefined => EXPR_SCHEMA.find((e) => e.key === key);
export const exprFields = (spec: ExprSpec): string[] => spec.fields ?? [spec.key];

/** One argument of an expression call, empty. */
export function blankArg(arg: ExprArg, bound: readonly string[]): unknown {
  switch (arg) {
    case "selector":
      return {};
    case "var":
    case "ref":
      return { var: bound[bound.length - 1] ?? "t" };
    case "number":
      return 1;
    case "side":
      return "you";
    case "attr":
      return EXPR_ATTRS[0];
  }
}

export function blankAmount(shape: AmountShape, bound: readonly string[] = []): unknown {
  if (shape === "number") return 1;
  if (shape === "var") return { var: bound[bound.length - 1] ?? "t" };
  if (shape === "plus") return { plus: [1, 1] };
  const spec = exprSpec(shape);
  if (!spec) return 1;
  if (!spec.args.length) return { [spec.key]: true };
  const out: Loose = {};
  exprFields(spec).forEach((f, i) => (out[f] = blankArg(spec.args[i], bound)));
  return out;
}

export const AMOUNT_SHAPES: AmountShape[] = ["number", "var", "plus", ...EXPR_SCHEMA.map((e) => e.key)];

/** The shapes past a plain number, as an amount chip offers them: the language's own spelling, "…" where a selector goes. */
export const EXPR_SPECS_SHAPES: { key: AmountShape; label: string }[] = [
  { key: "var", label: "a number bound earlier ($)" },
  { key: "plus", label: "… plus N" },
  ...EXPR_SCHEMA.map((e) => ({ key: e.key, label: e.example.replace(/SELECTOR/g, "…") })),
];

// ── paths: read, write, insert, remove, move ────────────────────────────────

const clone = <T>(v: T): T => (Array.isArray(v) ? ([...v] as T) : isObject(v) ? ({ ...v } as T) : v);

/** The rule with the value at `path` replaced — `undefined` deletes an object key. The rest is shared, not copied. */
export function setAt(rule: Rule, path: RulePath, value: unknown): Rule {
  return setSteps(rule as unknown as Loose, parsePath(path), value) as unknown as Rule;
}

function setSteps(at: unknown, steps: readonly PathStep[], value: unknown): unknown {
  const [head, ...rest] = steps;
  const node = clone(at ?? (typeof head === "number" ? [] : {})) as Loose & unknown[];
  const next = rest.length ? setSteps((node as Loose)[head as string], rest, value) : value;
  if (next === undefined && !Array.isArray(node)) delete (node as Loose)[head as string];
  else (node as Loose)[head as string] = next;
  return node;
}

/** The list a path's last step indexes, and that index — or null when the path names a field, not a list item. */
function listOf(path: RulePath): { list: RulePath; index: number } | null {
  const steps = parsePath(path);
  const last = steps[steps.length - 1];
  if (typeof last !== "number") return null;
  const head = steps.slice(0, -1);
  return { list: head.map((s, i) => (typeof s === "number" ? `[${s}]` : i === 0 ? s : `.${s}`)).join(""), index: last };
}

/** Take out what a path names: a list item is spliced, a field is deleted. */
export function removeAt(rule: Rule, path: RulePath): Rule {
  const at = listOf(path);
  if (!at) return setAt(rule, path, undefined);
  const list = (resolvePath(rule, at.list) as unknown[]) ?? [];
  return setAt(rule, at.list, list.filter((_, i) => i !== at.index));
}

/** Put a value into the list at `list`, before `index` (at the end when it is past it). */
export function insertAt(rule: Rule, list: RulePath, index: number, value: unknown): Rule {
  const items = [...((resolvePath(rule, list) as unknown[]) ?? [])];
  items.splice(Math.min(index, items.length), 0, value);
  return setAt(rule, list, items);
}

/** One place earlier (-1) or later (+1) in its list; order is part of the meaning. */
export function moveAt(rule: Rule, path: RulePath, by: number): Rule {
  const at = listOf(path);
  if (!at) return rule;
  const items = [...((resolvePath(rule, at.list) as unknown[]) ?? [])];
  const to = at.index + by;
  if (to < 0 || to >= items.length) return rule;
  [items[at.index], items[to]] = [items[to], items[at.index]];
  return setAt(rule, at.list, items);
}

// ── a block as a sentence with blanks ───────────────────────────────────────

/** A piece of a row's sentence: words, a blank for a field, or words shown only once a field is set. */
export type Part = { text: string } | { field: string } | { when: string; parts: Part[] };

/**
 * A row's sentence template, cut into words and blanks — `"KO {target}"` is
 * the words "KO" and the blank `target`; `{until}` a blank; `{sumTo? whose
 * {sumAttr} …}` words shown only when `sumTo` is set. A row whose sentence is
 * a function (every condition, and the ops whose prose turns on how their
 * fields combine) has no template: `null`, and the block lists its blanks by
 * name instead.
 */
export function sentenceParts(sentence: unknown): Part[] | null {
  if (typeof sentence !== "string") return null;
  return cutTemplate(sentence);
}

function cutTemplate(s: string): Part[] {
  const out: Part[] = [];
  let text = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "{") {
      text += s[i];
      continue;
    }
    // The matching brace, counting nested ones (an optional group holds blanks of its own).
    let depth = 0;
    let j = i;
    for (; j < s.length; j++) {
      if (s[j] === "{") depth++;
      else if (s[j] === "}" && --depth === 0) break;
    }
    const inner = s.slice(i + 1, j);
    const opt = /^(\w+)\?\s?([\s\S]*)$/.exec(inner);
    const field = /^(\w+)(?::[\s\S]*)?$/.exec(inner);
    if (opt || field) {
      if (text) out.push({ text });
      text = "";
      out.push(opt ? { when: opt[1], parts: cutTemplate(opt[2]) } : { field: field![1] });
    } else text += s.slice(i, j + 1);
    i = j;
  }
  if (text) out.push({ text });
  return out;
}

/** The fields a template names as blanks (not the ones only inside a group shown when set). */
export const templateFields = (parts: readonly Part[] | null): string[] => (parts ?? []).flatMap((p) => ("field" in p ? [p.field] : []));

/** `atLeast` → "at least": a field's name, as words. */
export const fieldWords = (name: string): string => name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

// ── a block laid out as its own sentence ────────────────────────────────────
//
// What the owner reads on the screen is the row's own sentence — the words
// `describeScript`/`describeCond` say — with each field standing where its
// words stand. A template sentence says where outright. A sentence that is a
// function (every condition, and the ops whose prose turns on their fields)
// is asked instead: the reading is made once as the block stands and once with
// the field changed, and the words that differ are where the field is. Nothing
// here knows a row by name; a row added to the schema lays itself out.

/** A piece of a laid-out block: words, a blank for a field, or the `atLeast`/`atMost` pair as one comparison. */
export type LayoutPiece = { text: string } | { field: string } | { bound: true };

export interface Layout {
  pieces: LayoutPiece[];
  /** Fields set or settable that the sentence does not show: behind the block's "More…". */
  more: string[];
  /** Fields that hold blocks of their own (`cond`, `conds`, `ops`, `modes`), shown indented under the sentence. */
  nested: string[];
  /** The sentence could not be read (a half-built node): the pieces are the row's key and its blanks. */
  fallback: boolean;
  /** Where each placed field's words are in `words` (a function sentence only), for its choices' own words. */
  spans?: Record<string, { i: number; j: number }>;
  words?: string[];
}

const NESTED_TYPES = new Set<string>(["cond", "conds", "ops", "modes"]);
const isNestedType = (t: FieldType): boolean => typeof t === "string" && NESTED_TYPES.has(t);
const toks = (s: string): string[] => s.split(/\s+/).filter(Boolean);

/** A value of the field's type that reads differently from `v` — two of them, so a coincidence in one cannot hide the field. */
function altValues(f: OpField, v: unknown): unknown[] {
  const t = f.type;
  if (typeof t === "object") {
    if ("enum" in t) return t.enum.filter((x) => x !== v).slice(0, 2);
    const opts = t.list === "string" ? ["Zz", "Qq"] : [...t.list.enum];
    return Array.isArray(v) && v.length ? [[], [opts[opts.length - 1]]] : [[opts[0]], [opts[opts.length - 1]]];
  }
  switch (t) {
    case "side":
      return SIDE_ALTS.filter((s) => s !== v).slice(0, 2);
    case "area":
      return ["hand", "deck", "life"].filter((a) => a !== v).slice(0, 2);
    case "duration":
      return ["game", "turn", "battle"].filter((d) => d !== v).slice(0, 2);
    case "number":
    case "amount":
      return typeof v === "number" ? [v + 7, v + 11] : [7, 11];
    case "boolean":
      return [!v];
    case "string":
      return [`${typeof v === "string" ? v : ""}Zz`];
    case "keyword":
      return [{ name: (v as { name?: string } | undefined)?.name === "Barrier" ? "Blocker" : "Barrier" }];
    case "selector":
      return [{}, { side: "opponent", area: "life", count: 7 }];
    case "ref":
      return isObject(v) && "var" in v ? [{ sel: { special: "self" } }, { sel: { special: "leader" } }] : [{ var: "zz" }, { sel: { special: "self" } }];
    case "filter":
      return [
        { ...emptyFilter(), colors: ["Green"], costMax: 7 },
        { ...emptyFilter(), type: "LEADER" },
      ];
    default:
      return [];
  }
}
const SIDE_ALTS = ["you", "opponent", "both"];

/** Where two readings differ: the range in `a`, after the words they share at both ends. */
function diffSpan(a: string[], b: string[]): { i: number; j: number } | null {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  if (p === a.length && p === b.length) return null;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return { i: p, j: a.length - s };
}

type Describe = (node: Loose) => string;
const tryWords = (describe: Describe, node: Loose): string[] | null => {
  try {
    return toks(describe(node));
  } catch {
    return null;
  }
};

/** The node with every required field that is still empty filled with a sample, so its sentence can be said at all. */
function filledFor(node: Loose, fields: readonly OpField[]): Loose {
  const out: Loose = { ...node };
  for (const f of fields) if (f.required && out[f.name] === undefined) out[f.name] = sampleFor(f.type);
  return out;
}

/** The words a field stands in, in the reading of `node`: the union of where it differs from two other values. */
export function fieldSpan(node: Loose, fields: readonly OpField[], field: string, describe: Describe): { i: number; j: number; words: string[] } | null {
  const f = fields.find((x) => x.name === field);
  if (!f) return null;
  const filled = filledFor(node, fields);
  const base = tryWords(describe, filled);
  if (!base) return null;
  let span: { i: number; j: number } | null = null;
  for (const alt of altValues(f, filled[field])) {
    const other = tryWords(describe, { ...filled, [field]: alt });
    const d = other && diffSpan(base, other);
    if (d) span = span ? { i: Math.min(span.i, d.i), j: Math.max(span.j, d.j) } : d;
  }
  return span ? { ...span, words: base } : null;
}

/** The two bounds a counting row puts on a number, when it has both: laid out as one comparison. */
const BOUND_FIELDS = ["atLeast", "atMost"] as const;
export const hasBound = (fields: readonly OpField[]): boolean => BOUND_FIELDS.every((b) => fields.some((f) => f.name === b && f.type === "number"));

/** A row's sentence, with each field where its words are. */
export function layoutOf(node: Loose, fields: readonly OpField[], describe: Describe, template: unknown = null, name?: string): Layout {
  const shown = shownFields(fields, node);
  const nested = shown.filter((f) => isNestedType(f.type)).map((f) => f.name);
  const flat = shown.filter((f) => !isNestedType(f.type));
  const keyName = (name ?? node.op ?? node.kind ?? "") as string;
  const blank = (f: OpField) => f.required && node[f.name] === undefined;
  // A required blank the sentence has no words for still stands in it, at the end — except a binding
  // name, which is made fresh when the block is and waits behind "More…" unless it has been emptied.
  const stays = (f: OpField) => blank(f) || (!!f.required && !(f.name === BINDING_FIELD && f.type === "string"));

  // A template says where every blank goes.
  const parts = sentenceParts(template);
  if (parts) {
    const pieces: LayoutPiece[] = [];
    const placed = new Set<string>();
    const walk = (ps: Part[]) => {
      for (const p of ps) {
        if ("text" in p) {
          if (p.text.trim()) pieces.push({ text: p.text.trim() });
        } else if ("field" in p) {
          const f = flat.find((x) => x.name === p.field);
          if (f && !placed.has(f.name)) {
            pieces.push({ field: f.name });
            placed.add(f.name);
          }
        } else if (node[p.when] !== undefined) walk(p.parts);
      }
    };
    walk(parts);
    // A punctuation-only piece left behind by a nested field ("if:") reads as nothing.
    const clean = pieces.filter((p) => !("text" in p) || /[\w≪<{[]/.test(p.text));
    for (const f of flat) if (!placed.has(f.name) && stays(f)) clean.push({ field: f.name });
    const more = flat.filter((f) => !placed.has(f.name) && !stays(f)).map((f) => f.name);
    return { pieces: clean.length ? clean : [{ text: keyName }], more, nested, fallback: false };
  }

  // A node that holds blocks of its own is said by them: its sentence is its key, its own blanks after it.
  if (nested.length) {
    const inline = flat.filter((f) => f.required || node[f.name] !== undefined);
    return { pieces: [{ text: fieldWords(keyName) }, ...inline.map((f) => ({ field: f.name }))], more: flat.filter((f) => !inline.includes(f)).map((f) => f.name), nested, fallback: false };
  }

  const filled = filledFor(node, fields);
  const base = tryWords(describe, filled);
  if (!base) {
    const inline = flat.filter((f) => f.required || node[f.name] !== undefined);
    return { pieces: [{ text: keyName }, ...inline.map((f) => ({ field: f.name }))], more: flat.filter((f) => !inline.includes(f)).map((f) => f.name), nested, fallback: true };
  }

  const spots: { piece: LayoutPiece; i: number; j: number }[] = [];
  const overlaps = (i: number, j: number) => spots.some((s) => (i < s.j && j > s.i) || (i === j && i > s.i && i < s.j) || (s.i === s.j && s.i > i && s.i < j));
  const bounded = hasBound(flat);
  if (bounded) {
    // Set, the bound's words are where turning the comparison round and changing the number differ
    // ("is [4 or less]"); unset, where giving it one would put them ("there are [any] cards").
    const lo = node.atLeast as number | undefined;
    const hi = node.atMost as number | undefined;
    const alts: Loose[] =
      lo === undefined && hi === undefined
        ? [{ ...filled, atLeast: 1 }]
        : [
            { ...filled, atLeast: hi, atMost: lo },
            { ...filled, atLeast: lo === undefined ? undefined : lo + 7, atMost: hi === undefined ? undefined : hi + 7 },
          ];
    let d: { i: number; j: number } | null = null;
    for (const alt of alts) {
      const other = tryWords(describe, alt);
      const s = other && diffSpan(base, other);
      if (s) d = d ? { i: Math.min(d.i, s.i), j: Math.max(d.j, s.j) } : s;
    }
    if (d) spots.push({ piece: { bound: true }, i: d.i, j: d.j });
  }
  const spans: Record<string, { i: number; j: number }> = {};
  const unplaced: OpField[] = [];
  // Fields whose words are already in the sentence are placed first; a field that only adds words
  // then takes a neighbouring word that is still free.
  const rawSpans = new Map(flat.map((f) => [f.name, fieldSpan(node, fields, f.name, describe)] as const));
  const order = [...flat].sort((a, b) => Number(isZero(rawSpans.get(a.name))) - Number(isZero(rawSpans.get(b.name))));
  for (const f of order) {
    if (bounded && (BOUND_FIELDS as readonly string[]).includes(f.name)) continue;
    const raw = rawSpans.get(f.name);
    let span = raw && { i: raw.i, j: raw.j };
    // A field whose words are only *added* when it changes ("your turn" → "your opponent's turn")
    // takes the word beside the gap, so its chip has words of its own to show.
    if (span && span.i === span.j) {
      if (span.i > 0 && !overlaps(span.i - 1, span.i)) span = { i: span.i - 1, j: span.i };
      else if (span.i < base.length && !overlaps(span.i, span.i + 1)) span = { i: span.i, j: span.i + 1 };
    }
    // A selector says its own noun, its "in" and its zone: the words just before it that are part of
    // that ("cards in") belong to the selector's chips, not to the sentence around them.
    if (span && controlFor(f.type) === "selector") while (span.i > 0 && SELECTOR_OWN.has(base[span.i - 1].toLowerCase()) && !overlaps(span.i - 1, span.i)) span = { i: span.i - 1, j: span.j };
    const inSentence = !!span && span.j > span.i;
    if (span && (inSentence || blank(f)) && !overlaps(span.i, span.j)) {
      spots.push({ piece: { field: f.name }, i: span.i, j: span.j });
      spans[f.name] = span;
    } else unplaced.push(f);
  }
  spots.sort((a, b) => a.i - b.i || a.j - b.j);
  const pieces: LayoutPiece[] = [];
  let at = 0;
  for (const s of spots) {
    if (s.i > at) pieces.push({ text: base.slice(at, s.i).join(" ") });
    pieces.push(s.piece);
    at = Math.max(at, s.j);
  }
  if (at < base.length) pieces.push({ text: base.slice(at).join(" ") });
  for (const f of unplaced) if (stays(f)) pieces.push({ field: f.name });
  return { pieces: pieces.length ? pieces : [{ text: name ?? keyName }], more: unplaced.filter((f) => !stays(f)).map((f) => f.name), nested, fallback: false, spans, words: base };
}
/** The words a selector's own chips say, so they are not said twice by the sentence around it. */
const SELECTOR_OWN = new Set(["in", "cards", "card", "of"]);
const isZero = (s: { i: number; j: number } | null | undefined): boolean => !s || s.i === s.j;

/**
 * What each value of a closed-list field reads as in this sentence — "your" and
 * "their" for a condition's side, "draw" and "opponent draws" for a step's —
 * so a blank's choices are the sentence's own words. A value whose words
 * cannot be told apart reads as itself. `layout` is the block's own, whose
 * span for the field is used when it has one.
 */
export function optionWords(node: Loose, fields: readonly OpField[], field: string, options: readonly string[], describe: Describe, write: (o: string) => unknown = (o) => o, layout?: Layout): Record<string, string> {
  const out: Record<string, string> = {};
  const filled = filledFor(node, fields);
  const own = layout?.spans?.[field];
  const raw = own ? { ...own, words: layout!.words! } : fieldSpan(node, fields, field, describe);
  let span = raw;
  if (span && span.i === span.j && span.i > 0) span = { ...span, i: span.i - 1 };
  for (const o of options) {
    out[o] = o;
    if (!span || span.j === span.i) continue;
    const words = tryWords(describe, { ...filled, [field]: write(o) });
    if (!words) continue;
    const tail = span.words.length - span.j;
    const said = words.slice(span.i, words.length - tail).join(" ");
    if (said) out[o] = said;
  }
  return out;
}

/** The describer for a node: a step's sentence, or a condition's. */
export const describeNode = (keyField: "op" | "kind"): Describe => (n) => (keyField === "op" ? describeScript([n as unknown as Op]) : describeCond(n as unknown as Cond));
/** The describer for a price item: the price with only that item in it. */
export const describeCostItem = (key: CostSyntax): Describe => (values) => costSentence(costFrom([{ key, values }])) ?? "";

// ── the zone words, and the bound ───────────────────────────────────────────

/** The game's words for a zone, said as the viewer's own ("your Drop Area"), without the "your": a chip of its own beside the side's. */
export function areaWords(area: string): string {
  try {
    const w = dbsWords().area as Record<string, string>;
    return (w[area] ?? area).replace(/^your\s+/i, "");
  } catch {
    return area;
  }
}

/** Whose zone, as the sentence says it. */
export const SIDE_WORDS: Record<string, string> = { you: "your", opponent: "your opponent's", both: "either player's" };

/** The comparison a bound pair says: "or more", "or fewer", "exactly" or nothing at all. */
export type BoundCmp = "any" | "atLeast" | "atMost" | "exactly";
export function boundOf(node: Loose): { cmp: BoundCmp; n: number | null } {
  const lo = node.atLeast as number | undefined;
  const hi = node.atMost as number | undefined;
  if (lo !== undefined && hi !== undefined) return { cmp: lo === hi ? "exactly" : "atLeast", n: lo };
  if (lo !== undefined) return { cmp: "atLeast", n: lo };
  if (hi !== undefined) return { cmp: "atMost", n: hi };
  return { cmp: "any", n: null };
}
/** The pair written back: a comparison and a number. */
export function boundWrite(cmp: BoundCmp, n: number | null): { atLeast?: number; atMost?: number } {
  const v = n ?? 1;
  if (cmp === "atLeast") return { atLeast: v };
  if (cmp === "atMost") return { atMost: v };
  if (cmp === "exactly") return { atLeast: v, atMost: v };
  return {};
}

// ── the names bound before a place ──────────────────────────────────────────

/** The names a program's steps bind, nested programs included, in order. */
function bindsIn(ops: unknown): string[] {
  if (!Array.isArray(ops)) return [];
  const out: string[] = [];
  for (const op of ops) {
    if (!isObject(op) || typeof op.op !== "string") continue;
    const spec = OP_SCHEMA[op.op as Op["op"]];
    if (!spec) continue;
    for (const f of spec.fields) {
      const v = op[f.name];
      if (f.name === BINDING_FIELD && f.type === "string" && typeof v === "string" && v) out.push(v);
      if (f.type === "ops") out.push(...bindsIn(v));
      if (f.type === "modes" && Array.isArray(v)) for (const m of v) out.push(...bindsIn((m as { ops?: unknown }).ops));
    }
  }
  return out;
}

/**
 * The names a `ref` blank at `path` may point at: what the price's program
 * bound, then every step before the place in its own list and in each list
 * enclosing it. A step's own binding is not offered to itself.
 */
export function boundBefore(rule: Rule, path: RulePath): string[] {
  const out = new Set<string>(bindsIn(rule.cost?.program));
  const steps = parsePath(path);
  let at: unknown = rule;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (typeof s === "number" && Array.isArray(at)) for (const n of bindsIn(at.slice(0, s))) out.add(n);
    at = isObject(at) || Array.isArray(at) ? (at as Loose)[s as string] : undefined;
  }
  return [...out];
}

/** Every name the rule binds anywhere — a fresh one has to avoid all of them. */
export const allBound = (rule: Rule): string[] => [...bindsIn(rule.cost?.program), ...bindsIn(rule.ops)];

// ── readings ────────────────────────────────────────────────────────────────

const programOf = (cond: Cond | null, ops: Op[]): Op[] => (cond ? [{ op: "if", cond, then: ops }] : ops);

export const opReading = (op: Op, permanent = false): string => safe(() => describeScript([op], { permanent }), "not filled in yet");
export const condReading = (cond: Cond): string => safe(() => describeCond(cond), "not filled in yet");
export const costItemReading = (item: Pick<CostItem, "key" | "values">): string => safe(() => costSentence(costOfOne(item)) ?? "", "not filled in yet");
export const triggerReading = (t: string): string => words().words[`trigger:${t}`] ?? describeTrigger([t]);

/** The WHEN line for a rule: its moments, or what the tag says when it names none. */
export function whenReading(rule: Pick<Rule, "kind" | "trigger">): string {
  const said = describeTrigger(rule.trigger);
  if (said) return said;
  if (rule.kind === "permanent") return "while this card is where the skill is valid";
  if (rule.kind.startsWith("activate")) return "when you activate it";
  if (rule.kind.startsWith("counter")) return "at the counter timing the tag names";
  return "no moment named";
}

/** The whole rule's "The engine will …" sentence. */
export function ruleReading(rule: Rule): string {
  const parts = [whenReading(rule)];
  const price = safe(() => costSentence(rule.cost) ?? "", "");
  if (price) parts.push(`pay ${price}`);
  parts.push(safe(() => describeScript(programOf(rule.cond, rule.ops), { permanent: rule.kind === "permanent" }), "") || "nothing");
  return parts.join(" — ");
}

// ── problems, each at its block ─────────────────────────────────────────────

export interface Problem {
  path: RulePath;
  message: string;
  /** A required blank still empty: the "fill this" state, rather than a wrong value. */
  blank?: boolean;
}

const condHolds = (c: unknown): boolean => validateProgram([{ op: "if", cond: c as Cond, then: [] }], 0, true);

/** Does this one field hold, with every other required field filled with a value known to hold? */
function fieldHolds(keyField: "op" | "kind", key: string, fields: readonly OpField[], f: OpField, v: unknown): boolean {
  const probe = minimalInstance(key, keyField, { fields: [...fields] });
  probe[f.name] = v;
  return keyField === "op" ? validateProgram([probe], 0, true) : condHolds(probe);
}

const NESTED = new Set<FieldType>(["cond", "conds", "ops", "modes"]);

function nodeProblems(node: unknown, path: RulePath, keyField: "op" | "kind", out: Problem[]): void {
  if (!isObject(node)) {
    out.push({ path, message: "this is not a block" });
    return;
  }
  const key = node[keyField];
  const spec = keyField === "op" ? OP_SCHEMA[key as Op["op"]] : COND_SCHEMA[key as Cond["kind"]];
  if (!spec) {
    out.push({ path, message: `the language has no ${keyField === "op" ? "step" : "condition"} called ${JSON.stringify(key)}` });
    return;
  }
  for (const f of spec.fields) {
    const v = node[f.name];
    const at = childPath(path, f.name);
    if (v === undefined) {
      if (f.required) out.push({ path: at, message: "fill this", blank: true });
      continue;
    }
    if (v === null) {
      if (!f.nullable) out.push({ path: at, message: "fill this", blank: true });
      continue;
    }
    if (f.type === "cond") nodeProblems(v, at, "kind", out);
    else if (f.type === "conds") {
      if (!Array.isArray(v) || !v.length) out.push({ path: at, message: "add a condition", blank: true });
      else v.forEach((c, i) => nodeProblems(c, childPath(at, i), "kind", out));
    } else if (f.type === "ops") opsProblems(v, at, out);
    else if (f.type === "modes") {
      if (!Array.isArray(v) || !v.length) out.push({ path: at, message: "add an option", blank: true });
      else v.forEach((m, i) => opsProblems((m as { ops?: unknown })?.ops, childPath(at, i, "ops"), out));
    } else if (!NESTED.has(f.type) && !fieldHolds(keyField, key as string, spec.fields, f, v)) {
      out.push({ path: at, message: v === "" || (Array.isArray(v) && !v.length) ? "fill this" : "the engine cannot read this value", blank: v === "" || (Array.isArray(v) && !v.length) });
    }
  }
}

function opsProblems(ops: unknown, path: RulePath, out: Problem[]): void {
  if (!Array.isArray(ops)) {
    out.push({ path, message: "a list of steps goes here" });
    return;
  }
  ops.forEach((op, i) => nodeProblems(op, childPath(path, i), "op", out));
}

/**
 * Everything wrong with a rule, each problem at the path of the block (or the
 * blank) it is about. Read on every change, so an error shows where it is and
 * not after Save. The fine walk is the schema's own fields; `validateRule` is
 * then asked about the whole, and anything it refuses that the walk did not
 * place lands on its clause, so nothing invalid can look clean.
 */
export function problemsOf(rule: Rule, kind: string): Problem[] {
  const out: Problem[] = [];
  const moments = whenMoments();
  rule.trigger.forEach((t, i) => {
    if (!moments.includes(t)) out.push({ path: `trigger[${i}]`, message: `the engine knows no moment called ${JSON.stringify(t)}` });
    else if (rule.trigger.indexOf(t) !== i) out.push({ path: `trigger[${i}]`, message: "this moment is named twice" });
  });
  for (const item of costItems(rule.cost)) {
    const spec = COST_ITEM_SPECS[item.key];
    const missing = spec.fields.some((f) => {
      const v = item.values[f.name];
      return f.required && f.type !== "ops" && (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length));
    });
    if (missing) out.push({ path: item.path, message: "fill this", blank: true });
    else if (item.key === "IF") nodeProblems(item.values.condition, item.path, "kind", out);
    else if (item.key === "DO") opsProblems(item.values.program, item.path, out);
    else {
      const alone = validateRule({ kind, trigger: [], cost: costOfOne(item), cond: null, ops: [] }, kind);
      if (alone && !out.some((p) => p.path === item.path)) out.push({ path: item.path, message: alone.message });
    }
  }
  if (rule.cond) nodeProblems(rule.cond, "cond", "kind", out);
  opsProblems(rule.ops, "ops", out);
  // X read before anything binds it is a fault of the step, not of the clause.
  const xBound = !!rule.cost?.x || (Array.isArray(rule.cost?.program) && rule.cost.program.some((o) => o.op === "choose" && o.bindX === true));
  // Each step is asked alone, with X bound only if the price or a choice before it bound one: a step
  // valid once X is bound and invalid before is reading an X nobody bound.
  let bound = xBound;
  rule.ops.forEach((op, i) => {
    if (!bound && !validateProgram([op], 0, false) && validateProgram([op], 0, true))
      out.push({ path: `ops[${i}]`, message: "this step reads X, and nothing before it binds X — the price has to charge an X, or a choice has to bind one" });
    if (op.op === "choose" && op.bindX === true) bound = true;
  });
  const whole = validateRule(rule, kind);
  if (whole) {
    const clause: RuleClause = whole.field === "rule" || whole.field === "kind" ? "trigger" : whole.field;
    if (!out.some((p) => clauseOf(p.path) === clause)) out.push({ path: clause, message: whole.message });
  }
  return out;
}

/** The problems at a path or under it. */
export const problemsUnder = (problems: readonly Problem[], path: RulePath): Problem[] => problems.filter((p) => p.path === path || p.path.startsWith(`${path}.`) || p.path.startsWith(`${path}[`));

// ── the rule as blocks, and back ────────────────────────────────────────────

/** One blank of a block: a field of its row, where it lives, and what is in it. Nested blanks hold blocks of their own. */
export interface Slot {
  name: string;
  control: Control;
  path: RulePath;
  value?: unknown;
  empty: boolean;
  /** `cond`, `conds`, `ops`: the blocks inside. */
  blocks?: Block[];
  /** `modes`: each option's label and the blocks of its program. */
  modes?: { label: string; blocks: Block[] }[];
}

export interface Block {
  path: RulePath;
  clause: RuleClause;
  what: "trigger" | "cost" | "cond" | "op";
  key: string;
  slots: Slot[];
  /** Keys on the node that are no field of its row — kept, so a round trip through blocks loses nothing. */
  extra?: Loose;
}

export interface RuleBlocks {
  kind: string;
  trigger: Block[];
  /** `null` is a rule with no COST clause; `[]` a COST clause with nothing in it. */
  cost: Block[] | null;
  cond: Block | null;
  ops: Block[];
}

function nodeBlock(node: Loose, path: RulePath, keyField: "op" | "kind"): Block {
  const key = node[keyField] as string;
  const spec = keyField === "op" ? OP_SCHEMA[key as Op["op"]] : COND_SCHEMA[key as Cond["kind"]];
  const names = new Set(spec.fields.map((f) => f.name));
  const extra = Object.fromEntries(Object.entries(node).filter(([k]) => k !== keyField && !names.has(k)));
  return {
    path,
    clause: clauseOf(path),
    what: keyField === "op" ? "op" : "cond",
    key,
    slots: spec.fields.map((f) => slotOf(f, node[f.name], childPath(path, f.name))),
    ...(Object.keys(extra).length ? { extra } : {}),
  };
}

function slotOf(f: OpField, v: unknown, path: RulePath): Slot {
  const control = controlFor(f.type);
  const base = { name: f.name, control, path, empty: v === undefined };
  if (v === undefined) return base;
  if (control === "cond" && isObject(v)) return { ...base, blocks: [nodeBlock(v, path, "kind")] };
  if (control === "conds" && Array.isArray(v)) return { ...base, blocks: v.map((c, i) => nodeBlock(c as Loose, childPath(path, i), "kind")) };
  if (control === "ops" && Array.isArray(v)) return { ...base, blocks: v.map((o, i) => nodeBlock(o as Loose, childPath(path, i), "op")) };
  if (control === "modes" && Array.isArray(v))
    return { ...base, modes: v.map((m, i) => ({ label: (m as { label: string }).label, blocks: ((m as { ops: Op[] }).ops ?? []).map((o, j) => nodeBlock(o as unknown as Loose, childPath(path, i, "ops", j), "op")) })) };
  return { ...base, value: v };
}

function costBlock(item: CostItem): Block {
  const spec = COST_ITEM_SPECS[item.key];
  return {
    path: item.path,
    clause: "cost",
    what: "cost",
    key: item.key,
    slots: spec.fields.map((f) => {
      const v = item.values[f.name];
      // A nested condition or program of the price lives at the item's own path, not under a field of it.
      return f.type === "cond" || f.type === "ops" ? { ...slotOf(f, v, item.path), name: f.name } : slotOf(f, v, `${item.path}`);
    }),
  };
}

/** A rule as its four clauses of blocks. */
export function blocksOf(rule: Rule): RuleBlocks {
  return {
    kind: rule.kind,
    trigger: rule.trigger.map((t, i) => ({ path: `trigger[${i}]`, clause: "trigger" as const, what: "trigger" as const, key: t, slots: [] })),
    cost: rule.cost ? costItems(rule.cost).map(costBlock) : null,
    cond: rule.cond ? nodeBlock(rule.cond as unknown as Loose, "cond", "kind") : null,
    ops: rule.ops.map((op, i) => nodeBlock(op as unknown as Loose, `ops[${i}]`, "op")),
  };
}

function slotValue(s: Slot): unknown {
  if (s.empty) return undefined;
  if (s.control === "cond") return s.blocks?.[0] ? nodeOf(s.blocks[0]) : undefined;
  if (s.control === "conds" || s.control === "ops") return (s.blocks ?? []).map(nodeOf);
  if (s.control === "modes") return (s.modes ?? []).map((m) => ({ label: m.label, ops: m.blocks.map(nodeOf) }));
  return s.value;
}

function nodeOf(b: Block): unknown {
  const out: Loose = { [b.what === "op" ? "op" : "kind"]: b.key, ...(b.extra ?? {}) };
  for (const s of b.slots) {
    const v = slotValue(s);
    if (v !== undefined) out[s.name] = v;
  }
  return out;
}

/** …and the blocks back as the rule they show. */
export function ruleFromBlocks(b: RuleBlocks): Rule {
  return {
    kind: b.kind,
    trigger: b.trigger.map((t) => t.key) as Rule["trigger"],
    cost: b.cost ? costFrom(b.cost.map((blk) => ({ key: blk.key as CostSyntax, values: Object.fromEntries(blk.slots.map((s) => [s.name, slotValue(s)]).filter(([, v]) => v !== undefined)) }))) : null,
    cond: b.cond ? (nodeOf(b.cond) as Cond) : null,
    ops: b.ops.map(nodeOf) as Op[],
  };
}

/** The four clauses, in the order a rule reads, with the word each is printed under. */
export const CLAUSE_WORDS: Record<RuleClause, string> = { trigger: "WHEN", cost: "COST", cond: "IF", ops: "THEN" };
export { RULE_CLAUSES };

/**
 * Where the builder opens: the block a link asked for (`?focus=ops[1]`) when it
 * is a real path, else — for a card the engine cannot fully read — the clause
 * the unread words belong to: a condition when they open like one and the rule
 * has none yet, the steps otherwise. A path is never trusted unparsed.
 */
export function openingFocus(rule: Rule, asked: string | null, unread: readonly string[]): RulePath | null {
  if (asked) {
    try {
      clauseOf(asked);
      return asked;
    } catch {
      // not a path into a clause: fall through to the card's own clue
    }
  }
  if (!unread.length) return null;
  return /^\s*(if|as long as|while)\b/i.test(unread[0]) && !rule.cond ? "cond" : "ops";
}

/** The clause a path is in, or null when it is not a path into one. */
export const clauseOfPath = (path: RulePath | undefined): RuleClause | null => {
  if (!path) return null;
  try {
    return clauseOf(path);
  } catch {
    return null;
  }
};
