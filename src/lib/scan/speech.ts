"use client";

/**
 * Thin typed wrapper over the browser's Web Speech API (`SpeechRecognition`),
 * which is not in TypeScript's DOM lib. Recognition runs entirely in the
 * browser — no audio is uploaded and there is no API cost.
 */

interface SpeechAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}
interface SpeechEvent {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return ctor() !== null;
}

export interface SpeechHandlers {
  /** Best transcript first; alternatives are worth trying when the first doesn't match. */
  onFinal: (alternatives: string[]) => void;
  onInterim: (text: string) => void;
  onError: (error: string) => void;
  onStop: () => void;
}

export interface SpeechSession {
  stop(): void;
}

/**
 * Starts continuous recognition. Chrome ends a session on its own every so
 * often, so it restarts itself until `stop()` is called.
 */
export function startListening(handlers: SpeechHandlers, lang = "en-US"): SpeechSession | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  rec.lang = lang;
  let wanted = true;

  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i];
      if (result.isFinal) {
        const alts: string[] = [];
        for (let j = 0; j < Math.min(result.length, 3); j++) {
          const t = result[j]?.transcript?.trim();
          if (t) alts.push(t);
        }
        if (alts.length) handlers.onFinal(alts);
      } else {
        interim += result[0]?.transcript ?? "";
      }
    }
    handlers.onInterim(interim.trim());
  };
  rec.onerror = (e) => {
    // "no-speech" and "aborted" are routine during a pause; only real faults stop us.
    if (e.error === "no-speech" || e.error === "aborted") return;
    wanted = false;
    handlers.onError(e.error);
  };
  rec.onend = () => {
    if (!wanted) return handlers.onStop();
    try {
      rec.start();
    } catch {
      handlers.onStop();
    }
  };

  try {
    rec.start();
  } catch {
    return null;
  }
  return {
    stop() {
      wanted = false;
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

/** Reads a card name back so you can keep your eyes on the cards. */
export function speak(text: string): void {
  try {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.25;
    window.speechSynthesis.speak(u);
  } catch {
    /* optional nicety */
  }
}
