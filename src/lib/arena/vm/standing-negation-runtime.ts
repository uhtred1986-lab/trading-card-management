import { scopedStandingReadMatches, scopedStandingReadGame, standingReadIsUncached, standingReadWasRevoked, withUncachedStandingReads, withStandingReadLifetime, requireUnscopedStandingWrite } from "./standing-read-scope";
import { hasNativeUnderPolicy, initializeNativeUnderStanding, assertNativeUnderStandingSettled, prepareNativeUnderMutation, requireNativeUnderMutation, settleNativeUnderMutation, type NativeUnderMutation } from "./under-native-transaction";
import { nativeUnderReadMatches } from "./under-native-read";
import type { NativeUnderWritePlan, NativeUnderEffectWrite } from "./under-native-plan";
import type { MoveRecord } from "./zones";
import { rulesetFor, type GameDefinition } from "../rulesets";
import { hasMixedStandingPolicy, mixedStandingOccurrences } from "./standing-negation-mixed-observation";
import { initializeMixedStandingNegation, assertMixedStandingNegationSettled, captureMixedStandingNegationMutation,
  settleMixedStandingNegationMutation, type MixedStandingNegationMutation, type MixedBattleChange } from "./standing-negation-mixed-transaction";
import { mixedStandingNegationReadSealMatches } from "./standing-negation-mixed-read";
import { mixedStandingObservationFromHistory } from "./standing-negation-mixed-history";
import { canonicalTaxValue as canonical } from "./tax-receipt";

import { standingWholePrinted, standingWholeScript } from "./standing-negation-policy";
import { requireStandingNegationBounds, standingWholeIntent } from "./standing-negation-bounds";
/** R477/R509 bounded native integration; exact source admission retains contextual refusals. */
import type { ContinuousEffect, EngineContext, GameEvent } from "../types";
import type { VmState } from "./state";
import { parseSkills } from "../text/cards";
import { programsOf } from "./common";
import { NotYet } from "./errors";
import { emptyStandingNegationHistory } from "./standing-negation-history";
import { requireStandingWholeSourceAreas, standingNegationBattleOccurrences } from "./standing-negation-observation";
import { assertStandingNegationSettled, captureStandingNegationMutation, settleStandingNegationMutation, type StandingNegationMutation as LegacyStandingMutation } from "./standing-negation-transaction";
import { invalidateStandingNegationReadSeal, issueStandingNegationReadSeal, standingNegationReadSealMatches } from "./standing-negation-read";

export type StandingNegationMutation = LegacyStandingMutation | MixedStandingNegationMutation | NativeUnderMutation;
const nativeCaptures = new WeakMap<NativeUnderMutation, GameDefinition>();
const mixedCaptures = new WeakMap<MixedStandingNegationMutation, {
  game: GameDefinition; before: ReturnType<typeof mixedStandingOccurrences>;
  battle: ReturnType<typeof mixedStandingObservationFromHistory>["battle"];
}>();
function actualGame(ctx: EngineContext, state: VmState): GameDefinition {
  const pinned = (ctx as EngineContext & { rulesetDefinition?: GameDefinition }).rulesetDefinition;
  if (pinned?.id === state.game) return pinned;
  const loaded = rulesetFor(state.game);
  if (!loaded.ok) throw new NotYet("load the actual standing-negation game definition", "R513");
  return loaded.definition;
}
function mixedSource(ctx: EngineContext, state: VmState, id: string): boolean {
  const def = ctx.defs[state.cards[id]?.cardId];
  return !!def && hasMixedStandingPolicy({ ...ctx, defs: { [def.id]: def } });
}
function presentMixedSource(ctx: EngineContext, state: VmState): boolean {
  return (["p1", "p2"] as const).some(p => state.sides[p].zones.leader.some(id => mixedSource(ctx, state, id)));
}
/** Native 15-1-5 restoration has an existing exact paid Z-Leader base receipt.
 * This authorizes only that secondary arrival, never an arbitrary pile card.
 */
