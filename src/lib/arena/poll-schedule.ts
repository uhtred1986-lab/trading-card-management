/**
 * How often the server looks at the database while it holds a long-poll open,
 * and how often the 1 v 1 waiting room asks whether the guest has joined
 * (issue #377). Pure — no database — so `verify-arena.ts` can assert it and
 * a client component can import it.
 *
 * Latency matters in the first seconds after a client asks (Claude's next
 * beat is usually already on its way), so the row is read every 400 ms for
 * the first 2 s and then every 1.2 s: a move that lands late in the window
 * is seen at most ~1.2 s after it was written.
 */
export const FAST_POLL_MS = 400;
export const FAST_POLL_WINDOW_MS = 2_000;
export const SLOW_POLL_MS = 1_200;

/** The pause before the next look, `elapsedMs` into a long-poll. */
export function longPollStepMs(elapsedMs: number): number {
  return elapsedMs < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : SLOW_POLL_MS;
}

/**
 * Every pause of a long-poll of `totalMs`, in order. The last one is clipped
 * so they sum to exactly `totalMs` — a wait never runs past its deadline.
 */
export function longPollSchedule(totalMs: number): number[] {
  const steps: number[] = [];
  let elapsed = 0;
  while (elapsed < totalMs) {
    const step = Math.min(longPollStepMs(elapsed), totalMs - elapsed);
    steps.push(step);
    elapsed += step;
  }
  return steps;
}

export const WAITING_ROOM_MS = 2_500;
export const WAITING_ROOM_SLOW_AFTER_MS = 30_000;
export const WAITING_ROOM_SLOW_MS = 5_000;

/** The pause before the waiting room's next ask, `elapsedMs` after it opened. */
export function waitingRoomStepMs(elapsedMs: number): number {
  return elapsedMs < WAITING_ROOM_SLOW_AFTER_MS ? WAITING_ROOM_MS : WAITING_ROOM_SLOW_MS;
}
