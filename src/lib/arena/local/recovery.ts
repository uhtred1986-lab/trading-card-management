/**
 * Recovering interrupted workers, and one writer per local match, on the page side (#654, plan
 * O3-04). `LocalMatchSupervisor` is what a page holds for a local match: it owns the match's writer
 * lease (`./ownership.ts`), the dedicated Worker (`./worker-entry.ts`) and the page client on it
 * (`src/components/arena/session/local.ts`), and it is itself an `ArenaSession`, so the board
 * (O3-05) can take it as it takes the online session.
 *
 * **One writer.** Opening a match first takes its lease. A tab that cannot (another tab or window
 * holds it) is *watching*: it shows the saved match through a read-only worker session (every move
 * refused as `busy-elsewhere`), refreshes it when the holder broadcasts a commit, and takes the match
 * over when the holder lets go — closes, crashes, releases it, or (without Web Locks) stops renewing
 * it. `takeOver()` is the explicit "play here instead". Every commit the worker makes carries the
 * lease's fence and is refused in its own IndexedDB transaction when the lease has moved on, so a
 * suspended or superseded tab can never write into the new owner's history: it learns it from the
 * refusal or its heartbeat and becomes a watcher.
 *
 * **Recovery.** A worker is declared dead when it fails (`error`), or stays silent for `hungMs` while
 * a request waits on it (`openMs` for an open, which replays the whole journal), or does not answer
 * an idle ping. The supervisor then terminates it, claims a new epoch for the same tab (so the old
 * worker, were it still running, is fenced), starts a new worker and resumes the match from the
 * device — at its last commit, never further. What was in flight is sent again:
 *  - a human move with **its own request id**: if it was committed before the worker died, the
 *    journalled receipt answers it as a duplicate and nothing is played twice; if not, it is played
 *    now, once;
 *  - an AI `advance` as a **new** advance from the resumed revision: the batch that was being
 *    computed is simply computed again, from the AI memory and RNG journalled with the last commit,
 *    so it gives the same decisions.
 * After `maxRestarts` deaths with no answer in between it stops as `failed` instead of looping.
 *
 * **Visible, cancellable, recoverable.** `state` (and `onState`) names what is happening —
 * `opening`, `owner`, `watching` (with the holder), `recovering` (with the reason and attempt),
 * `storage` (the device refused a write or an open), `failed`, `stopped`, `closed` — and `watch`
 * reports it to the board as a connection (`connected`, `reconnecting`, `paused`, `offline`).
 * `stop()` cancels a recovery or a wait for the match; `retry()` starts again. `dispose()` lets go
 * of everything: the session, the worker (terminated), the lease (released), the lock, timers and
 * channels; `resources()` shows what is still held.
 *
 * Browser-safe and engine-free: it imports the protocol and the ownership module, and only types
 * from the page client, which the caller passes in as `sessions` (`LocalWorkerSession`).
 */
import type { Snapshot } from "../snapshot-core";
import type { Action } from "../types";
import type { ArenaSession, SessionCapabilities, SessionConnection, SessionResult, WatchHandle, WatchOptions } from "@/components/arena/session/contract";
import type { LocalNewMatch, LocalSessionOptions, LocalStartInput, LocalViewInput, WorkerPort } from "@/components/arena/session/local";
import { ERROR_SENTENCE, type ErrorMessage, type LocalErrorCode, type ResultMessage, type SessionStatus } from "./protocol";
import { MatchOwnership, ownershipContext, type BroadcastLike, type LeaseRecord, type OwnershipContext, type OwnershipHint, type OwnershipMode, type OwnershipOptions, type WriterFence } from "./ownership";

export type Answer = ResultMessage | ErrorMessage;

