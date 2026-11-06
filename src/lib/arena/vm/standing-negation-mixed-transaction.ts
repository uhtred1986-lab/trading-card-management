/** R513 standalone adapter; no native writer or product loader imports it. */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { NotYet } from "./errors";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { requireResolvedGrantHistory, resolvedGrantDeleted } from "./resolved-grant-deletion";
import { emptyMixedStandingNegationHistory, settleMixedStandingNegation, validateMixedStandingNegationObservation } from "./standing-negation-mixed-history";
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
function savedObservation(history: History): Observation {
    if (!history || typeof history.observation !== "string")
        refuse("rebuild mixed transaction history");
    let parsed: {
        cards: Card[];
        battle: Observation["battle"];
        candidates: (Observation["candidates"][number] & {
            enabled?: boolean;
        })[];
    };
    try {
        parsed = JSON.parse(history.observation);
    }
    catch {
        return refuse("rebuild mixed stored observation");
    }
    if (!parsed || !Array.isArray(parsed.candidates)
        || Object.keys(parsed).sort().join(",") !== "battle,candidates,cards")
        refuse("rebuild mixed stored observation fields");
    const candidates = parsed.candidates.map(candidate => {
        if (!candidate || typeof candidate.enabled !== "boolean")
            refuse("rebuild mixed stored candidate condition");
        const facts = { ...candidate };
        delete facts.enabled;
        return facts;
    });
    const observation: Observation = { version: 2, policy: "mixedWholeV1", cards: parsed.cards, battle: parsed.battle, candidates };
    validateMixedStandingNegationObservation(history, observation);
    return observation;
}
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
    const previous = savedObservation(history);
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
/** A synchronous writer supplies actual fresh occurrences. Newly changed
 * area/holder/epoch/face facts cannot be inferred as authorized arrivals.
 * Publish only history and existing grant receipts after complete validation.
 */
export function settleMixedStandingNegationMutation(ctx: EngineContext, game: GameDefinition, state: MixedStandingState, token: MixedStandingNegationMutation, options: {
    arrivals?: readonly Card[];
    enablingOrder?: readonly string[];
} = {}): void {
    const captured = token && captures.get(token);
    if (!captured || captured.ctx !== ctx || captured.game !== game || captured.state !== state)
        refuse("rebuild original synchronous mixed transaction capture");
    if (!options || typeof options !== "object" || Array.isArray(options)
        || Object.keys(options).some(key => !["arrivals", "enablingOrder"].includes(key)))
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
    const observation = observeMixedStandingNegation(ctx, game, state, captured.history, arrivals);
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
