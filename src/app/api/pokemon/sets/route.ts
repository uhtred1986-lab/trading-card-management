import { routeViewer } from "@/lib/auth";
import { PRIVATE, pokemonErrorResponse } from "@/lib/pokemon/http";
import { listPokemonSets } from "@/lib/pokemon/tcgdex";

// No `dynamic = "force-dynamic"`: it would turn every fetch into no-store and defeat the day cache of the TCGdex reads. Reading the session (cookies) already makes the route dynamic.
export const maxDuration = 30;

/** `GET /api/pokemon/sets`: every set, newest first, with its logo: `{ sets: PokemonSetInfo[] }`. The empty search screen. */
export async function GET() {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  try {
    return Response.json({ sets: await listPokemonSets() }, { headers: { ...PRIVATE, "cache-control": "private, max-age=3600" } });
  } catch (e) {
    return pokemonErrorResponse(e);
  }
}
