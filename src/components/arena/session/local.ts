/**
 * The local implementation of `ArenaSession` (#652, plan O3-02): the page side
 * of the local match worker protocol (`src/lib/arena/local/protocol.ts`). The
 * worker (`src/lib/arena/local/worker-entry.ts`) owns the match; this client
 * holds only what the board is shown — the human seat's latest snapshot and its
 * revision — and the requests it is waiting on.
 *
 * It is not wired to the board yet (O3-05 does that); `ArenaStage` can take it
 * as it takes the online session.
 *
 * What it refuses, so a late or foreign message cannot change what the board
 * shows:
 *  - a message that is not exactly this protocol and version (`parseResponse`);
 *  - a result or error for a request it is not waiting on (a duplicate, a late
 *    answer after `dispose`, an out-of-order one), or for another session;
 *  - a snapshot of another session or game, or one no newer than the one held
 *    (`acceptSnapshot`, the board's own rule).
 *
 * No engine here: its value graph reaches the protocol and the session
 * contract only (`scripts/verify/arena-local-worker.mts` checks it).
 */
import { acceptSnapshot, capabilitiesOf, type ArenaSession, type SessionConnection, type SessionResult, type WatchHandle, type WatchOptions } from "./contract";
import type { Snapshot } from "@/lib/arena/snapshot";
import type { Action, PlayerId } from "@/lib/arena/types";
import {
  ERROR_SENTENCE, envelope, parseResponse,
  type AdvanceStop, type ErrorMessage, type LocalErrorCode, type LocalRequest, type LocalResponse, type ResultMessage, type SessionStatus,
} from "../../../lib/arena/local/protocol";

/** What a `Worker` offers, and what an in-process channel imitates. */
export interface WorkerPort {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "error", listener: (event: { message?: string }) => void): void;
  terminate?(): void;
}

export interface LocalStartInput {
  matchId: string;
  gameId: number;
  pack: unknown;
  interpreterRevision: string;
  policyVersion?: string;
  batch?: number;
}

export interface LocalNewMatch extends LocalStartInput {
  decks: { p1: string; p2: string };
  human: PlayerId;
  seed: number;
  policySeed: number;
}

export interface LocalSessionOptions {
  /** A request id per call the client makes itself (`advance`, `refresh`, ...); a UUID. */
  newRequestId?: () => string;
  /** The page's name for the session. */
  sessionId?: string;
  /** Wait for the worker's `ready` first (a fresh worker); false when reusing a worker after `dispose`. */
  awaitReady?: boolean;
  /** Called when the worker reports that the AI stopped on a question it cannot answer. */
  onInterrupted?: (reason: string) => void;
}

/** A refusal the worker gave, with its code and reasons. */
export class LocalSessionError extends Error {
  constructor(readonly code: LocalErrorCode, message: string, readonly reasons: string[] = []) {
    super(message);
    this.name = "LocalSessionError";
  }
}

type Answer = ResultMessage | ErrorMessage;
type Body = LocalRequest extends infer R ? (R extends LocalRequest ? Omit<R, "protocol" | "v" | "requestId" | "sessionId"> : never) : never;

const uuid = () => globalThis.crypto.randomUUID();

export class LocalWorkerSession implements ArenaSession {
  readonly capabilities = capabilitiesOf({ advance: () => this.advance() });
  readonly sessionId: string;
  /** What the client refused or ignored, for proofs and diagnostics. */
  readonly diagnostics = { refused: [] as string[], ignored: [] as string[], errors: [] as string[] };
  status: SessionStatus = "playing";
  interruption: string | null = null;
  policyVersion: string | null = null;
  /** The last stop reason of `advance`. */
  stopped: AdvanceStop | null = null;
  private current: Snapshot | null = null;
  private readonly pending = new Map<string, { sessionId: string; resolve: (answer: Answer) => void }>();
  private readonly watchers = new Set<WatchOptions>();
  private connection: SessionConnection = "connected";
  private closed = false;
  private advancing: string | null = null;
  private readonly ready: Promise<{ version: string } | { refused: string }>;
  private readyResolve: ((r: { version: string } | { refused: string }) => void) | null = null;
  private readonly newRequestId: () => string;

