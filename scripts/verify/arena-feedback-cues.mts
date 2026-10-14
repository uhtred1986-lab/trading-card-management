import assert from "node:assert/strict";
import { feedbackAfter, feedbackFromBeats } from "../../src/components/arena/stage/useFeedbackCues";
import { fxDuration, fxVars } from "../../src/components/arena/stage/motion";
import type { Beats } from "../../src/lib/arena/beats";

const beats: Beats = {
  seq: 6,
  art: {},
  list: [
    { n: 1, t: "attack", attacker: "p1#4", target: "p2#1" },
    { n: 2, t: "clash", attacker: "p1#4", guard: "p2#1", attackPower: 20000, guardPower: 15000, hit: true },
    { n: 3, t: "clash", attacker: "p1#6", guard: "p2#3", attackPower: 15000, guardPower: 20000, hit: false },
    { n: 4, t: "damage", player: "p2", amount: 2, critical: false, cards: ["p2#8", "p2#9"], by: "p1#4" },
    { n: 5, t: "ko", card: "p2#3", owner: "p2" },
    { n: 6, t: "phase", phase: "Battle", player: "p1", turn: 2 },
  ],
};

assert.deepEqual(feedbackFromBeats(beats.list), {
  cards: {
    "p1#4": { kind: "attacker", beat: 1, text: "Attacking", player: null },
    "p2#1": { kind: "hit", beat: 2, text: "Hit", player: null },
    "p2#3": { kind: "ko", beat: 5, text: "Knocked out", player: "p2" },
    "p1#6": { kind: "attacker", beat: 3, text: "Attacking", player: null },
  },
  life: {
    p2: { beat: 4, amount: 2, by: "p1#4", text: "−2 LIFE" },
  },
  phase: { beat: 6, phase: "Battle", player: "p1", text: "Battle" },
});

assert.equal(feedbackAfter(beats, 0).cards["p2#3"]?.kind, "ko", "a newly arrived KO is not identified");
assert.deepEqual(feedbackAfter(beats, beats.seq), { cards: {}, life: {}, phase: null }, "the initial snapshot replays historical feedback");
assert.equal(feedbackFromBeats([{ n: 3, t: "clash", attacker: "a", guard: "held", attackPower: 1, guardPower: 2, hit: false }]).cards.held?.kind, "held", "a held clash lacks its distinct defender cue");
for (const pace of ["normal", "slow"] as const) {
  for (const [name, duration] of Object.entries(fxVars(pace))) {
    assert.ok(Number.parseInt(duration, 10) < 700, `${name} runs longer than the effect budget at ${pace} pace`);
  }
}
assert.ok(fxDuration(780, "slow") < 700, "the slow-pace KO flight delay exceeds the effect budget");
console.log("arena-feedback-cues: ok");
