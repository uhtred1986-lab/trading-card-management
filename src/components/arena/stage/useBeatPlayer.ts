"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Beats, NumberedBeat } from "@/lib/arena/beats";
import type { PlayerId } from "@/lib/arena/types";
import { feel } from "@/lib/arena/feel";
import type { Pace } from "@/lib/arena/pace";
import { anchorPoint, type Point } from "./anchors";
import { addsToChain, arrives, arrivesFrom, battleLink, departs, feelFor, FX, fxDuration, msFor, reveals, turnBannerMs } from "./motion";

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
  // One walk per story. A story that is still being told when more beats arrive
  // (the local worker commits the opponent's turn in batches, a polled game
  // lands Claude's moves one by one) is *extended*, never replaced: replacing
  // it dropped every beat not yet played, which is how a whole opponent turn
  // went past unseen and one attack's verdict went missing before the next.
  // `run` starts a new walk; the walk reads the live queue through these refs.
  const [run, setRun] = useState(0);
  const queueRef = useRef<NumberedBeat[]>([]);
  const startsRef = useRef<ReadonlySet<number>>(NOTHING_N);
  useLayoutEffect(() => {
    queueRef.current = queue;
    startsRef.current = starts;
  }, [queue, starts]);
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
    if (queue.length && fresh.length) {
      // Still telling the last story: carry on with it and add the new beats.
      setQueue([...queue, ...fresh]);
      setStarts(new Set([...starts, ...opens]));
      setAhead((n) => n + opens.size);
    } else if (queue.length && enabled) {
      // Nothing new to tell; the story in progress goes on untouched.
    } else {
      setQueue(fresh);
      setAt(0);
      setGhosts([]);
      setStarts(opens);
      setAhead(opens.size);
      if (fresh.length || queue.length) setRun((r) => r + 1);
    }
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
    // Ends the walk in progress (its effect is keyed on `run`).
    setRun((r) => r + 1);
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
    if (!queueRef.current.length) return;
    let cancelled = false;

    // How many cards each beat has watched added to the open battle, so a long
    // chain accelerates itself. Kept as the walk goes: the flag and the count
    // are about the beats before this one, not about the board now.
    let open = false;
    let chain = 0;
    const chainAt: number[] = [];

    // The dwell after a beat: a timer at the chosen pace, or in step mode a
    // tap on Next. Skip resolves the wait too, so it never strands the walk.
    // The beat after it is passed along, so a run of the same bookkeeping is grouped.
    const dwell = (i: number) => {
      const q = queueRef.current;
      return paceRef.current === "step" ? new Promise<void>((r) => (waiting.current = r)) : sleep(msFor(q[i], paceRef.current, chainAt[i], q[i + 1] ?? null));
    };
    /** Held open while a card is being read; resolved by `resume` or `skip`. */
    const gate = () => (held.current ? new Promise<void>((r) => waiters.current.push(r)) : Promise.resolve());

    const walk = async () => {
      let i = 0;
      for (;;) {
        // The dwell after the last beat comes first, so beats that arrive
        // during it are still told rather than skipped past.
        if (i > 0) await dwell(i - 1);
        await gate();
        if (cancelled) return;
        if (i >= queueRef.current.length) break;

        const beat = queueRef.current[i];
        const link = battleLink(beat, open);
        if (link === "declare") {
          open = true;
          chain = 0;
        } else if (link === "clash") {
          open = false;
        }
        if (addsToChain(link)) chain++;
        chainAt[i] = chain;

        if (beat.t === "phase" && startsRef.current.has(beat.n)) {
          // Its own step: announced, held, then gone before the phase is.
          setTurnCall({ key: beat.n, player: beat.player, turn: beat.turn });
          setAhead((n) => Math.max(0, n - 1));
          if (paceRef.current === "step") await new Promise<void>((r) => (waiting.current = r));
          else await sleep(turnBannerMs(paceRef.current));
          setTurnCall(null);
          await gate();
          if (cancelled) return;
        }
        const ms = msFor(beat, paceRef.current === "step" ? "normal" : paceRef.current, chain);
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
            // A KO shatters where it stood and then flies; the `move` to the Drop
            // that follows it is the same card's flight, not a second ghost.
            const ghost: Ghost =
              beat.t === "ko"
                ? { key: beat.n, card: gone.card, from, to: to ?? from, kind: "leave", ms: fxDuration(FX.koFly, paceRef.current), ko: { delay: fxDuration(FX.ko, paceRef.current) } }
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
        i++;
      }
      skip();
    };

    void walk();
    return () => {
      cancelled = true;
      waiting.current = null;
    };
  }, [run, skip, hostRef, viewer]);

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
