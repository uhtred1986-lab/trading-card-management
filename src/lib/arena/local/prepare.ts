/**
 * Offline preparation (#660, plan O4-05): what the player's "Prepare for offline play" flow does on
 * the device, as functions the page (`src/components/arena/OfflinePreparation.tsx`) calls and the
 * proofs run against fakes (`scripts/verify/arena-offline-prep.mts`).
 *
 * "Prepared" is three things, all on the device, and the page says ready only when all three are:
 *   1. the game files: a COMPLETE shell cache (`./shell.ts`, `installedShells`);
 *   2. the deck pack: a `ready` active version of the curated pack (`./pack-store.ts`);
 *   3. the card artwork: every image the pack names, verified (`artVerified === artRequired`);
 * and the shell's interpreter revision is the pack's (`shellRefusal`) — a pack the installed shell
 * cannot play is not ready, however complete it is.
 *
 * Preparing sets the device's mark (`markPreparedDevice`); only then does `ServiceWorker.tsx`
 * download the shell, and from then on it keeps it current. Removing everything clears the mark and
 * deletes only what the app owns: the caches named by `CACHE_PREFIXES`, the two `dbs-arena-*`
 * databases, the saved-match pointer and the app's own worker — never another cache of the origin.
 *
 * Browser-safe: no `node:`, no database, no auth.
 */
import { CACHE_PREFIXES, PACK_DB_NAME, PackStoreError, type InstalledVersion, type PackStore } from "./pack-store";
import { installedShells, shellRefusal, SHELL_CACHE_PREFIX, SHELL_MANIFEST_PATH, SHELL_VERSION_PATTERN, markPreparedDevice, type ShellMeta } from "./shell";
import { LOCAL_DB_NAME, MIGRATIONS, StorageError, openLocalDatabase } from "./storage";

/** The curated pack's id (`PACK_ID` of `scripts/build-arena-offline-pack.mts`; the proof checks they agree). */
export const CURATED_PACK_ID = "masters-sd15-vs-sd5";

// ── Readiness ──────────────────────────────────────────────────────────────────────────────────

export interface DeviceFacts {
  /** The ready versions on the device (all packs). */
  versions: readonly InstalledVersion[];
  /** Staged (unfinished) versions of the curated pack. */
  staged: readonly InstalledVersion[];
  /** Complete shells on the device. */
  shells: readonly ShellMeta[];
}

export type Part = "game files" | "deck pack" | "card artwork";

export interface Readiness {
  ready: boolean;
  /** What is still missing, in the order the flow fetches it. */
  missing: Part[];
  /** The active, ready, fully verified curated pack, or null. */
  pack: InstalledVersion | null;
  /** The complete shell that plays `pack`, or null. */
  shell: ShellMeta | null;
}

/** Is this device ready to play offline? Never true while a part is missing or the shell cannot play the pack. */
export function assess(facts: DeviceFacts): Readiness {
  const active = facts.versions.find((v) => v.id === CURATED_PACK_ID && v.active && v.status === "ready") ?? null;
  const artComplete = !!active && active.artRequired > 0 && active.artVerified === active.artRequired;
  const shell = active ? facts.shells.find((s) => !shellRefusal(s.revision, active.runtimeRevision)) ?? null : facts.shells[0] ?? null;
  const missing: Part[] = [];
  if (!shell) missing.push("game files");
  if (!active) missing.push("deck pack");
  if (!active || !artComplete) missing.push("card artwork");
  return { ready: missing.length === 0, missing, pack: active, shell: active && artComplete ? shell : null };
}

/** What the server's current build offers: its shell version and interpreter revision. */
export interface Latest { version: string; revision: string | null; files: number }

/** Is there something newer to download? `latest` is null offline, when nothing can be compared. */
export function updateAvailable(facts: DeviceFacts, latest: Latest | null): boolean {
  if (!latest) return false;
  const r = assess(facts);
  if (!r.ready) return false;
  if (!facts.shells.some((s) => s.version === latest.version)) return true;
  return !!latest.revision && r.pack!.runtimeRevision !== latest.revision;
}

export async function readFacts(store: PackStore, shells: () => Promise<ShellMeta[]> = installedShells): Promise<DeviceFacts> {
  const all = await store.list();
  return { versions: all.filter((v) => v.status === "ready"), staged: all.filter((v) => v.status === "staged" && v.id === CURATED_PACK_ID), shells: await shells() };
}

