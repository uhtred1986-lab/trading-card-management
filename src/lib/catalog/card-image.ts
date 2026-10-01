/**
 * Smaller card art for small renders (issue #384).
 *
 * The catalog stores one full-size URL per card and the arena draws it with
 * `unoptimized` (no Vercel image-optimisation quota), so a 56 px board card
 * used to download the whole file. This maps a stored URL to a smaller variant
 * of the *same* image where the host publishes one, and returns it unchanged
 * otherwise. Stored URLs are never rewritten; this runs at render time only.
 *
 * - TCGplayer (`tcgplayer-cdn.tcgplayer.com/product/{id}_200w.jpg`, `_400w.jpg`,
 *   `_in_1000x1000.jpg`): the sizes are interchangeable suffixes. `fillMissingImages`
 *   stores the 1000 px one.
 * - deckplanet, Bandai, CardTrader: no smaller size exists (probed 1 Oct 2026:
 *   `_thumb`, `_small`, `_200w`, `/thumbnails/`, `.webp` ... all 404), so unchanged.
 */
export type CardImageSize = "thumb" | "medium" | "full";

const TCGPLAYER = /^(https:\/\/tcgplayer-cdn\.tcgplayer\.com\/product\/\d+)(?:_\d+w|_in_\d+x\d+)\.jpg(\?.*)?$/;
const SUFFIX: Record<CardImageSize, string> = { thumb: "_200w", medium: "_400w", full: "_in_1000x1000" };

/** Pick the size for a card drawn `cssWidth` CSS px wide (phones are 2-3x, so 200w covers up to ~90 px). */
export function cardImageSizeFor(cssWidth: number): CardImageSize {
  return cssWidth <= 90 ? "thumb" : "medium";
}

export function cardImage(url: string, size: CardImageSize): string;
export function cardImage(url: string | null | undefined, size: CardImageSize): string | null | undefined;
export function cardImage(url: string | null | undefined, size: CardImageSize): string | null | undefined {
  if (!url) return url;
  const m = TCGPLAYER.exec(url);
  if (!m) return url;
  return `${m[1]}${SUFFIX[size]}.jpg${m[2] ?? ""}`;
}
