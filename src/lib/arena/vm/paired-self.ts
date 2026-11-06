import { completeFilter } from "./script-schema";
import { canonicalTaxValue } from "./tax-receipt";
import type { Script } from "./script";
import type { VmState } from "./state";
import { NotYet } from "./errors";

/** R487/R490: only the two bounded paired programs with an occurrence-bound self operation. */
export interface PairedSelf { version: 1; card: string; token: number }
export function pairedSelfScript(script: Script | undefined): boolean {
  return Array.isArray(script?.trigger) && (script.trigger.includes("playedUsingUnionPotara") || script.trigger.includes("attacksOpponentBattle"));
}
export function requirePairedSelfShape(script: Script | undefined): void {
  if (Array.isArray(script?.trigger) && script.trigger.includes("attacksOpponentBattle")) {
    // Complete stored selector and variable linkage; key order is not semantics.
    const expected = [
      { op: "switchMode", target: { sel: { special: "self" } }, mode: "active" },
      { op: "choose", sel: { side: "opponent", area: "battle", filter: completeFilter({ type: "BATTLE" }), count: 1, upTo: true, ignoreBarrier: true }, as: "c0", reason: "choose up to 1 of your opponent's Battle Cards" },
      { op: "switchMode", target: { var: "c0" }, mode: "rest" },
    ];
    if (script.kind !== "auto" || !Array.isArray(script.trigger) || script.trigger.length !== 2 || !script.trigger.includes("played")
        || canonicalTaxValue(script.ops) !== canonicalTaxValue(expected))
      throw new NotYet("rebuild the bounded paired self-Active and opposing Rest program", "R490");
    return;
  }
  const ops = script?.ops;
  const draw = ops?.[0], power = ops?.[1];
  if (script?.kind !== "auto" || !Array.isArray(script.trigger) || script.trigger.length !== 2 || !script.trigger.includes("attacks")
      || !script.trigger.includes("playedUsingUnionPotara") || !Array.isArray(ops) || ops.length !== 2
      || draw?.op !== "draw" || draw.n !== 1 || Object.keys(draw).length !== 2
      || power?.op !== "power" || power.amount !== 5000 || power.until !== "turn" || Object.keys(power).length !== 4
      || !power.target || typeof power.target !== "object" || !("sel" in power.target) || Object.keys(power.target).length !== 1
      || !power.target.sel || typeof power.target.sel !== "object" || power.target.sel.special !== "self" || Object.keys(power.target.sel).length !== 1)
    throw new NotYet("rebuild the bounded paired self-power program", "R487");
}
export function capturePairedSelf(state: VmState, card: string, script: Script): PairedSelf {
  requirePairedSelfShape(script);
  const source = state.cards[card];
  source.pairedSelfToken ??= source.zoneEpoch ?? 0;
  const captured = { version: 1 as const, card, token: source.pairedSelfToken };
  requirePairedSelf(state, card, captured);
  return captured;
}
export function requirePairedSelf(state: VmState, card: string, captured: PairedSelf | undefined): void {
  const source = state.cards[card], current = source?.pairedSelfToken, epoch = source?.zoneEpoch ?? 0;
  if (!Number.isSafeInteger(epoch) || epoch < 0 || !captured || captured.version !== 1 || captured.card !== card
      || !Number.isSafeInteger(captured.token) || captured.token < 0 || captured.token > epoch
      || !Number.isSafeInteger(current) || current! < captured.token || current! > epoch)
    throw new NotYet("saved paired self-power is missing its source occurrence; rebuild the match", "R487");
}
