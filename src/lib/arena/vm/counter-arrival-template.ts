/** An already-activated R435 effect, reusable for distinct incoming events.
 * Capture an allowlist of effect facts: payment/motion/afterSkill settlement
 * fields must never be cloned into a per-arrival execution.
 */
import type { PlayerId } from "../types";
import type { Script, ScriptFrame } from "./script";
import { counterArrivalDescriptor, type CounterArrivalDescriptor } from "./counter-arrival-policy";

export interface CounterArrivalTemplate {
  version: 1;
  id: number;
  at: number;
  descriptor: CounterArrivalDescriptor;
  master: PlayerId;
  card: string;
  skillIndex: number;
  sourceEpoch: number;
  script: Script;
  vars: Record<string, string[]>;
  state: "ready" | "running";
  active?: CounterArrivalExecution;
}
export interface CounterArrivalExecution {
  version: 1;
  owner: number;
  binding: number;
  scope: number;
  arrival: { card: string; epoch: number };
  candidates?: { card: string; epoch: number }[];
}

export function captureCounterArrivalTemplate(frame: ScriptFrame, id: number, at: number): CounterArrivalTemplate | null {
  const declaration = frame.counterDeclaredScript;
  const source = frame.counterSource;
  const descriptor = counterArrivalDescriptor(frame.ops);
  if (!descriptor || frame.ip !== 0 || !frame.counterPlay || !source || source.version !== 1 || source.card !== frame.card ||
    !Number.isSafeInteger(source.epoch) || source.epoch < 0 || !Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(at) || at < 0 ||
    !declaration || declaration.version !== 1 || declaration.card !== frame.card || declaration.skillIndex !== frame.skillIndex ||
    declaration.kind !== "counter:play" || !counterArrivalDescriptor(declaration.script.ops)) return null;
  return {
    version: 1, id, at, descriptor, master: frame.master, card: frame.card,
    skillIndex: declaration.skillIndex, sourceEpoch: source.epoch,
    script: structuredClone(declaration.script), vars: structuredClone(frame.vars), state: "ready",
  };
}

/** Caller validates scope ancestry and the original incoming occurrence first. */
export function counterArrivalExecutionFrame(template: CounterArrivalTemplate, scope: number): ScriptFrame {
  return {
    ops: structuredClone(template.script.ops), ip: 0, vars: structuredClone(template.vars),
    card: template.card, master: template.master, skillIndex: template.skillIndex,
    skillKind: "counter", counterPlay: true,
    counterSource: { version: 1, card: template.card, epoch: template.sourceEpoch },
    counterDeclaredScript: {
      version: 1, card: template.card, skillIndex: template.skillIndex,
      kind: "counter:play", script: structuredClone(template.script),
    },
    skillEffectOrigin: { version: 2, kind: "counter", scope },
    usage: structuredClone(template.script.usage), validity: structuredClone(template.script.validity),
  };
}

export function counterArrivalTemplateProblem(value: unknown, owner: number, bindingCount: number): string | null {
  if (!value || typeof value !== "object") return "missing per-arrival Counter template";
  const template = value as CounterArrivalTemplate;
  if (template.version !== 1 || !Number.isSafeInteger(template.id) || template.id <= owner ||
    !Number.isSafeInteger(template.at) || template.at < 0 || template.at > bindingCount ||
    !["p1", "p2"].includes(template.master) || typeof template.card !== "string" || !template.card ||
    !Number.isSafeInteger(template.skillIndex) || template.skillIndex < 0 ||
    !Number.isSafeInteger(template.sourceEpoch) || template.sourceEpoch < 0 ||
    !template.descriptor || template.descriptor.version !== 1 || template.descriptor.policy !== "eachQualifyingPlayV1" ||
    !template.script || template.script.kind !== undefined && template.script.kind !== "counter:play" ||
    !counterArrivalDescriptor(template.script.ops) || !["ready", "running"].includes(template.state)) {
    return "malformed per-arrival Counter template identity";
  }
  if (!template.vars || typeof template.vars !== "object" || Array.isArray(template.vars) ||
    Object.values(template.vars).some(ids => !Array.isArray(ids) || ids.some(id => typeof id !== "string"))) {
    return "malformed per-arrival Counter template variables";
  }
  if (template.state === "ready") return template.active === undefined ? null : "idle per-arrival Counter has an execution";
  const active = template.active;
  if (!active || active.version !== 1 || active.owner !== owner || active.binding !== template.id ||
    !Number.isSafeInteger(active.scope) || active.scope <= template.id || !active.arrival ||
    typeof active.arrival.card !== "string" || !active.arrival.card || !Number.isSafeInteger(active.arrival.epoch) || active.arrival.epoch < 0) {
    return "malformed per-arrival Counter execution ownership";
  }
  if (active.candidates !== undefined && (!Array.isArray(active.candidates) ||
    active.candidates.some(item => !item || typeof item.card !== "string" || !Number.isSafeInteger(item.epoch) || item.epoch < 0) ||
    new Set(active.candidates.map(item => item.card)).size !== active.candidates.length)) {
    return "malformed per-arrival Counter chooser occurrences";
  }
  return null;
}
