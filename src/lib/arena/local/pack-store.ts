/**
 * Installed offline packs (#658, plan O4-03): download, verify, store and activate the versioned
 * deck packs of #655 (`./pack.ts`) on the device, so a local match never needs the network for its
 * cards, rules or artwork.
 *
 * Layout (database `dbs-arena-packs`, one per origin, browser-only — never a server table; its own
 * database so its schema never waits on the match journal's, `./storage.ts`):
 *   - `versions`, key `hash`: one record per pack version on the device — its pack id, interpreter
 *     revision, `status` (`staged` while downloading, `ready` once verified and activated) and the
 *     art it has verified so far: per art URL, the SHA-256, size, type and decoded size.
 *   - `bodies`, key `hash`: the pack's JSON text exactly as downloaded.
 *   - `art`, key `sha256`: the image bytes, content-addressed, so a new version reuses every image
 *     the old one already verified (the resume of an update is free for unchanged art).
 *   - `pointers`, key pack `id`: the active version of that pack (`hash`) and the one before it.
 *
 * Install (`install`), in phases reported through `onProgress`:
 *   1. `pack`: the pack JSON is downloaded (byte progress), parsed, fully validated
 *      (`validateOfflinePack`: every content hash, the completeness manifest, the field set) and
 *      qualified on this runtime's interpreter; a caller-given hash must match. Only then is it
 *      stored — as `staged`, never ready. A version already staged keeps the art it verified.
 *   2. `art`: every art resource the manifest requires (each card face) is fetched, unless the staged
 *      record already holds it verified (that is the resume). A response must be readable: an
 *      `opaque` response (cross-origin without CORS) is REFUSED, because its bytes cannot be read, so
 *      nothing about it can be checksummed or decoded — a `Cache.put` of it would succeed and prove
 *      nothing. A readable response must be `ok`, an image type, as long as its `Content-Length`
 *      says, and must decode in the browser (`createImageBitmap`) to a non-empty image. Its SHA-256
 *      is recorded and the bytes stored in the same transaction as the record that names them.
 *      Network failures and 5xx/429 are retried (`retries`); 404, a non-image, an undecodable
 *      image and an opaque response are not.
 *   3. `verify`: every required image is read back from the device and its SHA-256 recomputed: art
 *      that is missing or unreadable after the download is found here, before readiness.
 *   4. `activate`: ONE transaction re-checks that the version, its body and every image are on the
 *      device, marks the version `ready` and points the pack id at it. Until that transaction
 *      commits the previous version stays active and nothing a reader sees has changed; if it does
 *      not commit, nothing changed at all.
 * After activation, superseded versions of the same pack are pruned — except any version a saved
 * match references (its `packHash` in `dbs-arena-local`), which is kept until that match is gone.
 * If the saved matches cannot be read, nothing is pruned.
 *
 * Failures (`PackStoreError`, by code) never touch the active version: an interrupted download, a
 * corrupt pack, a bad image or a full device (`quota`, the browser's QuotaExceededError) leave the
 * last usable installation active and loadable, and the staged progress in place for a retry.
 *
 * Reads (`load`, `art`, `artUrls`) never use the network: the pack is re-validated from its stored
 * text, every image re-checksummed from its stored bytes.
 *
 * Cache ownership: this store uses IndexedDB only, no Cache Storage. Cache names are reserved by
 * prefix (`CACHE_PREFIXES`): `public/sw.js` owns `dbs-card-art-` and deletes only its own old
 * versions on activation; `dbs-arena-pack-` (this store, should it ever use Cache Storage) and
 * `dbs-arena-shell-` (the offline shell, #659) are never deleted by it.
 *
 * For #659/#660: `packStore()` is the API the offline shell and the preparation controls wire in —
 * `install` (with progress and an AbortSignal), `list`, `active`, `load` (a saved match's pinned
 * version by hash, active or not), `artUrls` (the pack's `CardArt` as device-local object URLs),
 * `remove` (refuses a version a saved match pins, or the active one) and `prune`.
 *
 * Browser-safe: no `node:`, no database, no auth; an entry of `scripts/verify/arena-browser-boundary.mts`.
 * The network is only the injected or global `fetch`, and only inside `install`.
 */
import type { CardArt } from "../view";
import { qualifyOfflinePack, validateOfflinePack, type OfflinePack } from "./pack";
import { LOCAL_DB_NAME, MIGRATIONS as LOCAL_MIGRATIONS, openLocalDatabase, storageErrorOf, type Migration } from "./storage";

export const PACK_DB_NAME = "dbs-arena-packs";
/** The record schema this code writes; records of a newer one are refused. */
export const PACK_STORE_SCHEMA = 1;
const VERSIONS = "versions";
const BODIES = "bodies";
const ART = "art";
const POINTERS = "pointers";
/** The journal's header store in `dbs-arena-local` (`./storage.ts`): read only, for the saved matches' `packHash`. */
const LOCAL_MATCHES = "matches";
/** One installer per origin at a time (Web Locks, when the browser has them). */
export const PACK_LOCK = "dbs-arena-pack-store";