/** What the supervisor needs of a page client (`LocalWorkerSession` is one). */
export interface SupervisedSession {
  readonly snapshot: Snapshot | null;
  readonly revision: number;
  status: SessionStatus;
  interruption: string | null;
  actRaw(action: Action, basedOn: number, requestId: string): Promise<Answer>;
  advanceRaw(maxDecisions?: number): Promise<Answer>;
  cancel(): Promise<boolean>;
  read(): Promise<Answer>;
  watch(options: WatchOptions): WatchHandle;
  detach(detail: string, code?: LocalErrorCode): void;
  dispose(): Promise<void>;
}

export interface SessionFactory {
  start(port: WorkerPort, input: LocalNewMatch, options: LocalSessionOptions): Promise<SupervisedSession>;
  resume(port: WorkerPort, input: LocalViewInput, options: LocalSessionOptions): Promise<SupervisedSession>;
}

/** A started worker: its port, and how to kill it. */
export type SpawnedWorker = WorkerPort & { terminate(): void };

export type SupervisorStateKind = "opening" | "owner" | "watching" | "recovering" | "storage" | "failed" | "stopped" | "closed";

export interface SupervisorState {
  kind: SupervisorStateKind;
  /** The protocol code behind a refusal state (`busy-elsewhere`, `storage`, ...). */
  code: LocalErrorCode | null;
  /** A sentence: why (the holder, the worker's death, the device's refusal). */
  detail: string | null;
  /** Worker restarts since the last answer, and in all. */
  restarts: number;
  totalRestarts: number;
  /** How ownership is coordinated here. */
  mode: OwnershipMode;
  /** The lease this tab writes under, while it does. */
  fence: WriterFence | null;
  /** Watching: the tab holding the match, as its lease names it. */
  holder: string | null;
  /** Watching: whether this tab held the match and lost it, or never had it. */
  watching: "held-elsewhere" | "taken-over" | null;
}

export interface SupervisorOptions {
  spawn(): SpawnedWorker;
  sessions: SessionFactory;
  ownership?: OwnershipOptions;
  /** Silence (ms) while a request waits that declares the worker hung. Default 15 s. */
  hungMs?: number;
  /** The same for an open (start or resume replays the journal). Default 120 s. */
  openMs?: number;
  /** An idle worker is pinged this often (ms); 0 never. Default 5 s. */
  pingMs?: number;
  /** Worker deaths in a row (no answer between them) before giving up as `failed`. Default 3. */
  maxRestarts?: number;
  newRequestId?: () => string;
  /** While another tab holds the match, show the saved match read-only. Default true. */
  view?: boolean;
  /** While another tab holds the match, take it when that tab lets go. Default true. */
  takeover?: boolean;
  onState?: (state: SupervisorState) => void;
}

export type SupervisorInput = { start: LocalNewMatch } | { resume: LocalStartInput };

const CAPABILITIES: SessionCapabilities = { advance: true, abandon: false, rematch: false, flag: false, plan: false, skin: false, staging: false, report: false };
const CONNECTION: Record<SupervisorStateKind, SessionConnection> = {
  opening: "reconnecting", owner: "connected", watching: "paused", recovering: "reconnecting", storage: "offline", failed: "offline", stopped: "paused", closed: "offline",
};
const uuid = () => globalThis.crypto.randomUUID();
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const codeOf = (e: unknown): LocalErrorCode => ((e as { code?: LocalErrorCode } | null)?.code ?? "internal");

interface Live { port: SpawnedWorker; generation: number; lastHeard: number; dead: string | null }
type Guarded<T> = { value: T } | { dead: string } | { thrown: unknown };

export class LocalMatchSupervisor implements ArenaSession {
  readonly capabilities = CAPABILITIES;
  readonly gameId: number;
  readonly matchId: string;
  private readonly ctx: OwnershipContext;
  private readonly hungMs: number;
  private readonly openMs: number;
  private readonly pingMs: number;
  private readonly maxRestarts: number;
  private readonly newRequestId: () => string;
  private stateValue: SupervisorState;
  private ownership: MatchOwnership | null = null;
  private worker: Live | null = null;
  private session: SupervisedSession | null = null;
  private generation = 0;
  private current: Snapshot | null = null;
  private readonly watchers = new Set<WatchOptions>();
  private readonly stateListeners = new Set<(s: SupervisorState) => void>();
  private takeoverAbort: AbortController | null = null;
  private hints: BroadcastLike | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private pinging = false;
  private recovering: Promise<boolean> | null = null;
  private refreshing: Promise<void> | null = null;
  private refreshAgain = false;
  private losing = false;
  private closed = false;
  private stopped = false;
  /** A start was sent once: every later open resumes (the start may have been committed). */
  private startSent = false;
  private readonly guards = new Set<ReturnType<typeof setInterval>>();

