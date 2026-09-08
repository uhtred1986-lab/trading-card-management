/**
 * The engine a new game is made on when the form or the API does not say.
 *
 * A setting rather than a constant, so the owner flips the default without a
 * deploy once the rules engine is proven — and never to an engine that cannot
 * play, so the setting can never strand the form.
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
