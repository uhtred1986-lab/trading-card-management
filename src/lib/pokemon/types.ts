/**
 * Shared shapes for the Pokémon game (docs/pokemon/plan.md). Pokémon has no
 * imported catalog: cards are searched live at TCGdex and a row is written to
 * `cards` / `card_prints` only when a lot, a deck line or a wish refers to it.
 *
 * This file is types and pure helpers only, so client components, server code
 * and the `assert` scripts can all import it.
 */

/** Languages the Pokémon screens search and store. */
export const POKEMON_LANGS = ["de", "en"] as const;
export type PokemonLang = (typeof POKEMON_LANGS)[number];

/** The variants a card can be owned in; the print suffix. "normal" is the base print (suffix ""). */
export const POKEMON_VARIANTS = ["normal", "holo", "reverse", "firstEdition", "wPromo"] as const;
export type PokemonVariant = (typeof POKEMON_VARIANTS)[number];

/** `cards.card_type` values for Pokémon (GAME_INFO.pokemon.cardTypes). */
export type PokemonCategory = "POKEMON" | "TRAINER" | "ENERGY";

export const POKEMON_FORMATS = ["standard", "expanded"] as const;
export type PokemonFormat = (typeof POKEMON_FORMATS)[number];

export interface PokemonAttack {
  name: string;
  /** Energy symbols of the cost, in the source's language ("Feuer", "Fire"). */
  cost: string[];
  damage: string | null;
  effect: string | null;
}

/** What `cards.details` holds for a Pokémon card. Every field is optional in old rows: read defensively. */
export interface PokemonDetails {
  /** TCGdex card id, e.g. "sv03.5-006". */
  tcgdexId: string;
  /** Collector number as printed ("006") and the set's official size (165), for "006/165". */
  localId: string;
  setTotal: number | null;
  /** The name in each language the source has it in. `cards.name` is the German name when there is one, else English. */
  names: Partial<Record<PokemonLang, string>>;
  setNames: Partial<Record<PokemonLang, string>>;
  /** Language-neutral, for rules: "Basic" | "Stage1" | "Stage2" | … for Pokémon; the trainer or energy kind otherwise. */
  stage: string | null;
  /** True for a basic Energy card, which the 4-copy rule does not limit. */
  basicEnergy: boolean;
  /** "ACE SPEC" / "Radiant": one per deck. Null for ordinary cards. */
  onePerDeck: "ace-spec" | "radiant" | null;
  hp: number | null;
  /** English names of the card this evolves from, for finding the line. */
  evolveFrom: string | null;
  abilities: { name: string; effect: string | null }[];
  attacks: PokemonAttack[];
  weakness: string | null;
  retreat: number | null;
  regulationMark: string | null;
  legal: Record<PokemonFormat, boolean>;
  dexIds: number[];
  /** Display strings in German where the source has them (type names, stage label, rarity). */
  display: { types: string[]; stage: string | null; rarity: string | null };
}

/** One card in a live search result or the viewer. Carries everything a tile and the swipe viewer show. */
export interface PokemonHit {
  /** Catalog id this card has or would have: `PKM-` + TCGdex id. */
  id: string;
  tcgdexId: string;
  /** Name in the language that matched, and the other one when known. */
  name: string;
  altName: string | null;
  setName: string;
  localId: string;
  setTotal: number | null;
  category: PokemonCategory;
  types: string[];
  /** Image base URL at the source; `pokemonImage(hit.image, "low" | "high")` makes it loadable. Null when the source has no scan. */
  image: string | null;
  /** Cardmarket trend and low in integer EUR cents, when the search result carries them (detail reads always do). */
  priceCents: number | null;
  lowCents: number | null;
  variants: PokemonVariant[];
  legal: Record<PokemonFormat, boolean> | null;
}

const PREFIX = "PKM-";

/** Catalog card id for a TCGdex id: `PKM-sv03.5-006`. */
export function pokemonCardId(tcgdexId: string): string {
  return PREFIX + tcgdexId;
}

/** Print id: the base print is the card id; others add `_variant` (`PKM-sv03.5-006_holo`). Language lives on the lot (`owned_cards.language`). */
export function pokemonPrintId(tcgdexId: string, variant: PokemonVariant): string {
  return variant === "normal" ? pokemonCardId(tcgdexId) : `${pokemonCardId(tcgdexId)}_${variant}`;
}

export function isPokemonCardId(id: string): boolean {
  return id.startsWith(PREFIX);
}

/** The TCGdex id inside a catalog card or print id, or null when the id is not a Pokémon one. */
export function tcgdexIdOf(id: string): string | null {
  if (!isPokemonCardId(id)) return null;
  const rest = id.slice(PREFIX.length);
  const cut = rest.lastIndexOf("_");
  return cut > 0 && (POKEMON_VARIANTS as readonly string[]).includes(rest.slice(cut + 1)) ? rest.slice(0, cut) : rest;
}

/** Loadable image URL from the source's base URL. `low` is about 245 px wide (tiles), `high` about 600 px (viewer). */
export function pokemonImage(base: string | null | undefined, size: "low" | "high" = "low"): string | null {
  return base ? `${base}/${size}.webp` : null;
}

/** Reads `cards.details` as Pokémon details without trusting its shape. */
export function pokemonDetails(details: unknown): Partial<PokemonDetails> {
  return details && typeof details === "object" ? (details as Partial<PokemonDetails>) : {};
}
