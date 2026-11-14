/**
 * The live card source for pasted deck lists: what `importPokemonDeckList` is given in production.
 *
 * A printed set code ("OBF", "PAL") is not the source's set id ("sv03", "sv02"); TCGdex answers
 * `sets?abbreviation.official=OBF` with the set, so one cheap read (cached a day like every source read)
 * turns the code of a line into the set the card is searched in. A code the source does not know, or an
 * answer of several sets, gives null and the line falls back to name and number.
 */
import { loadPokemonCard } from "./store";
import { PokemonSourceError, SOURCE_REVALIDATE_SECONDS, searchPokemon } from "./tcgdex";
import type { DeckListSource } from "./deck-data";

const BASE = "https://api.tcgdex.net/v2/en/sets";

export async function tcgdexSetIdForCode(code: string): Promise<string | null> {
  if (!/^[A-Za-z0-9-]{2,12}$/.test(code)) return null;
  let res: Response;
  try {
    res = await fetch(`${BASE}?abbreviation.official=${encodeURIComponent(code)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000), next: { revalidate: SOURCE_REVALIDATE_SECONDS } });
  } catch (e) {
    throw new PokemonSourceError(`TCGdex is not reachable: ${e instanceof Error ? e.message : String(e)}`, "unavailable");
  }
  if (!res.ok) return null;
  const list = (await res.json().catch(() => null)) as { id?: string }[] | null;
  return Array.isArray(list) && list.length === 1 && typeof list[0]?.id === "string" ? list[0].id : null;
}

export const liveDeckListSource: DeckListSource = {
  search: (p) => searchPokemon({ q: p.q, category: p.category, setId: p.setId }),
  setIdForCode: tcgdexSetIdForCode,
  load: loadPokemonCard,
};
