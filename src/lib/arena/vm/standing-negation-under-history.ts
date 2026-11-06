/** Shared v3 reducer. Native writers authenticate operations separately from isolated supplied-fact proofs. */
import type { MixedStandingNegationCard as Card, MixedStandingNegationSource as AreaSource,
    MixedStandingNegationObservation as AreaObservation } from "./standing-negation-mixed-history";
import { emptyMixedStandingNegationHistory, settleMixedStandingNegation,
    mixedStandingNegationSourceKey as areaKey } from "./standing-negation-mixed-history";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { requireUnderRelations, requireUnderSource, requireUnderOccurrence, requireUnderRelationChange,
    underStandingSourceKey, underRebuild as fail, underShape as shape } from "./standing-negation-under-relation";
import type { UnderStandingSource, UnderRelation, UnderPile, UnderRelationChange, UnderOccurrence } from "./standing-negation-under-relation";

export interface UnderCandidate {
    source: UnderStandingSource;
    relation: UnderRelation;
    externalEnabled: boolean;
    negateTargets: Card[];
    attackBanTargets: Card[];
}
export interface UnderObservation {
    version: 3;
    policy: "underAwareWholeV1";
    area: AreaObservation;
    piles: UnderPile[];
    under: UnderCandidate[];
}
type Source = AreaSource | UnderStandingSource;
type Edge = { source: string; serial: number; target: Card };
export interface UnderHistory {
    version: 3;
    policy: "underAwareWholeV1";
    nextSerial: number;
    observation: UnderObservation;
    active: { source: Source; serial: number }[];
    negated: Edge[];
    attackBans: Edge[];
    /** Prevents a detached occurrence being resurrected by a later supplied observation. */
    seen: UnderOccurrence[];
}
const natural = (x: unknown): x is number => Number.isSafeInteger(x) && Number(x) >= 0;
const isUnder = (s: Source): s is UnderStandingSource => !!s && typeof s === "object" && "kind" in s;
const key = (s: Source): string => isUnder(s) ? underStandingSourceKey(s) : areaKey(s);
const cardOf = (s: Card): Card => {
    const { card, cardId, epoch, hiddenCount, side, master, holder, owner, area } = s;
    return { card, cardId, epoch, hiddenCount, side, master, holder, owner, area };
};
const cardKey = (s: Card): string => canonical(cardOf(s));
interface Candidate { source: Source; enabled: boolean; targets: Card[]; bans: Card[] }
function candidates(observation: UnderObservation): Candidate[] {
    if (!shape(observation, ["version", "policy", "area", "piles", "under"]) || observation.version !== 3
        || observation.policy !== "underAwareWholeV1" || !Array.isArray(observation.under))
        fail("rebuild explicit v3 under-standing observation");
    const area = observation.area;
    // The old contract remains the authoritative validator of its exact sub-schema.
    settleMixedStandingNegation(emptyMixedStandingNegationHistory(), area, area?.candidates?.map(c => areaKey(c.source)));
    requireUnderRelations(area.cards, observation.piles, observation.under.map(c => c?.relation));
    const result: Candidate[] = area.candidates.map(c => ({ source: c.source, targets: c.targets, bans: [],
        enabled: c.externalEnabled && (c.source.policy === "otherBattleWholeV1"
            || area.cards.filter(card => card.area === "combo" && card.holder === c.source.master).length >= 7
            && !!area.battle && [area.battle.attacker, area.battle.guard].some(slot => slot.present && cardKey(slot.occurrence) === cardKey(c.source))) }));
    const ids = new Set<string>();
    for (const c of observation.under) {
        if (!shape(c, ["source", "relation", "externalEnabled", "negateTargets", "attackBanTargets"])
            || typeof c.externalEnabled !== "boolean" || !Array.isArray(c.negateTargets) || !Array.isArray(c.attackBanTargets))
            fail("rebuild complete under-standing candidate");
        requireUnderSource(c.source);
        if (canonical(c.source.occurrence) !== canonical(c.relation.source) || ids.has(c.source.occurrence.card))
            fail("bind each under policy to its one physical source");
        ids.add(c.source.occurrence.card);
        for (const targets of [c.negateTargets, c.attackBanTargets]) {
            if (targets.length > 1 || targets.some(t => canonical(t) !== canonical(c.relation.host)))
                fail("under-standing outputs can target only the actual outer top");
        }
        result.push({ source: c.source, enabled: c.externalEnabled, targets: c.negateTargets, bans: c.attackBanTargets });
    }
    return result;
}
export function emptyUnderStandingHistory(): UnderHistory {
    return { version: 3, policy: "underAwareWholeV1", nextSerial: 1,
        observation: { version: 3, policy: "underAwareWholeV1", area: { version: 2, policy: "mixedWholeV1", cards: [], battle: null, candidates: [] }, piles: [], under: [] },
        active: [], negated: [], attackBans: [], seen: [] };
}
export function validateUnderStandingHistory(history: UnderHistory): void {
    if (!shape(history, ["version", "policy", "nextSerial", "observation", "active", "negated", "attackBans", "seen"])
        || history.version !== 3 || history.policy !== "underAwareWholeV1" || !natural(history.nextSerial) || history.nextSerial < 1
        || !Array.isArray(history.active) || !Array.isArray(history.negated) || !Array.isArray(history.attackBans) || !Array.isArray(history.seen))
        fail("rebuild v3 under-standing generation history");
    const current = candidates(history.observation), negated: Edge[] = [], bans: Edge[] = [];
    // Every admitted under policy is independent of area suppression: none of
    // these policies targets a buried source. Dependency visibility therefore
    // precedes serial traversal, while generation chronology stays unchanged.
    const underTargets = current.filter(candidate => isUnder(candidate.source) && candidate.enabled)
        .flatMap(candidate => candidate.targets);
    const activeKeys = new Set<string>(), seenIds = new Set<string>();
    let previous = 0;
    for (const occurrence of history.seen) {
        requireUnderOccurrence(occurrence);
        if (seenIds.has(occurrence.card)) fail("duplicate under-standing historical occurrence");
        seenIds.add(occurrence.card);
    }
    for (const c of history.observation.under)
        if (!history.seen.some(s => canonical(s) === canonical(c.source.occurrence))) fail("missing live under-source occurrence history");
    for (const generation of history.active) {
        if (!shape(generation, ["source", "serial"]) || !generation.source || !natural(generation.serial)
            || generation.serial <= previous || generation.serial >= history.nextSerial)
            fail("invalid under-standing source generation");
        const k = key(generation.source), c = current.find(c => key(c.source) === k);
        if (!c) return fail("missing under-standing active source");
        if (!c.enabled || activeKeys.has(k) || !isUnder(c.source)
            && (underTargets.some(target => cardKey(target) === cardKey(c.source as AreaSource))
                || negated.some(e => cardKey(e.target) === cardKey(c.source as AreaSource))))
            fail("inconsistent under-standing active source");
        if (!isUnder(c.source) && history.active.filter(g => g.serial < generation.serial).some(g => !isUnder(g.source)
            && c.targets.some(target => cardKey(target) === cardKey(g.source as AreaSource))))
            fail("asymmetric saved under-standing generations");
        activeKeys.add(k); previous = generation.serial;
        negated.push(...c.targets.map(target => ({ source: k, serial: generation.serial, target: cardOf(target) })));
        bans.push(...c.bans.map(target => ({ source: k, serial: generation.serial, target: cardOf(target) })));
    }
    if (canonical(negated) !== canonical(history.negated) || canonical(bans) !== canonical(history.attackBans))
        fail("inconsistent independent under-standing output edges");
    for (const c of current)
        if (c.enabled && !activeKeys.has(key(c.source)) && (isUnder(c.source) || !negated.some(e => cardKey(e.target) === cardKey(c.source as AreaSource))))
            fail("missing enabled under-standing generation");
}
/** Caller supplies operation-authenticated relation receipts; this pure API does not authenticate a board. */
export function settleUnderStanding(history: UnderHistory, observation: UnderObservation,
    changes: readonly UnderRelationChange[] = [], enablingOrder?: readonly string[]): UnderHistory {
    validateUnderStandingHistory(history);
    const all = candidates(observation);
    if (!Array.isArray(changes)) fail("rebuild explicit under-standing relation receipts");
    changes.forEach(requireUnderRelationChange);
    const consumed = new Set<number>(), seen = new Map(history.seen.map(s => [s.card, s]));
    for (const c of observation.under) {
        const old = history.observation.under.find(o => key(o.source) === key(c.source));
        const latest = seen.get(c.source.occurrence.card);
        if (old && canonical(old.relation) !== canonical(c.relation)) {
            const matches = changes.map((change, i) => canonical(change.before) === canonical(old.relation)
                && canonical(change.after) === canonical(c.relation) ? i : -1).filter(i => i >= 0);
            if (matches.length !== 1) fail("changed under relation needs one exact native operation receipt");
            consumed.add(matches[0]);
        } else if (!old && latest && (c.source.occurrence.cardId !== latest.cardId || c.source.occurrence.owner !== latest.owner
            || c.source.occurrence.epoch <= latest.epoch)) fail("a detached under source cannot reappear as its old occurrence");
        seen.set(c.source.occurrence.card, structuredClone(c.source.occurrence));
    }
    if (consumed.size !== changes.length) fail("unused or duplicate under-standing transition receipt");
    const out: UnderHistory = { version: 3, policy: "underAwareWholeV1", nextSerial: history.nextSerial,
        observation: structuredClone(observation), active: [], negated: [], attackBans: [], seen: [...seen.values()] };
    // Compute under dependency visibility before considering retained area
    // generations. A newly attached source can suppress an older host without
    // rewriting either source's historical serial or choosing a new order.
    const underTargets = all.filter(candidate => isUnder(candidate.source) && candidate.enabled)
        .flatMap(candidate => candidate.targets);
    const suppressed = (s: Source) => !isUnder(s) && (underTargets.some(target => cardKey(target) === cardKey(s))
        || out.negated.some(e => cardKey(e.target) === cardKey(s)));
    const activate = (c: Candidate, serial: number) => {
        if (out.active.some(g => !isUnder(g.source) && c.targets.some(t => cardKey(t) === cardKey(g.source as AreaSource))))
            fail("asymmetric under-standing transition needs reviewed ordering");
        const k = key(c.source);
        out.active.push({ source: structuredClone(c.source), serial });
        out.negated.push(...c.targets.map(target => ({ source: k, serial, target: cardOf(target) })));
        out.attackBans.push(...c.bans.map(target => ({ source: k, serial, target: cardOf(target) })));
    };
    for (const generation of history.active) {
        const c = all.find(c => key(c.source) === key(generation.source));
        if (c && c.enabled && !suppressed(c.source)) activate(c, generation.serial);
    }
    const fresh = all.filter(c => c.enabled && !out.active.some(g => key(g.source) === key(c.source)) && !suppressed(c.source));
    if (enablingOrder !== undefined && (!Array.isArray(enablingOrder) || new Set(enablingOrder).size !== enablingOrder.length
        || enablingOrder.some(k => !all.some(c => key(c.source) === k)))) fail("invalid under-standing enabling order");
    if (fresh.length > 1 && (!enablingOrder || fresh.some(c => !enablingOrder.includes(key(c.source)))))
        fail("simultaneous under-standing sources need explicit ordering");
    if (fresh.length > 1) fresh.sort((a, b) => enablingOrder!.indexOf(key(a.source)) - enablingOrder!.indexOf(key(b.source)));
    for (const c of fresh) {
        if (suppressed(c.source)) continue;
        if (!Number.isSafeInteger(out.nextSerial + 1)) fail("under-standing generation serial exhausted");
        activate(c, out.nextSerial++);
    }
    // Retained and newly activated rows can be evaluated by dependency before
    // chronology. Saved rows and both independent edge lists remain canonical.
    out.active.sort((a, b) => a.serial - b.serial);
    out.negated.sort((a, b) => a.serial - b.serial);
    out.attackBans.sort((a, b) => a.serial - b.serial);
    validateUnderStandingHistory(out);
    return out;
}
/** Output plan only: future native adapter owns grant deletion and attack gating. */
export function readUnderStandingPlan(history: UnderHistory, observation: UnderObservation) {
    validateUnderStandingHistory(history);
    candidates(observation);
    if (canonical(history.observation) !== canonical(observation)) fail("unsettled under-standing observation");
    return structuredClone({ negate: history.negated, forbidAttack: history.attackBans });
}
