import { db } from "@/db";
import { currentScope, routeViewer } from "@/lib/auth";
import { canonicalJson } from "@/lib/arena/replay-core";
import { runtimeRevision } from "@/lib/arena/replay-bundle";
import { OfflineDeckRefused, buildDeviceOfflinePack, parseDeckIds } from "@/lib/arena/offline-decks";
import { mastersPackInput } from "../../../../../../scripts/build-arena-offline-pack.mts";

export const dynamic = "force-dynamic";

/**
 * The device's offline pack with the player's own decks (#793): `?decks=1,2` → the built-in
 * starters plus those decks, built from the app's database (the deck lists, the catalog and the
 * stored `card_rules` records) and pinned to THIS build's interpreter revision, in the same
 * `OfflinePack` format as the public starter pack (`/arena/offline/pack.json`) and under its id, so
 * installing it replaces the device's one pack atomically (`pack-store.ts`).
 *
 * Signed in, behind the proxy (no exemption: the download happens online), and scoped to the
 * looker (`currentScope()`): another player's deck answers 404 like a missing one. A deck that
 * cannot be played offline answers 409 with the blocking cards in plain words; nothing forces it.
 */
export async function GET(req: Request) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const ids = parseDeckIds(new URL(req.url).searchParams.get("decks"));
  if (!ids) return Response.json({ error: "bad_request", message: "decks must be a comma-separated list of deck ids" }, { status: 400 });
  const revision = runtimeRevision();
  if (!revision) return Response.json({ error: "no_revision", message: "This build has no interpreter revision, so it has no offline pack." }, { status: 404 });
  try {
    const pack = await buildDeviceOfflinePack(db, await currentScope(), ids, await mastersPackInput({ runtimeRevision: revision }));
    return new Response(canonicalJson(pack) + "\n", { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" } });
  } catch (e) {
    if (!(e instanceof OfflineDeckRefused)) throw e;
    const status = e.code === "not-found" ? 404 : e.code === "too-many" ? 400 : 409;
    return Response.json({ error: e.code, message: e.message, decks: e.checks }, { status, headers: { "cache-control": "private, no-store" } });
  }
}
