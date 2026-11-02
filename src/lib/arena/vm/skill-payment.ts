import { potaraMaterialsProblem, potaraPrintedSelector, POTARA_REBUILD } from "./potara-materials";
import { absorbProcedureProblem, absorbPriceProblem } from "./absorb-procedure";
import { evolutionBaseProblem } from "./evolution-base";
import type { Skill } from "../types";
import type { CostRecord, SkillPayment, SkillPrice } from "./script";
import { IllegalAction } from "./common";
import { condProblem, programProblem, selectorProblem } from "./script-schema";
import { fusionMaterialsProblem } from "./fusion-materials";

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
  return { payment: payment as SkillPayment, condition: cost!.condition, ops: cost!.program, ...(cost!.fusion !== undefined ? { fusion: cost!.fusion } : {}), ...(cost!.evolution !== undefined ? { evolution: cost!.evolution } : {}), ...(cost!.absorb !== undefined ? { absorb: cost!.absorb } : {}), ...(cost!.potara !== undefined ? { potara: cost!.potara } : {}), ...(cost!.x ? { x: cost!.x } : {}), ...(cost!.payWith?.length ? { payWith: cost!.payWith } : {}) };
}

export function skillPriceProblem(value: unknown, depth = 0, path = "price"): string | null {
  const p = value as SkillPrice | null;
  const resource = skillPaymentProblem(p?.payment);
  if (resource) return resource;
  if (depth > 20) return "skill price is nested too deeply";
  if (Object.keys(p!).some((key) => !["payment", "condition", "ops", "x", "payWith", "fusion", "evolution", "absorb", "potara"].includes(key))) return "unknown typed skill price field; regenerate rules and rebuild saved matches/exports";
  if (Object.keys(p!.payment).some((key) => !["version", "readable", "orbs", "either", "marker", "burst", "spiritBoost"].includes(key))) return "unknown typed skill payment field; regenerate rules and rebuild saved matches/exports";
  if ([p!.fusion, p!.evolution, p!.absorb, p!.potara].filter(v => v !== undefined).length > 1) return "contradictory typed keyword identity";
  if (p!.potara !== undefined) { const bad = potaraMaterialsProblem(p!.potara) ?? (potaraPrintedSelector(p!.ops) || potaraPrintedSelector(p!.condition) ? POTARA_REBUILD : null); if (bad) return bad; }
  if (p!.absorb !== undefined) { const bad = absorbProcedureProblem(p!.absorb) ?? absorbPriceProblem(p!.ops, p!.condition); if (bad) return bad; }
  if (p!.evolution !== undefined) { const bad = evolutionBaseProblem(p!.evolution); if (bad) return bad; }
  if (p!.fusion !== undefined) {
    const problem = fusionMaterialsProblem(p!.fusion);
    if (problem) return problem;
  }
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
    for (const [key, n] of Object.entries(x)) if (key === "spiritBoost" ? n !== true : !["min", "max"].includes(key) || !Number.isInteger(n) || n < 0) return "invalid X price bounds";
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
  if (Object.keys(c!).some((key) => !["version", "readable", "text", "orbs", "either", "marker", "burst", "spiritBoost", "condition", "program", "x", "payWith", "fusion", "evolution", "absorb", "potara"].includes(key))) return "unknown typed cost record field; regenerate rules and rebuild saved matches/exports";
  if (typeof c!.text !== "string") return "the price needs display text";
  return skillPriceProblem({ payment: { version: c!.version, readable: c!.readable, orbs: c!.orbs, either: c!.either, marker: c!.marker, burst: c!.burst, spiritBoost: c!.spiritBoost }, condition: c!.condition, ops: c!.program, ...(c!.fusion !== undefined ? { fusion: c!.fusion } : {}), ...(c!.evolution !== undefined ? { evolution: c!.evolution } : {}), ...(c!.absorb !== undefined ? { absorb: c!.absorb } : {}), ...(c!.potara !== undefined ? { potara: c!.potara } : {}), ...(c!.x !== undefined ? { x: c!.x } : {}), ...(c!.payWith !== undefined ? { payWith: c!.payWith } : {}) }, 0, "cost");
}