/** The server's current shell version and revision (`/arena/offline/shell.json`), or null when it cannot be read (offline). */
export async function fetchLatest(doFetch: typeof fetch = (...a) => fetch(...a)): Promise<Latest | null> {
  try {
    const res = await doFetch(SHELL_MANIFEST_PATH, { cache: "no-store", credentials: "omit" });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown; revision?: unknown; files?: unknown };
    if (typeof body.version !== "string" || !SHELL_VERSION_PATTERN.test(body.version)) return null;
    return { version: body.version, revision: typeof body.revision === "string" ? body.revision : null, files: Array.isArray(body.files) ? body.files.length : 0 };
  } catch {
    return null;
  }
}

// ── Plain words for failures ───────────────────────────────────────────────────────────────────

export interface Friendly { headline: string; detail: string; technical: string }

/** A failure in the player's words; the original message stays available as the technical line. */
export function friendlyError(e: unknown): Friendly {
  const technical = e instanceof Error ? e.message : String(e);
  const code = e instanceof PackStoreError ? e.code : e instanceof StorageError ? e.code : e instanceof PrepareError ? e.code : "";
  switch (code) {
    case "quota":
      return { headline: "This device is out of storage space", detail: "Free some space on the device, or remove a saved match or an old pack below, then try again. What was already downloaded is kept.", technical };
    case "network":
    case "http":
      return { headline: "The download was interrupted", detail: "Check the connection and try again. What was already downloaded is kept, so it carries on where it stopped.", technical };
    case "missing-art":
    case "opaque":
    case "decode":
      return { headline: "Some card artwork could not be downloaded", detail: "Try again in a moment. The decks are not marked ready until every card image is on the device.", technical };
    case "unplayable":
    case "invalid-pack":
    case "hash-mismatch":
      return { headline: "This deck pack cannot be used on this version of the app", detail: "Reload the page to get the latest version, then prepare again.", technical };
    case "no-pack":
      return { headline: "No deck pack is offered by this version of the app", detail: "This is a development build. Try again on the live app.", technical };
    case "remove":
      return { headline: "Not everything could be removed", detail: "Close any other window of this app and try again.", technical };
    case "offline":
      return { headline: "You are offline", detail: "Connect to the internet to prepare this device. Once it is prepared, no connection is needed to play.", technical };
    case "shell":
      return { headline: "The game files could not be downloaded", detail: "Check the connection and try again.", technical };
    case "unsupported":
      return { headline: "This browser cannot keep the game on the device", detail: "Offline play needs a current Chrome, Edge, Safari or Firefox.", technical };
    case "unavailable":
    case "newer":
      return { headline: "This device's storage could not be opened", detail: "Private browsing, or a browser setting that blocks site storage, stops offline play. Allow storage for this site and try again.", technical };
    case "pinned":
      return { headline: "A saved match still uses this pack", detail: "Delete that match first.", technical };
    default:
      return { headline: "Something went wrong", detail: "Try again. If it keeps happening, remove everything from this device below and prepare again.", technical };
  }
}

export class PrepareError extends Error {
  constructor(readonly code: "shell" | "no-pack" | "unsupported" | "offline" | "remove", message: string) {
    super(message);
    this.name = "PrepareError";
  }
}

// ── Preparing ──────────────────────────────────────────────────────────────────────────────────

export interface PrepareProgress {
  part: Part;
  done: number;
  total: number;
}

export interface PrepareEnv {
  serviceWorker?: ServiceWorkerContainer;
  caches?: CacheStorage;
  fetch?: typeof fetch;
  /** Poll interval while the worker downloads the shell (ms). */
  pollMs?: number;
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new PrepareError("shell", "cancelled")); }, { once: true });
});

/**
 * Get the shell onto the device: mark the device prepared, register `/sw.js?v=<version>` and wait
 * until the worker's cache is COMPLETE (its meta record is written last). A shell already complete
 * returns at once. Progress is the number of files the worker has cached so far.
 */
