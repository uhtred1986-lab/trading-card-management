/** R463: historical declaration area, independent of subsequent source movement. */
import type { Op, Script, ScriptFrame } from "./script";
import { counterKindOf } from "../types";
import { rebuildScope } from "./skill-play-scope";
export interface CounterActivationOrigin {
  version: 1;
  card: string;
  epoch: number;
  skillIndex: number;
  kind: string;
  from: "hand" | "energy" | "drop" | "under";
}
export function counterActivationFrom(
  frame: ScriptFrame,
  from: "energy",
  kind: "counter:attack",
): boolean {
  const origin = frame.counterActivation;
  if (
    !origin || origin.version !== 1 || origin.card !== frame.card ||
    origin.skillIndex !== frame.skillIndex ||
    !Number.isSafeInteger(origin.skillIndex) || origin.skillIndex < 0 ||
    !Number.isSafeInteger(origin.epoch) || origin.epoch < 0 ||
    !["hand", "energy", "drop", "under"].includes(origin.from) ||
    typeof origin.kind !== "string" || counterKindOf(origin.kind) === null
  ) rebuildScope("rebuild the saved Counter activation origin");
  return origin.from === from && origin.kind === kind;
}

function needsOrigin(ops: readonly Op[]): boolean {
  const walk = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(walk);
    if (!value || typeof value !== "object") return false;
    return (value as { kind?: string }).kind === "counterActivatedFrom" ||
      Object.values(value).some(walk);
  };
  return walk(ops);
}

export function requireCounterActivationOrigin(frame: ScriptFrame, script: Script | undefined): void {
  if (frame.skillKind === "counter" && (needsOrigin(frame.ops) || !!script && needsOrigin(script.ops))) {
    counterActivationFrom(frame, "energy", "counter:attack");
    const declaredKind = frame.counterDeclaredScript?.kind ?? script?.kind;
    if (declaredKind !== undefined && frame.counterActivation!.kind !== declaredKind) {
      rebuildScope("rebuild the saved Counter activation origin skill");
    }
  }
}
