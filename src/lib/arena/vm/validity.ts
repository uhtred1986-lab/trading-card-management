/** v1 persists Sparking validity only. Bond's specified selectors remain a separate residual. */
import type { PlayerId, Skill } from "../types";
import type { VmState } from "./state";
import { NotYet } from "./errors";

export interface ValidityRecord {
  version: 1;
  sparking: number | null;
}
export const noSparking = (): ValidityRecord => ({ version: 1, sparking: null });
export const compileValidity = (skill: Pick<Skill, "sparking">): ValidityRecord => ({ version: 1, sparking: skill.sparking });
export function validityProblem(value: unknown): string | null {
  const bad = "missing or malformed typed Sparking validity v1; regenerate rules and rebuild the match (#907)";
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !["version", "sparking"].includes(k)) || v.version !== 1
    || v.sparking !== null && (!Number.isSafeInteger(v.sparking) || Number(v.sparking) < 1)) return bad;
  return null;
}
export function requireValidity(value: unknown): ValidityRecord {
  const gap = validityProblem(value); if (gap) throw new NotYet(gap, "#907");
  return value as ValidityRecord;
}
export function withValidity(skill: Skill, validity: unknown): Skill {
  return { ...skill, validity, sparking: validityProblem(validity) ? null : (validity as ValidityRecord).sparking };
}
/** Validity is checked before pending/activation; an activated frame never rechecks the live count. */
export function sparkingIsValid(state: VmState, master: PlayerId, value: unknown): boolean {
  const v = requireValidity(value);
  return v.sparking === null || (state.sides[master].zones.drop ?? []).length >= v.sparking;
}
export function describeValidity(v: ValidityRecord): string {
  return v.sparking === null ? "No Sparking requirement" : `Sparking ${v.sparking}: valid with ${v.sparking} or more cards in your Drop Area`;
}
