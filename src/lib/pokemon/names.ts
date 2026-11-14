/**
 * Pokémon card names as people say, print and search them. Pure, shared by the spoken parser
 * (`voice.ts`) and the photo matcher (`scan-match.ts`).
 *
 * A card's rule-box suffix is part of its name in the source: German "Glurak-ex", English
 * "Charizard ex". A speech recogniser writes the same thing a dozen ways ("Glurak EX", "Glurak e x",
 * "Glurak ecks"), so every comparison goes through `foldName`.
 */

export const NAME_SUFFIXES = ["ex", "V", "VMAX", "VSTAR", "GX"] as const;
export type NameSuffix = (typeof NAME_SUFFIXES)[number];

const SUFFIX_BY_LOWER: Record<string, NameSuffix> = { ex: "ex", v: "V", vmax: "VMAX", vstar: "VSTAR", gx: "GX" };

/** Lower case, no accents ("ä" becomes "a", "ß" becomes "ss"). */
export function stripAccents(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** "Glurak-ex" gives { base: "Glurak", suffix: "ex" }; "Pikachu VMAX" gives { base: "Pikachu", suffix: "VMAX" }. */
export function splitNameSuffix(name: string): { base: string; suffix: NameSuffix | null } {
  const m = /^(.*?)[\s-]+(ex|v|vmax|vstar|gx)$/i.exec(name.trim());
  if (!m || !m[1].trim()) return { base: name.trim(), suffix: null };
  return { base: m[1].trim(), suffix: SUFFIX_BY_LOWER[m[2].toLowerCase()] };
}

/** The comparable form of a name: accents and case gone, hyphens as spaces, "ex" and "EX" the same word. */
export function foldName(name: string): string {
  return stripAccents(name)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** "glurak" becomes "Glurak", "mr mime" becomes "Mr Mime". Hyphens inside a word are kept ("ho-oh" becomes "Ho-Oh"). */
export function titleCase(s: string): string {
  return s.replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** The name as the source writes it: German joins the suffix with a hyphen, English with a space. */
export function displayName(base: string, suffix: NameSuffix | null, style: "hyphen" | "space"): string {
  if (!suffix) return base;
  return `${base}${style === "hyphen" ? "-" : " "}${suffix}`;
}
