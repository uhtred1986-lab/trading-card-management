/** Bounded Union-Absorb: selectors and movements remain in the recorded programs. */
import type { Skill } from "../types";
import type { AbsorbProcedure, Op } from "./script";
import { programProblem } from "./script-schema";
export const ABSORB_REBUILD = "missing or contradictory typed Union-Absorb procedure v1; regenerate rules and rebuild saved matches/exports (#907)";
export const isAbsorbSkill = (s: Pick<Skill, "keyword">) => s.keyword?.name === "Union" && s.keyword.variant === "Absorb";
export function absorbProcedureProblem(value: unknown): string | null {
  const a = value as AbsorbProcedure | undefined;
  return !a || typeof a !== "object" || Array.isArray(a) || Object.keys(a).some(k => !["version", "variant", "area"].includes(k)) || a.version !== 1 || a.variant !== "Absorb" || a.area !== "battle" ? ABSORB_REBUILD : null;
}
const keys = (value: object, allowed: string[]) => Object.entries(value).every(([k, v]) => v === undefined || allowed.includes(k));
/** Reject only primitives whose VM implementation reparses displayed material text. */
export function absorbTextFallback(value: unknown, selector = false): boolean {
  if (Array.isArray(value)) return value.some(v => absorbTextFallback(v, selector));
  if (!value || typeof value !== "object") return false;
  const node = value as Record<string, unknown>;
  if (selector && node.printed === true || node.op === "choose" && node.namedSet === true || node.kind === "eachNamed") return true;
  return Object.entries(node).some(([key, child]) => absorbTextFallback(child, key === "sel" || key === "underHost"));
}
/** Existing typed price programs are the material authority; the strict host
 * independently refuses any action price it cannot charge completely. */
export function absorbPriceProblem(ops: Op[] | null | undefined, condition?: unknown): string | null {
  return absorbTextFallback(condition) || absorbTextFallback(ops) || ops !== null && (!Array.isArray(ops) || programProblem(ops)) ? ABSORB_REBUILD : null;
}
/** Every recorded arrival must be an Absorb play onto the activating source.
 * Conditions, selection areas and material filters retain their existing ops. */
export function absorbEffectProblem(ops: Op[] | undefined): string | null {
  if (!Array.isArray(ops) || programProblem(ops) || absorbTextFallback(ops)) return ABSORB_REBUILD;
  let plays = 0, bad = false;
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (!value || typeof value !== "object") return;
    const op = value as Record<string, unknown>;
    if (op.op === "play") {
      plays++;
      const p = op as Extract<Op, {op: "play"}>;
      if (p.using !== "Union-Absorb" || p.counterWindow !== true || !p.onto || !("sel" in p.onto)
        || !keys(p.onto, ["sel"]) || !keys(p.onto.sel, ["special"]) || p.onto.sel.special !== "self") bad = true;
    }
    for (const child of Object.values(op)) walk(child);
  };
  walk(ops);
  return bad || !plays ? ABSORB_REBUILD : null;
}
/** Old saved executable programs identify a missing migration, never supply identity. */
export function containsAbsorbPlay(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsAbsorbPlay);
  if (!value || typeof value !== "object") return false;
  const op = value as Record<string, unknown>;
  return op.op === "play" && op.using === "Union-Absorb" || Object.values(op).some(containsAbsorbPlay);
}
