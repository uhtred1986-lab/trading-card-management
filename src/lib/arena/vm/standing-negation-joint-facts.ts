/** R526 isolated joint facts. No native dispatcher, ledger or grant writer imports this. */
import type { EngineContext } from "../types";
import type { GameDefinition } from "../rulesets";
import type { VmState } from "./state";
import { requireResolvedGrantHistory, resolvedGrantDeleted } from "./resolved-grant-deletion";
import { programsOf } from "./common";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { underRebuild as fail, underStandingSourceKey, type UnderRelationChange } from "./standing-negation-under-relation";
import { validateUnderStandingHistory, emptyUnderStandingHistory, settleUnderStanding, readUnderStandingPlan, type UnderHistory, type UnderObservation } from "./standing-negation-under-history";
import { priorStandingView, standingPriorFacts } from "./standing-negation-prior-view";
import { mixedStandingNegationSourceKey } from "./standing-negation-mixed-history";
import { mixedStandingOccurrences as valueOccurrences, discoverNativeAreaStandingFacts, nativeAreaStandingFacts, discoverNativeStandingProtectors } from "./standing-negation-native-facts";
import { discoverUnderStandingCandidates, discoverUnderStandingProtection, underStandingCandidateFacts, underPhysicalFacts } from "./standing-negation-under-observation";
import type { ReviewedUnderDefinition } from "./standing-negation-under-definition";

declare const brand: unique symbol;
export interface JointStandingDiscovery { readonly [brand]: true }
interface Discovery {
    ctx: EngineContext;
    game: GameDefinition;
    state: VmState;
    snapshot: string;
    history: UnderHistory;
    area: ReturnType<typeof discoverNativeAreaStandingFacts>;
    under: ReturnType<typeof discoverUnderStandingCandidates>;
    arrivals: UnderObservation["area"]["cards"];
}
const discoveries = new WeakMap<JointStandingDiscovery, Discovery>();
/** Relevant original inputs only; does not issue a native read seal. */
function definitionSnapshot(ctx: EngineContext, state: VmState): string {
    const ids = new Set(underPhysicalFacts(state).map(card => card.occurrence.cardId));
    for (const effect of state.effects) if (effect.copied) ids.add(effect.copied.cardId);
    return canonical([...ids].sort().map(id => ({ id, definition: ctx.defs[id], front: ctx.defs[id] && programsOf(ctx, ctx.defs[id], "front"), back: ctx.defs[id]?.back && programsOf(ctx, ctx.defs[id], "back") })));
}
export function jointStandingSnapshot(ctx: EngineContext, state: VmState): string {
    return canonical({ physical: underPhysicalFacts(state), battle: state.battle, effects: state.effects,
        grants: state.resolvedGrantDeletions, definitions: definitionSnapshot(ctx, state) });
}
/** Internal proof adapter supplies captured participants/arrivals. This collector
 * validates facts, not a historical operation; it is not a public native boundary. */
