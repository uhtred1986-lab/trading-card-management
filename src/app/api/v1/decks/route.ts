import { db } from "@/db";
import { ok } from "@/lib/arena/api";
import { deckSummary, type DeckListPayload } from "@/lib/arena/deck-api";
import { deckInputFor } from "@/lib/arena/load";
import { currentOwner } from "@/lib/auth";
import { gameOr } from "@/lib/catalog/games";
import { listDecks } from "@/lib/decks/queries";

export const dynamic = "force-dynamic";

/**
 * The Android app's game-creation deck list (`docs/arena-android-spec.md` §7).
 * `game` defaults to `dbs`, same as `deckInputFor` — the only game the arena
 * plays — but another game may be asked for explicitly, listed as never
 * playable and saying why (`deckSummary`), never hidden. Filtered to the
 * caller's own decks plus every unowned one (issue #279) — same rule as the
 * web deck list, read off the same Basic Auth login `deckInputFor`'s caller
 * already authenticates through the proxy.
 */
export async function GET(req: Request) {
  const game = gameOr(new URL(req.url).searchParams.get("game"));
  const rows = await listDecks(db, { game, viewer: await currentOwner() });
  const decks = await Promise.all(rows.map(async (row) => deckSummary(row, (await deckInputFor(db, row.id)) !== null)));
  return ok({ decks } satisfies DeckListPayload);
}
