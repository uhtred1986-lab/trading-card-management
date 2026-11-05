/** R476 isolated effect body; this does not place a card or bypass a keyword. */
import { emptyFilter } from "../text/filters";
import { NotYet } from "./errors";
import type { Op, ScriptFrame } from "./script";
import { completedMovement } from "./movement-result";
import { energyEntryPolicyProblem, type EnergyEntryExhaustPolicy } from "./energy-entry-policy";

export const ENERGY_ENTRY_SLOTS = ["§energyEntryFirst", "§energyEntrySecond"] as const;

export function energyEntryEffect(policy: EnergyEntryExhaustPolicy): Op[] {
  if (energyEntryPolicyProblem(policy)) throw new NotYet("rebuild this Energy entry policy", "R476");
  const [first, second] = ENERGY_ENTRY_SLOTS;
  return [{ op: "may", ops: [
    { op: "choose", sel: { side: "you", area: "drop", count: 1, filter: { ...emptyFilter(), colors: [policy.colors[0]] } }, as: first },
    { op: "choose", sel: { side: "you", area: "drop", count: 1, filter: { ...emptyFilter(), colors: [policy.colors[1]] }, notIn: [first] }, as: second },
    { op: "moveTo", target: { var: first }, to: "warp", cause: "effect", completedAs: first },
    { op: "moveTo", target: { var: second }, to: "warp", cause: "effect", completedAs: second },
  ] }];
}

/** Completion authorizes an attempt to negate Energy-Exhaust. The entry owner
 * must still check source occurrence, negation protection and final mode. */
export function energyEntryPayersCompleted(frame: ScriptFrame): boolean {
  if (!frame.did?.may) return false;
  const [first, second] = ENERGY_ENTRY_SLOTS;
  const a = frame.vars[first], b = frame.vars[second];
  return a?.length === 1 && b?.length === 1 && a[0] !== b[0]
    && completedMovement(frame, first, 1, true) && completedMovement(frame, second, 1, true);
}