function discoverJointStandingFacts(ctx: EngineContext, game: GameDefinition, state: VmState,
    history: UnderHistory, reviewed: readonly ReviewedUnderDefinition[],
    battle: UnderObservation["area"]["battle"], arrivals: UnderObservation["area"]["cards"]): JointStandingDiscovery {
    validateUnderStandingHistory(history);
    const physical = underPhysicalFacts(state);
    for (const fact of physical) {
        if (fact.locations.length > 1 || fact.hosts.length > 1 || fact.locations.length && fact.hosts.length)
            return fail("discover unique actual memberships for every joint physical card");
        if (!fact.pile.length) continue;
        if (fact.locations.length !== 1 || fact.hosts.length || fact.hidden || fact.zCard
            || ctx.defs[fact.occurrence.cardId]?.type !== "BATTLE" || !["battle", "combo"].includes(fact.locations[0].area)
            || new Set(fact.pile).size !== fact.pile.length)
            return fail("bound unrelated joint piles to complete ordinary flat Battle hosts");
        for (const id of fact.pile) {
            const material = physical.find(card => card.occurrence.card === id);
            if (!material || material.locations.length || material.hosts.length !== 1 || material.pile.length
                || material.hosts[0].host !== fact.occurrence.card)
                return fail("prove every inactive joint material has one actual flat host");
        }
    }
    const under = discoverUnderStandingCandidates(ctx, game, state, reviewed);
    const area = discoverNativeAreaStandingFacts(ctx, game, state, battle, underStandingCandidateFacts(ctx, game, state, under).under.length > 0);
    const facts = nativeAreaStandingFacts(area);
    if (!Array.isArray(arrivals) || new Set(arrivals.map(card => card.card)).size !== arrivals.length
        || arrivals.some(card => !facts.cards.some(current => canonical(current) === canonical(card))))
        return fail("bind joint arrivals to exact actual current occurrences");
    const token = Object.freeze({}) as JointStandingDiscovery;
    discoveries.set(token, { ctx, game, state, snapshot: jointStandingSnapshot(ctx, state),
        history: structuredClone(history), area, under, arrivals: structuredClone(arrivals) });
    return token;
}
function eligible(area: UnderObservation["area"], candidate: UnderObservation["area"]["candidates"][number]): boolean {
    if (!candidate.externalEnabled) return false;
    if (candidate.source.policy === "otherBattleWholeV1") return true;
    return area.cards.filter(card => card.area === "combo" && card.holder === candidate.source.master).length >= 7
        && !!area.battle && [area.battle.attacker, area.battle.guard].some(slot => slot.present
            && slot.occurrence.card === candidate.source.card
            && slot.occurrence.epoch === candidate.source.epoch);
}
export function qualifyJointStandingFacts(ctx: EngineContext, game: GameDefinition, state: VmState, token: JointStandingDiscovery) {
    const value = token && discoveries.get(token);
    if (!value || value.ctx !== ctx || value.game !== game || value.state !== state
        || value.snapshot !== jointStandingSnapshot(ctx, state))
        return fail("qualify the unchanged original joint discovery on its captured board");
    const facts = nativeAreaStandingFacts(value.area);
    const area: UnderObservation["area"] = { version: 2, policy: "mixedWholeV1", ...facts };
    const underFacts = underStandingCandidateFacts(ctx, game, state, value.under);
    const under = underFacts.under;
    // The stricter v3 scan proves inactive piles and broad/unknown protection;
    // legacy native v2 retains its original qualification path untouched.
    const protectors = discoverUnderStandingProtection(ctx, game, state, value.under, value.area);
    const nativeProtectors = discoverNativeStandingProtectors(ctx, game, state, value.area);
    for (const id of nativeProtectors) protectors.add(id);
    const prior = standingPriorFacts(priorStandingView(value.history));
    for (const target of area.cards.filter(card => protectors.has(card.card))) {
        const edges = prior.edges.filter(edge => canonical(edge.target) === canonical(target));
        if (value.arrivals.some(arrival => canonical(arrival) === canonical(target))) {
            if (edges.length) return fail("fresh joint arrival cannot reuse prior suppressed occurrence");
            continue;
        }
        if (!edges.length) continue;
        const stable = edges.some(edge => {
            const original = prior.active.find(active => active.serial === edge.serial
                && ("kind" in active.source ? underStandingSourceKey(active.source) : mixedStandingNegationSourceKey(active.source)) === edge.source);
            if (!original) return false;
            if ("kind" in original.source)
                return under.some(candidate => underStandingSourceKey(candidate.source) === edge.source && candidate.externalEnabled);
            const candidate = area.candidates.find(candidate => mixedStandingNegationSourceKey(candidate.source) === edge.source);
            if (!candidate || !eligible(area, candidate)) return false;
            // A host newly suppressed by an under source cannot provide the old
            // protection handoff without reviewing that feedback transition.
            return !under.some(source => source.externalEnabled && source.negateTargets.some(card => card.card === candidate.source.card));
        });
        if (!stable) return fail("review joint protection reactivation or changed suppressor feedback");
        protectors.delete(target.card);
    }
    for (const candidate of area.candidates) candidate.targets = area.cards.filter(target => target.card !== candidate.source.card
        && !protectors.has(target.card) && (candidate.source.policy === "otherBattleWholeV1"
            ? target.area === "battle" && ["BATTLE", "Z-BATTLE", "TOKEN"].includes(ctx.defs[target.cardId].type)
            : target.area === "combo" && target.holder !== candidate.source.master));
    for (const candidate of under) if (protectors.has(candidate.relation.host.card)) candidate.negateTargets = [];
    const observation: UnderObservation = { version: 3, policy: "underAwareWholeV1", area, piles: underFacts.piles, under };
    const sources = under.map(candidate => ({ sourceKey: underStandingSourceKey(candidate.source),
        master: candidate.relation.host.holder, owner: candidate.source.occurrence.owner }));
    return structuredClone({ observation, sources });
}


