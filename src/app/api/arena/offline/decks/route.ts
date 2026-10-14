import { db } from "@/db";
import { currentScope, routeViewer } from "@/lib/auth";
import { checkOfflineDecks, parseDeckIds } from "@/lib/arena/offline-decks";

export const dynamic = "force-dynamic";

/**
 * Whether each of `?ids=1,2` can go offline (#793): ready, or the cards that block it in plain
 * words, and the list's current fingerprint, so the device can say when a deck it holds changed
 * online. Scoped to the looker (`currentScope()`): a deck that is not theirs is simply absent.
 */
export async function GET(req: Request) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const ids = parseDeckIds(new URL(req.url).searchParams.get("ids"));
  if (!ids) return Response.json({ error: "bad_request", message: "ids must be a comma-separated list of deck ids" }, { status: 400 });
  const checks = await checkOfflineDecks(db, await currentScope(), ids.slice(0, 50));
  return Response.json({ decks: [...checks.values()] }, { headers: { "cache-control": "private, no-store" } });
}
