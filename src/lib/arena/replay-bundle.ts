/**
 * Server side of replay bundles: Drizzle persistence, the in-process definition cache and the
 * deployment's interpreter revision. Everything portable — types, canonical JSON, hashing,
 * validation, pinned-context construction — lives in `replay-core.ts` (#640).
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaRuleBundles } from "@/db/schema";
import type { CardDef } from "./types";
import type { CardScripts } from "./vm/script";
import type { GameDefinition } from "./rulesets/types";
import { DBS_FILES, FUSION_FILES } from "./rulesets";
import type { Game } from "../catalog/games";
import type { CardArt } from "./view";
import {
  contextFromBundle,
  makeReplayBundle as makePortableReplayBundle,
  normaliseRuntimeRevision,
  pinnedDefinition,
  validateReplayBundle,
  type PinnedContext,
  type ReplayBundle,
  type ReplayBundlePayload,
  type ReplayBundleRecord,
} from "./replay-core";

export {
  REPLAY_BUNDLE_FORMAT,
  canonicalJson,
  replayHash,
  validateReplayBundle,
  type PinnedContext,
  type ReplayBundle,
  type ReplayBundlePayload,
  type ReplayBundleRecord,
} from "./replay-core";

const CACHE_LIMIT = 24;

/** Deploys identify the interpreter by source commit. Development exports remain explicitly unpinned. */
export function runtimeRevision(): string | null {
  return normaliseRuntimeRevision(process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null);
}

/** Server entry: defaults to the shipped ruleset of `game` (dbs when absent) and this deployment's revision. */
export function makeReplayBundle(input: {
  defs: Record<string, CardDef>;
  scripts: Record<string, CardScripts>;
  art: Record<string, CardArt>;
  rulesetFiles?: Record<string, string>;
  /** The game being played: picks the ruleset files to pin. Defaults to dbs. */
  game?: Game;
  runtime?: string | null;
}): Promise<ReplayBundle> {
  return makePortableReplayBundle({
    defs: input.defs,
    scripts: input.scripts,
    art: input.art,
    rulesetFiles: input.rulesetFiles ?? (input.game === "fusion" ? FUSION_FILES : DBS_FILES),
    game: input.game,
    runtime: input.runtime === undefined ? runtimeRevision() : input.runtime,
  });
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

/** Validate, then build the context from the cached definition or a fresh load (which is cached). */
export async function pinnedContext(bundle: ReplayBundle, referee = false): Promise<PinnedContext> {
  if (!(await validateReplayBundle(bundle))) throw new Error("the pinned replay bundle is missing or has an invalid content hash");
  const known = cache.get(bundle.hash);
  if (known) {
    if (!(await validateReplayBundle(known.bundle))) throw new Error("the cached replay bundle failed hash validation");
    return contextFromBundle(known.bundle, known.definition, referee);
  }
  const definition = pinnedDefinition(bundle);
  remember(bundle, definition);
  return contextFromBundle(bundle, definition, referee);
}

function bundleOfRow(row: typeof arenaRuleBundles.$inferSelect): ReplayBundle {
  return {
    hash: row.hash,
    format: row.format as 1,
    rulesetHash: row.rulesetHash,
    catalogHash: row.catalogHash,
    programsHash: row.programsHash,
    runtimeRevision: row.runtimeRevision,
    payload: row.payload as ReplayBundlePayload,
  };
}

/** Insert once. A content-address collision with different bytes fails closed. */
export async function persistReplayBundle(db: Db, bundle: ReplayBundle): Promise<void> {
  if (!(await validateReplayBundle(bundle))) throw new Error("refusing to persist an invalid replay bundle");
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
  if (!stored || !(await validateReplayBundle(bundleOfRow(stored)))) throw new Error("stored replay bundle does not match its content hash");
}

export async function readReplayBundle(db: Db, hash: string): Promise<ReplayBundle | null> {
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;
  const hit = cache.get(hash);
  if (hit && (await validateReplayBundle(hit.bundle))) return structuredClone(hit.bundle);
  const [row] = await db.select().from(arenaRuleBundles).where(eq(arenaRuleBundles.hash, hash)).limit(1);
  if (!row) return null;
  const bundle = bundleOfRow(row);
  if (!(await validateReplayBundle(bundle))) throw new Error("stored replay bundle failed content hash validation");
  // Build and validate the definition before accepting this payload into cache.
  const context = await pinnedContext(bundle);
  remember(bundle, context.rulesetDefinition!);
  return structuredClone(bundle);
}

export async function replayRecord(db: Db, hash: string, decks: ReplayBundleRecord["decks"] | null): Promise<ReplayBundleRecord | null> {
  const bundle = await readReplayBundle(db, hash);
  return bundle && decks ? { ...bundle, decks } : null;
}
