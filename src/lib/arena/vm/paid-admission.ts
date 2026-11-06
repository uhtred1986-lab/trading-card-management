/** Loader provenance for a paid condition reconstructed from row.cond. */
import type { Cond, Op, Script } from "./script";
import { rebuildScope } from "./skill-play-scope";
export interface PaidAdmission { version: 1; condition: Cond }
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
/** Only the loader knows which if was introduced by row.cond. No effect-body inference. */
export function storedPaidAdmission(condition: unknown, priceCondition: Cond | null | undefined): PaidAdmission | undefined {
  return condition && priceCondition && same(condition, priceCondition) ? { version: 1, condition: structuredClone(priceCondition) } : undefined;
}
/** Consumers must independently establish that their activation has paid this gate. */
export function paidAdmissionBody(script: Script | undefined): Op[] {
  const ops = script?.ops ?? [], admission = script?.paidAdmission;
  if (!admission) return ops;
  const outer = ops[0];
  if (admission.version !== 1 || !same(admission.condition, script?.price?.condition) || ops.length !== 1 || !outer || outer.op !== "if" || outer.else || !same(outer.cond, admission.condition)) rebuildScope("rebuild this stored paid admission provenance");
  return outer.then;
}
export function paidAdmissionWitness(script: Script | undefined, ops: readonly Op[]): PaidAdmission | undefined {
  if (!script?.paidAdmission) return undefined;
  if (!same(ops, paidAdmissionBody(script))) rebuildScope("rebuild this payment continuation before activation");
  return structuredClone(script.paidAdmission);
}
export function paidAdmissionMatches(witness: PaidAdmission | undefined, script: Script): boolean {
  return !!script.paidAdmission && witness?.version === 1 && same(witness.condition, script.paidAdmission.condition);
}
