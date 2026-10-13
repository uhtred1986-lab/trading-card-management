/**
 * Local matches kept on the device (#653, plan O3-03): the IndexedDB `JournalStore` the local match
 * worker (`./worker-entry.ts`) journals into, so a match survives a reload, a closed tab or a killed
 * worker, and is continued by `resume` (`./worker.ts`, which replays and verifies it).
 *
 * Layout (database `dbs-arena-local`, one per origin, browser-only — never a server table):
 *   - `matches`, key `matchId`: one header per match — what it was started from (pack hash, decks,
 *     seat, the game's seed and the AI's own seed), the interpreter revision and policy version it
 *     runs on, its revision and decision count, the AI's memory (its RNG included), the request
 *     receipts, the trace, the status, and two integrity digests.
 *   - `decisions`, key `[matchId, index]`: one record per committed decision, as the journal keeps it
 *     (a human move as the engine move it resolved to; an AI move by its decision id), each chained
 *     to the one before.
 *   - `owners` (schema version 2, #654), key `matchId`: the match's writer lease — the holding tab's
 *     opaque id, its fencing epoch, heartbeat and whether it was released (`LeaseRecord`).
 *
 * One commit is one IndexedDB transaction over both stores: the decisions the commit adds and the
 * header that counts them are written together or not at all. A transaction aborted for any reason —
 * quota, a killed worker, an injected fault — leaves the previous commit exactly as it was, and the
 * caller learns it as a `StorageError`; the worker's in-memory match is only advanced after the
 * write completed (`commit` in `./worker.ts`). A commit never rewrites history: a journal shorter
 * than, or diverging from, what is stored is refused (`rewrite`).
 *
 * On read every record is checked: its schema (newer than this code → `newer`), its shape
 * (`corrupt`), the header's digest and the decision chain (`tampered`), and that every decision the
 * header counts is there and nothing beyond (`truncated`/`corrupt`). The digests are cyrb53
 * (`fingerprint`): they catch damage and naive edits, not a forger who recomputes them — the
 * resume replay (`replayJournal`) still re-plays every decision and refuses one the policy does not
 * reproduce, and a page can only ever read what the worker projects for it.
 *
 * Schema changes go through `MIGRATIONS`, run in order inside IndexedDB's version-change
 * transaction: a migration only adds (stores, indexes, optional fields), so an older save is read
 * by newer code. A migration that throws aborts the upgrade and leaves the database at its old
 * version with its data. A database or record from a newer build is refused, never rewritten.
 *
 * What is stored is the worker's journal and nothing else: no account, collection, deck owner or
 * email, no projected board, no engine state (it is re-created by replay). The pack is stored by
 * hash only; the page supplies it again on resume.
 *
 * One writer per match (#654): the `owners` store (schema version 2, added by an additive migration)
 * holds one lease per match — which tab holds it, its fencing epoch, its last heartbeat. A commit
 * may carry the writer's fence (`put(journal, fence)`); the lease is read in the commit's own
 * transaction and a commit whose fence is not the current lease is refused (`fenced`) with nothing
 * written, so a suspended or superseded writer can never append to a newer owner's history. A commit
 * without a fence is refused while any writer holds the match. Claiming, renewing and releasing the
 * lease is `./ownership.ts`. A connection closes itself when another tab upgrades the database.
 *
 * Browser-safe: no `node:`, no database, no network; an entry of `scripts/verify/arena-browser-boundary.mts`.
 */
import type { JournalEntry, MatchJournal, Receipt, JournalStore } from "./worker";
import type { LocalErrorCode, SessionStatus } from "./protocol";
import { fingerprint, stableJson } from "../policy/contract";

export const LOCAL_DB_NAME = "dbs-arena-local";
/** The record schema this code writes; records of a newer one are refused. */
export const STORAGE_SCHEMA = 1;
const MATCHES = "matches";
const DECISIONS = "decisions";
/** One writer lease per match (#654, `./ownership.ts`). */
export const OWNERS = "owners";