  private constructor(private readonly port: WorkerPort, readonly gameId: number, readonly human: PlayerId, private readonly options: LocalSessionOptions) {
    this.sessionId = options.sessionId ?? uuid();
    this.newRequestId = options.newRequestId ?? uuid;
    this.ready = options.awaitReady === false ? Promise.resolve({ version: "" }) : new Promise((resolve) => { this.readyResolve = resolve; });
    port.addEventListener("message", (event) => this.receive(event.data));
    port.addEventListener("error", (event) => this.fail(event.message ?? "the worker failed"));
  }

  /** Start a new local match in the worker behind `port`. Throws `LocalSessionError` when the worker refuses. */
  static async start(port: WorkerPort, input: LocalNewMatch, options: LocalSessionOptions = {}): Promise<LocalWorkerSession> {
    const s = new LocalWorkerSession(port, input.gameId, input.human, options);
    await s.open({ type: "start", ...input });
    return s;
  }

  /** Continue a journalled match (`matchId`) in the worker behind `port`. The human seat comes from the journal. */
  static async resume(port: WorkerPort, input: LocalStartInput, options: LocalSessionOptions = {}): Promise<LocalWorkerSession> {
    const s = new LocalWorkerSession(port, input.gameId, "p1", options);
    await s.open({ type: "resume", ...input });
    return s;
  }

  private async open(body: Body & { type: "start" | "resume" }): Promise<void> {
    const ready = await this.ready;
    if ("refused" in ready) throw new LocalSessionError("version", `${ERROR_SENTENCE.version}: ${ready.refused}`);
    const version = ready.version;
    this.policyVersion = version || null;
    if (body.policyVersion !== undefined && version && body.policyVersion !== version) {
      throw new LocalSessionError("policy", `${ERROR_SENTENCE.policy}: the worker plays ${version}, the page asked for ${body.policyVersion}`);
    }
    const answer = await this.request(body);
    if (!answer.ok) throw new LocalSessionError(answer.code, answer.message, answer.reasons);
    const you = answer.snapshot?.game.you;
    if (you) (this as { human: PlayerId }).human = you;
  }

  /** The board the client holds now. */
  get snapshot(): Snapshot | null { return this.current; }
  get revision(): number { return this.current?.game.revision ?? 0; }

  private request(body: Body, requestId = this.newRequestId()): Promise<Answer> {
    if (this.closed) return Promise.resolve(this.localError(requestId, "disposed"));
    return new Promise((resolve) => {
      this.pending.set(requestId, { sessionId: this.sessionId, resolve });
      this.port.postMessage({ ...envelope(), ...body, requestId, sessionId: this.sessionId });
    });
  }

  private localError(requestId: string, code: LocalErrorCode, detail = ""): ErrorMessage {
    return { type: "error", requestId, sessionId: this.sessionId, ok: false, code, message: detail ? `${ERROR_SENTENCE[code]}: ${detail}` : ERROR_SENTENCE[code] };
  }

  private receive(data: unknown): void {
    const parsed = parseResponse(data);
    if (!parsed.ok) {
      this.diagnostics.refused.push(parsed.message);
      // Another protocol version is fatal: nothing that worker says can be read, so nothing waits on it.
      if (parsed.code === "version") {
        if (this.readyResolve) { this.readyResolve({ refused: parsed.message }); this.readyResolve = null; }
        this.fail(parsed.message, "version");
      }
      return;
    }
    const m = parsed.value as LocalResponse;
    if (m.type === "ready") {
      if (this.readyResolve) { this.readyResolve({ version: m.policyVersion }); this.readyResolve = null; }
      return;
    }
    if (this.closed && m.type !== "result" && m.type !== "error") { this.diagnostics.ignored.push(`${m.type} after dispose`); return; }
    if (m.type === "snapshot") {
      if (m.sessionId !== this.sessionId) { this.diagnostics.ignored.push(`snapshot of session ${m.sessionId}`); return; }
      this.status = m.status;
      this.offer(m.snapshot);
      return;
    }
    if (m.type === "interrupted") {
      if (m.sessionId !== this.sessionId) { this.diagnostics.ignored.push(`interruption of session ${m.sessionId}`); return; }
      this.status = "interrupted";
      this.interruption = m.reason;
      this.options.onInterrupted?.(m.reason);
      return;
    }
    if (m.requestId === null) {
      // The worker could not read a message, or failed outside any request.
      this.diagnostics.errors.push(m.type === "error" ? m.message : "unreadable");
      if (m.type === "error" && m.code === "internal") this.setConnection("offline");
      return;
    }
    const waiting = this.pending.get(m.requestId);
    if (!waiting) { this.diagnostics.ignored.push(`${m.type} for request ${m.requestId}, which is not pending`); return; }
    if (m.sessionId !== waiting.sessionId) { this.diagnostics.ignored.push(`${m.type} for request ${m.requestId} from session ${m.sessionId}`); return; }
    this.pending.delete(m.requestId);
    if (m.type === "result") {
      this.status = m.status;
      if (m.snapshot) this.offer(m.snapshot);
    } else {
      this.diagnostics.errors.push(`${m.code}: ${m.message}`);
    }
    waiting.resolve(m);
  }

