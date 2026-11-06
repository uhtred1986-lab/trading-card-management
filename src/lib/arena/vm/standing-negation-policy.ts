/** R509: exact source envelope for the native otherBattleWholeV1 history policy. */
import type { Skill } from "../types";
import { emptyFilter } from "../text/filters";
import type { Op, Script } from "./script";
import { skillPriceProblem, zeroSkillPrice } from "./skill-payment";
import { canonicalTaxValue as canonical } from "./tax-receipt";

const operation: Op = { op: "negateSkills", target: { sel: { side: "both", area: "battle", filter: { ...emptyFilter(), type: "BATTLE" }, count: 99, upTo: false, notSelf: "card" } }, until: "game" };
/** Never admits a mixed body or changes the general static-operation whitelist. */
export function standingWholeDescriptor(ops: unknown): boolean {
  return canonical(ops) === canonical([operation]);
}
export function standingWholePrinted(skill: Skill): boolean {
  return skill.kind === "permanent" && skill.tags.length === 1 && skill.tags[0].toLowerCase() === "permanent"
    && skill.effect.trim().toLowerCase() === "negate the skills of all other battle cards."
    && !skill.cost.trim() && !skill.oncePerTurn && skill.limit === null && skill.bond === null
    && skill.sparking === null && skill.burst === null && skill.spiritBoost === null && skill.markerCost === null
    && !Object.keys(skill.energyCost).length && !skill.energyEither.length && !skill.granted && !skill.grants;
}
/** Native contexts retain the same unpriced, unqualified contract as stored rows. */
export function standingWholeScript(script: Script | undefined): boolean {
  return !!script && script.kind === "permanent" && Array.isArray(script.unsupported) && !script.unsupported.length
    && standingWholeDescriptor(script.ops) && canonical(script.trigger) === "[]" && script.combo == null
    && canonical(script.usage) === canonical({ version: 1, oncePerTurn: false, limit: null })
    && canonical(script.validity) === canonical({ version: 1, sparking: null })
    && !script.paidAdmission && !script.keepResolutionCondition && !script.playReplacement
    && !skillPriceProblem(script.price) && canonical(script.price) === canonical(zeroSkillPrice());
}
