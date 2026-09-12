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
 * - **A parameter is a `$name`.** The body of a macro writes `$target` where
 *   the call's `target` goes, and substitution replaces that node with the
 *   argument. The grammar can only write `$name` where an `amount` or a `ref`
 *   is expected (`lang/parse.ts`), which is why `ops.rules` is empty today —
 *   its header records the two gaps and #137 carries the question.
 * - **Both walks are driven by the schema rows.** Which fields hold a nested
 *   program, a condition, an amount or a selector comes from `OP_SCHEMA` and
 *   `COND_SCHEMA`, never from a list kept here, so an op that grows a field is
 *   expanded the day its row says so — the same discipline as `areasOf` in
 *   `load.ts`.
 *
 * Pure, synchronous and client-safe, like the rest of `rulesets/`.
 */
import { COND_SCHEMA, OP_SCHEMA, type Amount, type Cond, type FieldType, type Op, type OpField, type Ref, type Selector } from "../engine/script";
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

/** What a macro's parameters are bound to for one call. `undefined` is a parameter the call left out and the schema has no default for. */
type Args = Map<string, unknown>;

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
  return expandOps(substOps(macro.do, bind(macro, op)), def, [...chain, op.op]);
}

/**
 * What the call gives each parameter. A field the call left out falls back to
 * the schema's default — the same value the interpreter would have assumed —
 * so a macro's body reads what the op means, not what the row happened to
 * spell out.
 */
function bind(macro: OpDef, op: Op): Args {
  const fields = OP_SCHEMA[op.op]?.fields ?? [];
  const args: Args = new Map();
  for (const param of macro.takes ?? []) {
    const given = (op as unknown as Record<string, unknown>)[param.name];
    args.set(param.name, given === undefined ? fields.find((f) => f.name === param.name)?.default : given);
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

const substOps = (ops: Op[], args: Args): Op[] => (Array.isArray(ops) ? ops.map((op) => (op && typeof op === "object" ? mapFields(op, (f, v) => substValue(f.type, v, args)) : op)) : ops);

function substValue(type: FieldType, value: unknown, args: Args): unknown {
  if (value === undefined || value === null || typeof type === "object") return value;
  switch (type) {
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
      return (value as { ops: Op[] }[]).map((m) => ({ ...m, ops: substOps(m.ops ?? [], args) }));
    default:
      // A `duration`, a `side`, an `area`, an enum, a string, a number, a
      // boolean, a keyword or a filter: the grammar has no way to write a
      // parameter in any of those positions, so there is nothing to replace.
      // That gap is `ops.rules`'s header and the open question on #137.
      return value;
  }
}

/**
 * `$name` in a value position. A name the macro does not take is a variable of
 * the program — a `choose`'s `as`, read later — and is left exactly as it is;
 * a name it *does* take is the argument, and a parameter the call never bound
 * is a program with a hole in it rather than a program that resolves to
 * nothing.
 */
function argOf(name: string, args: Args): { value: unknown } | null {
  if (!args.has(name)) return null;
  const value = args.get(name);
  if (value === undefined) throw new MacroError(`this macro reads $${name}, which the call did not give and the schema has no default for`);
  return { value };
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

/** A selector holds one nested selector and no parameter slot of its own — `fromVar` names a binding, the way `MINUS` does. */
const substSelector = (sel: Selector, args: Args): Selector => (sel && typeof sel === "object" && sel.underHost ? { ...sel, underHost: substSelector(sel.underHost, args) } : sel);

const substCond = (cond: Cond, args: Args): Cond => mapCondFields(cond, (f, v) => substValue(f.type, v, args));

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
    out[f.name] = fn(f, out[f.name]);
  }
  return out as unknown as Op;
}

function mapCondFields(cond: Cond, fn: (field: OpField, value: unknown) => unknown): Cond {
  const spec = cond && typeof cond === "object" ? COND_SCHEMA[cond.kind] : undefined;
  if (!spec) return cond;
  const out = { ...(cond as unknown as Record<string, unknown>) };
  for (const f of spec.fields) {
    if (out[f.name] === undefined) continue;
    out[f.name] = fn(f, out[f.name]);
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
