"use client";

import { useSyncExternalStore } from "react";

/**
 * How fast the story of a turn is told.
 *
 * The durations in `stage/motion.ts` are three tiers (bookkeeping, key
 * moments, decisive) so a turn keeps one rhythm. The pace is a preference,
 * remembered like buzz and sound: `normal` is the base tiers, `slow`
 * stretches all of them by the same gentle 1.3x, and `step` waits for a tap
 * between beats, so a turn can be followed move by move. `explain` (the default
 * since 13 Nov 2026, the owner's choice) is `slow` with every skill told as a
 * story: a callout, its steps one at a time, then what changed
 * (`docs/arena-skill-explainer.md`, `src/lib/arena/explain.ts`).
 */
export type Pace = "explain" | "slow" | "normal" | "step";

export const PACES: Pace[] = ["explain", "slow", "normal", "step"];

/**
 * A new key with the Explain pace (13 Nov 2026): Slow was the default before it, and the owner chose Explain to
 * replace it, so a stored "slow" — the old default, or the slow one picked on purpose — is read as Explain once,
 * which is Slow with the skills explained. Normal and Step carry over as they were.
 */
const KEY = "arena.pace.v2";
const OLD_KEY = "arena.pace";
const DEFAULT: Pace = "explain";

let cache: Pace | null = null;
const listeners = new Set<() => void>();

function read(): Pace {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === "normal" || v === "step" || v === "slow" || v === "explain") return v;
    const old = window.localStorage.getItem(OLD_KEY);
    return old === "normal" || old === "step" ? old : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function pacePref(): Pace {
  if (typeof window === "undefined") return DEFAULT;
  cache ??= read();
  return cache;
}

/** The server's answer, and the client's first render, so hydration agrees. */
export function serverPacePref(): Pace {
  return DEFAULT;
}

export function setPacePref(pace: Pace): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, pace);
  } catch {
    // Not persisted, but still honoured for this session.
  }
  cache = pace;
  for (const l of listeners) l();
}

export function subscribePace(onChange: () => void): () => void {
  listeners.add(onChange);
  const fromAnotherTab = () => {
    cache = read();
    onChange();
  };
  window.addEventListener("storage", fromAnotherTab);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", fromAnotherTab);
  };
}

export function usePace(): Pace {
  return useSyncExternalStore(subscribePace, pacePref, serverPacePref);
}