export function mixedStandingLeaderRestoration(state: VmState, id: string, from: string | null, to: string): string | undefined {
  if (!state.mixedStandingNegationHistory && !state.underStandingNegationHistory || from !== "leader" || to === "leader") return undefined;
  const card = state.cards[id];
  if (!card?.zCard || !card.under.length) return undefined;
  const base = card.leaderBase, original = base && state.cards[base.card];
  if (card.leaderStackVersion !== 1 || !base || !original || !card.under.includes(base.card)
    || !Number.isSafeInteger(base.epoch) || base.epoch !== (original.zoneEpoch ?? 0) || original.owner !== card.owner)
    throw new NotYet("bind mixed Z-Leader restoration to its original base occurrence", "R513");
  return base.card;
}
export function hasStandingNegationHistory(state: VmState): boolean {
  return !!(state.standingNegationHistory || state.mixedStandingNegationHistory || state.underStandingNegationHistory);
}
/** New games only: existing affected saves may never acquire inferred history. */
export function initializeStandingNegation(ctx: EngineContext, state: VmState): void {
  requireUnscopedStandingWrite(state);
  if (state.game === "dbs" && hasNativeUnderPolicy(ctx, state)) {
    initializeNativeUnderStanding(ctx, actualGame(ctx, state), state);
    return;
  }
  const participatingDefs: EngineContext["defs"] = {};
  for (const card of Object.values(state.cards)) if (ctx.defs[card.cardId]) participatingDefs[card.cardId] = ctx.defs[card.cardId];
  if (state.game === "dbs" && hasMixedStandingPolicy({ ...ctx, defs: participatingDefs })) {
    initializeMixedStandingNegation(ctx, actualGame(ctx, state), state);
    return;
  }
  const complete = Object.values(ctx.defs).some(def => ["BATTLE", "Z-BATTLE", "TOKEN"].includes(def.type) && (["front", "back"] as const).some(side => parseSkills((side === "back" ? def.back?.skill : def.skill) ?? null).some(skill => {
    if (!standingWholePrinted(skill)) return false;
    const script = programsOf(ctx, def, side).bySkill[skill.index];
    return standingWholeScript(script);
  })));
  if (complete) state.standingNegationHistory = emptyStandingNegationHistory();
  validateStandingNegationRead(ctx, state);
}
function exclusiveFamily(state: VmState): void {
  if ([state.standingNegationHistory, state.mixedStandingNegationHistory, state.underStandingNegationHistory].filter(value => value !== undefined).length > 1)
    throw new NotYet("retain exactly one original standing history family", "R528");
}
/** Full dependencies, not merely standing topology: a changed but still-valid
 * board must not return a result calculated with earlier cached statics. Token
 * definitions can be supplied through a Proxy, so resolve every physical/copy id.
 */
function standingReadDependencies(ctx: EngineContext, game: GameDefinition, state: VmState): string {
  const ids = new Set(Object.values(state.cards).map(card => card.cardId));
  for (const effect of state.effects) if (effect.copied) ids.add(effect.copied.cardId);
  return canonical({ state, defs: ctx.defs, scripts: ctx.scripts, game, actual: actualGame(ctx, state),
    pinned: (ctx as EngineContext & { rulesetDefinition?: GameDefinition }).rulesetDefinition,
    resolved: [...ids].sort().map(id => [id, ctx.defs[id]]) });
}
function synchronousStandingRead<T>(read: () => T): T {
  const result = read();
  if (result && (typeof result === "object" || typeof result === "function") && "then" in result && typeof result.then === "function")
    throw new Error("Standing reads must return synchronously");
  return result;
}
/** Closed authority boundary for the existing synchronous read-only callbacks.
 * No caller supplies a validator, history or projected board. Different game
 * objects retain raw validation, even when their id happens to match.
 */
