import type { Op } from "./script";

/** Static refusals of canPayPriceProgram, shared with authoring; affordability still needs a board. */
export function activationPriceProblem(ops: Op[]): string | null {
  for (const op of ops) {
    switch (op.op) {
      case "choose": case "switchMode": case "hidden": break;
      case "discard": case "mill": case "removeMarker":
        if (typeof op.n !== "number") return `the activation payment planner cannot charge a variable ${op.op} amount`;
        break;
      case "moveTo":
        if (op.to === "under" || op.to === "play") return `the activation payment planner cannot charge moveTo ${op.to}`;
        break;
      default: return `the activation payment planner does not support ${op.op} as a cost`;
    }
  }
  return null;
}
