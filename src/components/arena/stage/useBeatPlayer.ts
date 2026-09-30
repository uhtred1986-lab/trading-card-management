"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Beats, NumberedBeat } from "@/lib/arena/beats";
import type { PlayerId } from "@/lib/arena/engine";
import { feel } from "@/lib/arena/feel";
import type { Pace } from "@/lib/arena/pace";
import { anchorPoint, type Point } from "./anchors";
import { addsToChain, arrives, arrivesFrom, battleLink, departs, feelFor, FX, fxScale, msFor, reveals, turnBannerMs } from "./motion";

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
  /**
   * A KO (rd-07): the card burns white, cracks, tilts and falls for `delay` ms
   * where it stood, *then* the flight to the Drop begins.
   */
  ko?: { delay: number };
}

/** A turn boundary the board is announcing ("YOUR TURN"), before the phase that opens it. */
export interface TurnCall {
  key: number;
  player: PlayerId;
  turn: number;
}

export interface Playback {
  /**
   * The turn change on screen right now, or null. It is its own step: the walk
   * stands still on it for `turnBannerMs` (or, in step pace, until Next), then
   * goes on to the turn's first beat.
   */
  turnCall: TurnCall | null;
  /** A turn change is still to be announced, so the phase banner waits for it. */
  turnAhead: boolean;
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
  /**
   * Hold the story where it is. Opening a card mid-fight stops the playback
   * and closing it starts it again — a fight that runs on behind an open card
   * is the reason the inspector exists at all
   * (`docs/arena-battle-staging-spec.md` decision 6). The walk stalls between
   * beats, so nothing is skipped and nothing runs twice.
   *
   * The pause belongs to the caller, not to the queue: the walk gates before
   * its first beat, so a story arriving while a card is open is held too, and
   * the caller's own effect — which re-runs as `playing` turns true — is what
   * lets it go again. `skip` always releases, so nothing can be stranded.
   */
  pause: () => void;
  resume: () => void;
  paused: boolean;
  /** Where the story is: the beat on screen, and how many there are. */
  index: number;
  total: number;
}

