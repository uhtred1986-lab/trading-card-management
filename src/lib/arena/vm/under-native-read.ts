import { scopedStandingReadMatches, scopedStandingReadContext, invalidateScopedStandingRead } from "./standing-read-scope";
/** R528 private native read seals; no history repair or policy mutation. */
import type { GameDefinition } from "../rulesets";
import type { EngineContext } from "../types";
import { canonicalTaxValue as canonical } from "./tax-receipt";
import type { UnderHistory } from "./standing-negation-under-history";
import { underStandingSourceKey } from "./standing-negation-under-relation";
import { nativeUnderFingerprint, validateNativeUnderCurrent, requireExclusiveNativeUnder, refuseNativeUnder, type NativeUnderState } from "./under-native-observation";
const seals = new WeakMap<NativeUnderState, { ctx: EngineContext; game: GameDefinition; gameIdentity: string; stateGame: string; facts: string; history: string }>();
export function invalidateNativeUnderRead(state: NativeUnderState): void { invalidateScopedStandingRead(state); seals.delete(state); }
export function issueNativeUnderRead(ctx: EngineContext, game: GameDefinition, state: NativeUnderState): void {
    if (game.id !== state.game) return refuseNativeUnder("seal native standing against its actual game definition");
    const { history } = validateNativeUnderCurrent(ctx, game, state);
    seals.set(state, { ctx, game, gameIdentity: canonical(game), stateGame: state.game, facts: nativeUnderFingerprint(ctx, state), history: canonical(history) });
}
export function nativeUnderReadMatches(ctx: EngineContext, state: NativeUnderState): boolean {
    if (state.underStandingNegationHistory && scopedStandingReadMatches(ctx, state)) return true;
    const seal = seals.get(state);
    return !!seal && seal.ctx === ctx && seal.stateGame === state.game && seal.game.id === state.game
        && seal.gameIdentity === canonical(seal.game) && state.standingNegationHistory === undefined && state.mixedStandingNegationHistory === undefined
        && seal.history === canonical(state.underStandingNegationHistory) && seal.facts === nativeUnderFingerprint(ctx, state);
}
function current(state: NativeUnderState): UnderHistory {
    if (scopedStandingReadContext(state) && state.underStandingNegationHistory) return state.underStandingNegationHistory;
    const seal = seals.get(state);
    if (!seal || !nativeUnderReadMatches(seal.ctx, state)) return refuseNativeUnder("validate native v3 standing facts before a no-context read");
    return requireExclusiveNativeUnder(state);
}
export function nativeUnderSkillsNegated(state: NativeUnderState, id: string): boolean {
    return current(state).negated.some(edge => edge.target.card === id);
}
export function nativeUnderAttackProhibited(state: NativeUnderState, id: string) {
    const history = current(state), edge = history.attackBans.find(item => item.target.card === id);
    if (!edge) return null;
    const candidate = history.observation.under.find(item => underStandingSourceKey(item.source) === edge.source);
    if (!candidate) return refuseNativeUnder("bind native attack prohibition to its original under source");
    return { source: candidate.source.occurrence.card, master: candidate.relation.host.holder, target: id, serial: edge.serial };
}
