import assert from "node:assert/strict";
import { CENTRING, escapeAnswer, isCentredDecision } from "../../src/lib/arena/centred-decision";

const ctx = { yours: true, playing: false, over: false, searchSheet: false, playable: true };

// The defence windows, the card choices and the yes/no questions are centred...
for (const kind of ["counter", "blocker", "combo", "charge", "chooseCards", "chooseMode", "optionalCost", "payCost", "mulligan", "chooseFirst", "empowerCarry", "offering"]) {
  assert.equal(isCentredDecision(kind, ctx), true, `${kind} is centred`);
}
// ...the free Main phase and the referee are not.
for (const kind of ["main", "referee", "gameOver", "nonsense"]) assert.equal(isCentredDecision(kind, ctx), false, `${kind} stays put`);
// Only the viewer's own question, once the beats have played, and never a hidden-zone search sheet twice.
assert.equal(isCentredDecision("counter", { ...ctx, yours: false }), false);
assert.equal(isCentredDecision("counter", { ...ctx, playing: true }), false);
assert.equal(isCentredDecision("counter", { ...ctx, over: true }), false);
assert.equal(isCentredDecision("counter", { ...ctx, playable: false }), false);
assert.equal(isCentredDecision("chooseCards", { ...ctx, searchSheet: true }), false);
assert.equal(isCentredDecision("counter", { ...ctx, searchSheet: true }), true);
assert.ok(Object.values(CENTRING).every((r) => r.why.length > 8), "every kind says why");

// Escape passes only where passing is a legal answer.
const p = "p1" as const;
assert.deepEqual(escapeAnswer([{ type: "counter", player: p, card: "p1#3" }, { type: "counter", player: p, card: null }]), { type: "counter", player: p, card: null });
assert.deepEqual(escapeAnswer([{ type: "pass", player: p }]), { type: "pass", player: p });
assert.deepEqual(escapeAnswer([{ type: "choose", player: p, cards: [] }]), { type: "choose", player: p, cards: [] });
assert.equal(escapeAnswer([{ type: "counter", player: p, card: "p1#3" }]), null, "no pass offered: Escape does not answer");
assert.equal(escapeAnswer([{ type: "chooseMode", player: p, index: 0 }]), null);
assert.equal(escapeAnswer([{ type: "endMain", player: p }]), null, "end turn is never an Escape answer");
console.log("arena-centred-decisions: ok");