/** Who owns which Cache Storage names. `public/sw.js` deletes only `cardArt`-prefixed caches other than its current one. */
export const CACHE_PREFIXES = { cardArt: "dbs-card-art-", packs: "dbs-arena-pack-", shell: "dbs-arena-shell-" } as const;

export const PACK_MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    describe: "versions, bodies, art (content-addressed) and pointers (the active version per pack id)",
    run(db) {
      db.createObjectStore(VERSIONS, { keyPath: "hash" });
      db.createObjectStore(BODIES, { keyPath: "hash" });
      db.createObjectStore(ART, { keyPath: "sha256" });
      db.createObjectStore(POINTERS, { keyPath: "id" });
    },
  },
];

export type PackStoreErrorCode =
  /** No IndexedDB here, or it could not be opened / upgraded. */
  | "unavailable"
  /** The database or a record was written by a newer build. */
  | "newer"
  /** The network failed (after the retries), or the download was interrupted or aborted. */
  | "network"
  /** The server answered with an error status. */
  | "http"
  /** An art resource is gone at its source (404/410). */
  | "missing-art"
  /** An opaque (cross-origin, no CORS) response: its bytes cannot be read, so it cannot be verified. */
  | "opaque"
  /** An art response that is not an image, is empty, or does not decode. */
  | "decode"
  /** Stored bytes no longer match the checksum recorded when they were verified. */
  | "checksum"
  /** The pack does not parse or fails `validateOfflinePack`. */
  | "invalid-pack"
  /** The pack is valid but not playable on this runtime. */
  | "unplayable"
  /** The pack is not the version the caller asked for. */
  | "hash-mismatch"
  /** The device's storage quota is exhausted. */
  | "quota"
  /** A saved match references the version. */
  | "pinned"
  /** The version is the active one of its pack. */
  | "active"
  /** No such version on the device (or it is not ready). */
  | "unknown"
  /** A stored record is malformed. */
  | "corrupt"
  /** A transaction was aborted for another reason. */
  | "aborted";

export class PackStoreError extends Error {
  constructor(readonly code: PackStoreErrorCode, message: string) {
    super(message);
    this.name = "PackStoreError";
  }
}

export interface ArtRef { sha256: string; size: number; type: string; width: number; height: number }

export interface VersionRecord {
  schema: number;
  hash: string;
  id: string;
  runtimeRevision: string;
  status: "staged" | "ready";
  /** The pack text's length in bytes (UTF-16 code units are close enough for a display). */
  packBytes: number;
  /** Every art URL the manifest requires, in order. */
  required: string[];
  /** The art verified so far, by URL. */
  art: Record<string, ArtRef>;
  startedAt: number;
  readyAt: number | null;
}

export interface PointerRecord { schema: number; id: string; hash: string; previous: string | null; activatedAt: number }
interface BodyRecord { schema: number; hash: string; text: string }
interface ArtRecord { schema: number; sha256: string; type: string; size: number; bytes: ArrayBuffer }

export const VERSION_RECORD_FIELDS = ["schema", "hash", "id", "runtimeRevision", "status", "packBytes", "required", "art", "startedAt", "readyAt"] as const;

export interface InstalledVersion {
  hash: string;
  id: string;
  runtimeRevision: string;
  status: "staged" | "ready";
  /** The pack's active version. */
  active: boolean;
  /** A saved match references it (`null`: the saved matches could not be read). */
  pinned: boolean | null;
  artVerified: number;
  artRequired: number;
  bytes: number;
  startedAt: number;
  readyAt: number | null;
}

export interface InstallProgress {
  phase: "pack" | "art" | "verify" | "activate" | "done";
  /** Items (pack bytes in `pack`, images otherwise) done and expected; `total` 0 when unknown. */
  done: number;
  total: number;
  /** Images already verified on the device from an earlier attempt (skipped). */
  resumed: number;
  url?: string;
}

export interface InstallSource {
  /** Where to download the pack JSON. */
  url?: string;
  /** The pack JSON itself (a file the player picked). */
  text?: string;
  /** The version the caller expects; anything else is refused. */
  expectedHash?: string;
}

export interface InstallOptions {
  onProgress?(p: InstallProgress): void;
  signal?: AbortSignal;
}

export interface PackStoreOptions {
  /** Database name (`PACK_DB_NAME`); proofs use their own. */
  name?: string;
  /** The IndexedDB factory (`globalThis.indexedDB`). */
  factory?: Pick<IDBFactory, "open">;
  /** The saved-match database to read pins from (`LOCAL_DB_NAME`). */
  localName?: string;
  /** `globalThis.fetch` by default. */
  fetch?: typeof fetch;
  /** Map a pack art URL to the URL to download it from (`sameOriginArt` by default). */
  artRequest?(url: string): string;
  /** Decode an image in the browser; `createImageBitmap` by default. */
  decode?(blob: Blob): Promise<{ width: number; height: number }>;
  /** This runtime's interpreter revision: the pack must be playable on it. `null` skips the check. */
  interpreterRevision: string | null;
  /** The pack hashes saved matches reference; read from `dbs-arena-local` by default. */
  pinnedHashes?(): Promise<Set<string>>;
  /** Retries of a network failure or 5xx/429, per resource (default 3). */
  retries?: number;
  retryDelayMs?(attempt: number): number;
  now?(): number;
  /** Web Locks; `navigator.locks` by default, `null` for none. */
  locks?: Pick<LockManager, "request"> | null;
  /** Proof-only: called before each art download, may throw to simulate an interruption. */
  beforeArt?(url: string, index: number): void;
}

