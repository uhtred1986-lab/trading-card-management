/** The database half of the AI settings (#516): read and write the single `ai_settings` row. */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { aiSettings } from "@/db/schema";
import { forgetAvailability } from "./router";
import { invalidateSettings, rowFromSettings, settingsFromRow, setSettingsLoader, type AiSettings } from "./settings";

const ROW = 1;

export async function loadSettings(db: Db): Promise<AiSettings> {
  const [row] = await db.select().from(aiSettings).where(eq(aiSettings.id, ROW)).limit(1);
  return settingsFromRow(row);
}

export async function saveSettings(db: Db, s: AiSettings): Promise<void> {
  const r = rowFromSettings(s);
  const values = {
    provider: r.provider,
    fallbackProvider: r.fallbackProvider,
    fallbackOnUnavailable: r.fallbackOnUnavailable,
    taskOverrides: r.taskOverrides as object,
    models: r.models as object,
    updatedAt: new Date(),
  };
  await db
    .insert(aiSettings)
    .values({ id: ROW, ...values })
    .onConflictDoUpdate({ target: aiSettings.id, set: values });
  invalidateSettings();
  forgetAvailability();
}

/** Called once at server start-up (`src/instrumentation.ts`): the router reads its settings from this database. */
export function readSettingsFromDatabase(db: Db): void {
  setSettingsLoader(() => loadSettings(db));
}
