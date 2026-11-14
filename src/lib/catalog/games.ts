/**
 * The card games this app tracks: Bandai's two Dragon Ball Super games and the
 * Pokémon Trading Card Game.
 *
 * Pokémon differs in kind, not only in rules: its catalog is never imported.
 * Cards are searched live (TCGdex, `src/lib/pokemon/`) and a row is written to
 * `cards` only when a lot, a deck line or a wish refers to it
 * (docs/pokemon/plan.md §4). So the catalog, price and meta syncs run over
 * `SYNCED_GAMES`, never over `GAMES`.
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
 * The arena plays the games flagged `arena` below, each by its own ruleset
 * directory (`src/lib/arena/rulesets/<game>/`). Every gate that decides whether
 * a deck or card may enter the arena asks `arenaPlays` / `ARENA_GAMES`, so
 * turning a game on or off is the one flag.
 */

export const GAMES = ["dbs", "fusion", "pokemon"] as const;
export type Game = (typeof GAMES)[number];

export const DEFAULT_GAME: Game = "dbs";

/** The games whose catalog, prices and meta are imported by the sync jobs. */
export const SYNCED_GAMES = ["dbs", "fusion"] as const;
export type SyncedGame = (typeof SYNCED_GAMES)[number];

export function isSyncedGame(v: unknown): v is SyncedGame {
  return typeof v === "string" && (SYNCED_GAMES as readonly string[]).includes(v);
}

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
  /** Whether a deck has a Leader slot. False for Pokémon. */
  leader: boolean;
  /**
   * What the copy limit counts: the card number (Bandai) or the card's name, so
   * two printings of one Pokémon share the limit.
   */
  copiesBy: "number" | "name";
  /** Formats a deck can be built for, the first being the default; empty when the game has one. */
  formats: readonly string[];
}

export interface GameInfo {
  id: Game;
  /** Full name, for headings and prompts. */
  label: string;
  /** Two or three words, for filter chips and badges. */
  short: string;
  /** `sync`: the catalog is imported. `live`: cards are searched at the source and stored on reference. */
  catalog: "sync" | "live";
  /** deckplanet card-search collection backing this game's catalog; null for a live game. */
  catalogPath: string | null;
  /** TCGplayer category on tcgcsv.com; null for a live game. */
  tcgCategoryId: number | null;
  /** Language of this game's own screens. The Dragon Ball screens are English, the Pokémon screens German (owner, 14 Nov 2026). */
  uiLang: "en" | "de";
  /** The card-type names of this game, for filters and deck groups, in display order. */
  cardTypes: readonly string[];
  /** How to describe the game to Claude, so it never reasons across the two. */
  promptName: string;
  deck: DeckRules;
  /**
   * Bandai's own game art, hot-linked (the repository is public, so never committed; hosts are in
   * `next.config.ts` `images.remotePatterns`). `tile` is the 470×666 game-select button, `logo` the white
   * wordmark on transparent, `accent` the colour of the tile. `GameMark` falls back to `short` on `accent`,
   * which is all Pokémon has (`tile` and `logo` null: no official art is hot-linked for it).
   */
  art: { tile: string | null; logo: string | null; accent: string };
  /** Card types that can never sit in a deck. */
  nonDeckTypes: string[];
  /** Whether the arena plays this game. */
  arena: boolean;
}

