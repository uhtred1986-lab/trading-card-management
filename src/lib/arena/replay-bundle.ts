import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaRuleBundles } from "@/db/schema";
import type { CardDef, EngineContext, DeckInput } from "./types";
import type { CardScripts } from "./vm/script";
import type { GameDefinition } from "./rulesets/types";
import { loadRuleset } from "./rulesets/load";
import { DBS_FILES } from "./rulesets/dbs";
import type { CardArt } from "./view";

export const REPLAY_BUNDLE_FORMAT = 1;
const CACHE_LIMIT = 24;

export interface ReplayBundlePayload {
  format: 1;
  rulesetFiles: Record<string, string>;
  defs: Record<string, CardDef>;
  scripts: Record<string, CardScripts>;
  art: Record<string, CardArt>;
}

export interface ReplayBundle {
  hash: string;
  format: 1;
  rulesetHash: string;
  catalogHash: string;
  programsHash: string;
  runtimeRevision: string | null;
  payload: ReplayBundlePayload;
}

export interface ReplayBundleRecord extends ReplayBundle {
  decks: { p1: DeckInput; p2: DeckInput };
}

export interface PinnedContext extends EngineContext {
  rulesetDefinition?: GameDefinition;
  rulesBundleHash?: string;
  arenaGameId?: number;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    // JavaScript's default string order is UTF-16 code-unit order and is
    // independent of host locale/ICU configuration. Locale collation would
    // make an identical bundle hash differently on some machines.
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, canonical(v)]));
  }
  return value;
}

export function replayHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

/** Deploys identify the interpreter by source commit. Development exports remain explicitly unpinned. */
export function runtimeRevision(): string | null {
  const value = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null;
  return value && /^[0-9a-f]{7,40}$/i.test(value) ? value.toLowerCase() : null;
}

export function makeReplayBundle(input: {
  defs: Record<string, CardDef>;
  scripts: Record<string, CardScripts>;
  art: Record<string, CardArt>;
  rulesetFiles?: Record<string, string>;
  runtime?: string | null;
}): ReplayBundle {
  const rulesetFiles = input.rulesetFiles ?? DBS_FILES;
  const payload: ReplayBundlePayload = {
    format: REPLAY_BUNDLE_FORMAT,
    rulesetFiles: structuredClone(rulesetFiles),
    defs: structuredClone(input.defs),
    scripts: structuredClone(input.scripts),
    art: structuredClone(input.art),
  };
  const rulesetHash = replayHash(payload.rulesetFiles);
  const catalogHash = replayHash({ defs: payload.defs, art: payload.art });
  const programsHash = replayHash(payload.scripts);
  const runtime = input.runtime === undefined ? runtimeRevision() : input.runtime;
  const hash = replayHash({ format: REPLAY_BUNDLE_FORMAT, rulesetHash, catalogHash, programsHash, runtimeRevision: runtime });
  return { hash, format: REPLAY_BUNDLE_FORMAT, rulesetHash, catalogHash, programsHash, runtimeRevision: runtime, payload };
}

export function validateReplayBundle(bundle: ReplayBundle): boolean {
  try {
    if (!bundle || typeof bundle !== "object" || bundle.format !== REPLAY_BUNDLE_FORMAT || bundle.payload?.format !== REPLAY_BUNDLE_FORMAT) return false;
    const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
    if (!record(bundle.payload.rulesetFiles) || !record(bundle.payload.defs) || !record(bundle.payload.scripts) || !record(bundle.payload.art)) return false;
    if (!Object.values(bundle.payload.rulesetFiles).every((value) => typeof value === "string")) return false;
    if (bundle.runtimeRevision !== null && (typeof bundle.runtimeRevision !== "string" || !/^[0-9a-f]{7,40}$/i.test(bundle.runtimeRevision))) return false;
    const rulesetHash = replayHash(bundle.payload.rulesetFiles);
    const catalogHash = replayHash({ defs: bundle.payload.defs, art: bundle.payload.art });
    const programsHash = replayHash(bundle.payload.scripts);
    const hash = replayHash({ format: bundle.format, rulesetHash, catalogHash, programsHash, runtimeRevision: bundle.runtimeRevision });
    return bundle.rulesetHash === rulesetHash && bundle.catalogHash === catalogHash && bundle.programsHash === programsHash && bundle.hash === hash;
  } catch {
    return false;
  }
}

