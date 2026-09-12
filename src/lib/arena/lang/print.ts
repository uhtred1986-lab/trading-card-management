/**
 * A rule, printed. The other half of `parse.ts`, and the half the promise is
 * stated against: `parse(print(x))` deep-equals `x` for every program the
 * compiler writes and every record the drafter makes (`scripts/verify/lang.ts`).
 *
 * Nothing here decides what the language *is* — the steps and conditions come
 * from `OP_SCHEMA` / `COND_SCHEMA`, the selector and filter fields from the
 * tables in `ast.ts`. Adding an op is still one interpreter case and one
 * schema row; this file follows.
 *
 * Two rules keep the promise honest. Sugar is printed only when it says
 * exactly what the object says — `count(SEL) >= 2` for one bound, the general
 * form for two — so the printer never has a choice to make. And a filter is
 * printed in its own words only when `parseFilter` reads them back *equal*;
 * when it does not, the field form is used, which is uglier and exact.
 */
import { emptyFilter, parseFilter, type CardFilter } from "../engine/filters";
import {
  COND_SCHEMA,
  OP_SCHEMA,
  describeFilter,
  type Amount,
  type Cond,
  type CostRecord,
  type FieldType,
  type Op,
  type OpField,
  type Ref,
  type Selector,
} from "../engine/script";
import type { KeywordSkill } from "../engine/types";
import { EXPR_SCHEMA, FILTER_FIELDS, FILTER_FIELD_NAMES, fieldsOf, type Definition, type DefineFieldType, type DefineHook, type DefineParam, type EventPattern, type ExprArg, type FilterFieldType, type Rule } from "./ast";

/**
 * Key-sorted JSON with `undefined` dropped, so "the same object" means the
 * same thing here as it does to the drafter (`canonical` in `draft.ts`, whose
 * copy this is — that module reaches the database and cannot be imported from
 * a client bundle).
 */
export function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    // A selector that carries both is read by `areas` alone (see `Selector` in
    // `script.ts`), so the `area` beside it says nothing. The compiler writes
    // both for the two-area wordings; printing both would put a zone in the
    // text that the engine never looks at. No op, condition or filter has a
    // field called `areas`, so this can only be a selector.
    const dead = Array.isArray(o.areas) ? "area" : "";
    return Object.fromEntries(
      Object.keys(o)
        .filter((k) => o[k] !== undefined && k !== dead && !(MEANINGLESS_WHEN_FALSE.has(k) && o[k] === false))
        .sort()
        .map((k) => [k, canonical(o[k])]),
    );
  }
  return v ?? null;
}

/**
 * A selector's three switches, which the engine reads truthily: `upTo: false`
 * is "not an up-to choice", which is the same selector as one that never
 * mentioned it — and the compiler writes the long form while a person typing
 * the rule would write neither. The printer leaves them out, so they are left
 * out of the comparison too, and the round-trip promise is over *selectors*
 * rather than over incidental JSON.
 *
 * Deliberately a list of names rather than "any false": `faceUp: false` on the
 * `faceUp` op means turn the card face *down*, and `hidden: false` means
 * Revealed Mode. Dropping those would lose half of what two ops can say. None
 * of the three names below is a field of any op, condition or filter.
 */
const MEANINGLESS_WHEN_FALSE = new Set(["upTo", "fromEnd", "ignoreBarrier"]);
export const deepEqual = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** A bare word where the language allows one, a quoted text everywhere else. */
export const WORD = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const atom = (s: string) => (WORD.test(s) ? s : JSON.stringify(s));

// ── expressions ─────────────────────────────────────────────────────────────

/**
 * An expression, from `EXPR_SCHEMA`.
 *
 * The table is walked in order and the first row whose key the object carries
 * wins, so a shape added to `Amount` is a row there and nothing here. Only the
 * two literals and the one operator are written out: they have no call name,
 * and inventing one for them would be a table that lies about the grammar.
 */
