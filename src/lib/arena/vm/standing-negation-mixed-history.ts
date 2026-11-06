/** R513 mixed-policy contract used by native observation and movement writers.
 * The v1 Battle-only module remains unchanged. Serial priority follows that
 * algorithm; v2 adds explicit area membership and conditional source facts.
 */
import type { PlayerId } from "../types";
import { NotYet } from "./errors";
import { canonicalTaxValue as canonical } from "./tax-receipt";
export type MixedStandingNegationPolicy = "otherBattleWholeV1" | "opponentComboSevenInBattleV1";
export interface MixedStandingNegationCard {
    card: string;
    cardId: string;
    epoch: number;
    hiddenCount: number;
    side: "front" | "back";
    master: PlayerId;
    /** Physical area holder is independent of printed owner and current master. */
    holder: PlayerId;
    owner: PlayerId;
    area: "leader" | "battle" | "unison" | "combo";
}
export interface MixedStandingNegationSource extends MixedStandingNegationCard {
    policy: MixedStandingNegationPolicy;
    skillIndex: number;
    skillIdentity: string;
}
export interface MixedStandingNegationCandidate {
    source: MixedStandingNegationSource;
    /** External validity/negation; threshold and battle membership are derived. */
    externalEnabled: boolean;
    /** Protection-filtered targets, supplied by the native observer. */
    targets: MixedStandingNegationCard[];
}
/** Native participation outlives a vanished opposing combatant until 8-5-13.
 * A departed slot retains its original occurrence and cannot authorize a
 * newly returned occurrence of the same card as a current participant.
 */
