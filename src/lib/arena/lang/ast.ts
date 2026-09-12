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
import type { Amount, Cond, CostRecord, FieldType, Op, OpField, Selector, Side } from "../engine/script";
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
  underHost: "places",
  count: "count",
  upTo: "count",
  take: "take",
  fromEnd: "take",
  filter: "filter",
  side: "places",
  area: "places",
  areas: "places",
  mode: "flag",
  hidden: "flag",
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
  markers: "markers(SELECTOR)",
  markersTimes: "markers(SELECTOR) * 5000",
} as const;

/**
 * The words the language reserves. A field or a variable may not be one of
 * them. The second line is the definition grammar's own: `DEFINE`, the eleven
 * kind names, and the words that introduce a declaration's clauses.
 */
export const RESERVED = new Set([
  "WHEN", "COST", "IF", "THEN", "DO", "TEXT", "AND", "OR", "NOT", "IN", "FROM", "UNDER", "ANY", "TOP", "BOTTOM", "UP", "TO", "MINUS", "NULL", "TRUE", "FALSE", "ALL",
  "DEFINE", "GAME", "ATTRIBUTE", "ZONE", "PHASE", "STEP", "ACTION", "TRIGGER", "KEYWORD", "WIN", "OP", "HOOK", "ON", "WHERE", "BIND", "FOR", "REFUSE", "TAKES",
]);

// ── definitions ─────────────────────────────────────────────────────────────

/**
 * The second of the language's three uses (§1 of `docs/arena-rules-language.md`):
 * a *game's* definition, written as declarations in `rulesets/*.rules` rather
 * than as TypeScript unions and a phase switch.
 *
 * Eleven kinds, the list the plan of 9 Sep 2026 fixed. Nothing here interprets
 * one — that is Stage 4 — and nothing here resolves a name against another
 * declaration, which is the loader's job (`rulesets/load.ts`, its own issue).
 * This is the grammar and the tree only.
 */
export type DefineKind = "GAME" | "ATTRIBUTE" | "ZONE" | "PHASE" | "STEP" | "ACTION" | "TRIGGER" | "KEYWORD" | "COST" | "WIN" | "OP";

export const DEFINE_KINDS = ["GAME", "ATTRIBUTE", "ZONE", "PHASE", "STEP", "ACTION", "TRIGGER", "KEYWORD", "COST", "WIN", "OP"] as const satisfies readonly DefineKind[];
type DefineKindMissing = Exclude<DefineKind, (typeof DEFINE_KINDS)[number]>;
const _everyDefineKindListed: DefineKindMissing extends never ? true : never = true;
void _everyDefineKindListed;

/**
 * A trigger's moment, as an event pattern: the event's name and the fields that
 * have to match — `moved(from: hand, to: battle)` for "played" (9-6-9-4).
 *
 * Written as `field: value` pairs and never as an arrow: the lexer reads `-`
 * and `>` as two tokens, so `from -> to` would be three tokens and a guess.
 * The event names are open here on purpose; which ones a game actually fires is
 * the definition's own business and the loader's to check.
 */
export type PatternValue = string | number | boolean | null | PatternValue[];
export interface EventPattern {
  event: string;
  args: Record<string, PatternValue>;
}

/**
 * What a `DEFINE OP` macro, a `DEFINE COST` or a `DEFINE KEYWORD` takes. The
 * type words are the effect language's own field types plus the two a card's
 * text needs and no op field has (`color`, `colors`), so a parameter list can
 * say exactly what `OP_SCHEMA` says about a step's field.
 */
export const PARAM_TYPES = ["amount", "ref", "selector", "side", "area", "duration", "cond", "conds", "ops", "string", "number", "boolean", "keyword", "filter", "modes", "color", "colors"] as const;
export type ParamType = (typeof PARAM_TYPES)[number];
export interface DefineParam {
  name: string;
  type: ParamType;
}

/** One hook body of a keyword: the point it hangs on, and the program that runs there. */
export interface DefineHook {
  at: string;
  ops: Op[];
}

/**
 * A definition's field, as `OP_SCHEMA` declares a step's: the same `OpField`
 * row, so `printValue` and the parser's `typed` need no new cases for the
 * fourteen types they already read.
 *
 * Two additions. `type` may also be one of three shapes a card's rule never
 * carries — `pattern` (a trigger's event), `params` (a macro's parameter list)
 * and `hooks` (a keyword's bodies, one line each). And `word` is the word that
 * introduces the field on its own line: a field with one is written `ON …`,
 * `DO { … }`, `REFUSE "…"`, and a field without one is written `name: value`.
 * The word is part of the row rather than a second table, so the printer still
 * has no choice to make about how a field is written.
 */
