/** Exact under-source policy. Native admission requires the complete zero-refusal envelope. */
import type { Skill } from "../types";
import type { Op, Script } from "./script";
import { skillPriceProblem, zeroSkillPrice } from "./skill-payment";
import { emptyFilter } from "../text/filters";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { standingWholePrinted } from "./standing-negation-policy";

const target = { sel: { special: "onTop" as const, filter: { ...emptyFilter(), type: "BATTLE" as const } } };
const operations: Op[] = [
    { op: "negateSkills", target, until: "game" },
    { op: "forbid", what: "attack", target, until: "game" },
];
export function standingUnderDescriptor(ops: unknown): boolean {
    return canonical(ops) === canonical(operations);
}
export function standingUnderPrinted(skill: Skill): boolean {
    return !!skill && skill.effect?.trim().toLowerCase() === "negate the skills of battle cards on top of this card, and those cards can't attack."
        && standingWholePrinted({ ...skill, effect: "Negate the skills of all other Battle Cards." });
}
/** Complete immutable envelope; reviewed refusal does not make a Script admitted. */
export function standingUnderEnvelope(script: Script | undefined, expectedUnsupported: readonly [] | readonly ["Permanent negateSkills is not collected as a runtime static"]): boolean {
    return (canonical(expectedUnsupported) === "[]" || canonical(expectedUnsupported) === canonical(["Permanent negateSkills is not collected as a runtime static"]))
        && !!script && script.kind === "permanent" && standingUnderDescriptor(script.ops)
        && Array.isArray(script.unsupported) && canonical(script.unsupported) === canonical(expectedUnsupported)
        && canonical(script.trigger) === "[]" && script.combo == null
        && canonical(script.usage) === canonical({ version: 1, oncePerTurn: false, limit: null })
        && canonical(script.validity) === canonical({ version: 1, sparking: null })
        && !script.paidAdmission && !script.keepResolutionCondition && !script.playReplacement
        && !skillPriceProblem(script.price) && canonical(script.price) === canonical(zeroSkillPrice());
}
export function standingUnderScript(script: Script | undefined): boolean {
    return standingUnderEnvelope(script, []);
}
