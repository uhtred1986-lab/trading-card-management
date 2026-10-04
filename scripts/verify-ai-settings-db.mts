/**
 * #516 on PGlite: the single `ai_settings` row. Nothing stored reads as
 * "nothing configured"; a save is one row that a second save replaces; what
 * was saved is what the router then routes by (a provider registered under the
 * saved id answers, a model saved for a tier reaches the request). No network.
 */
import assert from "node:assert/strict";
import type { Db } from "../src/db/index.ts";
import * as schema from "../src/db/schema.ts";
import type { AiSettings } from "../src/lib/ai/settings.ts";

export async function verifyAiSettingsDb(db: Db): Promise<void> {
  // Loaded the way the feature code loads them, so the registry is the one the router reads.
  const { createFakeProvider } = await import("../src/lib/ai/providers/fake.ts");
  const { registerProvider, resetProviders } = await import("../src/lib/ai/providers/index.ts");
  const { forgetAvailability, resolve } = await import("../src/lib/ai/router.ts");
  const { getSettings, NO_SETTINGS, setSettingsLoader } = await import("../src/lib/ai/settings.ts");
  const { loadSettings, readSettingsFromDatabase, saveSettings } = await import("../src/lib/ai/settings-db.ts");
  try {
    assert.deepEqual(await loadSettings(db), NO_SETTINGS, "no row = nothing configured");

    const first: AiSettings = {
      provider: "alt",
      fallbackProvider: "anthropic-api",
      fallbackOnUnavailable: true,
      taskOverrides: { scan_identify: { provider: "anthropic-api", model: "claude-sonnet-5-5" } },
      tiers: { alt: { fast: "alt/fast-1" } },
      arena: { sparring: { provider: "alt", model: "alt/spar" }, "tournament.key": { provider: "anthropic-api", model: "claude-opus-5" } },
    };
    await saveSettings(db, first);
    assert.deepEqual(await loadSettings(db), first, "what was saved is what is read");

    await saveSettings(db, { ...first, provider: null, fallbackOnUnavailable: false, arena: {} });
    const rows = await db.select().from(schema.aiSettings);
    assert.equal(rows.length, 1, "a second save replaces the row");
    assert.equal(rows[0].id, 1);
    assert.deepEqual(await loadSettings(db), { ...first, provider: null, fallbackOnUnavailable: false, arena: {} });

    // The router reads what the database holds, through the registered loader.
    await saveSettings(db, first);
    readSettingsFromDatabase(db);
    resetProviders();
    forgetAvailability();
    registerProvider(createFakeProvider({ id: "alt", script: [{ json: {} }] }));
    const routed = await resolve({ task: "cart_explain", tier: "fast", system: [{ text: "s" }], messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }], maxTokens: 10 });
    assert.equal(routed.provider.id, "alt", "the saved provider runs the call");
    assert.equal(routed.request.model, "alt/fast-1", "and the saved tier model reaches the request");
    assert.equal((await getSettings()).arena.sparring?.model, "alt/spar");

    // Saving drops the reused read, so the next call sees the change at once.
    await saveSettings(db, { ...first, provider: null });
    assert.equal((await getSettings()).provider, null);
  } finally {
    setSettingsLoader(null);
    resetProviders();
    forgetAvailability();
  }
}
