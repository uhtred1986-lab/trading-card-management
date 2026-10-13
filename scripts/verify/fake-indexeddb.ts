/**
 * A FAKE IndexedDB for the Node proof of `src/lib/arena/local/storage.ts` (#653) â€” test-only, not a
 * polyfill. No IndexedDB implementation is installed (`fake-indexeddb` is not a dependency, and none
 * may be added), so this implements exactly the subset the store uses, with IndexedDB's semantics
 * where the store's correctness depends on them:
 *
 *  - `open(name, version)`: `upgradeneeded` inside a version-change transaction; a migration that
 *    aborts it leaves the old version and data; a lower version than stored fails as `VersionError`.
 *  - transactions over named stores: requests run asynchronously, writes are buffered and applied
 *    only at commit, which happens once no request is pending; `abort()`, a request error that is
 *    not `preventDefault`ed, or an exception in a request's success handler discards every write of
 *    the transaction and fires `abort`.
 *  - `get` / `put` with a key path (string or array); values are structured-cloned both ways.
 *  - a quota (`quotaBytes`): a `put` that would exceed it fails with `QuotaExceededError`.
 *  - `crash()`: the process dies â€” nothing in flight commits, nothing more runs; `revive()` is a new
 *    process over the same persisted data.
 *
 * Not implemented (the store does not use them): indexes, cursors, key ranges, `add`, `delete`,
 * `count`, blocked/versionchange between connections, durability hints. The real-browser half
 * (`npm run arena:local-storage-browser`) proves the store against Chrome's IndexedDB.
 */

type Key = unknown;
interface StoreData { keyPath: string | string[]; rows: Map<string, unknown> }
interface DbData { version: number; stores: Map<string, StoreData> }
type Handler = ((event: FakeEvent) => void) | null;
interface FakeEvent { target: unknown; type: string; oldVersion?: number; newVersion?: number; preventDefault(): void }

const named = (name: string, message: string) => Object.assign(new Error(message), { name });
const keyOf = (k: Key) => JSON.stringify(k);
/** A macrotask: after the current task and its microtasks, as IndexedDB delivers events. */
const later = (fn: () => void) => { setImmediate(fn); };

class FakeRequest {
  result: unknown = undefined;
  error: Error | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
  transaction: FakeTransaction | null = null;
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

export class FakeIndexedDb {
  /** The persisted databases (shared with `revive()`d instances). Proofs may edit rows directly. */
  readonly databases: Map<string, DbData>;
  quotaBytes: number | null = null;
  dead = false;

  constructor(databases = new Map<string, DbData>()) {
    this.databases = databases;
  }

  /** Every row of a store, as persisted (live map: a proof's edit is a change on disk). */
  rows(db: string, store: string): Map<string, unknown> {
    const s = this.databases.get(db)?.stores.get(store);
    if (!s) throw new Error(`fake: no store ${db}/${store}`);
    return s.rows;
  }

  usedBytes(extra?: Map<string, Map<string, unknown>>, dbName?: string): number {
    let n = 0;
    for (const [name, d] of this.databases) {
      for (const [storeName, s] of d.stores) {
        const overlay = name === dbName ? extra?.get(storeName) : undefined;
        for (const [k, v] of s.rows) if (!overlay?.has(k)) n += k.length + JSON.stringify(v).length;
        if (overlay) for (const [k, v] of overlay) n += k.length + JSON.stringify(v).length;
      }
    }
    return n;
  }

  crash(): void { this.dead = true; }
  revive(): FakeIndexedDb { return new FakeIndexedDb(this.databases); }

  open(name: string, version?: number): FakeRequest {
    const req = new FakeRequest();
    later(() => {
      if (this.dead) return;
      const existing = this.databases.get(name);
      const current = existing?.version ?? 0;
      const target = version ?? Math.max(current, 1);
      if (target < current) {
        req.error = named("VersionError", `The requested version (${target}) is less than the existing version (${current}).`);
        req.onerror?.({ target: req, type: "error", preventDefault() {} });
        return;
      }
      const data: DbData = existing ?? { version: 0, stores: new Map() };
      if (target === current) {
        req.result = new FakeDatabase(this, name, data);
        req.onsuccess?.({ target: req, type: "success", preventDefault() {} });
        return;
      }
      // Version change: the schema is edited on a copy and kept only if the transaction completes.
      const schema: DbData = { version: target, stores: new Map(data.stores) };
      const conn = new FakeDatabase(this, name, schema, true);
      const tx = new FakeTransaction(this, conn, name, [...schema.stores.keys()], "versionchange");
      req.result = conn;
      req.transaction = tx;
      tx.onComplete = () => {
        conn.upgrading = false;
        this.databases.set(name, schema);
        req.transaction = null;
        req.onsuccess?.({ target: req, type: "success", preventDefault() {} });
      };
      tx.onAbort = () => {
        req.result = undefined;
        req.error = named("AbortError", "The version change transaction was aborted.");
        req.onerror?.({ target: req, type: "error", preventDefault() {} });
      };
      try {
        req.onupgradeneeded?.({ target: req, type: "upgradeneeded", oldVersion: current, newVersion: target, preventDefault() {} });
      } catch (e) {
        if (!tx.finished) tx.abort(e as Error);
      }
      tx.settle();
    });
    return req;
  }
}

class FakeDatabase {
  onversionchange: Handler = null;
  onclose: Handler = null;
  closed = false;
  constructor(private readonly idb: FakeIndexedDb, readonly name: string, readonly data: DbData, public upgrading = false) {}
  get version() { return this.data.version; }
  get objectStoreNames() { return { contains: (n: string) => this.data.stores.has(n), length: this.data.stores.size }; }
  createObjectStore(name: string, options: { keyPath: string | string[] }) {
    if (!this.upgrading) throw named("InvalidStateError", "createObjectStore outside a version change");
    if (this.data.stores.has(name)) throw named("ConstraintError", `store ${name} exists`);
    this.data.stores.set(name, { keyPath: options.keyPath, rows: new Map() });
    return {};
  }
  transaction(scope: string | string[], mode: "readonly" | "readwrite" = "readonly") {
    if (this.closed) throw named("InvalidStateError", "The database connection is closing.");
    const names = Array.isArray(scope) ? scope : [scope];
    for (const n of names) if (!this.data.stores.has(n)) throw named("NotFoundError", `no store ${n}`);
    const tx = new FakeTransaction(this.idb, this, this.name, names, mode);
    tx.settle();
    return tx;
  }
  close() { this.closed = true; }
}

class FakeTransaction {
  oncomplete: Handler = null;
  onabort: Handler = null;
  onerror: Handler = null;
  error: Error | null = null;
  finished = false;
  /** Internal hooks for the version-change open. */
  onComplete: (() => void) | null = null;
  onAbort: (() => void) | null = null;
  private pending = 0;
  private readonly overlay = new Map<string, Map<string, unknown>>();