export interface Migration {
  /** The database version this migration brings the database to. */
  version: number;
  describe: string;
  /** Additive only: create stores or indexes. Runs inside the version-change transaction. */
  run(db: IDBDatabase, tx: IDBTransaction): void;
}

/** Every schema step, oldest first; the database version is the last one's. */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    describe: "matches (one header per match) and decisions (one record per committed decision)",
    run(db) {
      db.createObjectStore(MATCHES, { keyPath: "matchId" });
      db.createObjectStore(DECISIONS, { keyPath: ["matchId", "index"] });
    },
  },
  {
    version: 2,
    describe: "owners (one writer lease per match, its fencing epoch and heartbeat; #654)",
    run(db) {
      db.createObjectStore(OWNERS, { keyPath: "matchId" });
    },
  },
];

export type StorageErrorCode =
  /** No IndexedDB here, or the database could not be opened. */
  | "unavailable"
  /** The database or a record was written by a newer build. */
  | "newer"
  /** A schema migration failed; the database stays at its previous version. */
  | "upgrade"
  /** A record is not of the shape this code writes. */
  | "corrupt"
  /** A digest or the decision chain does not match: the record was changed outside this code. */
  | "tampered"
  /** Decisions the header counts are missing. */
  | "truncated"
  /** A commit would shorten or change the stored history. */
  | "rewrite"
  /** The device's storage quota is exhausted. */
  | "quota"
  /** The transaction was aborted (another reason, named in the message). */
  | "aborted"
  /** The commit's writer is not the match's current writer (another tab took it over, #654); nothing was written. */
  | "fenced";

/** How the worker reports each storage failure to the page (`./protocol.ts`). */
export const STORAGE_PROTOCOL_CODE: Record<StorageErrorCode, LocalErrorCode> = {
  unavailable: "storage",
  quota: "storage",
  aborted: "storage",
  upgrade: "storage",
  newer: "newer",
  corrupt: "journal",
  tampered: "journal",
  truncated: "journal",
  rewrite: "journal",
  fenced: "busy-elsewhere",
};

export class StorageError extends Error {
  constructor(readonly code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
  }
}

/** The header record, as stored. */
export interface MatchRecord {
  schema: number;
  matchId: string;
  journalFormat: number;
  packHash: string;
  decks: { p1: string; p2: string };
  human: "p1" | "p2";
  seed: number;
  policySeed: number;
  interpreterRevision: string;
  policyVersion: string;
  /** The match's revision: decisions + 1. */
  revision: number;
  decisions: number;
  /** The chain value of the last decision (`chainStart` when there is none). */
  chain: string;
  aiMemory: MatchJournal["aiMemory"];
  receipts: Receipt[];
  trace: string;
  status: SessionStatus;
  interruption: string | null;
  /** `fingerprint` of every other field. */
  digest: string;
}

export interface DecisionRecord {
  schema: number;
  matchId: string;
  index: number;
  entry: JournalEntry;
  /** `fingerprint(previous chain + this entry)`. */
  chain: string;
}

/** Who may commit to a match: the lease's holder (a tab) and the epoch it was granted at (#654). */
export interface WriterFence {
  holder: string;
  epoch: number;
}

/** The writer lease of one match (`owners` store, #654). Each grant raises `epoch`; a commit must carry the current one. */
export interface LeaseRecord {
  schema: number;
  matchId: string;
  /** The tab that holds (or last held) the match: an opaque id, never an account. */
  holder: string;
  epoch: number;
  /** The holder's clock (ms since the epoch) at its last claim or renewal. */
  heartbeatAt: number;
  /** The holder let go; the next claim needs no wait. */
  released: boolean;
}

