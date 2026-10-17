import assert from "node:assert/strict";
import type { Beat } from "../../src/lib/arena/beats";
import { NOTHING_TO_SHOW, PHASE_BEAT_MS, SLOW_FACTOR, STEP_BANNER_MS, TIER, fxScale, msFor, phaseBanner, stepBannerMs, turnBannerMs } from "../../src/components/arena/stage/motion";

// The three dwell tiers of a fight (owner's report, 17 Oct 2026: "some things go fast some slow").
const draw: Beat = { t: "draw", player: "p2", card: null };
const charge: Beat = { t: "move", card: "a", from: "hand", to: "energy", owner: "p2" };
const rest: Beat = { t: "mode", card: "a", mode: "rest" };
const play: Beat = { t: "move", card: "a", from: "hand", to: "battle", owner: "p2" };
const attack: Beat = { t: "attack", attacker: "a", target: "b" };
const clash: Beat = { t: "clash", attacker: "a", guard: "b", attackPower: 2000, guardPower: 10000, hit: false };
const damage: Beat = { t: "damage", player: "p1", amount: 1, critical: false, cards: [] };

assert.equal(msFor(charge), TIER.bookkeeping);
assert.equal(msFor(draw), NOTHING_TO_SHOW, "a draw marker has nothing of its own to show");
assert.ok(msFor(rest) < TIER.bookkeeping);
for (const b of [play, attack]) assert.equal(msFor(b), TIER.key, `${b.t} is a key moment`);
for (const b of [clash, damage]) assert.equal(msFor(b), TIER.decisive, `${b.t} is decisive`);
assert.ok(TIER.bookkeeping >= 350 && TIER.bookkeeping <= 500);
assert.ok(TIER.key >= 1100 && TIER.key <= 1500);
assert.ok(TIER.decisive >= 1500 && TIER.decisive <= 2000);

// A run of the same bookkeeping is grouped; a different kind is not.
assert.ok(msFor(charge, "normal", 0, charge) < msFor(charge));
assert.equal(msFor(charge, "normal", 0, draw), TIER.bookkeeping);

// Slow is a gentle multiplier with no floor; decisive beats are never hurried by a long chain.
assert.equal(msFor(charge, "slow"), Math.round(TIER.bookkeeping * SLOW_FACTOR));
assert.ok(SLOW_FACTOR > 1 && SLOW_FACTOR <= 1.5);
assert.equal(fxScale("slow"), SLOW_FACTOR);
assert.equal(msFor(clash, "normal", 9), TIER.decisive);
assert.equal(msFor(clash, "step"), msFor(clash));

// Banners: the phase beat is held as long as its banner; a battle step or skipped phase is a marker.
const main: Beat = { t: "phase", phase: "main", player: "p2", turn: 2 };
const defense: Beat = { t: "phase", phase: "defense", player: "p2", turn: 2 };
assert.equal(phaseBanner(main as Extract<Beat, { t: "phase" }>), "phase:main");
assert.equal(phaseBanner(defense as Extract<Beat, { t: "phase" }>), null);
assert.equal(msFor(main), PHASE_BEAT_MS);
assert.ok(PHASE_BEAT_MS < STEP_BANNER_MS, "the chip outlasts its beat and overlaps what follows");
assert.equal(msFor(defense), NOTHING_TO_SHOW);
assert.equal(stepBannerMs("slow"), Math.round(STEP_BANNER_MS * SLOW_FACTOR));
assert.ok(turnBannerMs("slow") > turnBannerMs("normal"));

// The tutorial opponent's turn, replayed through msFor: from the turn banner to the first
// meaningful moment (the card it plays), at the default slow pace.
{
  const { createPracticeSession } = await import("../../src/lib/arena/tutorial/session");
  const session = createPracticeSession();
  let snap = session.getSnapshot();
  await session.act(snap.legal.find((x) => x.action.type === "charge" && x.action.card === null)!.action, snap.game.revision, "skip");
  snap = session.getSnapshot();
  await session.act(snap.legal.find((x) => x.action.type === "endMain")!.action, snap.game.revision, "end");
  await session.advance();
  const list = session.getSnapshot().beats!.list.filter((b) => b.n > (snap.beats?.seq ?? 0));
  const open = list.findIndex((b) => b.t === "phase" && b.turn === 2);
  const first = list.findIndex((b) => b.t === "move" && b.from === "hand" && b.to === "battle");
  assert.ok(open >= 0 && first > open, "the opponent's turn opens, then plays a card");
  let lead = 0;
  for (let i = open; i < first; i++) lead += msFor(list[i], "slow", 0, list[i + 1] ?? null);
  assert.ok(lead <= 2500, `turn banner to first play is ${lead} ms`);
}

console.log("arena-pacing: ok");
