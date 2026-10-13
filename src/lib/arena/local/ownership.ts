/**
 * One writer per local match (#654, plan O3-04): which tab or window may commit to a match kept on
 * the device (`./storage.ts`), and how another one takes it over when the holder is gone.
 *
 * Two layers, so that a browser without one of them is still safe:
 *
 *  1. **The lease** — the authority. One record per match in the `owners` store of the local
 *     database: the holding tab's id, a fencing `epoch` that every grant raises, a heartbeat and
 *     whether it was released. A grant is one IndexedDB transaction (they are serialised by
 *     IndexedDB), and every commit of the match reads the lease in its own transaction and is
 *     refused (`fenced`, wire code `busy-elsewhere`) unless it carries the current epoch. A tab that
 *     was suspended, frozen or simply slow therefore cannot append to the history of the tab that
 *     took over, whatever its timers believe.
 *  2. **The Web Lock** — the coordination aid. Where `navigator.locks` exists an exclusive lock
 *     named `dbs-arena-local:match:<id>` is held for as long as the tab owns the match. The browser
 *     releases it when the tab closes or crashes, so a waiting tab is granted it at once and takes
 *     the lease over without waiting for the heartbeat to age (a lock-holder's claim is `force`d).
 *     A frozen tab keeps its lock, so another tab stays read-only rather than racing it; `takeOver`
 *     (an explicit "play here instead") steals the lock and the lease, and fences the old holder.
 *
 * **Fallback** (no `navigator.locks`): the lease alone. A claim is granted when the match is
 * free, released, or its holder's heartbeat is older than `ttlMs`; a waiting tab polls every
 * `heartbeatMs` and on a `released` broadcast. Its safety does not depend on clocks — only its
 * liveness does: a premature takeover fences the old holder, it never splits the history.
 *
 * A `BroadcastChannel` (`dbs-arena-local`) carries hints only — "committed", "released" — so a
 * watching tab refreshes or retries promptly. Nothing is decided by a broadcast.
 *
 * Browser-safe: no `node:`, no database, no network; an entry of `scripts/verify/arena-browser-boundary.mts`.
 */
import {
  OWNERS, STORAGE_SCHEMA, StorageError, openLocalDatabase, readLeaseRecord, storageErrorOf,
  type IndexedDbStoreOptions, type LeaseRecord, type WriterFence,
} from "./storage";

export type { LeaseRecord, WriterFence } from "./storage";

/** A lease whose heartbeat is older than this may be taken over (fallback mode). */
export const LEASE_TTL_MS = 8000;
/** How often the holder renews its lease, and a waiting tab (fallback) retries its claim. */
export const HEARTBEAT_MS = 2000;
export const LOCK_PREFIX = "dbs-arena-local:match:";
export const BROADCAST_NAME = "dbs-arena-local";

export type LeaseStoreOptions = Pick<IndexedDbStoreOptions, "name" | "factory" | "migrations">;

export type Claim = { ok: true; fence: WriterFence; lease: LeaseRecord } | { ok: false; held: LeaseRecord };

/** One readwrite (or readonly) transaction on the owners store; the connection is closed after it. */
async function onLease<T>(options: LeaseStoreOptions, matchId: string, mode: IDBTransactionMode, doing: string, fn: (current: LeaseRecord | null, put: (r: LeaseRecord) => void) => T): Promise<T> {
  const db = await openLocalDatabase(options);
  try {
    if (!db.objectStoreNames.contains(OWNERS)) throw new StorageError("upgrade", `${doing}: this database has no owners store`);
    return await new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction([OWNERS], mode); } catch (e) { return reject(storageErrorOf(e, doing)); }
      let failure: StorageError | null = null;
      let out: T;
      const store = tx.objectStore(OWNERS);
      const read = store.get(matchId);
      read.onsuccess = () => {
        try {
          out = fn(readLeaseRecord(matchId, read.result), (r) => { store.put(r); });
        } catch (e) {
          failure = storageErrorOf(e, doing);
          try { tx.abort(); } catch { /* finished */ }
        }
      };
      tx.oncomplete = () => (failure ? reject(failure) : resolve(out));
      tx.onabort = () => reject(failure ?? storageErrorOf(tx.error, doing));
    });
  } finally {
    db.close();
  }
}

