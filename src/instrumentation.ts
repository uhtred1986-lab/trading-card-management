/**
 * Runs once when a server instance starts. Points the AI router at the
 * `ai_settings` row (#516); without a database it stays on its defaults.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.DATABASE_URL) return;
  const [{ db }, { readSettingsFromDatabase }] = await Promise.all([import("@/db"), import("@/lib/ai/settings-db")]);
  readSettingsFromDatabase(db);
}
