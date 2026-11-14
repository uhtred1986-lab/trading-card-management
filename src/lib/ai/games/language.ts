/**
 * The language a game's Claude answers are written in: the game's screen language
 * (`GAME_INFO[game].uiLang`). The Dragon Ball screens are English and the prompts already are, so they
 * get no extra line (their requests stay as they were); Pokémon's screens are German, so the model is
 * asked for German in plain words for a 12-year-old.
 */
import { GAME_INFO, type Game } from "@/lib/catalog/games";

const GERMAN =
  "Answer in German (Deutsch), in plain words a 12-year-old understands: short sentences, no jargon unless you explain it in a few words. " +
  "Every free-text field of your answer (summary, explanations, rationale, strategy, deck name, notes) is German. " +
  "Card ids stay exactly as given, and so do official card names. " +
  "Use the words printed on German cards: KP (never HP), Basis-Pokémon, Phase 1, Phase 2, Energie, Trainer; the two formats are called Standard and Erweitert.";

/** The instruction line for a game's answer language, or null when the game's screens are English. */
export function answerLanguageLine(game: Game): string | null {
  return GAME_INFO[game].uiLang === "de" ? GERMAN : null;
}