/**
 * Claim the writer lease of `matchId` for `holder`. Granted (with a new, higher epoch) when the
 * match has no lease, its lease is released, already `holder`'s, older than `ttlMs`, or `force`
 * (the caller holds the Web Lock, or the player chose to take over). Otherwise `held`, with the lease.
 */
export function claimLease(matchId: string, holder: string, o: { now: number; ttlMs?: number; force?: boolean }, options: LeaseStoreOptions = {}): Promise<Claim> {
  const ttl = o.ttlMs ?? LEASE_TTL_MS;
  return onLease<Claim>(options, matchId, "readwrite", `claiming match ${matchId}`, (current, put) => {
    const free = !current || current.released || current.holder === holder || o.force || o.now - current.heartbeatAt > ttl;
    if (!free) return { ok: false, held: current! };
    const lease: LeaseRecord = { schema: STORAGE_SCHEMA, matchId, holder, epoch: (current?.epoch ?? 0) + 1, heartbeatAt: o.now, released: false };
    put(lease);
    return { ok: true, fence: { holder, epoch: lease.epoch }, lease };
  });
}

/** Renew a held lease's heartbeat: "lost" when the lease is no longer exactly `fence` (taken over, or released). */
export function renewLease(matchId: string, fence: WriterFence, now: number, options: LeaseStoreOptions = {}): Promise<"renewed" | "lost"> {
  return onLease(options, matchId, "readwrite", `renewing match ${matchId}`, (current, put) => {
    if (!current || current.released || current.holder !== fence.holder || current.epoch !== fence.epoch) return "lost" as const;
    put({ ...current, heartbeatAt: Math.max(now, current.heartbeatAt) });
    return "renewed" as const;
  });
}

/** Let go of a held lease (the epoch stays, so the next grant still raises it). A lease that is no longer `fence` is left alone. */
export function releaseLease(matchId: string, fence: WriterFence, options: LeaseStoreOptions = {}): Promise<boolean> {
  return onLease(options, matchId, "readwrite", `releasing match ${matchId}`, (current, put) => {
    if (!current || current.released || current.holder !== fence.holder || current.epoch !== fence.epoch) return false;
    put({ ...current, released: true });
    return true;
  });
}

export function readLease(matchId: string, options: LeaseStoreOptions = {}): Promise<LeaseRecord | null> {
  return onLease(options, matchId, "readonly", `reading the writer of match ${matchId}`, (current) => current);
}

// ── Coordination ─────────────────────────────────────────────────────────────────────────────────

