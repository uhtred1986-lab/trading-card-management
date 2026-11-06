/** R513 standalone adapter; no native writer or product loader imports it. */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { NotYet } from "./errors";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { requireResolvedGrantHistory, resolvedGrantDeleted } from "./resolved-grant-deletion";
import { emptyMixedStandingNegationHistory, settleMixedStandingNegation, validateMixedStandingNegationObservation, mixedStandingObservationFromHistory } from "./standing-negation-mixed-history";
import type { MixedStandingNegationCard as Card, MixedStandingNegationHistory as History, MixedStandingNegationObservation as Observation } from "./standing-negation-mixed-history";
import { hasMixedStandingPolicy, mixedStandingOccurrences, observeMixedStandingNegation } from "./standing-negation-mixed-observation";
import { invalidateMixedStandingNegationReadSeal, issueMixedStandingNegationReadSeal } from "./standing-negation-mixed-read";
/** Local adapter state only. Stage 2b owns any public native state contract. */
export type MixedStandingState = VmState & {
    mixedStandingNegationHistory?: History;
};
declare const tokenBrand: unique symbol;
export interface MixedStandingNegationMutation {
    readonly [tokenBrand]: true;
}
export type MixedBattleChange = {
    kind: "begin";
} | {
    kind: "end";
} | {
    kind: "retire" | "assign";
    roles: readonly ("attacker" | "guard")[];
};
interface Capture {
    ctx: EngineContext;
    game: GameDefinition;
    state: MixedStandingState;
    previous: Observation;
    history: History;
    historyIdentity: string;
    legacyIdentity: string;
}
const captures = new WeakMap<MixedStandingNegationMutation, Capture>();
function refuse(message: string): never { throw new NotYet(message, "R513"); }
function grantInvariant(state: MixedStandingState, history: History): void {
    for (const grant of suppressedGrants(state, history)) {
        if (!resolvedGrantDeleted(state, grant.target, grant.id))
            refuse("settle newly granted text under mixed whole-negation before reading");
    }
}
function suppressedGrants(state: MixedStandingState, history: History) {
    const targets = new Set(history.suppressed.map(edge => edge.target.card));
    for (const target of targets)
        requireResolvedGrantHistory(state, target);
    return state.effects.filter(effect => targets.has(effect.target) && ["keyword", "copiedSkills"].includes(effect.kind));
}
function current(ctx: EngineContext, game: GameDefinition, state: MixedStandingState) {
    const history = state.mixedStandingNegationHistory;
    if (!history || state.standingNegationHistory !== undefined)
        refuse("rebuild affected mixed history without migrating legacy generations");
    const previous = mixedStandingObservationFromHistory(history);
    const observation = observeMixedStandingNegation(ctx, game, state, history);
    validateMixedStandingNegationObservation(history, observation);
    grantInvariant(state, history);
    return { observation, previous, history };
}
/** Explicit fresh-game factory boundary, not a legacy-save repair API.
 * Actual native createGame dispatch is deferred to stage 2b.
 */
export function initializeMixedStandingNegation(ctx: EngineContext, game: GameDefinition, state: MixedStandingState): void {
    if (!hasMixedStandingPolicy(ctx))
        return;
    if (state.turn !== 0 || state.battle || state.standingNegationHistory !== undefined
        || state.mixedStandingNegationHistory !== undefined
        || state.effects.length || state.resolvedGrantDeletions?.length
        || ["p1", "p2"].some(p => state.sides[p as "p1" | "p2"].zones.combo.length))
        refuse("initialize mixed history only at the fresh native game boundary");
    const observation = observeMixedStandingNegation(ctx, game, state, emptyMixedStandingNegationHistory());
    if (observation.candidates.some(candidate => candidate.source.policy === "otherBattleWholeV1"))
        refuse("initialize mixed history before Battle sources enter play");
    const history = settleMixedStandingNegation(emptyMixedStandingNegationHistory(), observation);
    validateMixedStandingNegationObservation(history, observation);
    state.mixedStandingNegationHistory = history;
    issueMixedStandingNegationReadSeal(ctx, state, history, observation);
}
/** No-context readers can use a seal only after these actual native facts and
 * original grant receipts were validated. Does not repair changed boards.
 */
export function assertMixedStandingNegationSettled(ctx: EngineContext, game: GameDefinition, state: MixedStandingState): void {
    const { observation, history } = current(ctx, game, state);
    issueMixedStandingNegationReadSeal(ctx, state, history, observation);
}
export function captureMixedStandingNegationMutation(ctx: EngineContext, game: GameDefinition, state: MixedStandingState): MixedStandingNegationMutation {
    const { observation, history } = current(ctx, game, state);
    const token = Object.freeze({}) as MixedStandingNegationMutation;
    captures.set(token, { ctx, game, state, previous: structuredClone(observation), history: structuredClone(history),
        historyIdentity: canonical(history), legacyIdentity: canonical(state.standingNegationHistory ?? null) });
    invalidateMixedStandingNegationReadSeal(state);
    return token;
}
/** A change instruction is native transaction input, never a saved permission.
 * Reads do not derive a retirement or adopt a new occurrence from role IDs.
 */
