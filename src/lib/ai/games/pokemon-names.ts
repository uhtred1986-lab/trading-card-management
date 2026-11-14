/**
 * A guard against a model pairing a real card id with another card's name.
 *
 * Seen in the first live run (14 Nov 2026): the wizard proposed "Wunderbonbon" (Rare Candy) with the
 * id `PKM-sv03.5-191`, which is Rossana-ex, and "Professors Forschung" with the id of Geowaz-ex. Both
 * ids exist, so nothing rejected them, and the player would have seen a swap whose picture and reason
 * disagreed. The model had the right ids for another set in mind (`sv01-191`, `sv01-189`).
 *
 * So wherever the model names a card to add, it also says the card's name, and the two are compared
 * with what the card really is. When they disagree the name wins: the card is looked up by name at the
 * live source (the model's reasoning is about the named card), and when that finds nothing the entry is
 * dropped rather than shown wrong.
 */
import { PokemonSourceError, type PokemonCardRecord } from "@/lib/pokemon/tcgdex";
import { pokemonDetails, type PokemonFormat } from "@/lib/pokemon/types";
import type { PokemonSource } from "./pokemon-source";

/** Lower case, accents and everything but letters and digits removed: "Glurak-ex" and "glurak ex" are one name. */
export function foldCardName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Every name a stored or read card goes by: its own and the German and English ones in its details. */
export function cardNames(card: { name: string; details?: unknown }): string[] {
  const names = pokemonDetails(card.details).names ?? {};
  return [card.name, names.de, names.en].filter((n): n is string => typeof n === "string" && n.trim().length > 0);
}

/**
 * Whether what the model called the card is one of the card's names. Folded and exact; a longer said
 * name may also carry the set in brackets or a suffix ("Glurak-ex (151)"), so the card's name at the
 * start of the said one counts when the card's name is at least four letters.
 */
export function nameAgrees(said: string, names: string[]): boolean {
  const s = foldCardName(said);
  if (!s) return false;
  return names.some((n) => {
    const f = foldCardName(n);
    return f.length > 0 && (f === s || (f.length >= 4 && s.startsWith(f) && s.length - f.length <= 12 && !/^(ex|v|vmax|vstar|gx)/.test(s.slice(f.length))));
  });
}

/**
 * The card a name stands for, read from the live source: an exact name match (either language),
 * preferring one that is legal in the deck's format, then the first found (the source's order is
 * picture first, newest set first). A name that is slightly off ("Professors Forschung" for
 * "Forschung des Professors" is not, "Ultra Ball" for "Ultraball" is) still counts when every card the
 * search finds that contains it, or is contained in it, has one and the same name: an unambiguous near
 * match, never a guess between two cards. Null when nothing fits or the source is down.
 */
export async function cardForName(source: PokemonSource, said: string, format: PokemonFormat | string): Promise<PokemonCardRecord | null> {
  const want = foldCardName(said);
  if (want.length < 3) return null;
  try {
    const found = await source.search({ q: said });
    const namesOf = (h: (typeof found)[number]) => [h.name, h.altName].filter((n): n is string => !!n).map(foldCardName);
    let hits = found.filter((h) => namesOf(h).includes(want));
    if (!hits.length && want.length >= 5) {
      const near = found.filter((h) => namesOf(h).some((n) => n.length >= 5 && (n.includes(want) || want.includes(n))));
      if (new Set(near.map((h) => foldCardName(h.name))).size === 1) hits = near;
    }
    hits = hits.slice(0, 5);
    let first: PokemonCardRecord | null = null;
    for (const h of hits) {
      const rec = await source.get(h.tcgdexId);
      first ??= rec;
      if (rec.details.legal?.[format as PokemonFormat] === true) return rec;
    }
    return first;
  } catch (err) {
    if (err instanceof PokemonSourceError) return null;
    throw err;
  }
}
