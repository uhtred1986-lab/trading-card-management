/** R523 isolated transaction proofs; no engine history/grant writer or read seal. */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { requireResolvedGrantHistory, resolvedGrantDeleted } from "./resolved-grant-deletion";
import { emptyUnderStandingHistory, settleUnderStanding, readUnderStandingPlan, type UnderHistory } from "./standing-negation-under-history";
import { underRebuild as fail, underStandingSourceKey, type UnderRelationChange } from "./standing-negation-under-relation";
import { observeUnderStandingFacts, underPhysicalFacts } from "./standing-negation-under-observation";
import type { ReviewedUnderDefinition } from "./standing-negation-under-definition";
export type UnderProofIntent = { kind: "attach" | "detach"; source: string; host: string }
    | { kind: "reorder"; host: string } | { kind: "effects" };
declare const brand: unique symbol;
export interface UnderObservationCapture { readonly [brand]: true }
interface Capture {
    definitions: string; ctx: EngineContext; game: GameDefinition; state: VmState; history: UnderHistory;
    reviewed: readonly ReviewedUnderDefinition[]; originalGrants: VmState["effects"]; originalGrantReceipts: NonNullable<VmState["resolvedGrantDeletions"]>; before: ReturnType<typeof underPhysicalFacts>; intent: UnderProofIntent;
}
const captures = new WeakMap<UnderObservationCapture, Capture>();
function definitions(ctx: EngineContext, state: VmState): string {
    const ids = new Set(Object.values(state.cards).map(card => card.cardId));
    for (const effect of state.effects) if (effect.copied) ids.add(effect.copied.cardId);
    return canonical([...ids].sort().map(id => ({ id, def: ctx.defs[id], front: ctx.scripts?.[id], back: ctx.scripts?.[`${id}#back`] })));
}
function plan(state: VmState, history: UnderHistory) {
    const output = readUnderStandingPlan(history, history.observation);
    const targets = new Set(output.negate.map(edge => edge.target.card));
    const deleteGrants = state.effects.filter(effect => targets.has(effect.target) && ["keyword", "copiedSkills"].includes(effect.kind)).flatMap(effect => {
        requireResolvedGrantHistory(state, effect.target);
        return resolvedGrantDeleted(state, effect.target, effect.id) ? [] : [{ effect: effect.id, target: effect.target }];
    });
    const sources = history.observation.under.map(candidate => ({ key: underStandingSourceKey(candidate.source),
        source: candidate.source.occurrence.card, host: candidate.relation.host.card, master: candidate.relation.host.holder }));
    return structuredClone({ ...output, deleteGrants, sources });
}
/** Explicit staged proof initialization, before any reviewed source is attached.
 * This is neither a fresh-game factory nor permission to repair a native save. */
export function initializeUnderObservationProof(ctx: EngineContext, game: GameDefinition, state: VmState, reviewed: readonly ReviewedUnderDefinition[]): UnderHistory {
    const observation = observeUnderStandingFacts(ctx, game, state, emptyUnderStandingHistory(), reviewed);
    if (observation.under.length) return fail("initialize the isolated proof before actual under attachment");
    return settleUnderStanding(emptyUnderStandingHistory(), observation);
}
export function assertUnderObservation(ctx: EngineContext, game: GameDefinition, state: VmState, history: UnderHistory, reviewed: readonly ReviewedUnderDefinition[]) {
    const observation = observeUnderStandingFacts(ctx, game, state, history, reviewed);
    readUnderStandingPlan(history, observation);
    return plan(state, history);
}
export function captureUnderStandingObservation(ctx: EngineContext, game: GameDefinition, state: VmState,
    history: UnderHistory, reviewed: readonly ReviewedUnderDefinition[], intent: UnderProofIntent): UnderObservationCapture {
    assertUnderObservation(ctx, game, state, history, reviewed);
    if (!intent || typeof intent !== "object" || !["attach", "detach", "reorder", "effects"].includes(intent.kind)
        || Object.keys(intent).sort().join() !== (intent.kind === "effects" ? "kind" : intent.kind === "reorder" ? "host,kind" : "host,kind,source"))
        return fail("capture an exact isolated under transition intent");
    const before = underPhysicalFacts(state);
    if (intent.kind !== "effects") {
        const host = before.find(card => card.occurrence.card === intent.host);
        if (!host || host.locations.length !== 1 || host.hosts.length || !["battle", "combo"].includes(host.locations[0].area))
            return fail("capture an actual outer host before the isolated transition");
        if (intent.kind !== "reorder") {
            const source = before.find(card => card.occurrence.card === intent.source);
            if (!source || source.pile.length || source.hidden || source.zCard || source.occurrence.side !== "front"
                || !reviewed.some(def => def.cardId === source.occurrence.cardId && def.side === source.occurrence.side))
                return fail("capture a complete plain reviewed under-source occurrence");
            if (intent.kind === "attach" ? source.locations.length !== 1 || source.hosts.length
                : source.locations.length !== 0 || source.hosts.length !== 1 || source.hosts[0].host !== intent.host)
                return fail("capture the exact original physical source membership");
        }
    }
    const token = Object.freeze({}) as UnderObservationCapture;
    captures.set(token, { definitions: definitions(ctx, state), ctx, game, state, history: structuredClone(history), reviewed: structuredClone(reviewed),
        originalGrants: structuredClone(state.effects.filter(effect => ["keyword", "copiedSkills"].includes(effect.kind))),
        originalGrantReceipts: structuredClone(state.resolvedGrantDeletions ?? []), before, intent: structuredClone(intent) });
    return token;
}
/** Validates the actual synchronous delta, not its historical cause. Test callers
 * execute native writers; this standalone helper cannot authenticate a log. */
