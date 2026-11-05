/** R435 repeatable effects have separate template and execution lifetimes. */
import type { ScriptFrame } from "./script";
import type { VmState } from "./state";
import type { ScriptHost } from "./script-host";
import { rebuildScope, validateScopeStack, type SkillPlayScope } from "./skill-play-scope";
import { captureCounterArrivalTemplate, counterArrivalExecutionFrame, counterArrivalTemplateProblem, type CounterArrivalTemplate } from "./counter-arrival-template";
import { counterArrivalBatchProblem } from "./counter-arrival-batch";
import { counterArrivalDescriptor } from "./counter-arrival-policy";
import { canonicalTaxValue } from "./tax-receipt";

export type CounterArrivalDecision = { version: 1; scope: number; arrival: { card: string; epoch: number }; accepting?: true; candidates?: { card: string; epoch: number }[] } &
  ({ kind: "repeat"; owner: number; binding: number } | { kind: "direct" });
export interface CounterArrivalBatchResume {
  version: 1;
  owner: number;
  cards: string[];
  options: Parameters<ScriptHost["playThen"]>[1];
  frame: ScriptFrame;
}
export interface CounterArrivalResume {
  version: 1;
  owner: number;
  binding: number;
  child: number;
  cards: string[];
  options: Parameters<ScriptHost["playThen"]>[1];
  frame: ScriptFrame;
}

export function checkedCounterArrivalTemplates(owner: SkillPlayScope): CounterArrivalTemplate[] {
  const entries = owner.arrivalCounters ?? [];
  if (!Array.isArray(entries)) rebuildScope("rebuild this per-arrival Counter template list");
  const ids = new Set<number>();
  let at = -1;
  for (const entry of entries) {
    const problem = counterArrivalTemplateProblem(entry, owner.id, owner.bindings?.length ?? 0);
    if (problem || ids.has(entry.id) || entry.at < at) rebuildScope(problem ?? "rebuild this per-arrival Counter template order");
    ids.add(entry.id);
    at = entry.at;
  }
  return entries;
}

export function retainCounterArrivalTemplate(state: VmState, owner: SkillPlayScope, frame: ScriptFrame): void {
  validateScopeStack(state);
  const scope = state.skillPlayScopes?.at(-1);
  if (!scope || scope.parent !== owner.id || scope.id !== frame.skillEffectOrigin?.scope || scope.purpose !== "counterArrivalDecision" ||
    scope.phase !== "effect" || scope.window || state.skillPlayScopes?.at(-2) !== owner) {
    rebuildScope("rebuild the activated per-arrival Counter lifetime");
  }
  checkedCounterArrivalTemplates(owner);
  const template = captureCounterArrivalTemplate(frame, scope.id, owner.bindings?.length ?? 0);
  if (!template) rebuildScope("rebuild the activated per-arrival Counter template");
  const finish = state.programs.findIndex(item => item.skillPlayFinish?.scope === scope.id);
  if (finish < 0) rebuildScope("rebuild the per-arrival Counter finish boundary");
  state.programs.splice(finish, 1);
  state.skillPlayScopes!.pop();
  (owner.arrivalCounters ??= []).push(template);
}