export interface MixedBattleParticipant {
    occurrence: MixedStandingNegationCard;
    present: boolean;
}
export interface MixedStandingNegationObservation {
    version: 2;
    policy: "mixedWholeV1";
    cards: MixedStandingNegationCard[];
    battle: {
        attacker: MixedBattleParticipant;
        guard: MixedBattleParticipant;
    } | null;
    candidates: MixedStandingNegationCandidate[];
}
export interface MixedStandingNegationHistory {
    version: 2;
    policy: "mixedWholeV1";
    nextSerial: number;
    observation: string;
    active: {
        source: MixedStandingNegationSource;
        serial: number;
    }[];
    suppressed: {
        source: string;
        serial: number;
        target: MixedStandingNegationCard;
    }[];
}
function targetAllowed(source: MixedStandingNegationSource, target: MixedStandingNegationCard): boolean {
    return source.card !== target.card && (source.policy === "otherBattleWholeV1"
        ? target.area === "battle" : target.area === "combo" && target.holder !== source.master);
}
function enabled(observation: MixedStandingNegationObservation, candidate: MixedStandingNegationCandidate): boolean {
    if (!candidate.externalEnabled)
        return false;
    if (candidate.source.policy === "otherBattleWholeV1")
        return true;
    return observation.cards.filter(card => card.area === "combo" && card.holder === candidate.source.master).length >= 7
        && !!observation.battle && [observation.battle.attacker, observation.battle.guard]
        .some(slot => slot.present && cardKey(slot.occurrence) === cardKey(candidate.source));
}
function validateFacts(observation: MixedStandingNegationObservation): void {
    if (!Array.isArray(observation.cards) || observation.cards.some(card => !cardValid(card))
        || new Set(observation.cards.map(card => card.card)).size !== observation.cards.length)
        rebuild("rebuild mixed-policy area occurrences");
    if (observation.battle !== null) {
        if (!shape(observation.battle, ["attacker", "guard"]))
            rebuild("rebuild mixed-policy battle occurrence binding");
        const { attacker, guard } = observation.battle;
        const valid = (slot: MixedBattleParticipant) => shape(slot, ["occurrence", "present"])
            && typeof slot.present === "boolean" && cardValid(slot.occurrence)
            && ["leader", "battle", "unison"].includes(slot.occurrence.area)
            && slot.present === observation.cards.some(card => cardKey(card) === cardKey(slot.occurrence));
        if (!shape(observation.battle, ["attacker", "guard"]) || !valid(attacker) || !valid(guard)
            || attacker.occurrence.card === guard.occurrence.card
            || attacker.occurrence.holder === guard.occurrence.holder)
            rebuild("rebuild mixed-policy battle occurrence binding");
    }
}
const rebuild = (message: string): never => { throw new NotYet(message, "R513"); };
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const cardFields = ["card", "cardId", "epoch", "hiddenCount", "side", "master", "holder", "owner", "area"];
const sourceFields = [...cardFields, "policy", "skillIndex", "skillIdentity"];
function shape(value: unknown, fields: readonly string[]): boolean {
    return !!value && typeof value === "object" && !Array.isArray(value)
        && Object.keys(value).sort().join(",") === [...fields].sort().join(",");
}
function cardValid(value: MixedStandingNegationCard | undefined): value is MixedStandingNegationCard {
    const fields = value as Partial<MixedStandingNegationSource> | undefined;
    const sourceShape = shape(value, sourceFields) && !!fields
        && ["otherBattleWholeV1", "opponentComboSevenInBattleV1"].includes(fields.policy ?? "")
        && natural(fields.skillIndex) && typeof fields.skillIdentity === "string" && !!fields.skillIdentity.trim();
    return !!value && (shape(value, cardFields) || sourceShape) && typeof value.card === "string" && !!value.card && typeof value.cardId === "string" && !!value.cardId
        && ["leader", "battle", "unison", "combo"].includes(value.area)
        && ["p1", "p2"].includes(value.holder) && ["p1", "p2"].includes(value.owner)
        && natural(value.epoch) && natural(value.hiddenCount) && ["front", "back"].includes(value.side) && ["p1", "p2"].includes(value.master);
}
function sourceValid(value: MixedStandingNegationSource | undefined): value is MixedStandingNegationSource {
    return cardValid(value) && shape(value, sourceFields) && ["otherBattleWholeV1", "opponentComboSevenInBattleV1"].includes(value.policy)
        && (value.policy === "otherBattleWholeV1" ? value.area === "battle" : value.area === "leader")
        && value.master === value.holder && natural(value.skillIndex) && typeof value.skillIdentity === "string" && !!value.skillIdentity;
}
function cardOf(value: MixedStandingNegationCard): MixedStandingNegationCard {
    const { card, cardId, epoch, hiddenCount, side, master, holder, owner, area } = value;
    return { card, cardId, epoch, hiddenCount, side, master, holder, owner, area };
}
const cardKey = (value: MixedStandingNegationCard): string => canonical(cardOf(value));
export const mixedStandingNegationSourceKey = (value: MixedStandingNegationSource): string => canonical(value);
function observationKey(observation: MixedStandingNegationObservation): string {
    if (!observation || !shape(observation, ["version", "policy", "cards", "battle", "candidates"]) || observation.version !== 2 || observation.policy !== "mixedWholeV1" || !Array.isArray(observation.candidates))
        rebuild("rebuild the standing-negation observation");
    validateFacts(observation);
    const sources = new Set<string>(), occurrences = new Map<string, string>();
    const observeCard = (card: MixedStandingNegationCard) => {
        if (!cardValid(card))
            rebuild("rebuild the standing-negation occurrence");
        const key = cardKey(card), prior = occurrences.get(card.card);
        if (!observation.cards.some(item => cardKey(item) === key))
            rebuild("mixed source or target is absent from observed areas");
        if (prior !== undefined && prior !== key)
            rebuild("standing-negation observation mixes occurrences of one card");
        occurrences.set(card.card, key);
    };
    for (const candidate of observation.candidates) {
        if (!candidate || !shape(candidate, ["source", "externalEnabled", "targets"]) || !sourceValid(candidate.source) || typeof candidate.externalEnabled !== "boolean" || !Array.isArray(candidate.targets))
            rebuild("rebuild the standing-negation candidate");
        observeCard(candidate.source);
        const key = mixedStandingNegationSourceKey(candidate.source);
        if (sources.has(key))
            rebuild("duplicate standing-negation source");
        sources.add(key);
        const targets = new Set<string>();
        for (const target of candidate.targets) {
            observeCard(target);
            const targetKey = cardKey(target);
            if (!targetAllowed(candidate.source, target) || targets.has(targetKey))
                rebuild("invalid mixed-policy negation target");
            targets.add(targetKey);
        }
    }
    // Sorting makes equal observations independent of traversal order. Only the
    // mutation owner's explicit enabling order can create priority below.
    return canonical({ cards: observation.cards.map(cardOf).sort((a, b) => cardKey(a).localeCompare(cardKey(b))), battle: observation.battle ? { attacker: { occurrence: cardOf(observation.battle.attacker.occurrence), present: observation.battle.attacker.present }, guard: { occurrence: cardOf(observation.battle.guard.occurrence), present: observation.battle.guard.present } } : null, candidates: observation.candidates.map(candidate => ({ source: candidate.source, externalEnabled: candidate.externalEnabled, enabled: enabled(observation, candidate),
            targets: candidate.targets.map(cardOf).sort((a, b) => cardKey(a).localeCompare(cardKey(b))),
        })).sort((a, b) => mixedStandingNegationSourceKey(a.source).localeCompare(mixedStandingNegationSourceKey(b.source))) });
}
export function validateMixedStandingNegationHistory(history: MixedStandingNegationHistory): void {
    if (!history || !shape(history, ["version", "policy", "nextSerial", "observation", "active", "suppressed"]) || history.version !== 2 || history.policy !== "mixedWholeV1" || !natural(history.nextSerial) || history.nextSerial < 1
        || typeof history.observation !== "string" || !Array.isArray(history.active) || !Array.isArray(history.suppressed))
        rebuild("rebuild standing-negation generation history");
    const sources = new Set<string>(), serials = new Set<number>();
    let previous = 0;
    for (const generation of history.active) {
        if (!generation || !shape(generation, ["source", "serial"]) || !sourceValid(generation.source) || !natural(generation.serial) || generation.serial <= previous || generation.serial >= history.nextSerial)
            rebuild("rebuild standing-negation active generations");
        const key = mixedStandingNegationSourceKey(generation.source);
        if (sources.has(key) || serials.has(generation.serial))
            rebuild("duplicate standing-negation active generation");
        sources.add(key);
        serials.add(generation.serial);
        previous = generation.serial;
    }
    const edges = new Set<string>();
    for (const edge of history.suppressed) {
        if (!edge || !shape(edge, ["source", "serial", "target"]) || !cardValid(edge.target) || !history.active.some(generation => generation.serial === edge.serial && mixedStandingNegationSourceKey(generation.source) === edge.source && targetAllowed(generation.source, edge.target)))
            rebuild("rebuild standing-negation suppression ownership");
        const key = canonical(edge);
        if (edges.has(key))
            rebuild("duplicate standing-negation suppression edge");
        edges.add(key);
    }
}
export function emptyMixedStandingNegationHistory(): MixedStandingNegationHistory {
    return { version: 2, policy: "mixedWholeV1", nextSerial: 1, observation: canonical({ cards: [], battle: null, candidates: [] }), active: [], suppressed: [] };
}
/** Pure transition for a mutation transaction. The caller assigns the result
 * only after its complete native mutation; a projection must never call this
 * to silently repair an affected legacy or stale board. */
