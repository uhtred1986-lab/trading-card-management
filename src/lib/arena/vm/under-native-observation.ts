/** R528 actual admitted source observation. Native writer hookup is separate. */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { programsOf } from "./common";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { discoverNativeUnderCandidates, underStandingCandidateFacts, underPhysicalFacts } from "./standing-negation-under-observation";
import { discoverNativeUnderAwareAreaFacts } from "./standing-negation-native-facts";
import { qualifyNativeStandingDiscoveries } from "./standing-negation-joint-facts";
import { validateUnderStandingHistory, readUnderStandingPlan, type UnderHistory, type UnderObservation } from "./standing-negation-under-history";
import { requireResolvedGrantHistory, resolvedGrantDeleted } from "./resolved-grant-deletion";
import { NotYet } from "./errors";
export type NativeUnderState = VmState & { underStandingNegationHistory?: UnderHistory };
export function refuseNativeUnder(message: string): never { throw new NotYet(message, "R528"); }
export function nativeUnderPhysicalFacts(state: VmState) {
    if (!state || !state.cards || typeof state.cards !== "object" || Array.isArray(state.cards) || !state.sides
        || !Array.isArray(state.effects) || !Number.isSafeInteger(state.nextEffect) || state.nextEffect < 0
        || Object.keys(state.sides).sort().join() !== "p1,p2")
        return refuseNativeUnder("observe a complete native physical board");
    for (const [id, card] of Object.entries(state.cards)) if (!card || card.id !== id || !Array.isArray(card.under))
        return refuseNativeUnder("bind every native card dictionary key to its actual physical identity");
    const placed = new Set<string>();
    for (const side of Object.values(state.sides)) {
        if (!side || !side.zones) return refuseNativeUnder("observe complete native zone arrays");
        for (const ids of Object.values(side.zones)) {
            if (!Array.isArray(ids)) return refuseNativeUnder("observe complete native zone arrays");
            for (const id of ids) {
                if (typeof id !== "string" || !state.cards[id] || placed.has(id))
                    return refuseNativeUnder("reject dangling or duplicate native zone references");
                placed.add(id);
            }
        }
    }
    for (const card of Object.values(state.cards)) for (const id of card.under) {
        if (typeof id !== "string" || !state.cards[id] || placed.has(id))
            return refuseNativeUnder("reject dangling or duplicate native pile references");
        placed.add(id);
    }
    return underPhysicalFacts(state);
}
export function nativeUnderDefinitionsIdentity(ctx: EngineContext, state: VmState): string {
    const ids = new Set(nativeUnderPhysicalFacts(state).map(fact => fact.occurrence.cardId));
    for (const effect of state.effects) if (effect.copied) ids.add(effect.copied.cardId);
    return canonical([...ids].sort().map(id => ({ id, def: ctx.defs[id],
        front: ctx.defs[id] && programsOf(ctx, ctx.defs[id], "front"),
        back: ctx.defs[id]?.back && programsOf(ctx, ctx.defs[id], "back") })));
}
/** Per-card physical facts preserve every holder and duplicate membership while
 * ignoring deck permutation. Unrelated movement can invalidate a seal without
 * requiring a new generation: the actual observer can prove the ledger equal. */
export function nativeUnderFingerprint(ctx: EngineContext, state: VmState): string {
    return canonical({ game: state.game, pinned: (ctx as EngineContext & { rulesetDefinition?: GameDefinition }).rulesetDefinition, physical: nativeUnderPhysicalFacts(state), zones: Object.values(state.sides).map(side => Object.keys(side.zones).sort()), definitions: nativeUnderDefinitionsIdentity(ctx, state),
        effects: state.effects, grants: state.resolvedGrantDeletions, leaderBases: Object.values(state.cards).map(card => [card.id, card.leaderStackVersion, card.leaderBase]),
        battle: state.battle ? { attacker: state.battle.attacker, guard: state.battle.guard } : null });
}
export function requireExclusiveNativeUnder(state: NativeUnderState): UnderHistory {
    if (!state.underStandingNegationHistory || state.standingNegationHistory !== undefined || state.mixedStandingNegationHistory !== undefined)
        return refuseNativeUnder("use one original native v3 standing history without migration");
    validateUnderStandingHistory(state.underStandingNegationHistory);
    return state.underStandingNegationHistory;
}
/** Writer adapters validate new arrivals/assignments before passing them here;
 * ordinary reads retain the original roles and supply no arrivals. */
