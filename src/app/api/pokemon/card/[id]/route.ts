import { db } from "@/db";
import { routeViewer } from "@/lib/auth";
import { cardPhotoIds } from "@/lib/collection/photos";
import { scopeFor } from "@/lib/collection/scope";
import { ownedLinesFor, wishedAmong } from "@/lib/pokemon/collection";
import { PRIVATE, pokemonErrorResponse } from "@/lib/pokemon/http";
import { getPokemonCard } from "@/lib/pokemon/tcgdex";
import { tcgdexIdOf } from "@/lib/pokemon/types";

// No `dynamic = "force-dynamic"`: it would turn every fetch into no-store and defeat the day cache of the TCGdex reads. Reading the session (cookies) already makes the route dynamic.
export const maxDuration = 30;

/**
 * `GET /api/pokemon/card/[id]`: one card read live (the id is TCGdex's, `sv03.5-006`, or the
 * catalog's `PKM-sv03.5-006`): `{ hit, details, variants, rarity, setId, setLogo, imageHigh,
 * owned: [{ printId, variant, language, quantity }], wished, photos: { [printId]: photoId } }`, the
 * last three being the viewer's own (`photos`: their own picture of a print they hold, if any).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const raw = decodeURIComponent((await ctx.params).id);
  const tcgdexId = tcgdexIdOf(raw) ?? raw;
  if (!/^[\w.%-]{1,64}$/.test(tcgdexId)) return Response.json({ error: "bad_request", message: "Unbekannte Karte." }, { status: 400, headers: PRIVATE });
  try {
    const record = await getPokemonCard(tcgdexId);
    const [owned, wished] = await Promise.all([ownedLinesFor(db, auth.viewer, record.hit.id), wishedAmong(db, auth.viewer, [record.hit.id])]);
    const { hit, details, variants, rarity, setId, setLogo, imageHigh } = record;
    const found = await cardPhotoIds(db, scopeFor(auth.viewer), { printIds: owned.map((o) => o.printId), prefer: auth.viewer.owner });
    return Response.json({ hit, details, variants, rarity, setId, setLogo, imageHigh, owned, wished: wished.length > 0, photos: Object.fromEntries(found.byPrint) }, { headers: PRIVATE });
  } catch (e) {
    return pokemonErrorResponse(e);
  }
}
