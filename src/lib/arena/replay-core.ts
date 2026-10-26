/**
 * Portable replay-bundle core (#640): bundle types, canonical serialization, content hashing,
 * validation and pinned-context construction. Runs unchanged in Node and in a browser.
 *
 * Boundary, checked by `scripts/verify/arena-replay-core.ts`: no database, Drizzle, Node builtins
 * (`node:crypto`, `fs`, …), provider SDKs or `process.env`. Hashing is Web Crypto
 * (`globalThis.crypto.subtle`, which Node also provides), so every hash is asynchronous. The
 * interpreter revision is never looked up here; callers pass it in. The server's persistence,
 * cache and deployment-revision lookup stay in `replay-bundle.ts`.
 */
import type { CardDef, EngineContext, DeckInput } from "./types";
import type { CardScripts } from "./vm/script";
import type { GameDefinition } from "./rulesets/types";
import { loadRuleset } from "./rulesets/load";
import { GAMES, type Game } from "../catalog/games";
import type { CardArt } from "./view";

export const REPLAY_BUNDLE_FORMAT = 1;

export interface ReplayBundlePayload {
  format: 1;
  /** The game whose ruleset `rulesetFiles` hold. Absent means "dbs", so bundles made before Fusion World replay and hash as they did. */
  game?: Game;
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

/** An interpreter revision is a source commit SHA (7–40 hex digits). */
export const RUNTIME_REVISION_PATTERN = /^[0-9a-f]{7,40}$/i;

/** Normalise a revision supplied by the caller (environment, CLI flag, worker message); anything else is unknown. */
export function normaliseRuntimeRevision(value: string | null | undefined): string | null {
  return value && RUNTIME_REVISION_PATTERN.test(value) ? value.toLowerCase() : null;
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

/** The exact bytes that are hashed: JSON with object keys in UTF-16 code-unit order, arrays untouched. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

/** SHA-256 of the UTF-8 encoding of `text`, as lowercase hex. */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto (crypto.subtle) is unavailable; replay hashing needs a secure context");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export function replayHash(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

interface ComponentHashes { rulesetHash: string; catalogHash: string; programsHash: string; hash: string }

async function hashesOf(payload: ReplayBundlePayload, format: number, runtimeRevision: string | null): Promise<ComponentHashes> {
  const [rulesetHash, catalogHash, programsHash] = await Promise.all([
    replayHash(payload.rulesetFiles),
    replayHash({ defs: payload.defs, art: payload.art }),
    replayHash(payload.scripts),
  ]);
  // `game` joins the hash only when it is not dbs, so every existing bundle keeps its hash.
  const hash = await replayHash({ format, rulesetHash, catalogHash, programsHash, runtimeRevision, ...(payload.game && payload.game !== "dbs" ? { game: payload.game } : {}) });
  return { rulesetHash, catalogHash, programsHash, hash };
}

/**
 * Build a content-addressed bundle. `runtime` is the interpreter revision that will claim exact
 * replay of games pinned to it, or `null` for an explicitly unpinned (development) bundle.
 */
export async function makeReplayBundle(input: {
  defs: Record<string, CardDef>;
  scripts: Record<string, CardScripts>;
  art: Record<string, CardArt>;
  rulesetFiles: Record<string, string>;
  /** Defaults to "dbs"; the field is only written to the payload for another game. */
  game?: Game;
  runtime: string | null;
}): Promise<ReplayBundle> {
  const payload: ReplayBundlePayload = {
    format: REPLAY_BUNDLE_FORMAT,
    ...(input.game && input.game !== "dbs" ? { game: input.game } : {}),
    rulesetFiles: structuredClone(input.rulesetFiles),
    defs: structuredClone(input.defs),
    scripts: structuredClone(input.scripts),
    art: structuredClone(input.art),
  };
  const runtime = input.runtime;
  const { hash, rulesetHash, catalogHash, programsHash } = await hashesOf(payload, REPLAY_BUNDLE_FORMAT, runtime);
  return { hash, format: REPLAY_BUNDLE_FORMAT, rulesetHash, catalogHash, programsHash, runtimeRevision: runtime, payload };
}

/** Recompute every content hash. Any shape error, unknown format or mismatch is `false`, never a throw. */
export async function validateReplayBundle(bundle: ReplayBundle): Promise<boolean> {
  try {
    if (!bundle || typeof bundle !== "object" || bundle.format !== REPLAY_BUNDLE_FORMAT || bundle.payload?.format !== REPLAY_BUNDLE_FORMAT) return false;
    const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
    if (!record(bundle.payload.rulesetFiles) || !record(bundle.payload.defs) || !record(bundle.payload.scripts) || !record(bundle.payload.art)) return false;
    if (bundle.payload.game !== undefined && !(GAMES as readonly string[]).includes(bundle.payload.game)) return false;
    if (!Object.values(bundle.payload.rulesetFiles).every((value) => typeof value === "string")) return false;
    if (bundle.runtimeRevision !== null && (typeof bundle.runtimeRevision !== "string" || !RUNTIME_REVISION_PATTERN.test(bundle.runtimeRevision))) return false;
    const expected = await hashesOf(bundle.payload, bundle.format, bundle.runtimeRevision);
    return bundle.rulesetHash === expected.rulesetHash && bundle.catalogHash === expected.catalogHash && bundle.programsHash === expected.programsHash && bundle.hash === expected.hash;
  } catch {
    return false;
  }
}

/**
 * Exact replay needs the bundle's recorded interpreter revision and the replaying runtime's own
 * revision, both known and equal. Missing on either side fails closed.
 */
export function assertInterpreterRevision(bundle: Pick<ReplayBundle, "runtimeRevision">, local: string | null): void {
  if (!bundle.runtimeRevision || !local || bundle.runtimeRevision !== local) {
    throw new Error("interpreter provenance is missing or does not match this replay runtime");
  }
}

/** Load the bundle's own ruleset files. Throws on an invalid ruleset; does not check hashes. */
export function pinnedDefinition(bundle: ReplayBundle): GameDefinition {
  const loaded = loadRuleset(bundle.payload.rulesetFiles, bundle.payload.game ?? "dbs");
  if (!loaded.ok) {
    const first = loaded.errors[0];
    throw new Error(`the pinned ruleset is invalid${first ? `: ${first.file}:${first.line}:${first.col} ${first.message}` : ""}`);
  }
  return loaded.definition;
}

/** An engine context built only from an already-validated bundle and its loaded definition. */
export function contextFromBundle(bundle: ReplayBundle, definition: GameDefinition, referee = false): PinnedContext {
  const ctx = { defs: structuredClone(bundle.payload.defs), scripts: structuredClone(bundle.payload.scripts), referee } as PinnedContext;
  ctx.rulesetDefinition = structuredClone(definition);
  ctx.rulesBundleHash = bundle.hash;
  return ctx;
}

/** Validate, load and build: the uncached path, with no server state. */
export async function pinnedContext(bundle: ReplayBundle, referee = false): Promise<PinnedContext> {
  if (!(await validateReplayBundle(bundle))) throw new Error("the pinned replay bundle is missing or has an invalid content hash");
  return contextFromBundle(bundle, pinnedDefinition(bundle), referee);
}
