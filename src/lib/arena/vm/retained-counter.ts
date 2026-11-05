/** R432: one already-activated Counter waiting for a single future arrival. */
import type { ScriptFrame } from "./script";
import type { ScriptHost } from "./script-host";
import type { VmState, VmResolving } from "./state";
import { rebuildScope, type SkillPlayScope } from "./skill-play-scope";

export type RetainedPlayOptions = Parameters<ScriptHost["playThen"]>[1];
export interface RetainedCounter {
  version: 1;
  id: number;
  at: number;
  state: "waiting" | "running" | "done";
  scope?: SkillPlayScope;
  frame?: ScriptFrame;
  finish?: ScriptFrame;
}
export interface PendingArrival {
  version: 1;
  owner: number;
  card: string;
  epoch: number;
  cursor: number;
  previous: VmResolving | null;
  complete?: true;
}
export type RetainedResume = {
  version: 1; owner: number; child?: number; previous?: VmResolving | null;
} & ({ kind: "play"; cards: string[]; options: RetainedPlayOptions; frame: ScriptFrame } | { kind: "finish"; frame: ScriptFrame });

function ownerScope(state: VmState, id: number): SkillPlayScope {
  const owner = state.skillPlayScopes?.at(-1);
  if (!owner || owner.id !== id) rebuildScope("rebuild this retained Counter owner");
  return owner;
}
function checkedEntry(owner: SkillPlayScope, entry: RetainedCounter): void {
  if (!entry || entry.version !== 1 || !Number.isSafeInteger(entry.id) || entry.id <= owner.id || !Number.isSafeInteger(entry.at) || entry.at < 0 || entry.at > (owner.bindings?.length ?? 0) || !["waiting", "running", "done"].includes(entry.state)) rebuildScope("rebuild this retained Counter binding");
  if (entry.state === "waiting") {
    if (!entry.scope || entry.scope.version !== 2 || entry.scope.id !== entry.id || entry.scope.parent !== owner.id || entry.scope.phase !== "effect" || entry.scope.window || !entry.frame || entry.frame.skillEffectOrigin?.scope !== entry.id || entry.frame.ip !== 0 || !Array.isArray(entry.frame.ops) || !entry.frame.ops.length || entry.frame.counterSource?.version !== 1 || entry.frame.counterSource.card !== entry.frame.card || !Number.isSafeInteger(entry.frame.counterSource.epoch) || entry.frame.counterSource.epoch < 0 || !entry.finish || entry.finish.skillPlayFinish?.scope !== entry.id) rebuildScope("rebuild this retained Counter continuation");
  } else if (entry.scope || entry.frame || entry.finish) rebuildScope("rebuild this consumed retained Counter continuation");
}
export function nextRetainedCounter(owner: SkillPlayScope): RetainedCounter | undefined {
  const entries = owner.retainedCounters ?? [];
  if (!Array.isArray(entries) || new Set(entries.map(entry => entry?.id)).size !== entries.length) rebuildScope("rebuild this retained Counter list");
  for (let i = 0; i < entries.length; i++) {
    checkedEntry(owner, entries[i]);
    if (i && entries[i].at < entries[i - 1].at) rebuildScope("rebuild this retained Counter order");
  }
  return entries.find(entry => entry.state === "waiting");
}
export function retainCounter(state: VmState, owner: SkillPlayScope, frame: ScriptFrame): void {
  const scope = state.skillPlayScopes?.at(-1), source = frame.counterSource;
  if (!scope || scope.id !== frame.skillEffectOrigin?.scope || scope.parent !== owner.id || scope.phase !== "effect" || scope.window || frame.ip !== 0 || !source || source.version !== 1 || source.card !== frame.card || !Number.isSafeInteger(source.epoch) || source.epoch < 0) rebuildScope("rebuild this activated Counter before retaining its future-card tail");
  nextRetainedCounter(owner);
  const at = state.programs.findIndex(item => item.skillPlayFinish?.scope === scope.id);
  if (at < 0) rebuildScope("rebuild this retained Counter finish boundary");
  const [finish] = state.programs.splice(at, 1);
  state.skillPlayScopes!.pop();
  (owner.retainedCounters ??= []).push({ version: 1, id: scope.id, at: owner.bindings?.length ?? 0, state: "waiting", scope, frame, finish });
}
export function resumeRetainedCounter(state: VmState, owner: SkillPlayScope, entry: RetainedCounter, resume: RetainedResume): void {
  if (ownerScope(state, owner.id) !== owner) rebuildScope("rebuild this retained Counter ancestry");
  checkedEntry(owner, entry);
  if (entry.state !== "waiting") rebuildScope("rebuild this retained Counter cursor");
  const scope = entry.scope!, frame = entry.frame!, finish = entry.finish!;
  entry.state = "running"; delete entry.scope; delete entry.frame; delete entry.finish;
  delete frame.counterAnswerScope;
  frame.retainedCounter = { version: 1, owner: owner.id, child: scope.id };
  state.skillPlayScopes!.push(scope);
  state.programs.unshift(frame, finish, { ops: [], ip: 0, vars: {}, card: resume.frame.card, master: resume.frame.master, retainedResume: { ...resume, child: entry.id } });
}
export function completeRetainedResume(state: VmState, resume: RetainedResume): void {
  if (!resume || resume.version !== 1 || !Number.isSafeInteger(resume.owner) || !resume.frame || !Array.isArray(resume.frame.ops) || !["play", "finish"].includes(resume.kind)) rebuildScope("rebuild this retained Counter resume version");
  if (resume.kind === "play" && (!Array.isArray(resume.cards) || resume.cards.length !== 1 || typeof resume.cards[0] !== "string" || !resume.options || resume.frame.pendingArrival?.owner !== resume.owner || resume.frame.pendingArrival.card !== resume.cards[0])) rebuildScope("rebuild this retained Counter play continuation");
  if (resume.kind === "finish" && resume.frame.skillPlayFinish?.scope !== resume.owner) rebuildScope("rebuild this retained Counter finish continuation");
  const owner = ownerScope(state, resume.owner);
  nextRetainedCounter(owner);
  if (resume.child !== undefined) {
    const entry = owner.retainedCounters?.find(item => item.id === resume.child);
    if (!entry) rebuildScope("rebuild this retained Counter completion");
    checkedEntry(owner, entry);
    if (entry.state !== "running") rebuildScope("rebuild this retained Counter completion cursor");
    entry.state = "done";
  }
}
export function settleRetainedCounter(state: VmState, owner: SkillPlayScope, finish: ScriptFrame): boolean {
  const entry = nextRetainedCounter(owner);
  if (owner.retainedCounters?.some(item => item.state === "running")) rebuildScope("rebuild this unfinished retained Counter before its owner finishes");
  if (!entry) return false;
  const previous = structuredClone(state.resolving);
  state.resolving = { card: null, player: owner.master };
  resumeRetainedCounter(state, owner, entry, { version: 1, kind: "finish", owner: owner.id, frame: finish, previous });
  return true;
}

/** The active child owns execution; its parked parent owns only its identity. */
export function requireRetainedCounter(state: VmState, frame: ScriptFrame): void {
  const marker = frame.retainedCounter;
  if (!marker) return;
  const active = state.skillPlayScopes?.at(-1), parent = state.skillPlayScopes?.find(scope => scope.id === marker.owner);
  if (parent) nextRetainedCounter(parent);
  const entry = parent?.retainedCounters?.find(item => item?.id === marker.child), source = frame.counterSource;
  if (marker.version !== 1 || !active || active.id !== marker.child || active.parent !== marker.owner || frame.skillEffectOrigin?.scope !== marker.child || !parent || !entry || entry.state !== "running" || !source || source.version !== 1 || source.card !== frame.card || !Number.isSafeInteger(source.epoch) || source.epoch < 0) rebuildScope("rebuild this retained Counter execution ownership");
  checkedEntry(parent, entry);
}
