/**
 * A program, lowered to what the interpreter actually runs.
 *
 * The plan's second decision is that Stage 4's engine interprets **primitives**
 * and that everything else is a `DEFINE OP` macro over them
 * (`docs/arena-ruleset-spec.md` §2). A macro is not a deletion: a card's rule
 * keeps saying `power(…)`, keeps printing `power(…)` and keeps round-tripping
 * by that name — `parse(print(x))` is over the macro's *name*, never its
 * expansion. This module is the other side of that promise: the one place a
 * program written in the ops the cards use becomes a program written in the
 * ops the interpreter knows.
 *
 * Three rules hold it together.
 *
 * - **A macro is what a game declares, not what a table says.** `OP_CLASS`
 *   carries the *decision* primitive-or-macro; `rulesets/<game>/ops.rules`
 *   carries the *declaration*. This expander lowers exactly the ops the loaded
 *   definition declares, so an op with no `DEFINE OP` is passed through
 *   untouched — which is what makes the expander usable before the whole table
 *   has been declared, and what makes it a no-op on a game that declares none.
 * - **A parameter is a `$name`, in any position.** The body of a macro writes
 *   `$target` where the call's `target` goes, `$until` where its duration
 *   goes, `DO $ops` for a whole program and `TOP $n IN $side.deck` for two
 *   slots of one selector, and substitution replaces that node with the
 *   argument (#273). In an `amount` or a `ref` position the node is the
 *   `{ var }` a program's own binding is, and the macro's parameter list is
 *   what tells the two apart; everywhere else it is a `Hole` the parser
 *   produces only inside a `DEFINE OP` body (`lang/ast.ts`).
 * - **Both walks are driven by the schema rows.** Which fields hold a nested
 *   program, a condition, an amount or a selector comes from `OP_SCHEMA` and
 *   `COND_SCHEMA`, never from a list kept here, so an op that grows a field is
 *   expanded the day its row says so — the same discipline as `areasOf` in
 *   `load.ts`.
 *
 * Pure, synchronous and client-safe, like the rest of `rulesets/`.
 */
import { COLORS, COND_SCHEMA, DURATIONS, OP_SCHEMA, SIDES, type Amount, type Cond, type FieldType, type Op, type OpField, type Ref, type Selector } from "../engine/script";
import { isHole, type Hole, type ParamType } from "../lang/ast";
import type { GameDefinition, OpDef } from "./types";

/**
 * A program that cannot be lowered. Both cases are a bug in the ruleset rather
 * than in the card: a macro that expands into itself never terminates, and a
 * body that reads a parameter the call did not give has nothing to put there.
 * Throwing is deliberate — returning the half-expanded program would hand the
 * interpreter something that looks like a rule and is not one.
 */
export class MacroError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MacroError";
  }
}

/** What a macro's parameters are bound to for one call, with the type each was declared as. A `value` of `undefined` is a parameter the call left out and the schema has no default for. */
type Args = Map<string, { type: ParamType; value: unknown }>;

/**
 * Lower a program to the ops the interpreter knows: every `DEFINE OP` the game
 * declares is replaced by its body with the call's arguments substituted in,
 * as many times over as it takes, and every other op is kept exactly as it is.
 *
 * The result is a program in the same language — `validateProgram` accepts it
 * and `describeScript` reads it — with no declared macro left in it.
 */
export function expandMacros(program: Op[], def: GameDefinition): Op[] {
  return expandOps(program, def, []);
}

const expandOps = (ops: Op[], def: GameDefinition, chain: string[]): Op[] => (Array.isArray(ops) ? ops.flatMap((op) => expandOp(op, def, chain)) : ops);

/**
 * One step. `chain` is the macros being expanded around this one, so a macro
 * that reaches itself — directly or through another — is named in full rather
 * than filling the stack.
 */
function expandOp(op: Op, def: GameDefinition, chain: string[]): Op[] {
  if (!op || typeof op !== "object") return [op];
  const macro: OpDef | undefined = def.ops[op.op];
  if (!macro) return [mapFields(op, (f, v) => expandValue(f.type, v, def, chain))];
  if (chain.includes(op.op)) throw new MacroError(`the macro ${JSON.stringify(op.op)} expands into itself: ${[...chain, op.op].join(" → ")}`);
  const args = bind(macro, op, def, chain);
  // `DO $ops` — a body that is the parameter — is one hole rather than a program with holes in it.
  const body = isHole(macro.do) ? (fill(macro.do.hole, { name: "do", type: "ops", required: true }, args) as Op[]) : substOps(macro.do, args);
  return expandOps(body, def, [...chain, op.op]);
}

