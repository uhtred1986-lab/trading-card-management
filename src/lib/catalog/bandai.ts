/**
 * Fusion World card art from Bandai's own card list
 * (https://www.dbs-cardgame.com/fw/en/cardlist/). deckplanet's image bucket
 * has no Fusion World cards at all, so this is that game's primary art source;
 * the TCGplayer product photo the price sync copies across stays the fallback
 * for the alternate prints Bandai does not show.
 *
 * Verified 4 Sep 2026: images sit at a predictable URL — the card number, with
 * "_f"/"_b" for a leader's front and awakened back, and "_p1", "_p2", … for
 * alternate prints — and the host checks neither User-Agent nor Referer. Not
 * every print in deckplanet's list exists there (deckplanet knows ~1,980
 * alternate prints, Bandai shows ~1,290), so rather than guess URLs and have
 * the grid show a placeholder on a 404, the card list pages are crawled once
 * per sync for the exact set of image names, and a print gets a URL only when
 * its name is in that set.
 */
import type { ShapedCatalog } from "./deckplanet";

export const BANDAI_FW_IMAGE_BASE = "https://www.dbs-cardgame.com/fw/images/cards/card/en/";
const CARDLIST_URL = "https://www.dbs-cardgame.com/fw/en/cardlist/";
const HEADERS = { "user-agent": "Mozilla/5.0 (compatible; dbs-companion)" };

export function officialImageUrl(name: string): string {
  return `${BANDAI_FW_IMAGE_BASE}${encodeURIComponent(name)}.webp`;
}

/** deckplanet's print suffix → Bandai's: "" → "", "PR" → "_p1", "PR2" → "_p2"; anything else is unknown. */
function officialSuffix(suffix: string): string | null {
  if (!suffix) return "";
  const m = /^PR(\d*)$/i.exec(suffix);
  return m ? `_p${m[1] || "1"}` : null;
}

/**
 * The image name for one print, or null when Bandai has none. Leaders carry
 * "_f" before the print suffix ("FB01-001_f_p1"); other cards nothing.
 */
export function officialImageName(cardId: string, suffix: string, names: ReadonlySet<string>): string | null {
  const p = officialSuffix(suffix);
  if (p == null) return null;
  for (const face of ["", "_f"]) {
    const n = `${cardId}${face}${p}`;
    if (names.has(n)) return n;
  }
  return null;
}

/**
 * A leader's awakened side, "<number>_b". The list pages show fronts only, so
 * a back is inferred from the front's "_f" and confirmed later with a HEAD
 * request (`verifyBackImages`), the same way the original game's are.
 */
export function officialBackImageName(cardId: string, names: ReadonlySet<string>): string | null {
  return names.has(`${cardId}_f`) ? `${cardId}_b` : null;
}

/** Series ids from the card list's filter, so a new set is picked up without a code change. */
export function parseSeriesIds(html: string): string[] {
  return [...new Set([...html.matchAll(/data-val="(\d{4,})"/g)].map((m) => m[1]))];
}

export function parseImageNames(html: string): string[] {
  return [...html.matchAll(/images\/cards\/card\/en\/([A-Za-z0-9_-]+)\.webp/g)].map((m) => m[1]);
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Bandai card list ${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/** Every image name Bandai's card list shows, across all series (~30 requests). */
export async function fetchOfficialImageNames(concurrency = 6): Promise<Set<string>> {
  const series = parseSeriesIds(await getText(CARDLIST_URL));
  if (!series.length) throw new Error("Bandai card list: no series filter found — has the page changed?");
  const names = new Set<string>();
  let next = 0;
  const worker = async () => {
    while (next < series.length) {
      const id = series[next++];
      for (const n of parseImageNames(await getText(`${CARDLIST_URL}?search=true&category[]=${id}`))) names.add(n);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, series.length) }, worker));
  if (!names.size) throw new Error("Bandai card list: no card images found — has the page changed?");
  return names;
}

export interface OfficialImageSummary {
  prints: number;
  cards: number;
  backs: number;
}

/**
 * Writes Bandai URLs onto a shaped Fusion World catalog. Prints Bandai lacks
 * stay null, so the price sync's `fillMissingImages` can still supply
 * TCGplayer's photo for them; the original game is left untouched.
 */
export function applyOfficialImages(shaped: ShapedCatalog, names: ReadonlySet<string>): OfficialImageSummary {
  const out: OfficialImageSummary = { prints: 0, cards: 0, backs: 0 };
  if (shaped.game !== "fusion") return out;
  const frontByCard = new Map<string, string>();
  for (const p of shaped.prints) {
    const n = officialImageName(p.cardId, p.suffix, names);
    if (!n) continue;
    p.imageUrl = officialImageUrl(n);
    out.prints++;
    if (p.isBase) frontByCard.set(p.cardId, p.imageUrl);
  }
  for (const c of shaped.cards) {
    const front = frontByCard.get(c.id);
    if (front) {
      c.imageUrl = front;
      out.cards++;
    }
    const back = officialBackImageName(c.id, names);
    if (back) {
      c.backImageUrl = officialImageUrl(back);
      out.backs++;
    }
  }
  return out;
}