export type DefineFieldType = FieldType | "pattern" | "params" | "hooks";
export type DefineField = Omit<OpField, "type"> & { type: DefineFieldType; word?: string };
export interface DefineSpec {
  fields: readonly DefineField[];
  /** What the declaration is for, in one line — the doc and the loader's errors read it. */
  doc: string;
}

interface Declaration<K extends DefineKind> {
  define: K;
  /** The declared name: a bare word, or a quoted text when it carries a space or a hyphen. */
  name: string;
}

/** `DEFINE GAME` — the setup numbers and the turn (manual §5). */
export interface DefGame extends Declaration<"GAME"> {
  title?: string;
  players?: number;
  deck: number;
  zDeck?: number;
  hand: number;
  life: number;
  startMarkers?: number;
  markersPerTurn?: number;
  mulligan?: boolean;
  firstPlayerDraws?: boolean;
  phases?: string[];
}

/** `DEFINE ATTRIBUTE` — something a card or a player has, printed or derived (manual §4). */
export interface DefAttribute extends Declaration<"ATTRIBUTE"> {
  of: "card" | "player" | "zone";
  value: "number" | "string" | "strings" | "colors" | "boolean";
  printed?: boolean;
  derived?: Amount;
  layers?: string[];
  text?: string;
}

/** `DEFINE ZONE` — an area, who owns it, who sees it, and what may sit in it (manual §3, §9-1-3). */
export interface DefZone extends Declaration<"ZONE"> {
  owner: "player" | "shared";
  visibility: "none" | "owner" | "opponent" | "all";
  ordered?: boolean;
  single?: boolean;
  markers?: boolean;
  inPlay?: boolean;
  host?: boolean;
  modes?: string[];
  text?: string;
}

/** `DEFINE PHASE` — a phase of the turn and the steps it runs. */
export interface DefPhase extends Declaration<"PHASE"> {
  steps: string[];
  actions?: string[];
  auto?: boolean;
  text?: string;
}

/** `DEFINE STEP` — one step of a phase, and what happens in it. */
export interface DefStep extends Declaration<"STEP"> {
  phase: string;
  do?: Op[];
  optional?: boolean;
  prompt?: string;
  text?: string;
}

/** `DEFINE ACTION` — a move a player may make: WHEN / FOR / COST / DO / REFUSE. */
export interface DefAction extends Declaration<"ACTION"> {
  when: string[];
  for?: Selector;
  cost?: string[];
  do: Op[];
  refuse?: string;
}

/** `DEFINE TRIGGER` — a moment, as an event pattern with a subject binding (manual §9-6). */
export interface DefTrigger extends Declaration<"TRIGGER"> {
  on: EventPattern;
  where?: Cond;
  bind?: string;
  text?: string;
}

/** `DEFINE KEYWORD` — a keyword skill, its parameters and its hook bodies (manual §22). */
export interface DefKeyword extends Declaration<"KEYWORD"> {
  takes?: DefineParam[];
  text: string;
  section?: string;
  hooks?: DefineHook[];
}

/** `DEFINE COST` — a price the game knows how to charge, by name. */
export interface DefCost extends Declaration<"COST"> {
  takes?: DefineParam[];
  if?: Cond;
  do: Op[];
  text?: string;
}

/** `DEFINE WIN` — a condition that ends the game, and for whom. */
export interface DefWin extends Declaration<"WIN"> {
  if: Cond;
  result: "win" | "lose" | "draw";
  who?: Side;
  text?: string;
}

/** `DEFINE OP` — a macro over the primitives, so an op is one row and not an interpreter case. */
export interface DefOp extends Declaration<"OP"> {
  takes?: DefineParam[];
  do: Op[];
  text?: string;
  doc?: string;
}

export type Definition = DefGame | DefAttribute | DefZone | DefPhase | DefStep | DefAction | DefTrigger | DefKeyword | DefCost | DefWin | DefOp;

const PARAMS = { name: "takes", type: "params", word: "TAKES" } as const satisfies DefineField;
const TEXT = { name: "text", type: "string" } as const satisfies DefineField;

/**
 * One row per `DEFINE` kind, the way `OP_SCHEMA` has one per step: the printer
 * writes the fields in this order, the parser accepts them in any order, and a
 * required field left out fails at the declaration's own line.
 */
