import { canonicalJson } from "@/lib/arena/replay-core";
import { runtimeRevision } from "@/lib/arena/replay-bundle";
import { buildMastersPack } from "../../../../../scripts/build-arena-offline-pack.mts";

/**
 * The curated offline deck pack (#660): the two Masters starter decks (SD15 and SD5), built at
 * deploy time by `scripts/build-arena-offline-pack.mts` from the committed catalog snapshot, the
 * repo's rulesets and compiler, pinned to THIS build's interpreter revision — so the shell and the
 * pack of one deploy always agree (`shellRefusal`).
 *
 * Public by construction: card names, card text, compiled rules and the public card-art URLs, none
 * of it from a database or a viewer. `force-static`: the response is a file of the build, the
 * handler never runs on a request. Exempt from sign-in in `src/proxy.ts`, like the shell page that
 * downloads it. A build with no revision (local development) has no pack: 404, and the preparation
 * panel says so.
 */
export const dynamic = "force-static";
export const revalidate = false;

export async function GET() {
  const revision = runtimeRevision();
  if (!revision) return new Response("No offline pack: this build has no interpreter revision.", { status: 404 });
  const pack = await buildMastersPack({ runtimeRevision: revision });
  if (!pack.qualification.playable) throw new Error(`the curated pack is not playable: ${pack.qualification.reasons.join("; ")}`);
  return new Response(canonicalJson(pack) + "\n", { headers: { "content-type": "application/json; charset=utf-8" } });
}