/** The host has suspended this one original arrival before calling here. */
export function beginCounterArrivalDecision(
  state: VmState, owner: SkillPlayScope, template: CounterArrivalTemplate,
  arrival: { card: string; epoch: number },
  resume: Omit<CounterArrivalResume, "version" | "owner" | "binding" | "child">,
): void {
  validateScopeStack(state);
  if (state.skillPlayScopes?.at(-1) !== owner || !checkedCounterArrivalTemplates(owner).includes(template) ||
    template.state !== "ready" || !state.cards[arrival.card] || (state.cards[arrival.card].zoneEpoch ?? 0) !== arrival.epoch) {
    rebuildScope("rebuild this per-arrival Counter execution start");
  }
  const child = (state.nextSkillPlayScope ?? 0) + 1;
  state.nextSkillPlayScope = child;
  template.state = "running";
  template.active = { version: 1, owner: owner.id, binding: template.id, scope: child, arrival: { ...arrival } };
  const scope: SkillPlayScope = {
    version: 2, id: child, parent: owner.id, purpose: "counterArrivalDecision", master: template.master,
    source: template.card, skillIndex: template.skillIndex,
    profile: { arrivals: 0, tokens: false, explicitWindow: false }, phase: "effect", played: [],
  };
  const frame = counterArrivalExecutionFrame(template, child);
  frame.arrivalDecision = { version: 1, kind: "repeat", owner: owner.id, binding: template.id, scope: child, arrival: { ...arrival } };
  state.skillPlayScopes!.push(scope);
  state.programs.unshift(frame,
    { ops: [], ip: 0, vars: {}, card: frame.card, master: frame.master, skillPlayFinish: { version: 1, scope: child } },
    { ops: [], ip: 0, vars: {}, card: resume.frame.card, master: resume.frame.master,
      arrivalResume: { version: 1, owner: owner.id, binding: template.id, child, ...resume } });
}

export function requireCounterArrivalDecision(state: VmState, frame: ScriptFrame): void {
  const witness = frame.arrivalDecision;
  if (!witness) return;
  validateScopeStack(state);
  const scope = state.skillPlayScopes?.at(-1);
  if (witness.version !== 1 || !scope || scope.id !== witness.scope || scope.purpose !== "counterArrivalDecision" ||
    frame.skillEffectOrigin?.scope !== witness.scope || scope.source !== frame.card || scope.master !== frame.master || scope.skillIndex !== frame.skillIndex ||
    !frame.counterSource || frame.counterSource.version !== 1 || frame.counterSource.card !== frame.card ||
    !Number.isSafeInteger(frame.counterSource.epoch) || frame.counterSource.epoch < 0 ||
    !counterArrivalDescriptor(frame.counterDeclaredScript?.script.ops) || !witness.arrival || typeof witness.arrival.card !== "string" ||
    !Number.isSafeInteger(witness.arrival.epoch) || witness.arrival.epoch < 0) rebuildScope("rebuild this saved per-arrival Counter execution");
  if (witness.kind === "direct") return;
  if (witness.kind !== "repeat") rebuildScope("rebuild this saved per-arrival Counter execution kind");
  const owner = state.skillPlayScopes?.at(-2);
  if (!owner || owner.id !== witness.owner || scope.parent !== owner.id) rebuildScope("rebuild this per-arrival Counter parent");
  const template = checkedCounterArrivalTemplates(owner).find(item => item.id === witness.binding);
  if (!template || template.state !== "running" || template.active?.scope !== scope.id ||
    canonicalTaxValue(template.active.arrival) !== canonicalTaxValue(witness.arrival) ||
    frame.card !== template.card || frame.master !== template.master || frame.skillIndex !== template.skillIndex ||
    canonicalTaxValue(frame.counterDeclaredScript?.script) !== canonicalTaxValue(template.script)) {
    rebuildScope("rebuild this per-arrival Counter captured identity");
  }
}

export function completeCounterArrivalDecision(state: VmState, resume: CounterArrivalResume): void {
  validateScopeStack(state);
  const owner = state.skillPlayScopes?.at(-1);
  if (!resume || resume.version !== 1 || !owner || owner.id !== resume.owner || !resume.frame ||
    resume.frame.skillEffectOrigin?.scope !== owner.id || !Array.isArray(resume.cards) || !resume.options) {
    rebuildScope("rebuild this per-arrival Counter resume owner");
  }
  const template = checkedCounterArrivalTemplates(owner).find(item => item.id === resume.binding);
  if (!template || template.state !== "running" || template.active?.scope !== resume.child) rebuildScope("rebuild this per-arrival Counter resume cursor");
  const batch = resume.frame.arrivalBatch, permission = resume.options.playPermission;
  if (counterArrivalBatchProblem(batch, owner.id) || !batch ||
    canonicalTaxValue(resume.cards) !== canonicalTaxValue(batch.cards.map(item => item.card)) ||
    canonicalTaxValue(batch.cards[batch.cursor]) !== canonicalTaxValue(template.active.arrival) ||
    resume.frame.card !== owner.source || resume.frame.master !== owner.master ||
    !permission || permission.source !== resume.frame.card || permission.player !== resume.frame.master ||
    state.resolving?.card !== template.active.arrival.card || state.resolving.landed) {
    rebuildScope("rebuild this per-arrival Counter held play");
  }
  const pending = resume.frame.pendingArrival;
  if (!pending || !Array.isArray(pending.decisions) || pending.decisions.includes(template.id)) rebuildScope("rebuild this per-arrival Counter completion list");
  pending.decisions.push(template.id);
  template.state = "ready";
  delete template.active;
}

