/**
 * Which language the browser listens in. Pure (the one storage touch is wrapped), so the scripts
 * can test it; `speech.ts` is the browser wrapper that uses it.
 *
 * The default comes from the game's screen language (`GAME_INFO[game].uiLang`): the Pokémon screens
 * speak German, so they listen for German; the Dragon Ball screens are English and keep `en-US`.
 * Where no game is known the answer is `en-US`, as it always was. A person's last choice is kept
 * per device.
 */
import { GAME_INFO, type Game } from "@/lib/catalog/games";

export const SPEECH_LANGS = ["de-AT", "en-US"] as const;
export type SpeechLang = (typeof SPEECH_LANGS)[number];

/** The listening language for a game's screens: German screens listen in Austrian German. */
export function defaultSpeechLang(game?: Game | null): SpeechLang {
  return game && GAME_INFO[game]?.uiLang === "de" ? "de-AT" : "en-US";
}

/** "de-AT" becomes "de", for the spoken parser and the card language chips. */
export function speechLangCode(lang: SpeechLang): "de" | "en" {
  return lang === "de-AT" ? "de" : "en";
}

export const SPEECH_LANG_KEY = "speech-lang";

/** What a device chose last, or the game's default. Never throws (private windows block storage). */
export function readSpeechLang(game?: Game | null, storage?: Pick<Storage, "getItem"> | null): SpeechLang {
  try {
    const s = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    const v = s?.getItem(SPEECH_LANG_KEY);
    if (v && (SPEECH_LANGS as readonly string[]).includes(v)) return v as SpeechLang;
  } catch {
    /* storage can be blocked */
  }
  return defaultSpeechLang(game);
}

export function rememberSpeechLang(lang: SpeechLang, storage?: Pick<Storage, "setItem"> | null): void {
  try {
    const s = storage ?? (typeof window !== "undefined" ? window.localStorage : null);
    s?.setItem(SPEECH_LANG_KEY, lang);
  } catch {
    /* a convenience only */
  }
}
