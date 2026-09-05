"use client";

/**
 * How the board answers a touch: a vibration, and optionally a tone.
 *
 * Both are Android-first. `navigator.vibrate` is the only haptic the web
 * offers — a duration in milliseconds, no intensity, and iOS does not have it
 * at all — so every pattern here is shaped by length and rhythm alone. The
 * native app can do better (`docs/arena-android-spec.md` §5.5); this is what
 * the browser has.
 *
 * Sound is synthesised, exactly as `src/lib/scan/cue.ts` does for voice entry,
 * so the app still ships no audio files.
 *
 * Preferences: haptics **on** by default, sound **off**. A game that starts
 * making noise unasked is the wrong default, and the design proposal left the
 * question open rather than assuming.
 */

export type Feel = "tap" | "illegal" | "land" | "impact" | "ko" | "win" | "loss";

/** Milliseconds of buzz and silence, as `navigator.vibrate` takes them. */
const BUZZ: Record<Feel, number | number[]> = {
  tap: 10,
  illegal: [0, 24, 70, 24],
  land: [0, 18],
  impact: [0, 30, 40, 60],
  ko: [0, 45, 55, 95],
  win: [0, 60, 55, 60, 55, 130],
  loss: [0, 140],
};

/** Frequencies in Hz, played in order, ~110 ms apart. */
const TONES: Record<Feel, { freq: number[]; type: OscillatorType; gain: number }> = {
  tap: { freq: [880], type: "sine", gain: 0.06 },
  illegal: { freq: [300, 190], type: "square", gain: 0.09 },
  land: { freq: [330, 220], type: "triangle", gain: 0.1 },
  impact: { freq: [180, 120], type: "sawtooth", gain: 0.12 },
  ko: { freq: [400, 260, 160], type: "triangle", gain: 0.12 },
  win: { freq: [523, 659, 784], type: "sine", gain: 0.14 },
  loss: { freq: [392, 294, 196], type: "sine", gain: 0.12 },
};

const HAPTICS_KEY = "arena.haptics";
const SOUND_KEY = "arena.sound";

export interface FeelPrefs {
  haptics: boolean;
  sound: boolean;
}

/** What the server has to assume, having no `localStorage` to read. */
const DEFAULTS: FeelPrefs = { haptics: true, sound: false };

/**
 * The snapshot is cached because `useSyncExternalStore` compares it by
 * identity: a fresh object on every read would re-render for ever.
 */
let cache: FeelPrefs | null = null;
const listeners = new Set<() => void>();

function read(): FeelPrefs {
  try {
    return {
      haptics: window.localStorage.getItem(HAPTICS_KEY) !== "off",
      sound: window.localStorage.getItem(SOUND_KEY) === "on",
    };
  } catch {
    // Storage can be blocked outright; the defaults are a fine answer.
    return DEFAULTS;
  }
}

export function feelPrefs(): FeelPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  cache ??= read();
  return cache;
}

/** The server's answer, and the client's first render, so hydration agrees. */
export function serverFeelPrefs(): FeelPrefs {
  return DEFAULTS;
}

export function setFeelPrefs(prefs: FeelPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HAPTICS_KEY, prefs.haptics ? "on" : "off");
    window.localStorage.setItem(SOUND_KEY, prefs.sound ? "on" : "off");
  } catch {
    // Not persisted, but still honoured for this session.
  }
  cache = prefs;
  for (const l of listeners) l();
}

/** For `useSyncExternalStore`. Also follows a change made in another tab. */
export function subscribeFeel(onChange: () => void): () => void {
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

let ctx: AudioContext | null = null;

/** One event, felt however the player has asked for it to be felt. */
export function feel(kind: Feel): void {
  const prefs = feelPrefs();
  if (prefs.haptics) buzz(kind);
  if (prefs.sound) tone(kind);
}

function buzz(kind: Feel): void {
  try {
    // Absent on desktop Safari and every iOS browser; simply nothing happens.
    navigator.vibrate?.(BUZZ[kind]);
  } catch {
    // A vibration is never worth an exception.
  }
}

function tone(kind: Feel): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    // Browsers start the context suspended until a user gesture.
    if (ctx.state === "suspended") void ctx.resume();
    const { freq, type, gain: peak } = TONES[kind];
    for (const [i, f] of freq.entries()) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.11;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.13);
    }
  } catch {
    // Same: a cue is never worth an exception.
  }
}
