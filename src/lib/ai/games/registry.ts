/**
 * The adapters keyed by game: one module per game (`dbs.ts`, `fusion.ts`, `pokemon.ts`) behind
 * `adapterFor`. Kept apart from `index.ts` (which also exports the deck builders) so `deck.ts` can
 * import it without a cycle.
 */
import { gameOr, type Game } from "@/lib/catalog/games";
import { dbsAdapter } from "./dbs";
import { fusionAdapter } from "./fusion";
import { pokemonAdapter } from "./pokemon";
import type { GameAdapter } from "./types";

const ADAPTERS: Record<Game, GameAdapter> = {
  dbs: dbsAdapter,
  fusion: fusionAdapter,
  pokemon: pokemonAdapter(),
};

/** The adapter of a game (an unknown value is Dragon Ball, as `gameOr` does everywhere). */
export function adapterFor(game: unknown): GameAdapter {
  return ADAPTERS[gameOr(game)];
}
