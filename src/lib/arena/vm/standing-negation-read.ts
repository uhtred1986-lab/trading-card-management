import { nativeUnderSkillsNegated } from "./under-native-read";
import { mixedStandingSkillsNegated } from "./standing-negation-mixed-read";
/** R477 transient read witness. This stores no history and never repairs it. */
import type { EngineContext } from "../types";
import type { VmState } from "./state";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import { NotYet } from "./errors";

const seals = new WeakMap<VmState, { ctx: EngineContext; fingerprint: string }>();
function fingerprint(ctx: EngineContext, state: VmState): string {
  const board = (["p1", "p2"] as const).map(master => ({ master, cards: (state.sides[master].zones.battle ?? []).map(id => {
    const card = state.cards[id];
    return { id, cardId: card?.cardId, epoch: card?.zoneEpoch ?? 0, hidden: card?.hidden, hiddenCount: card?.hiddenCount ?? 0, flipped: card?.flipped, owner: card?.owner };
  }) }));
  const definitions = new Set(Object.values(state.cards).map(card => card.cardId));
  for (const effect of state.effects) if (effect.copied) definitions.add(effect.copied.cardId);
  const sources = [...definitions].sort().map(id => ({ id, type: ctx.defs[id]?.type, skill: ctx.defs[id]?.skill, back: ctx.defs[id]?.back?.skill,
    front: ctx.scripts?.[id], backScript: ctx.scripts?.[`${id}#back`] }));
  return canonical({ board, sources, publicZones: (["p1", "p2"] as const).map(p => Object.fromEntries(Object.entries(state.sides[p].zones).filter(([zone]) => ["leader", "energy", "unison"].includes(zone)))), faces: Object.values(state.cards).map(card => [card.id, card.cardId, !!card.flipped]),
    effects: state.effects, grants: state.resolvedGrantDeletions, history: state.standingNegationHistory });
}
/** Called only after ctx-bearing observation and grant-history validation. */
export function issueStandingNegationReadSeal(ctx: EngineContext, state: VmState): void {
  if (state.standingNegationHistory) seals.set(state, { ctx, fingerprint: fingerprint(ctx, state) });
}
export function invalidateStandingNegationReadSeal(state: VmState): void { seals.delete(state); }
export function standingNegationReadSealMatches(ctx: EngineContext, state: VmState): boolean {
  const seal = seals.get(state);
  return !!seal && seal.ctx === ctx && seal.fingerprint === fingerprint(ctx, state);
}
/** No-context readers cannot bless a changed source, board, effect or receipt. */
export function standingSkillsNegated(state: VmState, id: string): boolean {
  if ([state.standingNegationHistory, state.mixedStandingNegationHistory, state.underStandingNegationHistory].filter(value => value !== undefined).length > 1)
    throw new NotYet("read exactly one original standing history family", "R528");
  if (state.underStandingNegationHistory) return nativeUnderSkillsNegated(state, id);
  if (state.mixedStandingNegationHistory) return mixedStandingSkillsNegated(state, state.mixedStandingNegationHistory, id);
  if (!state.standingNegationHistory) return false;
  const seal = seals.get(state);
  if (!seal || seal.fingerprint !== fingerprint(seal.ctx, state)) throw new NotYet("validate standing-negation history before reading the changed board", "R477");
  return state.standingNegationHistory.suppressed.some(edge => edge.target.card === id);
}
