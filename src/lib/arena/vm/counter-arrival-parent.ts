/** R435's first arrival batch preserves an explicitly chosen order (RM 3-1-5).
 * Automatic multi-card pools need an owner-ordering protocol before admission.
 */
import type { Op, Selector } from "./script";

type Binding = "single" | "ordered";
const one = (sel: Selector): boolean => !sel.alsoFrom?.length && !sel.orSelf && (sel.take === 1 || sel.special === "self" || sel.special === "subject");

export function counterArrivalParentProblem(ops: readonly Op[]): string | null {
  function visit(body: readonly Op[], inherited: Map<string, Binding>): string | null {
    const bindings = new Map(inherited);
    for (const op of body) {
      if (op.op === "play" && !op.activating) {
        if (op.onto || op.alsoUnder || op.using || op.counterWindow || typeof op.markers === "object") {
          return "a per-arrival Counter over an unstaged special play procedure";
        }
        const binding = "var" in op.target ? bindings.get(op.target.var) : one(op.target.sel) ? "single" : undefined;
        if (!binding) return "a per-arrival Counter requiring an explicit owner ordering of simultaneous plays";
      }
      if (op.op === "if" || op.op === "may" || op.op === "chooseMode") {
        const children = op.op === "if" ? [op.then, op.else ?? []] : op.op === "may" ? [op.ops] : op.modes.map(mode => mode.ops);
        for (const child of children) {
          const problem = visit(child, bindings);
          if (problem) return problem;
        }
        // A branch may overwrite a previously bound name. Do not reuse that
        // provenance outside the branch without a new explicit choice.
        const invalidate = (child: readonly Op[]): void => {
          for (const item of child) {
            if ("as" in item && typeof item.as === "string") bindings.delete(item.as);
            if (item.op === "if") { invalidate(item.then); invalidate(item.else ?? []); }
            if (item.op === "may") invalidate(item.ops);
            if (item.op === "chooseMode") for (const mode of item.modes) invalidate(mode.ops);
          }
        };
        for (const child of children) invalidate(child);
      }
      if ("as" in op && typeof op.as === "string") bindings.delete(op.as);
      if (op.op === "choose") {
        const ordinaryCount = op.atMost === undefined && op.exactly === undefined && op.sumTo === undefined && !op.namedSet && !op.sel.eachUnionName;
        if (ordinaryCount && (one(op.sel) || op.sel.count === 1)) bindings.set(op.as, "single");
        else if (op.sel.upTo && op.sel.side === "you" && op.sel.area === "hand" &&
          (op.chooser === undefined || op.chooser === "you") && ordinaryCount && !op.owed &&
          Object.keys(op.sel).every(key => ["side", "area", "filter", "count", "upTo", "minCount", "ignoreBarrier", "differentNames"].includes(key))) {
          bindings.set(op.as, "ordered");
        }
      }
    }
    return null;
  }
  return visit(ops, new Map());
}
