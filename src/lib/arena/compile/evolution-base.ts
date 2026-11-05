import type { Skill } from "../types";
import type { EvolutionBase } from "../vm/script";
import { parseFilter } from "../text/filters";
import { evolutionBaseProblem, needsEvolutionContract } from "../vm/evolution-base";
/** Exact color/character/cost or one trait/character/minimum-cost descriptor. */
export function compileEvolutionBase(skill: Skill): EvolutionBase | undefined {
  const exact = /^(red|blue|green|yellow|black|white)\s+<[^>]+>\s+card with an energy cost of \d+\.?$/i;
  const traitMinimum = /^≪[^≫]+≫\s+<[^>]+>\s+(?:card )?with an energy cost of \d+ or more\.?$/i;
  if (!needsEvolutionContract(skill) || ![exact, traitMinimum].some(pattern => pattern.test(skill.effect.trim()))) return undefined;
  const contract: EvolutionBase = { version: 1, variant: "EX-Evolve", activation: "hand", base: { area: "battle", side: "you", filter: { ...parseFilter(skill.effect), type: "BATTLE" } } };
  return evolutionBaseProblem(contract) ? undefined : contract;
}