  private constructor(private readonly input: SupervisorInput, private readonly options: SupervisorOptions) {
    const match = "start" in input ? input.start : input.resume;
    this.gameId = match.gameId;
    this.matchId = match.matchId;
    this.ctx = ownershipContext(match.matchId, options.ownership);
    this.hungMs = options.hungMs ?? 15000;
    this.openMs = options.openMs ?? 120000;
    this.pingMs = options.pingMs ?? 5000;
    this.maxRestarts = options.maxRestarts ?? 3;
    this.newRequestId = options.newRequestId ?? uuid;
    this.stateValue = { kind: "opening", code: null, detail: null, restarts: 0, totalRestarts: 0, mode: this.ctx.mode, fence: null, holder: null, watching: null };
  }

  /** Open a local match: as its writer when this tab can have it, otherwise watching it. Never throws; the outcome is `state`. */
  static async open(input: SupervisorInput, options: SupervisorOptions): Promise<LocalMatchSupervisor> {
    const s = new LocalMatchSupervisor(input, options);
    if (options.onState) s.stateListeners.add(options.onState);
    await s.begin();
    return s;
  }

  get state(): SupervisorState { return { ...this.stateValue }; }
  get snapshot(): Snapshot | null { return this.current; }
  get holder(): string { return this.ctx.holder; }
  /** The session the worker serves now (proofs and diagnostics). */
  get live(): SupervisedSession | null { return this.session; }

  onState(listener: (s: SupervisorState) => void): () => void {
    this.stateListeners.add(listener);
    return () => { this.stateListeners.delete(listener); };
  }

  private setState(kind: SupervisorStateKind, patch: Partial<SupervisorState> = {}): void {
    const before = this.stateValue;
    this.stateValue = { ...before, code: null, detail: null, holder: null, watching: null, ...patch, kind, fence: this.ownership?.active ? this.ownership.fence : null };
    const s = this.state;
    for (const l of this.stateListeners) l(s);
    if (CONNECTION[before.kind] !== CONNECTION[kind]) for (const w of this.watchers) w.onConnection(CONNECTION[kind]);
  }

  // ── Opening and ownership ──────────────────────────────────────────────────────────────────────

  private async begin(): Promise<void> {
    this.setState("opening");
    let got: Awaited<ReturnType<typeof MatchOwnership.tryAcquire>>;
    try {
      got = await MatchOwnership.tryAcquire(this.ctx);
    } catch (e) {
      return this.setState("storage", { code: "storage", detail: `the device refused the match's writer lease: ${describe(e)}` });
    }
    if (this.closed) { if (got.ok) await got.ownership.release(); return; }
    if (got.ok) await this.becomeOwner(got.ownership);
    else await this.watchElsewhere(got.held, "held-elsewhere", null);
  }

  private async becomeOwner(ownership: MatchOwnership): Promise<void> {
    if (this.closed) { await ownership.release(); return; }
    this.stopWaiting();
    this.ownership = ownership;
    // Leaving "watching" ends any view refresh; wait for one in flight, then let its worker go.
    this.setState("opening");
    if (this.refreshing) await this.refreshing;
    await this.dropWorker("this tab now plays the match");
    if (this.closed) return;
    ownership.onLost((reason) => { void this.lose(reason); });
    const r = await this.launch(ownership.fence);
    if (this.closed) return;
    if ("dead" in r) { await this.recover(null, r.dead); return; }
    if ("refused" in r) return this.refusedOpen(r.refused);
    this.restartsReset();
    this.setState("owner");
    this.startPing();
  }

