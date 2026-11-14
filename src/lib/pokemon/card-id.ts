/**
 * The codes printed at the bottom of a Pokémon card, as a search sees them. Pure; covered by
 * scripts/verify/pokemon-input.mts and pokemon-tcgdex.mts.
 *
 * Two kinds, and a short text can be either:
 *  - a printed set code plus the collector number ("MEW 006/165": the set "151", TCGdex id sv03.5);
 *  - a collector ID with letters in it ("SWSH062", "TG12/TG30", "GG01", "SV001", "RC5"), which
 *    TCGdex stores as the card's `localId`.
 *
 * "MEW 6" and "TG 12" look alike, so `parseCardIdQuery` only reads the shape and says how it was
 * written; `searchPokemon` tries the readings in the order `readingOrder` gives and falls back to
 * the name when none finds a card (Mew is also a Pokémon).
 */

/** Prefixes of collector IDs the source uses (promos, galleries, shiny vaults, radiant collection). A spoken "SWSH null sechs zwei" is an ID because SWSH is one of these. */
export const ID_PREFIXES: ReadonlySet<string> = new Set(["SWSH", "SV", "SVP", "SM", "XY", "BW", "HGSS", "DP", "TG", "GG", "RC", "SL", "NP", "PR"]);

export interface CardIdQuery {
  /** The letters, upper case: "MEW", "SWSH", "TG". */
  letters: string;
  /** The digits as written, zeros kept: "006", "62", "12". */
  digits: string;
  /** The collector number: 6, 62, 12. */
  number: number;
  /** Letters and digits were written with a space between ("MEW 6"), not run together ("SWSH062"). */
  spaced: boolean;
  /** The letters were written in capitals: the sign that a code was meant and not a name ("MEW" against "Mew"). */
  caps: boolean;
  /** The set size after the slash ("6/165" gives 165, "TG12/TG30" gives 30), when there is one. */
  size: number | null;
  /** The size carried letters ("TG30"): that is how a collector ID is printed, a set code never has it. */
  sizeLetters: string;
}

const LANGUAGE_TOKENS = "EN|DE|FR|IT|ES|PT|JA|JP|KO|ZH|NL|PL|RU";

/**
 * "MEW 6", "MEW 006/165", "PAL EN 001/193", "SWSH062", "TG12", "TG12/TG30", "sv001". Null when the
 * whole text is not letters followed by a number: a name ("Glurak"), a bare number ("6/165"), a
 * name with a number ("Glurak ex 6": too long to be a code) or a name with digits ("Porygon2").
 */
export function parseCardIdQuery(q: string | null | undefined): CardIdQuery | null {
  const text = (q ?? "").trim().replace(/^#/, "").replace(/\s+/g, " ").slice(0, 40);
  const m = new RegExp(`^([A-Za-z]{1,5})(?:( )(?:${LANGUAGE_TOKENS}) )? ?(\\d{1,4})(?: ?/ ?([A-Za-z]{0,5}) ?(\\d{1,4}))?$`, "i").exec(text);
  if (!m) return null;
  const letters = m[1].toUpperCase();
  const digits = m[3];
  const number = parseInt(digits, 10);
  if (number < 1) return null;
  const spaced = /^[A-Za-z]{1,5} /.test(text);
  return { letters, digits, number, spaced, caps: m[1] === m[1].toUpperCase(), size: m[5] ? parseInt(m[5], 10) : null, sizeLetters: (m[4] ?? "").toUpperCase() };
}

/** The `localId` spellings the source may use for one collector ID, most likely first: as written, then padded to three and two digits, then bare. */
export function localIdCandidates(letters: string, digits: string): string[] {
  const n = String(parseInt(digits, 10));
  const forms = [digits, n.padStart(3, "0"), n.padStart(2, "0"), n];
  return [...new Set(forms.map((d) => `${letters.toUpperCase()}${d}`))];
}

/** The number spellings of a plain collector number inside a set ("006" in sv03.5, "4" in base1), most likely first. */
export function numberCandidates(digits: string): string[] {
  const n = String(parseInt(digits, 10));
  return [...new Set([n.padStart(3, "0"), n, n.padStart(2, "0"), digits])];
}

/** Which readings to try for a query, in order; "name" means the plain name search comes first and the codes only when it finds nothing. */
export function readingOrder(q: CardIdQuery): ("name" | "set" | "id")[] {
  // "TG12/TG30": letters on the size too, so a collector ID and nothing else.
  if (q.sizeLetters) return ["id"];
  // "SWSH062": run together, so an ID first.
  if (!q.spaced) return ["id", "set"];
  // "MEW 6": capitals mean the code; "Mew 6" is the name, and the code only if no Mew has that number.
  return q.caps ? ["set", "id"] : ["name", "set", "id"];
}