export function printAmount(a: Amount): string {
  if (typeof a === "number") return String(a);
  if ("plus" in a) return `${printAmount(a.plus[0])} + ${a.plus[1]}`;
  if ("var" in a) return `$${a.var}`;
  const bag = a as Record<string, unknown>;
  for (const spec of EXPR_SCHEMA) {
    const fields = spec.fields ?? [spec.key];
    // Every field, not just the key: `sumOf` and `attr` share the `attr` key
    // (the measure on one, the card on the other), so a row that matched on
    // its key alone would read a `sumOf` as an `attr` and print its measure
    // where the card belongs.
    if (!fields.every((f) => f in bag)) continue;
    const args = spec.args.map((kind, i) => printExprArg(kind, bag[fields[i]]));
    const call = args.length ? `${spec.call}(${args.join(", ")})` : spec.call;
    const times = spec.times ? bag.times : undefined;
    return times === undefined ? call : `${call} * ${times as number}`;
  }
  // Unreachable while `Amount` and `EXPR_SCHEMA` agree; `scripts/verify/lang.ts`
  // is what holds them to it. Printing the object beats printing nothing.
  return JSON.stringify(a);
}

function printExprArg(kind: ExprArg, v: unknown): string {
  switch (kind) {
    case "selector":
      return printSelector(v as Selector);
    case "var":
      return `$${(v as { var: string }).var}`;
    case "ref":
      return printRef(v as Ref);
    case "number":
      return String(v as number);
    case "side":
    case "attr":
      return String(v as string);
  }
}

export function printRef(r: Ref): string {
  if ("var" in r) return `$${r.var}${r.minus === undefined ? "" : ` MINUS $${r.minus}`}`;
  return printSelector(r.sel);
}

// ── the selector ────────────────────────────────────────────────────────────

/**
 * "1 blue card IN opponent.battle rest" — the parts in the order `ast.ts`
 * lists them. Every field is a part of its own, so a selector carrying an
 * unusual combination (a special with a mode, an `upTo` with no count) still
 * prints in full instead of quietly losing half of itself.
 *
 * One shape has to be marked rather than written plainly: a one-area `areas`
 * list, which would otherwise print exactly like `area` and come back as the
 * other field. It prints `ANY(hand)`.
 */
export function printSelector(sel: Selector): string {
  const parts: string[] = [];
  if (sel.special !== undefined) parts.push(`[${sel.special}]`);
  if (sel.fromVar !== undefined) parts.push(`FROM $${sel.fromVar}`);
  if (sel.underHost !== undefined) parts.push(`UNDER (${printSelector(sel.underHost)})`);
  if (sel.upTo) parts.push(sel.count === undefined ? "UP TO" : `UP TO ${sel.count}`);
  else if (sel.count !== undefined) parts.push(String(sel.count));
  if (sel.take !== undefined) parts.push(`${sel.fromEnd ? "BOTTOM" : "TOP"} ${sel.take}`);
  else if (sel.fromEnd) parts.push("fromEnd");
  if (sel.filter !== undefined) parts.push(printFilter(sel.filter));
  const zones = sel.areas !== undefined ? (sel.areas.length === 1 ? `ANY(${sel.areas[0]})` : sel.areas.join("|")) : sel.area;
  if (zones !== undefined) parts.push(`IN ${sel.side === undefined ? "" : `${sel.side}.`}${zones}`);
  else if (sel.side !== undefined) parts.push(`OF ${sel.side}`);
  if (sel.mode !== undefined) parts.push(sel.mode);
  if (sel.hidden !== undefined) parts.push(sel.hidden ? "hidden" : "revealed");
  if (sel.ignoreBarrier) parts.push("ignoringBarrier");
  if (sel.notSelf === "card") parts.push("otherThanSelf");
  else if (sel.notSelf === "copies") parts.push("otherThanCopies");
  return parts.length ? parts.join(" ") : "any";
}

