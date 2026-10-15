/** Complete, closed proposal validation. A schema is not a runtime capability certificate. */
import { z } from "zod";
import { readRule } from "./lang/validate";
import { printRule } from "./lang/print";
import { runtimeSupportOfRow } from "./rules-store";
import type { Rule } from "./lang/ast";
import { COLORS } from "./vm/script-schema";

export const ExplanationSchema = z.object({
  meaning: z.string().min(1).max(2000),
  confident: z.boolean(),
  question: z.string().max(2000),
  ruleJson: z.string().max(30000),
  missingCapability: z.string().max(2000),
}).strict();
export type ExplanationAnswer = z.infer<typeof ExplanationSchema>;
export type ExplanationDecision =
  | { kind: "supported"; rule: Rule; meaning: string; reading: string }
  | { kind: "question"; question: string; meaning: string }
  | { kind: "invalid"; error: string }
  | { kind: "unsupported"; missing: string[]; meaning: string; proposed: string };
export type ExplanationResult = {
  decision: ExplanationDecision; proposalId: number | null; token: string | null;
  issueUrl: string | null; issueError: string | null;
};
export type SavedExplanation = { explanation: string; result: ExplanationResult };

function keysProblem(value: unknown, allowed: string[]): boolean {
  return !value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key));
}

export function explainDecision(raw: unknown, kind: string, printed: string): ExplanationDecision {
  const parsed = ExplanationSchema.safeParse(raw);
  if (!parsed.success) return { kind: "invalid", error: "Claude's answer did not match the explanation format. Nothing was changed." };
  const answer = parsed.data;
  if (!answer.confident || answer.question.trim()) return {
    kind: "question", question: answer.question.trim() || "Please clarify the intended timing, price, condition and effect before requesting another draft.", meaning: answer.meaning,
  };
  if (answer.missingCapability.trim()) return { kind: "unsupported", missing: [answer.missingCapability.trim()], meaning: answer.meaning, proposed: answer.ruleJson };
  let json: unknown;
  try { json = JSON.parse(answer.ruleJson); } catch { return { kind: "invalid", error: "The proposed complete rule is not JSON. Nothing was changed." }; }
  const completeKeys = ["kind", "trigger", "cost", "cond", "ops"];
  if (keysProblem(json, completeKeys) || !completeKeys.every((key) => Object.hasOwn(json as object, key))) return { kind: "invalid", error: "A complete rule must contain exactly kind, trigger, cost, cond and ops." };
  const cost = (json as Rule).cost;
  if (cost && (keysProblem(cost, ["text", "orbs", "either", "marker", "burst", "spiritBoost", "condition", "program", "x", "payWith"]) ||
      keysProblem(cost.orbs, ["any", ...COLORS]) ||
      (cost.x && keysProblem(cost.x, ["min", "max"])) ||
      (cost.payWith !== undefined && (!Array.isArray(cost.payWith) || cost.payWith.some((payer) => keysProblem(payer, ["sel", "as"])))))) return { kind: "invalid", error: "The proposed cost contains unknown fields." };
  // readRule checks every operation/condition/selector/ref and closes nested keys.
  // Bad external values may also throw inside the pre-existing cost validator.
  try {
    const checked = readRule(json, kind);
    if ("error" in checked) return { kind: "invalid", error: checked.error.message };
    const rule = checked.rule;
    const support = runtimeSupportOfRow({ ...rule, printed, unread: [] });
    if (support.unsupported.length) return { kind: "unsupported", missing: support.unsupported, meaning: answer.meaning, proposed: printRule(rule) };
    if (support.unknown.length) return { kind: "question", meaning: answer.meaning, question: `Runtime support still needs manual capability review: ${support.unknown.join("; ")}. Use the rule builder / Try it to review the concrete board and target; rephrasing alone cannot clear this guard. No approval is available here yet.` };
    return { kind: "supported", rule, meaning: answer.meaning, reading: printRule(rule) };
  } catch { return { kind: "invalid", error: "The complete rule failed structural validation. Nothing was changed." }; }
}
