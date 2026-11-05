/** R477 synchronous transaction adapter prototype. No production callers. */
import type { EngineContext } from "../types";
import type { VmState } from "./state";
import { NotYet } from "./errors";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { requireResolvedGrantHistory, resolvedGrantDeleted } from "./resolved-grant-deletion";
import { emptyStandingNegationHistory, settleStandingNegation, validateStandingNegationObservation } from "./standing-negation-history";
import type { StandingNegationCard as Card, StandingNegationHistory as History, StandingNegationObservation as Observation } from "./standing-negation-history";
import { observeStandingNegation, standingNegationBattleOccurrences } from "./standing-negation-observation";

declare const tokenBrand: unique symbol;
export interface StandingNegationMutation { readonly [tokenBrand]: true }
interface Capture {
  ctx: EngineContext;
  state: VmState;
  before: Card[];
  previous: Observation;
  history: History;
  historyIdentity: string;
}
const captures = new WeakMap<StandingNegationMutation, Capture>();
const refuse = (message: string): never => { throw new NotYet(message, "R477"); };
function savedObservation(history: History): Observation {
  if (!history || typeof history.observation !== "string") return refuse("rebuild standing-negation transaction history");
  let candidates: Observation["candidates"];
  try { candidates = JSON.parse(history.observation); } catch { return refuse("rebuild standing-negation stored observation"); }
  const observation: Observation = { version: 1, policy: "otherBattleWholeV1", candidates };
  validateStandingNegationObservation(history, observation);
  return observation;
}
function current(ctx: EngineContext, state: VmState): { observation: Observation; history: History; before: Card[] } {
  const history = state.standingNegationHistory === undefined ? emptyStandingNegationHistory() : state.standingNegationHistory;
  const previous = savedObservation(history), before = standingNegationBattleOccurrences(ctx, state);
  const observation = observeStandingNegation(ctx, state, { history, previous, before, arrivals: [] });
  if (state.standingNegationHistory === undefined && observation.candidates.length) return refuse("rebuild affected standing-negation history before mutation");
  validateStandingNegationObservation(history, observation);
  return { observation, history, before };
}
function suppressedGrants(state: VmState, history: History) {
  const targets = new Set(history.suppressed.map(edge => edge.target.card));
  for (const target of targets) requireResolvedGrantHistory(state, target);
  return state.effects.filter(effect => targets.has(effect.target) && (effect.kind === "keyword" || effect.kind === "copiedSkills"));
}

/** Read assertion: also catches a new resolved grant written under suppression
 * even when that grant does not change the source/target observation identity. */
export function assertStandingNegationSettled(ctx: EngineContext, state: VmState): void {
  const { history } = current(ctx, state);
  for (const grant of suppressedGrants(state, history)) if (!resolvedGrantDeleted(state, grant.target, grant.id)) refuse("settle newly granted text under standing whole-negation before reading");
}

/** Capture only before a bounded synchronous native mutation. This token is
 * intentionally not serializable; saved choices must begin a new native slice.
 * It is bound to the current working state, never a replacement state object. */
export function captureStandingNegationMutation(ctx: EngineContext, state: VmState): StandingNegationMutation {
  assertStandingNegationSettled(ctx, state);
  const { observation, history, before } = current(ctx, state);
  const token = Object.freeze({}) as StandingNegationMutation;
  captures.set(token, { ctx, state, before, previous: structuredClone(observation), history: structuredClone(history), historyIdentity: canonical(state.standingNegationHistory ?? null) });
  return token;
}

/** Settle before any query/trigger/choice follows the mutation. Only the two
 * history fields are published, after all validation; native state/frame/queue
 * references remain intact. A preceding failed native mutation is discarded
 * by the caller's existing apply-action working-state boundary. */
export function settleStandingNegationMutation(ctx: EngineContext, state: VmState, token: StandingNegationMutation,
  options: { arrivals?: Card[]; enablingOrder?: readonly string[] } = {}): void {
  const captured = token && captures.get(token);
  if (!captured || captured.ctx !== ctx || captured.state !== state) return refuse("rebuild original synchronous standing-negation transaction capture");
  if (!options || typeof options !== "object" || Array.isArray(options)) return refuse("rebuild standing-negation mutation options");
  if (canonical(state.standingNegationHistory ?? null) !== captured.historyIdentity) return refuse("standing-negation history changed during captured mutation");
  const observation = observeStandingNegation(ctx, state, { before: captured.before, previous: captured.previous, history: captured.history, arrivals: options.arrivals === undefined ? [] : options.arrivals });
  const history = settleStandingNegation(captured.history, observation, options.enablingOrder);
  if (captured.historyIdentity === "null" && !observation.candidates.length && history.nextSerial === 1) {
    captures.delete(token);
    return;
  }
  // Validate original receipt identity first. Never fabricate a timed effect
  // or grant receipt merely to mark text deleted by a standing generation.
  const grants = suppressedGrants(state, history);
  const receipts = state.resolvedGrantDeletions === undefined ? undefined : structuredClone(state.resolvedGrantDeletions);
  for (const grant of grants) {
    const card = state.cards[grant.target];
    const receipt = receipts?.find(item => item.card === grant.target && item.epoch === (card.zoneEpoch ?? 0)
      && item.hiddenCount === (card.hiddenCount ?? 0) && item.grant === grant.id);
    if (!receipt) return refuse("rebuild original grant receipt before standing deletion");
    receipt.deleted = true;
  }
  const staged: VmState = { ...state, standingNegationHistory: history, ...(receipts === undefined ? {} : { resolvedGrantDeletions: receipts }) };
  assertStandingNegationSettled(ctx, staged);
  state.standingNegationHistory = history;
  if (receipts !== undefined) state.resolvedGrantDeletions = receipts;
  captures.delete(token);
}
