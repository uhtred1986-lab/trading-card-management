/**
 * What the rules language is *about*: a rule, and the two shapes the effect
 * language never described in a table of their own — a selector and a card
 * filter.
 *
 * `OP_SCHEMA` and `COND_SCHEMA` (`engine/script.ts`) already say what a step
 * and a condition are made of, and the printer and the parser read those rows
 * rather than repeating them. A selector and a filter had no such row: they
 * were an interface each and a hand-written describer, so a field added to
 * either would print as nothing and parse back as absent — losing a measure
 * silently, which is the one thing a round-trip promise cannot allow. The two
 * tables below close that, and the `never` checks under them make a new field
 * fail `npm run typecheck` until it is described.
 */
import type { CardFilter } from "../engine/filters";
import type { Cond, CostRecord, Op, Selector } from "../engine/script";
import type { Trigger } from "../engine/types";

/**
 * One `card_rules` row as the language says it: WHEN / COST / IF / THEN.
 *
 * `kind` is the printed skill tag and is read-only — it comes off the card and
 * nothing on the workbench may change it (the plan's "explicitly out"). It is
 * still part of the rule so that WHEN prints in full and re-parses to the same
 * object.
 */
export interface Rule {
  kind: string;
  trigger: Trigger[];
  cost: CostRecord | null;
  /** The hoisted condition: one `if` with no `else`, lifted out of the steps. */
  cond: Cond | null;
  ops: Op[];
}

/**
 * A parse failure, as the editor shows it. First error wins — a rule is short
 * and a list of five complaints about one missing bracket is noise (the plan's
 * "explicitly out" names multi-error reporting).
 */
export interface LangError {
  line: number;
  col: number;
  /** The clause the error is in: "WHEN", "COST", "IF", "THEN". */
  clause: string;
  message: string;
  /** What could have stood there, when the parser knows. */
  expected: string[];
  /** The source line, so the editor can point at the column. */
  lineText: string;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: LangError };

// ── the selector, as a table ────────────────────────────────────────────────

/**
 * How each field of a `Selector` is written. A selector is printed
 * *positionally* rather than as `field: value` pairs — "1 blue card IN
 * opponent.battle rest" is the shape the cards are read in — so this table
 * says which part each field is, and the printer emits the parts in this
 * order. The parser accepts them in any order, because a person typing a flag
 * after the area is not making a mistake.
 */
export type SelectorPart = "special" | "fromVar" | "count" | "take" | "filter" | "places" | "flag";

export const SELECTOR_FIELDS: Record<keyof Selector, SelectorPart> = {
  special: "special",
  fromVar: "fromVar",
  count: "count",
  upTo: "count",
  take: "take",
  fromEnd: "take",
  filter: "filter",
  side: "places",
  area: "places",
  areas: "places",
  mode: "flag",
  ignoreBarrier: "flag",
  notSelf: "flag",
};
type SelectorFieldMissing = Exclude<keyof Selector, keyof typeof SELECTOR_FIELDS>;
const _everySelectorFieldWritten: SelectorFieldMissing extends never ? true : never = true;
void _everySelectorFieldWritten;

// ── the card filter, as a table ─────────────────────────────────────────────

/**
 * A filter's fields, for the predicate form. The printed form ("blue ≪Saiyan≫
 * card with an energy cost of 3 or less") is tried first and is what a person
 * reads; this is the fallback for the filters whose words `parseFilter` does
 * not read back exactly, and the round-trip promise rests on it.
 */
export type FilterFieldType = "strings" | "colors" | "keywords" | "cardType" | "skillKind" | "boolean" | "tri" | "number" | "powerRel";

export const FILTER_FIELDS: Record<keyof CardFilter, FilterFieldType> = {
  colors: "colors",
  notColors: "colors",
  monoColor: "boolean",
  multiColor: "boolean",
  characters: "strings",
  notCharacters: "strings",
  charactersIncluding: "strings",
  notCharactersIncluding: "strings",
  traits: "strings",
  notTraits: "strings",
  names: "strings",
  notNames: "strings",
  namesIncluding: "strings",
  notNamesIncluding: "strings",
  keywords: "keywords",
  notKeywords: "keywords",
  type: "cardType",
  notType: "cardType",
  skillKind: "skillKind",
  unreadable: "boolean",
  noKeywords: "boolean",
  faceUp: "boolean",
  token: "boolean",
  notToken: "boolean",
  costMin: "number",
  costMax: "number",
  powerMin: "number",
  powerMax: "number",
  powerRel: "powerRel",
  z: "tri",
};
type FilterFieldMissing = Exclude<keyof CardFilter, keyof typeof FILTER_FIELDS>;
const _everyFilterFieldWritten: FilterFieldMissing extends never ? true : never = true;
void _everyFilterFieldWritten;

export const FILTER_FIELD_NAMES = Object.keys(FILTER_FIELDS) as (keyof CardFilter)[];

// ── expressions ─────────────────────────────────────────────────────────────

/**
 * The `Amount` union as words. Named here so the grammar has one place that
 * lists what a number in this language may be; Stage 2 turns it into a proper
 * expression (`X` bound across cost and effect, `attr(REF, name)`), and the
 * parser will grow cases rather than change shape.
 */
export const EXPR_SCHEMA = {
  number: "5000",
  var: "$n",
  count: "count(SELECTOR)",
  countTimes: "count(SELECTOR) * 5000",
  sumPower: "sumPower($rested)",
  handUpTo: "handUpTo(4)",
} as const;

/** The words the language reserves. A field or a variable may not be one of them. */
export const RESERVED = new Set(["WHEN", "COST", "IF", "THEN", "DO", "TEXT", "AND", "OR", "NOT", "IN", "FROM", "ANY", "TOP", "BOTTOM", "UP", "TO", "MINUS", "NULL", "TRUE", "FALSE", "ALL"]);
