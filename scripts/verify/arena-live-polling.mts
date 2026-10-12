import assert from "node:assert/strict";
import type { Snapshot } from "../../src/lib/arena/snapshot";
import { startLiveGamePolling } from "../../src/components/arena/stage/liveGamePolling";

class Source {
  online = true;
  visible = true;
  listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

class Timers {
  nextId = 1;
  pending = new Map<number, () => void>();
  delays: number[] = [];
  cleared = 0;
  set = ((fn: () => void, delay = 0) => {
    const id = this.nextId++;
    this.pending.set(id, fn);
    this.delays.push(Number(delay));
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  clear = ((id: ReturnType<typeof setTimeout>) => {
    if (this.pending.delete(id as unknown as number)) this.cleared++;
  }) as typeof clearTimeout;
  runNext() {
    const [id, fn] = this.pending.entries().next().value ?? [];
    assert.ok(fn, "expected a scheduled poll");
    this.pending.delete(id as number);
    fn();
  }
}

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const snapshot = (revision: number, status = "playing"): Snapshot => ({
  contract: 2,
  game: { id: 42, revision, mode: "versus", engine: "legacy", game: { id: "dbz", name: "Dragon Ball Z" }, status, turn: 3, p1Name: "A", p2Name: "B", you: "p1" },
  view: {} as Snapshot["view"], legal: [], taps: {} as Snapshot["taps"], beats: { seq: 0, items: [] } as unknown as Snapshot["beats"],
  spotlight: null, log: [], waiting: status === "playing" ? "opponent" : null,
  spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 }, over: null,
} as unknown as Snapshot);
const response = (value: Snapshot) => ({ ok: true, status: 200, json: async () => value }) as Response;

// Going offline aborts the outstanding long poll. Foreground/online forces a
// fresh read, and terminal row revision is delivered before polling stops.
{
  const source = new Source();
  const calls: Array<{ signal: AbortSignal; resolve(value: Response): void }> = [];
  const updates: Snapshot[] = [];
  const states: string[] = [];
  const poller = startLiveGamePolling({
    gameId: 42, revision: 2, beat: 0, source,
    fetcher: (_url, init) => new Promise((resolve) => calls.push({ signal: init!.signal as AbortSignal, resolve })),
    onSnapshot: (value) => updates.push(value), onConnection: (value) => states.push(value),
  });
  await tick();
  assert.equal(calls.length, 1);
  source.online = false;
  source.emit("offline");
  assert.equal(calls[0].signal.aborted, true);
  assert.equal(states.at(-1), "offline");
  source.online = true;
  source.visible = false;
  source.emit("online");
  assert.equal(calls.length, 1, "offline foreground must not poll while hidden");
  source.visible = true;
  source.emit("visibilitychange");
  await tick();
  assert.equal(calls.length, 2, "foreground must immediately reread");
  calls[1].resolve(response(snapshot(9, "abandoned")));
  await tick();
  assert.equal(updates.at(-1)?.game.revision, 9);
  assert.equal(updates.at(-1)?.game.status, "abandoned");
  calls[0].resolve(response(snapshot(3, "abandoned")));
  await tick();
  assert.equal(updates.length, 1, "a transport that resolves after abort cannot apply a late stale snapshot");
  assert.equal(updates[0]?.game.revision, 9);
  poller.stop();
}

// Unmount aborts an in-flight request and removes every lifecycle listener;
// if a failure already scheduled a retry, it cancels that timer too.
{
  const source = new Source();
  const timers = new Timers();
  const signals: AbortSignal[] = [];
  const late: Array<(value: Response) => void> = [];
  let snapshots = 0;
  const poller = startLiveGamePolling({
    gameId: 42, revision: 2, beat: 0, source, setTimer: timers.set, clearTimer: timers.clear,
    fetcher: (_url, init) => { signals.push(init!.signal as AbortSignal); return new Promise((resolve) => late.push(resolve)); },
    onSnapshot: () => { snapshots++; }, onConnection: () => {},
  });
  await tick();
  poller.stop();
  assert.equal(signals[0]?.aborted, true);
  assert.equal(source.listenerCount(), 0);
  assert.equal(timers.pending.size, 0);
  late[0](response(snapshot(20, "abandoned")));
  await tick();
  assert.equal(snapshots, 0, "a stopped request cannot apply a late snapshot");

  const scheduledSource = new Source();
  const scheduledTimers = new Timers();
  const scheduled = startLiveGamePolling({
    gameId: 42, revision: 2, beat: 0, source: scheduledSource,
    setTimer: scheduledTimers.set, clearTimer: scheduledTimers.clear,
    fetcher: async () => { throw new Error("offline"); }, onSnapshot: () => {}, onConnection: () => {},
  });
  await tick();
  assert.equal(scheduledTimers.pending.size, 1);
  scheduled.stop();
  assert.equal(scheduledTimers.pending.size, 0);
  assert.equal(scheduledTimers.cleared, 2, "stop clears both the request deadline and scheduled retry");
}

// A lagging terminal response cannot stop the poller, and a response for a
// different game identity cannot replace the current game or advance cursors.
{
  const source = new Source();
  const timers = new Timers();
  const updates: Snapshot[] = [];
  let calls = 0;
  const poller = startLiveGamePolling({
    gameId: 42, revision: 9, beat: 0, source, baseDelayMs: 10, maxDelayMs: 40,
    setTimer: timers.set, clearTimer: timers.clear,
    fetcher: async () => {
      calls++;
      if (calls === 1) return response(snapshot(8, "abandoned"));
      if (calls === 2) {
        const wrongGame = snapshot(99);
        wrongGame.game.id = 84;
        return response(wrongGame);
      }
      return response(snapshot(10, "abandoned"));
    },
    onSnapshot: (value) => updates.push(value), onConnection: () => {},
  });
  await tick();
  assert.equal(updates.length, 0, "lower revision is ignored");
  assert.equal(timers.pending.size, 1, "stale terminal response leaves a retry scheduled");
  timers.runNext();
  await tick();
  assert.equal(updates.length, 0, "cross-game response is rejected before reconciliation");
  assert.equal(timers.pending.size, 1);
  timers.runNext();
  await tick();
  assert.equal(calls, 3);
  assert.equal(updates[0]?.game.id, 42);
  assert.equal(updates[0]?.game.revision, 10);
  poller.stop();
}

// A healthy-looking but stalled long poll has a deadline beyond the server's
// 15s wait. It aborts and retries even when the transport ignores AbortSignal.
{
  const source = new Source();
  const timers = new Timers();
  const calls: Array<{ signal: AbortSignal; resolve(value: Response): void }> = [];
  const states: string[] = [];
  const updates: Snapshot[] = [];
  const poller = startLiveGamePolling({
    gameId: 42, revision: 2, beat: 0, source, requestTimeoutMs: 25, baseDelayMs: 8, maxDelayMs: 32,
    setTimer: timers.set, clearTimer: timers.clear,
    fetcher: (_url, init) => new Promise((resolve) => calls.push({ signal: init!.signal as AbortSignal, resolve })),
    onSnapshot: (value) => updates.push(value), onConnection: (value) => states.push(value),
  });
  await tick();
  assert.equal(calls.length, 1);
  assert.deepEqual(timers.delays, [25], "deadline exceeds the endpoint's wait=15 long-poll window");
  timers.runNext();
  await tick();
  assert.equal(calls[0]?.signal.aborted, true, "deadline aborts the stalled request");
  assert.equal(states.at(-1), "reconnecting");
  assert.equal(timers.pending.size, 1, "deadline schedules a bounded retry instead of leaving a connected stall");
  calls[0]?.resolve(response(snapshot(99, "abandoned")));
  await tick();
  assert.equal(updates.length, 0, "late completion from a timed-out request is ignored");
  timers.runNext();
  await tick();
  assert.equal(calls.length, 2);
  calls[1]?.resolve(response(snapshot(10, "abandoned")));
  await tick();
  assert.equal(updates.at(-1)?.game.revision, 10, "a later request recovers the current game");
  assert.equal(states.at(-1), "connected");
  assert.equal(timers.pending.size, 0);
  poller.stop();
}

// Repeated failures continue at a capped delay. Retry bypasses that delay and
// a successful read recovers the state, including terminal rows.
{
  const source = new Source();
  const timers = new Timers();
  const states: string[] = [];
  const updates: Snapshot[] = [];
  let calls = 0;
  const poller = startLiveGamePolling({
    gameId: 42, revision: 2, beat: 0, source,
    baseDelayMs: 10, maxDelayMs: 25, setTimer: timers.set, clearTimer: timers.clear,
    fetcher: async () => {
      calls++;
      if (calls < 4) throw new Error("temporary");
      return response(snapshot(10, "abandoned"));
    },
    onSnapshot: (value) => updates.push(value), onConnection: (value) => states.push(value),
  });
  await tick();
  const retryDelays = () => timers.delays.filter((delay) => delay < 1_000);
  assert.deepEqual(retryDelays(), [10]);
  timers.runNext();
  await tick();
  assert.deepEqual(retryDelays(), [10, 20]);
  timers.runNext();
  await tick();
  assert.deepEqual(retryDelays(), [10, 20, 25], "backoff is capped");
  assert.equal(states.at(-1), "reconnecting");
  poller.retry();
  await tick();
  assert.equal(timers.pending.size, 0, "manual Retry bypasses the backoff timer");
  assert.equal(calls, 4);
  assert.equal(updates.at(-1)?.game.revision, 10);
  assert.equal(states.at(-1), "connected");
  poller.stop();
}

console.log("arena live polling lifecycle: offline/foreground refresh, abort/deadline/cleanup, capped recovery/Retry PASS");