/** Unused templates do not execute their fallback when the parent had no play. */
export function retireCounterArrivalTemplates(owner: SkillPlayScope): void {
  if (checkedCounterArrivalTemplates(owner).some(item => item.state !== "ready")) rebuildScope("rebuild unfinished per-arrival Counter work");
  delete owner.arrivalCounters;
}

/** Guard old active frames before any of their effect instructions execute. */
export function requireCounterArrivalContract(frame: ScriptFrame, source: import("./script").Script | undefined): void {
  const descriptor = counterArrivalDescriptor(source?.ops);
  if (frame.counterCost || frame.taxGate || frame.counterNonhandTax || frame.extraCounterTax) {
    if (frame.arrivalDecision) rebuildScope("rebuild this conflicting Counter payment and arrival execution");
    return;
  }
  if (!descriptor && !frame.arrivalDecision) return;
  if (!descriptor || !frame.counterPlay || source?.kind !== "counter:play" ||
    frame.skillEffectOrigin?.version !== 2 || frame.skillEffectOrigin.kind !== "counter" ||
    !frame.counterDeclaredScript || !counterArrivalDescriptor(frame.counterDeclaredScript.script.ops)) {
    rebuildScope("rebuild this saved per-arrival Counter policy");
  }
  if (!frame.arrivalDecision && (frame.ip !== 0 || frame.awaiting || !counterArrivalDescriptor(frame.ops))) {
    rebuildScope("rebuild this saved per-arrival Counter effect before its decision");
  }
}

/** Known native plays execute once; after-windows have no future arrival. */
export function prepareDirectCounterArrival(state: VmState, frame: ScriptFrame): void {
  if (!counterArrivalDescriptor(frame.counterDeclaredScript?.script.ops) || frame.arrivalDecision || frame.counterAnswerScope !== undefined) return;
  const scope = state.skillPlayScopes?.at(-1);
  if (!scope || scope.purpose !== "counterArrivalDecision" || scope.id !== frame.skillEffectOrigin?.scope) rebuildScope("rebuild this direct Counter arrival lifetime");
  const resolving = state.resolving;
  if (!resolving?.card || resolving.landed || resolving.replaced || resolving.scopeWindow) {
    frame.ops = [];
    return;
  }
  frame.arrivalDecision = { version: 1, kind: "direct", scope: scope.id,
    arrival: { card: resolving.card, epoch: state.cards[resolving.card]?.zoneEpoch ?? 0 } };
}

export function requireCounterArrivalBatchResume(state: VmState, resume: CounterArrivalBatchResume): void {
  validateScopeStack(state);
  const owner = state.skillPlayScopes?.at(-1), batch = resume?.frame?.arrivalBatch;
  if (!resume || resume.version !== 1 || !owner || owner.id !== resume.owner ||
    resume.frame?.skillEffectOrigin?.scope !== owner.id || counterArrivalBatchProblem(batch, owner.id) || !batch ||
    canonicalTaxValue(resume.cards) !== canonicalTaxValue(batch.cards.map(item => item.card)) || !resume.options ||
    resume.options.playPermission?.source !== resume.frame.card || resume.options.playPermission?.player !== resume.frame.master) {
    rebuildScope("rebuild this serialized Counter arrival batch resume");
  }
}