/** The part of `navigator.locks` used here. */
export interface LockManagerLike {
  request(name: string, options: { mode?: "exclusive"; ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal }, callback: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>;
}

/** The part of `BroadcastChannel` used here. */
export interface BroadcastLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export interface OwnershipHint { type: "committed" | "released" | "claimed"; matchId: string; holder: string; revision?: number }

export interface OwnershipOptions extends LeaseStoreOptions {
  /** This tab's id (default: a fresh UUID per page load). */
  holder?: string;
  /** `undefined`: `navigator.locks` when the browser has it; `null`: the lease-only fallback. */
  locks?: LockManagerLike | null;
  /** `undefined`: a `BroadcastChannel` when the browser has one; `null`: none. */
  broadcast?: (() => BroadcastLike) | null;
  now?: () => number;
  ttlMs?: number;
  heartbeatMs?: number;
}

export type OwnershipMode = "web-locks" | "lease";

const browserLocks = (): LockManagerLike | null => (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks ?? null;
const browserBroadcast = (): (() => BroadcastLike) | null => {
  const C = (globalThis as { BroadcastChannel?: new (name: string) => BroadcastLike }).BroadcastChannel;
  return C ? () => new C(BROADCAST_NAME) : null;
};
const newHolder = () => `tab-${globalThis.crypto.randomUUID()}`;
const abortError = () => Object.assign(new Error("the wait for the match was stopped"), { name: "AbortError" });

/** The resolved coordination settings, shared by everything a tab does for one match. */
export interface OwnershipContext {
  matchId: string;
  holder: string;
  mode: OwnershipMode;
  locks: LockManagerLike | null;
  broadcast: (() => BroadcastLike) | null;
  now: () => number;
  ttlMs: number;
  heartbeatMs: number;
  store: LeaseStoreOptions;
}

export function ownershipContext(matchId: string, o: OwnershipOptions = {}): OwnershipContext {
  const locks = o.locks === undefined ? browserLocks() : o.locks;
  return {
    matchId,
    holder: o.holder ?? newHolder(),
    mode: locks ? "web-locks" : "lease",
    locks,
    broadcast: o.broadcast === undefined ? browserBroadcast() : o.broadcast,
    now: o.now ?? (() => Date.now()),
    ttlMs: o.ttlMs ?? LEASE_TTL_MS,
    heartbeatMs: o.heartbeatMs ?? HEARTBEAT_MS,
    store: { name: o.name, factory: o.factory, migrations: o.migrations },
  };
}

/** What a tab learns when it cannot have the match. */
export interface Refused { ok: false; held: LeaseRecord | null; via: "web-lock" | "lease" }

/**
 * A held match: the Web Lock (if any), the lease and its heartbeat. `onLost` fires once when the
 * lease is found taken over, released elsewhere, or the lock is stolen; the holder then writes
 * nothing more (its worker's commits would be fenced anyway).
 */
export class MatchOwnership {
  fence: WriterFence;
  private lost: string | null = null;
  private released = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private renewing = false;
  private readonly lostListeners = new Set<(reason: string) => void>();
  private channel: BroadcastLike | null = null;

  private constructor(readonly ctx: OwnershipContext, fence: WriterFence, private readonly letGoOfLock: (() => void) | null, lockLost: Promise<unknown> | null) {
    this.fence = fence;
    this.timer = setInterval(() => { void this.heartbeat(); }, ctx.heartbeatMs);
    lockLost?.then(() => this.markLost("another tab took the match over (its lock was taken)"), () => {});
    this.channel = ctx.broadcast ? ctx.broadcast() : null;
    this.hint({ type: "claimed" });
  }

  get mode(): OwnershipMode { return this.ctx.mode; }
  get matchId(): string { return this.ctx.matchId; }
  get isLost(): string | null { return this.lost; }
  get active(): boolean { return !this.released && !this.lost; }

  /** Take the match now if nobody else holds it; otherwise say who does. */
  static async tryAcquire(ctx: OwnershipContext): Promise<{ ok: true; ownership: MatchOwnership } | Refused> {
    if (ctx.locks) {
      const lock = await holdLock(ctx, { ifAvailable: true });
      if (!lock) return { ok: false, held: await readLease(ctx.matchId, ctx.store).catch(() => null), via: "web-lock" };
      return MatchOwnership.claimUnder(ctx, lock, true);
    }
    const claim = await claimLease(ctx.matchId, ctx.holder, { now: ctx.now(), ttlMs: ctx.ttlMs }, ctx.store);
    if (!claim.ok) return { ok: false, held: claim.held, via: "lease" };
    return { ok: true, ownership: new MatchOwnership(ctx, claim.fence, null, null) };
  }

  /**
   * Wait until the match can be had — the holder closed, crashed, released it or (fallback) stopped
   * renewing — then take it. Rejects with an `AbortError` when `signal` aborts; nothing is left held.
   */
  static async waitToAcquire(ctx: OwnershipContext, signal: AbortSignal): Promise<MatchOwnership> {
    if (signal.aborted) throw abortError();
    if (ctx.locks) {
      const lock = await holdLock(ctx, { signal });
      if (!lock) throw abortError();
      if (signal.aborted) { lock.letGo(); throw abortError(); }
      const got = await MatchOwnership.claimUnder(ctx, lock, true);
      if (got.ok) return got.ownership;
      throw new StorageError("aborted", "the lease could not be claimed under the lock");
    }
    const channel = ctx.broadcast ? ctx.broadcast() : null;
    let wake: () => void = () => {};
    channel?.addEventListener("message", (e) => {
      const h = e.data as OwnershipHint | null;
      if (h && h.matchId === ctx.matchId && h.type === "released") wake();
    });
    try {
      for (;;) {
        if (signal.aborted) throw abortError();
        const claim = await claimLease(ctx.matchId, ctx.holder, { now: ctx.now(), ttlMs: ctx.ttlMs }, ctx.store);
        if (claim.ok) {
          if (signal.aborted) { await releaseLease(ctx.matchId, claim.fence, ctx.store).catch(() => {}); throw abortError(); }
          return new MatchOwnership(ctx, claim.fence, null, null);
        }
        // Retry at the next heartbeat, or at once when the holder says it let go.
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(t); signal.removeEventListener("abort", done); wake = () => {}; resolve(); };
          const t = setTimeout(done, ctx.heartbeatMs);
          signal.addEventListener("abort", done);
          wake = done;
        });
      }
    } finally {
      channel?.close();
    }
  }

  /** The player chose to play here: steal the lock (if any) and the lease. The old holder is fenced from its next commit on. */
  static async takeOver(ctx: OwnershipContext): Promise<MatchOwnership> {
    if (ctx.locks) {
      const lock = await holdLock(ctx, { steal: true });
      if (!lock) throw new StorageError("aborted", "the lock could not be taken");
      const got = await MatchOwnership.claimUnder(ctx, lock, true);
      if (got.ok) return got.ownership;
      throw new StorageError("aborted", "the lease could not be claimed");
    }
    const claim = await claimLease(ctx.matchId, ctx.holder, { now: ctx.now(), ttlMs: ctx.ttlMs, force: true }, ctx.store);
    if (!claim.ok) throw new StorageError("aborted", "the lease could not be claimed");
    return new MatchOwnership(ctx, claim.fence, null, null);
  }

  private static async claimUnder(ctx: OwnershipContext, lock: HeldLock, force: boolean): Promise<{ ok: true; ownership: MatchOwnership }> {
    try {
      const claim = await claimLease(ctx.matchId, ctx.holder, { now: ctx.now(), ttlMs: ctx.ttlMs, force }, ctx.store);
      if (!claim.ok) throw new StorageError("aborted", "the lease was refused under the lock");
      return { ok: true, ownership: new MatchOwnership(ctx, claim.fence, lock.letGo, lock.lost) };
    } catch (e) {
      lock.letGo();
      throw e;
    }
  }

  /**
   * A new epoch for the same tab (a restarted worker): whatever the previous worker might still try
   * to commit is fenced. "lost" when another tab took the match over meanwhile.
   */
  async reclaim(): Promise<WriterFence | null> {
    if (!this.active) return null;
    const lease = await readLease(this.ctx.matchId, this.ctx.store);
    if (!lease || lease.released || lease.holder !== this.fence.holder || lease.epoch !== this.fence.epoch) {
      this.markLost(`the match was taken over (epoch ${lease?.epoch ?? "none"}) before this tab restarted its worker`);
      return null;
    }
    const claim = await claimLease(this.ctx.matchId, this.ctx.holder, { now: this.ctx.now(), ttlMs: this.ctx.ttlMs }, this.ctx.store);
    if (!claim.ok) { this.markLost("the match was taken over while this tab restarted its worker"); return null; }
    this.fence = claim.fence;
    return this.fence;
  }

  /** Renew now (the timer does it every `heartbeatMs`). */
  async heartbeat(): Promise<void> {
    if (!this.active || this.renewing) return;
    this.renewing = true;
    try {
      const r = await renewLease(this.ctx.matchId, this.fence, this.ctx.now(), this.ctx.store);
      if (r === "lost") this.markLost("another tab took the match over");
    } catch {
      // A failed renewal is retried at the next beat; commits are fenced in their own transaction regardless.
    } finally {
      this.renewing = false;
    }
  }

  onLost(listener: (reason: string) => void): () => void {
    this.lostListeners.add(listener);
    if (this.lost) listener(this.lost);
    return () => { this.lostListeners.delete(listener); };
  }

  /** A hint to other tabs (never a decision). */
  hint(h: Omit<OwnershipHint, "matchId" | "holder">): void {
    try { this.channel?.postMessage({ ...h, matchId: this.ctx.matchId, holder: this.ctx.holder }); } catch { /* closed */ }
  }

  private markLost(reason: string): void {
    if (this.lost || this.released) return;
    this.lost = reason;
    this.stopTimer();
    this.letGoOfLock?.();
    for (const l of this.lostListeners) l(reason);
  }

  private stopTimer(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  /** Let go: the lease is released (if still ours), the lock and the timer and channel let go of. Safe to call twice. */
  async release(): Promise<void> {
    if (this.released) return;
    const wasActive = !this.lost;
    this.released = true;
    this.stopTimer();
    try {
      if (wasActive) await releaseLease(this.ctx.matchId, this.fence, this.ctx.store).catch(() => false);
    } finally {
      this.letGoOfLock?.();
      if (wasActive) this.hint({ type: "released" });
      this.channel?.close();
      this.channel = null;
      this.lostListeners.clear();
    }
  }

  /**
   * TEST-ONLY: what a tab that closed or crashed leaves behind — the browser lets go of its lock,
   * its timers stop, and its lease is neither renewed nor released. Never called by the app.
   */
  vanish(): void {
    this.released = true;
    this.stopTimer();
    this.letGoOfLock?.();
    this.channel?.close();
    this.channel = null;
    this.lostListeners.clear();
  }

  /** TEST-ONLY: a frozen tab: its heartbeat stops (it keeps whatever it holds). `thaw` restarts it. */
  freeze(): void { this.stopTimer(); }
  thaw(): void {
    if (!this.active || this.timer !== null) return;
    this.timer = setInterval(() => { void this.heartbeat(); }, this.ctx.heartbeatMs);
  }

  /** What is still held, for a dispose check. */
  resources(): { timer: boolean; lock: boolean; channel: boolean } {
    return { timer: this.timer !== null, lock: !!this.letGoOfLock && !this.released && !this.lost, channel: this.channel !== null };
  }
}