const NOTHING: Set<string> = new Set();
const NOTHING_N: ReadonlySet<number> = new Set();

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
export function useBeatPlayer(
  beats: Beats | null,
  enabled: boolean,
  hostRef: React.RefObject<HTMLDivElement | null>,
  pace: Pace = "normal",
  viewer: PlayerId = "p1",
  /**
   * Cards a surface keeps on screen after they have left a visible zone — the
   * counters a battle staging holds in the guard's chain. They arrive like
   * any other card and never leave, so they are suppressed until their beat
   * and never ghosted to the Drop.
   */
  drawn?: ReadonlySet<string>,
  /** The turn the board was on when it mounted: a reload announces nothing. */
  turnNow = 0,
): Playback {
  const [queue, setQueue] = useState<NumberedBeat[]>([]);
  const [at, setAt] = useState(0);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [paused, setPaused] = useState(false);
  const [turnCall, setTurnCall] = useState<TurnCall | null>(null);
  // The beats (by number) that open a turn nobody has been told about yet, and
  // the turn the story has got to. Decided once, when the queue is made.
  const [starts, setStarts] = useState<ReadonlySet<number>>(NOTHING_N);
  const [ahead, setAhead] = useState(0);
  const [lastTurn, setLastTurn] = useState(turnNow);
  // Read by the walk rather than closed over, so a pause takes effect on the
  // next beat instead of restarting the story.
  const held = useRef(false);
  const waiters = useRef<(() => void)[]>([]);
  const drawnRef = useRef(drawn);
  useEffect(() => {
    drawnRef.current = drawn;
  }, [drawn]);
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
    // A turn starts with its Charge Phase beat. Any phase beat that names a
    // turn the story has not been on yet is the boundary, so a skipped turn
    // (20-13) is announced too.
    const opens = new Set<number>();
    let turn = lastTurn;
    for (const b of fresh) {
      if (b.t === "phase" && b.turn !== turn) {
        opens.add(b.n);
        turn = b.turn;
      }
    }
    setStarts(opens);
    setAhead(opens.size);
    setLastTurn(turn);
  }

  /** Let everything waiting go: a pause must never outlive the story it held. */
  const release = useCallback(() => {
    held.current = false;
    const all = waiters.current;
    waiters.current = [];
    for (const r of all) r();
  }, []);

  const skip = useCallback(() => {
    setQueue([]);
    setAt(0);
    setGhosts([]);
    setPaused(false);
    setTurnCall(null);
    setAhead(0);
    release();
    waiting.current?.();
    waiting.current = null;
  }, [release]);

  const pause = useCallback(() => {
    held.current = true;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    setPaused(false);
    release();
  }, [release]);

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

    // How many cards each beat has watched added to the open battle, so a long
    // chain accelerates itself. Walked once, up front: the flag and the count
    // are about the beats before this one, not about the board now.
    const chainAt: number[] = [];
    {
      let open = false;
      let chain = 0;
      for (const beat of queue) {
        const link = battleLink(beat, open);
        if (link === "declare") {
          open = true;
          chain = 0;
        } else if (link === "clash") {
          open = false;
        }
        if (addsToChain(link)) chain++;
        chainAt.push(chain);
      }
    }

    // The dwell after a beat: a timer at the chosen pace, or in step mode a
    // tap on Next. Skip resolves the wait too, so it never strands the walk.
    const dwell = (beat: NumberedBeat, chain: number) => (paceRef.current === "step" ? new Promise<void>((r) => (waiting.current = r)) : sleep(msFor(beat, paceRef.current, chain)));
    /** Held open while a card is being read; resolved by `resume` or `skip`. */
    const gate = () => (held.current ? new Promise<void>((r) => waiters.current.push(r)) : Promise.resolve());

    const run = async () => {
      for (let i = 0; i < queue.length; i++) {
        if (i > 0) await dwell(queue[i - 1], chainAt[i - 1]);
        await gate();
        if (cancelled) return;

        const beat = queue[i];
        if (beat.t === "phase" && starts.has(beat.n)) {
          // Its own step: announced, held, then gone before the phase is.
          setTurnCall({ key: beat.n, player: beat.player, turn: beat.turn });
          setAhead((n) => Math.max(0, n - 1));
          if (paceRef.current === "step") await new Promise<void>((r) => (waiting.current = r));
          else await sleep(turnBannerMs(paceRef.current));
          setTurnCall(null);
          await gate();
          if (cancelled) return;
        }
        const ms = msFor(beat, paceRef.current === "step" ? "normal" : paceRef.current, chainAt[i]);
        // An arriving ghost lives exactly one beat: the real card takes over
        // as this one starts, so the flight hands over rather than lingering.
        setGhosts((g) => g.filter((x) => x.kind !== "arrive"));
        const gone = departs(beat, drawnRef.current);
        if (gone) {
          // Measured here, in a timer callback, because the DOM is only safe to
          // read outside render — and because now is when the pile is where the
          // card actually left it.
          const from = anchorPoint(hostRef.current, `${gone.owner}:${gone.from}`);
          const to = anchorPoint(hostRef.current, `${gone.owner}:drop`);
          if (from) {
            const k = fxScale(paceRef.current === "step" ? "normal" : paceRef.current);
            // A KO shatters where it stood and then flies; the `move` to the Drop
            // that follows it is the same card's flight, not a second ghost.
            const ghost: Ghost =
              beat.t === "ko"
                ? { key: beat.n, card: gone.card, from, to: to ?? from, kind: "leave", ms: Math.round(FX.koFly * k), ko: { delay: Math.round(FX.ko * k) } }
                : { key: beat.n, card: gone.card, from, to: to ?? from, kind: "leave", ms };
            setGhosts((g) => (beat.t === "move" && g.some((x) => x.card === ghost.card && x.ko) ? g : [...g, ghost]));
          }
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
      await dwell(queue[queue.length - 1], chainAt[queue.length - 1]);
      await gate();
      if (!cancelled) skip();
    };

    void run();
    return () => {
      cancelled = true;
      waiting.current = null;
    };
  }, [queue, starts, skip, hostRef, viewer]);

  const playing = queue.length > 0;

  // Everything still to arrive, so the board can hold those cards back.
  let suppressed = NOTHING;
  if (playing) {
    suppressed = new Set<string>();
    for (let i = at; i < queue.length; i++) {
      // A reveal is on screen while its own beat plays: the card turns over.
      if (i === at && reveals(queue[i])) continue;
      const card = arrives(queue[i], drawn);
      if (card) suppressed.add(card);
    }
  }

  return { turnCall, turnAhead: playing && ahead > 0, playing, suppressed, ghosts, current: playing ? (queue[at] ?? null) : null, skip, next, pause, resume, paused: playing && paused, index: playing ? at : 0, total: queue.length };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
