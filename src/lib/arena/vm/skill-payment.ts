import type { Skill } from "../types";
import type { CostRecord, SkillPayment, SkillPrice } from "./script";
import { IllegalAction } from "./common";
import { condProblem, programProblem, selectorProblem } from "./script-schema";

const COLORS = ["Red", "Blue", "Green", "Yellow", "Black", "White", "Colorless"];
const MOVES = new Set(["Overlord", "Evolve", "Union", "Successor", "Arrival", "Aegis", "Rejuvenate", "Z-Awaken", "Wish", "Awaken", "Over Realm", "Swap", "Field"]);

/** Native activated keywords need a stored price even when they print no effect. */
export const needsPaymentRecord = (skill: Skill): boolean => !!skill.keyword && MOVES.has(skill.keyword.name);

export const zeroSkillPrice = (readable = true): SkillPrice => ({
  payment: { version: 1, readable, orbs: {}, either: [], marker: null, burst: null, spiritBoost: null },
  condition: null, ops: null,
});

/** An intentional editor removal is an explicit zero; an obsolete loaded null is not. */
export const zeroCostRecord = (): CostRecord => ({ ...zeroSkillPrice().payment, text: "", condition: null, program: null });

export function skillPaymentProblem(value: unknown): string | null {
  const p = value as SkillPayment | null;
  if (!p || p.version !== 1 || typeof p.readable !== "boolean") return "missing or unsupported typed skill payment v1; regenerate rules and rebuild saved matches/exports";
  if (!p.orbs || typeof p.orbs !== "object" || Array.isArray(p.orbs) || !Array.isArray(p.either)) return "invalid typed skill payment resources";
  for (const [color, n] of Object.entries(p.orbs)) if (!(color === "any" || COLORS.includes(color)) || !Number.isInteger(n) || n < 0) return "invalid typed skill payment orb";
  if (p.either.some((group) => !Array.isArray(group) || group.length < 2 || group.some((color) => !COLORS.includes(color)))) return "invalid typed skill payment either-orb";
  if (p.marker !== null && !Number.isInteger(p.marker)) return "invalid typed skill payment marker";
  for (const n of [p.burst, p.spiritBoost]) if (n !== null && (!Number.isInteger(n) || n < 0)) return "invalid typed skill payment count";
  return null;
}

export function requireSkillPayment(price: SkillPrice | undefined): SkillPayment {
  const problem = skillPriceProblem(price);
  if (problem) throw new IllegalAction(problem);
  return price!.payment!;
}

/** Copy the record's fields without consulting catalog text. */
export function priceFromCostRecord(cost: CostRecord | null): SkillPrice {
  const payment = cost && { version: cost.version, readable: cost.readable, orbs: cost.orbs, either: cost.either, marker: cost.marker, burst: cost.burst, spiritBoost: cost.spiritBoost };
  const problem = costRecordProblem(cost);
  if (problem) throw new IllegalAction(problem);
  return { payment: payment as SkillPayment, condition: cost!.condition, ops: cost!.program, ...(cost!.x ? { x: cost!.x } : {}), ...(cost!.payWith?.length ? { payWith: cost!.payWith } : {}) };
}

export function skillPriceProblem(value: unknown, depth = 0, path = "price"): string | null {
  const p = value as SkillPrice | null;
  const resource = skillPaymentProblem(p?.payment);
  if (resource) return resource;
  if (depth > 20) return "skill price is nested too deeply";
  if (p!.condition !== null) {
    const bad = condProblem(p!.condition, depth + 1, !!p!.x, `${path}.condition`);
    if (bad) return bad;
  }
  if (p!.ops !== null) {
    const bad = programProblem(p!.ops, depth + 1, !!p!.x, `${path}.${path === "cost" ? "program" : "ops"}`);
    if (bad) return bad;
  }
  const x = p!.x;
  if (x !== undefined) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return "invalid X price bounds";
    for (const [key, n] of Object.entries(x)) if (!["min", "max"].includes(key) || !Number.isInteger(n) || n < 0) return "invalid X price bounds";
    if ((x.max ?? Infinity) < (x.min ?? 0)) return "invalid X price bounds";
  }
  if (p!.payWith !== undefined) {
    if (!Array.isArray(p!.payWith)) return "invalid alternative skill payers";
    for (const pw of p!.payWith!) {
      if (!pw || typeof pw !== "object") return "invalid alternative skill payer";
      const bad = selectorProblem(pw.sel, `${path}.payWith.sel`);
      if (bad) return bad;
      if (!["energy", ...COLORS].includes(pw.as)) return "invalid alternative skill payer colour";
    }
  }
  return null;
}

export function costRecordProblem(value: unknown): string | null {
  const c = value as CostRecord | null;
  const resources = skillPaymentProblem(c);
  if (resources) return resources;
  if (typeof c!.text !== "string") return "the price needs display text";
  return skillPriceProblem({ payment: c, condition: c!.condition, ops: c!.program, ...(c!.x !== undefined ? { x: c!.x } : {}), ...(c!.payWith !== undefined ? { payWith: c!.payWith } : {}) }, 0, "cost");
}
