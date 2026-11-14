import { db } from "@/db";
import { routeViewer } from "@/lib/auth";
import { ownedCountsFor, wishedAmong } from "@/lib/pokemon/collection";
import { PRIVATE, pokemonErrorResponse } from "@/lib/pokemon/http";
import { searchPokemon } from "@/lib/pokemon/tcgdex";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/pokemon/search?q=&type=&category=&set=&page=`: cards at TCGdex, German and English
 * merged, with the *viewer's own* copy counts and wishes from the local database (an SL sees their
 * own as owner, never a player's). `{ hits, owned: { [cardId]: copies }, wished: [cardId] }`.
 */
export async function GET(req: Request) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const p = new URL(req.url).searchParams;
  const setId = p.get("set") ?? undefined;
  if (setId && !/^[\w.-]{1,32}$/.test(setId)) return Response.json({ error: "bad_request", message: "set?" }, { status: 400, headers: PRIVATE });
  try {
    const hits = await searchPokemon({ q: p.get("q") ?? undefined, type: p.get("type") ?? undefined, category: p.get("category") ?? undefined, setId, page: Number(p.get("page")) || 1 });
    const ids = hits.map((h) => h.id);
    const [owned, wished] = await Promise.all([ownedCountsFor(db, auth.viewer, ids), wishedAmong(db, auth.viewer, ids)]);
    return Response.json({ hits, owned, wished }, { headers: PRIVATE });
  } catch (e) {
    return pokemonErrorResponse(e);
  }
}
