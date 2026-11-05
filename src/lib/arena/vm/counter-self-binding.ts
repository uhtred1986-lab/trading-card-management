/** R465: explicit Counter self-play references retain their original occurrence. */
import type { Op, Ref, Script, ScriptFrame } from "./script";
import { rebuildScope } from "./skill-play-scope";
import type { VmState } from "./state";
import { findCard } from "./zones";

export interface CounterSelfChoices {
  version: 1;
  vars: Record<string, { card: string; epoch: number }>;
}

export interface CounterSelfTax {
  version: 1;
  card: string;
  epoch: number;
  parentScope: number;
  skillIndex: number;
}

type BoundFrame = ScriptFrame & {
  counterSelfChoices?: CounterSelfChoices;
  counterSelfTax?: CounterSelfTax;
};

function effectFrame(frame: ScriptFrame): boolean {
  return frame.skillKind === "counter" && !frame.counterCost && !frame.saveVarsAs;
}

function outputNames(op: Op): string[] {
  if (!("as" in op) || typeof op.as !== "string") return [];
  return op.op === "choose"
    ? [op.as, `${op.as}Outside`, `${op.as}First`, `${op.as}Rest`]
    : [op.as];
}

/** Only immediate instructions belong to this activation, never delayed/granted bodies. */
export function counterNeedsSelfBinding(ops: readonly Op[]): boolean {
  let found = false;
  const walk = (body: readonly Op[], incoming: Set<string>): Set<string> => {
    const names = new Set(incoming);
    for (const op of body) {
      for (const name of outputNames(op)) names.delete(name);
      if (op.op === "choose" && op.sel.special === "self") names.add(op.as);
      if (op.op === "play" && (
        ("sel" in op.target && op.target.sel.special === "self") || ("var" in op.target && names.has(op.target.var))
      )) found = true;
      const branches = op.op === "if" ? [op.then, op.else ?? []]
        : op.op === "may" ? [op.ops, []]
        : op.op === "chooseMode" ? op.modes.map(mode => mode.ops)
        : [];
      if (branches.length) {
        const exits = branches.map(branch => walk(branch, names));
        names.clear();
        for (const exit of exits) for (const name of exit) names.add(name);
      }
    }
    return names;
  };
  walk(ops, new Set());
  return found;
}

export function newCounterSelfChoices(ops: readonly Op[]): CounterSelfChoices | undefined {
  return counterNeedsSelfBinding(ops) ? { version: 1, vars: {} } : undefined;
}

function validate(frame: BoundFrame): CounterSelfChoices {
  const witness = frame.counterSelfChoices;
  const source = frame.counterSource;
  if (
    !witness || witness.version !== 1 || !witness.vars ||
    typeof witness.vars !== "object" || Array.isArray(witness.vars) ||
    !source || source.version !== 1 || source.card !== frame.card ||
    !Number.isSafeInteger(source.epoch) || source.epoch < 0 ||
    Object.values(witness.vars).some(value => !value || value.card !== source.card || value.epoch !== source.epoch)
  ) rebuildScope("rebuild this saved Counter self-play occurrence binding");
  return witness;
}

/** Source ops detect old saves already past their self chooser or inside a spliced branch. */
export function requireCounterSelfBinding(frame: BoundFrame, script: Script | undefined): void {
  if (!effectFrame(frame)) return;
  if (frame.counterSelfChoices || counterNeedsSelfBinding(frame.ops) || !!script && counterNeedsSelfBinding(script.ops)) {
    validate(frame);
  }
}

/** Called at every canonical instruction entry, including after a saved chooser resumes. */
export function prepareCounterSelfBinding(frame: BoundFrame, op: Op): void {
  if (!effectFrame(frame) || !frame.counterSelfChoices) return;
  const witness = validate(frame);
  for (const name of outputNames(op)) delete witness.vars[name];
  if (op.op !== "choose") return;
  if (op.sel.special === "self") witness.vars[op.as] = { card: frame.card, epoch: frame.counterSource!.epoch };
}