/**
 * What the call gives each parameter. A field the call left out falls back to
 * the schema's default — the same value the interpreter would have assumed —
 * so a macro's body reads what the op means, not what the row happened to
 * spell out. Each argument is checked against the type the parameter was
 * declared with, and refused by name when it is not one.
 *
 * The arguments are lowered *before* they are substituted: a macro handed a
 * program (`may(ops: [ko(…)])`) has the macros inside that program expanded
 * here, under the chain of the call, so the body's own re-expansion below
 * meets none of them — and a `may` inside a `may`'s argument is two calls, not
 * a macro reaching itself.
 */
function bind(macro: OpDef, op: Op, def: GameDefinition, chain: string[]): Args {
  const fields = OP_SCHEMA[op.op]?.fields ?? [];
  const args: Args = new Map();
  for (const param of macro.takes ?? []) {
    const field = fields.find((f) => f.name === param.name);
    const given = (op as unknown as Record<string, unknown>)[param.name];
    const raw = given === undefined ? field?.default : given;
    if (raw !== undefined && !argHolds(param.type, raw, def)) throw new MacroError(`${op.op}'s ${param.name} is ${JSON.stringify(raw)}, and this macro takes ${param.name} as ${param.type}`);
    args.set(param.name, { type: param.type, value: raw === undefined || !field ? raw : expandValue(field.type, raw, def, chain) });
  }
  return args;
}

// ── expanding: the ops nested inside an op the game does not declare ─────────

function expandValue(type: FieldType, value: unknown, def: GameDefinition, chain: string[]): unknown {
  if (value === undefined || value === null || typeof type === "object") return value;
  switch (type) {
    case "ops":
      return expandOps(value as Op[], def, chain);
    case "modes":
      return (value as { ops: Op[] }[]).map((m) => ({ ...m, ops: expandOps(m.ops ?? [], def, chain) }));
    case "cond":
      return expandCond(value as Cond, def, chain);
    case "conds":
      return (value as Cond[]).map((c) => expandCond(c, def, chain));
    default:
      // Nothing else can hold a step: an amount, a ref, a selector and a filter
      // are all values, and a condition is the only one of them with fields of
      // its own (handled above).
      return value;
  }
}

function expandCond(cond: Cond, def: GameDefinition, chain: string[]): Cond {
  return mapCondFields(cond, (f, v) => expandValue(f.type, v, def, chain));
}

// ── substituting: a macro's parameters, wherever its body writes them ────────

const substOps = (ops: Op[], args: Args): Op[] => (Array.isArray(ops) ? ops.map((op) => (op && typeof op === "object" ? mapFields(op, (f, v) => substValue(f, v, args)) : op)) : ops);

/**
 * One field of the body. A hole is filled whatever the field's type (#273);
 * every other value is walked for the holes inside it — the `{ var }` an
 * amount or a ref may be, the four slots of a selector, the programs and
 * conditions a field may nest. `undefined` means the field is left out of the
 * expansion (see `fill`).
 */
function substValue(field: OpField, value: unknown, args: Args): unknown {
  if (isHole(value)) return fill(value.hole, field, args);
  if (value === undefined || value === null || typeof field.type === "object") return value;
  switch (field.type) {
    case "amount":
      return substAmount(value as Amount, args);
    case "ref":
      return substRef(value as Ref, args);
    case "selector":
      return substSelector(value as Selector, args);
    case "cond":
      return substCond(value as Cond, args);
    case "conds":
      return (value as Cond[]).map((c) => substCond(c, args));
    case "ops":
      return substOps(value as Op[], args);
    case "modes":
      return (value as { ops: Op[] }[]).map((m) => ({ ...m, ops: isHole(m.ops) ? fill(m.ops.hole, { name: "ops", type: "ops", required: true }, args) : substOps(m.ops ?? [], args) }));
    default:
      // A duration, a side, an area, an enum, a string, a number, a boolean, a
      // keyword or a filter written out in full: nothing inside it can name a
      // parameter. Written as a hole, it was filled above.
      return value;
  }
}

