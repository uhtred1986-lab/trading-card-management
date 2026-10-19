/** The serialized inner rule participates in the provider's existing bounded repair. No I/O. */
import assert from "node:assert/strict";
import { z } from "zod";
import { generateJson } from "../../src/lib/ai/core";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers";
import { createFakeProvider } from "../../src/lib/ai/providers/fake";
import { NO_SETTINGS, setSettingsLoader } from "../../src/lib/ai/settings";
import { ExplanationSchema, explainDecision } from "../../src/lib/arena/rule-explanation";
// A stored price is the typed payment v1 record (version, readable): costRecordProblem refuses a bare one.
import { zeroCostRecord } from "../../src/lib/arena/vm/skill-payment";
import { readRule } from "../../src/lib/arena/lang/validate";

async function main() {
const printed = "[swap 3] {y}{y}:≪Goku's Lineage≫ with an energy cost of 3. (Play the specified card from your hand, then return this card to your hand)";
const rule = { kind: "keyword", trigger: [], cost: { ...zeroCostRecord(), orbs: { Yellow: 2 } }, cond: null, ops: [] };
const answer = { confident: true, question: "", missingCapability: "", meaning: "Main Phase: pay two yellow energy, reveal a cost-3 Goku's Lineage Battle Card from hand and return Gohan as activation cost; play the revealed card on resolution.", ruleJson: JSON.stringify(rule) };
for (const trigger of [null, "played", {}, ["invented-moment"], [7]]) {
  const bad = { ...rule, trigger };
  assert.ok("error" in readRule(bad, "keyword"), "the original validator remains strict");
  assert.equal(ExplanationSchema.safeParse({ ...answer, ruleJson: JSON.stringify(bad) }).success, false);
}
// A structurally executable fragment is still not a complete proposal. These
// used to pass generation and fail review, bypassing the automatic repair.
for (const key of ["kind", "trigger", "cost", "cond", "ops"] as const) {
  const fragment: Record<string, unknown> = { ...rule };
  delete fragment[key];
  assert.equal(ExplanationSchema.safeParse({ ...answer, ruleJson: JSON.stringify(fragment) }).success, false, `missing ${key} must reach repair`);
}
for (const malformed of [
  { ...rule, unexpected: true },
  { ...rule, cost: { ...rule.cost, unexpected: true } },
  { ...rule, cost: { ...rule.cost, orbs: { Purple: 2 } } },
]) {
  assert.equal(ExplanationSchema.safeParse({ ...answer, ruleJson: JSON.stringify(malformed) }).success, false, "closed proposal and price keys must reach repair");
}
assert.ok(ExplanationSchema.safeParse(answer).success);
assert.doesNotThrow(() => z.toJSONSchema(ExplanationSchema), "all provider JSON-schema adapters can serialize the contract");
assert.equal(explainDecision(answer, "keyword", printed).kind, "question", "native keyword lifecycle cannot be approved as an ordinary THEN program");
assert.equal(explainDecision({ ...answer, ruleJson: JSON.stringify({ ...rule, ops: [{ op: "draw", n: 2 }] }) }, "keyword", printed).kind, "question", "nonempty ops do not bypass the native guard");
assert.equal(explainDecision(answer, "auto", printed).kind, "invalid", "kind remains immutable");
assert.ok(ExplanationSchema.safeParse({ ...answer, confident: false, question: "Which card?", ruleJson: "" }).success, "follow-up questions need no pretend executable rule");

for (const malformed of [{ ...rule, trigger: null }, { kind: rule.kind, trigger: rule.trigger, ops: rule.ops }]) {
const fake = createFakeProvider({ id: "explanation-contract", script: [
  { json: { ...answer, ruleJson: JSON.stringify(malformed) } },
  { json: answer },
] });
registerProvider(fake);
setSettingsLoader(async () => NO_SETTINGS);
try {
  const result = await generateJson({ provider: fake.id, task: "arena_clarify", tier: "best", maxTokens: 8000, schema: ExplanationSchema, system: [], messages: [] });
  assert.deepEqual(result.parsed, answer);
  assert.equal(fake.requests.length, 2, "malformed inner JSON gets the existing single repair call");
  assert.match(JSON.stringify(fake.requests[1].messages), /WHEN is a list of moments|A complete rule must contain exactly/);
} finally {
  setSettingsLoader(null);
  resetProviders();
}
}
console.log("rule explanation: serialized WHEN contract repaired; native keywords and approval guards preserved");

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
