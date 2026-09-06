"use client";

import { useSyncExternalStore } from "react";

/**
 * How fast the story of a turn is told.
 *
 * The durations in `stage/motion.ts` were tuned so that nothing blocks the
 * next tap; watched on a phone, a whole opponent turn at that pace goes past
 * faster than it can be read. So the pace is a preference, remembered like
 * buzz and sound: `slow` (the default) gives every beat time to be read, and
 * `step` waits for a tap between beats, so a turn can be followed move by move.
 */
export type Pace = "slow" | "normal" | "step";

export const PACES: Pace[] = ["slow", "normal", "step"];

const KEY = "arena.pace";
const DEFAULT: Pace = "slow";

let cache: Pace | null = null;
const listeners = new Set<() => void>();

function read(): Pace {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === "normal" || v === "step" || v === "slow" ? v : DEFAULT;
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
