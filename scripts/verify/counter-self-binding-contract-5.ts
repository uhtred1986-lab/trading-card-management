/** R465 helper contract only; native wiring follows the shared payment handoff. */
import assert from "node:assert/strict";
import { stepScript } from "../../src/lib/arena/vm/script";
import type { ScriptHost } from "../../src/lib/arena/vm/script-host";
import {
  counterNeedsSelfBinding, counterSelfPlayAllowed, newCounterSelfChoices,
  prepareCounterSelfBinding, requireCounterSelfBinding, counterSelfTaxBinding, guardCounterSelfTaxPayment,
} from "../../src/lib/arena/vm/counter-self-binding";
import type { VmState } from "../../src/lib/arena/vm/state";
import type { CounterSelfChoices } from "../../src/lib/arena/vm/counter-self-binding";
import type { Op, Script, ScriptFrame } from "../../src/lib/arena/vm/script";

const choose: Op = { op: "choose", sel: { special: "self" }, as: "self" };
const play: Op = { op: "play", target: { var: "self" } };
const ops = [choose, play];
type Frame = ScriptFrame & { counterSelfChoices?: CounterSelfChoices };
const fresh = (): Frame => ({
  ops, ip: 0, vars: {}, card: "source", master: "p1", skillKind: "counter",
  counterSource: { version: 1, card: "source", epoch: 7 },
  counterSelfChoices: newCounterSelfChoices(ops),
});
let cases = 0;
for (const body of [ops, [{ op: "if", cond: { kind: "leaderColor", color: "Blue" }, then: ops }] as Op[], [{ op: "may", ops }] as Op[]]) {
  assert.equal(counterNeedsSelfBinding(body), true);
  cases++;
}
assert.equal(counterNeedsSelfBinding([{ op: "delay", at: "turnEnd", ops }]), false);
assert.equal(counterNeedsSelfBinding([{ op: "play", target: { sel: { special: "self" } } }]), true);
assert.equal(counterNeedsSelfBinding([{ op: "chooseMode", modes: [{ label: "Play", ops }, { label: "Pass", ops: [] }] }]), true);
cases += 3;
const f = fresh();
prepareCounterSelfBinding(f, choose);
f.vars.self = ["source"];
assert.equal(counterSelfPlayAllowed(f, { var: "self" }, "source", 7, "drop"), true);
assert.equal(counterSelfPlayAllowed(f, { var: "self" }, "source", 9, "drop"), false);
assert.equal(counterSelfPlayAllowed(f, { var: "self" }, "source", 7, "hand"), false);
cases += 3;
// Ordinary writers kill provenance even when they return the same physical ID.
for (const writer of [
  { op: "choose", sel: { side: "you", area: "drop" }, as: "self" },
  { op: "look", n: 1, as: "self" },
  { op: "reveal", sel: { side: "you", area: "drop" }, as: "self" },
  { op: "mill", n: 1, as: "self" },
  { op: "moveTo", target: { var: "other" }, to: "drop", as: "self" },
] as Op[]) {
  const overwritten = structuredClone(f);
  prepareCounterSelfBinding(overwritten, writer);
  overwritten.vars.self = ["source"];
  assert.equal(counterSelfPlayAllowed(overwritten, { var: "self" }, "source", 9, "drop"), true);
  assert.equal(counterNeedsSelfBinding([choose, writer, play]), false);
  cases++;
}
for (const fault of ["missing", "version", "source", "vars", "entry"]) {
  const old = structuredClone(f);
  old.ops = [play]; // The self chooser was already executed before this save.
  if (fault === "missing") delete old.counterSelfChoices;
  if (fault === "version") old.counterSelfChoices!.version = 0 as 1;
  if (fault === "source") delete old.counterSource;
  if (fault === "vars") old.counterSelfChoices!.vars = [] as unknown as CounterSelfChoices["vars"];
  if (fault === "entry") old.counterSelfChoices!.vars.self.epoch = 99;
  assert.throws(() => requireCounterSelfBinding(old, { ops } as Script), /rebuild/);
  if (fault !== "missing") assert.throws(() => counterSelfPlayAllowed(old, { var: "self" }, "source", 7, "drop"), /rebuild/);
  cases++;
}
const unrelated = fresh();
delete unrelated.counterSelfChoices;
unrelated.ops = [{ op: "draw", n: 1 }];
assert.doesNotThrow(() => requireCounterSelfBinding(unrelated, undefined));
const price = fresh();
delete price.counterSelfChoices;
price.saveVarsAs = "paid";
assert.doesNotThrow(() => requireCounterSelfBinding(price, { ops } as Script));
assert.equal(counterSelfPlayAllowed(price, { sel: { special: "self" } }, "source", 9, "drop"), true);
cases += 3;
const malformed = structuredClone(f);
malformed.vars.self = "source" as unknown as string[];
assert.throws(() => counterSelfPlayAllowed(malformed, { var: "self" }, "source", 7, "drop"), /rebuild/);
cases++;
// Interpreter controls model a saved tax boundary; native lifecycle coverage is separate.
for (const stage of ["offer", "paid"] as const) {
  const saved = structuredClone(f);
  saved.ops = [play, { op: "draw", n: 1 }];
  saved.awaiting = stage === "offer" ? "playTax" : undefined;
  saved.vars["§playTaxAsked"] = ["source"];
  saved.vars["§playTaxPaid"] = stage === "paid" ? ["source"] : [];
  let mode: number | undefined = stage === "offer" ? 0 : undefined;
  const hand: string[] = [];
  const host = {
    zoneEpoch: () => 9,
    areaOf: () => "drop",
    resolveRef: () => ["source"],
    lastMode: () => mode,
    clearLastMode: () => { mode = undefined; },
    zone: () => hand.slice(),
    amount: (_frame: ScriptFrame, amount: number) => amount,
    draw: () => { hand.push("drawn"); },
    playThen: () => { assert.fail("a fresh source occurrence must not be played"); },
  } as unknown as ScriptHost;
  assert.equal(stepScript(host, saved), "done");
  assert.equal(mode, undefined);
  assert.equal(saved.awaiting, undefined);
  assert.equal(saved.vars["§playTaxAsked"], undefined);
  assert.equal(saved.vars["§playTaxPaid"], undefined, "a stale tax receipt must not exempt a later independent play");
  assert.deepEqual(hand, ["drawn"], "the independent tail still resolves");
  cases++;
}
for (const fault of ["none", "source", "missing", "owner", "parent-binding", "malformed-receipt"] as const) {
  const parent = structuredClone(f);
  parent.ip = 1;
  parent.skillIndex = 0;
  parent.skillEffectOrigin = { version: 2, kind: "counter", scope: 7 };
  parent.vars["§playTaxPaid"] = ["source"];
  const child = { ops: [], ip: 0, vars: {}, card: "source", master: "p1" as const,
    counterSelfTax: counterSelfTaxBinding(parent, { var: "self" }),
  };
  const state = {
    programs: [parent], cards: { source: { id: "source", zoneEpoch: fault === "source" ? 9 : 7 } },
    nextSkillPlayScope: 7,
    skillPlayScopes: [{ version: 2, id: 7, source: "source", master: "p1", skillIndex: 0,
      phase: "effect", profile: { arrivals: 1, tokens: false, explicitWindow: false }, played: [], }],
    sides: { p1: { zones: { drop: ["source"] } } }, lastChoice: ["payer"], lastMode: 0,
  } as unknown as VmState;
  if (fault === "missing") delete child.counterSelfTax;
  if (fault === "owner") child.counterSelfTax!.parentScope = 99;
  if (fault === "parent-binding") delete parent.counterSelfChoices;
  if (fault === "malformed-receipt") parent.vars["§playTaxPaid"] = 7 as unknown as string[];
  const run = () => guardCounterSelfTaxPayment(state, child, () => ({ ops } as Script));
  if (fault === "missing" || fault === "owner" || fault === "parent-binding" || fault === "malformed-receipt") assert.throws(run, /rebuild/);
  else {
    assert.equal(run(), fault === "none");
    assert.equal(state.programs[0], parent, "canceling a tax child must preserve its Counter parent");
    if (fault === "source") {
      assert.equal(state.lastChoice, null);
      assert.equal(state.lastMode, null);
    }
  }
  cases++;
}
console.log(`counter-self-binding-contract-5: ${cases} helper contract cases passed`);
