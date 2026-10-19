import type { Skill } from "../types";
import type { FusionMaterials } from "../vm/script";
import { isFusionSkill } from "../vm/fusion-materials";
import { unionNeeds } from "../text/union";
import { unreadFilterWords } from "../lang/filter-words";

/** Read every named qualifier once, before persistence. Unsupported tails must
 * remain unread rather than becoming a permissive empty material filter. */
export function compileNamedUnionNeeds(skill: Skill): FusionMaterials["needs"] | undefined {
  const needs = unionNeeds(skill);
  if (/<[^>]+>\s*(?:cards?\s+)?or\s*(?:(?:red|blue|green|yellow|black|white)\s+)?</i.test(skill.effect) || needs.length !== 2
    || needs.some((n) => !n.name.trim() || n.filter.unreadable
      || unreadFilterWords(n.text.replace(/\b(?:both|cards?)\b/gi, ""), { ...n.filter, characters: [n.name] }).length)) return undefined;
  return needs.map(({ name, filter }) => ({ name: name.trim(), filter }));
}
export function compileFusionMaterials(skill: Skill): FusionMaterials | undefined {
  if (!isFusionSkill(skill)) return undefined;
  const needs = compileNamedUnionNeeds(skill); if (!needs) return undefined;
  return {
    version: 1, needs, samePower: true,
    activation: "hand", base: "hand", extensions: ["unionFusionAreas", "unionFusionWarp"],
  };
}