/**
 * `$name` as the whole of a field. The parameter is the call's argument; a
 * parameter the call left out and the schema has no default for leaves an
 * *optional* field out of the expansion — the interpreter then assumes for the
 * expansion exactly what it would have assumed for the call — and makes a
 * *required* one a program with a hole in it, which is refused by name. An
 * argument to a closed-list field is checked against that list here, because
 * `word` says only that it is one of *some* list.
 */
function fill(name: string, field: OpField, args: Args): unknown {
  const arg = args.get(name);
  if (!arg) throw new MacroError(`this macro writes $${name} in ${field.name}, which is not a parameter it takes`);
  if (arg.value === undefined) {
    if (field.required) throw new MacroError(`this macro reads $${name} for ${field.name}, which the call did not give and the schema has no default for`);
    return undefined;
  }
  const type = field.type;
  if (typeof type === "object") {
    if ("enum" in type) {
      if (typeof arg.value !== "string" || !type.enum.includes(arg.value)) throw new MacroError(`$${name} is ${JSON.stringify(arg.value)}, and ${field.name} takes one of [${type.enum.join(", ")}]`);
    } else if (typeof type.list === "object") {
      const list = type.list.enum;
      if (!Array.isArray(arg.value) || !arg.value.every((v) => typeof v === "string" && list.includes(v))) throw new MacroError(`$${name} is ${JSON.stringify(arg.value)}, and ${field.name} takes a list of [${list.join(", ")}]`);
    }
  }
  return arg.value;
}

/**
 * `$name` in a value position. A name the macro does not take is a variable of
 * the program — a `choose`'s `as`, read later — and is left exactly as it is;
 * a name it *does* take is the argument, and a parameter the call never bound
 * is a program with a hole in it rather than a program that resolves to
 * nothing.
 */
function argOf(name: string, args: Args): { value: unknown } | null {
  const arg = args.get(name);
  if (!arg) return null;
  if (arg.value === undefined) throw new MacroError(`this macro reads $${name}, which the call did not give and the schema has no default for`);
  return { value: arg.value };
}

/** Every place an expression names a parameter. `sumOf` before `attr`: the two share an `attr` key, so the narrower test comes first (the same order `load.ts` reads them in). */
function substAmount(amount: Amount, args: Args): Amount {
  if (!amount || typeof amount !== "object") return amount;
  if ("var" in amount) return (argOf(amount.var, args)?.value as Amount) ?? amount;
  if ("plus" in amount) return { ...amount, plus: [substAmount(amount.plus[0], args), amount.plus[1]] };
  if ("count" in amount) return { ...amount, count: substSelector(amount.count, args) };
  if ("markers" in amount) return { ...amount, markers: substSelector(amount.markers, args) };
  if ("sumOf" in amount) return { ...amount, sumOf: substSelector(amount.sumOf, args) };
  if ("attr" in amount) return { ...amount, attr: substRef(amount.attr, args) };
  return amount;
}

/**
 * A ref is `$name` or a selector. `MINUS $rest` is left alone on purpose: the
 * name after it is a binding the program made, and a parameter substituted
 * there would have to be a name rather than the cards it stands for.
 */
function substRef(ref: Ref, args: Args): Ref {
  if (!ref || typeof ref !== "object") return ref;
  if ("sel" in ref) return { sel: substSelector(ref.sel, args) };
  if (ref.minus !== undefined) return ref;
  return (argOf(ref.var, args)?.value as Ref) ?? ref;
}

/**
 * A selector's four open slots — `$n IN …`, `TOP $n`, `OF $side`, `IN
 * $side.$area` — each filled as a required field of its own type, and the
 * host selector under it walked the same way. `fromVar` names a binding, the
 * way `MINUS` does, and is left alone.
 */
function substSelector(sel: Selector, args: Args): Selector {
  if (!sel || typeof sel !== "object") return sel;
  const out: Record<string, unknown> = { ...sel };
  for (const [slot, type] of [
    ["count", "number"],
    ["take", "number"],
    ["side", "side"],
    ["area", "area"],
  ] as const) {
    if (isHole(out[slot])) out[slot] = fill((out[slot] as Hole).hole, { name: slot, type, required: true }, args);
  }
  if (sel.underHost) out.underHost = substSelector(sel.underHost, args);
  return out as Selector;
}

const substCond = (cond: Cond, args: Args): Cond => mapCondFields(cond, (f, v) => substValue(f, v, args));