export const DEFINE_SCHEMA = {
  GAME: {
    doc: "the game itself: how a player starts and what a turn is made of",
    fields: [
      { name: "title", type: "string" },
      { name: "players", type: "number", default: 2 },
      { name: "deck", type: "number", required: true },
      { name: "zDeck", type: "number" },
      { name: "hand", type: "number", required: true },
      { name: "life", type: "number", required: true },
      { name: "startMarkers", type: "number" },
      { name: "markersPerTurn", type: "number" },
      { name: "mulligan", type: "boolean" },
      { name: "firstPlayerDraws", type: "boolean" },
      { name: "phases", type: { list: "string" } },
    ],
  },
  ATTRIBUTE: {
    doc: "something a card, a player or a zone has — printed on the card, or derived from the board",
    fields: [
      { name: "of", type: { enum: ["card", "player", "zone"] }, required: true },
      { name: "value", type: { enum: ["number", "string", "strings", "colors", "boolean"] }, required: true },
      { name: "printed", type: "boolean" },
      { name: "derived", type: "amount" },
      { name: "layers", type: { list: "string" } },
      TEXT,
    ],
  },
  ZONE: {
    doc: "an area cards sit in: who owns it, who may see it, and whether what is in it is in play",
    fields: [
      { name: "owner", type: { enum: ["player", "shared"] }, required: true },
      { name: "visibility", type: { enum: ["none", "owner", "opponent", "all"] }, required: true },
      { name: "ordered", type: "boolean" },
      { name: "single", type: "boolean" },
      { name: "markers", type: "boolean" },
      { name: "inPlay", type: "boolean" },
      { name: "host", type: "boolean" },
      { name: "modes", type: { list: "string" } },
      TEXT,
    ],
  },
  PHASE: {
    doc: "a phase of the turn, in the order the game declares",
    fields: [
      { name: "steps", type: { list: "string" }, required: true },
      { name: "actions", type: { list: "string" } },
      { name: "auto", type: "boolean" },
      TEXT,
    ],
  },
  STEP: {
    doc: "one step of a phase, and the program it runs",
    fields: [
      { name: "phase", type: "string", required: true },
      { name: "do", type: "ops", word: "DO" },
      { name: "optional", type: "boolean" },
      { name: "prompt", type: "string" },
      TEXT,
    ],
  },
  ACTION: {
    doc: "a move a player may make, and the sentence that says why they may not",
    fields: [
      { name: "when", type: { list: "string" }, word: "WHEN", required: true },
      { name: "for", type: "selector", word: "FOR" },
      { name: "cost", type: { list: "string" }, word: "COST" },
      { name: "do", type: "ops", word: "DO", required: true },
      { name: "refuse", type: "string", word: "REFUSE" },
    ],
  },
  TRIGGER: {
    doc: "a moment an [Auto] or a [Counter] answers to, as the event that is it",
    fields: [
      { name: "on", type: "pattern", word: "ON", required: true },
      { name: "where", type: "cond", word: "WHERE" },
      { name: "bind", type: "string", word: "BIND" },
      TEXT,
    ],
  },
  KEYWORD: {
    doc: "a keyword skill: what it means, what it takes, and the hook points it hangs on",
    fields: [PARAMS, { name: "text", type: "string", required: true }, { name: "section", type: "string" }, { name: "hooks", type: "hooks", word: "HOOK" }],
  },
  COST: {
    doc: "a price the game knows how to charge, named so an action can ask for it",
    fields: [PARAMS, { name: "if", type: "cond", word: "IF" }, { name: "do", type: "ops", word: "DO", required: true }, TEXT],
  },
  WIN: {
    doc: "a condition that ends the game, and for whom",
    fields: [
      { name: "if", type: "cond", word: "IF", required: true },
      { name: "result", type: { enum: ["win", "lose", "draw"] }, required: true },
      { name: "who", type: "side" },
      TEXT,
    ],
  },
  OP: {
    doc: "a macro over the primitives, so a step the cards use is a row rather than an interpreter case",
    fields: [PARAMS, { name: "do", type: "ops", word: "DO", required: true }, TEXT, { name: "doc", type: "string" }],
  },
} as const satisfies Record<DefineKind, DefineSpec>;

// A field on a `Definition` with no row would print as nothing and parse back
// as absent — the silent loss the round-trip promise cannot allow — and a row
// with no field would parse into a key no consumer can read. Both fail the
// typecheck instead, the way `SELECTOR_FIELDS` and `FILTER_FIELDS` do above.
type DeclaredFields<K extends DefineKind> = (typeof DEFINE_SCHEMA)[K]["fields"][number]["name"];
type NodeOf<K extends DefineKind> = Extract<Definition, { define: K }>;
type FieldWithoutRow = { [K in DefineKind]: Exclude<keyof NodeOf<K>, "define" | "name" | DeclaredFields<K>> }[DefineKind];
type RowWithoutField = { [K in DefineKind]: Exclude<DeclaredFields<K>, keyof NodeOf<K>> }[DefineKind];
const _everyDefineFieldWritten: FieldWithoutRow extends never ? true : never = true;
const _everyDefineRowRead: RowWithoutField extends never ? true : never = true;
void _everyDefineFieldWritten;
void _everyDefineRowRead;

/** The fields of a kind, as the printer and the parser read them (the `as const` rows, widened). */
export const fieldsOf = (kind: DefineKind): readonly DefineField[] => DEFINE_SCHEMA[kind].fields as readonly DefineField[];
