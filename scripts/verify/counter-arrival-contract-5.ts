import { rulesFromRows, type RuleRow } from "../../src/lib/arena/rules-store";
import { counterArrivalParentProblem } from "../../src/lib/arena/vm/counter-arrival-parent";
/** R435 typed policy contract only; native multiple-arrival proof is separate. */
import assert from "node:assert/strict";
import { card } from "./harness";
import { skillRecords } from "../../src/lib/arena/draft";
import { programProblem } from "../../src/lib/arena/vm/script-schema";
import { printRule, parseRule, deepEqual, type Rule } from "../../src/lib/arena/lang";
import { parseSkills } from "../../src/lib/arena/text/cards";
import { compileCounterArrival } from "../../src/lib/arena/compile/counter-arrival";
import type { Op, ScriptFrame } from "../../src/lib/arena/vm/script";
import { captureCounterArrivalTemplate, counterArrivalExecutionFrame, counterArrivalTemplateProblem } from "../../src/lib/arena/vm/counter-arrival-template";
import { captureCounterArrivalBatch, counterArrivalBatchProblem, currentCounterArrival } from "../../src/lib/arena/vm/counter-arrival-batch";
import { counterArrivalDescriptor, counterArrivalPolicyProblem, hasCounterArrivalPolicy, ultrasonicArrivalProgram } from "../../src/lib/arena/vm/counter-arrival-policy";

const original = ultrasonicArrivalProgram();
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
assert.deepEqual(counterArrivalDescriptor(original), { version: 1, policy: "eachQualifyingPlayV1" });
assert.equal(counterArrivalPolicyProblem(original), null);
assert.equal(hasCounterArrivalPolicy(original), true);
const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)])) : value;
assert.deepEqual(counterArrivalDescriptor(reorder(original)), counterArrivalDescriptor(original));
assert.deepEqual(counterArrivalDescriptor([{ ...original[0], omitted: undefined }]), counterArrivalDescriptor(original));
let cases = 3;
function set(value: unknown, path: (string | number)[], replacement: unknown): void {
  let current = value as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) current = current[key] as Record<string | number, unknown>;
  current[path.at(-1)!] = replacement;
}
const mutations: ((ops: unknown[]) => void)[] = [
  ops => set(ops, [0, "cond", "sel", "filter", "powerMax"], 25000),
  ops => set(ops, [0, "cond", "sel", "filter", "type"], "UNISON"),
  ops => set(ops, [0, "then", 0, "chooser"], "you"),
  ops => set(ops, [0, "then", 0, "counterArrivalPolicy"], "eachQualifyingPlayV0"),
  ops => set(ops, [0, "then", 0, "modes"], []),
  ops => set(ops, [0, "then", 0, "modes", 0, "ops", 0, "instead"], "hand"),
  ops => set(ops, [0, "then", 0, "modes", 1, "ops", 0, "sel", "upTo"], true),
  ops => set(ops, [0, "then", 0, "modes", 1, "ops", 0, "chooser"], "you"),
  ops => set(ops, [0, "then", 0, "modes", 1, "ops", 1, "target", "var"], "unrelated"),
  ops => set(ops, [0, "else"], [{ op: "draw", n: 1 }]),
  ops => { ops.push({ op: "draw", n: 1 }); },
];
for (const mutate of mutations) {
  const altered = copy(original);
  mutate(altered);
  assert.equal(counterArrivalDescriptor(altered), undefined);
  assert.match(counterArrivalPolicyProblem(altered) ?? "", /rebuild/);
  cases++;
}
const ordinary = [{ op: "chooseMode", modes: [{ label: "draw", ops: [{ op: "draw", n: 1 }] }] }];
assert.equal(counterArrivalDescriptor(ordinary), undefined);
assert.equal(counterArrivalPolicyProblem(ordinary), null);
cases++;
const cards = { first: { zoneEpoch: 3 }, second: { zoneEpoch: 8 } };
const batch = captureCounterArrivalBatch(4, ["first", "second"], cards, { source: "parent", master: "p1", operation: { op: "play", target: { var: "picked" } }, options: { player: "p1" } });
assert.equal(counterArrivalBatchProblem(copy(batch), 4), null);
assert.deepEqual(currentCounterArrival(batch, cards), { card: "first", epoch: 3, current: true });
cards.first.zoneEpoch++;
assert.equal(currentCounterArrival(batch, cards)?.current, false);
batch.cursor++;
assert.deepEqual(currentCounterArrival(batch, cards), { card: "second", epoch: 8, current: true });
batch.cursor++;
assert.equal(currentCounterArrival(batch, cards), null);
cases++;
for (const malformed of [null, { ...batch, version: 0 }, { ...batch, owner: 5 }, { ...batch, cursor: -1 },
  { ...batch, cursor: 3 }, { ...batch, cards: "first" },
  { ...batch, cards: [{ card: "first", epoch: -1 }] },
  { ...batch, cards: [batch.cards[0], batch.cards[0]] }]) {
  assert.ok(counterArrivalBatchProblem(malformed, 4));
  cases++;
}
const frame: ScriptFrame = {
  card: "counter", master: "p2", skillIndex: 0, ops: copy(original), ip: 0, vars: { paid: ["oldPayer"] },
  counterPlay: true, counterSource: { version: 1, card: "counter", epoch: 4 },
  counterDeclaredScript: { version: 1, card: "counter", skillIndex: 0, kind: "counter:play", script: { kind: "counter:play", ops: copy(original), unsupported: [] } },
  afterSkillSource: "counter", afterSkillKeywords: ["Villainous"],
};
// Protocol-only poison fields prove the allowlist cannot replay original settlement.
Object.assign(frame, { counterMotion: { opened: true }, counterCost: { paid: true }, counterActivation: { version: 1 }, taxGate: { guards: 1 } });
const template = captureCounterArrivalTemplate(frame, 2, 0);
assert.ok(template);
assert.equal(counterArrivalTemplateProblem(template, 1, 0), null);
const execution = counterArrivalExecutionFrame(template, 3);
for (const key of ["counterMotion", "counterCost", "counterActivation", "afterSkillSource", "afterSkillKeywords", "taxGate"]) assert.equal(key in execution, false);
assert.equal(execution.counterDeclaredScript?.script.kind, "counter:play");
assert.equal(execution.skillEffectOrigin?.scope, 3);
execution.vars.paid.push("newPayer");
assert.deepEqual(template.vars.paid, ["oldPayer"]);
assert.deepEqual(counterArrivalExecutionFrame(template, 4).vars.paid, ["oldPayer"]);
cases++;
for (const malformed of [
  { ...template, id: 1 }, { ...template, at: 1 }, { ...template, sourceEpoch: -1 },
  { ...template, state: "running" }, { ...template, active: { version: 1 } },
  { ...template, vars: { paid: "oldPayer" } },
]) {
  assert.ok(counterArrivalTemplateProblem(malformed, 1, 0));
  cases++;
}
const printed = "[Counter: Play] You can activate this skill if your opponent declares they're playing a Battle Card with 20000 power or less. Your opponent may place that Battle Card in their Drop Area instead of playing it. If they don't, they choose 1 of their Battle Cards and place it in its owner's Drop Area.";
const skill = parseSkills(printed)[0];
const reading = compileCounterArrival(skill);
assert.ok(reading);
assert.equal(reading.keepResolutionCondition, true);
assert.deepEqual(counterArrivalDescriptor(reading.ops), { version: 1, policy: "eachQualifyingPlayV1" });
assert.equal(compileCounterArrival(parseSkills(printed.replaceAll("'", "’"))[0])?.keepResolutionCondition, true);
cases++;
for (const alternate of [printed.replace("20000", "25000"), printed.replace("Counter: Play", "Counter: Attack"),
  printed.replace("they choose 1", "they choose 2"), printed + " Draw 1 card.",
  printed.replace("they choose 1", "you choose 1")]) {
  assert.equal(compileCounterArrival(parseSkills(alternate)[0]), null);
  cases++;
}
assert.equal(compileCounterArrival({ ...skill, cost: "If your Leader Card is red" }), null);
cases++;
assert.equal(programProblem(original), null);
const rule: Rule = { kind: "counter:play", trigger: [], cost: null, cond: null, ops: original };
const parsed = parseRule(printRule(rule));
assert.ok(parsed.ok);
if (!parsed.ok) throw new Error("policy DSL parse failed");
assert.ok(deepEqual(parsed.value, rule));
assert.ok(counterArrivalDescriptor(parsed.value.ops));
cases++;
assert.match(programProblem([{ op: "delay", at: "endTurn", ops: original }]) ?? "", /per-arrival/);
cases++;
const stored = skillRecords(card("DB2-030", { type: "EXTRA", colors: ["Red"], energyCost: 2, skill: printed }))[0];
assert.equal(stored.kind, "counter:play");
assert.equal(stored.cond, null, "qualification stays per arrival, not an admission gate");
assert.deepEqual(stored.unread, []);
assert.ok(counterArrivalDescriptor(stored.ops));
assert.match(stored.printed, /You can activate this skill if your opponent declares/);
for (const status of ["draft", "confirmed", "corrected", "rejected"]) {
  for (const fault of ["policy", "condition"]) {
    const old = copy(stored);
    if (fault === "policy") set(old.ops, [0, "then", 0, "counterArrivalPolicy"], undefined);
    else old.cond = { kind: "count", sel: { special: "resolving" }, atLeast: 1 };
    const loaded = rulesFromRows([{ ...old, id: 435, source: "compiler", status } as unknown as RuleRow], { "DB2-030": card("DB2-030", { type: "EXTRA", skill: printed }) });
    assert.match(loaded["DB2-030"].bySkill[0].unsupported.join(" "), /per-arrival optional Counter policy/);
    cases++;
  }
}