export function finishUnderStandingObservation(ctx: EngineContext, game: GameDefinition, state: VmState, token: UnderObservationCapture) {
    const captured = token && captures.get(token);
    if (!captured || captured.ctx !== ctx || captured.game !== game || captured.state !== state)
        return fail("finish an isolated under observation on its captured board/context/game");
    if (captured.definitions !== definitions(ctx, state)) return fail("retain complete original definitions during isolated under observation");
    const { intent, before } = captured, after = underPhysicalFacts(state);
    for (const original of captured.originalGrants) {
        const current = state.effects.find(effect => effect.id === original.id);
        if (current && canonical(current) !== canonical(original))
            return fail("retain original live grant identity during the isolated observation transition");
    }
    if (before.length !== after.length) return fail("bound isolated under transitions to original physical cards");
    for (const original of captured.originalGrantReceipts) {
        if (!state.effects.some(effect => effect.id === original.grant)) continue;
        const current = state.resolvedGrantDeletions?.find(receipt => receipt.card === original.card && receipt.grant === original.grant
            && receipt.epoch === original.epoch && receipt.hiddenCount === original.hiddenCount);
        if (!current || original.deleted && !current.deleted
            || canonical({ ...current, deleted: original.deleted }) !== canonical(original))
            return fail("retain original surviving grant receipts without restoration during isolated observation");
    }
    const expected = structuredClone(before);
    if (intent.kind !== "effects") {
        const oldHost = expected.find(card => card.occurrence.card === intent.host)!;
        const actualHost = after.find(card => card.occurrence.card === intent.host);
        if (!actualHost) return fail("retain the captured outer host");
        if (intent.kind === "reorder") {
            if (canonical([...oldHost.pile].sort()) !== canonical([...actualHost.pile].sort()))
                return fail("reorder only the exact captured pile membership");
            oldHost.pile = [...actualHost.pile];
        } else {
            const source = expected.find(card => card.occurrence.card === intent.source)!;
            source.occurrence.epoch++;
            if (intent.kind === "attach") {
                oldHost.pile.push(intent.source); source.locations = [];
            } else {
                oldHost.pile = oldHost.pile.filter(id => id !== intent.source);
                source.locations = [{ holder: source.occurrence.owner, area: "drop" }];
            }
        }
        // Host-array position shifts follow the actual one outer-pile operation.
        for (const card of expected) {
            card.hosts = card.hosts.filter(relation => relation.host !== intent.host);
            const position = oldHost.pile.indexOf(card.occurrence.card);
            if (position >= 0) card.hosts.push({ host: intent.host, position });
        }
    }
    if (canonical(after) !== canonical(expected)) return fail("isolated under transition changed uncaptured occurrence, holder, face or pile facts");
    const observation = observeUnderStandingFacts(ctx, game, state, captured.history, captured.reviewed);
    const changes: UnderRelationChange[] = [];
    for (const candidate of observation.under) {
        const old = captured.history.observation.under.find(value => underStandingSourceKey(value.source) === underStandingSourceKey(candidate.source));
        if (old && canonical(old.relation) !== canonical(candidate.relation)) {
            if (intent.kind !== "reorder" && intent.kind !== "detach")
                return fail("update unchanged under relations only for the exact captured pile transition");
            changes.push({ kind: "reorder", before: old.relation, after: candidate.relation });
        }
    }
    const history = settleUnderStanding(captured.history, observation, changes);
    const result = { history, observation: structuredClone(observation), plan: plan(state, history) };
    captures.delete(token);
    return result;
}
