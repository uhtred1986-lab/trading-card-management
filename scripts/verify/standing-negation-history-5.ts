/** R477 pure history prototype. No native card support is claimed. */
import assert from "node:assert/strict";
import { emptyStandingNegationHistory as empty, settleStandingNegation as settle, standingNegationAffects as affects, standingNegationSourceKey as key } from "../../src/lib/arena/vm/standing-negation-history";
import type { StandingNegationSource as Source, StandingNegationCandidate as Candidate, StandingNegationObservation as Observation } from "../../src/lib/arena/vm/standing-negation-history";
import type { PlayerId } from "../../src/lib/arena/types";
let cases = 0;
const test = (name: string, fn: () => void) => { fn(); cases++; console.log(`PASS ${name}`); };
const observe = (...candidates: Candidate[]): Observation => ({ version: 1, policy: "otherBattleWholeV1", candidates });
const candidate = (source: Source, targets: Source[] = [], enabled = true): Candidate => ({ source, targets, enabled });
for (const master of ["p1", "p2"] as PlayerId[]) {
  const a: Source = { card: "a", cardId: "DB1-066", epoch: 1, hiddenCount: 0, side: "front", master, skillIndex: 10, skillIdentity: "observed whole-other-Battle permanent" };
  const b: Source = { ...a, card: "b", cardId: "BT10-153", master: master === "p1" ? "p2" : "p1", skillIndex: 20 };
  const one = settle(empty(), observe(candidate(a)));
  const both = observe(candidate(b, [a]), candidate(a, [b]));
  const firstWins = settle(one, both);
  test(`${master}: first active source survives reverse enumeration`, () => {
    assert.deepEqual(firstWins.active, one.active);
    assert.equal(affects(firstWins, both, b), true);
    assert.equal(affects(firstWins, both, a), false);
  });
  const timed = observe(candidate(a, [b], false), candidate(b, [a]));
  const takeover = settle(firstWins, timed);
  test(`${master}: external timed negation lets second take over`, () => {
    assert.equal(takeover.active[0].source.card, "b"); assert.equal(takeover.active[0].serial, 2);
  });
  const restored = settle(takeover, both);
  test(`${master}: timer expiry does not let original reclaim`, () => {
    assert.deepEqual(restored.active, takeover.active); assert.equal(affects(restored, both, a), true);
  });
  test(`${master}: departure permits a new original-source generation`, () => {
    const back = settle(restored, observe(candidate(a)));
    assert.equal(back.active[0].serial, 3); assert.equal(back.nextSerial, 4);
  });
  for (const change of [{ epoch: 2 }, { hiddenCount: 1 }, { master: b.master }, { side: "back" as const }, { skillIndex: 30 }, { skillIdentity: "different record" }]) {
    test(`${master}: new occurrence ${JSON.stringify(change)} never reuses serial`, () => {
      const next = settle(one, observe(candidate({ ...a, ...change })));
      assert.equal(next.active[0].serial, 2);
    });
  }
  test(`${master}: query and transition do not mutate input`, () => {
    const original = JSON.stringify({ firstWins, both });
    for (let i = 0; i < 5; i++) affects(firstWins, both, b);
    settle(firstWins, both);
    assert.equal(JSON.stringify({ firstWins, both }), original);
    assert.deepEqual(settle(JSON.parse(JSON.stringify(firstWins)), both), firstWins);
  });
  test(`${master}: simultaneous fresh sources require explicit transaction order`, () => {
    assert.throws(() => settle(empty(), both), /proven mutation ordering/);
    assert.equal(settle(empty(), both, [key(a), key(b)]).active[0].source.card, "a");
    assert.equal(settle(empty(), both, [key(b), key(a)]).active[0].source.card, "b");
    assert.throws(() => settle(empty(), both, [key(a), key(a)]), /enabling order/);
  });
  test(`${master}: supplied arriving protection prevents edge, removed protection enables it`, () => {
    const protectedBoard = observe(candidate(a));
    assert.equal(affects(one, protectedBoard, b), false);
    const unprotected = observe(candidate(a, [b]));
    assert.equal(affects(settle(one, unprotected), unprotected, b), true);
  });
  test(`${master}: unsupported asymmetric protection transition refuses`, () => {
    assert.throws(() => settle(one, observe(candidate(a), candidate(b, [a]))), /reviewed protection transition/);
  });
  test(`${master}: stale and missing history refuse without mutation`, () => {
    assert.throws(() => affects(one, both, b), /not been settled/);
    assert.throws(() => affects(undefined, both, b), /rebuild affected/);
    assert.throws(() => settle(undefined, observe(candidate(a, [], false))), /rebuild affected/);
    assert.equal(affects(undefined, observe(), b), false);
  });
  test(`${master}: malformed or incomplete active history refuses`, () => {
    assert.throws(() => affects({ ...firstWins, active: [], suppressed: [] }, both, b), /no settled generation/);
    assert.throws(() => affects({ ...firstWins, suppressed: [] }, both, b), /suppression history/);
    assert.throws(() => affects({ ...firstWins, active: [...firstWins.active, ...firstWins.active] }, both, b), /active generations/);
    assert.throws(() => settle(empty(), observe(candidate(a, [a]))), /invalid all-other/);
    assert.throws(() => settle(empty(), observe(candidate(a), candidate(a))), /duplicate/);
    assert.throws(() => settle(empty(), observe(candidate(a, [{ ...b, epoch: 2 }]), candidate(b))), /mixes occurrences/);
  });
}
console.log(`standing-negation history prototype: ${cases} cases passed`);