interface HeldLock {
  /** Release the lock (idempotent). */
  letGo: () => void;
  /** Settles when the lock ends for any reason other than `letGo` (stolen). */
  lost: Promise<unknown>;
}

/**
 * Hold the match's Web Lock until `letGo`. Resolves null when `ifAvailable` and it is held
 * elsewhere, or when the request was aborted.
 */
function holdLock(ctx: OwnershipContext, o: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal }): Promise<HeldLock | null> {
  const locks = ctx.locks!;
  return new Promise<HeldLock | null>((resolve) => {
    let letGo: () => void = () => {};
    let settled = false;
    const held = new Promise<void>((r) => { letGo = r; });
    let wanted = true;
    // Settles when the request ends while the lock is still wanted: it was stolen (or the holder's context went away).
    let ended: (why: string) => void = () => {};
    const lost = new Promise<string>((r) => { ended = r; });
    const request = locks.request(LOCK_PREFIX + ctx.matchId, { mode: "exclusive", ...o }, async (lock) => {
      settled = true;
      if (!lock) { resolve(null); return; }
      resolve({ letGo: () => { wanted = false; letGo(); }, lost });
      await held;
    });
    request.then(
      () => { if (wanted && settled) ended("ended"); },
      () => {
        if (!settled) { settled = true; resolve(null); return; }
        if (wanted) ended("stolen");
      },
    );
  });
}
