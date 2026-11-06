import type { NativeUnderWritePlan } from "./under-native-plan";
/** R513: the single 8-5-8 rule action, with all original reads before writes. */
import type { EngineContext, GameEvent, PlayerId } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState, ComboOrigin } from "./state";
import { emit, log, type Moment } from "./events";
import { findCard, isTokenCard, moveCard, type MoveRecord } from "./zones";
import { leaveRoute, replacementChoices } from "./replace";
import { captureMovementAutoHistory, requireMovementAutoBodies, type MovementAutoHistory } from "./movement-auto-history";
import { captureFlowPlacement, cleanupFlowPlacement, type FlowPlacementCapture } from "./flow-placement-cleanup";
import { beginStandingNegationMutation, finishStandingNegationMutation, validateStandingNegationRead } from "./standing-negation-runtime";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { skillsShowing } from "./triggers";
import { skillNegated } from "./effects";
import { NotYet, RulesetBroken } from "./errors";

export interface ComboDropSubject {
    card: string;
    to: "drop";
    controller: PlayerId;
    origin?: ComboOrigin;
    movementHistory: MovementAutoHistory;
}
interface Entry {
    subject: ComboDropSubject;
    placement: FlowPlacementCapture;
}
export interface ComboDropBatch { readonly kind: "comboDropBatch" }
interface Prepared {
    ctx: EngineContext;
    game: GameDefinition;
    state: VmState;
    end: NonNullable<NonNullable<VmState["battle"]>["endCombo"]>;
    history: VmState["mixedStandingNegationHistory"] | VmState["underStandingNegationHistory"];
    entries: Entry[];
    binding: string;
}
const prepared = new WeakMap<ComboDropBatch, Prepared>();

/** Other matches and an inactive Combo policy retain their existing protocol. */
export function needsComboDropBatch(state: VmState): boolean {
    return !!(state.underStandingNegationHistory ?? state.mixedStandingNegationHistory)?.active.some(entry => entry.source.policy === "opponentComboSevenInBattleV1");
}
function moment(subject: ComboDropSubject, special = false): Moment {
    return { event: "moved", card: subject.card, controller: subject.controller,
        movementHistory: subject.movementHistory,
        args: { from: "combo", to: "drop", fromHolder: subject.controller, asPlay: false,
            ...(special ? { cleanupSpecial: true } : { cleanupDeparture: true }) } };
}
function fail(): never {
    throw new NotYet("resolve an affected simultaneous Combo cleanup outside its reviewed plain departure batch", "R513");
}
/** No decisions or native callbacks are allowed between preparation and commit.
 * Unsupported replacements are refused before the first card leaves Combo. */
