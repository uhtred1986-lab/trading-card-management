/**
 * What the owner chose on /settings, as the router reads it (#516). This file
 * is pure: the types, the parsing of a stored row, and a loader hook. The
 * database half (read and write `ai_settings`) is `settings-db.ts`, which the
 * app registers at start-up (`src/instrumentation.ts`). Nothing registered
 * means "nothing configured", so `npm test`, the scripts and any path without
 * a database get `anthropic-api` on the code's own models, exactly as before.
 */
import type { RunKind } from "./client";
import type { ProviderId, Tier } from "./types";

/** The three arena model slots (Sparring, Tournament key decisions, Tournament other decisions). */
export const ARENA_SLOTS = ["sparring", "tournament.key", "tournament.other"] as const;
export type ArenaSlot = (typeof ARENA_SLOTS)[number];

export const TIER_IDS: readonly Tier[] = ["fast", "standard", "best"];

/** A provider and one of its models, as a slot or a per-task override stores it. */
export interface ModelRef {
  provider: ProviderId;
  model: string;
}

export interface TaskOverride {
  provider?: ProviderId;
  model?: string;
}

/**
 * `models` is one object: a provider id maps to its per-tier models, and the
 * three keys `arena.sparring`, `arena.tournament.key`, `arena.tournament.other`
 * hold a {@link ModelRef} each. Provider ids never contain a dot, so the two
 * kinds of key cannot collide.
 */
export interface AiSettings {
  provider: ProviderId | null;
  fallbackProvider: ProviderId | null;
  fallbackOnUnavailable: boolean;
  taskOverrides: Partial<Record<RunKind, TaskOverride>>;
  tiers: Record<string, Partial<Record<Tier, string>>>;
  arena: Partial<Record<ArenaSlot, ModelRef>>;
}

export const NO_SETTINGS: AiSettings = Object.freeze({
  provider: null,
  fallbackProvider: null,
  fallbackOnUnavailable: false,
  taskOverrides: Object.freeze({}),
  tiers: Object.freeze({}),
  arena: Object.freeze({}),
}) as AiSettings;

/** The shape `ai_settings` has in the database (jsonb columns are `unknown` until parsed). */
export interface AiSettingsRow {
  provider: string | null;
  fallbackProvider: string | null;
  fallbackOnUnavailable: boolean;
  taskOverrides: unknown;
  models: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function modelRef(v: unknown): ModelRef | undefined {
  if (!isObj(v)) return undefined;
  const provider = str(v.provider);
  const model = str(v.model);
  return provider && model ? { provider, model } : undefined;
}

/** Defensive: a row written by an older build, or by hand, never throws and never yields half a slot. */
export function settingsFromRow(row: AiSettingsRow | null | undefined): AiSettings {
  if (!row) return NO_SETTINGS;
  const taskOverrides: AiSettings["taskOverrides"] = {};
  if (isObj(row.taskOverrides)) {
    for (const [task, v] of Object.entries(row.taskOverrides)) {
      if (!isObj(v)) continue;
      const o: TaskOverride = { provider: str(v.provider), model: str(v.model) };
      if (o.provider || o.model) taskOverrides[task as RunKind] = { ...(o.provider ? { provider: o.provider } : {}), ...(o.model ? { model: o.model } : {}) };
    }
  }
  const tiers: AiSettings["tiers"] = {};
  const arena: AiSettings["arena"] = {};
  if (isObj(row.models)) {
    for (const [key, v] of Object.entries(row.models)) {
      if (key.startsWith("arena.")) {
        const slot = key.slice("arena.".length);
        const ref = modelRef(v);
        if (ref && (ARENA_SLOTS as readonly string[]).includes(slot)) arena[slot as ArenaSlot] = ref;
        continue;
      }
      if (!isObj(v)) continue;
      const perTier: Partial<Record<Tier, string>> = {};
      for (const t of TIER_IDS) {
        const m = str(v[t]);
        if (m) perTier[t] = m;
      }
      if (Object.keys(perTier).length) tiers[key] = perTier;
    }
  }
  return {
    provider: str(row.provider) ?? null,
    fallbackProvider: str(row.fallbackProvider) ?? null,
    fallbackOnUnavailable: !!row.fallbackOnUnavailable,
    taskOverrides,
    tiers,
    arena,
  };
}

/** The inverse of {@link settingsFromRow}, for the save action. */
export function rowFromSettings(s: AiSettings): AiSettingsRow {
  const models: Record<string, unknown> = { ...s.tiers };
  for (const slot of ARENA_SLOTS) if (s.arena[slot]) models[`arena.${slot}`] = s.arena[slot];
  return { provider: s.provider, fallbackProvider: s.fallbackProvider, fallbackOnUnavailable: s.fallbackOnUnavailable, taskOverrides: s.taskOverrides, models };
}

// ── the loader hook ────────────────────────────────────────────────────────

export type SettingsLoader = () => Promise<AiSettings>;

/** Next bundles instrumentation and routes separately; a global keeps one loader for the process. */
const g = globalThis as unknown as { __aiSettingsLoader?: SettingsLoader | null; __aiSettingsCache?: { at: number; value: AiSettings } | null };
/** How long a read is reused. The save action also drops it, so the owner sees a change at once. */
export const SETTINGS_TTL_MS = 15_000;

/** Register (or, with `null`, remove) where settings come from. The app registers the database; a check registers a literal. */
export function setSettingsLoader(loader: SettingsLoader | null): void {
  g.__aiSettingsLoader = loader;
  g.__aiSettingsCache = null;
}

export function invalidateSettings(): void {
  g.__aiSettingsCache = null;
}

/** The current settings; {@link NO_SETTINGS} when no loader is registered or it fails (a database blip must not stop a model call). */
export async function getSettings(): Promise<AiSettings> {
  const load = g.__aiSettingsLoader;
  if (!load) return NO_SETTINGS;
  const hit = g.__aiSettingsCache;
  if (hit && Date.now() - hit.at < SETTINGS_TTL_MS) return hit.value;
  try {
    const value = await load();
    g.__aiSettingsCache = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.warn("[ai] could not read ai_settings — using the defaults:", err instanceof Error ? err.message : err);
    return hit?.value ?? NO_SETTINGS;
  }
}
