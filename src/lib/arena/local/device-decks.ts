/**
 * The names a player's deck goes by in the device pack (#793), shared by the server that builds the
 * pack (`src/lib/arena/offline-decks.ts`) and the device that lists and updates it.
 *
 * Browser-safe: no `node:`, no database, no auth.
 */
import { replayHash } from "../replay-core";
import type { DeckInput } from "../types";

/** The pack key of a player's deck: `deck-<id>`. The built-in starters keep their own keys (`A`, `B`). */
export const offlineDeckKey = (deckId: number) => `deck-${deckId}`;

/** The deck id of a pack key, or null for a built-in starter. */
export function deckIdOfKey(key: string): number | null {
  const m = /^deck-(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/**
 * The fingerprint of a deck list (`replayHash` of its `DeckInput`). The server reports the current
 * one; the device computes it from the deck it holds, and a difference means the list changed online.
 */
export const deckListHash = (deck: DeckInput): Promise<string> => replayHash({ name: deck.name, leader: deck.leader, main: deck.main, ...(deck.z?.length ? { z: deck.z } : {}) });