const cache = new Map<string, { bundle: ReplayBundle; definition: GameDefinition }>();

function remember(bundle: ReplayBundle, definition: GameDefinition): void {
  cache.delete(bundle.hash);
  cache.set(bundle.hash, { bundle: structuredClone(bundle), definition });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

export function clearReplayBundleCacheForTests(): void {
  cache.clear();
}

export function pinnedContext(bundle: ReplayBundle, referee = false): PinnedContext {
  if (!validateReplayBundle(bundle)) throw new Error("the pinned replay bundle is missing or has an invalid content hash");
  const known = cache.get(bundle.hash);
  if (known) {
    if (!validateReplayBundle(known.bundle)) throw new Error("the cached replay bundle failed hash validation");
    const ctx = { defs: structuredClone(known.bundle.payload.defs), scripts: structuredClone(known.bundle.payload.scripts), referee } as PinnedContext;
    ctx.rulesetDefinition = structuredClone(known.definition);
    ctx.rulesBundleHash = bundle.hash;
    return ctx;
  }
  const loaded = loadRuleset(bundle.payload.rulesetFiles, "dbs");
  if (!loaded.ok) {
    const first = loaded.errors[0];
    throw new Error(`the pinned ruleset is invalid${first ? `: ${first.file}:${first.line}:${first.col} ${first.message}` : ""}`);
  }
  remember(bundle, loaded.definition);
  const ctx = { defs: structuredClone(bundle.payload.defs), scripts: structuredClone(bundle.payload.scripts), referee } as PinnedContext;
  ctx.rulesetDefinition = structuredClone(loaded.definition);
  ctx.rulesBundleHash = bundle.hash;
  return ctx;
}

/** Insert once. A content-address collision with different bytes fails closed. */
export async function persistReplayBundle(db: Db, bundle: ReplayBundle): Promise<void> {
  if (!validateReplayBundle(bundle)) throw new Error("refusing to persist an invalid replay bundle");
  const values = {
    hash: bundle.hash,
    format: bundle.format,
    rulesetHash: bundle.rulesetHash,
    catalogHash: bundle.catalogHash,
    programsHash: bundle.programsHash,
    runtimeRevision: bundle.runtimeRevision,
    payload: bundle.payload,
  };
  await db.insert(arenaRuleBundles).values(values).onConflictDoNothing({ target: arenaRuleBundles.hash });
  const [stored] = await db.select().from(arenaRuleBundles).where(eq(arenaRuleBundles.hash, bundle.hash)).limit(1);
  if (!stored || !validateReplayBundle({
    hash: stored.hash,
    format: stored.format as 1,
    rulesetHash: stored.rulesetHash,
    catalogHash: stored.catalogHash,
    programsHash: stored.programsHash,
    runtimeRevision: stored.runtimeRevision,
    payload: stored.payload as ReplayBundlePayload,
  })) throw new Error("stored replay bundle does not match its content hash");
}

export async function readReplayBundle(db: Db, hash: string): Promise<ReplayBundle | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const hit = cache.get(hash);
  if (hit && validateReplayBundle(hit.bundle)) return structuredClone(hit.bundle);
  const [row] = await db.select().from(arenaRuleBundles).where(eq(arenaRuleBundles.hash, hash)).limit(1);
  if (!row) return null;
  const bundle: ReplayBundle = {
    hash: row.hash,
    format: row.format as 1,
    rulesetHash: row.rulesetHash,
    catalogHash: row.catalogHash,
    programsHash: row.programsHash,
    runtimeRevision: row.runtimeRevision,
    payload: row.payload as ReplayBundlePayload,
  };
  if (!validateReplayBundle(bundle)) throw new Error("stored replay bundle failed content hash validation");
  // Build and validate the definition before accepting this payload into cache.
  const context = pinnedContext(bundle);
  remember(bundle, context.rulesetDefinition!);
  return structuredClone(bundle);
}

export async function replayRecord(db: Db, hash: string, decks: ReplayBundleRecord["decks"] | null): Promise<ReplayBundleRecord | null> {
  const bundle = await readReplayBundle(db, hash);
  return bundle && decks ? { ...bundle, decks } : null;
}