cases++;
const parentChoose: Op = { op: "choose", sel: { side: "you", area: "hand", count: 8, upTo: true, differentNames: true }, as: "incoming" };
const parentPlay: Op = { op: "play", target: { var: "incoming" } };
assert.equal(counterArrivalParentProblem([parentChoose, parentPlay]), null);
assert.equal(counterArrivalParentProblem([{ op: "play", target: { sel: { special: "self" } } }]), null);
assert.equal(counterArrivalParentProblem([{ op: "delay", at: "turnEnd", ops: [parentPlay] }]), null, "future bodies own their later scope");
cases += 3;
for (const body of [
  [{ op: "play", target: { sel: { side: "you", area: "hand", count: 1 } } }],
  [{ ...parentChoose, sel: { side: "you", area: "hand", count: 8 } }, parentPlay],
  [{ ...parentChoose, sel: { side: "you", area: "hand", count: 8, upTo: true, take: 8 } }, parentPlay],
  [parentChoose, { op: "mill", n: 2, as: "incoming" }, parentPlay],
  [parentChoose, { op: "may", ops: [{ ...parentChoose, sel: { side: "you", area: "drop", count: 8 } }] }, parentPlay],
  [parentChoose, { ...parentPlay, onto: { sel: { special: "self" } } }],
] as Op[][]) {
  assert.ok(counterArrivalParentProblem(body));
  cases++;
}
console.log(`counter-arrival-contract-5: ${cases} isolated reader/policy/batch/template cases passed`);
