/**
 * Wraps a data import in a `sync_runs` row so the settings page can show when
 * the catalog/prices were last refreshed and whether it worked.
 */
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { syncRuns } from "@/db/schema";

export type SyncSource = "catalog" | "prices" | "fx" | "cardtrader" | "meta";

export async function runSync<T>(db: Db, source: SyncSource, fn: () => Promise<T>): Promise<T> {
  const [run] = await db.insert(syncRuns).values({ source, status: "running" }).returning({ id: syncRuns.id });
  try {
    const summary = await fn();
    await db
      .update(syncRuns)
      .set({ status: "ok", finishedAt: new Date(), summary: summary as object })
      .where(eq(syncRuns.id, run.id));
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(syncRuns)
      .set({ status: "error", finishedAt: new Date(), error: message })
      .where(eq(syncRuns.id, run.id));
    throw err;
  }
}

export async function lastSyncRuns(db: Db) {
  const rows = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(30);
  const latest = new Map<SyncSource, (typeof rows)[number]>();
  for (const r of rows) {
    const s = r.source as SyncSource;
    if (!latest.has(s)) latest.set(s, r);
  }
  return { latest, recent: rows };
}
