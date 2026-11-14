/**
 * Shared by the `/api/pokemon/*` route handlers: how a source failure answers. The handlers
 * themselves open with `routeViewer()` (scripts/verify/guards.ts).
 */
import { PokemonSourceError } from "./tcgdex";
import { PokemonInputError } from "./collection";

export const PRIVATE = { "cache-control": "private, no-store" } as const;

/** 503 "unavailable" for a source that did not answer, 404 for a card it does not have, 400 for a bad ask; anything else is thrown on. */
export function pokemonErrorResponse(e: unknown): Response {
  if (e instanceof PokemonSourceError) {
    if (e.kind === "not_found") return Response.json({ error: "not_found", message: "Diese Karte gibt es nicht." }, { status: 404, headers: PRIVATE });
    return Response.json({ error: "source_unavailable", message: "Die Kartensuche ist gerade nicht erreichbar." }, { status: 503, headers: { ...PRIVATE, "retry-after": "30" } });
  }
  if (e instanceof PokemonInputError) return Response.json({ error: "bad_request", message: e.message }, { status: 400, headers: PRIVATE });
  throw e;
}