export async function prepareShell(latest: Latest, listFiles: number, onProgress: (p: PrepareProgress) => void, signal?: AbortSignal, env: PrepareEnv = {}): Promise<void> {
  const sw = env.serviceWorker ?? (typeof navigator !== "undefined" ? navigator.serviceWorker : undefined);
  const store = env.caches ?? (typeof caches !== "undefined" ? caches : undefined);
  if (!sw || !store) throw new PrepareError("unsupported", "no service worker or Cache Storage");
  markPreparedDevice(true);
  const complete = async () => (await installedShells(store)).some((s) => s.version === latest.version);
  const total = listFiles + 2; // the files, the shell page and the meta record
  const name = SHELL_CACHE_PREFIX + latest.version;
  const url = `/sw.js?v=${latest.version}`;
  const existing = await sw.getRegistration();
  // An active worker for this very version whose cache has gone: it will not install again, so replace it.
  if (!(await complete()) && existing?.active && existing.active.scriptURL.endsWith(url)) await existing.unregister();
  onProgress({ part: "game files", done: 0, total });
  if (await complete()) { onProgress({ part: "game files", done: total, total }); return; }
  const registration = await sw.register(url);
  const worker = registration.installing;
  let redundant = false;
  worker?.addEventListener("statechange", () => { if (worker.state === "redundant") redundant = true; });
  const poll = env.pollMs ?? 300;
  for (;;) {
    if (signal?.aborted) throw new PrepareError("shell", "cancelled");
    if (await complete()) { onProgress({ part: "game files", done: total, total }); return; }
    if (redundant) throw new PrepareError("shell", "the worker that downloads the game files failed to install");
    if (await store.has(name)) {
      const keys = await (await store.open(name)).keys();
      onProgress({ part: "game files", done: Math.min(keys.length, total - 1), total });
    }
    await wait(poll, signal);
  }
}

/** Ask the browser to keep this site's data when the device runs low on space (best effort, never an error). */
export async function requestPersistence(): Promise<boolean> {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

export interface Usage { used: number | null; quota: number | null; persisted: boolean | null }

export async function storageUsage(): Promise<Usage> {
  try {
    const [est, persisted] = await Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]);
    return { used: est?.usage ?? null, quota: est?.quota ?? null, persisted: persisted ?? null };
  } catch {
    return { used: null, quota: null, persisted: null };
  }
}

export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

// ── Saved matches ──────────────────────────────────────────────────────────────────────────────

export interface SavedMatch {
  matchId: string;
  packHash: string | null;
  /** Decisions committed so far; null when the header is unreadable. */
  moves: number | null;
  /** The match is over (`status` of the header), when known. */
  over: boolean;
  /** The pack deck keys of each seat (#793: which saved matches a removed deck takes with it); null when unreadable. */
  decks: { p1: string; p2: string } | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

interface LocalDbOptions { factory?: Pick<IDBFactory, "open">; name?: string }

function transact<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, body: (tx: IDBTransaction, set: (v: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let out: T | undefined;
    let tx: IDBTransaction;
    try { tx = db.transaction(stores, mode); } catch (e) { return reject(e); }
    tx.oncomplete = () => resolve(out as T);
    tx.onabort = () => reject(tx.error ?? new Error("the transaction was aborted"));
    try { body(tx, (v) => { out = v; }); } catch (e) { try { tx.abort(); } catch { /* done */ } reject(e); }
  });
}

/** The saved matches on this device, read from their headers only; a damaged header is still listed (it still pins its pack). */
export async function listSavedMatches(options: LocalDbOptions = {}): Promise<SavedMatch[]> {
  const db = await openLocalDatabase({ name: options.name ?? LOCAL_DB_NAME, factory: options.factory, migrations: MIGRATIONS });
  try {
    return await transact<SavedMatch[]>(db, ["matches"], "readonly", (tx, set) => {
      const r = tx.objectStore("matches").getAll();
      r.onsuccess = () => set((r.result as unknown[]).map((row) => {
        const h = isRecord(row) ? row : {};
        return {
          matchId: typeof h.matchId === "string" ? h.matchId : "?",
          packHash: typeof h.packHash === "string" ? h.packHash : null,
          moves: typeof h.decisions === "number" ? h.decisions : null,
          over: h.status === "over",
          decks: isRecord(h.decks) && typeof h.decks.p1 === "string" && typeof h.decks.p2 === "string" ? { p1: h.decks.p1, p2: h.decks.p2 } : null,
        };
      }));
    });
  } finally { db.close(); }
}

