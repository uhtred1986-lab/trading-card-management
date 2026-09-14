/**
 * Where a macro's body leaves a value to the call (#273).
 *
 * A `DEFINE OP` body is a template: `$until` where a duration goes, `$ops`
 * where a program goes, `TOP $n IN $side.deck` in two slots of one selector.
 * This module finds every such place and says what type of value the slot
 * holds, so the loader can check each hole against the parameter it names
 * (`load.ts`) before the expander ever fills one (`expand.ts`).
 *
 * Driven by the schema rows, like every other walk in `rulesets/`: which
 * fields hold a program, a condition, a selector or an amount comes from
 * `OP_SCHEMA` and `COND_SCHEMA`, and the selector's own slots are the four a
 * macro can usefully leave open — a count, a `TOP n`, a side and an area.
 *
 * The `amount` and `ref` positions are the two the grammar could already write
 * `$name` in, and there a parameter is a `{ var }` — the same node a program's
 * own binding is. Those are reported too, typed as the field they sit in, and
 * the loader tells the two apart by whether the macro takes the name.
 *
 * Pure and client-safe.
 */
import { COND_SCHEMA, OP_SCHEMA, type Amount, type Cond, type FieldType, type Op, type Ref, type Selector } from "../engine/script";
import { isHole } from "../lang/ast";

/** What a slot holds: an op or condition field's type, or one of a selector's three scalar slots. */
export type SlotType = FieldType | "number" | "side" | "area";

export interface HoleAt {
  /** The parameter the hole names. */
  name: string;
  /** The type of value the slot it sits in holds. */
  slot: SlotType;
  /** Whether it is a `$name` hole (any position) or a `{ var }` in an amount or ref position, which may be a binding rather than a parameter. */
  form: "hole" | "var";
  /** `moveTo.target`, `count.sel.count` — for the error message. */
  where: string;
}

/** Every hole in a program, nested programs, conditions, selectors and amounts included. */
export function holesIn(ops: Op[] | undefined, where = ""): HoleAt[] {
  const out: HoleAt[] = [];
  walkOps(ops, where, out);
  return out;
}

function walkOps(ops: unknown, where: string, out: HoleAt[]): void {
  if (isHole(ops)) {
    out.push({ name: ops.hole, slot: "ops", form: "hole", where });
    return;
  }
  if (!Array.isArray(ops)) return;
  for (const op of ops as Op[]) {
    if (!op || typeof op !== "object") continue;
    const spec = OP_SCHEMA[op.op];
    if (!spec) continue;
    for (const f of spec.fields) walkValue(f.type, (op as unknown as Record<string, unknown>)[f.name], `${op.op}.${f.name}`, out);
  }
}

function walkCond(cond: unknown, where: string, out: HoleAt[]): void {
  if (isHole(cond)) {
    out.push({ name: cond.hole, slot: "cond", form: "hole", where });
    return;
  }
  const spec = cond && typeof cond === "object" ? COND_SCHEMA[(cond as Cond).kind] : undefined;
  if (!spec) return;
  for (const f of spec.fields) walkValue(f.type, (cond as unknown as Record<string, unknown>)[f.name], `${where}.${f.name}`, out);
}

function walkValue(type: FieldType, value: unknown, where: string, out: HoleAt[]): void {
  if (value === undefined || value === null) return;
  if (isHole(value)) {
    out.push({ name: value.hole, slot: type, form: "hole", where });
    return;
  }
  if (typeof type === "object") return;
  switch (type) {
    case "amount":
      walkAmount(value as Amount, where, out);
      return;
    case "ref":
      walkRef(value as Ref, where, out);
      return;
    case "selector":
      walkSelector(value as Selector, where, out);
      return;
    case "cond":
      walkCond(value, where, out);
      return;
    case "conds":
      if (Array.isArray(value)) value.forEach((c, i) => walkCond(c, `${where}[${i}]`, out));
      return;
    case "ops":
      walkOps(value, where, out);
      return;
    case "modes":
      if (Array.isArray(value)) value.forEach((m, i) => walkOps((m as { ops?: Op[] })?.ops, `${where}[${i}]`, out));
      return;
    default:
      return;
  }
}

/** The selector's four open slots, and the host selector under it. */
function walkSelector(sel: Selector | undefined, where: string, out: HoleAt[]): void {
  if (!sel || typeof sel !== "object") return;
  const slot = (name: string, value: unknown, type: SlotType) => {
    if (isHole(value)) out.push({ name: value.hole, slot: type, form: "hole", where: `${where}.${name}` });
  };
  slot("count", sel.count, "number");
  slot("take", sel.take, "number");
  slot("side", sel.side, "side");
  slot("area", sel.area, "area");
  walkSelector(sel.underHost, `${where}.underHost`, out);
}

/** `$n` at the top of an amount is a `{ var }`; the selectors and the ref inside an expression are walked like any other. */
function walkAmount(amount: Amount | undefined, where: string, out: HoleAt[]): void {
  if (!amount || typeof amount !== "object") return;
  if ("var" in amount) {
    out.push({ name: amount.var, slot: "amount", form: "var", where });
    return;
  }
  if ("plus" in amount) return walkAmount(amount.plus[0], where, out);
  if ("count" in amount) return walkSelector(amount.count, `${where}.count`, out);
  if ("markers" in amount) return walkSelector(amount.markers, `${where}.markers`, out);
  if ("sumOf" in amount) return walkSelector(amount.sumOf, `${where}.sumOf`, out);
  if ("attr" in amount) return walkRef(amount.attr, `${where}.attr`, out);
}

/** `$t` as a ref is a `{ var }`; `$t MINUS $rest` names two bindings and no parameter (the expander leaves it alone too). */
function walkRef(ref: Ref | undefined, where: string, out: HoleAt[]): void {
  if (!ref || typeof ref !== "object") return;
  if ("sel" in ref) return walkSelector(ref.sel, `${where}.sel`, out);
  if (ref.minus !== undefined) return;
  out.push({ name: ref.var, slot: "ref", form: "var", where });
}
