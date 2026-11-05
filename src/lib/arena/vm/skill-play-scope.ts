import { counterChoiceTail } from "./counter-continuation";
/** Serialized lifetime of one immediate skill effect (RM 4-3-2-3/4).
 * Future/delayed/granted skills have their own lifetime, never this one's.
 */
import type { Op, Ref, Script, ScriptFrame, Selector } from "./script";
import type { PlayerId } from "../types";
import type { VmResolving, VmState } from "./state";
import { NotYet } from "./errors";
import type { VmPending, VmPendingRecord } from "./triggers";

export type ArrivalBound = 0 | 1 | "many";
export interface ImmediatePlayProfile { arrivals: ArrivalBound; tokens: boolean; explicitWindow: boolean }
export interface SkillEffectOrigin {
  version: 1 | 2;
  kind: "activate" | "auto" | "counter" | "delayed" | "hook" | "replacement";
  scope?: number;
}
export interface SkillPlayScope {
  purpose?: "counterContinuation";
  version: 2;
  id: number;
  parent?: number;
  master: PlayerId;
  source: string;
  skillIndex?: number;
  profile: ImmediatePlayProfile;
  phase: "before" | "effect" | "after";
  played: { card: string; epoch: number }[];
  canceled?: true;
  bindings?: ScriptFrame[];
  retainedCounters?: import("./retained-counter").RetainedCounter[];
  window?: { programs: ScriptFrame[]; resolving: VmResolving | null };
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
  if (![1, 2].includes(origin.version) || !["activate", "auto", "counter", "delayed", "hook", "replacement"].includes(origin.kind)) rebuildScope("rebuild this saved skill-effect provenance");
  const profile = immediatePlayProfile(frame.ops);
  const continuation = origin.kind === "counter" && !!frame.counterPlay && counterChoiceTail(frame.ops);
  // Version 1 certified lifetime ancestry only, before shared timing existed.
  // A non-play effect needs no new timing; an affected active root must rebuild.
  if (origin.scope === undefined && (!profile.arrivals && !continuation || frame.viaKeyword || frame.declaredPlay || profile.explicitWindow && origin.kind === "hook")) return null;
  if (origin.version !== 2) rebuildScope("rebuild this saved skill effect for shared Counter timing version 2");
  if (origin.scope !== undefined) {
    validateScopeStack(state);
    const scope = state.skillPlayScopes?.at(-1);
    if (scope?.purpose === "counterContinuation" && origin.kind !== "counter") rebuildScope("rebuild this Counter continuation provenance");
    if (!scope || scope.id !== origin.scope) rebuildScope("rebuild this saved skill-play continuation");
    return scope;
  }
  validateScopeStack(state);
  const scopes = state.skillPlayScopes ??= [];
  const parent = scopes.at(-1)?.id;
  const id = (state.nextSkillPlayScope ?? 0) + 1;
  state.nextSkillPlayScope = id;
  const scope: SkillPlayScope = { version: 2, id, ...(continuation ? { purpose: "counterContinuation" as const } : {}), ...(parent === undefined ? {} : { parent }), master: frame.master, source: frame.card, ...(frame.skillIndex === undefined ? {} : { skillIndex: frame.skillIndex }), profile, phase: continuation ? "effect" : "before", played: [] };
  scopes.push(scope);
  if (continuation) frame.counterChoice = { version: 1 };
  frame.skillEffectOrigin = { ...origin, scope: id };
  // The runner already removed the root. Everything it interrupts with is
  // placed before this boundary, including a nested invoked skill's scope.
  state.programs.unshift({ ops: [], ip: 0, vars: {}, card: frame.card, master: frame.master, skillPlayFinish: { version: 1, scope: id } });
  return scope;
}

export function finishSkillPlayScope(state: VmState, frame: ScriptFrame): void {
  scopeForFinish(state, frame);
  state.skillPlayScopes!.pop();
  if (!state.skillPlayScopes!.length) delete state.skillPlayScopes;
}
export function scopeForFinish(state: VmState, frame: ScriptFrame): SkillPlayScope {
  validateScopeStack(state);
  const finish = frame.skillPlayFinish;
  const scope = state.skillPlayScopes?.at(-1);
  if (!finish || finish.version !== 1 || !scope || scope.version !== 2 || scope.id !== finish.scope) rebuildScope("rebuild this saved skill-play boundary");
  return scope;
}

/** Old queued roots have no trustworthy before/after cursor. Do not restart
 * an affected skill halfway through it, or reinterpret native/payment frames. */
export function requireSkillEffectOrigin(frame: ScriptFrame, source: Script | undefined, sourceScripts: Script[] = []): void {
  if (frame.skillPlayInternal && (frame.skillPlayInternal.version !== 1 || frame.skillPlayInternal.kind !== "arrivalBinding")) rebuildScope("rebuild this saved arrival-binding provenance");
  if (frame.skillEffectOrigin || frame.skillPlayInternal || frame.skillPlayFinish || frame.declaredPlay || frame.viaKeyword || frame.saveVarsAs || frame.replacing || frame.fusionIdentity || frame.evolutionIdentity || frame.absorbIdentity || frame.potaraIdentity) return;
  if (source?.kind === "keyword") return;
  if (source && immediatePlayProfile(source.ops).arrivals || immediatePlayProfile(frame.ops).arrivals && !(frame.pendingHookSkill && immediatePlayProfile(frame.ops).explicitWindow)) rebuildScope("rebuild this saved skill effect before its Counter timing");
  const delayedArrival = (ops: readonly Op[]): boolean => ops.some(op => op.op === "delay" ? !!immediatePlayProfile(op.ops).arrivals && expandedBodyMatches(op.ops, frame.ops) : op.op === "if" ? delayedArrival(op.then) || delayedArrival(op.else ?? []) : op.op === "may" ? delayedArrival(op.ops) : op.op === "chooseMode" && op.modes.some(mode => delayedArrival(mode.ops)));
  if (sourceScripts.some(script => delayedArrival(script.ops))) rebuildScope("rebuild this saved delayed play before its Counter timing");
}

