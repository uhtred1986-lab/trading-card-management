import { describeTrigger } from "./gaps";
import { costSentence, describeCond, describeScript } from "./vm/script";
import type { Rule } from "./lang/ast";

/** Complete mechanics needed for approval; shared by the guided view and its integration proof. */
export function ruleReading(rule: Rule): string[][] {
  const timing = rule.trigger.length ? describeTrigger(rule.trigger)
    : rule.kind === "permanent" ? "Continuously while this Permanent applies"
    : rule.kind === "auto" ? "Timing has not been read"
    : `In the ${rule.kind.replaceAll(":", " ")} activation window`;
  const x = rule.cost?.x;
  const cost = rule.cost;
  const structured = cost && (Object.keys(cost.orbs).length || cost.either.length || cost.marker != null || cost.burst != null || cost.spiritBoost != null || cost.condition || cost.program?.length || cost.payWith?.length || x);
  const price = [costSentence(cost ? { ...cost, text: structured ? "" : cost.text } : null), x ? `Choose X energy (${x.min ?? 0} minimum${x.max === undefined ? "; no upper bound specified" : `; ${x.max} maximum`})` : null].filter(Boolean).join("; ");
  return [
    ["WHEN", timing],
    ["COST", price || "No skill cost"],
    ["IF", rule.cond ? describeCond(rule.cond) : "No additional condition"],
    ["THEN", describeScript(rule.ops, { permanent: rule.kind === "permanent" }) || "No effect steps"],
  ];
}