function changedParticipants(state: MixedStandingState, previous: Observation, cards: Card[], change?: MixedBattleChange): Observation["battle"] {
    if (change === undefined)
        return previous.battle;
    if (!change || typeof change !== "object" || Array.isArray(change))
        refuse("rebuild explicit mixed battle change");
    if (change.kind === "begin") {
        if (Object.keys(change).length !== 1 || previous.battle || !state.battle)
            refuse("bind a new mixed battle declaration");
        const participant = (id: string) => ({ occurrence: cards.find(card => card.card === id)
                ?? refuse("bind new battle participant to actual occurrence"), present: true });
        return { attacker: participant(state.battle.attacker), guard: participant(state.battle.guard) };
    }
    if (change.kind === "end") {
        if (Object.keys(change).length !== 1 || !previous.battle || state.battle)
            refuse("bind the actual end of mixed battle participation");
        return null;
    }
    if (!["retire", "assign"].includes(change.kind) || Object.keys(change).sort().join(",") !== "kind,roles"
        || !Array.isArray(change.roles) || !change.roles.length || change.roles.some(role => !["attacker", "guard"].includes(role))
        || new Set(change.roles).size !== change.roles.length || !previous.battle || !state.battle)
        refuse("bind explicit mixed battle participant transition");
    const next = structuredClone(previous.battle);
    for (const role of change.roles as readonly ("attacker" | "guard")[]) {
        const old = next[role];
        if (change.kind === "retire") {
            if (!old.present || state.battle[role] !== old.occurrence.card)
                refuse("retire only the captured current battle participant");
            old.present = false;
        }
        else {
            const occurrence = cards.find(card => card.card === state.battle![role]);
            if (!occurrence || occurrence.card === old.occurrence.card)
                refuse("assign a genuinely new native battle participant occurrence");
            next[role] = { occurrence, present: true };
        }
    }
    return next;
}
/** A synchronous writer supplies actual fresh occurrences. Newly changed
 * area/holder/epoch/face facts cannot be inferred as authorized arrivals.
 * Publish only history and existing grant receipts after complete validation.
 */
export function settleMixedStandingNegationMutation(ctx: EngineContext, game: GameDefinition, state: MixedStandingState, token: MixedStandingNegationMutation, options: {
    arrivals?: readonly Card[];
    enablingOrder?: readonly string[];
    battle?: MixedBattleChange;
} = {}): void {
    const captured = token && captures.get(token);
    if (!captured || captured.ctx !== ctx || captured.game !== game || captured.state !== state)
        refuse("rebuild original synchronous mixed transaction capture");
    if (!options || typeof options !== "object" || Array.isArray(options)
        || Object.keys(options).some(key => !["arrivals", "enablingOrder", "battle"].includes(key)))
        refuse("rebuild mixed transaction options");
    if (canonical(state.mixedStandingNegationHistory) !== captured.historyIdentity
        || canonical(state.standingNegationHistory ?? null) !== captured.legacyIdentity)
        refuse("mixed history changed during captured mutation");
    const arrivals = options.arrivals === undefined ? [] : options.arrivals, cards = mixedStandingOccurrences(ctx, game, state);
    if (!Array.isArray(arrivals) || new Set(arrivals.map(card => card?.card)).size !== arrivals.length
        || arrivals.some(card => !cards.some(actual => canonical(actual) === canonical(card))
            || captured.previous.cards.some(prior => canonical(prior) === canonical(card)))
        || cards.some(card => !captured.previous.cards.some(prior => canonical(prior) === canonical(card))
            && !arrivals.some(arrival => canonical(arrival) === canonical(card))))
        refuse("bind mixed transaction arrivals to actual new physical occurrences");
    const participants = changedParticipants(state, captured.previous, cards, options.battle);
    const observation = observeMixedStandingNegation(ctx, game, state, captured.history, arrivals, participants);
    const history = settleMixedStandingNegation(captured.history, observation, options.enablingOrder);
    const grants = suppressedGrants(state, history);
    const receipts = state.resolvedGrantDeletions === undefined ? undefined : structuredClone(state.resolvedGrantDeletions);
    for (const grant of grants) {
        const card = state.cards[grant.target];
        const receipt = receipts?.find(item => item.card === grant.target && item.epoch === (card.zoneEpoch ?? 0)
            && item.hiddenCount === (card.hiddenCount ?? 0) && item.grant === grant.id);
        if (!receipt)
            refuse("rebuild original grant receipt before mixed standing deletion");
        receipt.deleted = true;
    }
    const staged: MixedStandingState = { ...state, mixedStandingNegationHistory: history,
        ...(receipts === undefined ? {} : { resolvedGrantDeletions: receipts }) };
    // Newly deleted copies must not change source discovery; copied sources are
    // refused before publication, rather than silently disappearing mid-commit.
    const checked = current(ctx, game, staged);
    state.mixedStandingNegationHistory = history;
    if (receipts !== undefined)
        state.resolvedGrantDeletions = receipts;
    captures.delete(token);
    issueMixedStandingNegationReadSeal(ctx, state, history, checked.observation);
}