declare const proofBrand: unique symbol;
declare const boundaryBrand: unique symbol;
export interface JointStandingProof { readonly [proofBrand]: true }
export interface JointStandingBoundary { readonly [boundaryBrand]: true }
export type JointStandingIntent =
    | { kind: "attach" | "detach"; source: string; host: string }
    | { kind: "reorder"; host: string }
    | { kind: "effects" }
    | { kind: "areaMove"; card: string; to: "battle" | "combo" | "drop" | "hand" | "leader"; retire?: "attacker" | "guard" }
    | { kind: "beginBattle"; attacker: string; guard: string }
    | { kind: "endBattle" };
interface Proof {
    ctx: EngineContext; game: GameDefinition; state: VmState;
    history: UnderHistory; reviewed: readonly ReviewedUnderDefinition[]; snapshot: string;
}
interface Boundary extends Proof {
    proof: JointStandingProof;
    physical: ReturnType<typeof underPhysicalFacts>;
    intent: JointStandingIntent;
    battle: VmState["battle"];
    effects: VmState["effects"];
    grants: VmState["resolvedGrantDeletions"];
    definitions: string;
}
const proofs = new WeakMap<JointStandingProof, Proof>();
const boundaries = new WeakMap<JointStandingBoundary, Boundary>();
function requireProof(ctx: EngineContext, game: GameDefinition, state: VmState, token: JointStandingProof, unchanged: boolean): Proof {
    const proof = token && proofs.get(token);
    if (!proof || proof.ctx !== ctx || proof.game !== game || proof.state !== state
        || unchanged && proof.snapshot !== jointStandingSnapshot(ctx, state))
        return fail("use the original unchanged isolated joint standing proof");
    return proof;
}
function saveProof(ctx: EngineContext, game: GameDefinition, state: VmState, history: UnderHistory,
    reviewed: readonly ReviewedUnderDefinition[]): JointStandingProof {
    const token = Object.freeze({}) as JointStandingProof;
    proofs.set(token, { ctx, game, state, history: structuredClone(history), reviewed: structuredClone(reviewed), snapshot: jointStandingSnapshot(ctx, state) });
    return token;
}
/** Staged empty-policy board only. Never initializes or migrates native saves. */
export function initializeJointStandingProof(ctx: EngineContext, game: GameDefinition, state: VmState,
    reviewed: readonly ReviewedUnderDefinition[]): JointStandingProof {
    if (state.battle) return fail("initialize joint staged proof before a battle assignment");
    const empty = emptyUnderStandingHistory();
    const discovery = discoverJointStandingFacts(ctx, game, state, empty, reviewed, null, []);
    const { observation } = qualifyJointStandingFacts(ctx, game, state, discovery);
    if (observation.area.candidates.length || observation.under.length)
        return fail("initialize joint staged proof before applicable standing sources or attachments");
    return saveProof(ctx, game, state, settleUnderStanding(empty, observation), reviewed);
}
export function assertJointStandingProof(ctx: EngineContext, game: GameDefinition, state: VmState, token: JointStandingProof) {
    const proof = requireProof(ctx, game, state, token, true);
    const discovery = discoverJointStandingFacts(ctx, game, state, proof.history, proof.reviewed, proof.history.observation.area.battle, []);
    const result = qualifyJointStandingFacts(ctx, game, state, discovery);
    readUnderStandingPlan(proof.history, result.observation);
    return structuredClone({ history: proof.history, ...result, plan: readUnderStandingPlan(proof.history, result.observation) });
}
export function captureJointStandingBoundary(ctx: EngineContext, game: GameDefinition, state: VmState,
    token: JointStandingProof, intent: JointStandingIntent): JointStandingBoundary {
    assertJointStandingProof(ctx, game, state, token);
    const proof = requireProof(ctx, game, state, token, true);
    if (!intent || typeof intent !== "object") return fail("capture one explicit joint structural intent");
    const keys = Object.keys(intent).sort().join();
    const expected = intent.kind === "attach" || intent.kind === "detach" ? "host,kind,source"
        : intent.kind === "reorder" ? "host,kind" : intent.kind === "areaMove" ? (intent.retire ? "card,kind,retire,to" : "card,kind,to")
        : intent.kind === "beginBattle" ? "attacker,guard,kind" : "kind";
    if (keys !== expected || !["attach", "detach", "reorder", "effects", "areaMove", "beginBattle", "endBattle"].includes(intent.kind))
        return fail("capture only one complete reviewed joint structural intent");
    const physical = underPhysicalFacts(state);
    if (intent.kind === "attach" || intent.kind === "detach" || intent.kind === "reorder") {
        const host = physical.find(card => card.occurrence.card === intent.host);
        if (!host || host.locations.length !== 1 || host.hosts.length || !["battle", "combo"].includes(host.locations[0].area))
            return fail("capture an actual plain outer host for the joint boundary");
        if (intent.kind !== "reorder") {
            const source = physical.find(card => card.occurrence.card === intent.source);
            if (!source || source.pile.length || source.hidden || source.zCard || source.occurrence.side !== "front"
                || !proof.reviewed.some(def => def.cardId === source.occurrence.cardId && def.side === source.occurrence.side)
                || (intent.kind === "attach" ? source.locations.length !== 1 || source.hosts.length
                    : source.locations.length !== 0 || source.hosts.length !== 1 || source.hosts[0].host !== intent.host))
                return fail("capture original ordinary joint under-source membership");
        }
    }
    if (intent.kind === "areaMove") {
        const card = physical.find(card => card.occurrence.card === intent.card);
        if (!card || card.locations.length !== 1 || card.hosts.length || card.pile.length || card.hidden || card.zCard
            || card.occurrence.side !== "front" || !["battle", "combo", "drop", "hand", "leader"].includes(intent.to)
            || card.locations[0].area === intent.to || card.locations[0].holder !== card.occurrence.owner)
            return fail("capture one plain same-holder area movement without piles or control");
        if (intent.retire && (!["attacker", "guard"].includes(intent.retire)
            || proof.history.observation.area.battle?.[intent.retire].occurrence.card !== intent.card))
            return fail("retire only the captured original participant on its own movement");
    }
    if (intent.kind === "beginBattle" && (state.battle || intent.attacker === intent.guard
        || !physical.some(card => card.occurrence.card === intent.attacker)
        || !physical.some(card => card.occurrence.card === intent.guard)))
        return fail("capture a distinct original battle assignment before it begins");
    if (intent.kind === "endBattle" && !state.battle) return fail("end only a captured existing battle assignment");
    const boundary = Object.freeze({}) as JointStandingBoundary;
    boundaries.set(boundary, { ...proof, proof: token, physical, intent: structuredClone(intent),
        battle: structuredClone(state.battle), effects: structuredClone(state.effects), grants: structuredClone(state.resolvedGrantDeletions), definitions: definitionSnapshot(ctx, state) });
    return boundary;
}
/** Structural before/after evidence, not authentication of a historical native
 * operation. A refused result never advances the old proof or publishes a plan. */
