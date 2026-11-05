import { counterChoiceTail } from "./counter-continuation";
/** Counter effects that modify a future arrival (RM 9-10; FAQ BT1-110).
 * Mixed conditional tails deliberately require a resumable deferred-effect
 * owner, not an approximation that finishes a Counter before its self-play.
 */
import { stepScript, type Cond, type Op, type ScriptFrame } from "./script";
import { negateAs, replaceAs } from "./script-schema";
import type { ScriptHost } from "./script-host";
import { rebuildScope, type SkillPlayScope } from "./skill-play-scope";

export function referencesResolving(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(referencesResolving);
  const object = value as Record<string, unknown>;
  return object.special === "resolving" || Object.values(object).some(referencesResolving);
}
const normalize = (op: Op): Op => replaceAs(negateAs(op));
function directResolving(op: Op): boolean {
  return "target" in op && !!op.target && "sel" in op.target && op.target.sel.special === "resolving";
}
function pureArrival(op: Op): boolean {
  op = normalize(op);
  if (op.op === "resolvingPlay") return true;
  if (op.op === "negateSkills") return op.until === "turn" && directResolving(op);
  if (op.op === "switchMode") return directResolving(op);
  if (op.op === "if") return op.then.every(pureArrival) && (op.else ?? []).every(pureArrival);
  return false;
}
export function retainedCounterShape(ops: readonly Op[]): boolean {
  if (counterChoiceTail(ops)) return true;
  if (ops.length !== 1) return false;
  const root = ops[0];
  if (root.op !== "if" || root.else || root.cond.kind !== "count" || root.cond.sel.special !== "resolving" || root.then.length !== 3) return false;
  const [transform, choice, play] = root.then;
  return pureArrival(transform) && choice.op === "choose" && choice.sel.special === "self" && Object.keys(choice.sel).length === 1 && play.op === "play" && !play.activating && "var" in play.target && play.target.var === choice.as && Object.keys(play).every(key => ["op", "target"].includes(key));
}
export function counterBindingProblem(ops: readonly Op[], tokens = false, retainSingle = false): string | null {
  if (retainSingle && !tokens && retainedCounterShape(ops)) return null;
  for (const original of ops) {
    const op = normalize(original);
    if (op.op === "delay") {
      if (referencesResolving(op)) return "a delayed effect requiring the future played-card occurrence";
      continue;
    }
    if (tokens && op.op === "switchMode" && directResolving(op)) return "a token arrival followed by a deferred switch";
    if (op.op === "if") {
      if (referencesResolving(op.cond) && !pureArrival(op)) return "a Counter's future-card condition with a deferred effect tail";
      const problem = counterBindingProblem(op.then, tokens) ?? counterBindingProblem(op.else ?? [], tokens);
      if (problem) return problem;
    } else if (op.op === "may" || op.op === "chooseMode") {
      const dependsOnArrival = (body: readonly Op[]): boolean => body.some(original => {
        const child = normalize(original);
        return child.op === "resolvingPlay" || referencesResolving(child) || child.op === "if" && (dependsOnArrival(child.then) || dependsOnArrival(child.else ?? [])) || child.op === "may" && dependsOnArrival(child.ops) || child.op === "chooseMode" && child.modes.some(mode => dependsOnArrival(mode.ops));
      });
      if ((op.op === "may" ? [op.ops] : op.modes.map(mode => mode.ops)).some(dependsOnArrival)) return "an optional or modal Counter transformation requiring an arrival-time choice";
      for (const branch of op.op === "may" ? [op.ops] : op.modes.map(m => m.ops)) {
        const problem = counterBindingProblem(branch, tokens); if (problem) return problem;
      }
    } else if (referencesResolving(op) && !pureArrival(op)) return "a Counter's choice or mixed effect referring to a future played card";
  }
  return null;
}
function freezeCond(h: ScriptHost, frame: ScriptFrame, cond: Cond): Cond {
  if (!referencesResolving(cond)) return { kind: h.condHolds(frame, cond) ? "all" : "any", conds: [] };
  if (cond.kind === "all" || cond.kind === "any") return { ...cond, conds: cond.conds.map(c => freezeCond(h, frame, c)) };
  if (cond.kind === "not") return { ...cond, cond: freezeCond(h, frame, cond.cond) };
  return structuredClone(cond);
}
export function freezeOp(h: ScriptHost, frame: ScriptFrame, op: Op): Op {
  op = normalize(op);
  if (op.op === "if") return { ...op, cond: freezeCond(h, frame, op.cond), then: op.then.map(o => freezeOp(h, frame, o)), ...(op.else ? { else: op.else.map(o => freezeOp(h, frame, o)) } : {}) };
  // Direct preentry negation must survive the area change (FAQ BT1-107).
  if (op.op === "negateSkills" && op.until === "turn" && directResolving(op) && "sel" in op.target) {
    return { op: "if", cond: { kind: "count", sel: structuredClone(op.target.sel), atLeast: 1 }, then: [{ op: "resolvingPlay", negated: true }] };
  }
  return structuredClone(op);
}
export function deferArrivalOperation(h: ScriptHost, scope: SkillPlayScope, frame: ScriptFrame, op: Op): boolean {
  const relevant = op.op === "if" ? referencesResolving(op.cond) : op.op === "resolvingPlay" || directResolving(op);
  if (!relevant || !pureArrival(op)) return false;
  const binding: ScriptFrame = { ops: [freezeOp(h, frame, op)], ip: 0, vars: structuredClone(frame.vars), card: frame.card, master: frame.master, skillKind: "counter", counterPlay: true, skillPlayInternal: { version: 1, kind: "arrivalBinding" }, ...(frame.skillIndex === undefined ? {} : { skillIndex: frame.skillIndex }), usage: frame.usage, validity: frame.validity };
  (scope.bindings ??= []).push(binding);
  return true;
}

/** All admitted bindings are choice-free transformations. Their conditions
 * observe the actual incoming card, even if Deflect protects it from acting. */
export function applyArrivalBindings(h: ScriptHost, scope: SkillPlayScope, protectedCard: (binding: ScriptFrame) => boolean, from = 0, to = scope.bindings?.length ?? 0): void {
  for (const stored of (scope.bindings ?? []).slice(from, to)) {
    if (stored.skillPlayInternal?.version !== 1 || stored.skillPlayInternal.kind !== "arrivalBinding" || stored.counterPlay !== true || stored.ip !== 0 || !stored.ops.length || !stored.ops.every(pureArrival) || stored.skillEffectOrigin || stored.counterAnswerScope !== undefined) rebuildScope("rebuild this saved arrival transformation");
    const host: ScriptHost = protectedCard(stored) ? { ...h, resolvingCard: () => null, resolveRef: () => [], replaceResolvingPlay: () => undefined } : h;
    const result = stepScript(host, structuredClone(stored));
    if (result !== "done") throw new Error("an admitted arrival transformation requested a choice");
  }
}