  private refusedOpen(refused: { code: LocalErrorCode; message: string }): void {
    if (refused.code === "busy-elsewhere") { void this.lose(refused.message); return; }
    if (refused.code === "storage" || refused.code === "newer") return this.setState("storage", { code: refused.code, detail: refused.message });
    this.setState("failed", { code: refused.code, detail: refused.message });
  }

  /** This tab is not (or no longer) the match's writer: show it read-only and wait for it. */
  private async watchElsewhere(held: LeaseRecord | null, why: "held-elsewhere" | "taken-over", detail: string | null): Promise<void> {
    if (this.closed) return;
    const patch = { code: "busy-elsewhere" as const, detail, holder: held?.holder ?? null, watching: why };
    this.setState("watching", patch);
    if (this.ctx.broadcast && !this.hints) {
      this.hints = this.ctx.broadcast();
      this.hints.addEventListener("message", (e) => {
        const h = e.data as OwnershipHint | null;
        if (!h || h.matchId !== this.matchId || h.holder === this.ctx.holder) return;
        if (h.type === "committed" && this.stateValue.kind === "watching") void this.refreshView();
      });
    }
    if (this.options.view !== false) await this.refreshView();
    if (this.options.takeover !== false && !this.stopped) this.waitForMatch();
  }

  private waitForMatch(): void {
    if (this.takeoverAbort || this.closed) return;
    const abort = new AbortController();
    this.takeoverAbort = abort;
    MatchOwnership.waitToAcquire(this.ctx, abort.signal).then(
      async (own) => {
        if (this.takeoverAbort === abort) this.takeoverAbort = null;
        if (abort.signal.aborted || this.closed) { await own.release(); return; }
        await this.becomeOwner(own);
      },
      (e: unknown) => {
        if (this.takeoverAbort === abort) this.takeoverAbort = null;
        if ((e as { name?: string }).name === "AbortError" || this.closed) return;
        this.setState("storage", { code: "storage", detail: `waiting for the match failed: ${describe(e)}` });
      },
    );
  }

  private stopWaiting(): void {
    this.takeoverAbort?.abort();
    this.takeoverAbort = null;
    this.hints?.close();
    this.hints = null;
  }

  /** "Play here instead": take the match from the tab that holds it. That tab is fenced from its next commit on. */
  async takeOver(): Promise<SupervisorState> {
    if (this.closed || this.stateValue.kind === "owner") return this.state;
    // Still this tab's (a failed, stopped or storage state): nothing to take, only to restart.
    if (this.ownership?.active) return this.retry();
    this.stopWaiting();
    this.stopped = false;
    try {
      const own = await MatchOwnership.takeOver(this.ctx);
      await this.becomeOwner(own);
    } catch (e) {
      this.setState("storage", { code: "storage", detail: `taking the match over failed: ${describe(e)}` });
    }
    return this.state;
  }

  /** The lease moved on (a refusal, the heartbeat, or a stolen lock): stop writing, and watch. */
  private async lose(reason: string): Promise<void> {
    if (this.closed || this.losing || this.stateValue.kind === "watching") return;
    this.losing = true;
    try {
      await this.loseNow(reason);
    } finally {
      this.losing = false;
    }
  }

  private async loseNow(reason: string): Promise<void> {
    const own = this.ownership;
    this.ownership = null;
    this.stopPing();
    await this.dropWorker(`this tab no longer holds the match: ${reason}`);
    await own?.release();
    await this.watchElsewhere(null, "taken-over", reason);
  }

  // ── Workers ────────────────────────────────────────────────────────────────────────────────────

