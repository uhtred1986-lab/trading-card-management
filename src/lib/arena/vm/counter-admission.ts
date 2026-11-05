import { counterEnergyAttackBody } from "./counter-energy-contract";
import { counterChoiceTail } from "./counter-continuation";
/** R433: only the proven admission wrapper around the retained Counter family. */
import type { Op, Script, ScriptFrame } from "./script";
import { retainedCounterShape } from "./skill-play-binding";
import { rebuildScope } from "./skill-play-scope";
import { paidAdmissionBody, paidAdmissionMatches, paidAdmissionWitness, type PaidAdmission } from "./paid-admission";
export function counterHasPaidAdmission(script: Script | undefined): boolean {
  if (script?.kind === "counter:attack" && script.paidAdmission) return counterEnergyAttackBody(paidAdmissionBody(script));
  return script?.kind === "counter:play" && !!script.paidAdmission && !counterChoiceTail(paidAdmissionBody(script)) && retainedCounterShape(paidAdmissionBody(script));
}
export function counterEffectOps(script: Script | undefined): Op[] {
  return counterHasPaidAdmission(script) ? paidAdmissionBody(script) : script?.ops ?? [];
}
export function paidCounterAdmission(script: Script | undefined, ops: readonly Op[]): PaidAdmission | undefined {
  return counterHasPaidAdmission(script) ? paidAdmissionWitness(script, ops) : undefined;
}
export function requireCounterAdmission(frame: ScriptFrame, script: Script | undefined): void {
  if ((frame.counterPlay || frame.skillKind === "counter" && !frame.counterCost) && counterHasPaidAdmission(script) && !paidAdmissionMatches(frame.counterAdmission, script!)) rebuildScope("rebuild this saved Counter admission witness");
}
