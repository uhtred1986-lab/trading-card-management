/**
 * The Android app's read-only decks (`docs/arena-client-contract.md` §5,
 * `docs/arena-android-spec.md` §7).
 *
 * Pure shaping only — no database, no engine. `src/app/api/v1/decks/` reads
 * the rows (`src/lib/decks/queries.ts`) and asks the arena whether the deck
 * can be loaded into a game (`deckInputFor`); this module turns the two into
 * what a client receives. Legality is never recomputed here — it is read off
 * `DeckLegality`, the same value the web deck page renders from.
 *
 * Decks carry no seat or owner column (unlike `arena_games`, which is why the
 * game endpoints check `seatOf`): the collection is single-user data, shared
 * by every login the same way the web deck list already is, so there is
 * nothing here to filter by viewer.
 */
import { gameInfo, type Game } from "@/lib/catalog/games";
import type { DeckFlag, DeckLegality, DeckStatus } from "@/lib/decks/legality";
import type { Zone } from "@/lib/decks/queries";

export interface DeckLeaderView {
  id: string;
  name: string;
  imageUrl: string | null;
  colors: string[];
}

export interface DeckSummary {
  id: number;
  name: string;
  game: Game;
  isBuilt: boolean;
  leader: DeckLeaderView | null;
  status: DeckStatus;
  /** Whether the arena will load this deck into a game (`deckInputFor` decides it). */
  playable: boolean;
  /** Set whenever `playable` is false — a deck is never hidden silently, only marked why. */
  playableReason: string | null;
}

export interface DeckListPayload {
  decks: DeckSummary[];
}

export interface DeckDetailCard {
  cardId: string;
  name: string;
  zone: Zone;
  quantity: number;
  cardType: string;
  colors: string[];
  imageUrl: string | null;
  energyCost: string | null;
  /** The same `"<zone>:<cardId>"` flag the web deck page highlights, when this row has one. */
  flag: DeckFlag | null;
}

export interface DeckDetail {
  id: number;
  name: string;
  game: Game;
  isBuilt: boolean;
  leader: DeckLeaderView | null;
  status: DeckStatus;
  counts: { leader: number; main: number; z: number; side: number };
  cards: DeckDetailCard[];
  playable: boolean;
  playableReason: string | null;
}

/**
 * Why the arena will not load this deck, when it will not.
 *
 * Mirrors `deckInputFor`'s own two gates (`src/lib/arena/load.ts`) — a game
 * other than `dbs`, or no leader — in words rather than in a second decision:
 * `playable` itself always comes from calling `deckInputFor`, never from this.
 */
export function playableReason(game: Game, playable: boolean, hasLeader: boolean): string | null {
  if (playable) return null;
  if (game !== "dbs") return `${gameInfo(game).short} decks are not played in the arena — it only plays the original game`;
  if (!hasLeader) return "needs a leader before it can be played";
  return "cannot be loaded into the arena";
}

interface DeckSummaryInput {
  id: number;
  name: string;
  game: Game;
  isBuilt: boolean;
  leader: { id: string; name: string; imageUrl: string | null; colors: string[] } | null;
  legality: DeckLegality;
}

/** One row of `GET /api/v1/decks`, from a row of `listDecks` plus the arena's playability check. */
export function deckSummary(row: DeckSummaryInput, playable: boolean): DeckSummary {
  return {
    id: row.id,
    name: row.name,
    game: row.game,
    isBuilt: row.isBuilt,
    leader: row.leader,
    status: row.legality.status,
    playable,
    playableReason: playableReason(row.game, playable, row.legality.leaderCount > 0),
  };
}

interface DeckDetailInput {
  id: number;
  name: string;
  game: Game;
  isBuilt: boolean;
  legality: DeckLegality;
  cards: {
    cardId: string;
    name: string;
    zone: Zone;
    quantity: number;
    cardType: string;
    colors: string[];
    imageUrl: string | null;
    energyCost: string | null;
  }[];
}

/** `GET /api/v1/decks/{id}`, from `getDeck` plus the arena's playability check. */
export function deckDetail(deck: DeckDetailInput, playable: boolean): DeckDetail {
  const leaderRow = deck.cards.find((c) => c.zone === "leader");
  return {
    id: deck.id,
    name: deck.name,
    game: deck.game,
    isBuilt: deck.isBuilt,
    leader: leaderRow ? { id: leaderRow.cardId, name: leaderRow.name, imageUrl: leaderRow.imageUrl, colors: leaderRow.colors } : null,
    status: deck.legality.status,
    counts: { leader: deck.legality.leaderCount, main: deck.legality.mainCount, z: deck.legality.zCount, side: deck.legality.sideCount },
    cards: deck.cards.map((c) => ({
      cardId: c.cardId,
      name: c.name,
      zone: c.zone,
      quantity: c.quantity,
      cardType: c.cardType,
      colors: c.colors,
      imageUrl: c.imageUrl,
      energyCost: c.energyCost,
      flag: deck.legality.flags[`${c.zone}:${c.cardId}`] ?? null,
    })),
    playable,
    playableReason: playableReason(deck.game, playable, deck.legality.leaderCount > 0),
  };
}
