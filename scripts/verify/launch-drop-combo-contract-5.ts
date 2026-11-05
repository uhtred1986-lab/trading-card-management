import assert from "node:assert/strict";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { dropComboRecordGap } from "../../src/lib/arena/vm/drop-combo-contract";
import { programProblem } from "../../src/lib/arena/vm/script-schema";
import { printRule, parseRule, deepEqual, type Rule } from "../../src/lib/arena/lang";
const printed = "[Permanent] You can use mono-yellow ≪Earthling≫ cards with 5000 combo power from your Drop in combos.";
const def = card("LAUNCH", { type: "LEADER", skill: printed });
const row = skillRecords(def)[0];
assert.deepEqual(row.unread, []); assert.equal(dropComboRecordGap(row), null); assert.equal(programProblem(row.ops), null);
assert.equal(row.ops.length, 1); assert.equal(row.ops[0].op, "permit");
if (row.ops[0].op !== "permit") throw new Error("permission contract");
assert.equal(row.ops[0].what, "comboFromDrop"); assert.equal(row.ops[0].filter?.type, "BATTLE");
assert.deepEqual(row.ops[0].filter?.colors, ["Yellow"]); assert.equal(row.ops[0].filter?.monoColor, true);
assert.equal(row.ops[0].filter?.comboPowerMin, 5000); assert.equal(row.ops[0].filter?.comboPowerMax, 5000);
const rule: Rule = { kind: "permanent", cost: null, cond: null, trigger: [], ops: row.ops };
const read = parseRule(printRule(rule)); assert.ok(read.ok); if (read.ok) assert.ok(deepEqual(read.value, rule));
let cases = 1;
for (const status of ["draft", "confirmed", "corrected", "rejected"]) {
  const old = { ...row, ops: [{ op: "comboFrom", target: { sel: { side: "you", area: "drop", filter: row.ops[0].filter } } }] };
  assert.match(dropComboRecordGap(old) ?? "", /standing Drop combo/);
  const loaded = rulesFromRows([{ ...old, id: 473, source: "compiler", status } as unknown as RuleRow], { LAUNCH: def });
  assert.match(loaded.LAUNCH.bySkill[0].unsupported.join(" "), /standing Drop combo/); cases++;
}
const action = skillRecords(card("ACT", { skill: "[Activate: Main] Choose up to 1 mono-yellow ≪Earthling≫ card with 5000 combo power from your Drop and use it in a combo." }))[0];
assert.deepEqual(action.unread, []); assert.ok(action.ops.some(op => op.op === "comboFrom")); assert.ok(!action.ops.some(op => op.op === "permit")); cases++;
for (const word of ["unreadable-qualification", "unknown price token"]) {
  const unread = skillRecords(card("NO", { skill: printed.replace("mono-yellow", word) }))[0];
  assert.ok(unread.unread.length || !unread.ops.some(op => op.op === "permit")); cases++;
}
console.log(`launch-drop-combo-contract-5: ${cases} stored/DSL cases passed`);
