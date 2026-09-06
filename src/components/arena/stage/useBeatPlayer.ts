"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Beats, NumberedBeat } from "@/lib/arena/beats";
import type { PlayerId } from "@/lib/arena/engine";
import { feel } from "@/lib/arena/feel";
import type { Pace } from "@/lib/arena/pace";
import { anchorPoint, type Point } from "./anchors";
import { arrives, arrivesFrom, departs, feelFor, msFor } from "./motion";

export interface Ghost {
  key: number;
  card: string;
  /** Measured when the beat played: where it left, and where it is going. */
  from: Point;
  to: Point;
  /** Leaving the board for the Drop, or arriving from a pile with no card of its own. */
  kind: "leave" | "arrive";
  /** How long the flight has, so it matches the beat's dwell at the chosen pace. */
  ms: number;
}

export interface Playback {
  /** True while beats are still being played; the board is read-only then. */
  playing: boolean;
  /** Cards whose arrival has not happened yet, held back until it does. */
  suppressed: Set<string>;
  /** Cards that have already left the board, drawn on their way out. */
  ghosts: Ghost[];
  /**
   * The beat on screen right now, so the board can lunge the attacker, flash
   * the guard, spin an awakening leader. Null when nothing is playing.
   */
  current: NumberedBeat | null;
  /** Straight to the end state. Also what reduced motion does, at zero. */
  skip: () => void;
  /** In step mode: play the next beat. A no-op otherwise. */
  next: () => void;
  /** Where the story is: the beat on screen, and how many there are. */
  index: number;
  total: number;
}

const NOTHING: Set<string> = new Set();

/**
 * Plays what happened since you last acted.
 *
 * The server sends the board as it is *now*, so playing beats over it would
 * show a card in the Battle Area before the beat that put it there. Two sets
 * fix that, and the board reads both:
 *
 *   - `suppressed` — cards a beat has yet to bring in, held invisible until it
 *     does, at which point the layout animation flies them in.
 *   - `ghosts` — cards a beat has yet to take away. They are already gone from
 *     the board, so they are drawn from the face the beat carries.
 *
 * A reload does not replay: the first snapshot seen sets the mark, and only
 * beats numbered above it are ever played. That mark is why `clearBeats` keeps
 * the count when it empties the queue.
 */
export function useBeatPlayer(beats: Beats | null, enabled: boolean, hostRef: React.RefObject<HTMLDivElement | null>, pace: Pace = "normal", viewer: PlayerId = "p1"): Playback {
  const [queue, setQueue] = useState<NumberedBeat[]>([]);
  const [at, setAt] = useState(0);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  // Step mode: the walk waits here until `next()` lets it go on.
  const waiting = useRef<(() => void) | null>(null);
  // Read by the walk as it runs, so changing the pace mid-turn takes effect
  // from the next beat rather than restarting the story.
  const paceRef = useRef(pace);
  useEffect(() => {
    paceRef.current = pace;
  }, [pace]);
  // Null until the first render; then the highest beat number already seen.
  const [seen, setSeen] = useState<number | null>(null);

  const seq = beats?.seq ?? 0;

  // Adjusting state while rendering, because this is a change of props the
  // board must reflect immediately — React's own answer for it, and it keeps
  // the queue out of an effect, where setting it would cascade a render.
  if (seen === null) {
    setSeen(seq);
  } else if (seq > seen) {
    setSeen(seq);
    const fresh = enabled ? (beats?.list ?? []).filter((b) => b.n > seen) : [];
    setQueue(fresh);
    setAt(0);
    setGhosts([]);
  }

  const skip = useCallback(() => {
    setQueue([]);
    setAt(0);
    setGhosts([]);
    waiting.current?.();
    waiting.current = null;
  }, []);

  const next = useCallback(() => {
    waiting.current?.();
    waiting.current = null;
  }, []);

  // Walk the queue. Everything happens in a timer callback — the first tick
  // included — so the board paints the end state once before the story of how
  // it got there starts being told over the top of it.
  useEffect(() => {
    if (!queue.length) return;
    let cancelled = false;

    // The dwell after a beat: a timer at the chosen pace, or in step mode a
    // tap on Next. Skip resolves the wait too, so it never strands the walk.
    const dwell = (beat: NumberedBeat) => (paceRef.current === "step" ? new Promise<void>((r) => (waiting.current = r)) : pause(msFor(beat, paceRef.current)));

    const run = async () => {
      for (let i = 0; i < queue.length; i++) {
        if (i > 0) await dwell(queue[i - 1]);
        if (cancelled) return;

        const beat = queue[i];
        const ms = msFor(beat, paceRef.current === "step" ? "normal" : paceRef.current);
        // An arriving ghost lives exactly one beat: the real card takes over
        // as this one starts, so the flight hands over rather than lingering.
        setGhosts((g) => g.filter((x) => x.kind !== "arrive"));
        const gone = departs(beat);
        if (gone) {
          // Measured here, in a timer callback, because the DOM is only safe to
          // read outside render — and because now is when the pile is where the
          // card actually left it.
          const from = anchorPoint(hostRef.current, `${gone.owner}:${gone.from}`);
          const to = anchorPoint(hostRef.current, `${gone.owner}:drop`);
          if (from) setGhosts((g) => [...g, { key: beat.n, card: gone.card, from, to: to ?? from, kind: "leave", ms }]);
        }
        const coming = arrivesFrom(beat, viewer);
        if (coming) {
          const from = anchorPoint(hostRef.current, `${coming.owner}:${coming.from}`);
          const to = anchorPoint(hostRef.current, `${coming.owner}:${coming.to}`);
          if (from && to) setGhosts((g) => [...g, { key: beat.n, card: coming.card, from, to, kind: "arrive", ms }]);
        }
        const f = feelFor(beat);
        if (f) feel(f);
        setAt(i);
      }
      await dwell(queue[queue.length - 1]);
      if (!cancelled) skip();
    };

    void run();
    return () => {
      cancelled = true;
      waiting.current = null;
    };
  }, [queue, skip, hostRef, viewer]);

  const playing = queue.length > 0;

  // Everything still to arrive, so the board can hold those cards back.
  let suppressed = NOTHING;
  if (playing) {
    suppressed = new Set<string>();
    for (let i = at; i < queue.length; i++) {
      const card = arrives(queue[i]);
      if (card) suppressed.add(card);
    }
  }

  return { playing, suppressed, ghosts, current: playing ? (queue[at] ?? null) : null, skip, next, index: playing ? at : 0, total: queue.length };
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
