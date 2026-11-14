/**
 * The decks the add screens offer: the viewer's own Pokémon decks (a player sees only theirs, an SL
 * every one), and the one the `?deck=` parameter names when it is among them.
 */
import { db } from "@/db";
import { currentScope } from "@/lib/auth";
import { deckOptions } from "@/lib/decks/add";

export interface PokemonDeckChoice {
  id: number;
  name: string;
}

export async function pokemonDeckChoices(): Promise<PokemonDeckChoice[]> {
  const scope = await currentScope();
  const rows = await deckOptions(db, { game: "pokemon", scope });
  return rows.map((d) => ({ id: d.id, name: d.name }));
}

/** The deck id from `?deck=`, only when it is one of `choices`; otherwise null. */
export function deckFromParam(param: string | string[] | undefined, choices: PokemonDeckChoice[]): number | null {
  const raw = Array.isArray(param) ? param[0] : param;
  const id = Number(raw);
  return Number.isInteger(id) && choices.some((d) => d.id === id) ? id : null;
}
