/** R450: the bounded Counter X contract selects Spirit Boost markers only. */
import type { Action } from "../types";
import type { XCost } from "./script";
import { IllegalAction } from "./common";

/** No energy-X, mixed future X shapes or invented floor/ceiling are admitted. */
export function counterSpiritBoostX(x: XCost | undefined): boolean {
  return !!x && x.spiritBoost === true && Object.keys(x).every(key => key === "spiritBoost");
}

/** Used at native declaration and again after a saved energy-payment prompt. */
export function counterXValue(action: Extract<Action, { type: "counter" }>, x: XCost | undefined): number | undefined {
  if (!action.card || !counterSpiritBoostX(x)) {
    if (action.x !== undefined) throw new IllegalAction("this Counter action has no supported X marker payment");
    return undefined;
  }
  if (!Number.isSafeInteger(action.x) || action.x! < 0) throw new IllegalAction("choose a nonnegative whole Spirit Boost X payment");
  return action.x;
}