  /** Start a worker and open the match on it: as the writer under `fence`, or read-only (`fence` null). */
  private async launch(fence: WriterFence | null): Promise<{ ok: true } | { dead: string } | { refused: { code: LocalErrorCode; message: string } }> {
    const generation = ++this.generation;
    let port: SpawnedWorker;
    try { port = this.options.spawn(); } catch (e) { return { refused: { code: "internal", message: `the local game engine could not be started: ${describe(e)}` } }; }
    const live: Live = { port, generation, lastHeard: Date.now(), dead: null };
    port.addEventListener("message", () => { live.lastHeard = Date.now(); });
    port.addEventListener("error", (e) => { live.dead ??= `the worker failed: ${e.message ?? "error"}`; });
    this.worker = live;
    const options: LocalSessionOptions = { newRequestId: this.newRequestId, sessionId: `${this.ctx.holder}.${generation}`.slice(0, 128), awaitReady: true };
    const match = "start" in this.input ? this.input.start : this.input.resume;
    const resumeInput: LocalStartInput = { matchId: match.matchId, gameId: match.gameId, pack: match.pack, interpreterRevision: match.interpreterRevision, policyVersion: match.policyVersion, batch: match.batch };
    if (resumeInput.policyVersion === undefined) delete resumeInput.policyVersion;
    if (resumeInput.batch === undefined) delete resumeInput.batch;
    const open = async (): Promise<SupervisedSession> => {
      if (!fence) return this.options.sessions.resume(port, { ...resumeInput, readOnly: true }, options);
      if ("start" in this.input && !this.startSent) {
        this.startSent = true;
        return this.options.sessions.start(port, { ...this.input.start, writer: fence }, options);
      }
      return this.options.sessions.resume(port, { ...resumeInput, writer: fence }, options);
    };
    const r = await this.guard(open(), live, this.openMs);
    if ("dead" in r) { this.kill(live, r.dead); return { dead: r.dead }; }
    if ("thrown" in r) {
      this.kill(live, "its open was refused");
      return { refused: { code: codeOf(r.thrown), message: describe(r.thrown) } };
    }
    if (this.closed || this.worker !== live) { void r.value.dispose(); this.kill(live, "replaced"); return { dead: "replaced" }; }
    this.session = r.value;
    r.value.watch({ revision: 0, beat: 0, onSnapshot: (s) => this.offer(s), onConnection: () => {} });
    return { ok: true };
  }

  /** Race a worker call against its death: an `error`, a kill, or `ms` of silence. */
  private guard<T>(promise: Promise<T>, live: Live, ms: number): Promise<Guarded<T>> {
    const started = Date.now();
    return new Promise((resolve) => {
      let done = false;
      const tick = Math.max(10, Math.min(250, Math.floor(ms / 5)));
      const finish = (v: Guarded<T>) => { if (done) return; done = true; clearInterval(timer); this.guards.delete(timer); resolve(v); };
      const timer = setInterval(() => {
        if (live.dead) finish({ dead: live.dead });
        else if (Date.now() - Math.max(live.lastHeard, started) > ms) { live.dead = `the worker did not answer for ${ms} ms`; finish({ dead: live.dead }); }
      }, tick);
      this.guards.add(timer);
      promise.then((value) => finish(live.dead ? { dead: live.dead } : { value }), (thrown: unknown) => finish(live.dead ? { dead: live.dead } : { thrown }));
    });
  }

  private kill(live: Live, reason: string): void {
    live.dead ??= reason;
    try { live.port.terminate(); } catch { /* already gone */ }
    if (this.worker === live) {
      this.worker = null;
      this.session?.detach(`the worker was stopped: ${reason}`);
      this.session = null;
    }
  }

  private async dropWorker(reason: string): Promise<void> {
    const live = this.worker;
    const session = this.session;
    this.session = null;
    this.worker = null;
    if (session) {
      // A polite close first (the worker drops any batch in progress); a dead worker is not waited for.
      let t: ReturnType<typeof setTimeout> | null = null;
      await Promise.race([session.dispose(), new Promise<void>((r) => { t = setTimeout(r, 500); })]);
      if (t) clearTimeout(t);
      session.detach(reason);
    }
    if (live) this.kill(live, reason);
  }

