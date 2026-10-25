import type { Op } from "./script";

/**
 * #1096 (23-2, 4-3-3): "place this card under it" in front of an [Activate]
 * colon is a plain move of a card the price itself named. It is payable only
 * when both ends are fixed by the price: the pile's host is this card (no
 * `under`: "place 1 card from your hand under this card", BT2-068) or a card
 * an earlier `choose` of the same price bound (`under: { var }`), and what goes
 * under it is this card or another earlier `choose` of the price. A host given
 * as a selector would be resolved to its first match instead of chosen: since
 * #1123 the compiler makes a counted host ("under a {Spirit Bomb}", BT20-087) a
 * `choose` of the price, so only a record compiled before that still carries one.
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

/**
 * #1117 (owner ruling 20 Oct 2026, 4-3-3): KO and "use in a combo" in front of an
 * [Activate] colon act on a card the price itself named — an earlier `choose` of
 * the same price, or this card. A target given any other way would be resolved
 * to whatever matches instead of being chosen by the payer.
 */
function namedByPriceProblem(what: string, target: Extract<Op, { op: "ko" | "comboFrom" }>["target"], earlier: Op[]): string | null {
  const chosen = "var" in target ? earlier.some((o) => o.op === "choose" && o.as === target.var) : target.sel.special === "self";
  return chosen ? null : `the activation payment planner cannot charge ${what} a card the price did not choose`;
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
      case "ko": case "comboFrom": {
        const problem = namedByPriceProblem(op.op, op.target, ops.slice(0, at));
        if (problem) return problem;
        break;
      }
      case "placeOnTop":
        // 23-2, 21-5-2: the pile card that comes to the top is one the price chose from this card's pile.
        if (!("var" in op.target) || !ops.slice(0, at).some((o) => o.op === "choose" && o.as === (op.target as { var: string }).var && o.sel.area === "under" && !o.sel.underHost)) return "the activation payment planner cannot charge placeOnTop for a card the price did not choose from under this card";
        break;
      case "reveal":
        // The payer picks the card shown; a selector over a bound name must name a choice of this price.
        if (op.sel.fromVar && !ops.slice(0, at).some((o) => o.op === "choose" && o.as === op.sel.fromVar)) return "the activation payment planner cannot charge a reveal of cards the price did not choose";
        break;
      case "shuffle":
        // "Pay the rest of the price, then shuffle": the shuffle closes the price, and a price that is only a shuffle pays nothing.
        if (at === 0) return "the activation payment planner cannot charge a shuffle that is the whole price";
        if (ops.slice(at + 1).some((o) => o.op !== "shuffle")) return "the activation payment planner cannot charge a step after the shuffle";
        break;
      default: return `the activation payment planner does not support ${op.op} as a cost`;
    }
  }
  return null;
}
