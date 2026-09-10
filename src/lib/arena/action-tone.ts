import type { Action } from "@/lib/arena/engine";

export function isGhostAction(action: Action): boolean {
  switch (action.type) {
    case "endMain":
    case "pass":
      return true;
    case "charge":
    case "block":
    case "counter":
      return action.card == null;
    case "optionalCost":
      return !action.pay;
    case "choose":
      return action.cards.length === 0;
    default:
      return false;
  }
}