export function observeNativeUnderStanding(ctx: EngineContext, game: GameDefinition, state: NativeUnderState,
    history: UnderHistory, arrivals: UnderObservation["area"]["cards"] = [],
    battle: UnderObservation["area"]["battle"] = history.observation.area.battle): UnderObservation {
    if (game.id !== state.game) return refuseNativeUnder("observe native standing with its actual game definition");
    validateUnderStandingHistory(history);
    const physical = nativeUnderPhysicalFacts(state);
    if (Object.values(state.sides).some(side => Object.keys(side.zones).some(zone => !game.zones[zone] || game.zones[zone].place === false)))
        return refuseNativeUnder("observe only areas declared by the actual game definition");
    for (const fact of physical) {
        if (fact.locations.length > 1 || fact.hosts.length > 1 || fact.locations.length && fact.hosts.length)
            return refuseNativeUnder("observe unique actual native zone and pile membership");
        if (!fact.pile.length) continue;
        if (fact.locations.length !== 1 || fact.hosts.length || new Set(fact.pile).size !== fact.pile.length)
            return refuseNativeUnder("observe one actual outer pile before native standing qualification");
        for (const id of fact.pile) {
            const child = physical.find(item => item.occurrence.card === id);
            if (!child || child.locations.length || child.hosts.length !== 1 || child.pile.length || child.hosts[0].host !== fact.occurrence.card)
                return refuseNativeUnder("observe actual flat native pile membership");
        }
    }
    const under = discoverNativeUnderCandidates(ctx, game, state);
    const facts = underStandingCandidateFacts(ctx, game, state, under);
    if (!Array.isArray(arrivals) || new Set(arrivals.map(card => card?.card)).size !== arrivals.length
        || arrivals.some(card => !facts.cards.some(current => canonical(current) === canonical(card))))
        return refuseNativeUnder("observe only exact native actual arrival occurrences");
    const area = discoverNativeUnderAwareAreaFacts(ctx, game, state, battle, facts.under.length > 0);
    return qualifyNativeStandingDiscoveries(ctx, game, state, history, area, under, arrivals).observation;
}

/** Re-observe the actual board; matching caller-supplied observations never
 * authorize a read seal or repair a changed ledger. */
export function validateNativeUnderCurrent(ctx: EngineContext, game: GameDefinition, state: NativeUnderState) {
    const history = requireExclusiveNativeUnder(state);
    const observation = observeNativeUnderStanding(ctx, game, state, history);
    readUnderStandingPlan(history, observation);
    const targets = new Set(history.negated.map(edge => edge.target.card));
    for (const target of targets) requireResolvedGrantHistory(state, target);
    for (const effect of state.effects) if (targets.has(effect.target) && ["keyword", "copiedSkills"].includes(effect.kind)
        && !resolvedGrantDeleted(state, effect.target, effect.id))
        return refuseNativeUnder("delete all current grants under native suppression before sealing reads");
    return { history, observation };
}

/** Existing dormant native procedures may run only without active standing interactions. */
export function requireDormantNativePolicy(state: NativeUnderState, procedure: string): void {
    const history = requireExclusiveNativeUnder(state);
    if (history.active.length || history.observation.under.length
        || history.observation.area.candidates.some(candidate => candidate.source.policy === "otherBattleWholeV1"))
        return refuseNativeUnder(`review active standing interactions during ${procedure}`);
}
