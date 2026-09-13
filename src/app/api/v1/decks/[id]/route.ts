import { db } from "@/db";
import { fail, ok } from "@/lib/arena/api";
import { deckDetail } from "@/lib/arena/deck-api";
import { deckInputFor } from "@/lib/arena/load";
import { getDeck } from "@/lib/decks/queries";

export const dynamic = "force-dynamic";

/**
 * The Android app's read-only deck screen (`docs/arena-android-spec.md` §7):
 * zones, counts, and the same per-card flags the web deck page highlights.
 * Never an edit affordance — the contract forbids a write endpoint here.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "deck id must be a number");
  const deck = await getDeck(db, id);
  if (!deck) return fail("not_found", `no deck ${id}`);
  const playable = (await deckInputFor(db, id)) !== null;
  return ok(deckDetail(deck, playable));
}
