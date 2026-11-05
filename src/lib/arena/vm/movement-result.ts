/** R-426: an original movement's result, not a later area/choice inference. */
import type { Op, Script, ScriptFrame } from "./script";
import { NotYet } from "./errors";
export interface MovementOutcome {
  card: string;
  from: string | null;
  fromEpoch: number;
  to: string | null;
  toEpoch: number;
  completed: boolean;
  host?: { card: string; epoch: number };
}
export interface MovementResult {
  version: 1;
  selected: { card: string; epoch: number }[];
  outcomes: MovementOutcome[];
  /** Under-placement host occurrence captured before its chooser opens. */
  destination?: { card: string; epoch: number } | null;
}
export function underSelfMove(op: Op): boolean {
  return op.op === "moveTo" && op.to === "under" && !!op.completedAs && (!op.under || "sel" in op.under && op.under.sel.special === "self");
}
/** Only immediate self placements need the original source before a Counter scope suspends them. */
function hasUnderSelf(ops: readonly Op[]): boolean {
  return ops.some(op => underSelfMove(op) || (op.op === "if" ? hasUnderSelf(op.then) || hasUnderSelf(op.else ?? []) : op.op === "may" ? hasUnderSelf(op.ops) : op.op === "chooseMode" && op.modes.some(mode => hasUnderSelf(mode.ops))));
}
export function prepareUnderSource(frame: ScriptFrame, epoch: number): void {
  if (!hasUnderSelf(frame.ops)) return;
  const source = frame.underSource;
  if (source) {
    if (source.version !== 1 || source.card !== frame.card || !Number.isSafeInteger(source.epoch) || source.epoch < 0) movementRebuild("rebuild this saved under-placement source occurrence");
    return;
  }
  if (frame.ip > 0 || frame.awaiting || frame.skillEffectOrigin?.scope !== undefined) movementRebuild("rebuild this saved under-placement source before Counter timing");
  if (!Number.isSafeInteger(epoch) || epoch < 0) movementRebuild("rebuild this under-placement source occurrence");
  frame.underSource = { version: 1, card: frame.card, epoch };
}

export function startMovementResult(frame: ScriptFrame, name: string, selected: MovementResult["selected"], destination?: MovementResult["destination"]): void {
  const result: MovementResult = { version: 1, selected, outcomes: [], ...(destination !== undefined ? { destination } : {}) };
  requireResult(result);
  (frame.movementResults ??= {})[name] = result;
}
export function recordMovementResult(frame: ScriptFrame, name: string, outcome: MovementOutcome): void {
  const result = frame.movementResults?.[name];
  requireResult(result);
  if (!result.selected.some(item => item.card === outcome.card && item.epoch === outcome.fromEpoch)) return;
  if (result.outcomes.some(item => item.card === outcome.card && item.fromEpoch === outcome.fromEpoch)) return;
  result.outcomes.push(outcome);
}
export function completedMovement(frame: ScriptFrame, name: string, atLeast = 1, all = false): boolean {
  const result = frame.movementResults?.[name];
  requireResult(result);
  const count = result.selected.filter(selected => result.outcomes.some(outcome => outcome.completed && (result.destination === undefined || !!result.destination && outcome.host?.card === result.destination.card && outcome.host.epoch === result.destination.epoch) && outcome.card === selected.card && outcome.fromEpoch === selected.epoch)).length;
  return result.selected.length > 0 && count >= atLeast && (!all || count === result.selected.length);
}
function requireResult(value: MovementResult | undefined): asserts value is MovementResult {
  if (!value || value.version !== 1 || !Array.isArray(value.selected) || !Array.isArray(value.outcomes)
    || value.selected.some(item => !item || typeof item.card !== "string" || !Number.isSafeInteger(item.epoch) || item.epoch < 0)
    || value.destination !== undefined && value.destination !== null && (typeof value.destination.card !== "string" || !Number.isSafeInteger(value.destination.epoch) || value.destination.epoch < 0)
    || new Set(value.selected.map(item => item.card)).size !== value.selected.length
    || value.outcomes.some(item => !item || typeof item.card !== "string" || !Number.isSafeInteger(item.fromEpoch) || item.fromEpoch < 0 || !Number.isSafeInteger(item.toEpoch) || item.toEpoch < 0
      || item.host !== undefined && (!item.host || typeof item.host.card !== "string" || !Number.isSafeInteger(item.host.epoch) || item.host.epoch < 0)
      || !(item.from === null || typeof item.from === "string") || !(item.to === null || typeof item.to === "string") || typeof item.completed !== "boolean"
      || !value.selected.some(selected => selected.card === item.card && selected.epoch === item.fromEpoch))
    || new Set(value.outcomes.map(item => item.card)).size !== value.outcomes.length) movementRebuild("rebuild this saved original-movement result");
}
export function movementRebuild(detail: string): never { throw new NotYet(detail, "#1249"); }

