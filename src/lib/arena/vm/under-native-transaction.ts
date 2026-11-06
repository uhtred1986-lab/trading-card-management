/** R528 preflighted native v3 writes. Tokens are synchronous and never saved. */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { MoveRecord } from "./zones";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { nativeUnderDefinitions } from "./under-native-policy";
import { mixedStandingOccurrences } from "./standing-negation-native-facts";
import { emptyUnderStandingHistory, settleUnderStanding, type UnderHistory, type UnderObservation } from "./standing-negation-under-history";
import { requireUnderRelationChange, underStandingSourceKey, type UnderRelationChange } from "./standing-negation-under-relation";
import { requireResolvedGrantHistory } from "./resolved-grant-deletion";
import { nativeUnderPhysicalFacts, nativeUnderFingerprint, observeNativeUnderStanding,
    validateNativeUnderCurrent, requireExclusiveNativeUnder, refuseNativeUnder as fail, type NativeUnderState } from "./under-native-observation";
import { issueNativeUnderRead, invalidateNativeUnderRead } from "./under-native-read";
import { projectNativeUnderWrite, type NativeUnderWritePlan } from "./under-native-plan";

/** Initial family selection concerns physical match cards, including both faces. */
export function hasNativeUnderPolicy(ctx: EngineContext, state: NativeUnderState): boolean {
    return nativeUnderPhysicalFacts(state).some(fact => {
        const def = ctx.defs[fact.occurrence.cardId];
        if (!def) return fail("read every actual native source definition");
        return nativeUnderDefinitions(ctx, def.id, "front").length > 0
            || !!def.back && nativeUnderDefinitions(ctx, def.id, "back").length > 0;
    });
}
export function initializeNativeUnderStanding(ctx: EngineContext, game: GameDefinition, state: NativeUnderState): void {
    if (!hasNativeUnderPolicy(ctx, state)) return;
    if (state.turn !== 0 || state.battle || state.standingNegationHistory !== undefined || state.mixedStandingNegationHistory !== undefined
        || state.underStandingNegationHistory !== undefined || state.effects.length || state.resolvedGrantDeletions?.length
        || Object.values(state.sides).some(side => side.zones.combo.length)) return fail("initialize native v3 only at the fresh game boundary");
    const empty = emptyUnderStandingHistory(), observation = observeNativeUnderStanding(ctx, game, state, empty);
    if (observation.under.length || observation.area.candidates.some(candidate => candidate.source.policy === "otherBattleWholeV1"))
        return fail("initialize original native history before any under or Battle source is active");
    const history = settleUnderStanding(empty, observation);
    const staged = { ...state, underStandingNegationHistory: history };
    validateNativeUnderCurrent(ctx, game, staged);
    state.underStandingNegationHistory = history;
    issueNativeUnderRead(ctx, game, state);
}
export function assertNativeUnderStandingSettled(ctx: EngineContext, game: GameDefinition, state: NativeUnderState): void {
    issueNativeUnderRead(ctx, game, state);
}
function dependencyIdentity(ctx: EngineContext, state: NativeUnderState): string {
    return canonical({ facts: nativeUnderFingerprint(ctx, state), ownership: state.appliedEffectOwnership,
        nextEffect: state.nextEffect, turn: state.turn, turnPlayer: state.turnPlayer });
}
function familyIdentity(state: NativeUnderState): string {
    return canonical([state.standingNegationHistory, state.mixedStandingNegationHistory, state.underStandingNegationHistory]);
}
function participants(ctx: EngineContext, game: GameDefinition, state: NativeUnderState, previous: UnderObservation,
    plan: NativeUnderWritePlan): UnderObservation["area"]["battle"] {
    const cards = mixedStandingOccurrences(ctx, game, state), change = plan.battle;
    const current = (id: string) => cards.find(card => card.card === id) ?? fail("bind a native participant to its actual in-play occurrence");
    if (change?.kind === "begin") {
        if (previous.area.battle || !state.battle) return fail("capture native battle beginning once");
        return { attacker: { occurrence: current(change.attacker), present: true }, guard: { occurrence: current(change.guard), present: true } };
    }
    if (change?.kind === "end") {
        if (!previous.area.battle || state.battle) return fail("capture actual native battle ending");
        return null;
    }
    if (!previous.area.battle) {
        if (state.battle) return fail("retain the original absence of native battle participation");
        return null;
    }
    if (!state.battle) return fail("end native participation through its actual writer");
    const out = structuredClone(previous.area.battle);
    for (const role of ["attacker", "guard"] as const) {
        const old = out[role];
        if (plan.hidden?.card === old.occurrence.card && plan.hidden.hidden) {
            old.present = false;
        } else if (plan.stack && old.occurrence.card === plan.stack.host) {
            out[role] = { occurrence: current(plan.stack.card), present: true };
        } else if (change?.kind === "assign" && change.role === role) {
            if (change.card === old.occurrence.card) return fail("assign a genuinely different participant");
            out[role] = { occurrence: current(change.card), present: true };
        } else if (change?.kind === "face" && change.card === old.occurrence.card && old.present) {
            const next = current(change.card);
            if (old.occurrence.area !== "leader" || next.area !== "leader" || next.side === old.occurrence.side
                || ctx.defs[next.cardId]?.type !== "LEADER" || canonical({ ...next, side: old.occurrence.side }) !== canonical(old.occurrence))
                return fail("retain only a normal Leader through its actual face writer");
            out[role] = { occurrence: next, present: true };
        } else if (old.present && !cards.some(card => canonical(card) === canonical(old.occurrence))) {
            if (!(plan.moves ?? []).some(move => move.card === old.occurrence.card))
                return fail("retire participation only from the captured movement writer");
            old.present = false;
        }
        if (state.battle[role] !== out[role].occurrence.card) return fail("retain the captured native role assignment");
    }
    return out;
}
function relationChanges(previous: UnderObservation, next: UnderObservation): UnderRelationChange[] {
    const changes: UnderRelationChange[] = [];
    for (const candidate of next.under) {
        const old = previous.under.find(item => underStandingSourceKey(item.source) === underStandingSourceKey(candidate.source));
        if (old && canonical(old.relation) !== canonical(candidate.relation)) {
            const change: UnderRelationChange = { kind: "reorder", before: old.relation, after: candidate.relation };
            requireUnderRelationChange(change); changes.push(change);
        }
    }
    return changes;
}
function settleProjected(ctx: EngineContext, game: GameDefinition, state: NativeUnderState, history: UnderHistory, plan: NativeUnderWritePlan): void {
    const cards = mixedStandingOccurrences(ctx, game, state);
    const arrivals = cards.filter(card => !history.observation.area.cards.some(old => canonical(old) === canonical(card)));
    const battle = participants(ctx, game, state, history.observation, plan);
    const observation = observeNativeUnderStanding(ctx, game, state, history, arrivals, battle);
    const next = settleUnderStanding(history, observation, relationChanges(history.observation, observation));
    const targets = new Set(next.negated.map(edge => edge.target.card));
    for (const id of targets) requireResolvedGrantHistory(state, id);
    const receipts = state.resolvedGrantDeletions === undefined ? undefined : structuredClone(state.resolvedGrantDeletions);
    for (const grant of state.effects.filter(effect => targets.has(effect.target) && ["keyword", "copiedSkills"].includes(effect.kind))) {
        const card = state.cards[grant.target], receipt = receipts?.find(item => item.card === grant.target && item.grant === grant.id
            && item.epoch === (card.zoneEpoch ?? 0) && item.hiddenCount === (card.hiddenCount ?? 0));
        if (!receipt) return fail("bind all-current standing grant deletion to its original receipt");
        receipt.deleted = true;
    }
    const staged = { ...state, underStandingNegationHistory: next, ...(receipts === undefined ? {} : { resolvedGrantDeletions: receipts }) };
    // Deleting a copied definition must not silently change the discovered source graph.
    validateNativeUnderCurrent(ctx, game, staged);
    state.underStandingNegationHistory = next;
    if (receipts !== undefined) state.resolvedGrantDeletions = receipts;
}
declare const tokenBrand: unique symbol;
export interface NativeUnderMutation { readonly [tokenBrand]: true }
interface Capture {
    ctx: EngineContext; game: GameDefinition; gameIdentity: string; state: NativeUnderState;
    before: string; family: string; after: string; results: MoveRecord[];
    plan: NativeUnderWritePlan; planIdentity: string;
    history: UnderHistory; receipts: NativeUnderState["resolvedGrantDeletions"];
}
const captures = new WeakMap<NativeUnderMutation, Capture>();
/** Qualification, cleanup and all grant deletions are proven before live writes.
 * The closed plan is internally replayed; no caller-supplied projection can
 * smuggle in effects, participant assignments or a replacement under relation. */
