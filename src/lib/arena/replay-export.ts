import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaGames } from "@/db/schema";
import { readReplayBundle, runtimeRevision } from "./replay-bundle";
import { isVersus, seatOf } from "./games";
import type { Viewer } from "@/lib/auth";

export type ReplayExportResult =
  | { kind: "not_found" }
  | { kind: "contract_mismatch"; message: string }
  | { kind: "ok"; body: Record<string, unknown> };

/** Read a viewer-safe admin export, checking a versus seat before private inputs or bundle bytes. */
export async function loadReplayExport(db: Db, id: number, viewer: Pick<Viewer, "kind" | "login">): Promise<ReplayExportResult> {
  if (viewer.kind !== "sl") return { kind: "not_found" };
  const [access] = await db.select({ mode: arenaGames.mode, p1User: arenaGames.p1User, p2User: arenaGames.p2User })
    .from(arenaGames).where(eq(arenaGames.id, id)).limit(1);
  if (!access) return { kind: "not_found" };
  if (isVersus(access.mode) && !seatOf(access, viewer.login)) return { kind: "not_found" };

  const [row] = await db.select({
    id: arenaGames.id,
    mode: arenaGames.mode,
    seed: arenaGames.seed,
    engine: arenaGames.engine,
    actions: arenaGames.actions,
    rulesBundleHash: arenaGames.rulesBundleHash,
    replayDecks: arenaGames.replayDecks,
  }).from(arenaGames).where(eq(arenaGames.id, id)).limit(1);
  if (!row) return { kind: "not_found" };

  if (!row.rulesBundleHash) {
    return { kind: "ok", body: {
      format: 1,
      gameId: row.id,
      exact: false,
      reason: "This historical match predates immutable rule bundles. Its original deck and rule inputs were not saved, so this export is not an exact replay.",
      seed: row.seed,
      engine: row.engine,
      actions: row.actions,
    } };
  }
  if (!row.replayDecks) return { kind: "contract_mismatch", message: "the pinned match is missing its initial deck inputs" };
  const bundle = await readReplayBundle(db, row.rulesBundleHash);
  if (!bundle) return { kind: "contract_mismatch", message: "the pinned rules bundle is missing" };
  const currentRuntime = runtimeRevision();
  const exact = !!bundle.runtimeRevision && !!currentRuntime && bundle.runtimeRevision === currentRuntime;
  return { kind: "ok", body: {
    format: 1,
    gameId: row.id,
    exact,
    ...(exact ? {} : { reason: !bundle.runtimeRevision || !currentRuntime
      ? "The interpreter source revision is unknown, so this bundle cannot claim an exact replay."
      : "This bundle was created by a different interpreter revision. Use that revision to replay it exactly." }),
    seed: row.seed,
    engine: row.engine,
    actions: row.actions,
    decks: row.replayDecks,
    bundle,
  } };
}
