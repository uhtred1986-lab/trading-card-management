/** Preparatory under-source policy. No native reader or admission imports this module. */
import type { Skill } from "../types";
import type { Op, Script } from "./script";
import { emptyFilter } from "../text/filters";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { standingWholePrinted, standingWholeScript } from "./standing-negation-policy";

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
export function standingUnderScript(script: Script | undefined): boolean {
    if (!script || !standingUnderDescriptor(script.ops)) return false;
    // Reuse the existing complete unqualified source-envelope validator only.
    const whole: Op = { op: "negateSkills", target: { sel: { side: "both", area: "battle",
        filter: { ...emptyFilter(), type: "BATTLE" }, count: 99, upTo: false, notSelf: "card" } }, until: "game" };
    return standingWholeScript({ ...script, ops: [whole] });
}