export function prepareNativeUnderMutation(ctx: EngineContext, game: GameDefinition, state: NativeUnderState, plan: NativeUnderWritePlan): NativeUnderMutation {
    const { history } = validateNativeUnderCurrent(ctx, game, state);
    const before = dependencyIdentity(ctx, state), family = familyIdentity(state);
    const { state: projected, results } = projectNativeUnderWrite(ctx, game, state, plan);
    const after = dependencyIdentity(ctx, projected);
    settleProjected(ctx, game, projected, history, plan);
    const token = Object.freeze({}) as NativeUnderMutation;
    captures.set(token, { ctx, game, gameIdentity: canonical(game), state, before, family, after, plan, planIdentity: canonical(plan), results: structuredClone(results),
        history: structuredClone(projected.underStandingNegationHistory!), receipts: structuredClone(projected.resolvedGrantDeletions) });
    return token;
}
function capture(ctx: EngineContext, game: GameDefinition, state: NativeUnderState, token: NativeUnderMutation): Capture {
    const value = token && captures.get(token);
    if (!value || value.ctx !== ctx || value.game !== game || value.gameIdentity !== canonical(game) || game.id !== state.game || value.state !== state) return fail("use the original synchronous native writer capture");
    return value;
}
/** Writer calls this immediately before its first live mutation. */
export function requireNativeUnderMutation(ctx: EngineContext, game: GameDefinition, state: NativeUnderState, token: NativeUnderMutation): void {
    const value = capture(ctx, game, state, token);
    if (canonical(value.plan) !== value.planIdentity || familyIdentity(state) !== value.family || dependencyIdentity(ctx, state) !== value.before) return fail("preserve the original preflighted writer inputs");
    invalidateNativeUnderRead(state);
}
/** Only policy history and original grant deletion flags are published here;
 * the actual native writer already owns physical movement/effects/events. */
export function settleNativeUnderMutation(ctx: EngineContext, game: GameDefinition, state: NativeUnderState, token: NativeUnderMutation, results: readonly MoveRecord[] = []): void {
    const value = capture(ctx, game, state, token);
    requireExclusiveNativeUnder(state);
    if (familyIdentity(state) !== value.family || dependencyIdentity(ctx, state) !== value.after || canonical(results) !== canonical(value.results))
        return fail("complete exactly the preflighted actual native writer result");
    const staged = { ...state, underStandingNegationHistory: value.history,
        ...(value.receipts === undefined ? {} : { resolvedGrantDeletions: value.receipts }) };
    validateNativeUnderCurrent(ctx, game, staged);
    state.underStandingNegationHistory = structuredClone(value.history);
    if (value.receipts !== undefined) state.resolvedGrantDeletions = structuredClone(value.receipts);
    captures.delete(token);
    issueNativeUnderRead(ctx, game, state);
}