// ── the card filter ─────────────────────────────────────────────────────────

const EMPTY = emptyFilter();

function printFilterValue(kind: FilterFieldType, v: unknown): string {
  switch (kind) {
    case "strings":
    case "keywords":
      return `[${(v as string[]).map(atom).join(", ")}]`;
    case "colors":
      return `[${(v as string[]).join(", ")}]`;
    case "cardType":
    case "skillKind":
    case "tri":
    case "number":
      return v === null ? "null" : String(v);
    case "boolean":
      return String(v);
    case "powerRel": {
      const r = v as CardFilter["powerRel"];
      if (r === null) return "null";
      // "the chosen card's power" (BT19-096) carries which choice it means.
      return r.of === "chosen" && r.var ? `chosen $${r.var} ${r.cmp}` : `${r.of} ${r.cmp}`;
    }
  }
}

/**
 * The filter in its own printed words when they read back the same filter, and
 * field by field when they do not. `parseFilter` ignores wording it does not
 * know, so a filter printed in words it cannot re-read would come back *wider*
 * than it went in — the silent widening ground rule 5 forbids.
 */
export function printFilter(f: CardFilter): string {
  const words = describeFilter(f);
  if (words && deepEqual(parseFilter(words), f)) return JSON.stringify(words);
  const bits: string[] = [];
  for (const name of FILTER_FIELD_NAMES) {
    if (deepEqual(f[name], EMPTY[name])) continue;
    bits.push(`${name} = ${printFilterValue(FILTER_FIELDS[name], f[name])}`);
  }
  return `(${bits.join(" AND ")})`;
}

// ── conditions ──────────────────────────────────────────────────────────────

/** `NOT` binds tightest, then `AND`, then `OR`; a child of equal or lower rank gets brackets. */
const PREC = { any: 0, all: 1, not: 2 } as const;
const precOf = (c: Cond): number => (c.kind in PREC ? PREC[c.kind as keyof typeof PREC] : 3);
const nested = (c: Cond, above: number) => (precOf(c) > above ? printCond(c) : `(${printCond(c)})`);

/** The kinds whose one numeric bound is written as a comparison. */
const COMPARABLE: Partial<Record<Cond["kind"], (c: Cond) => string>> = {
  count: (c) => `count(${printSelector((c as Extract<Cond, { kind: "count" }>).sel)})`,
  markers: (c) => `markers(${printSelector((c as Extract<Cond, { kind: "markers" }>).sel)})`,
  power: (c) => `power(${printSelector((c as Extract<Cond, { kind: "power" }>).sel)})`,
  life: (c) => `life(${(c as Extract<Cond, { kind: "life" }>).side})`,
};

/**
 * A `count` / `life` / `markers` / `power` with exactly one bound and nothing
 * else set is written as the comparison; anything else keeps the general form,
 * so the printer never chooses between two ways of saying one object.
 */
function comparison(c: Cond): string | null {
  const head = COMPARABLE[c.kind];
  if (!head) return null;
  const b = c as { atLeast?: number; atMost?: number };
  const bounds = [b.atLeast, b.atMost].filter((x) => x !== undefined);
  if (bounds.length !== 1) return null;
  const extra = COND_SCHEMA[c.kind].fields.some((f) => f.name !== "atLeast" && f.name !== "atMost" && !f.required && (c as unknown as Record<string, unknown>)[f.name] !== undefined);
  if (extra) return null;
  return `${head(c)} ${b.atLeast !== undefined ? ">=" : "<="} ${b.atLeast ?? b.atMost}`;
}

export function printCond(c: Cond): string {
  if (c.kind === "not") return `NOT ${nested(c.cond, PREC.not)}`;
  if (c.kind === "all" && c.conds.length > 1) return c.conds.map((x) => nested(x, PREC.all)).join(" AND ");
  if (c.kind === "any" && c.conds.length > 1) return c.conds.map((x) => nested(x, PREC.any)).join(" OR ");
  return comparison(c) ?? `${c.kind}(${args(COND_SCHEMA[c.kind].fields, c as unknown as Record<string, unknown>, 0)})`;
}

