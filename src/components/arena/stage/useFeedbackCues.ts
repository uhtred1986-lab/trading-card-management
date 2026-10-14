"use client";

import { useEffect, useRef, useState } from "react";
import type { Beats, NumberedBeat } from "@/lib/arena/beats";
import type { PlayerId } from "@/lib/arena/types";

/** A short visual cue tied to the public event and the subject it names. */
export interface FeedbackCardCue {
  kind: "attacker" | "hit" | "held" | "ko";
  beat: number;
  text: string;
  player: PlayerId | null;
}

export interface FeedbackLifeCue {
  beat: number;
  amount: number;
  by: string | null;
  text: string;
}

export interface FeedbackPhaseCue {
  beat: number;
  phase: string;
  player: PlayerId;
  text: string;
}

export interface FeedbackCues {
  cards: Record<string, FeedbackCardCue>;
  life: Partial<Record<PlayerId, FeedbackLifeCue>>;
  phase: FeedbackPhaseCue | null;
}

const EMPTY: FeedbackCues = { cards: {}, life: {}, phase: null };
export const FEEDBACK_MS = 650;

/** Fold only the supplied public beats into visual cues. No board state or
 * rules are inferred here; in particular, `clash.hit` is the engine's verdict. */
export function feedbackFromBeats(beats: readonly NumberedBeat[]): FeedbackCues {
  const cues: FeedbackCues = { cards: {}, life: {}, phase: null };
  for (const beat of beats) {
    switch (beat.t) {
      case "attack":
        cues.cards[beat.attacker] = { kind: "attacker", beat: beat.n, text: "Attacking", player: null };
        break;
      case "clash":
        if (!cues.cards[beat.attacker]) {
          cues.cards[beat.attacker] = { kind: "attacker", beat: beat.n, text: "Attacking", player: null };
        }
        cues.cards[beat.guard] = {
          kind: beat.hit ? "hit" : "held",
          beat: beat.n,
          text: beat.hit ? "Hit" : "Held",
          player: null,
        };
        break;
      case "ko":
        cues.cards[beat.card] = { kind: "ko", beat: beat.n, text: "Knocked out", player: beat.owner };
        break;
      case "damage":
        cues.life[beat.player] = {
          beat: beat.n,
          amount: beat.amount,
          by: beat.by ?? null,
          text: `−${beat.amount} LIFE`,
        };
        break;
      case "phase":
        cues.phase = { beat: beat.n, phase: beat.phase, player: beat.player, text: beat.phase };
        break;
    }
  }
  return cues;
}

/** New beats only: the first mounted snapshot is the baseline, never a replay. */
export function feedbackAfter(beats: Beats | null, seen: number): FeedbackCues {
  return feedbackFromBeats((beats?.list ?? []).filter((beat) => beat.n > seen));
}

/** Observe the public beat stream without joining the beat player or gating
 * any decision. CSS applies movement in normal mode and stable outlines when
 * reduced motion is requested. */
export function useFeedbackCues(beats: Beats | null): FeedbackCues {
  const [cues, setCues] = useState<FeedbackCues>(EMPTY);
  const seen = useRef(beats?.seq ?? 0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!beats || beats.seq <= seen.current) return;
    const next = feedbackAfter(beats, seen.current);
    seen.current = beats.seq;
    if (Object.keys(next.cards).length === 0 && Object.keys(next.life).length === 0 && !next.phase) return;
    setCues(next);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => {
      clearTimer.current = null;
      setCues(EMPTY);
    }, FEEDBACK_MS);
  }, [beats]);

  useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  return cues;
}