  /** Take a snapshot only when it is this game's and newer than what is held, and hand it to every watcher. */
  private offer(next: Snapshot): void {
    if (next.game.id !== this.gameId) { this.diagnostics.ignored.push(`snapshot of game ${next.game.id}`); return; }
    const accepted = this.current ? acceptSnapshot(this.current, next, this.gameId) : next;
    if (!accepted) { this.diagnostics.ignored.push(`snapshot at revision ${next.game.revision}, holding ${this.current?.game.revision}`); return; }
    this.current = accepted;
    for (const w of this.watchers) if (accepted.game.revision > w.revision || (accepted.beats?.seq ?? 0) > w.beat) w.onSnapshot(accepted);
  }

  private setConnection(c: SessionConnection): void {
    if (this.connection === c) return;
    this.connection = c;
    for (const w of this.watchers) w.onConnection(c);
  }

  private fail(detail: string, code: LocalErrorCode = "internal"): void {
    this.diagnostics.errors.push(`worker: ${detail}`);
    this.setConnection("offline");
    for (const [id, p] of this.pending) p.resolve(this.localError(id, code, detail));
    this.pending.clear();
  }

  private sentence(answer: Answer): SessionResult {
    return { error: answer.ok ? null : ERROR_SENTENCE[answer.code] };
  }

  // ---- ArenaSession ------------------------------------------------------------------------

  async act(action: Action, basedOn: number, requestId: string): Promise<SessionResult> {
    return this.sentence(await this.request({ type: "apply", actor: this.human, action, basedOn }, requestId));
  }

  /** Let the worker play the AI seat until the human is asked, the game ends or `maxDecisions` is reached. */
  async advance(maxDecisions?: number): Promise<SessionResult> {
    const answer = await this.advanceRaw(maxDecisions);
    return this.sentence(answer);
  }

  /** `advance`, answering with the worker's message itself. */
  async advanceRaw(maxDecisions?: number, requestId = this.newRequestId()): Promise<Answer> {
    this.advancing = requestId;
    try {
      const answer = await this.request({ type: "advance", basedOn: this.revision, ...(maxDecisions ? { maxDecisions } : {}) }, requestId);
      if (answer.ok) this.stopped = answer.stopped ?? null;
      return answer;
    } finally {
      if (this.advancing === requestId) this.advancing = null;
    }
  }

  /** Stop the running `advance` at its next batch boundary; the batch in progress is dropped. */
  async cancel(): Promise<boolean> {
    if (!this.advancing) return false;
    const answer = await this.request({ type: "cancel", target: this.advancing });
    return answer.ok && !!answer.cancelled;
  }

  watch(options: WatchOptions): WatchHandle {
    this.watchers.add(options);
    options.onConnection(this.connection);
    if (this.current && (this.current.game.revision > options.revision || (this.current.beats?.seq ?? 0) > options.beat)) options.onSnapshot(this.current);
    return {
      retry: () => this.refresh(),
      stop: () => { this.watchers.delete(options); },
    };
  }

  refresh(): void {
    void this.request({ type: "read" });
  }

  /** Read the worker's board now. */
  async read(): Promise<Answer> {
    return this.request({ type: "read" });
  }

  /**
   * Close the session: the worker drops any batch in progress and forgets the
   * match (its journal stays). Every request still waiting is answered here as
   * `disposed`, and nothing the worker sends afterwards reaches the board.
   */
  async dispose(): Promise<void> {
    if (this.closed) return;
    const id = this.newRequestId();
    const done = this.request({ type: "dispose" }, id);
    this.closed = true;
    for (const [rid, p] of this.pending) {
      if (rid === id) continue;
      p.resolve(this.localError(rid, "disposed"));
      this.pending.delete(rid);
    }
    this.watchers.clear();
    await done;
  }
}