  constructor(private readonly idb: FakeIndexedDb, readonly db: FakeDatabase, private readonly dbName: string, private readonly scope: string[], readonly mode: string) {}

  objectStore(name: string) {
    if (!this.scope.includes(name) && this.mode !== "versionchange") throw named("NotFoundError", `store ${name} not in this transaction`);
    const store = this.db.data.stores.get(name);
    if (!store) throw named("NotFoundError", `no store ${name}`);
    return {
      get: (key: Key) => this.request(() => {
        const k = keyOf(key);
        const o = this.overlay.get(name);
        const v = o?.has(k) ? o.get(k) : store.rows.get(k);
        return v === undefined ? undefined : structuredClone(v);
      }),
      put: (value: Record<string, unknown>) => {
        if (this.mode === "readonly") throw named("ReadOnlyError", "put in a readonly transaction");
        const copy = structuredClone(value);
        const key = Array.isArray(store.keyPath) ? store.keyPath.map((p) => copy[p]) : copy[store.keyPath];
        return this.request(() => {
          const o = this.overlay.get(name) ?? new Map<string, unknown>();
          const k = keyOf(key);
          if (this.idb.quotaBytes !== null) {
            const trial = new Map(this.overlay);
            trial.set(name, new Map(o).set(k, copy));
            if (this.idb.usedBytes(trial, this.dbName) > this.idb.quotaBytes) throw named("QuotaExceededError", "The quota has been exceeded.");
          }
          o.set(k, copy);
          this.overlay.set(name, o);
          return key;
        });
      },
    };
  }

  abort(reason?: Error) {
    if (this.finished) throw named("InvalidStateError", "The transaction has finished.");
    this.finish(false, reason ?? named("AbortError", "The transaction was aborted."));
  }

  private request(op: () => unknown) {
    if (this.finished) throw named("TransactionInactiveError", "The transaction has finished.");
    const req = new FakeRequest();
    this.pending++;
    later(() => {
      if (this.idb.dead || this.finished) return;
      this.pending--;
      let value: unknown;
      try {
        value = op();
      } catch (e) {
        req.error = e as Error;
        let prevented = false;
        const event = { target: req, type: "error", preventDefault() { prevented = true; } };
        try { req.onerror?.(event); this.onerror?.(event); } catch { /* an exception in an error handler aborts too */ }
        if (!prevented && !this.finished) this.finish(false, e as Error);
        this.settle();
        return;
      }
      req.result = value;
      try {
        req.onsuccess?.({ target: req, type: "success", preventDefault() {} });
      } catch (e) {
        if (!this.finished) this.finish(false, e as Error);
      }
      this.settle();
    });
    return req;
  }

  /** Commit once nothing is pending (after the current task, as IndexedDB auto-commits). */
  settle() {
    later(() => {
      if (this.idb.dead || this.finished || this.pending > 0) return;
      this.finish(true, null);
    });
  }

  private finish(commit: boolean, error: Error | null) {
    this.finished = true;
    if (commit && this.mode !== "versionchange") {
      const data = this.idb.databases.get(this.dbName);
      for (const [name, rows] of this.overlay) for (const [k, v] of rows) data!.stores.get(name)!.rows.set(k, v);
    }
    this.overlay.clear();
    this.error = error;
    later(() => {
      if (this.idb.dead) return;
      if (commit) { this.onComplete?.(); this.oncomplete?.({ target: this, type: "complete", preventDefault() {} }); }
      else { this.onAbort?.(); this.onabort?.({ target: this, type: "abort", preventDefault() {} }); }
    });
  }
}

/** The fake as the store's `factory` option expects it. */
export const asFactory = (fake: FakeIndexedDb) => fake as unknown as Pick<IDBFactory, "open">;
