/** Serialized lifetime of one immediate skill effect (RM 4-3-2-3/4).
 * Future/delayed/granted skills have their own lifetime, never this one's.
 */
import type { Op, Ref, ScriptFrame, Selector } from "./script";
import type { PlayerId } from "../types";
import type { VmState } from "./state";
import { NotYet } from "./errors";

export type ArrivalBound = 0 | 1 | "many";
export interface ImmediatePlayProfile { arrivals: ArrivalBound; tokens: boolean; explicitWindow: boolean }
export interface SkillEffectOrigin {
  version: 1;
  kind: "activate" | "auto" | "counter";
  scope?: number;
}
export interface SkillPlayScope {
  version: 1;
  id: number;
  parent?: number;
  master: PlayerId;
  source: string;
  skillIndex?: number;
  profile: ImmediatePlayProfile;
  phase: "before" | "effect" | "after";
  played: { card: string; epoch: number }[];
}

const add = (a: ArrivalBound, b: ArrivalBound): ArrivalBound => a === "many" || b === "many" || a + b > 1 ? "many" : (a + b) as 0 | 1;
const max = (a: ArrivalBound, b: ArrivalBound): ArrivalBound => a === "many" || b === "many" ? "many" : Math.max(a, b) as 0 | 1;
const numberBound = (n: unknown): ArrivalBound => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1 ? n === 0 ? 0 : 1 : "many";
type Bindings = Record<string, ArrivalBound>;
function selectorBound(sel: Selector, vars: Bindings): ArrivalBound {
  if (sel.alsoFrom?.length) return "many";
  if (sel.special === "self" || sel.special === "subject" || sel.special === "resolving") return 1;
  if (typeof sel.take === "number") return numberBound(sel.take);
  return sel.fromVar ? vars[sel.fromVar] ?? "many" : "many";
}
function refBound(ref: Ref, vars: Bindings): ArrivalBound {
  return "var" in ref ? vars[ref.var] ?? "many" : selectorBound(ref.sel, vars);
}

/** Conservative upper bound, including mutually exclusive paths. A missing
 * binding means many, never an optimistic single-card assumption. */
export function immediatePlayProfile(ops: readonly Op[], initial: Bindings = {}): ImmediatePlayProfile {
  const walk = (body: readonly Op[], vars: Bindings): ImmediatePlayProfile => {
    const out: ImmediatePlayProfile = { arrivals: 0, tokens: false, explicitWindow: false };
    const include = (next: ImmediatePlayProfile) => {
      out.arrivals = add(out.arrivals, next.arrivals);
      out.tokens ||= next.tokens;
      out.explicitWindow ||= next.explicitWindow;
    };
    for (const op of body) {
      if (op.op === "choose") vars[op.as] = op.exactly !== undefined ? numberBound(op.exactly) : op.sel.count !== undefined ? numberBound(op.sel.count) : selectorBound(op.sel, vars);
      else if (op.op === "reveal") vars[op.as] = selectorBound(op.sel, vars);
      else if (op.op === "look") vars[op.as] = numberBound(op.n);
      else if (op.op === "play" && !op.activating) include({ arrivals: refBound(op.target, vars), tokens: false, explicitWindow: !!op.counterWindow || !!op.using });
      else if (op.op === "token") {
        const bound = numberBound(op.n);
        include({ arrivals: bound, tokens: true, explicitWindow: false });
        if (op.as) vars[op.as] = bound;
      } else if (op.op === "if" || op.op === "may" || op.op === "chooseMode") {
        const alternatives = op.op === "if" ? [op.then, op.else ?? []] : op.op === "may" ? [op.ops, []] : op.modes.map(mode => mode.ops);
        const branches = alternatives.map(body => { const bindings = { ...vars }; return { bindings, profile: walk(body, bindings) }; });
        const combined = branches.reduce<ImmediatePlayProfile>((p, b) => ({ arrivals: max(p.arrivals, b.profile.arrivals), tokens: p.tokens || b.profile.tokens, explicitWindow: p.explicitWindow || b.profile.explicitWindow }), { arrivals: 0, tokens: false, explicitWindow: false });
        include(combined);
        for (const key of new Set(branches.flatMap(b => Object.keys(b.bindings)))) vars[key] = branches.reduce<ArrivalBound>((bound, branch) => max(bound, branch.bindings[key] ?? "many"), 0);
      }
      // In particular: invokeSkill, activating play, delay and granted skills
      // are not traversed. Their effects are independently activated roots.
    }
    return out;
  };
  return walk(ops, { ...initial });
}

export function startSkillPlayScope(state: VmState, frame: ScriptFrame): SkillPlayScope | null {
  const origin = frame.skillEffectOrigin;
  if (!origin) return null;
  if (origin.version !== 1) rebuildScope("rebuild this saved skill-effect provenance");
  if (origin.scope !== undefined) {
    validateScopeStack(state);
    const scope = state.skillPlayScopes?.at(-1);
    if (!scope || scope.id !== origin.scope) rebuildScope("rebuild this saved skill-play continuation");
    return scope;
  }
  const profile = immediatePlayProfile(frame.ops);
  // Declared and keyword-specific timings retain their existing owner.
  if (!profile.arrivals || profile.explicitWindow || frame.viaKeyword || frame.declaredPlay) return null;
  validateScopeStack(state);
  const scopes = state.skillPlayScopes ??= [];
  const parent = scopes.at(-1)?.id;
  const id = (state.nextSkillPlayScope ?? 0) + 1;
  state.nextSkillPlayScope = id;
  const scope: SkillPlayScope = { version: 1, id, ...(parent === undefined ? {} : { parent }), master: frame.master, source: frame.card, ...(frame.skillIndex === undefined ? {} : { skillIndex: frame.skillIndex }), profile, phase: "effect", played: [] };
  scopes.push(scope);
  frame.skillEffectOrigin = { ...origin, scope: id };
  // The runner already removed the root. Everything it interrupts with is
  // placed before this boundary, including a nested invoked skill's scope.
  state.programs.unshift({ ops: [], ip: 0, vars: {}, card: frame.card, master: frame.master, skillPlayFinish: { version: 1, scope: id } });
  return scope;
}

export function finishSkillPlayScope(state: VmState, frame: ScriptFrame): void {
  validateScopeStack(state);
  const finish = frame.skillPlayFinish;
  const scope = state.skillPlayScopes?.at(-1);
  if (!finish || finish.version !== 1 || !scope || scope.version !== 1 || scope.id !== finish.scope) rebuildScope("rebuild this saved skill-play boundary");
  state.skillPlayScopes!.pop();
  if (!state.skillPlayScopes!.length) delete state.skillPlayScopes;
}

function validateScopeStack(state: VmState): void {
  const scopes = state.skillPlayScopes ?? [];
  if (state.nextSkillPlayScope !== undefined && (!Number.isSafeInteger(state.nextSkillPlayScope) || state.nextSkillPlayScope < 0)) rebuildScope("rebuild this saved skill-play sequence");
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i];
    if (scope.version !== 1 || !Number.isSafeInteger(scope.id) || scope.id < 1 || scope.id > (state.nextSkillPlayScope ?? 0) || scope.parent !== scopes[i - 1]?.id || i > 0 && scope.id <= scopes[i - 1].id) rebuildScope("rebuild this saved skill-play ancestry");
  }
}

function rebuildScope(detail: string): never {
  throw new NotYet(detail, "#907");
}
