/**
 * The long-poll and waiting-room back-off (issue #377) — pure, no database.
 */
import assert from "node:assert/strict";
import { FAST_POLL_MS, FAST_POLL_WINDOW_MS, SLOW_POLL_MS, WAITING_ROOM_MS, WAITING_ROOM_SLOW_AFTER_MS, WAITING_ROOM_SLOW_MS, longPollSchedule, longPollStepMs, waitingRoomStepMs } from "../../src/lib/arena/poll-schedule";

// 400 ms steps for the first 2 s, then the slower step.
assert.equal(longPollStepMs(0), FAST_POLL_MS);
assert.equal(longPollStepMs(FAST_POLL_WINDOW_MS - 1), FAST_POLL_MS);
assert.equal(longPollStepMs(FAST_POLL_WINDOW_MS), SLOW_POLL_MS);
assert.ok(SLOW_POLL_MS >= 1000 && SLOW_POLL_MS <= 1500, "the slow step is 1.0-1.5 s");

const fifteen = longPollSchedule(15_000);
assert.equal(fifteen.reduce((a, b) => a + b, 0), 15_000, "never more than the window in total");
assert.deepEqual(fifteen.slice(0, 5), [400, 400, 400, 400, 400], "five fast steps reach 2 s");
assert.ok(fifteen.slice(5).every((s, i, a) => s === SLOW_POLL_MS || i === a.length - 1), "then the slow step, last one clipped");
assert.ok(fifteen.every((s) => s > 0 && s <= SLOW_POLL_MS));
assert.ok(fifteen.length < 15_000 / FAST_POLL_MS / 2, "well under half the old 400 ms poll count");

// Short and degenerate windows never overrun.
assert.deepEqual(longPollSchedule(0), []);
assert.deepEqual(longPollSchedule(250), [250]);
for (const total of [1, 399, 401, 2_000, 2_001, 5_000, 30_000]) {
  assert.equal(longPollSchedule(total).reduce((a, b) => a + b, 0), total);
}

// Waiting room: 2.5 s, then 5 s after 30 s.
assert.equal(waitingRoomStepMs(0), WAITING_ROOM_MS);
assert.equal(waitingRoomStepMs(WAITING_ROOM_SLOW_AFTER_MS - 1), WAITING_ROOM_MS);
assert.equal(waitingRoomStepMs(WAITING_ROOM_SLOW_AFTER_MS), WAITING_ROOM_SLOW_MS);