  private restartsReset(): void {
    if (this.stateValue.restarts !== 0) this.stateValue = { ...this.stateValue, restarts: 0 };
  }

  /** Replace the dead worker `live` (null: the one being opened) and resume from the device. Shared by every caller that saw the death. */
  private recover(live: Live | null, reason: string): Promise<boolean> {
    if (live && this.worker !== live && this.worker !== null) return Promise.resolve(this.stateValue.kind === "owner");
    if (!this.recovering) this.recovering = this.doRecover(reason).finally(() => { this.recovering = null; });
    return this.recovering;
  }

  private async doRecover(first: string): Promise<boolean> {
    let reason = first;
    this.stopPing();
    if (this.worker) this.kill(this.worker, reason);
    for (;;) {
      if (this.closed) return false;
      if (this.stopped) { this.setState("stopped", { code: "cancelled", detail: `stopped while restarting the worker (${reason})` }); return false; }
      const restarts = this.stateValue.restarts + 1;
      this.stateValue = { ...this.stateValue, restarts, totalRestarts: this.stateValue.totalRestarts + 1 };
      if (restarts > this.maxRestarts) {
        this.setState("failed", { code: "internal", detail: `the local game engine stopped ${restarts - 1} time(s) in a row (${reason}); the match is safe at its last saved move`, restarts, totalRestarts: this.stateValue.totalRestarts });
        return false;
      }
      this.setState("recovering", { code: "internal", detail: reason, restarts, totalRestarts: this.stateValue.totalRestarts });
      const own = this.ownership;
      if (!own) return false;
      let fence: WriterFence | null;
      try {
        fence = await own.reclaim();
      } catch (e) {
        this.setState("storage", { code: "storage", detail: `the device refused the match's writer lease: ${describe(e)}` });
        return false;
      }
      if (this.closed) return false;
      if (!fence) { await this.lose(own.isLost ?? "the match was taken over"); return false; }
      if (this.stopped) continue;
      const r = await this.launch(fence);
      if (this.closed) return false;
      if ("dead" in r) { reason = r.dead; continue; }
      if ("refused" in r) { this.refusedOpen(r.refused); return false; }
      this.setState("owner", { restarts, totalRestarts: this.stateValue.totalRestarts });
      this.startPing();
      return true;
    }
  }

  private startPing(): void {
    if (this.pingMs > 0 && this.pingTimer === null) this.pingTimer = setInterval(() => { void this.ping(); }, this.pingMs);
  }

