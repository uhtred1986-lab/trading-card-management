"use client";

import { useCallback, useEffect, useState } from "react";
import type { Beats, NumberedBeat } from "@/lib/arena/beats";
import { feel } from "@/lib/arena/feel";
import { anchorPoint, type Point } from "./anchors";
import { arrives, departs, feelFor, msFor } from "./motion";

export interface Ghost {
  key: number;
  card: string;
  /** Measured when the beat played: where it left, and where it is going. */
  from: Point;
  to: Point;
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
export function useBeatPlayer(beats: Beats | null, enabled: boolean, hostRef: React.RefObject<HTMLDivElement | null>): Playback {
  const [queue, setQueue] = useState<NumberedBeat[]>([]);
  const [at, setAt] = useState(0);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
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
  }, []);

  // Walk the queue. Everything happens in a timer callback — the first tick
  // included — so the board paints the end state once before the story of how
  // it got there starts being told over the top of it.
  useEffect(() => {
    if (!queue.length) return;
    let cancelled = false;

    const run = async () => {
      for (let i = 0; i < queue.length; i++) {
        await pause(i === 0 ? 0 : msFor(queue[i - 1]));
        if (cancelled) return;

        const beat = queue[i];
        const gone = departs(beat);
        if (gone) {
          // Measured here, in a timer callback, because the DOM is only safe to
          // read outside render — and because now is when the pile is where the
          // card actually left it.
          const from = anchorPoint(hostRef.current, `${gone.owner}:${gone.from}`);
          const to = anchorPoint(hostRef.current, `${gone.owner}:drop`);
          if (from) setGhosts((g) => [...g, { key: beat.n, card: gone.card, from, to: to ?? from }]);
        }
        const f = feelFor(beat);
        if (f) feel(f);
        setAt(i);
      }
      await pause(msFor(queue[queue.length - 1]));
      if (!cancelled) skip();
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [queue, skip, hostRef]);

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

  return { playing, suppressed, ghosts, current: playing ? (queue[at] ?? null) : null, skip };
}

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
