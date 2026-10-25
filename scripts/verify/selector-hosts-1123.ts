/** `scripts/lib/selector-hosts.ts` (#1123): finds the pre-#1123 selector host at any depth, and nothing else. */
import assert from "node:assert/strict";
import { hasSelectorHost, ruleIdOf } from "../lib/selector-hosts";

const sel = { sel: { side: "you", area: "battle", count: 1 } };
assert.equal(hasSelectorHost([{ op: "moveTo", target: { var: "c0" }, to: "under", under: sel }]), true, "a price with a selector host");
assert.equal(hasSelectorHost([{ op: "if", then: [{ op: "moveTo", target: { var: "c0" }, to: "under", under: sel }] }]), true, "nested in an effect");
assert.equal(hasSelectorHost([{ op: "moveTo", target: { var: "c0" }, to: "under", under: { var: "c1" } }]), false, "a chosen host (#1123 shape)");
assert.equal(hasSelectorHost([{ op: "moveTo", target: { var: "c0" }, to: "under" }]), false, "under this card");
assert.equal(hasSelectorHost([{ op: "moveTo", target: sel, to: "drop" }]), false, "a selector target that is not a host");
assert.equal(hasSelectorHost(null), false);
assert.equal(ruleIdOf({ cardId: "BT20-087", side: "front", skillIndex: 20 }), "BT20-087#20");
assert.equal(ruleIdOf({ cardId: "BT10-114", side: "back", skillIndex: 10 }), "BT10-114#10b");
console.log("verify/selector-hosts-1123: ok");
