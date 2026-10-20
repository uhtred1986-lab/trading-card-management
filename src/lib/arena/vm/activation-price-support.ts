import type { Op } from "./script";

/**
 * #1096 (23-2, 4-3-3): "place this card under it" in front of an [Activate]
 * colon is a plain move of a card the price itself named. It is payable only
 * when both ends are fixed by the price: the pile's host is this card (no
 * `under`: "place 1 card from your hand under this card", BT2-068) or a card
 * an earlier `choose` of the same price bound (`under: { var }`), and what goes
 * under it is this card or another earlier `choose` of the price. A host given
 * as a selector would be resolved to its first match instead of chosen.
 */
function placeUnderProblem(op: Extract<Op, { op: "moveTo" }>, earlier: Op[]): string | null {
  const bound = (v: string) => earlier.some((o) => o.op === "choose" && o.as === v);
  // No `under`: the host is the source card (`script.ts` moveTo), a fixed host.
  if (op.under) {
    if (!("var" in op.under)) return "the activation payment planner cannot charge moveTo under a host the price did not choose (selector)";
    if (!bound(op.under.var)) return "the activation payment planner cannot charge moveTo under a card the price did not choose";
  }
  const moved = op.target;
  const selfOrChosen = "var" in moved ? bound(moved.var) : moved.sel.special === "self";
  if (!selfOrChosen) return "the activation payment planner cannot charge moveTo under for a card the price did not choose";
  return null;
}

/** Static refusals of canPayPriceProgram, shared with authoring; affordability still needs a board. */
export function activationPriceProblem(ops: Op[]): string | null {
  for (const [at, op] of ops.entries()) {
    switch (op.op) {
      case "choose": case "switchMode": case "hidden": break;
      case "discard": case "mill": case "removeMarker":
        if (typeof op.n !== "number") return `the activation payment planner cannot charge a variable ${op.op} amount`;
        break;
      case "moveTo":
        if (op.to === "play") return `the activation payment planner cannot charge moveTo ${op.to}`;
        if (op.to === "under") {
          const problem = placeUnderProblem(op, ops.slice(0, at));
          if (problem) return problem;
        }
        break;
      default: return `the activation payment planner does not support ${op.op} as a cost`;
    }
  }
  return null;
}