/** Branch expansion rewrites a saved frame's ops in place. Match the whole
 * resulting body, rather than assuming every frame from this card is its
 * delayed play. The finite position sets avoid enumerating branch products. */
function expandedBodyMatches(body: readonly Op[], actual: readonly Op[]): boolean {
  const words = actual.map(op => JSON.stringify(op));
  const walk = (ops: readonly Op[], start: number): Set<number> => {
    let positions = new Set([start]);
    for (const op of ops) {
      const next = new Set<number>();
      for (const at of positions) {
        if (words[at] === JSON.stringify(op)) next.add(at + 1);
        const branches = op.op === "if" ? [op.then, op.else ?? []] : op.op === "may" ? [op.ops, []] : op.op === "chooseMode" ? op.modes.map(mode => mode.ops) : [];
        for (const branch of branches) for (const end of walk(branch, at)) next.add(end);
      }
      positions = next;
      if (!positions.size) break;
    }
    return positions;
  };
  return actual.length > 0 && walk(body, 0).has(actual.length);
}

/** A window suspends the complete queue, so neither a parent tail nor its
 * finish boundary can overtake the held skill or the answering Counter. */
export function releaseSkillPlayWindow(state: VmState): boolean {
  const window = state.resolving?.scopeWindow;
  if (!window) return false;
  const scope = state.skillPlayScopes?.find(s => s.id === window.scope);
  if (!scope?.window || state.programs.length) rebuildScope("rebuild this saved skill-play window continuation");
  const saved = scope.window;
  delete scope.window;
  scope.phase = window.boundary === "before" ? "effect" : "after";
  state.resolving = saved.resolving;
  state.programs.push(...saved.programs);
  return true;
}

export function witnessArrivalAutos(state: VmState, scope: SkillPlayScope, card: string, before: Set<VmPendingRecord>): void {
  const arrival = { card, epoch: state.cards[card].zoneEpoch ?? 0 };
  for (const pending of state.pending) {
    if (before.has(pending) || pending.kind === "hook" || !state.cards[pending.card]) continue;
    pending.arrivalWitness = { version: 1, scope: scope.id, skillIndex: pending.skillIndex, arrival, source: { card: pending.card, epoch: state.cards[pending.card].zoneEpoch ?? 0 } };
  }
}
export function arrivalAutoWasActive(pending: VmPending): boolean {
  const witness = pending.arrivalWitness;
  if (!witness) return false;
  if (witness.version !== 1 || witness.source.card !== pending.card || witness.skillIndex !== pending.skillIndex || !Number.isSafeInteger(witness.scope) || witness.scope < 1 || !Number.isSafeInteger(witness.source.epoch) || witness.source.epoch < 0 || !Number.isSafeInteger(witness.arrival.epoch) || witness.arrival.epoch < 0) rebuildScope("rebuild this saved arrival Auto witness");
  // This is historical evidence, not a requirement that the source remains
  // in that area. RM 9-6-11 preserves the already-pending skill after movement.
  return true;
}

export function validateScopeStack(state: VmState): void {
  const scopes = state.skillPlayScopes ?? [];
  if (state.nextSkillPlayScope !== undefined && (!Number.isSafeInteger(state.nextSkillPlayScope) || state.nextSkillPlayScope < 0)) rebuildScope("rebuild this saved skill-play sequence");
  for (let i = 0; i < scopes.length; i++) {
    const scope = scopes[i];
    if (!["before", "effect", "after"].includes(scope.phase) || !scope.profile || ![0, 1, "many"].includes(scope.profile.arrivals) || typeof scope.profile.tokens !== "boolean" || typeof scope.profile.explicitWindow !== "boolean" || !Array.isArray(scope.played) || scope.played.some(p => typeof p.card !== "string" || !Number.isSafeInteger(p.epoch) || p.epoch < 0)) rebuildScope("rebuild this saved skill-play state");
    if (scope.purpose !== undefined && (scope.purpose !== "counterContinuation" || scope.profile.arrivals !== 0 || scope.profile.tokens || scope.profile.explicitWindow || scope.window || scope.played.length || scope.phase !== "effect")) rebuildScope("rebuild this saved Counter continuation lifetime");
    if (scope.window && (!Array.isArray(scope.window.programs) || scope.phase === "effect")) rebuildScope("rebuild this saved skill-play window state");
    if (scope.version !== 2 || !Number.isSafeInteger(scope.id) || scope.id < 1 || scope.id > (state.nextSkillPlayScope ?? 0) || scope.parent !== scopes[i - 1]?.id || i > 0 && scope.id <= scopes[i - 1].id) rebuildScope("rebuild this saved skill-play ancestry");
  }
}

export function rebuildScope(detail: string): never {
  throw new NotYet(detail, "#907");
}