export function settleMixedStandingNegation(history: MixedStandingNegationHistory | undefined, observation: MixedStandingNegationObservation, enablingOrder?: readonly string[]): MixedStandingNegationHistory {
    const observed = observationKey(observation);
    if (!history && observation.candidates.length)
        rebuild("rebuild affected standing-negation history before entry");
    const previous = history ?? emptyMixedStandingNegationHistory();
    validateMixedStandingNegationHistory(previous);
    const candidates = new Map(observation.candidates.map(candidate => [mixedStandingNegationSourceKey(candidate.source), candidate]));
    if (enablingOrder !== undefined && (!Array.isArray(enablingOrder) || enablingOrder.some(key => typeof key !== "string" || !candidates.has(key)) || new Set(enablingOrder).size !== enablingOrder.length))
        rebuild("rebuild standing-negation transaction enabling order");
    const result: MixedStandingNegationHistory = { version: 2, policy: "mixedWholeV1", nextSerial: previous.nextSerial, observation: observed, active: [], suppressed: [] };
    const isSuppressed = (source: MixedStandingNegationSource) => result.suppressed.some(edge => cardKey(edge.target) === cardKey(source));
    const activate = (candidate: MixedStandingNegationCandidate, serial: number) => {
        if (result.active.some(generation => candidate.targets.some(target => cardKey(target) === cardKey(generation.source))))
            rebuild("asymmetric standing-negation activation needs a reviewed protection transition");
        const source = structuredClone(candidate.source);
        result.active.push({ source, serial });
        result.suppressed.push(...candidate.targets.map(target => ({ source: mixedStandingNegationSourceKey(source), serial, target: cardOf(target) })));
    };
    // Surviving ACTIVE generations keep priority, independent of source arrival
    // order or the order the current board happened to be enumerated in.
    for (const generation of previous.active) {
        const candidate = candidates.get(mixedStandingNegationSourceKey(generation.source));
        if (candidate && enabled(observation, candidate) && !isSuppressed(candidate.source))
            activate(candidate, generation.serial);
    }
    const survivors = new Set(result.active.map(generation => mixedStandingNegationSourceKey(generation.source)));
    const fresh = observation.candidates.filter(candidate => enabled(observation, candidate) && !survivors.has(mixedStandingNegationSourceKey(candidate.source)) && !isSuppressed(candidate.source));
    if (fresh.length > 1 && (!enablingOrder || fresh.some(candidate => !enablingOrder.includes(mixedStandingNegationSourceKey(candidate.source)))))
        rebuild("simultaneously enabled standing negators need proven mutation ordering");
    const ordered = fresh.length > 1 ? [...fresh].sort((a, b) => enablingOrder!.indexOf(mixedStandingNegationSourceKey(a.source)) - enablingOrder!.indexOf(mixedStandingNegationSourceKey(b.source))) : fresh;
    for (const candidate of ordered) {
        if (isSuppressed(candidate.source))
            continue;
        if (!Number.isSafeInteger(result.nextSerial + 1))
            rebuild("standing-negation generation serial exhausted");
        activate(candidate, result.nextSerial++);
    }
    return result;
}
/** Read only from a history settled against this exact observed board. */
export function mixedStandingNegationAffects(history: MixedStandingNegationHistory | undefined, observation: MixedStandingNegationObservation, target: MixedStandingNegationCard): boolean {
    observationKey(observation);
    if (!history) {
        if (observation.candidates.length)
            rebuild("rebuild affected standing-negation history");
        return false;
    }
    if (!cardValid(target))
        rebuild("rebuild the standing-negation target occurrence");
    validateMixedStandingNegationObservation(history, observation);
    return history.suppressed.some(edge => cardKey(edge.target) === cardKey(target));
}
/** Validate a captured pre-mutation observation, including an empty board. */
export function validateMixedStandingNegationObservation(history: MixedStandingNegationHistory, observation: MixedStandingNegationObservation): void {
    const observed = observationKey(observation);
    validateMixedStandingNegationHistory(history);
    if (history.observation !== observed)
        rebuild("standing-negation mutation has not been settled");
    const expected: MixedStandingNegationHistory["suppressed"] = [];
    for (const generation of history.active) {
        const candidate = observation.candidates.find(item => mixedStandingNegationSourceKey(item.source) === mixedStandingNegationSourceKey(generation.source));
        if (!candidate)
            return rebuild("inconsistent standing-negation active history");
        if (!enabled(observation, candidate) || expected.some(edge => cardKey(edge.target) === cardKey(candidate.source)))
            rebuild("inconsistent standing-negation active history");
        expected.push(...candidate.targets.map(card => ({ source: mixedStandingNegationSourceKey(candidate.source), serial: generation.serial, target: cardOf(card) })));
    }
    if (history.active.some(generation => expected.some(edge => cardKey(edge.target) === cardKey(generation.source))))
        rebuild("inconsistent standing-negation active protection history");
    if (observation.candidates.some(candidate => enabled(observation, candidate)
        && !history.active.some(generation => mixedStandingNegationSourceKey(generation.source) === mixedStandingNegationSourceKey(candidate.source))
        && !expected.some(edge => cardKey(edge.target) === cardKey(candidate.source))))
        rebuild("standing-negation enabled source has no settled generation");
    const edgeKeys = (edges: MixedStandingNegationHistory["suppressed"]) => edges.map(edge => canonical(edge)).sort();
    if (canonical(edgeKeys(expected)) !== canonical(edgeKeys(history.suppressed)))
        rebuild("inconsistent standing-negation suppression history");
}
/** Decode only a validated saved observation. This never retires participants. */
export function mixedStandingObservationFromHistory(history: MixedStandingNegationHistory): MixedStandingNegationObservation {
    validateMixedStandingNegationHistory(history);
    let parsed: {
        cards: MixedStandingNegationCard[];
        battle: MixedStandingNegationObservation["battle"];
        candidates: (MixedStandingNegationCandidate & {
            enabled?: boolean;
        })[];
    };
    try {
        parsed = JSON.parse(history.observation);
    }
    catch {
        return rebuild("rebuild mixed stored observation");
    }
    if (!shape(parsed, ["cards", "battle", "candidates"]) || !Array.isArray(parsed.candidates))
        rebuild("rebuild mixed stored observation fields");
    const candidates = parsed.candidates.map(candidate => {
        if (!candidate || typeof candidate.enabled !== "boolean")
            rebuild("rebuild mixed stored candidate condition");
        const facts = { ...candidate };
        delete facts.enabled;
        return facts;
    });
    const observation: MixedStandingNegationObservation = { version: 2, policy: "mixedWholeV1", cards: parsed.cards, battle: parsed.battle, candidates };
    validateMixedStandingNegationObservation(history, observation);
    return observation;
}
