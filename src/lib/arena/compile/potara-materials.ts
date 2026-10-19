import type { Skill } from "../types";
import type { PotaraMaterials } from "../vm/script";
import { isPotaraSkill } from "../vm/potara-materials";
import { compileNamedUnionNeeds } from "./fusion-materials";
/** Read material qualifiers once; the native procedure and typed permissions execute them. */
export function compilePotaraMaterials(skill: Skill): PotaraMaterials | undefined {
  if (!isPotaraSkill(skill)) return undefined;
  const effect = skill.effect.replace(/\s*\(place this card in active mode on top of the 2 specified cards stacked together\)\.?$/i, "");
  const needs = compileNamedUnionNeeds({...skill, effect}); if (!needs) return undefined;
  return { version: 1, variant: "Potara", activation: "hand", base: "battle", needs, samePower: false,
    extensions: ["unionEnergy", "unionFusionWarp", "unionSourceUnder", "unionSourceOpponentBattle"] };
}
