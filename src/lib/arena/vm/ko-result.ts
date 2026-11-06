/** R506 standalone contract; gameplay writers/readers are not wired yet.
 * Original KO completion is distinct from a requested Drop movement and KO Autos.
 */
import type { Area, PlayerId } from "../types";
import { NotYet } from "./errors";

export interface KoBinding {
  card: string;
  /** Captured skill lifecycle epoch, never re-read from a departed source. */
  sourceEpoch: number;
  skillIndex: number;
  master: PlayerId;
  name: string;
}
export interface KoSelected { card: string; epoch: number; owner: PlayerId }
/** Independent facts: a later native rule never erases an earlier skill substitution. */
export interface KoRoute {
  skillReplacementApplied: boolean;
  nativeHook: "none" | "ultimate";
  primitiveRemoval: "none" | "zBattle" | "token";
}
export interface KoOutcome {
  card: string;
  fromEpoch: number;
  toEpoch: number;
  to: Area | null;
  owner: PlayerId;
  /** This attempted departure only. Substitutes report before their child runs. */
  moved: boolean;
  route: KoRoute;
  /** Final effective cost only for original completion; null means no cost, never zero. */
  cost: number | null;
}
export interface KoResult {
  version: 1;
  binding: KoBinding;
  selected: KoSelected[];
  outcomes: KoOutcome[];
}
const KO_DESTINATIONS: Record<Area, true> = { deck:true, hand:true, drop:true, leader:true, battle:true, combo:true, energy:true, life:true, warp:true, unison:true, zDeck:true, zEnergy:true, removed:true };
const area = (x: unknown): x is Area => typeof x === "string" && Object.hasOwn(KO_DESTINATIONS, x);
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const epoch = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const player = (x: unknown): x is PlayerId => x === "p1" || x === "p2";
export function koResultRebuild(detail: string): never { throw new NotYet(`rebuild this saved original KO result: ${detail}`, "R506"); }
function binding(x: unknown): x is KoBinding {
  return object(x) && text(x.card) && epoch(x.sourceEpoch) && epoch(x.skillIndex) && player(x.master) && text(x.name);
}
function sameBinding(a: KoBinding, b: KoBinding): boolean {
  return a.card === b.card && a.sourceEpoch === b.sourceEpoch && a.skillIndex === b.skillIndex && a.master === b.master && a.name === b.name;
}
export function requireKoRoute(value: unknown): asserts value is KoRoute {
  if (!object(value) || typeof value.skillReplacementApplied !== "boolean"
      || !["none", "ultimate"].includes(value.nativeHook as string)
      || !["none", "zBattle", "token"].includes(value.primitiveRemoval as string)) koResultRebuild("missing or unreviewed native route");
}
function original(outcome: KoOutcome): boolean { return outcome.moved && !outcome.route.skillReplacementApplied; }
/** Validate structure against an authoritative source binding and processed loop cursor.
 * The caller must derive these from the source/phase, never from this receipt itself.
 */
export function requireKoResult(value: unknown, expected: KoBinding, processed: number): asserts value is KoResult {
  if (!binding(expected) || !epoch(processed)) koResultRebuild("invalid source or cursor");
  if (!object(value) || value.version !== 1 || !binding(value.binding) || !sameBinding(value.binding, expected)
      || !Array.isArray(value.selected) || !Array.isArray(value.outcomes)) koResultRebuild("missing or mismatched source binding");
  const selected = value.selected;
  if (selected.length > 1 || processed > selected.length || value.outcomes.length !== processed
      || selected.some(x => !object(x) || !text(x.card) || !epoch(x.epoch) || !player(x.owner))
      || new Set(selected.map(x => x.card)).size !== selected.length) koResultRebuild("invalid selected occurrence or completion cursor");
  for (let i = 0; i < value.outcomes.length; i++) {
    const outcome = value.outcomes[i], picked = selected[i];
    if (!object(outcome) || outcome.card !== picked.card || outcome.fromEpoch !== picked.epoch
        || !epoch(outcome.toEpoch) || outcome.toEpoch < picked.epoch || outcome.owner !== picked.owner
        || !(outcome.to === null || area(outcome.to)) || typeof outcome.moved !== "boolean"
        || !(outcome.cost === null || typeof outcome.cost === "number" && Number.isFinite(outcome.cost) && outcome.cost >= 0)) koResultRebuild("invalid target outcome");
    requireKoRoute(outcome.route);
    const result = outcome as unknown as KoOutcome;
    if (result.moved && result.to === null) koResultRebuild("movement has no actual destination");
    if (result.moved && result.toEpoch <= result.fromEpoch) koResultRebuild("movement has no departure occurrence");
    if (!result.moved && result.toEpoch !== result.fromEpoch) koResultRebuild("refusal changed the occurrence");
    if (original(result)) {
      const removed = result.route.nativeHook === "ultimate" || result.route.primitiveRemoval !== "none";
      if (result.to !== (removed ? "removed" : "drop")) koResultRebuild("original KO has an unreviewed destination");
    } else if (result.cost !== null) koResultRebuild("failed or substituted KO has successful cost evidence");
  }
}
/** Only call at the first attempt, after authoritative phase validation. Never repair a missing save. */
export function startKoResult(source: KoBinding, selected: KoSelected[]): KoResult {
  const result: KoResult = { version: 1, binding: { ...source }, selected: selected.map(x => ({ ...x })), outcomes: [] };
  requireKoResult(result, source, 0);
  return result;
}
/** Append once, in original selected order; duplicate callbacks are contract errors. */
export function recordKoOutcome(result: KoResult, source: KoBinding, processed: number, outcome: KoOutcome): void {
  requireKoResult(result, source, processed);
  const next = { ...result, outcomes: [...result.outcomes, { ...outcome, route: { ...outcome.route } }] };
  requireKoResult(next, source, processed + 1);
  result.outcomes = next.outcomes;
}
export function completedKoCost(result: unknown, source: KoBinding, selectedCount: number, maximum: number): boolean {
  if (!Number.isFinite(maximum) || maximum < 0) koResultRebuild("invalid cost bound");
  requireKoResult(result, source, selectedCount);
  if (result.selected.length !== selectedCount) koResultRebuild("KO loop is not complete");
  return result.outcomes.some(outcome => original(outcome) && outcome.cost !== null && outcome.cost <= maximum);
}
