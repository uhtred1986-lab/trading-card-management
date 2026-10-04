"use server";

import { db } from "@/db";
import { currentScope, requireSignedIn } from "@/lib/auth";
import { deckCardStates } from "@/lib/arena/readiness";
import type { DeckPreviewCard } from "@/lib/arena/deck-preview";

/**
 * The cards of one deck with their rule states, read when the "See the cards"
 * sheet opens rather than with the page (#368). One query; a deck that is not
 * the viewer's answers with an empty list, like `getDeck`'s not found.
 */
export async function deckPreviewAction(deckId: number): Promise<DeckPreviewCard[]> {
  await requireSignedIn();
  if (!Number.isInteger(deckId) || deckId <= 0) return [];
  return deckCardStates(db, deckId, await currentScope());
}
