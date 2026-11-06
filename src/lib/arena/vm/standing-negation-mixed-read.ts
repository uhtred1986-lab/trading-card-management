import { scopedStandingReadMatches, scopedStandingReadContext, invalidateScopedStandingRead } from "./standing-read-scope";
/** R513 private read seals issued by the validated native mixed-policy observer. */
import type { EngineContext } from "../types";
import type { VmState } from "./state";
import type { MixedStandingNegationHistory, MixedStandingNegationObservation } from "./standing-negation-mixed-history";
import { validateMixedStandingNegationObservation } from "./standing-negation-mixed-history";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { NotYet } from "./errors";
const seals = new WeakMap<VmState, {
    ctx: EngineContext;
    facts: string;
    history: string;
}>();
/** Only policy dependencies, including physical membership and battle roles.
 * Effects and grant-deletion receipts remain authoritative external inputs;
 * this module neither changes nor reconstructs them.
 */
function fingerprint(ctx: EngineContext, state: VmState): string {
    const occurrence = (id: string) => {
        const card = state.cards[id];
        return { id, cardId: card?.cardId, epoch: card?.zoneEpoch ?? 0,
            hidden: card?.hidden, hiddenCount: card?.hiddenCount ?? 0,
            flipped: card?.flipped, owner: card?.owner };
    };
    const board = (["p1", "p2"] as const).map(holder => ({ holder,
        areas: Object.fromEntries((["leader", "battle", "unison", "combo", "energy"] as const)
            .map(area => [area, (state.sides[holder].zones[area] ?? []).map(occurrence)])),
    }));
    const definitions = new Set(Object.values(state.cards).map(card => card.cardId));
    for (const effect of state.effects)
        if (effect.copied)
            definitions.add(effect.copied.cardId);
    const sources = [...definitions].sort().map(id => ({ id, type: ctx.defs[id]?.type,
        skill: ctx.defs[id]?.skill, back: ctx.defs[id]?.back?.skill,
        front: ctx.scripts?.[id], backScript: ctx.scripts?.[`${id}#back`] }));
    return canonical({ board, sources, battle: state.battle ? {
            attacker: occurrence(state.battle.attacker), guard: occurrence(state.battle.guard),
        } : null, effects: state.effects, grants: state.resolvedGrantDeletions });
}
/** The native observer derives observation from this board and validates
 * grant history before issuing this transient witness, as for the v1 seal.
 */
export function issueMixedStandingNegationReadSeal(ctx: EngineContext, state: VmState, history: MixedStandingNegationHistory, observation: MixedStandingNegationObservation): void {
    validateMixedStandingNegationObservation(history, observation);
    seals.set(state, { ctx, facts: fingerprint(ctx, state), history: canonical(history) });
}
export function invalidateMixedStandingNegationReadSeal(state: VmState): void {
    invalidateScopedStandingRead(state);
    seals.delete(state);
}
export function mixedStandingNegationReadSealMatches(ctx: EngineContext, state: VmState, history: MixedStandingNegationHistory): boolean {
    if (state.mixedStandingNegationHistory && history === state.mixedStandingNegationHistory && scopedStandingReadMatches(ctx, state)) return true;
    const seal = seals.get(state);
    return !!seal && seal.ctx === ctx && seal.facts === fingerprint(ctx, state) && seal.history === canonical(history);
}
export function mixedStandingSkillsNegated(state: VmState, history: MixedStandingNegationHistory, id: string): boolean {
    const seal = seals.get(state);
    const scopeCtx = scopedStandingReadContext(state);
    if (!(scopeCtx && state.mixedStandingNegationHistory && history === state.mixedStandingNegationHistory) && (!seal || !mixedStandingNegationReadSealMatches(seal.ctx, state, history))) {
        throw new NotYet("validate mixed standing-negation history before reading the changed board", "R513");
    }
    return history.suppressed.some(edge => edge.target.card === id);
}