export function prepareComboDropBatch(ctx: EngineContext, game: GameDefinition, state: VmState): ComboDropBatch {
    validateStandingNegationRead(ctx, state);
    const end = state.battle?.endCombo;
    if (game.id !== "dbs" || !needsComboDropBatch(state) || !end || end.stage !== "departures"
        || end.departureCursor !== 0 || end.awaitingDeparture || end.substituteDeparture) fail();
    const actual = [state.turnPlayer, state.turnPlayer === "p1" ? "p2" as const : "p1" as const]
        .flatMap(player => state.sides[player].zones.combo);
    const ids = end.departureSubjects;
    if (!ids || ids.length !== actual.length || new Set(ids).size !== ids.length || ids.some(id => !actual.includes(id))) fail();
    const entries = ids.map(card => {
        const instance = state.cards[card], at = findCard(state, card);
        if (!instance || !at || at.zone !== "combo" || at.owner !== instance.owner || instance.hidden
            || instance.under.length || instance.zCard || isTokenCard(instance.cardId)
            || ctx.defs[instance.cardId]?.type !== "BATTLE") fail();
        // An unread Permanent can explicitly apply from Combo (DB2-140).
        // Its missing body is not evidence that no departure replacement exists.
        const showing = skillsShowing(ctx, state, card);
        for (const skill of showing.skills) {
            if (skill.kind !== "permanent" || skillNegated(state, card, skill.index, skill.kind)) continue;
            const script = showing.scripts.bySkill[skill.index];
            if (!script || !Array.isArray(script.unsupported) || script.unsupported.length || !Array.isArray(script.ops)) fail();
        }
        if (replacementChoices(ctx, game, state, card, undefined, { requestedTo: "drop", comboCleanup: true }).length) fail();
        const routeEvents: GameEvent[] = [];
        const route = leaveRoute(ctx, game, state, routeEvents, card, "combo", "drop", {
            replaced: null, event: `8-5-8:${state.turn}:${card}:${instance.zoneEpoch ?? 0}`,
        });
        if (route.stays || route.to !== "drop" || route.replacementApplied || route.mode || route.position
            || route.koProvenance.nativeHook !== "none" || routeEvents.length) fail();
        const origin = state.battle!.comboOrigins?.[card];
        const subject: ComboDropSubject = { card, to: "drop", controller: at.owner,
            ...(origin ? { origin } : {}), movementHistory: captureMovementAutoHistory(ctx, game, state, card) };
        return { subject, placement: captureFlowPlacement(state, card) };
    });
    // Preflight the complete deterministic route, including R505 payment and
    // final observer/grant guards, before any live write. No events or pending
    // Autos from this isolated copy reach the live state.
    {
        const projected = structuredClone(state);
        const transaction = beginStandingNegationMutation(ctx, projected, undefined, writePlan(entries));
        const results = entries.map(entry => place(projected, game, entry, []).move);
        finishStandingNegationMutation(ctx, projected, transaction, ids, undefined, results);
        for (const { subject } of entries) {
            if (!subject.movementHistory.unresolved.length) continue;
            requireMovementAutoBodies(game, projected, subject.movementHistory, moment(subject), false,
                undefined, moment(subject, true));
        }
    }
    const token: ComboDropBatch = { kind: "comboDropBatch" };
    prepared.set(token, { ctx, game, state, end, history: state.underStandingNegationHistory ?? state.mixedStandingNegationHistory, entries, binding: binding(state, entries) });
    return token;
}
function binding(state: VmState, entries: Entry[]): string {
    const end = state.battle?.endCombo;
    return canonical({ step: state.battle?.step, stage: end?.stage, cursor: end?.departureCursor,
        ids: end?.departureSubjects, awaiting: end?.awaitingDeparture, substitute: end?.substituteDeparture,
        specials: end?.specialSubjects, specialCursor: end?.specialCursor,
        cards: entries.map(({ subject }) => {
            const card = state.cards[subject.card];
            return { id: subject.card, cardId: card?.cardId, owner: card?.owner,
                at: findCard(state, subject.card), epoch: card?.zoneEpoch ?? 0,
                hidden: card?.hidden, hiddenCount: card?.hiddenCount ?? 0, flipped: card?.flipped,
                under: card?.under, zCard: card?.zCard, origin: state.battle?.comboOrigins?.[subject.card],
                placement: card ? captureFlowPlacement(state, subject.card) : null };
        }) });
}
/** This loop has no standing/attribute/skill reads. Combo and Drop have no
 * in-play enter/leave hooks; plain cards cannot release stacks or redirect at
 * the primitive layer. Every cleanup picture stays private until settlement. */
function writePlan(entries: Entry[]): NativeUnderWritePlan {
    return { moves: entries.map(({ subject }) => ({ route: "flow", card: subject.card, to: "drop",
        options: { owner: subject.controller, energyEntryCleanup: true } })) };
}
function place(state: VmState, game: GameDefinition, entry: Entry, events: GameEvent[]): { subject: ComboDropSubject; move: MoveRecord } {
    const { card, controller } = entry.subject;
    const result = moveCard(state, game, card, "drop", { owner: controller, energyEntryCleanup: true });
    if (!result.ok || result.move.from !== "combo" || result.move.to !== "drop"
        || result.move.card !== card || result.move.owner !== controller || result.move.fromOwner !== controller
        || (state.cards[card].zoneEpoch ?? 0) !== entry.subject.movementHistory.epoch + 1 || result.move.released?.length)
        throw new RulesetBroken(game.id, "prepared Combo cleanup lost its ordinary Drop route");
    cleanupFlowPlacement(state, events, result.move, structuredClone(entry.placement));
    log(events, { type: "move", card, from: "combo", to: "drop", owner: controller });
    return { subject: { ...entry.subject, card: result.move.card, controller: result.move.owner, to: "drop" }, move: result.move };
}
export function commitComboDropBatch(ctx: EngineContext, game: GameDefinition, state: VmState,
    events: GameEvent[], token: ComboDropBatch): ComboDropSubject[] {
    const batch = prepared.get(token);
    if (!batch || batch.ctx !== ctx || batch.game !== game || batch.state !== state
        || batch.end !== state.battle?.endCombo || batch.history !== (state.underStandingNegationHistory ?? state.mixedStandingNegationHistory)
        || batch.binding !== binding(state, batch.entries)) fail();
    validateStandingNegationRead(ctx, state);
    const transaction = beginStandingNegationMutation(ctx, state, undefined, writePlan(batch.entries));
    prepared.delete(token);
    const completed = batch.entries.map(entry => {
        const own: GameEvent[] = [];
        const { subject, move } = place(state, game, entry, own);
        return { subject, move, events: own };
    });
    finishStandingNegationMutation(ctx, state, transaction, batch.entries.map(entry => entry.subject.card), undefined, completed.map(entry => entry.move));
    for (let index = 0; index < batch.entries.length; index++) {
        for (const event of completed[index].events) log(events, event);
        emit(ctx, game, state, events, moment(completed[index].subject));
    }
    return completed.map(entry => entry.subject);
}
