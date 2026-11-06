/** R437: a bounded Counter tail needs a lifetime, but plays no cards itself. */
import type { Op } from "./script";
export function counterChoiceTail(ops: readonly Op[]): boolean {
  if (ops.length !== 1) return false;
  const root = ops[0];
  if (root.op !== "if" || root.else || root.cond.kind !== "count" || root.cond.sel.special !== "resolving" || root.cond.atLeast !== 1 || Object.keys(root.cond).some(k => !["kind", "sel", "atLeast"].includes(k)) || root.then.length !== 3) return false;
  const [replace, choice, move] = root.then;
  return replace.op === "resolvingPlay" && replace.instead === "hand" && Object.keys(replace).every(k => ["op", "instead", "cardType"].includes(k))
    && choice.op === "choose" && Object.keys(choice).every(k => ["op", "sel", "as", "reason"].includes(k)) && choice.sel.side === "you" && choice.sel.area === "battle" && choice.sel.count === 1 && choice.sel.upTo === true
    && choice.sel.filter?.type === "BATTLE" && Object.keys(choice.sel).every(k => ["side", "area", "count", "upTo", "filter"].includes(k))
    && move.op === "moveTo" && "var" in move.target && Object.keys(move.target).length === 1 && move.target.var === choice.as && move.to === "hand" && Object.keys(move).every(k => ["op", "target", "to"].includes(k));
}
