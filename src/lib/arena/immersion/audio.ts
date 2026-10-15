import type { ArenaSoundCue } from "./types";

type Tone = readonly [frequency: number, endFrequency: number, duration: number, delay?: number];

/** Original synthesized presentation cues, never character voices or licensed clips.
 * Attack builds for 260ms; impact cues start immediately. Call play at the visual beat.
 */
const TONES: Record<ArenaSoundCue, readonly Tone[]> = {
  attack: [[130, 520, 0.26]],
  hit: [[150, 45, 0.18], [70, 35, 0.22]],
  block: [[750, 220, 0.15]],
  repelled: [[520, 100, 0.25]],
  negated: [[180, 80, 0.28], [185, 85, 0.28]],
  draw: [[560, 780, 0.09]],
  play: [[350, 600, 0.12]],
  turn: [[440, 440, 0.1], [660, 660, 0.14, 0.12]],
  victory: [[523, 523, 0.18], [659, 659, 0.18, 0.15], [784, 784, 0.3, 0.3]],
  defeat: [[330, 294, 0.2], [262, 196, 0.35, 0.18]],
};

type Voice = { oscillator: OscillatorNode; gain: GainNode };
const MAX_VOICES = 12;

class ArenaAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices = new Set<Voice>();
  private volume = 0.35;

  get supported(): boolean {
    return typeof window !== "undefined" && Boolean(window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  }

  /** Must be invoked directly from a user gesture. Fail closed on blocked audio. */
  async unlock(): Promise<void> {
    if (!this.supported) return;
    try {
      if (!this.context || this.context.state === "closed") {
        const Constructor = window.AudioContext ||
          (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!;
        this.context = new Constructor();
        this.master = this.context.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === "suspended") await this.context.resume();
    } catch {
      // Unsupported devices and autoplay restrictions must never affect the match.
    }
  }

  setVolume(value: number): void {
    if (!Number.isFinite(value)) return;
    this.volume = Math.max(0, Math.min(1, value));
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.015);
    }
  }

  play(cue: ArenaSoundCue): void {
    const context = this.context;
    if (!context || !this.master || context.state !== "running" || this.volume === 0) return;
    // Drop surplus beats instead of allocating unbounded nodes during catch-up.
    const tones = TONES[cue];
    if (this.voices.size + tones.length > MAX_VOICES) return;
    for (const [frequency, endFrequency, duration, delay = 0] of tones) {
      let voice: Voice | undefined;
      try {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        voice = { oscillator, gain };
        this.voices.add(voice);
        const start = context.currentTime + delay;
        oscillator.type = cue === "hit" || cue === "attack" ? "triangle" : "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
        gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.18, start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain);
        gain.connect(this.master);
        const currentVoice = voice;
        oscillator.onended = () => this.release(currentVoice);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.01);
      } catch {
        if (voice) this.release(voice);
      }
    }
  }

  /** Cancel scheduled notes as well as active notes; a short fade avoids clicks. */
  stop(): void {
    const context = this.context;
    if (!context) return;
    for (const voice of this.voices) {
      try {
        const now = context.currentTime;
        voice.gain.gain.cancelAndHoldAtTime(now);
        voice.gain.gain.linearRampToValueAtTime(0, now + 0.015);
        voice.oscillator.stop(now + 0.02);
      } catch {
        this.release(voice);
      }
    }
  }

  private release(voice: Voice): void {
    voice.oscillator.disconnect();
    voice.gain.disconnect();
    this.voices.delete(voice);
  }
}

export const arenaAudio = new ArenaAudio();
