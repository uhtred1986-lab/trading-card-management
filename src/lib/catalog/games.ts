/**
 * The two card games this app tracks.
 *
 * Bandai sells "Dragon Ball Super Card Game" as two separate products that
 * share a name and nothing else: the original line (legacy BT1–BT25 plus the
 * current Masters sets) and **Fusion World**, a different game with its own
 * card pool, its own deck rules and its own TCGplayer category. They are never
 * mixed — a card, a set and a deck each belong to exactly one of them — so
 * `game` is carried on `card_sets`, denormalised onto `cards`, and chosen once
 * per deck.
 *
 * Everything game-specific lives here so a query only ever needs the id:
 * where the catalog comes from, which TCGplayer category prices it, what a
 * legal deck looks like, and how the model should be told which game it is
 * reasoning about.
 *
 * The arena engine is deliberately **not** parameterised: it reads the Masters
 * rule manual and only ever plays `dbs` decks (owner's decision).
 */

export const GAMES = ["dbs", "fusion"] as const;
export type Game = (typeof GAMES)[number];

export const DEFAULT_GAME: Game = "dbs";

export interface DeckRules {
  /** Cards a main deck needs before it counts as finished. */
  main: number;
  /** Most it may hold. */
  mainMax: number;
  /** Z-Deck size; 0 means the game has no Z-Deck at all. */
  zMax: number;
  /** Copies of one card number, unless the card prints a lower limit. */
  copies: number;
  /**
   * Whether a card off the leader's colours is a rule break or just a warning.
   * Fusion World forbids it outright; the original game only frowns at it.
   */
  colorStrict: boolean;
}

export interface GameInfo {
  id: Game;
  /** Full name, for headings and prompts. */
  label: string;
  /** Two or three words, for filter chips and badges. */
  short: string;
  /** deckplanet card-search collection backing this game's catalog. */
  catalogPath: string;
  /** TCGplayer category on tcgcsv.com. */
  tcgCategoryId: number;
  /** How to describe the game to Claude, so it never reasons across the two. */
  promptName: string;
  deck: DeckRules;
  /** Card types that can never sit in a deck. */
  nonDeckTypes: string[];
}

export const GAME_INFO: Record<Game, GameInfo> = {
  dbs: {
    id: "dbs",
    label: "Dragon Ball Super Card Game",
    short: "Super",
    catalogPath: "dbs_masters_cards",
    tcgCategoryId: 27,
    promptName: "Dragon Ball Super Card Game (Bandai; legacy sets BT1–BT25 and the current Masters line — NOT Fusion World)",
    // Rule Manual v4.00 §6-1: 1 leader, 50–60 main, up to 10 Z-cards, 4 copies.
    deck: { main: 50, mainMax: 60, zMax: 10, copies: 4, colorStrict: false },
    nonDeckTypes: ["TOKEN"],
  },
  fusion: {
    id: "fusion",
    label: "Dragon Ball Super Card Game Fusion World",
    short: "Fusion World",
    catalogPath: "fusion_world_cards",
    tcgCategoryId: 80,
    promptName: "Dragon Ball Super Card Game Fusion World (Bandai; the FB/FS/FP/SB/ST sets — NOT the original Masters/legacy game)",
    /*
     * Fusion World Rule Manual v1.20 and the official deck-building FAQ:
     * 1 leader, a 50–60 card deck, at most 4 of a card number, and — unlike
     * the original game — a hard colour rule ("if your Leader doesn't have a
     * certain color, you can't include a card with that color in your deck").
     * There is no Z-Deck.
     */
    deck: { main: 50, mainMax: 60, zMax: 0, copies: 4, colorStrict: true },
    nonDeckTypes: ["ENERGY MARKER", "TOKEN"],
  },
};

export function isGame(v: unknown): v is Game {
  return typeof v === "string" && (GAMES as readonly string[]).includes(v);
}

/** Narrow a query-string value to a game, or undefined for "both". */
export function parseGame(v: string | null | undefined): Game | undefined {
  return isGame(v) ? v : undefined;
}

/** A game id from anywhere (a database column, a form field), never undefined. */
export function gameOr(v: unknown, fallback: Game = DEFAULT_GAME): Game {
  return isGame(v) ? v : fallback;
}

export function gameInfo(v: unknown): GameInfo {
  return GAME_INFO[gameOr(v)];
}

export function deckRules(v: unknown): DeckRules {
  return gameInfo(v).deck;
}

export const GAME_OPTIONS = GAMES.map((g) => ({ value: g, label: GAME_INFO[g].short }));