/** A fresh ordinary target is not an implicit reference to this skill's original source. */
export function counterSelfPlayAllowed(
  frame: BoundFrame,
  target: Ref,
  card: string,
  epoch: number,
  area: string | null | undefined,
): boolean {
  if (!effectFrame(frame)) return true;
  const witness = frame.counterSelfChoices ? validate(frame) : undefined;
  const direct = "sel" in target && target.sel.special === "self";
  const bound = "var" in target && witness?.vars[target.var];
  if (!direct && !bound) return true;
  validate(frame);
  if ("var" in target && (!Array.isArray(frame.vars[target.var]) || frame.vars[target.var].some(id => id !== frame.card))) {
    rebuildScope("rebuild this saved Counter self-play variable binding");
  }
  return card === frame.card && frame.counterSource!.epoch === epoch && area === "drop";
}

/** Only a tax on this explicit self play belongs to its original source. */
export function counterSelfTaxBinding(frame: BoundFrame, target: Ref): CounterSelfTax | undefined {
  if (!effectFrame(frame)) return undefined;
  const direct = "sel" in target && target.sel.special === "self";
  const bound = "var" in target && frame.counterSelfChoices?.vars?.[target.var];
  if (!direct && !bound) return undefined;
  validate(frame);
  const scope = frame.skillEffectOrigin?.scope;
  if (!Number.isSafeInteger(scope) || scope! < 1 || !Number.isSafeInteger(frame.skillIndex) || frame.skillIndex! < 0) {
    rebuildScope("rebuild this Counter self-play tax owner");
  }
  return { version: 1, card: frame.card, epoch: frame.counterSource!.epoch, parentScope: scope!, skillIndex: frame.skillIndex! };
}

/** Cancel only a stale remaining tax child: its already-activated parent must resume. */
export function guardCounterSelfTaxPayment(
  state: VmState,
  frame: BoundFrame,
  sourceScript: (parent: ScriptFrame) => Script | undefined,
): boolean {
  if (frame.skillKind || frame.counterCost || frame.taxGate || frame.saveVarsAs || frame.skillPlayFinish) {
    if (frame.counterSelfTax) rebuildScope("rebuild this Counter self-play tax frame");
    return true;
  }
  const parents = state.programs.filter(parent => {
    if (parent.card !== frame.card || parent.master !== frame.master || parent.skillKind !== "counter") return false;
    const paid = parent.vars["§playTaxPaid"];
    if (paid !== undefined && (!Array.isArray(paid) || paid.some(card => typeof card !== "string"))) {
      rebuildScope("rebuild this saved Counter self-play tax receipt");
    }
    return paid?.includes(frame.card) ?? false;
  });
  const owners = parents.flatMap(parent => {
    requireCounterSelfBinding(parent, sourceScript(parent));
    const op = parent.ops[parent.ip];
    const expected = op?.op === "play" ? counterSelfTaxBinding(parent, op.target) : undefined;
    return expected ? [{ parent, expected }] : [];
  });
  const stamp = frame.counterSelfTax;
  if (!owners.length) {
    if (stamp) rebuildScope("rebuild this saved Counter self-play tax continuation");
    return true;
  }
  if (owners.length !== 1) rebuildScope("rebuild this ambiguous Counter self-play tax owner");
  const expected = owners[0].expected;
  if (!stamp || stamp.version !== 1 || stamp.card !== expected.card || stamp.epoch !== expected.epoch ||
    stamp.parentScope !== expected.parentScope || stamp.skillIndex !== expected.skillIndex) {
    rebuildScope("rebuild this saved Counter self-play tax source");
  }
  if (findCard(state, stamp.card)?.zone === "drop" && (state.cards[stamp.card]?.zoneEpoch ?? 0) === stamp.epoch) return true;
  state.lastChoice = null;
  state.lastMode = null;
  return false;
}