export function validateMovementResult(frame: ScriptFrame, name: string): void { requireResult(frame.movementResults?.[name]); }
export function movementDestination(frame: ScriptFrame, name: string): NonNullable<MovementResult["destination"]> | null {
  const result = frame.movementResults?.[name];
  requireResult(result);
  if (result.destination === undefined) movementRebuild("rebuild this saved under-placement host occurrence");
  return result.destination;
}
/** Exact former one-card choice/move hinge; under-placement is a separate path. */
export function legacyMovementHinge(ops: readonly Op[]): boolean {
  return ops.some((op, index) => {
    if (index >= 2 && op.op === "if") {
      const choice = ops[index - 2], move = ops[index - 1];
      const cond = op.cond.kind === "not" ? op.cond.cond : op.cond;
      if (choice.op === "choose" && choice.sel.count === 1 && choice.sel.upTo && move.op === "moveTo" && !move.completedAs && move.to !== "play" && "var" in move.target && move.target.var === choice.as && cond.kind === "chose" && cond.var === choice.as) return true;
    }
    return op.op === "if" ? legacyMovementHinge(op.then) || legacyMovementHinge(op.else ?? []) : op.op === "may" || op.op === "delay" ? legacyMovementHinge(op.ops) : op.op === "chooseMode" ? op.modes.some(mode => legacyMovementHinge(mode.ops)) : false;
  });
}
function visitMoves(ops: readonly Op[], accept: (op: Extract<Op, { op: "moveTo" }>) => void): void {
  for (const op of ops) {
    if (op.op === "moveTo") accept(op);
    else if (op.op === "if") { visitMoves(op.then, accept); visitMoves(op.else ?? [], accept); }
    else if (op.op === "may" || op.op === "delay") visitMoves(op.ops, accept);
    else if (op.op === "chooseMode") for (const mode of op.modes) visitMoves(mode.ops, accept);
  }
}
export function requireMovementResults(frame: ScriptFrame, source: Script | undefined): void {
  if (source) {
    const expectedSwitches = new Set<string>();
    const visitSwitches = (ops: readonly Op[], check: boolean): void => {
      for (const op of ops) {
        if (op.op === "switchMode") {
          if (!check && op.completedAs) expectedSwitches.add(JSON.stringify(op.target));
          if (check && !op.completedAs && expectedSwitches.has(JSON.stringify(op.target))) movementRebuild("rebuild this saved original switch completion contract");
        } else if (op.op === "if") { visitSwitches(op.then, check); visitSwitches(op.else ?? [], check); }
        else if (op.op === "may" || op.op === "delay") visitSwitches(op.ops, check);
      }
    };
    visitSwitches(source.ops, false); visitSwitches(frame.ops, true);
    if (expectedSwitches.size) {
      const hasSwitch = (cond: import("./script").Cond): boolean => cond.kind === "switched" || cond.kind === "all" && cond.conds.some(hasSwitch);
      const checkHinges = (ops: readonly Op[]): void => {
        for (const op of ops) if (op.op === "if") {
          if (op.then.some(child => child.op === "negateAttack") && !hasSwitch(op.cond)) movementRebuild("rebuild this saved composite completion hinge");
          checkHinges(op.then); checkHinges(op.else ?? []);
        }
      };
      checkHinges(frame.ops);
    }
    const expected: { target: string; to: string }[] = [];
    visitMoves(source.ops, op => { if (op.completedAs) expected.push({ target: JSON.stringify(op.target), to: op.to }); });
    visitMoves(frame.ops, op => {
      if (!op.completedAs && expected.some(item => item.target === JSON.stringify(op.target) && item.to === op.to)) movementRebuild("rebuild this saved skill's original-movement completion contract");
    });
  }
  for (const op of frame.ops.slice(0, frame.ip)) if (op.op === "moveTo" && op.completedAs) validateMovementResult(frame, op.completedAs);
}

/** R-429: exact self departure in a composite offer retains its original occurrence. */
export function selfCompletionMove(op: Op): boolean {
  return op.op === "moveTo" && !!op.completedAs && op.to !== "under" && op.to !== "play" && "sel" in op.target && Object.keys(op.target.sel).length === 1 && op.target.sel.special === "self";
}
export function prepareCompletionSource(frame: ScriptFrame, epoch: number): void {
  let required = false;
  visitMoves(frame.ops, op => { if (selfCompletionMove(op)) required = true; });
  if (!required) return;
  const saved = frame.completionSource;
  if (saved) {
    if (saved.version !== 1 || saved.card !== frame.card || !Number.isSafeInteger(saved.epoch) || saved.epoch < 0) movementRebuild("rebuild this composite source occurrence");
    return;
  }
  if (frame.ip > 0 || frame.awaiting || frame.skillEffectOrigin?.scope !== undefined || !Number.isSafeInteger(epoch) || epoch < 0) movementRebuild("rebuild this saved composite source before the offer");
  frame.completionSource = { version: 1, card: frame.card, epoch };
}
export function completedSwitch(frame: ScriptFrame, name: string): boolean {
  const result = frame.switchResults?.[name];
  if (!result || result.version !== 1 || typeof result.completed !== "boolean") movementRebuild("rebuild this saved original switch completion");
  return result.completed;
}
