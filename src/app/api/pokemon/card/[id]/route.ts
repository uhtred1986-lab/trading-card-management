import { db } from "@/db";
import { routeViewer } from "@/lib/auth";
import { ownedLinesFor, wishedAmong } from "@/lib/pokemon/collection";
import { PRIVATE, pokemonErrorResponse } from "@/lib/pokemon/http";
import { getPokemonCard } from "@/lib/pokemon/tcgdex";
import { tcgdexIdOf } from "@/lib/pokemon/types";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * `GET /api/pokemon/card/[id]`: one card read live (the id is TCGdex's, `sv03.5-006`, or the
 * catalog's `PKM-sv03.5-006`): `{ hit, details, variants, rarity, setId, setLogo, imageHigh,
 * owned: [{ printId, variant, language, quantity }], wished }`, the last two being the viewer's own.
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
    return Response.json({ hit, details, variants, rarity, setId, setLogo, imageHigh, owned, wished: wished.length > 0 }, { headers: PRIVATE });
  } catch (e) {
    return pokemonErrorResponse(e);
  }
}
