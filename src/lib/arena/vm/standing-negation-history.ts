/** R477 prototype: history for the all-other-Battle whole-skill negator.
 * Observations and protection edges are supplied by a future mutation owner.
 * This module does not discover card skills or admit a gameplay procedure.
 */
import type { PlayerId } from "../types";
import { NotYet } from "./errors";
import { canonicalTaxValue as canonical } from "./tax-receipt";

export interface StandingNegationCard {
  card: string;
  cardId: string;
  epoch: number;
  hiddenCount: number;
  side: "front" | "back";
  master: PlayerId;
}
export interface StandingNegationSource extends StandingNegationCard {
  skillIndex: number;
  /** Exact already-compiled skill record, never card text to compile. */
  skillIdentity: string;
}
export interface StandingNegationCandidate {
  source: StandingNegationSource;
  /** External validity/negation only; excludes suppression derived here. */
  enabled: boolean;
  /** Observed Battle occurrences affected after source-specific protections.
   * Barrier is not a protection from this non-choosing continuous effect. */
  targets: StandingNegationCard[];
}
export interface StandingNegationObservation {
  version: 1;
  policy: "otherBattleWholeV1";
  candidates: StandingNegationCandidate[];
}
export interface StandingNegationGeneration {
  source: StandingNegationSource;
  serial: number;
}
export interface StandingNegationHistory {
  version: 1;
  policy: "otherBattleWholeV1";
  nextSerial: number;
  /** Canonical observation identity detects a stale read; it is NOT priority. */
  observation: string;
  active: StandingNegationGeneration[];
  suppressed: { source: string; serial: number; target: StandingNegationCard }[];
}

const rebuild = (message: string): never => { throw new NotYet(message, "R477"); };
const natural = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function cardValid(value: StandingNegationCard | undefined): value is StandingNegationCard {
  return !!value && typeof value.card === "string" && !!value.card && typeof value.cardId === "string" && !!value.cardId
    && natural(value.epoch) && natural(value.hiddenCount) && ["front", "back"].includes(value.side) && ["p1", "p2"].includes(value.master);
}
function sourceValid(value: StandingNegationSource | undefined): value is StandingNegationSource {
  return cardValid(value) && natural(value.skillIndex) && typeof value.skillIdentity === "string" && !!value.skillIdentity;
}
function cardOf(value: StandingNegationCard): StandingNegationCard {
  const { card, cardId, epoch, hiddenCount, side, master } = value;
  return { card, cardId, epoch, hiddenCount, side, master };
}
const cardKey = (value: StandingNegationCard): string => canonical(cardOf(value));
export const standingNegationSourceKey = (value: StandingNegationSource): string => canonical(value);

function observationKey(observation: StandingNegationObservation): string {
  if (!observation || observation.version !== 1 || observation.policy !== "otherBattleWholeV1" || !Array.isArray(observation.candidates)) rebuild("rebuild the standing-negation observation");
  const sources = new Set<string>(), occurrences = new Map<string, string>();
  const observeCard = (card: StandingNegationCard) => {
    if (!cardValid(card)) rebuild("rebuild the standing-negation occurrence");
    const key = cardKey(card), prior = occurrences.get(card.card);
    if (prior !== undefined && prior !== key) rebuild("standing-negation observation mixes occurrences of one card");
    occurrences.set(card.card, key);
  };
  for (const candidate of observation.candidates) {
    if (!candidate || !sourceValid(candidate.source) || typeof candidate.enabled !== "boolean" || !Array.isArray(candidate.targets)) rebuild("rebuild the standing-negation candidate");
    observeCard(candidate.source);
    const key = standingNegationSourceKey(candidate.source);
    if (sources.has(key)) rebuild("duplicate standing-negation source");
    sources.add(key);
    const targets = new Set<string>();
    for (const target of candidate.targets) {
      observeCard(target);
      const targetKey = cardKey(target);
      if (target.card === candidate.source.card || targets.has(targetKey)) rebuild("invalid all-other-Battle negation target");
      targets.add(targetKey);
    }
  }
  // Sorting makes equal observations independent of traversal order. Only the
  // mutation owner's explicit enabling order can create priority below.
  return canonical(observation.candidates.map(candidate => ({ source: candidate.source, enabled: candidate.enabled,
    targets: candidate.targets.map(cardOf).sort((a, b) => cardKey(a).localeCompare(cardKey(b))),
  })).sort((a, b) => standingNegationSourceKey(a.source).localeCompare(standingNegationSourceKey(b.source))));
}

function validateHistory(history: StandingNegationHistory): void {
  if (!history || history.version !== 1 || history.policy !== "otherBattleWholeV1" || !natural(history.nextSerial) || history.nextSerial < 1
    || typeof history.observation !== "string" || !Array.isArray(history.active) || !Array.isArray(history.suppressed)) rebuild("rebuild standing-negation generation history");
  const sources = new Set<string>(), serials = new Set<number>();
  let previous = 0;
  for (const generation of history.active) {
    if (!generation || !sourceValid(generation.source) || !natural(generation.serial) || generation.serial <= previous || generation.serial >= history.nextSerial) rebuild("rebuild standing-negation active generations");
    const key = standingNegationSourceKey(generation.source);
    if (sources.has(key) || serials.has(generation.serial)) rebuild("duplicate standing-negation active generation");
    sources.add(key); serials.add(generation.serial); previous = generation.serial;
  }
  const edges = new Set<string>();
  for (const edge of history.suppressed) {
    if (!edge || !cardValid(edge.target) || !history.active.some(generation => generation.serial === edge.serial && standingNegationSourceKey(generation.source) === edge.source)) rebuild("rebuild standing-negation suppression ownership");
    const key = canonical(edge);
    if (edges.has(key)) rebuild("duplicate standing-negation suppression edge");
    edges.add(key);
  }
}

