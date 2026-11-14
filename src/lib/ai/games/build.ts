/**
 * The two ways to start a deck with Claude, game-neutral: `buildDeckWithClaude` ("Deck mit Claude
 * bauen" / "Build a deck with Claude") and `buildDeckAroundCard` ("Neues Deck mit dieser Karte").
 *
 * The Dragon Ball games keep the builders they have (`deck-builder.ts`, `deck-from-card.ts`: a Leader
 * decides the deck), reached through these functions; Pokémon has no Leader, so it builds from a seed
 * card and / or a wish, with a free deterministic draft beside the Claude path.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { cards } from "@/db/schema";
import { gameInfo, gameOr, type Game } from "@/lib/catalog/games";
import type { DeckLegality } from "@/lib/decks/legality";
import { getDeck } from "@/lib/decks/queries";
import { suggestDeck } from "../deck-builder";
import { suggestDeckFromCard } from "../deck-from-card";
import { draftAroundPokemonCard } from "./pokemon-around";
import { buildPokemonDeckWithClaude } from "./pokemon-build";
import { liveDeps, type PokemonDeps } from "./pokemon";

export interface BuildInput {
  /** Dragon Ball: the Leader the deck is built for. */
  leaderId?: string | null;
  /** Pokémon: a card the deck is built around. */
  seedCardId?: string | null;
  /** Pokémon: what the player wants, in their own words. */
  wish?: string | null;
  /** The deck's format, for a game that has formats. */
  format?: string | null;
}

export interface BuildResult {
  deckId: number;
  /** "draft": the free deterministic draft; "claude": a model built it. */
  mode: "draft" | "claude";
  mainCount: number;
  /** Copies still to get. */
  toBuy: number;
  /** The Dragon Ball from-card path also chooses a Leader. */
  leaderName?: string;
  /** What the app's rule checker says about the new deck: a flag, never a block. */
  legality: DeckLegality | null;
  /** Things worth telling the player (German for a German game). */
  notes: string[];
}

export interface BuildOptions {
  db: Db;
  /** Stamped on the deck and the scope of "owned" (`null`: the lots without an owner). */
  owner: string | null;
  deps?: PokemonDeps;
}

export interface AroundOptions extends BuildOptions {
  /** "draft" is free (Pokémon only); "claude" is a paid call. Default: the free draft where the game has one, else Claude. */
  mode?: "draft" | "claude";
  format?: string | null;
}

/** Whether a game has the free deterministic draft. */
export function hasFreeDraft(game: Game): boolean {
  return gameOr(game) === "pokemon";
}

async function legalityOf(db: Db, deckId: number): Promise<DeckLegality | null> {
  return (await getDeck(db, deckId))?.legality ?? null;
}

async function assertCardGame(db: Db, cardId: string, game: Game): Promise<void> {
  const row = await db.query.cards.findFirst({ where: eq(cards.id, cardId), columns: { game: true } });
  if (row && gameOr(row.game) !== game) throw new Error(`That card belongs to ${gameInfo(row.game).short}, not ${gameInfo(game).short}.`);
}

/** "Build a deck with Claude". Dragon Ball: from a Leader. Pokémon: from a card and / or a wish. */
export async function buildDeckWithClaude(game: Game, input: BuildInput, opts: BuildOptions): Promise<BuildResult> {
  const { db, owner } = opts;
  if (gameInfo(game).deck.leader) {
    if (!input.leaderId) throw new Error("Pick a Leader first.");
    await assertCardGame(db, input.leaderId, game);
    const { deckId, sanitised } = await suggestDeck(db, input.leaderId, owner);
    const toBuy = [...sanitised.main, ...sanitised.z].reduce((n, c) => n + c.needToBuy, 0);
    return { deckId, mode: "claude", mainCount: sanitised.mainCount, toBuy, legality: await legalityOf(db, deckId), notes: sanitised.dropped.length ? [`Ignored (not in pool): ${sanitised.dropped.join(", ")}`] : [] };
  }
  const r = await buildPokemonDeckWithClaude(db, { seedCardId: input.seedCardId, wish: input.wish, format: input.format, owner }, opts.deps ?? liveDeps);
  return { deckId: r.deckId, mode: "claude", mainCount: r.mainCount, toBuy: r.toBuy, legality: r.legality, notes: r.dropped.length ? [`Nicht gefunden, ausgelassen: ${r.dropped.join(", ")}`] : [] };
}

/**
 * "Neues Deck mit dieser Karte". Pokémon: a free deterministic draft (`mode: "draft"`, the default) or
 * Claude's (`mode: "claude"`). Dragon Ball: as it always was, Claude picks a Leader and drafts the deck
 * (`mode` can only be "claude").
 */
export async function buildDeckAroundCard(game: Game, cardId: string, opts: AroundOptions): Promise<BuildResult> {
  const { db, owner } = opts;
  const mode = opts.mode ?? (hasFreeDraft(game) ? "draft" : "claude");
  if (!gameInfo(game).deck.leader) {
    if (mode === "draft") {
      const r = await draftAroundPokemonCard(db, cardId, { owner, format: opts.format }, opts.deps ?? liveDeps);
      return { deckId: r.deckId, mode, mainCount: r.mainCount, toBuy: r.toBuy, legality: r.legality, notes: r.notes };
    }
    const r = await buildPokemonDeckWithClaude(db, { seedCardId: cardId, format: opts.format, owner }, opts.deps ?? liveDeps);
    return { deckId: r.deckId, mode, mainCount: r.mainCount, toBuy: r.toBuy, legality: r.legality, notes: r.dropped.length ? [`Nicht gefunden, ausgelassen: ${r.dropped.join(", ")}`] : [] };
  }
  if (mode === "draft") throw new Error(`${gameInfo(game).short} has no free draft: Claude builds the deck.`);
  await assertCardGame(db, cardId, game);
  const r = await suggestDeckFromCard(db, cardId, owner);
  return { deckId: r.deckId, mode, mainCount: r.mainCount, toBuy: r.toBuy, leaderName: r.leaderName, legality: await legalityOf(db, r.deckId), notes: [] };
}