/** The exact field sets written, so a proof can show nothing else is stored. */
export const MATCH_RECORD_FIELDS = ["schema", "matchId", "journalFormat", "packHash", "decks", "human", "seed", "policySeed", "interpreterRevision", "policyVersion", "revision", "decisions", "chain", "aiMemory", "receipts", "trace", "status", "interruption", "digest"] as const;
export const DECISION_RECORD_FIELDS = ["schema", "matchId", "index", "entry", "chain"] as const;
export const LEASE_RECORD_FIELDS = ["schema", "matchId", "holder", "epoch", "heartbeatAt", "released"] as const;

/** Check a stored lease: schema and shape. `undefined` (no lease) is `null`. */
export function readLeaseRecord(matchId: string, raw: unknown): LeaseRecord | null {
  if (raw === undefined) return null;
  const what = `the writer lease of match ${matchId}`;
  if (!isRecord(raw)) throw new StorageError("corrupt", `${what} is not a record`);
  schemaOf(what, raw);
  for (const k of Object.keys(raw)) if (!(LEASE_RECORD_FIELDS as readonly string[]).includes(k)) throw new StorageError("corrupt", `${what}: unexpected field ${k}`);
  const r = raw as Partial<LeaseRecord>;
  if (r.matchId !== matchId || !isStr(r.holder) || !isInt(r.epoch) || (r.epoch as number) < 1 || typeof r.heartbeatAt !== "number" || typeof r.released !== "boolean") {
    throw new StorageError("corrupt", `${what} is malformed`);
  }
  return r as LeaseRecord;
}

/**
 * The fencing rule, applied inside a commit's transaction: a fenced commit needs the lease to be
 * exactly its fence and not released; an unfenced one needs no writer to hold the match.
 */
export function fenceRefusal(lease: LeaseRecord | null, fence: WriterFence | null | undefined): string | null {
  if (fence) {
    if (!lease) return `no writer holds the match; this writer's claim (epoch ${fence.epoch}) is not on the device`;
    if (lease.holder !== fence.holder || lease.epoch !== fence.epoch) return `another writer holds the match now (epoch ${lease.epoch}); this writer's epoch ${fence.epoch} is superseded`;
    if (lease.released) return `this writer released the match (epoch ${fence.epoch})`;
    return null;
  }
  if (lease && !lease.released) return `a writer holds the match (epoch ${lease.epoch}); a commit without its fence is refused`;
  return null;
}

const chainStart = (matchId: string) => fingerprint(`${LOCAL_DB_NAME}:${matchId}`);
const chainNext = (previous: string, entry: JournalEntry) => fingerprint(`${previous}|${stableJson(entry)}`);
const headerDigest = (record: Omit<MatchRecord, "digest">) => fingerprint(stableJson({ ...record, digest: undefined }));

/** The chain value after each entry. */
export function chainOf(matchId: string, entries: readonly JournalEntry[]): string[] {
  const out: string[] = [];
  let c = chainStart(matchId);
  for (const e of entries) out.push((c = chainNext(c, e)));
  return out;
}