export function readingStandingBoard<T>(ctx: EngineContext, game: GameDefinition, state: VmState, read: () => T): T {
  if (scopedStandingReadGame(ctx, state) === game) return synchronousStandingRead(read);
  const witness = standingReadDependencies(ctx, game, state);
  const actual = actualGame(ctx, state);
  withUncachedStandingReads(() => validateStandingNegationRead(ctx, state));
  const finish = () => {
    const result = synchronousStandingRead(read); // A thrown callback retains its original exception.
    if (standingReadWasRevoked(state) || actual !== actualGame(ctx, state)
      || witness !== standingReadDependencies(ctx, game, state))
      throw new Error("Board dependencies changed during a standing read");
    withUncachedStandingReads(() => validateStandingNegationRead(ctx, state));
    return result;
  };
  // Absence of every family is validated by the same raw boundary. A
  // mismatched passed game still receives no reusable authority.
  if (standingReadWasRevoked(state)) return withUncachedStandingReads(finish);
  if (actual !== game || standingReadIsUncached())
    return withStandingReadLifetime(ctx, game, state, () => withUncachedStandingReads(finish));
  return withStandingReadLifetime(ctx, game, state, finish);
}
export function validateStandingNegationRead(ctx: EngineContext, state: VmState): void {
  exclusiveFamily(state);
  if (scopedStandingReadMatches(ctx, state)) return;
  if (state.underStandingNegationHistory) {
    if (!nativeUnderReadMatches(ctx, state)) assertNativeUnderStandingSettled(ctx, actualGame(ctx, state), state);
    return;
  }
  if (state.game === "dbs" && hasNativeUnderPolicy(ctx, state)) throw new NotYet("retain original native under-standing history without migration", "R528");
  if (state.mixedStandingNegationHistory) {
    if (!mixedStandingNegationReadSealMatches(ctx, state, state.mixedStandingNegationHistory))
      assertMixedStandingNegationSettled(ctx, actualGame(ctx, state), state);
    return;
  }
  if (state.game === "dbs" && presentMixedSource(ctx, state)) throw new NotYet("rebuild affected mixed history without migrating legacy generations", "R513");
  requireStandingWholeSourceAreas(ctx, state);
  if (!state.standingNegationHistory) {
    const potential = (["p1", "p2"] as const).some(master => (state.sides[master].zones.battle ?? []).some(id => {
      const card = state.cards[id], def = card && ctx.defs[card.cardId];
      if (!def || card.hidden) return false;
      const side = card.flipped ? "back" : "front";
      return parseSkills((side === "back" ? def.back?.skill : def.skill) ?? null).some(skill => skill.kind === "permanent" &&
        (skill.effect.trim().toLowerCase() === "negate the skills of all other battle cards." || programsOf(ctx, def, side).bySkill[skill.index]?.ops.some(op => op.op === "negateSkills")));
    }));
    if (potential || state.effects.some(effect => effect.kind === "copiedSkills" && (["p1", "p2"] as const).some(p => state.sides[p].zones.battle.includes(effect.target)))) assertStandingNegationSettled(ctx, state);
    return;
  }
  if (standingNegationReadSealMatches(ctx, state)) return;
  assertStandingNegationSettled(ctx, state);
  issueStandingNegationReadSeal(ctx, state);
}
export function beginStandingNegationMutation(ctx: EngineContext, state: VmState, incoming?: string, nativePlan?: NativeUnderWritePlan): StandingNegationMutation | undefined {
  requireUnscopedStandingWrite(state);
  exclusiveFamily(state);
  if (state.underStandingNegationHistory) {
    if (!nativePlan) throw new NotYet("bind this native standing writer to its actual typed plan before mutation", "R528");
    const game = actualGame(ctx, state), token = prepareNativeUnderMutation(ctx, game, state, nativePlan);
    nativeCaptures.set(token, game);
    requireNativeUnderMutation(ctx, game, state, token);
    return token;
  }
  if (state.game === "dbs" && hasNativeUnderPolicy(ctx, state)) throw new NotYet("retain original native under-standing history before mutation", "R528");
  if (state.mixedStandingNegationHistory) {
    const game = actualGame(ctx, state), before = mixedStandingOccurrences(ctx, game, state);
    const battle = mixedStandingObservationFromHistory(state.mixedStandingNegationHistory).battle;
    const token = captureMixedStandingNegationMutation(ctx, game, state);
    mixedCaptures.set(token, { game, before, battle });
    return token;
  }
  if (state.game === "dbs" && (presentMixedSource(ctx, state) || incoming && mixedSource(ctx, state, incoming)))
    throw new NotYet("rebuild affected mixed history before source entry", "R513");
  requireStandingNegationBounds(ctx, state, incoming);
  if (!state.standingNegationHistory) return undefined;
  const token = captureStandingNegationMutation(ctx, state);
  invalidateStandingNegationReadSeal(state);
  return token;
}
export function finishStandingNegationMutation(ctx: EngineContext, state: VmState, token: StandingNegationMutation | undefined,
  arrival?: string | readonly string[], battle?: MixedBattleChange, nativeResults: readonly MoveRecord[] = []): void {
  requireUnscopedStandingWrite(state);
  exclusiveFamily(state);
  if (!token) {
    if (state.underStandingNegationHistory) throw new NotYet("retain the actual native standing writer capture", "R528");
    return;
  }
  const nativeGame = nativeCaptures.get(token as NativeUnderMutation);
  if (nativeGame) {
    settleNativeUnderMutation(ctx, nativeGame, state, token as NativeUnderMutation, nativeResults);
    nativeCaptures.delete(token as NativeUnderMutation);
    return;
  }
  const mixed = mixedCaptures.get(token as MixedStandingNegationMutation);
  const ids = arrival === undefined ? [] : typeof arrival === "string" ? [arrival] : arrival;
  if (mixed) {
    const board = mixedStandingOccurrences(ctx, mixed.game, state);
    const arrivals = board.filter(card => ids.includes(card.card) && !mixed.before.some(prior => canonical(prior) === canonical(card)));
    if (!battle && mixed.battle && state.battle) {
      const roles = (["attacker", "guard"] as const).filter(role => {
        const slot = mixed.battle![role];
        return slot.present && ids.includes(slot.occurrence.card)
          && (!board.some(card => canonical(card) === canonical(slot.occurrence)) || state.cards[slot.occurrence.card]?.hidden);
      });
      if (roles.length) battle = { kind: "retire", roles };
    }
    settleMixedStandingNegationMutation(ctx, mixed.game, state, token as MixedStandingNegationMutation, { arrivals, ...(battle ? { battle } : {}) });
    mixedCaptures.delete(token as MixedStandingNegationMutation);
    return;
  }
  const arrivals = standingNegationBattleOccurrences(ctx, state).filter(card => ids.includes(card.card));
  settleStandingNegationMutation(ctx, state, token as LegacyStandingMutation, { arrivals });
  issueStandingNegationReadSeal(ctx, state);
}
export function refuseStandingNegationMutation(state: VmState, procedure: string, ctx?: EngineContext, incoming?: string): void {
  requireUnscopedStandingWrite(state);
  exclusiveFamily(state);
  if (state.underStandingNegationHistory) throw new NotYet(`native under-standing during ${procedure}`, "R528");
  if (state.mixedStandingNegationHistory) {
    const observation = mixedStandingObservationFromHistory(state.mixedStandingNegationHistory);
    if (state.mixedStandingNegationHistory.active.length || observation.candidates.some(candidate => candidate.source.policy === "otherBattleWholeV1")
      || incoming && ctx && standingWholeIntent(ctx, state, incoming))
      throw new NotYet(`mixed standing whole-negation during ${procedure}`, "R513");
    return;
  }
  const def = incoming && ctx?.defs[state.cards[incoming]?.cardId];
  const arriving = def && ([def.skill, def.back?.skill]).some(text => parseSkills(text ?? null).some(skill => skill.kind === "permanent" && skill.effect.trim().toLowerCase() === "negate the skills of all other battle cards."));
  const present = ctx && (["p1", "p2"] as const).some(p => state.sides[p].zones.battle.some(id => standingWholeIntent(ctx, state, id)));
  if (present || arriving || state.standingNegationHistory?.active.length || state.standingNegationHistory?.suppressed.length) throw new NotYet(`standing whole-negation during ${procedure}`, "R477");
}

/** All effects ending at one timing disappear before the standing graph is observed. */
export function expireStandingNegationBatch(ctx: EngineContext, state: VmState, ev: GameEvent[], expire: (state: VmState, ev: GameEvent[]) => ContinuousEffect[], nativeEffects?: NativeUnderEffectWrite[]): ContinuousEffect[] {
  if (!hasStandingNegationHistory(state)) return expire(state, ev);
  {
    // Preview only the expiry list: a loan return needs its own reviewed simultaneous movement protocol.
    const ended = expire(structuredClone(state), []);
    if (!state.underStandingNegationHistory && ended.some(effect => effect.kind === "control")) refuseStandingNegationMutation(state, "control expiry", ctx);
  }
  const token = beginStandingNegationMutation(ctx, state, undefined, nativeEffects && { effects: nativeEffects });
  const ended = expire(state, ev);
  finishStandingNegationMutation(ctx, state, token);
  return ended;
}
