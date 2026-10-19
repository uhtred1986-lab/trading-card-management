/** Executable use ceilings. Absence is obsolete data, never an unlimited skill. */
import type { Skill } from "../types";
import { NotYet } from "./errors";

export interface UsageRecord {
  version: 1;
  oncePerTurn: boolean;
  limit: number | null;
}
export const unlimitedUsage = (): UsageRecord => ({ version: 1, oncePerTurn: false, limit: null });
export const compileUsage = (skill: Pick<Skill, "oncePerTurn" | "limit">): UsageRecord => ({ version: 1, oncePerTurn: skill.oncePerTurn, limit: skill.limit });
export function usageProblem(value: unknown): string | null {
  const bad = "missing or malformed typed skill usage v1; regenerate rules and rebuild the match (#907)";
  if (!value || typeof value !== "object" || Array.isArray(value)) return bad;
  const u = value as Record<string, unknown>;
  if (Object.keys(u).some((k) => !["version", "oncePerTurn", "limit"].includes(k))
    || u.version !== 1 || typeof u.oncePerTurn !== "boolean"
    || u.limit !== null && (!Number.isSafeInteger(u.limit) || Number(u.limit) < 1)) return bad;
  if (u.oncePerTurn && u.limit !== null) return "combined Once-per-turn and Limit ceilings are not implemented; preserve this rule as unsupported (#907)";
  return null;
}
export function requireUsage(value: unknown): UsageRecord {
  const gap = usageProblem(value);
  if (gap) throw new NotYet(gap, "#907");
  return value as UsageRecord;
}
/** Replace display tags with stored facts; invalid data is retained for the explicit runtime blocker. */
export function withUsage(skill: Skill, usage: unknown): Skill {
  const valid = !usageProblem(usage);
  const u = usage as UsageRecord;
  return { ...skill, usage, oncePerTurn: valid ? u.oncePerTurn : false, limit: valid ? u.limit : null };
}
export function describeUsage(u: UsageRecord): string {
  return u.oncePerTurn ? "Once per turn, separately for this skill on each copy"
    : u.limit !== null ? `Limit ${u.limit} per turn, shared by this master across the same skill on copies with the same card number`
      : "No per-turn use ceiling";
}
