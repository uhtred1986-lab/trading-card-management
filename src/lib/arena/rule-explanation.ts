/** Complete, closed proposal validation. A schema is not a runtime capability certificate. */
import { z } from "zod";
import { readRule } from "./lang/validate";
import { canonical, printRule } from "./lang/print";
import { runtimeSupportOfRow } from "./rules-store";
import type { Rule } from "./lang/ast";
import { COLORS } from "./vm/script-schema";
import { parseSkills } from "./text/cards";
import { costText } from "./compile/prices";
import { activationPriceProblem } from "./vm/activation-price-support";

/** These fees come from the printed skill at runtime, not from card_rules.cost. */
export function printedPrice(printed: string, kind: string, skillIndex = 0) {
  const skill = parseSkills(printed).find((entry) => entry.kind === kind && entry.index % 10 === skillIndex % 10);
  if (!skill) return null;
  return { skill, native: { orbs: Object.fromEntries(Object.entries(skill.energyCost).filter(([, n]) => n)), either: skill.energyEither,
    marker: skill.markerCost ?? null, burst: skill.burst ?? null, spiritBoost: skill.spiritBoost ?? null }, text: costText(skill.cost) };
}

export const ExplanationSchema = z.object({
  meaning: z.string().min(1).max(2000),
  confident: z.boolean(),
  question: z.string().max(2000),
  ruleJson: z.string().max(30000).describe('Serialized complete rule JSON: exactly kind, trigger (string array, [] when there is no WHEN; never null), cost, cond, ops.'),
  missingCapability: z.string().max(2000),
}).strict().superRefine((answer, ctx) => {
  if (!answer.confident || answer.question.trim() || answer.missingCapability.trim()) return;
  // Validate inside the serialized field at generation time too, so generateJson's
  // existing bounded repair retry gets the actual error rather than saving bad output.
  try {
    const json = JSON.parse(answer.ruleJson);
    const shapeProblem = proposalShapeProblem(json);
    if (shapeProblem) {
      ctx.addIssue({ code: "custom", path: ["ruleJson"], message: shapeProblem });
      return;
    }
    const checked = readRule(json, json?.kind);
    if ("error" in checked) ctx.addIssue({ code: "custom", path: ["ruleJson"], message: checked.error.message });
  } catch {
    ctx.addIssue({ code: "custom", path: ["ruleJson"], message: "Provide structurally valid complete rule JSON." });
  }
});
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

/** Generation and review require the same complete, closed proposal shape. */
function proposalShapeProblem(json: unknown): string | null {
  const completeKeys = ["kind", "trigger", "cost", "cond", "ops"];
  if (keysProblem(json, completeKeys) || !completeKeys.every((key) => Object.hasOwn(json as object, key))) return "A complete rule must contain exactly kind, trigger, cost, cond and ops.";
  const cost = (json as Rule).cost;
  if (cost && (keysProblem(cost, ["version", "readable", "text", "orbs", "either", "marker", "burst", "spiritBoost", "condition", "program", "x", "payWith"]) ||
      keysProblem(cost.orbs, ["any", ...COLORS]) ||
      (Array.isArray(cost.either) && cost.either.some((group) => !Array.isArray(group) || group.some((color) => !(COLORS as readonly unknown[]).includes(color)))) ||
      (cost.x && keysProblem(cost.x, ["min", "max"])) ||
      (cost.payWith !== undefined && (!Array.isArray(cost.payWith) || cost.payWith.some((payer) => keysProblem(payer, ["sel", "as"])))))) return "The proposed cost contains unknown fields.";
  return null;
}

export function explainDecision(raw: unknown, kind: string, printed: string, skillIndex = 0): ExplanationDecision {
  const parsed = ExplanationSchema.safeParse(raw);
  if (!parsed.success) return { kind: "invalid", error: "Claude's answer did not match the explanation format. Nothing was changed." };
  const answer = parsed.data;
  if (!answer.confident || answer.question.trim()) return {
    kind: "question", question: answer.question.trim() || "Please clarify the intended timing, price, condition and effect before requesting another draft.", meaning: answer.meaning,
  };
  if (answer.missingCapability.trim()) return { kind: "unsupported", missing: [answer.missingCapability.trim()], meaning: answer.meaning, proposed: answer.ruleJson };
  let json: unknown;
  try { json = JSON.parse(answer.ruleJson); } catch { return { kind: "invalid", error: "The proposed complete rule is not JSON. Nothing was changed." }; }
  const shapeProblem = proposalShapeProblem(json);
  if (shapeProblem) return { kind: "invalid", error: shapeProblem };
  // readRule checks every operation/condition/selector/ref and closes nested keys.
  // Bad external values may also throw inside the pre-existing cost validator.
  try {
    const checked = readRule(json, kind);
    if ("error" in checked) return { kind: "invalid", error: checked.error.message };
    const rule = checked.rule;
    if (kind === "keyword") return { kind: "question", meaning: answer.meaning, question: "This keyword uses the engine's native activation, payment and resolution. An ordinary THEN program cannot replace that lifecycle. Review the keyword's native rule and Try it before approving a change." };
    if (!rule.ops.length) return { kind: "invalid", error: "The response contains no effect steps. An intentional blank must be set explicitly in the manual builder." };
    const support = runtimeSupportOfRow({ ...rule, printed, unread: [] });
    if (support.unsupported.length) return { kind: "unsupported", missing: support.unsupported, meaning: answer.meaning, proposed: printRule(rule) };
    if (support.unknown.length) return { kind: "question", meaning: answer.meaning, question: `Runtime support still needs manual capability review: ${support.unknown.join("; ")}. Use the rule builder / Try it to review the concrete board and target; rephrasing alone cannot clear this guard. No approval is available here yet.` };
    const price = printedPrice(printed, kind, skillIndex);
    if (!price) return { kind: "question", meaning: answer.meaning, question: "The printed skill's native price could not be identified. Review the skill in the manual builder before approval." };
    const proposedNative = { orbs: rule.cost?.orbs ?? {}, either: rule.cost?.either ?? [], marker: rule.cost?.marker ?? null, burst: rule.cost?.burst ?? null, spiritBoost: rule.cost?.spiritBoost ?? null };
    if (JSON.stringify(canonical(proposedNative)) !== JSON.stringify(canonical(price.native))) return { kind: "question", meaning: answer.meaning, question: "The proposed energy/marker/Burst/Spirit Boost price differs from the printed price the engine actually charges. Request a faithful printed-price interpretation; this flow cannot override native fees." };
    if ((rule.cost?.text.trim() ?? "") !== price.text) return { kind: "question", meaning: answer.meaning, question: "The proposed cost text differs from the printed skill's residual cost. Keep that complete cost visible and review it before approval." };
    if (!price.text && rule.cost?.program?.length) return { kind: "question", meaning: answer.meaning, question: "This printed skill has no action cost, so the engine would not charge the proposed cost program. Review the price manually." };
    if (price.text && !rule.cost?.condition && !rule.cost?.program?.length) return { kind: "question", meaning: answer.meaning, question: "The printed cost still contains an unresolved action or condition. Energy orbs alone do not account for that cost. Review its complete payment in the manual builder / Try it." };
    if (kind !== "auto" && rule.cost?.program?.length) {
      const gap = activationPriceProblem(rule.cost.program);
      if (gap) return { kind: "unsupported", meaning: answer.meaning, missing: [gap], proposed: printRule(rule) };
    }
    return { kind: "supported", rule, meaning: answer.meaning, reading: printRule(rule) };
  } catch { return { kind: "invalid", error: "The complete rule failed structural validation. Nothing was changed." }; }
}
