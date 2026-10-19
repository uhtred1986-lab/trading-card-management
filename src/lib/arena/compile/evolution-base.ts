import type { Skill } from "../types";
import type { EvolutionBase } from "../vm/script";
import { parseFilter } from "../text/filters";
import { evolutionBaseProblem, needsEvolutionContract } from "../vm/evolution-base";
/** Only the bounded exact-color, character and energy-cost base is read whole. */
export function compileEvolutionBase(skill: Skill): EvolutionBase | undefined {
  if (!needsEvolutionContract(skill) || !/^(red|blue|green|yellow|black|white)\s+<[^>]+>\s+card with an energy cost of \d+\.?$/i.test(skill.effect.trim())) return undefined;
  const contract: EvolutionBase = { version: 1, variant: "EX-Evolve", activation: "hand", base: { area: "battle", side: "you", filter: { ...parseFilter(skill.effect), type: "BATTLE" } } };
  return evolutionBaseProblem(contract) ? undefined : contract;
}