export function emptyStandingNegationHistory(): StandingNegationHistory {
  return { version: 1, policy: "otherBattleWholeV1", nextSerial: 1, observation: "[]", active: [], suppressed: [] };
}

/** Pure transition for a mutation transaction. The caller assigns the result
 * only after its complete native mutation; a projection must never call this
 * to silently repair an affected legacy or stale board. */
export function settleStandingNegation(history: StandingNegationHistory | undefined, observation: StandingNegationObservation, enablingOrder?: readonly string[]): StandingNegationHistory {
  const observed = observationKey(observation);
  if (!history && observation.candidates.length) rebuild("rebuild affected standing-negation history before entry");
  const previous = history ?? emptyStandingNegationHistory();
  validateHistory(previous);
  const candidates = new Map(observation.candidates.map(candidate => [standingNegationSourceKey(candidate.source), candidate]));
  if (enablingOrder !== undefined && (!Array.isArray(enablingOrder) || enablingOrder.some(key => typeof key !== "string" || !candidates.has(key)) || new Set(enablingOrder).size !== enablingOrder.length)) rebuild("rebuild standing-negation transaction enabling order");
  const result: StandingNegationHistory = { version: 1, policy: "otherBattleWholeV1", nextSerial: previous.nextSerial, observation: observed, active: [], suppressed: [] };
  const isSuppressed = (source: StandingNegationSource) => result.suppressed.some(edge => cardKey(edge.target) === cardKey(source));
  const activate = (candidate: StandingNegationCandidate, serial: number) => {
    if (result.active.some(generation => candidate.targets.some(target => cardKey(target) === cardKey(generation.source)))) rebuild("asymmetric standing-negation activation needs a reviewed protection transition");
    const source = structuredClone(candidate.source);
    result.active.push({ source, serial });
    result.suppressed.push(...candidate.targets.map(target => ({ source: standingNegationSourceKey(source), serial, target: cardOf(target) })));
  };
  // Surviving ACTIVE generations keep priority, independent of source arrival
  // order or the order the current board happened to be enumerated in.
  for (const generation of previous.active) {
    const candidate = candidates.get(standingNegationSourceKey(generation.source));
    if (candidate?.enabled && !isSuppressed(candidate.source)) activate(candidate, generation.serial);
  }
  const survivors = new Set(result.active.map(generation => standingNegationSourceKey(generation.source)));
  const fresh = observation.candidates.filter(candidate => candidate.enabled && !survivors.has(standingNegationSourceKey(candidate.source)) && !isSuppressed(candidate.source));
  if (fresh.length > 1 && (!enablingOrder || fresh.some(candidate => !enablingOrder.includes(standingNegationSourceKey(candidate.source))))) rebuild("simultaneously enabled standing negators need proven mutation ordering");
  const ordered = fresh.length > 1 ? [...fresh].sort((a, b) => enablingOrder!.indexOf(standingNegationSourceKey(a.source)) - enablingOrder!.indexOf(standingNegationSourceKey(b.source))) : fresh;
  for (const candidate of ordered) {
    if (isSuppressed(candidate.source)) continue;
    if (!Number.isSafeInteger(result.nextSerial + 1)) rebuild("standing-negation generation serial exhausted");
    activate(candidate, result.nextSerial++);
  }
  return result;
}

/** Read only from a history settled against this exact observed board. */
export function standingNegationAffects(history: StandingNegationHistory | undefined, observation: StandingNegationObservation, target: StandingNegationCard): boolean {
  const observed = observationKey(observation);
  if (!history) {
    if (observation.candidates.length) rebuild("rebuild affected standing-negation history");
    return false;
  }
  validateHistory(history);
  if (!cardValid(target) || history.observation !== observed) rebuild("standing-negation mutation has not been settled");
  const expected: StandingNegationHistory["suppressed"] = [];
  for (const generation of history.active) {
    const candidate = observation.candidates.find(item => standingNegationSourceKey(item.source) === standingNegationSourceKey(generation.source));
    if (!candidate) return rebuild("inconsistent standing-negation active history");
    if (!candidate.enabled || expected.some(edge => cardKey(edge.target) === cardKey(candidate.source))) rebuild("inconsistent standing-negation active history");
    expected.push(...candidate.targets.map(card => ({ source: standingNegationSourceKey(candidate.source), serial: generation.serial, target: cardOf(card) })));
  }
  if (history.active.some(generation => expected.some(edge => cardKey(edge.target) === cardKey(generation.source)))) rebuild("inconsistent standing-negation active protection history");
  if (observation.candidates.some(candidate => candidate.enabled
    && !history.active.some(generation => standingNegationSourceKey(generation.source) === standingNegationSourceKey(candidate.source))
    && !expected.some(edge => cardKey(edge.target) === cardKey(candidate.source)))) rebuild("standing-negation enabled source has no settled generation");
  const edgeKeys = (edges: StandingNegationHistory["suppressed"]) => edges.map(edge => canonical(edge)).sort();
  if (canonical(edgeKeys(expected)) !== canonical(edgeKeys(history.suppressed))) rebuild("inconsistent standing-negation suppression history");
  return history.suppressed.some(edge => cardKey(edge.target) === cardKey(target));
}