// ── steps ───────────────────────────────────────────────────────────────────

const INDENT = "  ";

function printKeyword(k: KeywordSkill): string {
  const params = Object.entries(k as Record<string, unknown>).filter(([name]) => name !== "name");
  const body = params.map(([name, v]) => `${name}: ${printPlain(v)}`).join(", ");
  return `[${k.name}${body ? ` ${body}` : ""}]`;
}

/** A keyword parameter, a filter field value and an enum are all written the same way. */
function printPlain(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(printPlain).join(", ")}]`;
  if (typeof v === "string") return atom(v);
  return String(v);
}

function printValue(type: FieldType, v: unknown, indent: number): string {
  if (typeof type === "object") {
    if ("enum" in type) return atom(String(v));
    return `[${(v as string[]).map((x) => (type.list === "string" ? atom(x) : x)).join(", ")}]`;
  }
  switch (type) {
    case "amount":
      return printAmount(v as Amount);
    case "ref":
      return printRef(v as Ref);
    case "selector":
      return printSelector(v as Selector);
    case "side":
    case "area":
    case "duration":
      return String(v);
    case "cond":
      return printCond(v as Cond);
    case "conds":
      return `[${(v as Cond[]).map(printCond).join(", ")}]`;
    case "ops":
      return printBlock(v as Op[], indent);
    case "modes":
      return `[${(v as { label: string; ops: Op[] }[]).map((m) => `${JSON.stringify(m.label)} ${printBlock(m.ops, indent)}`).join(", ")}]`;
    case "string":
      return JSON.stringify(v);
    case "number":
    case "boolean":
      return String(v);
    case "keyword":
      return printKeyword(v as KeywordSkill);
    case "filter":
      return printFilter(v as CardFilter);
  }
}

function args(fields: OpField[], o: Record<string, unknown>, indent: number): string {
  return fields
    .filter((f) => o[f.name] !== undefined)
    .map((f) => `${f.name}: ${o[f.name] === null ? "null" : printValue(f.type, o[f.name], indent)}`)
    .join(", ");
}

export function printOp(op: Op, indent = 0): string {
  const spec = OP_SCHEMA[op.op];
  if (!spec) return `${op.op}()`;
  return `${op.op}(${args(spec.fields, op as unknown as Record<string, unknown>, indent)})`;
}

/** A nested program: `{}` when empty, otherwise one step per line, indented. */
function printBlock(ops: Op[], indent: number): string {
  if (!ops.length) return "{}";
  const pad = INDENT.repeat(indent + 1);
  return `{\n${ops.map((o) => pad + printOp(o, indent + 1)).join("\n")}\n${INDENT.repeat(indent)}}`;
}

export function printOps(ops: Op[], indent = 0): string {
  const pad = INDENT.repeat(indent);
  return ops.map((o) => pad + printOp(o, indent)).join("\n");
}

// ── the price ───────────────────────────────────────────────────────────────

/**
 * `{Red}{Red}{any}, {Red/Blue}, +1 marker, burst 2, IF …, DO { … }` — the orbs
 * as the card prints them, then everything else the record carries. The orb
 * keys are sorted, so one price always prints one way.
 */
export function printCost(cost: CostRecord): string {
  const items: string[] = [];
  const braces = Object.keys(cost.orbs)
    .sort()
    .flatMap((k) => Array.from({ length: cost.orbs[k] }, () => `{${k}}`))
    .join("");
  if (braces) items.push(braces);
  for (const either of cost.either) items.push(`{${either.join("/")}}`);
  if (cost.marker !== null) items.push(`${cost.marker >= 0 ? "+" : ""}${cost.marker} marker`);
  if (cost.burst !== null) items.push(`burst ${cost.burst}`);
  if (cost.spiritBoost !== null) items.push(`spiritBoost ${cost.spiritBoost}`);
  // "{X}" (20-5). Printed bare when it is payable at anything, with its bounds
  // when the card sets one; `min` always before `max`, so there is one form.
  if (cost.x) items.push(["X", cost.x.min === undefined ? "" : `min ${cost.x.min}`, cost.x.max === undefined ? "" : `max ${cost.x.max}`].filter(Boolean).join(" "));
  if (cost.text) items.push(`TEXT ${JSON.stringify(cost.text)}`);
  if (cost.condition !== null) items.push(`IF ${printCond(cost.condition)}`);
  if (cost.program !== null) items.push(`DO ${printBlock(cost.program, 0)}`);
  return items.join(", ");
}

// ── the rule ────────────────────────────────────────────────────────────────

/**
 * WHEN / COST / IF / THEN, one clause per line. WHEN is always printed — every
 * skill has a kind — and the rest only when the record has them, so a rule
 * with no price and no condition is two lines rather than four, one of them
 * empty.
 */
export function printRule(rule: Rule): string {
  const lines = [`WHEN [${rule.kind}]${rule.trigger.length ? ` ${rule.trigger.join(" | ")}` : ""}`];
  if (rule.cost) lines.push(`COST ${printCost(rule.cost)}`.trimEnd());
  if (rule.cond) lines.push(`IF ${printCond(rule.cond)}`);
  lines.push(rule.ops.length ? `THEN\n${printOps(rule.ops, 1)}` : "THEN");
  return lines.join("\n");
}

// ── definitions ─────────────────────────────────────────────────────────────

/**
 * A game's declarations, printed. One header line — `DEFINE ZONE battle` — and
 * then one line per field, in the order `DEFINE_SCHEMA` lists them: a field
 * with a `word` is written as its clause (`ON …`, `DO { … }`), a field without
 * one as `name: value`.
 *
 * The same two rules as a rule's printer. There is no sugar and no second form,
 * so one declaration prints one way; and a field that is `undefined` is left
 * out, which is what the loader reads as "its default" — a value that *equals*
 * the default is still printed, because leaving it out would not bring it back.
 */
function printPattern(p: EventPattern): string {
  const args = Object.keys(p.args).sort();
  return args.length ? `${p.event}(${args.map((k) => `${k}: ${printPlain(p.args[k])}`).join(", ")})` : p.event;
}

function printParams(params: DefineParam[]): string {
  return `(${params.map((p) => `${p.name}: ${p.type}`).join(", ")})`;
}

function printDefineValue(type: DefineFieldType, v: unknown, indent: number): string {
  if (type === "pattern") return printPattern(v as EventPattern);
  if (type === "params") return printParams(v as DefineParam[]);
  // A `hooks` field is the one that is not a value at all: it prints as a line
  // of its own per hook, in `printDefinition` below.
  if (type === "hooks") return "";
  return printValue(type, v, indent);
}

export function printDefinition(def: Definition): string {
  const o = def as unknown as Record<string, unknown>;
  const lines = [`DEFINE ${def.define} ${atom(def.name)}`];
  for (const f of fieldsOf(def.define)) {
    const v = o[f.name];
    if (v === undefined) continue;
    if (f.type === "hooks") {
      for (const hook of v as DefineHook[]) lines.push(`${INDENT}${f.word ?? "HOOK"} ${atom(hook.at)} ${printBlock(hook.ops, 1)}`);
      continue;
    }
    const text = v === null ? "null" : printDefineValue(f.type, v, 1);
    lines.push(`${INDENT}${f.word ? `${f.word} ${text}` : `${f.name}: ${text}`}`);
  }
  return lines.join("\n");
}

/** A whole file: the declarations in the order they were written, one blank line apart. */
export function printDefinitions(defs: Definition[]): string {
  return defs.map(printDefinition).join("\n\n");
}
