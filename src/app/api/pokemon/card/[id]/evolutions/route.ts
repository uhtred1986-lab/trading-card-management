import { routeViewer } from "@/lib/auth";
import { loadEvolutions } from "@/lib/pokemon/evolutions";
import { PRIVATE, pokemonErrorResponse } from "@/lib/pokemon/http";
import { getPokemonCard } from "@/lib/pokemon/tcgdex";
import { tcgdexIdOf } from "@/lib/pokemon/types";

// No `dynamic = "force-dynamic"`: it would turn every fetch into no-store and defeat the day cache of the TCGdex reads.
export const maxDuration = 30;

/**
 * `GET /api/pokemon/card/[id]/evolutions`: the cards around one card's evolution line, read live
 * (`src/lib/pokemon/evolutions.ts`): `{ from: PokemonHit | null, into: PokemonHit[] }`. Nothing here is the
 * viewer's own, so it reads no database; the detail sheet asks for it when it opens and shows nothing
 * when this answers 503 (the source is down).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const raw = decodeURIComponent((await ctx.params).id);
  const tcgdexId = tcgdexIdOf(raw) ?? raw;
  if (!/^[\w.%-]{1,64}$/.test(tcgdexId)) return Response.json({ error: "bad_request", message: "Unbekannte Karte." }, { status: 400, headers: PRIVATE });
  try {
    const record = await getPokemonCard(tcgdexId);
    return Response.json(await loadEvolutions(record), { headers: PRIVATE });
  } catch (e) {
    return pokemonErrorResponse(e);
  }
}
