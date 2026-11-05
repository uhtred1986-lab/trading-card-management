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
}
export interface MovementResult {
  version: 1;
  selected: { card: string; epoch: number }[];
  outcomes: MovementOutcome[];
}
export function startMovementResult(frame: ScriptFrame, name: string, selected: MovementResult["selected"]): void {
  const result: MovementResult = { version: 1, selected, outcomes: [] };
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
  const count = result.selected.filter(selected => result.outcomes.some(outcome => outcome.completed && outcome.card === selected.card && outcome.fromEpoch === selected.epoch)).length;
  return result.selected.length > 0 && count >= atLeast && (!all || count === result.selected.length);
}
function requireResult(value: MovementResult | undefined): asserts value is MovementResult {
  if (!value || value.version !== 1 || !Array.isArray(value.selected) || !Array.isArray(value.outcomes)
    || value.selected.some(item => !item || typeof item.card !== "string" || !Number.isSafeInteger(item.epoch) || item.epoch < 0)
    || new Set(value.selected.map(item => item.card)).size !== value.selected.length
    || value.outcomes.some(item => !item || typeof item.card !== "string" || !Number.isSafeInteger(item.fromEpoch) || item.fromEpoch < 0 || !Number.isSafeInteger(item.toEpoch) || item.toEpoch < 0
      || !(item.from === null || typeof item.from === "string") || !(item.to === null || typeof item.to === "string") || typeof item.completed !== "boolean"
      || !value.selected.some(selected => selected.card === item.card && selected.epoch === item.fromEpoch))
    || new Set(value.outcomes.map(item => item.card)).size !== value.outcomes.length) movementRebuild("rebuild this saved original-movement result");
}
export function movementRebuild(detail: string): never { throw new NotYet(detail, "#1249"); }

export function validateMovementResult(frame: ScriptFrame, name: string): void { requireResult(frame.movementResults?.[name]); }
/** Exact former one-card choice/move hinge; under-placement is a separate path. */
export function legacyMovementHinge(ops: readonly Op[]): boolean {
  return ops.some((op, index) => {
    if (index >= 2 && op.op === "if") {
      const choice = ops[index - 2], move = ops[index - 1];
      const cond = op.cond.kind === "not" ? op.cond.cond : op.cond;
      if (choice.op === "choose" && choice.sel.count === 1 && choice.sel.upTo && move.op === "moveTo" && move.to !== "under" && move.to !== "play" && "var" in move.target && move.target.var === choice.as && cond.kind === "chose" && cond.var === choice.as) return true;
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
    const expected: { name: string; to: string }[] = [];
    visitMoves(source.ops, op => { if (op.completedAs && "var" in op.target) expected.push({ name: op.target.var, to: op.to }); });
    visitMoves(frame.ops, op => {
      if (!op.completedAs && "var" in op.target && expected.some(item => item.name === (op.target as { var: string }).var && item.to === op.to)) movementRebuild("rebuild this saved skill's original-movement completion contract");
    });
  }
  for (const op of frame.ops.slice(0, frame.ip)) if (op.op === "moveTo" && op.completedAs) validateMovementResult(frame, op.completedAs);
}
