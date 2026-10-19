/** Bounded EX-Evolve hand-discard / exact Battle-base contract, v1. */
import type { Skill } from "../types";
import type { EvolutionBase } from "./script";
import { filterProblem } from "./script-schema";
export const EVOLUTION_REBUILD = "missing or malformed typed EX-Evolve base v1; regenerate rules and rebuild saved matches/exports (#907)";
const COLOR = "red|blue|green|yellow|black|white";
/** Migration detection only; this never supplies a runtime base or price. */
export function needsEvolutionContract(skill: Pick<Skill, "keyword" | "cost">): boolean {
  return skill.keyword?.name === "Evolve" && skill.keyword.variant === "EX-Evolve"
    && new RegExp(`^choose \\d+ (?:${COLOR}) cards? (?:from|in) your hand and place (?:it|them) in your drop area\\.?$`, "i").test(skill.cost.trim());
}
export function evolutionBaseProblem(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EVOLUTION_REBUILD;
  const e = value as EvolutionBase;
  if (Object.keys(e).some(k => !["version", "variant", "activation", "base"].includes(k)) || e.version !== 1 || e.variant !== "EX-Evolve" || e.activation !== "hand"
    || !e.base || typeof e.base !== "object" || Array.isArray(e.base) || Object.keys(e.base).some(k => !["area", "side", "filter"].includes(k)) || e.base.area !== "battle" || e.base.side !== "you" || filterProblem(e.base.filter)) return EVOLUTION_REBUILD;
  const f = e.base.filter;
  if (f.unreadable || f.type !== "BATTLE" || !Array.isArray(f.colors) || !Array.isArray(f.characters) || f.colors.length !== 1 || !["Red", "Blue", "Green", "Yellow", "Black", "White"].includes(f.colors[0])
    || f.characters.length !== 1 || typeof f.characters[0] !== "string" || !f.characters[0].trim() || !Number.isSafeInteger(f.costMin) || Number(f.costMin) < 0 || f.costMax !== f.costMin) return EVOLUTION_REBUILD;
  for (const [key, val] of Object.entries(f)) if (!["type", "colors", "characters", "costMin", "costMax"].includes(key)
    && val !== undefined && val !== null && val !== false && !(Array.isArray(val) && val.length === 0)) return EVOLUTION_REBUILD;
  return null;
}