/**
 * Card art through this app's own image endpoint: same-origin, so the response is readable and can
 * be checksummed and decoded. The art CDNs send no CORS headers (deckplanet's bucket answers
 * without `Access-Control-Allow-Origin`, checked 14 Oct 2026), so a direct cross-origin fetch would
 * be refused or opaque. `/_next/image` is exempt from sign-in (`src/proxy.ts` matcher) and serves
 * only the hosts in `next.config.ts`; width 640 and quality 75 are Next's defaults.
 */
export const sameOriginArt = (url: string) => `/_next/image?url=${encodeURIComponent(url)}&w=640&q=75`;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) throw new PackStoreError("unavailable", "this browser has no crypto.subtle (an insecure context?); art cannot be checksummed");
  return hex(await subtle.digest("SHA-256", bytes));
}

async function decodeWithBitmap(blob: Blob): Promise<{ width: number; height: number }> {
  const make = (globalThis as { createImageBitmap?: (b: Blob) => Promise<ImageBitmap> }).createImageBitmap;
  if (typeof make !== "function") throw new PackStoreError("unavailable", "this browser cannot decode images off the page (no createImageBitmap)");
  const bitmap = await make(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return size;
}

/** Every art URL the pack's manifest requires (each card face), in manifest order, without repeats. */
export function requiredArt(pack: OfflinePack): string[] {
  const out: string[] = [];
  for (const entry of pack.manifest.cards) {
    const art = pack.bundle.payload.art[entry.card] as CardArt | undefined;
    for (const face of entry.art) {
      const url = art?.[face];
      if (typeof url !== "string" || !url) throw new PackStoreError("invalid-pack", `${entry.card}: no ${face} art URL`);
      if (!out.includes(url)) out.push(url);
    }
  }
  return out;
}

function packStoreErrorOf(e: unknown, doing: string): PackStoreError {
  if (e instanceof PackStoreError) return e;
  const s = storageErrorOf(e, doing);
  const code: PackStoreErrorCode = s.code === "quota" ? "quota" : s.code === "newer" ? "newer" : s.code === "unavailable" || s.code === "upgrade" ? "unavailable" : s.code === "corrupt" ? "corrupt" : "aborted";
  return new PackStoreError(code, s.message);
}

function readVersion(hash: string, raw: unknown): VersionRecord {
  const what = `installed pack ${hash}`;
  if (!isRecord(raw)) throw new PackStoreError("corrupt", `${what} is not a record`);
  if (typeof raw.schema !== "number" || raw.schema < 1) throw new PackStoreError("corrupt", `${what} has no record schema`);
  if (raw.schema > PACK_STORE_SCHEMA) throw new PackStoreError("newer", `${what} is of record schema ${raw.schema}; this build reads up to ${PACK_STORE_SCHEMA}`);
  for (const k of Object.keys(raw)) if (!(VERSION_RECORD_FIELDS as readonly string[]).includes(k)) throw new PackStoreError("corrupt", `${what}: unexpected field ${k}`);
  const r = raw as Partial<VersionRecord>;
  if (r.hash !== hash || typeof r.id !== "string" || (r.status !== "staged" && r.status !== "ready") || !Array.isArray(r.required) || !isRecord(r.art)) throw new PackStoreError("corrupt", `${what} is malformed`);
  return r as VersionRecord;
}

type Tx = IDBTransaction;
/** Run `body` in one transaction; resolve with its result once the transaction commits, or reject with a named error. */
function inTransaction<T>(db: IDBDatabase, stores: string[], mode: IDBTransactionMode, doing: string, body: (tx: Tx, fail: (e: unknown) => void, set: (v: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: Tx;
    try { tx = db.transaction(stores, mode); } catch (e) { return reject(packStoreErrorOf(e, doing)); }
    let failure: PackStoreError | null = null;
    let out: T | undefined;
    const fail = (e: unknown) => { if (!failure) { failure = packStoreErrorOf(e, doing); try { tx.abort(); } catch { /* finished */ } } };
    tx.oncomplete = () => (failure ? reject(failure) : resolve(out as T));
    tx.onabort = () => reject(failure ?? packStoreErrorOf(tx.error, doing));
    try { body(tx, fail, (v) => { out = v; }); } catch (e) { fail(e); }
  });
}

const req = <T>(r: IDBRequest, fail: (e: unknown) => void, then: (v: T) => void) => {
  r.onsuccess = () => { try { then(r.result as T); } catch (e) { fail(e); } };
};

export interface PackStore {
  install(source: InstallSource, options?: InstallOptions): Promise<InstalledVersion>;
  list(): Promise<InstalledVersion[]>;
  /** The active, ready version of a pack id, or null. */
  active(id: string): Promise<InstalledVersion | null>;
  /** A ready version's pack, re-validated from the device (no network). */
  load(hash: string): Promise<OfflinePack>;
  /** A ready version's images by art URL, each re-checksummed from the device (no network). */
  art(hash: string): Promise<Map<string, Blob>>;
  /** The pack's `CardArt` as object URLs of the stored images; `revoke()` frees them. */
  artUrls(hash: string): Promise<{ art: Record<string, CardArt>; revoke(): void }>;
  /**
   * Delete a version; refused for one a saved match references, and for the active one unless
   * `active` is given (#660: removing a prepared pack from the device — its pointer goes first, so a
   * failure half-way leaves an unreferenced version, never a pointer to nothing).
   */
  remove(hash: string, options?: { active?: boolean }): Promise<void>;
  /** Delete every version that is not active, not pinned and (unless `staged`) ready, and every image no version names. */
  prune(options?: { staged?: boolean; id?: string }): Promise<{ versions: string[]; art: number; skipped?: string }>;
  close(): void;
  readonly name: string;
}

export function packStore(options: PackStoreOptions): PackStore {
  const name = options.name ?? PACK_DB_NAME;
  const now = options.now ?? (() => Date.now());
  const doFetch = (input: string, init?: RequestInit) => (options.fetch ?? globalThis.fetch)(input, init);
  const artRequest = options.artRequest ?? sameOriginArt;
  const decode = options.decode ?? decodeWithBitmap;
  const retries = options.retries ?? 3;
  const retryDelay = options.retryDelayMs ?? ((n: number) => 250 * 2 ** n);
  const locks = options.locks === undefined ? (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks ?? null : options.locks;
  const pinned = options.pinnedHashes ?? (async () => {
    const db = await openLocalDatabase({ name: options.localName ?? LOCAL_DB_NAME, factory: options.factory, migrations: LOCAL_MIGRATIONS });
    try {
      return await inTransaction<Set<string>>(db, [LOCAL_MATCHES], "readonly", "reading the saved matches' packs", (tx, fail, set) => {
        req<unknown[]>(tx.objectStore(LOCAL_MATCHES).getAll(), fail, (rows) => {
          const out = new Set<string>();
          // Read only the field, without judging the record: even a damaged save keeps its pack.
          for (const r of rows) { if (!isRecord(r) || typeof r.packHash !== "string") throw new PackStoreError("corrupt", "a saved match names no pack; which versions it needs is unknown"); out.add(r.packHash); }
          set(out);
        });
      });
    } finally { db.close(); }
  });

  let connection: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    if (!connection) {
      const opening = openLocalDatabase({ name, factory: options.factory, migrations: PACK_MIGRATIONS }).then((d) => {
        const forget = () => { if (connection === opening) connection = null; };
        d.onversionchange = () => { forget(); d.close(); };
        d.onclose = forget;
        return d;
      }, (e) => { throw packStoreErrorOf(e, `opening ${name}`); });
      connection = opening;
      opening.catch(() => { if (connection === opening) connection = null; });
    }
    return connection;
  };
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => (locks ? (locks.request(PACK_LOCK, fn) as Promise<T>) : fn());

  async function readAll(): Promise<{ versions: VersionRecord[]; pointers: PointerRecord[] }> {
    const d = await db();
    return inTransaction(d, [VERSIONS, POINTERS], "readonly", "listing installed packs", (tx, fail, set) => {
      req<unknown[]>(tx.objectStore(VERSIONS).getAll(), fail, (vs) => {
        const versions = vs.map((v) => readVersion(isRecord(v) ? String(v.hash) : "?", v));
        req<PointerRecord[]>(tx.objectStore(POINTERS).getAll(), fail, (pointers) => set({ versions, pointers }));
      });
    });
  }

  async function pinsOrNull(): Promise<Set<string> | null> {
    try { return await pinned(); } catch { return null; }
  }

  const describe = (v: VersionRecord, pointers: PointerRecord[], pins: Set<string> | null): InstalledVersion => ({
    hash: v.hash, id: v.id, runtimeRevision: v.runtimeRevision, status: v.status,
    active: pointers.some((p) => p.id === v.id && p.hash === v.hash),
    pinned: pins ? pins.has(v.hash) : null,
    artVerified: v.required.filter((u) => v.art[u]).length,
    artRequired: v.required.length,
    bytes: v.packBytes + Object.values(v.art).reduce((n, a) => n + a.size, 0),
    startedAt: v.startedAt, readyAt: v.readyAt,
  });

  async function list(): Promise<InstalledVersion[]> {
    const [{ versions, pointers }, pins] = await Promise.all([readAll(), pinsOrNull()]);
    return versions.map((v) => describe(v, pointers, pins));
  }

  async function active(id: string): Promise<InstalledVersion | null> {
    return (await list()).find((v) => v.id === id && v.active && v.status === "ready") ?? null;
  }

  // ── Download ───────────────────────────────────────────────────────────────────────────────────

  const aborted = (signal?: AbortSignal) => { if (signal?.aborted) throw new PackStoreError("network", "the download was cancelled"); };

  async function withRetries<T>(what: string, signal: AbortSignal | undefined, attempt: () => Promise<T>): Promise<T> {
    for (let n = 0; ; n++) {
      aborted(signal);
      try {
        return await attempt();
      } catch (e) {
        const retryable = !(e instanceof PackStoreError) || e.code === "network" || (e.code === "http" && /\b(5\d\d|429)\b/.test(e.message));
        if (!retryable || n >= retries || signal?.aborted) {
          if (e instanceof PackStoreError) throw e;
          throw new PackStoreError("network", `${what}: ${(e as Error)?.message ?? e}`);
        }
        await new Promise((r) => setTimeout(r, retryDelay(n)));
      }
    }
  }

  async function readBody(response: Response, what: string, onBytes?: (done: number, total: number) => void): Promise<ArrayBuffer> {
    const declared = Number(response.headers.get("content-length") ?? "");
    const total = Number.isFinite(declared) && declared > 0 ? declared : 0;
    let bytes: Uint8Array;
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let done = 0;
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try { chunk = await reader.read(); } catch (e) { throw new PackStoreError("network", `${what}: the download was interrupted after ${done} bytes (${(e as Error)?.message ?? e})`); }
        if (chunk.done) break;
        parts.push(chunk.value);
        done += chunk.value.byteLength;
        onBytes?.(done, total);
      }
      bytes = new Uint8Array(done);
      let at = 0;
      for (const p of parts) { bytes.set(p, at); at += p.byteLength; }
    } else {
      try { bytes = new Uint8Array(await response.arrayBuffer()); } catch (e) { throw new PackStoreError("network", `${what}: the download was interrupted (${(e as Error)?.message ?? e})`); }
    }
    // A Content-Length is the bytes on the wire; with a content encoding they differ, so only an identity body is checked.
    if (total && !response.headers.get("content-encoding") && bytes.byteLength !== total) {
      throw new PackStoreError("network", `${what}: the download ended after ${bytes.byteLength} of ${total} bytes`);
    }
    return bytes.buffer as ArrayBuffer;
  }

  async function fetchChecked(url: string, what: string, signal: AbortSignal | undefined, gone: PackStoreErrorCode): Promise<Response> {
    let response: Response;
    try { response = await doFetch(url, { mode: "cors", credentials: "same-origin", signal }); } catch (e) { throw new PackStoreError("network", `${what}: ${(e as Error)?.message ?? e}`); }
    if (response.type === "opaque" || response.type === "opaqueredirect") {
      throw new PackStoreError("opaque", `${what}: the response is opaque (cross-origin without CORS); its bytes cannot be read, so it cannot be checksummed or decoded`);
    }
    if (response.status === 404 || response.status === 410) throw new PackStoreError(gone, `${what}: HTTP ${response.status}`);
    if (!response.ok) throw new PackStoreError("http", `${what}: HTTP ${response.status}`);
    return response;
  }

  async function downloadPack(source: InstallSource, opt: InstallOptions): Promise<{ pack: OfflinePack; text: string }> {
    let text: string;
    if (typeof source.text === "string") text = source.text;
    else if (source.url) {
      const url = source.url;
      const bytes = await withRetries(`the pack ${url}`, opt.signal, async () => {
        const r = await fetchChecked(url, `the pack ${url}`, opt.signal, "http");
        return readBody(r, `the pack ${url}`, (done, total) => opt.onProgress?.({ phase: "pack", done, total, resumed: 0, url }));
      });
      text = new TextDecoder().decode(bytes);
    } else throw new PackStoreError("invalid-pack", "no pack to install: give a url or the pack text");
    let pack: OfflinePack;
    try { pack = JSON.parse(text) as OfflinePack; } catch (e) { throw new PackStoreError("invalid-pack", `the pack is not JSON (${(e as Error).message}) — a corrupt or interrupted download`); }
    const valid = await validateOfflinePack(pack);
    if (!valid.ok) throw new PackStoreError("invalid-pack", `the pack fails validation: ${valid.errors.join("; ")}`);
    if (source.expectedHash && pack.hash !== source.expectedHash) throw new PackStoreError("hash-mismatch", `the pack is version ${pack.hash}, not the expected ${source.expectedHash}`);
    if (options.interpreterRevision !== null) {
      const q = await qualifyOfflinePack(pack, options.interpreterRevision);
      if (!q.playable) throw new PackStoreError("unplayable", `the pack is not playable on this runtime: ${q.reasons.join("; ")}`);
    }
    return { pack, text };
  }

  async function downloadArt(url: string, index: number, signal?: AbortSignal): Promise<{ ref: ArtRef; bytes: ArrayBuffer }> {
    const what = `art ${url}`;
    return withRetries(what, signal, async () => {
      options.beforeArt?.(url, index);
      const response = await fetchChecked(artRequest(url), what, signal, "missing-art");
      const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!type.startsWith("image/")) throw new PackStoreError("decode", `${what}: the response is ${type || "untyped"}, not an image`);
      const bytes = await readBody(response, what);
      if (!bytes.byteLength) throw new PackStoreError("decode", `${what}: the image is empty`);
      const digest = await sha256(bytes);
      let size: { width: number; height: number };
      try { size = await decode(new Blob([bytes], { type })); } catch (e) {
        if (e instanceof PackStoreError) throw e;
        throw new PackStoreError("decode", `${what}: the image does not decode (${(e as Error)?.message ?? e})`);
      }
      if (!(size.width > 0 && size.height > 0)) throw new PackStoreError("decode", `${what}: the image decodes to ${size.width}×${size.height}`);
      return { ref: { sha256: digest, size: bytes.byteLength, type, width: size.width, height: size.height }, bytes };
    });
  }

  // ── Install ────────────────────────────────────────────────────────────────────────────────────

  async function stage(pack: OfflinePack, text: string): Promise<VersionRecord> {
    const d = await db();
    const required = requiredArt(pack);
    return inTransaction<VersionRecord>(d, [VERSIONS, BODIES], "readwrite", `storing pack ${pack.hash}`, (tx, fail, set) => {
      req<unknown>(tx.objectStore(VERSIONS).get(pack.hash), fail, (raw) => {
        if (raw !== undefined) {
          const existing = readVersion(pack.hash, raw);
          set(existing);
          if (existing.status === "ready") return;
          // A staged version resumes with the art it verified; the body is rewritten only if it went missing.
          req<unknown>(tx.objectStore(BODIES).get(pack.hash), fail, (body) => { if (body === undefined) tx.objectStore(BODIES).put({ schema: PACK_STORE_SCHEMA, hash: pack.hash, text } satisfies BodyRecord); });
          return;
        }
        // A new version starts with the images other versions already verified for the same URLs (an
        // update re-downloads only what changed); each is re-checksummed from its bytes before use.
        req<unknown[]>(tx.objectStore(VERSIONS).getAll(), fail, (others) => {
          const art: Record<string, ArtRef> = {};
          for (const o of others) {
            if (!isRecord(o) || !isRecord(o.art)) continue;
            for (const url of required) { const ref = (o.art as Record<string, ArtRef>)[url]; if (!art[url] && isRecord(ref) && typeof ref.sha256 === "string") art[url] = ref; }
          }
          const record: VersionRecord = {
            schema: PACK_STORE_SCHEMA, hash: pack.hash, id: pack.id, runtimeRevision: pack.compatibility.runtimeRevision,
            status: "staged", packBytes: text.length, required, art, startedAt: now(), readyAt: null,
          };
          tx.objectStore(BODIES).put({ schema: PACK_STORE_SCHEMA, hash: pack.hash, text } satisfies BodyRecord);
          tx.objectStore(VERSIONS).put(record);
          set(record);
        });
      });
    });
  }

  /** Is this image already on the device for this version, and do its bytes still match its checksum? (The resume.) */
  async function present(hash: string, url: string): Promise<boolean> {
    const d = await db();
    const found = await inTransaction<{ ref: ArtRef; bytes: ArrayBuffer } | null>(d, [VERSIONS, ART], "readonly", `checking ${url}`, (tx, fail, set) => {
      set(null);
      req<unknown>(tx.objectStore(VERSIONS).get(hash), fail, (raw) => {
        const ref = raw === undefined ? undefined : readVersion(hash, raw).art[url];
        if (!ref) return;
        req<unknown>(tx.objectStore(ART).get(ref.sha256), fail, (a) => {
          if (isRecord(a) && a.bytes instanceof ArrayBuffer && a.bytes.byteLength === ref.size) set({ ref, bytes: a.bytes });
        });
      });
    });
    // Damaged or missing bytes are downloaded again, never trusted.
    return !!found && (await sha256(found.bytes)) === found.ref.sha256;
  }

  async function storeArt(hash: string, url: string, ref: ArtRef, bytes: ArrayBuffer): Promise<void> {
    const d = await db();
    await inTransaction<void>(d, [VERSIONS, ART], "readwrite", `storing ${url}`, (tx, fail) => {
      req<unknown>(tx.objectStore(VERSIONS).get(hash), fail, (raw) => {
        if (raw === undefined) throw new PackStoreError("aborted", `pack ${hash} was removed during its download`);
        const v = readVersion(hash, raw);
        tx.objectStore(ART).put({ schema: PACK_STORE_SCHEMA, sha256: ref.sha256, type: ref.type, size: ref.size, bytes } satisfies ArtRecord);
        tx.objectStore(VERSIONS).put({ ...v, art: { ...v.art, [url]: ref } });
      });
    });
  }

  /** Read one stored image and check it against its reference. */
  function checkArt(raw: unknown, url: string, ref: ArtRef | undefined): ArtRecord {
    if (!ref) throw new PackStoreError("missing-art", `${url}: not verified on this device`);
    if (!isRecord(raw)) throw new PackStoreError("missing-art", `${url}: its image (${ref.sha256.slice(0, 12)}…) is not on the device`);
    const a = raw as Partial<ArtRecord>;
    if (!(a.bytes instanceof ArrayBuffer) || a.size !== ref.size || a.bytes.byteLength !== ref.size) throw new PackStoreError("checksum", `${url}: the stored image is unreadable or of the wrong size`);
    return a as ArtRecord;
  }

  async function readArt(hash: string, urls?: string[]): Promise<{ version: VersionRecord; images: Map<string, ArtRecord> }> {
    const d = await db();
    const out = await inTransaction<{ version: VersionRecord; images: Map<string, ArtRecord> }>(d, [VERSIONS, ART], "readonly", `reading the art of pack ${hash}`, (tx, fail, set) => {
      req<unknown>(tx.objectStore(VERSIONS).get(hash), fail, (raw) => {
        if (raw === undefined) throw new PackStoreError("unknown", `pack ${hash} is not on this device`);
        const version = readVersion(hash, raw);
        const want = urls ?? version.required;
        const images = new Map<string, ArtRecord>();
        set({ version, images });
        for (const url of want) {
          const ref = version.art[url];
          if (!ref) throw new PackStoreError("missing-art", `${url}: not verified on this device`);
          req<unknown>(tx.objectStore(ART).get(ref.sha256), fail, (a) => { images.set(url, checkArt(a, url, ref)); });
        }
      });
    });
    for (const [url, a] of out.images) {
      if ((await sha256(a.bytes)) !== out.version.art[url].sha256) throw new PackStoreError("checksum", `${url}: the stored image no longer matches the checksum recorded when it was verified`);
    }
    return out;
  }

  async function activate(pack: OfflinePack): Promise<void> {
    const d = await db();
    await inTransaction<void>(d, [VERSIONS, BODIES, ART, POINTERS], "readwrite", `activating pack ${pack.hash}`, (tx, fail) => {
      req<unknown>(tx.objectStore(VERSIONS).get(pack.hash), fail, (raw) => {
        if (raw === undefined) throw new PackStoreError("aborted", `pack ${pack.hash} was removed before it was activated`);
        const v = readVersion(pack.hash, raw);
        let left = v.required.length + 2;
        const done = () => {
          if (--left > 0) return;
          tx.objectStore(VERSIONS).put({ ...v, status: "ready", readyAt: v.readyAt ?? now() } satisfies VersionRecord);
          req<unknown>(tx.objectStore(POINTERS).get(v.id), fail, (p) => {
            const previous = isRecord(p) && typeof p.hash === "string" && p.hash !== v.hash ? p.hash : isRecord(p) ? ((p.previous as string | null) ?? null) : null;
            tx.objectStore(POINTERS).put({ schema: PACK_STORE_SCHEMA, id: v.id, hash: v.hash, previous, activatedAt: now() } satisfies PointerRecord);
          });
        };
        req<unknown>(tx.objectStore(BODIES).get(v.hash), fail, (b) => { if (!isRecord(b) || typeof b.text !== "string") throw new PackStoreError("corrupt", `pack ${v.hash}: its text is not on the device`); done(); });
        for (const url of v.required) req<unknown>(tx.objectStore(ART).get(v.art[url]?.sha256 ?? "-"), fail, (a) => { checkArt(a, url, v.art[url]); done(); });
        done();
      });
    });
  }

  async function install(source: InstallSource, opt: InstallOptions = {}): Promise<InstalledVersion> {
    return exclusive(async () => {
      const { pack, text } = await downloadPack(source, opt);
      aborted(opt.signal);
      const staged = await stage(pack, text);
      if (staged.status !== "ready") {
        const required = staged.required;
        let resumed = 0;
        for (let i = 0; i < required.length; i++) {
          aborted(opt.signal);
          const url = required[i];
          if (await present(pack.hash, url)) { resumed++; opt.onProgress?.({ phase: "art", done: i + 1, total: required.length, resumed, url }); continue; }
          const { ref, bytes } = await downloadArt(url, i, opt.signal);
          await storeArt(pack.hash, url, ref, bytes);
          opt.onProgress?.({ phase: "art", done: i + 1, total: required.length, resumed, url });
        }
        opt.onProgress?.({ phase: "verify", done: 0, total: required.length, resumed });
        await readArt(pack.hash);
        opt.onProgress?.({ phase: "verify", done: required.length, total: required.length, resumed });
      }
      opt.onProgress?.({ phase: "activate", done: 0, total: 1, resumed: 0 });
      await activate(pack);
      // Superseded versions of this pack go, staged ones included; pinned ones stay. Best effort: the install already succeeded.
      await pruneLocked({ staged: true, id: pack.id }).catch(() => undefined);
      opt.onProgress?.({ phase: "done", done: 1, total: 1, resumed: 0 });
      const v = (await list()).find((x) => x.hash === pack.hash);
      if (!v) throw new PackStoreError("aborted", `pack ${pack.hash} is not on the device after its activation`);
      return v;
    });
  }

  // ── Reads ──────────────────────────────────────────────────────────────────────────────────────

  async function load(hash: string): Promise<OfflinePack> {
    const d = await db();
    const { version, text } = await inTransaction<{ version: VersionRecord; text: string }>(d, [VERSIONS, BODIES], "readonly", `reading pack ${hash}`, (tx, fail, set) => {
      req<unknown>(tx.objectStore(VERSIONS).get(hash), fail, (raw) => {
        if (raw === undefined) throw new PackStoreError("unknown", `pack ${hash} is not on this device`);
        const version = readVersion(hash, raw);
        req<unknown>(tx.objectStore(BODIES).get(hash), fail, (b) => {
          if (!isRecord(b) || typeof b.text !== "string") throw new PackStoreError("corrupt", `pack ${hash}: its text is not on the device`);
          set({ version, text: b.text });
        });
      });
    });
    if (version.status !== "ready") throw new PackStoreError("unknown", `pack ${hash} is not ready (its download did not finish)`);
    let pack: OfflinePack;
    try { pack = JSON.parse(text) as OfflinePack; } catch { throw new PackStoreError("checksum", `pack ${hash}: the stored text no longer parses`); }
    const valid = await validateOfflinePack(pack);
    if (!valid.ok || pack.hash !== hash) throw new PackStoreError("checksum", `pack ${hash}: the stored pack no longer validates (${valid.errors.join("; ") || "another version"})`);
    return pack;
  }

  async function art(hash: string): Promise<Map<string, Blob>> {
    const { version, images } = await readArt(hash);
    if (version.status !== "ready") throw new PackStoreError("unknown", `pack ${hash} is not ready (its download did not finish)`);
    return new Map([...images].map(([url, a]) => [url, new Blob([a.bytes], { type: a.type })]));
  }

  async function artUrls(hash: string): Promise<{ art: Record<string, CardArt>; revoke(): void }> {
    const [pack, blobs] = await Promise.all([load(hash), art(hash)]);
    const made = new Map<string, string>();
    const local = (url: string | null | undefined) => {
      if (!url) return null;
      const blob = blobs.get(url);
      if (!blob) return null;
      if (!made.has(url)) made.set(url, URL.createObjectURL(blob));
      return made.get(url)!;
    };
    const out: Record<string, CardArt> = {};
    for (const [id, a] of Object.entries(pack.bundle.payload.art)) out[id] = { ...a, front: local(a.front) ?? a.front, back: local(a.back) ?? a.back } as CardArt;
    return { art: out, revoke: () => { for (const u of made.values()) URL.revokeObjectURL(u); made.clear(); } };
  }

  // ── Removal ────────────────────────────────────────────────────────────────────────────────────

  async function deleteVersions(hashes: string[]): Promise<number> {
    const d = await db();
    return inTransaction<number>(d, [VERSIONS, BODIES, ART], "readwrite", "removing pack versions", (tx, fail, set) => {
      for (const h of hashes) { tx.objectStore(VERSIONS).delete(h); tx.objectStore(BODIES).delete(h); }
      // After the deletes (same transaction, so they are seen): every image no remaining version names.
      req<unknown[]>(tx.objectStore(VERSIONS).getAll(), fail, (vs) => {
        const keep = new Set<string>();
        for (const v of vs) if (isRecord(v) && isRecord(v.art)) for (const a of Object.values(v.art)) if (isRecord(a) && typeof a.sha256 === "string") keep.add(a.sha256);
        req<string[]>(tx.objectStore(ART).getAllKeys() as IDBRequest, fail, (keys) => {
          const orphans = keys.filter((k) => !keep.has(k));
          for (const k of orphans) tx.objectStore(ART).delete(k);
          set(orphans.length);
        });
      });
    });
  }

  async function pruneLocked(opt: { staged?: boolean; id?: string } = {}): Promise<{ versions: string[]; art: number; skipped?: string }> {
    const pins = await pinsOrNull();
    if (!pins) return { versions: [], art: 0, skipped: "the saved matches could not be read, so no version is known to be unused" };
    const { versions, pointers } = await readAll();
    const activeHashes = new Set(pointers.map((p) => p.hash));
    const drop = versions.filter((v) => (!opt.id || v.id === opt.id) && !activeHashes.has(v.hash) && !pins.has(v.hash) && (v.status === "ready" || opt.staged)).map((v) => v.hash);
    const art = await deleteVersions(drop);
    return { versions: drop, art };
  }

  async function removePointers(hash: string): Promise<void> {
    const d = await db();
    await inTransaction<void>(d, [POINTERS], "readwrite", "removing the active pointer", (tx, fail) => {
      req<unknown[]>(tx.objectStore(POINTERS).getAll(), fail, (all) => {
        for (const p of all) if (isRecord(p) && p.hash === hash && typeof p.id === "string") tx.objectStore(POINTERS).delete(p.id);
      });
    });
  }

  async function remove(hash: string, opt: { active?: boolean } = {}): Promise<void> {
    await exclusive(async () => {
      const pins = await pinsOrNull();
      if (!pins) throw new PackStoreError("pinned", `pack ${hash}: the saved matches could not be read, so it is kept`);
      if (pins.has(hash)) throw new PackStoreError("pinned", `pack ${hash} is the pack of a saved match; it is kept until that match is deleted`);
      const { versions, pointers } = await readAll();
      if (!versions.some((v) => v.hash === hash)) throw new PackStoreError("unknown", `pack ${hash} is not on this device`);
      if (pointers.some((p) => p.hash === hash)) {
        if (!opt.active) throw new PackStoreError("active", `pack ${hash} is the active version; install another first`);
        await removePointers(hash);
      }
      await deleteVersions([hash]);
    });
  }

  return {
    name,
    install,
    list,
    active,
    load,
    art,
    artUrls,
    remove,
    prune: (opt) => exclusive(() => pruneLocked(opt)),
    close() {
      const c = connection;
      connection = null;
      void c?.then((d) => d.close(), () => {});
    },
  };
}
