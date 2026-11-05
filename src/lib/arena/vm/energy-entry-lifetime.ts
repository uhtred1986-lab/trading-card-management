/** Pure validation for the one occurrence created by an optional Energy entry. */
import type { VmState } from "./state";
import { NotYet } from "./errors";

export function guardEnergyEntryLifetimes(state: VmState): void {
  for (const effect of state.effects) {
    if (effect.energyEntryEpoch === undefined) continue;
    const card = state.cards[effect.target];
    const owner = card?.owner;
    if (!card || !Number.isSafeInteger(effect.energyEntryEpoch) || effect.energyEntryEpoch < 0 ||
      effect.energyEntryEpoch !== (card.zoneEpoch ?? 0) || effect.kind !== "negateKeyword" ||
      effect.value !== "Energy-Exhaust" || effect.source !== effect.target || effect.until !== "game" ||
      (owner !== "p1" && owner !== "p2") || effect.master !== owner || !state.sides[owner].zones.energy.includes(effect.target)) {
      throw new NotYet("rebuild this optional Energy negation occurrence", "R476");
    }
  }
}

/** Unreviewed procedures cannot mutate a stamped occurrence or its pile host. */
export function refuseEnergyEntryProcedure(board: { effects?: readonly { target: string; energyEntryEpoch?: number }[] }, ids: readonly (string | undefined)[]): void {
  if(board.effects?.some(effect=>effect.energyEntryEpoch!==undefined&&ids.includes(effect.target)))throw new NotYet("this procedure for an optional Energy negation occurrence", "R476");
}