export function finishJointStandingBoundary(ctx: EngineContext, game: GameDefinition, state: VmState, token: JointStandingBoundary,
    enablingOrder?: readonly string[]) {
    const boundary = token && boundaries.get(token);
    if (!boundary || boundary.ctx !== ctx || boundary.game !== game || boundary.state !== state
        || proofs.get(boundary.proof)?.snapshot !== boundary.snapshot)
        return fail("finish the original live joint boundary once on its captured board");
    if (boundary.definitions !== definitionSnapshot(ctx, state)) return fail("retain complete original joint definitions through a boundary");
    for (const original of boundary.effects.filter(effect => ["keyword", "copiedSkills"].includes(effect.kind))) {
        const current = state.effects.find(effect => effect.id === original.id);
        if (current && canonical(current) !== canonical(original)) return fail("retain original surviving joint grant identity");
    }
    for (const original of boundary.grants ?? []) {
        if (!state.effects.some(effect => effect.id === original.grant)) continue;
        const current = state.resolvedGrantDeletions?.find(receipt => receipt.card === original.card && receipt.grant === original.grant
            && receipt.epoch === original.epoch && receipt.hiddenCount === original.hiddenCount);
        if (!current || original.deleted && !current.deleted || canonical({ ...current, deleted: original.deleted }) !== canonical(original))
            return fail("retain original joint grant deletion history without restoration");
    }
    const { intent } = boundary, after = underPhysicalFacts(state), expected = structuredClone(boundary.physical);
    let battle = structuredClone(boundary.history.observation.area.battle);
    if (intent.kind === "attach" || intent.kind === "detach" || intent.kind === "reorder") {
        const host = expected.find(card => card.occurrence.card === intent.host)!;
        const current = after.find(card => card.occurrence.card === intent.host);
        if (!current) return fail("retain the joint boundary's original host");
        if (intent.kind === "reorder") {
            if (canonical([...host.pile].sort()) !== canonical([...current.pile].sort())) return fail("reorder only original joint pile members");
            host.pile = [...current.pile];
        } else {
            const source = expected.find(card => card.occurrence.card === intent.source)!;
            source.occurrence.epoch++;
            if (intent.kind === "attach") { host.pile.push(intent.source); source.locations = []; }
            else { host.pile = host.pile.filter(card => card !== intent.source); source.locations = [{ holder: source.occurrence.owner, area: "drop" }]; }
        }
        for (const card of expected) {
            card.hosts = card.hosts.filter(relation => relation.host !== intent.host);
            const position = host.pile.indexOf(card.occurrence.card);
            if (position >= 0) card.hosts.push({ host: intent.host, position });
        }
    } else if (intent.kind === "areaMove") {
        const card = expected.find(card => card.occurrence.card === intent.card)!;
        card.occurrence.epoch++;
        card.locations = [{ holder: card.occurrence.owner, area: intent.to }];
        if (intent.retire && battle) battle[intent.retire].present = false;
    }
    if (canonical(after) !== canonical(expected)) return fail("joint boundary changed uncaptured physical occurrence, holder, face or membership");
    if (intent.kind === "beginBattle") {
        if (!state.battle || state.battle.attacker !== intent.attacker || state.battle.guard !== intent.guard)
            return fail("bind the captured assignment to actual battle roles");
        const actual = valueOccurrences(ctx, game, state);
        const attacker = actual.find(card => card.card === intent.attacker), guard = actual.find(card => card.card === intent.guard);
        if (!attacker || !guard) return fail("assign current actual participant occurrences");
        battle = { attacker: { occurrence: attacker, present: true }, guard: { occurrence: guard, present: true } };
    } else if (intent.kind === "endBattle") {
        if (state.battle) return fail("finish the captured battle only after its actual record ends");
        battle = null;
    } else if (canonical(state.battle) !== canonical(boundary.battle)) return fail("joint boundary changed uncaptured battle facts");
    const arrivals = intent.kind === "areaMove" ? valueOccurrences(ctx, game, state).filter(card => card.card === intent.card) : [];
    const discovery = discoverJointStandingFacts(ctx, game, state, boundary.history, boundary.reviewed, battle, arrivals);
    const result = qualifyJointStandingFacts(ctx, game, state, discovery);
    const changes: UnderRelationChange[] = [];
    for (const candidate of result.observation.under) {
        const old = boundary.history.observation.under.find(previous => underStandingSourceKey(previous.source) === underStandingSourceKey(candidate.source));
        if (old && canonical(old.relation) !== canonical(candidate.relation)) {
            if (intent.kind !== "reorder" && intent.kind !== "detach") return fail("change joint under relation only through its exact captured reorder");
            changes.push({ kind: "reorder", before: old.relation, after: candidate.relation });
        }
    }
    // Explicit supplied ordering is validated against exact discovered source keys
    // by the pure reducer; it is not authentication of a native player action.
    const history = settleUnderStanding(boundary.history, result.observation, changes, enablingOrder);
    const plan = readUnderStandingPlan(history, result.observation);
    const targets = new Set(plan.negate.map(edge => edge.target.card));
    const deleteGrants = state.effects.filter(effect => targets.has(effect.target) && ["keyword", "copiedSkills"].includes(effect.kind)).flatMap(effect => {
        requireResolvedGrantHistory(state, effect.target);
        return resolvedGrantDeleted(state, effect.target, effect.id) ? [] : [{ effect: effect.id, target: effect.target }];
    });
    const proof = saveProof(ctx, game, state, history, boundary.reviewed);
    boundaries.delete(token); proofs.delete(boundary.proof);
    return { proof, ...structuredClone({ history, ...result, plan: { ...plan, deleteGrants } }) };
}