export function matchRecordOf(journal: MatchJournal, chains = chainOf(journal.matchId, journal.entries)): MatchRecord {
  const body: Omit<MatchRecord, "digest"> = {
    schema: STORAGE_SCHEMA,
    matchId: journal.matchId,
    journalFormat: journal.format,
    packHash: journal.packHash,
    decks: { p1: journal.decks.p1, p2: journal.decks.p2 },
    human: journal.human,
    seed: journal.seed,
    policySeed: journal.policySeed,
    interpreterRevision: journal.interpreterRevision,
    policyVersion: journal.policyVersion,
    revision: journal.entries.length + 1,
    decisions: journal.entries.length,
    chain: journal.entries.length ? chains[journal.entries.length - 1] : chainStart(journal.matchId),
    aiMemory: journal.aiMemory,
    receipts: journal.receipts,
    trace: journal.trace,
    status: journal.status,
    interruption: journal.interruption,
  };
  return { ...body, digest: headerDigest(body) };
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isInt = (v: unknown): v is number => Number.isInteger(v);
const isSeat = (v: unknown) => v === "p1" || v === "p2";

function schemaOf(what: string, v: Record<string, unknown>): void {
  if (!isInt(v.schema) || (v.schema as number) < 1) throw new StorageError("corrupt", `${what} has no record schema`);
  if ((v.schema as number) > STORAGE_SCHEMA) throw new StorageError("newer", `${what} is of record schema ${String(v.schema)}; this build reads up to ${STORAGE_SCHEMA}`);
}

/** Check a stored header: schema, shape, digest. */
export function readMatchRecord(matchId: string, raw: unknown): MatchRecord {
  const what = `saved match ${matchId}`;
  if (!isRecord(raw)) throw new StorageError("corrupt", `${what}: the header is not a record`);
  schemaOf(what, raw);
  const r = raw as Partial<MatchRecord> & Record<string, unknown>;
  for (const k of Object.keys(r)) if (!(MATCH_RECORD_FIELDS as readonly string[]).includes(k)) throw new StorageError("corrupt", `${what}: unexpected field ${k}`);
  const bad = (field: string) => new StorageError("corrupt", `${what}: ${field} is missing or malformed`);
  if (r.matchId !== matchId) throw bad("matchId");
  if (!isInt(r.journalFormat)) throw bad("journalFormat");
  if (!isStr(r.packHash) || !r.packHash) throw bad("packHash");
  if (!isRecord(r.decks) || !isStr(r.decks.p1) || !isStr(r.decks.p2)) throw bad("decks");
  if (!isSeat(r.human)) throw bad("human");
  if (!isInt(r.seed) || !isInt(r.policySeed)) throw bad("seed");
  if (!isStr(r.interpreterRevision) || !isStr(r.policyVersion)) throw bad("versions");
  if (!isInt(r.decisions) || r.decisions < 0 || r.revision !== r.decisions + 1) throw bad("revision");
  if (!isStr(r.chain) || !isStr(r.trace) || !isStr(r.digest)) throw bad("digests");
  if (!isRecord(r.aiMemory)) throw bad("aiMemory");
  if (!Array.isArray(r.receipts) || !r.receipts.every((x) => isRecord(x) && isStr(x.requestId) && isStr(x.fingerprint) && isInt(x.revision))) throw bad("receipts");
  if (r.status !== "playing" && r.status !== "over" && r.status !== "interrupted") throw bad("status");
  if (r.interruption !== null && !isStr(r.interruption)) throw bad("interruption");
  const { digest, ...body } = r as MatchRecord;
  if (headerDigest(body) !== digest) throw new StorageError("tampered", `${what}: the header's digest does not match its content`);
  return r as MatchRecord;
}

function readDecision(matchId: string, index: number, raw: unknown, previous: string): DecisionRecord {
  const what = `saved match ${matchId}, decision ${index + 1}`;
  if (!isRecord(raw)) throw new StorageError("corrupt", `${what} is not a record`);
  schemaOf(what, raw);
  for (const k of Object.keys(raw)) if (!(DECISION_RECORD_FIELDS as readonly string[]).includes(k)) throw new StorageError("corrupt", `${what}: unexpected field ${k}`);
  const d = raw as Partial<DecisionRecord>;
  if (d.matchId !== matchId || d.index !== index || !isStr(d.chain)) throw new StorageError("corrupt", `${what}: its key fields are malformed`);
  const e = d.entry as Record<string, unknown> | undefined;
  const entryOk = isRecord(e) && isSeat(e.seat) && ((e.kind === "ai" && isStr(e.id)) || (e.kind === "human" && isRecord(e.action) && isStr((e.action as { type?: unknown }).type) && isStr(e.requestId)));
  if (!entryOk) throw new StorageError("corrupt", `${what}: the decision is malformed`);
  if (chainNext(previous, d.entry as JournalEntry) !== d.chain) throw new StorageError("tampered", `${what} does not follow the decision before it`);
  return d as DecisionRecord;
}

export function journalOfRecords(header: MatchRecord, decisions: readonly DecisionRecord[]): MatchJournal {
  return {
    format: header.journalFormat as MatchJournal["format"],
    matchId: header.matchId,
    packHash: header.packHash,
    decks: header.decks,
    human: header.human,
    seed: header.seed,
    policySeed: header.policySeed,
    interpreterRevision: header.interpreterRevision,
    policyVersion: header.policyVersion,
    entries: decisions.map((d) => d.entry),
    aiMemory: header.aiMemory,
    receipts: header.receipts,
    trace: header.trace,
    status: header.status,
    interruption: header.interruption,
  };
}

/** Name a DOMException (or anything a transaction failed with) as a storage error. */
export function storageErrorOf(e: unknown, doing: string): StorageError {
  if (e instanceof StorageError) return e;
  const name = (e as { name?: string } | null)?.name ?? "";
  const message = (e as { message?: string } | null)?.message ?? String(e);
  if (name === "QuotaExceededError") return new StorageError("quota", `${doing}: the device's storage is full (${message})`);
  return new StorageError("aborted", `${doing}: ${name || "error"}${message ? ` — ${message}` : ""}`);
}

/** Proof-only hooks (never set by the worker entry). */
export interface StorageFaults {
  /**
   * Called inside a commit's transaction after its decisions were queued and before its header is:
   * a proof may `abort()` the transaction, throw, or keep it open and kill the worker.
   */
  duringWrite?(ctx: { tx: IDBTransaction; decisions: IDBObjectStore; matchId: string; added: number }): void;
}

export interface IndexedDbStoreOptions {
  /** Database name (`LOCAL_DB_NAME`); proofs use their own. */
  name?: string;
  /** The IndexedDB factory (`globalThis.indexedDB`); a proof may pass another. */
  factory?: Pick<IDBFactory, "open">;
  /** Schema steps (`MIGRATIONS`); proofs pass a prefix or an extra step to prove the upgrade path. */
  migrations?: readonly Migration[];
  faults?: StorageFaults;
}

export interface IndexedDbJournalStore extends JournalStore {
  get(matchId: string): Promise<MatchJournal | null>;
  /** One commit; with a `fence`, refused as `fenced` unless that fence is the match's current lease (#654). */
  put(journal: MatchJournal, fence?: WriterFence | null): Promise<void>;
  /** Open (and if need be upgrade) the database now, so the first commit does not wait for it; a failure is reported by the next `get`/`put`. */
  warm(): void;
  /** Close the connection (the next call opens it again). */
  close(): void;
  readonly name: string;
  readonly version: number;
}

/** The version-change open, migrations in order; every failure named. */
export function openLocalDatabase(options: IndexedDbStoreOptions = {}): Promise<IDBDatabase> {
  const name = options.name ?? LOCAL_DB_NAME;
  const migrations = options.migrations ?? MIGRATIONS;
  const version = migrations.length ? migrations[migrations.length - 1].version : 0;
  const factory = options.factory ?? (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  return new Promise((resolve, reject) => {
    if (!factory) return reject(new StorageError("unavailable", "this browser offers no IndexedDB"));
    if (!migrations.every((m, i) => m.version === i + 1)) return reject(new StorageError("upgrade", "the migrations are not numbered 1, 2, 3, …"));
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(name, version);
    } catch (e) {
      return reject(new StorageError("unavailable", `could not open ${name}: ${(e as Error).message ?? e}`));
    }
    let failed: StorageError | null = null;
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction!;
      const from = event.oldVersion;
      try {
        for (const m of migrations) if (m.version > from) m.run(db, tx);
      } catch (e) {
        failed = new StorageError("upgrade", `upgrading ${name} from version ${from} to ${version} failed: ${(e as Error).message ?? e}; it stays at version ${from}`);
        tx.abort();
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = (event) => {
      (event as Event).preventDefault?.();
      const err = request.error;
      if (failed) reject(failed);
      else if (err?.name === "VersionError") reject(new StorageError("newer", `${name} was written by a newer build (database version above ${version}); it is left untouched`));
      else reject(new StorageError("unavailable", `could not open ${name}: ${err?.name ?? "error"} ${err?.message ?? ""}`.trim()));
    };
    // `blocked`: another tab holds an older connection; it closes on `versionchange` and the open proceeds.
  });
}

/** The IndexedDB journal store. Each `put` is one transaction; each `get` validates everything it reads. */
export function indexedDbJournalStore(options: IndexedDbStoreOptions = {}): IndexedDbJournalStore {
  const name = options.name ?? LOCAL_DB_NAME;
  const migrations = options.migrations ?? MIGRATIONS;
  let connection: Promise<IDBDatabase> | null = null;
  const db = (): Promise<IDBDatabase> => {
    if (!connection) {
      const opening = openLocalDatabase(options).then((d) => {
        const forget = () => { if (connection === opening) connection = null; };
        // Another tab upgrading the database must not wait on this connection; the next call reopens.
        d.onversionchange = () => { forget(); d.close(); };
        d.onclose = forget;
        return d;
      });
      connection = opening;
      opening.catch(() => { if (connection === opening) connection = null; });
    }
    return connection;
  };

  function transaction(d: IDBDatabase, mode: IDBTransactionMode, doing: string): IDBTransaction {
    try {
      return d.transaction([MATCHES, DECISIONS], mode);
    } catch (e) {
      connection = null; // a closed connection: the next call opens a new one
      throw storageErrorOf(e, doing);
    }
  }

  async function get(matchId: string): Promise<MatchJournal | null> {
    const d = await db();
    const doing = `reading saved match ${matchId}`;
    return new Promise((resolve, reject) => {
      const tx = transaction(d, "readonly", doing);
      let failure: StorageError | null = null;
      let out: MatchJournal | null = null;
      const fail = (e: unknown) => { if (!failure) { failure = storageErrorOf(e, doing); try { tx.abort(); } catch { /* already finished */ } } };
      const matches = tx.objectStore(MATCHES);
      const decisions = tx.objectStore(DECISIONS);
      const head = matches.get(matchId);
      head.onsuccess = () => {
        try {
          if (head.result === undefined) {
            // No header: a decision without one is a half-written or tampered save, never "nothing saved".
            const orphan = decisions.get([matchId, 0]);
            orphan.onsuccess = () => { if (orphan.result !== undefined) fail(new StorageError("truncated", `saved match ${matchId} has decisions and no header`)); };
            return;
          }
          const header = readMatchRecord(matchId, head.result);
          const found: unknown[] = new Array(header.decisions);
          let left = header.decisions + 1;
          const done = () => {
            if (--left > 0 || failure) return;
            try {
              const records: DecisionRecord[] = [];
              let previous = chainStart(matchId);
              for (let i = 0; i < header.decisions; i++) {
                if (found[i] === undefined) throw new StorageError("truncated", `saved match ${matchId} counts ${header.decisions} decisions and decision ${i + 1} is missing`);
                const r = readDecision(matchId, i, found[i], previous);
                records.push(r);
                previous = r.chain;
              }
              if (previous !== header.chain) throw new StorageError("tampered", `saved match ${matchId}: the decisions do not end where the header says`);
              out = journalOfRecords(header, records);
            } catch (e) { fail(e); }
          };
          for (let i = 0; i < header.decisions; i++) {
            const r = decisions.get([matchId, i]);
            r.onsuccess = () => { found[i] = r.result; done(); };
          }
          const beyond = decisions.get([matchId, header.decisions]);
          beyond.onsuccess = () => {
            if (beyond.result !== undefined) fail(new StorageError("corrupt", `saved match ${matchId} has a decision beyond the ${header.decisions} its header counts`));
            else done();
          };
        } catch (e) { fail(e); }
      };
      tx.oncomplete = () => (failure ? reject(failure) : resolve(out));
      tx.onabort = () => reject(failure ?? storageErrorOf(tx.error, doing));
    });
  }

  async function put(journal: MatchJournal, fence?: WriterFence | null): Promise<void> {
    const chains = chainOf(journal.matchId, journal.entries);
    const header = matchRecordOf(journal, chains);
    const d = await db();
    const doing = `saving match ${journal.matchId} at revision ${header.revision}`;
    // A database without the owners store (a proof's schema-1 build) has no leases to check; a fenced commit there cannot be checked and is refused.
    const fenced = d.objectStoreNames.contains(OWNERS);
    if (!fenced && fence) throw new StorageError("fenced", `${doing}: this database has no writer leases to check the fence against`);
    return new Promise((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = d.transaction(fenced ? [MATCHES, DECISIONS, OWNERS] : [MATCHES, DECISIONS], "readwrite");
      } catch (e) {
        connection = null; // a closed connection: the next call opens a new one
        return reject(storageErrorOf(e, doing));
      }
      let failure: StorageError | null = null;
      const fail = (e: unknown) => { if (!failure) { failure = storageErrorOf(e, doing); try { tx.abort(); } catch { /* already finished */ } } };
      const matches = tx.objectStore(MATCHES);
      const decisions = tx.objectStore(DECISIONS);
      tx.oncomplete = () => (failure ? reject(failure) : resolve());
      tx.onabort = () => reject(failure ?? storageErrorOf(tx.error, doing));
      const writeAfterHead = () => {
        const head = matches.get(journal.matchId);
        head.onsuccess = () => {
          try {
            let from = 0;
            if (head.result !== undefined) {
              const stored = head.result as unknown;
              if (!isRecord(stored)) throw new StorageError("corrupt", `${doing}: the stored header is not a record`);
              schemaOf(`saved match ${journal.matchId}`, stored);
              const s = stored as Partial<MatchRecord>;
              from = isInt(s.decisions) ? s.decisions : -1;
              const same = (k: keyof MatchRecord) => stableJson(s[k]) === stableJson(header[k]);
              if (from < 0 || from > journal.entries.length) throw new StorageError("rewrite", `${doing}: the device holds ${String(s.decisions)} decisions; a commit never shortens a match`);
              if (from > 0 && chains[from - 1] !== s.chain) throw new StorageError("rewrite", `${doing}: its first ${from} decisions are not the stored ones`);
              for (const k of ["packHash", "decks", "human", "seed", "policySeed", "interpreterRevision", "policyVersion", "journalFormat"] as const) {
                if (!same(k)) throw new StorageError("rewrite", `${doing}: ${k} differs from the stored match`);
              }
              // Nothing new (a resume re-saving what it read): write nothing, so it needs no storage space.
              if (from === journal.entries.length && s.digest === header.digest) return;
            }
            for (let i = from; i < journal.entries.length; i++) {
              const record: DecisionRecord = { schema: STORAGE_SCHEMA, matchId: journal.matchId, index: i, entry: journal.entries[i], chain: chains[i] };
              decisions.put(record);
            }
            options.faults?.duringWrite?.({ tx, decisions, matchId: journal.matchId, added: journal.entries.length - from });
            matches.put(header);
          } catch (e) { fail(e); }
        };
      };
      // The fence is read in this very transaction: a takeover committed before it is seen, one after it waits for it (#654).
      if (fenced) {
        const lease = tx.objectStore(OWNERS).get(journal.matchId);
        lease.onsuccess = () => {
          try {
            const refusal = fenceRefusal(readLeaseRecord(journal.matchId, lease.result), fence);
            if (refusal) throw new StorageError("fenced", `${doing}: ${refusal}`);
            writeAfterHead();
          } catch (e) { fail(e); }
        };
      } else writeAfterHead();
    });
  }

  return {
    name,
    version: migrations.length,
    get,
    put,
    warm() { void db().catch(() => {}); },
    close() {
      const c = connection;
      connection = null;
      void c?.then((d) => d.close(), () => {});
    },
  };
}
