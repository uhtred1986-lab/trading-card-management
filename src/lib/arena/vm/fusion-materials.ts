/** Current Fusion material contract; validation never reads printed material text. */
import type { Skill } from "../types";
import type { FusionMaterials, SkillPrice } from "./script";
import { filterProblem } from "./script-schema";
import { IllegalAction } from "./common";

export const isFusionSkill = (skill: Pick<Skill, "keyword">): boolean => skill.keyword?.name === "Union" && skill.keyword.variant === "Fusion";
export const FUSION_REBUILD = "missing or malformed typed Fusion material contract v1; regenerate rules and rebuild saved matches/exports";

export function fusionMaterialsProblem(value: unknown): string | null {
  const f = value as FusionMaterials | undefined;
  if (!f || typeof f !== "object" || Array.isArray(f)
    || Object.keys(f).some((k) => !["version", "needs", "samePower", "activation", "base", "extensions"].includes(k))
    || f.version !== 1 || typeof f.samePower !== "boolean" || f.activation !== "hand" || f.base !== "hand"
    || !Array.isArray(f.needs) || f.needs.length !== 2
    || !Array.isArray(f.extensions) || new Set(f.extensions).size !== f.extensions.length
    || f.extensions.some((p) => !["unionFusionAreas", "unionFusionWarp"].includes(p))) return FUSION_REBUILD;
  for (const n of f.needs) {
    if (!n || typeof n !== "object" || Array.isArray(n) || Object.keys(n).some((k) => !["name", "filter"].includes(k))
      || typeof n.name !== "string" || !n.name.trim() || n.name !== n.name.trim() || /[<>]/.test(n.name)
      || filterProblem(n.filter) || n.filter.unreadable) return FUSION_REBUILD;
  }
  return null;
}

export function requireFusionMaterials(price: SkillPrice | undefined): FusionMaterials {
  const problem = fusionMaterialsProblem(price?.fusion);
  if (problem) throw new IllegalAction(problem);
  return price!.fusion!;
}
