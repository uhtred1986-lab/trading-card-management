/**
 * The engine a new game is made on when the form or the API does not say.
 *
 * A setting rather than a constant, so the owner moves the default without a
 * deploy — and never to an engine that cannot play, so the setting can never
 * strand the form. Since #166 the constant it falls back to is `rules`, which
 * makes this the way back to `legacy` rather than the way forward to `rules`;
 * that is the whole reason the setting stays after the flip.
 *
 * A stored value the code no longer recognises, or one for an engine that has
 * stopped being available, falls back to the constant. What it does **not**
 * decide is a mode the chosen engine is not built for: `games.ts`'s
 * `engineForMode` resolves that at the creation paths, so this answer is a
 * preference rather than a promise.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { settings } from "@/db/schema";
import { DEFAULT_ENGINE, ENGINE_INFO, EngineNotBuilt, isEngineId, type EngineId } from "./engines";

export async function defaultEngine(db: Db): Promise<EngineId> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "arena") });
  const v = (row?.value as { engine?: unknown } | null)?.engine;
  return isEngineId(v) && ENGINE_INFO[v].available ? v : DEFAULT_ENGINE;
}

export async function setDefaultEngine(db: Db, id: EngineId): Promise<void> {
  if (!ENGINE_INFO[id].available) throw new EngineNotBuilt(id);
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "arena") });
  const value = { ...((row?.value as Record<string, unknown> | null) ?? {}), engine: id };
  if (row) await db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, "arena"));
  else await db.insert(settings).values({ key: "arena", value });
}
