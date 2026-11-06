import { skillPriceProblem } from "./skill-payment";
import { usageProblem } from "./usage";
/** R476 reads only stored source descriptors; it never compiles printed text. */
import type { EngineContext } from "../types";
import type { VmState } from "./state";
import { skillsShowing } from "./triggers";
import { skillNegated, skillsNegated } from "./effects";
import { COPIED_SKILL_BASE, programsOf } from "./common";
import { requireValidity } from "./validity";
import { NotYet } from "./errors";
import { containsEnergyEntryDescriptor, energyEntryDescriptor, type EnergyEntryExhaustPolicy } from "./energy-entry-policy";
export function energyEntrySource(ctx: EngineContext, state: VmState, id: string, resolving = false): {
    skillIndex: number;
    policy: EnergyEntryExhaustPolicy;
} | undefined {
    const card = state.cards[id];
    if (!card || card.hidden || !resolving && skillsNegated(state, id))
        return;
    const showing = skillsShowing(ctx, state, id);
    let found: {
        skillIndex: number;
        policy: EnergyEntryExhaustPolicy;
    } | undefined;
    for (const skill of showing.skills) {
        if (skill.kind !== "permanent" || !resolving && skillNegated(state, id, skill.index, skill.kind))
            continue;
        const program = showing.scripts.bySkill[skill.index];
        if (!program || !containsEnergyEntryDescriptor(program.ops))
            continue;
        const policy = energyEntryDescriptor(program.ops);
        const price = program.price, payment = price?.payment;
        const qualified = program.kind !== "permanent" || !Array.isArray(program.trigger) || program.trigger.length || usageProblem(program.usage) || program.usage?.oncePerTurn || program.usage?.limit != null ||
            !price || skillPriceProblem(price) || !payment?.readable || Object.values(payment.orbs).some(Boolean) ||
            payment.either.length || payment.marker != null || payment.burst != null || payment.spiritBoost != null ||
            price.condition != null || price.ops != null && (!Array.isArray(price.ops) || price.ops.length !== 0) ||
            price.x != null || price.payWith != null && (!Array.isArray(price.payWith) || price.payWith.length !== 0) ||
            price.fusion != null || price.evolution != null || price.absorb != null || price.potara != null || price.awakenAlternative != null;
        if (qualified || !policy || program.unsupported.length || skill.index >= COPIED_SKILL_BASE || skill.bond !== undefined && skill.bond !== null || requireValidity(skill.validity).sparking !== null || found)
            throw new NotYet("this Energy entry source descriptor or qualification", "R476");
        found = { skillIndex: skill.index, policy };
    }
    return found;
}
/** Conservative identity-only cost preflight: both faces and copied descriptors
 * can matter after an earlier payment step. This never activates a descriptor. */
export function possibleEnergyEntrySource(ctx: EngineContext, state: VmState, id: string): boolean {
    const card = state.cards[id], def = card && ctx.defs[card.cardId];
    if (!def)
        return false;
    const has = (program: {
        ops: import("./script").Op[];
    } | undefined) => !!program && containsEnergyEntryDescriptor(program.ops);
    if (["front", "back"].some(side => Object.values(programsOf(ctx, def, side as "front" | "back").bySkill).some(has)))
        return true;
    return state.effects.some(effect => {
        if (effect.target !== id || effect.kind !== "copiedSkills")
            return false;
        const copy = effect.copied, source = copy && ctx.defs[copy.cardId];
        if (!copy || !source || !["front", "back"].includes(copy.side) || !Array.isArray(copy.skills) || copy.skills.some(index => !Number.isSafeInteger(index) || index < 0) || copy.side === "back" && !source.back)
            return true;
        const scripts = programsOf(ctx, source, copy.side);
        return copy.skills.some(index => has(scripts.bySkill[index]));
    });
}