  private stopPing(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  /** An idle owner's check that its worker still answers. */
  private async ping(): Promise<void> {
    const live = this.worker;
    const session = this.session;
    if (this.pinging || this.recovering || this.stateValue.kind !== "owner" || !live || !session) return;
    this.pinging = true;
    try {
      const r = await this.guard(session.read(), live, this.hungMs);
      if ("dead" in r && !this.closed && this.worker === live) await this.recover(live, r.dead);
    } finally {
      this.pinging = false;
    }
  }

  // ── Requests ───────────────────────────────────────────────────────────────────────────────────

  private localError(code: LocalErrorCode, detail: string | null, requestId: string | null = null): ErrorMessage {
    return { type: "error", requestId, sessionId: null, ok: false, code, message: detail ? `${ERROR_SENTENCE[code]}: ${detail}` : ERROR_SENTENCE[code] };
  }

  private refusalForState(requestId: string | null): ErrorMessage {
    const s = this.stateValue;
    if (this.losing && !this.closed) return this.localError("busy-elsewhere", "another tab took the match over", requestId);
    switch (s.kind) {
      case "watching": return this.localError("busy-elsewhere", s.detail, requestId);
      case "closed": return this.localError("disposed", null, requestId);
      case "stopped": return this.localError("cancelled", s.detail, requestId);
      case "opening": return this.localError("busy", "the match is still opening", requestId);
      default: return this.localError(s.code ?? "internal", s.detail, requestId);
    }
  }

  /**
   * Send a mutation to the writer's worker; if the worker dies before answering, restart it, resume,
   * and send again (`send` decides what "again" is: the same request id for a move, a new advance).
   */
  private async mutate(send: (s: SupervisedSession) => Promise<Answer>, requestId: string | null): Promise<Answer> {
    for (;;) {
      if (this.closed) return this.localError("disposed", null, requestId);
      if (this.recovering) await this.recovering;
      const kind = this.stateValue.kind;
      const live = this.worker;
      const session = this.session;
      if ((kind !== "owner" && kind !== "storage") || !live || !session || !this.ownership) return this.refusalForState(requestId);
      const r = await this.guard(send(session), live, this.hungMs);
      if ("dead" in r) {
        if (this.closed) return this.localError("disposed", null, requestId);
        const ok = await this.recover(live, r.dead);
        if (!ok) return this.refusalForState(requestId);
        continue;
      }
      if ("thrown" in r) return this.localError("internal", describe(r.thrown), requestId);
      const answer = r.value;
      // The match was lost (or the supervisor closed) while the request waited: its session was let go, and the answer is the state's.
      if (!answer.ok && this.session !== session && (this.losing || this.closed || this.stateValue.kind !== "owner")) return this.refusalForState(requestId);
      if (answer.ok) {
        this.restartsReset();
        if (this.stateValue.kind === "storage") this.setState("owner");
      } else if (answer.code === "busy-elsewhere") {
        await this.lose(answer.message);
      } else if (answer.code === "storage") {
        this.setState("storage", { code: "storage", detail: answer.message });
      }
      return answer;
    }
  }

  actRaw(action: Action, basedOn: number, requestId: string): Promise<Answer> {
    return this.mutate((s) => s.actRaw(action, basedOn, requestId), requestId);
  }

  async act(action: Action, basedOn: number, requestId: string): Promise<SessionResult> {
    const a = await this.actRaw(action, basedOn, requestId);
    return { error: a.ok ? null : ERROR_SENTENCE[a.code] };
  }

  /** Let the AI play; a batch lost with its worker is computed again on the new one. */
  advanceRaw(maxDecisions?: number): Promise<Answer> {
    return this.mutate((s) => s.advanceRaw(maxDecisions), null);
  }

  async advance(): Promise<SessionResult> {
    const a = await this.advanceRaw();
    return { error: a.ok ? null : ERROR_SENTENCE[a.code] };
  }

  /** Stop a running advance at its next batch boundary. */
  async cancel(): Promise<boolean> {
    return this.session && this.stateValue.kind === "owner" ? this.session.cancel() : false;
  }

  /** Stop a recovery or a wait for the match; the match stays at its last saved move. `retry()` starts again. */
  async stop(): Promise<void> {
    if (this.closed) return;
    this.stopped = true;
    this.stopWaiting();
    if (this.stateValue.kind === "recovering" || this.stateValue.kind === "opening") {
      if (this.worker) this.kill(this.worker, "stopped by the player");
    }
    if (this.stateValue.kind === "watching") this.setState("stopped", { code: "cancelled", detail: "stopped waiting for the other tab" });
    if (this.recovering) await this.recovering;
  }

  /** Start again after `stopped`, `failed`, `storage` or `watching`: restart the worker, or try for the match again. */
  async retry(): Promise<SupervisorState> {
    if (this.closed) return this.state;
    this.stopped = false;
    this.stateValue = { ...this.stateValue, restarts: 0 };
    const kind = this.stateValue.kind;
    if (kind === "owner") return this.state;
    if (this.ownership?.active) {
      if (kind === "storage" && this.session) { this.setState("owner"); return this.state; }
      await this.recover(null, "restarted by the player");
      return this.state;
    }
    this.stopWaiting();
    await this.dropWorker("trying for the match again");
    await this.begin();
    return this.state;
  }

  // ── The board's side ───────────────────────────────────────────────────────────────────────────

  private offer(next: Snapshot): void {
    if (next.game.id !== this.gameId) return;
    const cur = this.current;
    let accepted: Snapshot | null = null;
    if (!cur || next.game.revision > cur.game.revision) accepted = next;
    else if (next.game.revision === cur.game.revision && (next.beats?.seq ?? 0) > (cur.beats?.seq ?? 0)) accepted = { ...cur, beats: next.beats };
    if (!accepted) return;
    this.current = accepted;
    for (const w of this.watchers) if (accepted.game.revision > w.revision || (accepted.beats?.seq ?? 0) > w.beat) w.onSnapshot(accepted);
    if (this.stateValue.kind === "owner" && (!cur || accepted.game.revision > cur.game.revision)) this.ownership?.hint({ type: "committed", revision: accepted.game.revision });
  }

  watch(options: WatchOptions): WatchHandle {
    this.watchers.add(options);
    options.onConnection(CONNECTION[this.stateValue.kind]);
    const c = this.current;
    if (c && (c.game.revision > options.revision || (c.beats?.seq ?? 0) > options.beat)) options.onSnapshot(c);
    return { retry: () => { void this.retry(); }, stop: () => { this.watchers.delete(options); } };
  }

  /** Read the authoritative copy again: the worker's board, or (watching) the device's. */
  refresh(): void {
    if (this.stateValue.kind === "watching") void this.refreshView();
    else void this.session?.read();
  }

  /** Watching: re-open the saved match read-only on a fresh worker, so the board follows the holder's commits. */
  private refreshView(): Promise<void> {
    if (this.refreshing) { this.refreshAgain = true; return this.refreshing; }
    this.refreshing = (async () => {
      do {
        this.refreshAgain = false;
        if (this.closed || this.stateValue.kind !== "watching" || this.options.view === false) break;
        await this.dropWorker("refreshing the view");
        // A view that cannot be opened (nothing saved yet, or the device refused) leaves no worker behind: `launch` killed it.
        await this.launch(null);
      } while (this.refreshAgain);
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /** What this supervisor still holds (a closed one holds nothing). */
  resources(): { worker: boolean; session: boolean; ping: boolean; guards: number; waiting: boolean; hints: boolean; ownership: { timer: boolean; lock: boolean; channel: boolean } | null; watchers: number } {
    return {
      worker: !!this.worker,
      session: !!this.session,
      ping: this.pingTimer !== null,
      guards: this.guards.size,
      waiting: !!this.takeoverAbort,
      hints: !!this.hints,
      ownership: this.ownership ? this.ownership.resources() : null,
      watchers: this.watchers.size,
    };
  }

  /**
   * Close: the session and its worker, the lease (released, so another tab may have the match at
   * once), the lock, every timer and channel. The match stays on the device at its last commit.
   */
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stopPing();
    this.stopWaiting();
    await this.dropWorker("closed");
    for (const t of this.guards) clearInterval(t);
    this.guards.clear();
    const own = this.ownership;
    this.ownership = null;
    await own?.release();
    this.setState("closed");
    this.watchers.clear();
    this.stateListeners.clear();
  }

  /**
   * TEST-ONLY: what a tab that closed or crashed leaves: its worker gone, its lock let go by the
   * browser, its lease neither renewed nor released, nothing more sent. Never called by the app.
   */
  vanish(): void {
    this.closed = true;
    this.stopPing();
    this.stopWaiting();
    for (const t of this.guards) clearInterval(t);
    this.guards.clear();
    if (this.worker) this.kill(this.worker, "the tab is gone");
    this.ownership?.vanish();
    this.ownership = null;
    this.watchers.clear();
    this.stateListeners.clear();
  }

  /** TEST-ONLY: a frozen tab: its heartbeat and pings stop; it keeps its lease and lock. */
  freeze(): void { this.ownership?.freeze(); this.stopPing(); }
  thaw(): void { this.ownership?.thaw(); if (this.stateValue.kind === "owner") this.startPing(); }
}
