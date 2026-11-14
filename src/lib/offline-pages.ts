/**
 * The pages the service worker keeps for reading with no network (`readableArea` in `public/sw.js`,
 * which is a plain file and cannot import this: `scripts/verify/offline-reading.mts` fails when the
 * two disagree). The pages show a notice while offline (`OfflineNotice`); everything else behaves as
 * it always did.
 */

/** The worker's per-person cache (`PAGES_CACHE` in `public/sw.js`); a sign-in page deletes it from the page side too. */
export const OFFLINE_PAGES_CACHE = "dbs-offline-pages-v1";

/** "pokemon" for the Pokémon pages (German), "dbs" for the Dragon Ball ones, else null. */
export function readableArea(path: string): "pokemon" | "dbs" | null {
  if (path === "/pokemon" || path === "/pokemon/wishes" || path === "/pokemon/decks") return "pokemon";
  if (/^\/pokemon\/decks\/[^/]+$/.test(path) && path !== "/pokemon/decks/new") return "pokemon";
  if (path === "/collection" || path === "/decks") return "dbs";
  if (/^\/decks\/\d+$/.test(path)) return "dbs";
  return null;
}

export const isReadableOffline = (path: string) => readableArea(path) !== null;
export const isPokemonReadable = (path: string) => readableArea(path) === "pokemon";
