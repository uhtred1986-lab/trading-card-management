"use client";

/**
 * Short synthesised tones so hands-free entry can be confirmed by ear:
 * a rising two-note chime when a card was understood, a low buzz when it
 * wasn't. Generated with Web Audio — no audio files to ship or load.
 */

let ctx: AudioContext | null = null;

type Cue = "ok" | "fail" | "start" | "stop";

const TONES: Record<Cue, { freq: number[]; type: OscillatorType; gain: number }> = {
  ok: { freq: [880, 1320], type: "sine", gain: 0.18 },
  fail: { freq: [300, 190], type: "square", gain: 0.12 },
  start: { freq: [660], type: "sine", gain: 0.12 },
  stop: { freq: [520, 390], type: "sine", gain: 0.1 },
};

export function cue(kind: Cue): void {
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
    /* sound is a nicety, never a failure */
  }
}
