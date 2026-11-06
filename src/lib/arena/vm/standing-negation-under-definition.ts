/** R523 isolated review descriptor. No loader or production reader imports this. */
import type { EngineContext, Skill } from "../types";
import type { Script } from "./script";
import { parseSkills } from "../text/cards";
import { programsOf } from "./common";
import { standingUnderDescriptor, standingUnderPrinted, standingUnderEnvelope } from "./standing-negation-under-policy";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { underRebuild } from "./standing-negation-under-relation";
export const UNDER_REVIEW_REFUSAL = "Permanent negateSkills is not collected as a runtime static";
export interface ReviewedUnderDefinition {
    version: 1;
    admission: "isolated-review-only";
    cardId: string;
    side: "front" | "back";
    skill: Skill;
    script: Script;
    definitionIdentity: string;
}
export function reviewUnderStandingDefinitions(ctx: EngineContext, cardId: string, side: "front" | "back"): ReviewedUnderDefinition[] {
    const def = ctx.defs[cardId];
    if (!def || !["front", "back"].includes(side) || side === "back" && !def.back)
        return underRebuild("review an actual complete under-standing definition");
    const scripts = programsOf(ctx, def, side), result: ReviewedUnderDefinition[] = [];
    for (const skill of parseSkills((side === "back" ? def.back?.skill : def.skill) ?? null)) {
        const script = scripts.bySkill[skill.index];
        if (!standingUnderPrinted(skill) && !standingUnderDescriptor(script?.ops)) continue;
        if (!standingUnderPrinted(skill) || !standingUnderEnvelope(script, [UNDER_REVIEW_REFUSAL]))
            return underRebuild("review the exact original under policy and its unchanged loader refusal");
        result.push({ version: 1, admission: "isolated-review-only", cardId, side,
            skill: structuredClone(skill), script: structuredClone(script), definitionIdentity: canonical({ def, scripts }) });
    }
    return result;
}
export function requireReviewedUnderDefinition(ctx: EngineContext, value: ReviewedUnderDefinition): void {
    if (!value || typeof value !== "object" || value.version !== 1 || value.admission !== "isolated-review-only"
        || !reviewUnderStandingDefinitions(ctx, value.cardId, value.side).some(actual => canonical(actual) === canonical(value)))
        underRebuild("rebuild the preserved original under-standing review descriptor");
}