// ── the argument, checked against the parameter's declared type ──────────────

/**
 * Whether a call's argument is what the parameter says it takes. The check is
 * by shape, the way `validateProgram` checks a field: it refuses a duration
 * where a side was declared, a number where a program was, and says which.
 * An `area` is one the *game* declares, because the vocabulary is the
 * definition's own (#137).
 */
function argHolds(type: ParamType, v: unknown, def: GameDefinition): boolean {
  switch (type) {
    case "amount":
      return typeof v === "number" || (typeof v === "object" && v !== null);
    case "ref":
      return typeof v === "object" && v !== null && (typeof (v as { var?: unknown }).var === "string" || typeof (v as { sel?: unknown }).sel === "object");
    case "selector":
    case "filter":
      return typeof v === "object" && v !== null && !Array.isArray(v);
    case "side":
      return typeof v === "string" && (SIDES as readonly string[]).includes(v);
    case "area":
      return typeof v === "string" && v in def.zones;
    case "duration":
      return typeof v === "string" && (DURATIONS as readonly string[]).includes(v);
    case "cond":
      return typeof v === "object" && v !== null && typeof (v as { kind?: unknown }).kind === "string";
    case "conds":
    case "ops":
    case "modes":
      return Array.isArray(v);
    case "string":
    case "word":
      return typeof v === "string";
    case "strings":
      return Array.isArray(v) && v.every((x) => typeof x === "string");
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
    case "keyword":
      return typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string";
    case "color":
      return typeof v === "string" && (COLORS as readonly string[]).includes(v);
    case "colors":
      return Array.isArray(v) && v.every((x) => typeof x === "string" && (COLORS as readonly string[]).includes(x));
  }
}

// ── walking a row's fields ──────────────────────────────────────────────────

/**
 * A new op with each of its schema fields put through `fn`. Keys the row does
 * not know are copied over untouched: an op the table has no row for is passed
 * through whole rather than emptied, which is what keeps this safe to run over
 * a program the schema has since grown past.
 */
function mapFields(op: Op, fn: (field: OpField, value: unknown) => unknown): Op {
  const spec = OP_SCHEMA[op.op];
  if (!spec) return op;
  const out = { ...(op as unknown as Record<string, unknown>) };
  for (const f of spec.fields) {
    if (out[f.name] === undefined) continue;
    const v = fn(f, out[f.name]);
    // A hole the call left empty leaves its optional field out (`fill`).
    if (v === undefined) delete out[f.name];
    else out[f.name] = v;
  }
  return out as unknown as Op;
}

function mapCondFields(cond: Cond, fn: (field: OpField, value: unknown) => unknown): Cond {
  const spec = cond && typeof cond === "object" ? COND_SCHEMA[cond.kind] : undefined;
  if (!spec) return cond;
  const out = { ...(cond as unknown as Record<string, unknown>) };
  for (const f of spec.fields) {
    if (out[f.name] === undefined) continue;
    const v = fn(f, out[f.name]);
    if (v === undefined) delete out[f.name];
    else out[f.name] = v;
  }
  return out as unknown as Cond;
}

/** Every op name in a program, nested programs included — what a test asserts holds no macro. */
export function opsIn(program: Op[]): string[] {
  const out: string[] = [];
  const walkCond = (cond: Cond | undefined): void => {
    const spec = cond && typeof cond === "object" ? COND_SCHEMA[cond.kind] : undefined;
    if (!spec || !cond) return;
    for (const f of spec.fields) walkValue(f.type, (cond as unknown as Record<string, unknown>)[f.name]);
  };
  const walkValue = (type: FieldType, value: unknown): void => {
    if (value === undefined || value === null || typeof type === "object") return;
    if (type === "ops") walk(value as Op[]);
    else if (type === "modes") for (const m of value as { ops: Op[] }[]) walk(m.ops ?? []);
    else if (type === "cond") walkCond(value as Cond);
    else if (type === "conds") for (const c of value as Cond[]) walkCond(c);
  };
  const walk = (ops: Op[]): void => {
    if (!Array.isArray(ops)) return;
    for (const op of ops) {
      if (!op || typeof op !== "object") continue;
      out.push(op.op);
      for (const f of OP_SCHEMA[op.op]?.fields ?? []) walkValue(f.type, (op as unknown as Record<string, unknown>)[f.name]);
    }
  };
  walk(program);
  return out;
}
