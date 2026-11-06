/** R528 strict native policy authority. No reviewed refusal is an admitted Script. */
import type { EngineContext, Skill } from "../types";
import type { Script } from "./script";
import { parseSkills } from "../text/cards";
import { programsOf } from "./common";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { standingUnderDescriptor, standingUnderPrinted, standingUnderScript } from "./standing-negation-under-policy";
import { NotYet } from "./errors";
export interface NativeUnderDefinition {
    readonly admission: "native";
    readonly cardId: string;
    readonly side: "front" | "back";
    readonly skill: Skill;
    readonly script: Script;
    readonly definitionIdentity: string;
}
function refuse(): never { throw new NotYet("read a complete admitted original under-standing policy", "R528"); }
export function nativeUnderDefinitions(ctx: EngineContext, cardId: string, side: "front" | "back"): NativeUnderDefinition[] {
    const def = ctx.defs[cardId];
    if (!def || !["front", "back"].includes(side) || side === "back" && !def.back) return refuse();
    const scripts = programsOf(ctx, def, side), result: NativeUnderDefinition[] = [];
    for (const skill of parseSkills((side === "back" ? def.back?.skill : def.skill) ?? null)) {
        const script = scripts.bySkill[skill.index];
        if (!standingUnderPrinted(skill) && !standingUnderDescriptor(script?.ops)) continue;
        if (!standingUnderPrinted(skill) || !standingUnderScript(script)) return refuse();
        result.push({ admission: "native", cardId, side, skill: structuredClone(skill), script: structuredClone(script),
            definitionIdentity: canonical({ def, scripts }) });
    }
    return result;
}