/** Delete saved matches (header, every decision and the writer lease), in one transaction. Nothing else is touched. */
export async function deleteSavedMatches(matchIds: readonly string[], options: LocalDbOptions = {}): Promise<void> {
  if (matchIds.length === 0) return;
  const db = await openLocalDatabase({ name: options.name ?? LOCAL_DB_NAME, factory: options.factory, migrations: MIGRATIONS });
  try {
    const stores = ["matches", "decisions", ...(db.objectStoreNames.contains("owners") ? ["owners"] : [])];
    await transact<void>(db, stores, "readwrite", (tx) => {
      for (const id of matchIds) {
        const head = tx.objectStore("matches").get(id);
        head.onsuccess = () => {
          // The header says how many decisions there are (plus the one probe a damaged save may hold beyond); a header that
          // cannot say is cleared by key range.
          const n = isRecord(head.result) && typeof head.result.decisions === "number" ? head.result.decisions : null;
          if (n !== null) for (let i = 0; i <= n; i++) tx.objectStore("decisions").delete([id, i]);
          else tx.objectStore("decisions").delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
          tx.objectStore("matches").delete(id);
          if (stores.includes("owners")) tx.objectStore("owners").delete(id);
        };
      }
    });
  } finally { db.close(); }
}

// ── Removing ───────────────────────────────────────────────────────────────────────────────────

export interface RemoveResult { removed: string[]; failed: string[] }

/** The cache names this app owns (`CACHE_PREFIXES`), and none other. */
export const ownedCache = (name: string) => Object.values(CACHE_PREFIXES).some((p) => name.startsWith(p));

export interface ClearEnv {
  caches?: Pick<CacheStorage, "keys" | "delete">;
  indexedDB?: Pick<IDBFactory, "deleteDatabase">;
  serviceWorker?: Pick<ServiceWorkerContainer, "getRegistrations">;
  /** Clears the saved-match pointer in the browser's storage (`POINTER_KEY`). */
  forgetPointer?: () => void;
}

function deleteDatabase(factory: Pick<IDBFactory, "deleteDatabase">, name: string, timeoutMs = 6000): Promise<void> {
  return new Promise((resolve, reject) => {
    const r = factory.deleteDatabase(name);
    const t = setTimeout(() => reject(new Error(`${name} is still open in another window`)), timeoutMs);
    r.onsuccess = () => { clearTimeout(t); resolve(); };
    r.onerror = () => { clearTimeout(t); reject(r.error ?? new Error(`could not delete ${name}`)); };
    // `onblocked`: another window holds a connection; ours close on `versionchange`, so wait for success.
  });
}

/**
 * Remove everything the offline feature keeps on this device and unprepare it: the app's worker,
 * its caches (`CACHE_PREFIXES` — the card-art cache, the pack and shell caches), the two
 * `dbs-arena-*` databases (installed packs; saved matches) and the saved-match pointer, then the
 * device's mark. A cache or database with any other name is left alone. Each step is tried even if
 * an earlier one failed; the mark is cleared only when everything was removed.
 */
export async function clearOfflineData(env: ClearEnv = {}): Promise<RemoveResult> {
  const result: RemoveResult = { removed: [], failed: [] };
  const attempt = async (what: string, fn: () => Promise<unknown> | unknown) => {
    try { await fn(); result.removed.push(what); } catch { result.failed.push(what); }
  };
  const sw = env.serviceWorker ?? (typeof navigator !== "undefined" ? navigator.serviceWorker : undefined);
  if (sw) await attempt("the app's background worker", async () => { for (const r of await sw.getRegistrations()) await r.unregister(); });
  const store = env.caches ?? (typeof caches !== "undefined" ? caches : undefined);
  if (store) for (const name of (await store.keys()).filter(ownedCache)) await attempt(`cache ${name}`, () => store.delete(name));
  const factory = env.indexedDB ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
  if (factory) for (const name of [PACK_DB_NAME, LOCAL_DB_NAME]) await attempt(`database ${name}`, () => deleteDatabase(factory, name));
  await attempt("the saved-match pointer", () => env.forgetPointer?.());
  if (result.failed.length === 0) markPreparedDevice(false);
  return result;
}

/** Why `shell` cannot play `pack`, for a line under the pack (null when it can). */
export const unplayableHere = (shellRevision: string | null, pack: InstalledVersion) => shellRefusal(shellRevision, pack.runtimeRevision);