export const GAME_INFO: Record<Game, GameInfo> = {
  dbs: {
    id: "dbs",
    label: "Dragon Ball Super Card Game",
    short: "Super",
    catalog: "sync",
    catalogPath: "dbs_masters_cards",
    tcgCategoryId: 27,
    uiLang: "en",
    cardTypes: ["LEADER", "BATTLE", "EXTRA", "UNISON", "Z-LEADER", "Z-BATTLE", "Z-EXTRA", "Z-UNISON"],
    promptName: "Dragon Ball Super Card Game (Bandai; legacy sets BT1–BT25 and the current Masters line — NOT Fusion World)",
    // Rule Manual v4.00 §6-1: 1 leader, 50–60 main, up to 10 Z-cards, 4 copies.
    deck: { main: 50, mainMax: 60, zMax: 10, copies: 4, colorStrict: false, leader: true, copiesBy: "number", formats: [] },
    art: {
      tile: "https://www.dbs-cardgame.com/gameselect/images/btn_master.jpg",
      logo: "https://www.dbs-cardgame.com/gameselect/images/logo.png",
      // Mean colour of the saturated orange pixels of btn_master.jpg (sharp, 2026-10-26).
      accent: "#fe6e01",
    },
    nonDeckTypes: ["TOKEN"],
    arena: true,
  },
  fusion: {
    id: "fusion",
    label: "Dragon Ball Super Card Game Fusion World",
    short: "Fusion World",
    catalog: "sync",
    catalogPath: "fusion_world_cards",
    tcgCategoryId: 80,
    uiLang: "en",
    cardTypes: ["LEADER", "BATTLE", "EXTRA"],
    promptName: "Dragon Ball Super Card Game Fusion World (Bandai; the FB/FS/FP/SB/ST sets — NOT the original Masters/legacy game)",
    /*
     * Fusion World Rule Manual v1.20 and the official deck-building FAQ:
     * 1 leader, a 50–60 card deck, at most 4 of a card number, and — unlike
     * the original game — a hard colour rule ("if your Leader doesn't have a
     * certain color, you can't include a card with that color in your deck").
     * There is no Z-Deck.
     */
    deck: { main: 50, mainMax: 60, zMax: 0, copies: 4, colorStrict: true, leader: true, copiesBy: "number", formats: [] },
    art: {
      tile: "https://www.dbs-cardgame.com/gameselect/images/btn_fw.jpg",
      logo: "https://www.dbs-cardgame.com/fw/renewal01/images/common/logo_fw_w.png",
      // Mean colour of the saturated cyan pixels of btn_fw.jpg (sharp, 2026-10-26).
      accent: "#01c6fe",
    },
    nonDeckTypes: ["ENERGY MARKER", "TOKEN"],
    arena: true,
  },
  pokemon: {
    id: "pokemon",
    label: "Pokémon Trading Card Game",
    short: "Pokémon",
    catalog: "live",
    catalogPath: null,
    tcgCategoryId: null,
    uiLang: "de",
    cardTypes: ["POKEMON", "TRAINER", "ENERGY"],
    promptName: "Pokémon Trading Card Game (The Pokémon Company; NOT a Dragon Ball game: no Leader, no energy colours of Bandai's games)",
    /*
     * Pokémon TCG rules: exactly 60 cards, no Leader, at most 4 cards with the
     * same name (basic Energy unlimited; ACE SPEC and Radiant one per deck), at
     * least one Basic Pokémon. Standard and Expanded are the two formats; which
     * cards each allows comes from the source's legality flags, never from a
     * list kept here.
     */
    deck: { main: 60, mainMax: 60, zMax: 0, copies: 4, colorStrict: false, leader: false, copiesBy: "name", formats: ["standard", "expanded"] },
    // The accent of the Pokémon skin (docs/pokemon/design.md §11).
    art: { tile: null, logo: null, accent: "#ffc93c" },
    nonDeckTypes: [],
    arena: false,
  },
};

/** What a synced game's import needs, typed so a live game cannot be passed. */
export function syncSource(game: SyncedGame): { catalogPath: string; tcgCategoryId: number } {
  const { catalogPath, tcgCategoryId } = GAME_INFO[game];
  if (catalogPath === null || tcgCategoryId === null) throw new Error(`${game} has no synced catalog`);
  return { catalogPath, tcgCategoryId };
}

/** The games the arena plays: the one list every arena gate reads. */
export const ARENA_GAMES: readonly Game[] = GAMES.filter((g) => GAME_INFO[g].arena);

/** Whether the arena plays this game; false for anything that is not a known game. */
export function arenaPlays(game: unknown): game is Game {
  return isGame(game) && GAME_INFO[game].arena;
}

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
