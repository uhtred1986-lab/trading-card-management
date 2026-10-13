/**
 * The local match host (#652, plan O3-02): what runs inside the dedicated Web
 * Worker that owns one local match. `./worker-entry.ts` binds it to the
 * worker's `postMessage`; a proof binds it to an in-process channel.
 *
 * It holds everything the page may not: the pinned match (`browser.ts`), the
 * AI seat's memory and RNG (`policy/`), the move journal, the request receipts.
 * The page receives the human seat's projected board and nothing else
 * (`./protocol.ts`).
 *
 * Mutations follow the online semantics (`protocol.ts`): receipts first, then
 * freshness, then the seat, then the move. One mutation at a time: a second
 * one while the first is in flight is `busy`, never interleaved.
 *
 * `advance` plays the AI seat with the local policy (`localStep`) in bounded
 * batches. A batch is computed on a copy, then the worker yields to its event
 * loop — so a `cancel` or `dispose` that arrived meanwhile is read — and only
 * then is the batch written to the journal and committed. A cancelled or
 * disposed batch is dropped whole: the match, the AI's memory (its RNG
 * included) and the journal stay exactly as they were, so the next advance
 * plays the very decisions the dropped batch would have.
 *
 * An AI question the policy cannot answer (`localStep`'s `interrupted`), a
 * question no seat is asked (a referee ruling) or a refused answer stops the
 * session as `interrupted` with the reason. Nothing falls back to a network or
 * provider, and no outcome is invented.
 *
 * One writer (#654): a `start`/`resume` may name the page's writer lease (`writer`); every commit is
 * then fenced by it in the store's own transaction, and a commit refused because another tab took
 * the match over (`fenced`) answers `busy-elsewhere` and turns the session read-only for good. A
 * `readOnly` resume replays and serves the board but writes nothing and refuses every mutation as
 * `busy-elsewhere` — a watching tab's view. Who holds the lease, and restarting a dead worker, is
 * the page's (`./ownership.ts`, `./recovery.ts`).
 *
 * Browser-safe: it imports the portable entry, the pack runtime, the conceal
 * rules and the policy, and is an entry of `scripts/verify/arena-browser-boundary.mts`.
 */
import type { Action, GameEvent, PlayerId } from "../types";
import type { Snapshot } from "../snapshot-core";
import { applyMove, projectSnapshot, type PinnedMatch } from "../browser";
import { matchFromPack, packContent, qualificationReasons, validateOfflinePack, type OfflinePack } from "./pack";
import { resolveAliased } from "../conceal";
import { IllegalAction } from "../vm/common";
import { localStep } from "../policy/boundary";
import { localPolicy, COMBAT_POLICY_VERSION } from "../policy/combat";
import { localMemory, MAIN_POLICY_VERSION, type LocalMemory } from "../policy/main";
import { CHOICE_POLICY_VERSION } from "../policy/choices";
import { policyRng } from "../policy/rng";
import { fingerprint, stableJson, type Policy } from "../policy/contract";
import { STORAGE_PROTOCOL_CODE, StorageError, type WriterFence } from "./storage";
import {
  ADVANCE_DEFAULT, BATCH_DEFAULT, ERROR_SENTENCE, envelope, parseRequest,
  type AdvanceRequest, type AdvanceStop, type ApplyRequest, type CancelRequest, type DisposeRequest, type ErrorMessage,
  type LocalErrorCode, type LocalResponse, type ReadRequest, type ResultMessage, type ResumeRequest, type SessionStatus, type StartRequest,
} from "./protocol";

/** The local policy this worker plays, by its layers' versions. A journal recorded under another is not continued. */
export const LOCAL_POLICY_VERSION = `main${MAIN_POLICY_VERSION}+combat${COMBAT_POLICY_VERSION}+choices${CHOICE_POLICY_VERSION}`;
export const JOURNAL_FORMAT = 1;

/** One committed decision. A human move is kept as the engine move it resolved to; an AI move by its decision id, and replayed by asking the policy again. */
export type JournalEntry =
  | { seat: PlayerId; kind: "human"; action: Action; requestId: string }
  | { seat: PlayerId; kind: "ai"; id: string };

export interface Receipt { requestId: string; fingerprint: string; revision: number; /** `advance` only. */ stopped?: AdvanceStop }

/**
 * Everything needed to continue a match exactly: the pack it came from (by
 * hash), the seats, both seeds, the decisions in order, the AI's memory, the
 * receipts and a trace of every decision and the engine events it caused.
 * It stays in the worker, which keeps it in IndexedDB (`./storage.ts`, #653); it
 * names hidden cards by instance id and is never posted to the page.
 */
export interface MatchJournal {
  format: typeof JOURNAL_FORMAT;
  matchId: string;
  packHash: string;
  decks: { p1: string; p2: string };
  human: PlayerId;
  seed: number;
  policySeed: number;
  interpreterRevision: string;
  policyVersion: string;
  entries: JournalEntry[];
  aiMemory: LocalMemory;
  receipts: Receipt[];
  /** FNV-1a over every decision and its events; equal traces mean equal games. */
  trace: string;
  status: SessionStatus;
  interruption: string | null;
}

/**
 * Where journals are kept. In memory by default (proofs); the worker entry uses the transactional
 * IndexedDB one (`./storage.ts`). `put` stores the whole journal atomically or throws and stores
 * nothing (a `StorageError` names why); `get` throws a `StorageError` for a save it cannot trust.
 */
export interface JournalStore {
  get(matchId: string): MatchJournal | null | Promise<MatchJournal | null>;
  /**
   * `fence` (#654): the writer this commit is made for. A store that keeps writer leases (the
   * IndexedDB one) refuses a commit whose fence is not the match's current lease, as a
   * `StorageError` "fenced", writing nothing; the in-memory store has no leases and ignores it.
   */
  put(journal: MatchJournal, fence?: WriterFence | null): void | Promise<void>;
}

export function memoryJournalStore(): JournalStore & { journals: Map<string, MatchJournal> } {
  const journals = new Map<string, MatchJournal>();
  return {
    journals,
    get: (matchId) => (journals.has(matchId) ? structuredClone(journals.get(matchId)!) : null),
    put: (journal) => { journals.set(journal.matchId, structuredClone(journal)); },
  };
}

export interface LocalHostOptions {
  /** How a message reaches the page (the worker's `postMessage`). */
  post(message: LocalResponse): void;
  store?: JournalStore;
  /** How the host lets queued messages in between batches; a macrotask by default. */
  yieldNow?: () => Promise<void>;
  /** In-process proofs only: each AI decision's wall time. Never posted. */
  observe?: (event: { seat: PlayerId; window: string; ms: number }) => void;
  /** In-process proofs only: another policy for the AI seat (an interrupting one). The worker entry never sets it. */
  policy?: Policy;
}

/** What a proof in the same process may read; the worker entry never exposes it. */
export interface HostInspection {
  sessionId: string;
  human: PlayerId;
  revision: number;
  match: PinnedMatch;
  memory: LocalMemory;
  journal: MatchJournal;
  /** The human seat's board for any match, as the host projects its own. */
  project(match: PinnedMatch): Snapshot;
}

export interface LocalMatchHost {
  /** Announce the worker (`ready`, with the policy version). */
  hello(): void;
  /** One message from the page. Never throws; every request is answered. */
  handle(data: unknown): Promise<void>;
  inspect(): HostInspection | null;
}

interface Session {
  id: string;
  matchId: string;
  gameId: number;
  packHash: string;
  decks: { p1: string; p2: string };
  human: PlayerId;
  ai: PlayerId;
  seed: number;
  policySeed: number;
  interpreterRevision: string;
  batch: number;
  match: PinnedMatch;
  memory: LocalMemory;
  entries: JournalEntry[];
  receipts: Map<string, Receipt>;
  trace: number;
  status: SessionStatus;
  interruption: string | null;
  /** The request id of the mutation in flight, if any. */
  busy: string | null;
  /** The running advance, so `cancel`/`dispose` can stop it at its next batch boundary. */
  advancing: { requestId: string; cancelled: boolean } | null;
  disposed: boolean;
  /** #654: the writer lease every commit is fenced by (null: unfenced). */
  writer: WriterFence | null;
  /** #654: this session only shows the match (opened read-only, or its writer was superseded); every mutation is `busy-elsewhere`. */
  readOnly: string | null;
}

const FNV_OFFSET = 0x811c9dc5;
function mix(hash: number, text: string): number {
  let h = hash;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
const traceOf = (entry: JournalEntry, events: GameEvent[]) => `${entry.seat}:${entry.kind}:${entry.kind === "ai" ? entry.id : stableJson(entry.action)}:${JSON.stringify(events)};`;
const hex = (h: number) => h.toString(16).padStart(8, "0");
const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");
const askedSeat = (m: PinnedMatch): PlayerId | null => (m.state.phase === "over" ? null : ((m.state.prompt as { player?: PlayerId }).player ?? null));
const statusOf = (m: PinnedMatch): SessionStatus => (m.state.phase === "over" ? "over" : "playing");
const revisionOf = (entries: readonly JournalEntry[]) => entries.length + 1;
const macrotask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

class Refusal extends Error {
  constructor(readonly code: LocalErrorCode, message: string, readonly reasons?: string[]) {
    super(message);
  }
}

export function createLocalMatchHost(options: LocalHostOptions): LocalMatchHost {
  const store = options.store ?? memoryJournalStore();
  const yieldNow = options.yieldNow ?? macrotask;
  const policy = options.policy ?? localPolicy();
  let session: Session | null = null;
  /** A start or resume in progress (async: the pack is hashed), and whether a dispose arrived meanwhile. */
  let opening: { sessionId: string; disposed: boolean } | null = null;
  const disposed = new Set<string>();

  const post = (message: LocalResponse) => options.post(message);
  const project = (s: Session, match: PinnedMatch, revision: number): Snapshot =>
    projectSnapshot(match, s.human, { id: s.gameId, revision, mode: "sparring" });
  const revision = (s: Session) => revisionOf(s.entries);

  function error(requestId: string | null, sessionId: string | null, code: LocalErrorCode, detail: string, reasons?: string[]): void {
    const s = session && session.id === sessionId ? session : null;
    const message: ErrorMessage = { type: "error", requestId, sessionId, ok: false, code, message: detail ? `${ERROR_SENTENCE[code]}: ${detail}` : ERROR_SENTENCE[code] };
    if (s) message.revision = revision(s);
    if (reasons?.length) message.reasons = reasons;
    post({ ...envelope(), ...message });
  }

  function result(s: Session, requestId: string, extra: Partial<Pick<ResultMessage, "duplicate" | "stopped" | "cancelled">> = {}, withSnapshot = true): void {
    const r = revision(s);
    post({ ...envelope(), type: "result", requestId, sessionId: s.id, ok: true, revision: r, status: s.status, snapshot: withSnapshot ? project(s, s.match, r) : null, ...extra });
  }

  function journalOf(s: Session, next: Partial<Session> = {}): MatchJournal {
    const v = { ...s, ...next };
    return {
      format: JOURNAL_FORMAT,
      matchId: v.matchId,
      packHash: v.packHash,
      decks: v.decks,
      human: v.human,
      seed: v.seed,
      policySeed: v.policySeed,
      interpreterRevision: v.interpreterRevision,
      policyVersion: LOCAL_POLICY_VERSION,
      entries: v.entries,
      aiMemory: v.memory,
      receipts: [...v.receipts.values()],
      trace: hex(v.trace),
      status: v.status,
      interruption: v.interruption,
    };
  }

  /** Write the journal of the next state, then take it: the journal is never behind what the page was told. */
  async function commit(s: Session, next: Partial<Session>): Promise<void> {
    try {
      await store.put(journalOf(s, next), s.writer);
    } catch (e) {
      // Another tab took the match over (#654): nothing was written, and this session never writes again.
      if (e instanceof StorageError && e.code === "fenced") s.readOnly = e.message;
      throw e;
    }
    Object.assign(s, next);
  }

  function sessionFor(req: { requestId: string; sessionId: string }): Session {
    if (session && session.id === req.sessionId && !session.disposed) return session;
    if (disposed.has(req.sessionId)) throw new Refusal("disposed", `session ${req.sessionId}`);
    throw new Refusal("session", `session ${req.sessionId} is not this worker's`);
  }

  /** Validate and qualify a pack for this runtime, and create its game: every refusal named. */
  async function openPack(rawPack: unknown, decks: { p1: string; p2: string }, seed: number, interpreterRevision: string) {
    const pack = rawPack as OfflinePack;
    const valid = await validateOfflinePack(pack);
    if (!valid.ok) throw new Refusal("unplayable", "the pack is not a valid offline pack", valid.errors.map((e) => `invalid pack: ${e}`));
    if (pack.compatibility.runtimeRevision !== interpreterRevision) {
      throw new Refusal("runtime", `the pack is for interpreter ${pack.compatibility.runtimeRevision}, this page runs ${interpreterRevision}`, [`runtime ${interpreterRevision} is not the pack's interpreter revision ${pack.compatibility.runtimeRevision}`]);
    }
    const reasons = qualificationReasons(packContent(pack), interpreterRevision);
    if (reasons.length) throw new Refusal("unplayable", `${reasons.length} reason(s)`, reasons);
    for (const key of [decks.p1, decks.p2]) if (!pack.decks.some((d) => d.key === key)) throw new Refusal("unplayable", `the pack has no deck ${key}`, [`no deck ${key}`]);
    // Validated and qualified above, once: `matchFromPack` is `instantiateOfflinePack` without repeating both.
    const made = await matchFromPack({ pack, p1: decks.p1, p2: decks.p2, seed, interpreterRevision });
    return { pack, match: made.match };
  }

  async function open(req: StartRequest | ResumeRequest): Promise<void> {
    if (session || opening) throw new Refusal("busy", "this worker already owns a match; dispose it first");
    if (disposed.has(req.sessionId)) throw new Refusal("disposed", `session ${req.sessionId}`);
    if (req.policyVersion !== undefined && req.policyVersion !== LOCAL_POLICY_VERSION) {
      throw new Refusal("policy", `the page asked for policy ${req.policyVersion}, this worker plays ${LOCAL_POLICY_VERSION}`);
    }
    const token = { sessionId: req.sessionId, disposed: false };
    opening = token;
    try {
      let s: Session;
      if (req.type === "start") {
        // The device read and the pack's validation overlap; the saved-match check still answers first.
        const saved = Promise.resolve(store.get(req.matchId));
        const opened = openPack(req.pack, req.decks, req.seed, req.interpreterRevision);
        opened.catch(() => {}); // awaited below, after the saved-match check
        // A new match never overwrites a journalled one: that one is resumed, not restarted.
        if (await saved) throw new Refusal("journal", `a match ${req.matchId} is already saved; resume it or choose another id`);
        const { pack, match } = await opened;
        s = {
          id: req.sessionId, matchId: req.matchId, gameId: req.gameId, packHash: pack.hash, decks: { ...req.decks }, human: req.human, ai: other(req.human),
          seed: req.seed, policySeed: req.policySeed, interpreterRevision: req.interpreterRevision, batch: req.batch ?? BATCH_DEFAULT,
          match, memory: localMemory(policyRng(req.policySeed)), entries: [], receipts: new Map(), trace: FNV_OFFSET,
          status: statusOf(match), interruption: null, busy: null, advancing: null, disposed: false,
          writer: req.writer ?? null, readOnly: null,
        };
      } else {
        s = await replayJournal(req);
      }
      if (token.disposed) throw new Refusal("disposed", `session ${req.sessionId} was disposed while it opened`);
      // A read-only view writes nothing; a writer saves (or, on resume, re-checks with its fence) before it answers.
      if (!s.readOnly) await store.put(journalOf(s), s.writer);
      session = s;
      result(s, req.requestId);
    } finally {
      opening = null;
    }
  }

  /** Re-create a journalled match by playing its decisions again — the AI's by asking the policy again — and check it is the same game. */
  async function replayJournal(req: ResumeRequest): Promise<Session> {
    const journal = await store.get(req.matchId);
    if (!journal) throw new Refusal("journal", `no saved match ${req.matchId}`);
    if (journal.format !== JOURNAL_FORMAT) throw new Refusal("journal", `journal format ${String(journal.format)} is not ${JOURNAL_FORMAT}`);
    if (journal.policyVersion !== LOCAL_POLICY_VERSION) throw new Refusal("policy", `the match was played by policy ${journal.policyVersion}, this worker plays ${LOCAL_POLICY_VERSION}`);
    if ((req.pack as { hash?: unknown }).hash !== journal.packHash) throw new Refusal("journal", "the pack is not the one this match was started from");
    if (journal.interpreterRevision !== req.interpreterRevision) {
      throw new Refusal("runtime", `the match was played on interpreter ${journal.interpreterRevision}, this page runs ${req.interpreterRevision}`);
    }
    const { match: first } = await openPack(req.pack, journal.decks, journal.seed, req.interpreterRevision);
    const ai = other(journal.human);
    let match = first;
    let memory = localMemory(policyRng(journal.policySeed));
    let trace = FNV_OFFSET;
    for (const [i, entry] of journal.entries.entries()) {
      const where = `decision ${i + 1} of ${journal.entries.length}`;
      if (entry.kind === "human") {
        if (entry.seat !== journal.human || askedSeat(match) !== journal.human) throw new Refusal("journal", `${where}: the human seat was not asked`);
        let next;
        try { next = applyMove(match, entry.action); } catch (e) { throw new Refusal("journal", `${where}: ${describe(e)}`); }
        match = next.match;
        trace = mix(trace, traceOf(entry, next.events));
      } else {
        if (entry.seat !== ai || askedSeat(match) !== ai) throw new Refusal("journal", `${where}: the AI seat was not asked`);
        const step = localStep(match, ai, i, memory, policy);
        if (!step.ok || step.id !== entry.id) throw new Refusal("journal", `${where}: the policy answered ${step.ok ? step.id : step.reason} where the journal has ${entry.id}`);
        memory = step.memory;
        match = step.match;
        trace = mix(trace, traceOf(entry, step.events));
      }
    }
    if (hex(trace) !== journal.trace) throw new Refusal("journal", `replaying the journal gave trace ${hex(trace)}, the journal has ${journal.trace}`);
    if (stableJson(memory) !== stableJson(journal.aiMemory)) throw new Refusal("journal", "replaying the journal did not reproduce the AI's memory");
    return {
      id: req.sessionId, matchId: journal.matchId, gameId: req.gameId, packHash: journal.packHash, decks: journal.decks, human: journal.human, ai,
      seed: journal.seed, policySeed: journal.policySeed, interpreterRevision: journal.interpreterRevision, batch: req.batch ?? BATCH_DEFAULT,
      match, memory, entries: journal.entries, receipts: new Map(journal.receipts.map((r) => [r.requestId, r])), trace,
      status: journal.status === "interrupted" ? "interrupted" : statusOf(match), interruption: journal.interruption, busy: null, advancing: null, disposed: false,
      writer: req.writer ?? null, readOnly: req.readOnly ? "this tab was opened to watch the match, not to play it" : null,
    };
  }

  /** The receipt rule: the same request id and payload is a replay, another payload a conflict. */
  function receipt(s: Session, requestId: string, payload: unknown): Receipt | null {
    const found = s.receipts.get(requestId);
    if (!found) return null;
    if (found.fingerprint !== fingerprint(stableJson(payload))) throw new Refusal("conflict", "");
    return found;
  }

  async function apply(req: ApplyRequest): Promise<void> {
    const s = sessionFor(req);
    if (req.actor !== s.human) throw new Refusal("actor", `${req.actor} is the computer's seat`);
    const payload = { basedOn: req.basedOn, action: req.action };
    if (receipt(s, req.requestId, payload)) return result(s, req.requestId, { duplicate: true });
    if (s.readOnly) throw new Refusal("busy-elsewhere", s.readOnly);
    if (s.busy) throw new Refusal("busy", "");
    if (req.basedOn !== revision(s)) throw new Refusal("stale", `based on ${req.basedOn}, the board is at ${revision(s)}`);
    if (s.status === "over") throw new Refusal("over", "");
    if (s.status === "interrupted") throw new Refusal("interrupted", s.interruption ?? "");
    if (askedSeat(s.match) !== s.human) throw new Refusal("actor", "the computer is being asked");
    const resolved = resolveAliased(req.action, s.match.state, s.human, s.match.ctx.rulesetDefinition);
    if (!resolved.ok) throw new Refusal("illegal", resolved.reason);
    let next;
    try {
      next = applyMove(s.match, resolved.value);
    } catch (e) {
      if (e instanceof IllegalAction) throw new Refusal("illegal", e.message);
      throw e;
    }
    s.busy = req.requestId;
    try {
      const entry: JournalEntry = { seat: s.human, kind: "human", action: resolved.value, requestId: req.requestId };
      const entries = [...s.entries, entry];
      const receipts = new Map(s.receipts).set(req.requestId, { requestId: req.requestId, fingerprint: fingerprint(stableJson(payload)), revision: revisionOf(entries) });
      await commit(s, { match: next.match, entries, receipts, trace: mix(s.trace, traceOf(entry, next.events)), status: statusOf(next.match) });
    } finally {
      s.busy = null;
    }
    result(s, req.requestId);
  }

  async function advance(req: AdvanceRequest): Promise<void> {
    const s = sessionFor(req);
    const max = req.maxDecisions ?? ADVANCE_DEFAULT;
    const payload = { basedOn: req.basedOn, type: "advance", maxDecisions: max };
    const seen = receipt(s, req.requestId, payload);
    if (seen) return result(s, req.requestId, { duplicate: true, stopped: seen.stopped ?? "limit" });
    if (s.readOnly) throw new Refusal("busy-elsewhere", s.readOnly);
    if (s.busy) throw new Refusal("busy", "");
    if (req.basedOn !== revision(s)) throw new Refusal("stale", `based on ${req.basedOn}, the board is at ${revision(s)}`);
    if (s.status === "interrupted") throw new Refusal("interrupted", s.interruption ?? "");
    const token = { requestId: req.requestId, cancelled: false };
    s.busy = req.requestId;
    s.advancing = token;
    let done = 0;
    let stopped: AdvanceStop = "limit";
    let interruption: string | null = null;
    try {
      for (;;) {
        if (s.match.state.phase === "over") { stopped = "over"; break; }
        const seat = askedSeat(s.match);
        if (seat === s.human) { stopped = "human"; break; }
        if (seat === null) { interruption = `no seat is asked (${s.match.state.prompt.kind}): a referee question this worker cannot answer`; break; }
        if (done >= max) { stopped = "limit"; break; }
        let m = s.match;
        let memory = s.memory;
        let trace = s.trace;
        const added: JournalEntry[] = [];
        let failed: string | null = null;
        while (added.length < s.batch && done + added.length < max && askedSeat(m) === s.ai) {
          const window = m.state.prompt.kind;
          const t0 = performance.now();
          const step = localStep(m, s.ai, s.entries.length + added.length, memory, policy);
          options.observe?.({ seat: s.ai, window, ms: performance.now() - t0 });
          if (!step.ok) { failed = `${step.reason}: ${step.detail}`; break; }
          const entry: JournalEntry = { seat: s.ai, kind: "ai", id: step.id };
          added.push(entry);
          memory = step.memory;
          m = step.match;
          trace = mix(trace, traceOf(entry, step.events));
        }
        // Let a cancel or dispose that arrived during the batch be read before anything is kept.
        await yieldNow();
        if (token.cancelled || s.disposed || session !== s) {
          error(req.requestId, s.id, "cancelled", `after ${done} AI decision(s); the batch in progress was dropped`);
          return;
        }
        if (added.length) {
          await commit(s, { match: m, memory, entries: [...s.entries, ...added], trace, status: statusOf(m) });
          done += added.length;
          const r = revision(s);
          post({ ...envelope(), type: "snapshot", sessionId: s.id, revision: r, status: s.status, snapshot: project(s, s.match, r) });
        }
        if (failed) { interruption = failed; break; }
      }
      if (interruption) {
        await commit(s, { status: "interrupted", interruption });
        post({ ...envelope(), type: "interrupted", sessionId: s.id, revision: revision(s), reason: interruption });
        throw new Refusal("interrupted", interruption, [interruption]);
      }
      await commit(s, { receipts: new Map(s.receipts).set(req.requestId, { requestId: req.requestId, fingerprint: fingerprint(stableJson(payload)), revision: revision(s), stopped }) });
    } finally {
      if (s.advancing === token) s.advancing = null;
      if (s.busy === req.requestId) s.busy = null;
    }
    result(s, req.requestId, { stopped });
  }

  function read(req: ReadRequest): void {
    result(sessionFor(req), req.requestId);
  }

  function cancel(req: CancelRequest): void {
    const s = sessionFor(req);
    const running = s.advancing?.requestId === req.target ? s.advancing : null;
    if (running) running.cancelled = true;
    result(s, req.requestId, { cancelled: !!running });
  }

  function dispose(req: DisposeRequest): void {
    if (opening && opening.sessionId === req.sessionId) {
      opening.disposed = true;
      disposed.add(req.sessionId);
      post({ ...envelope(), type: "result", requestId: req.requestId, sessionId: req.sessionId, ok: true, revision: 0, status: "playing", snapshot: null });
      return;
    }
    const s = sessionFor(req);
    s.disposed = true;
    if (s.advancing) s.advancing.cancelled = true;
    session = null;
    disposed.add(s.id);
    result(s, req.requestId, {}, false);
  }

  return {
    hello() {
      post({ ...envelope(), type: "ready", policyVersion: LOCAL_POLICY_VERSION });
    },
    async handle(data) {
      const parsed = parseRequest(data);
      if (!parsed.ok) return error(parsed.requestId, parsed.sessionId, parsed.code, parsed.message);
      const req = parsed.value;
      try {
        switch (req.type) {
          case "start":
          case "resume": return await open(req);
          case "read": return read(req);
          case "apply": return await apply(req);
          case "advance": return await advance(req);
          case "cancel": return cancel(req);
          case "dispose": return dispose(req);
        }
      } catch (e) {
        if (e instanceof Refusal) return error(req.requestId, req.sessionId, e.code, e.message, e.reasons);
        // Nothing was committed: the match stays at its last saved revision, in memory and on the device.
        if (e instanceof StorageError) return error(req.requestId, req.sessionId, STORAGE_PROTOCOL_CODE[e.code], e.message, [`${e.code}: ${e.message}`]);
        return error(req.requestId, req.sessionId, "internal", describe(e));
      }
    },
    inspect() {
      const s = session;
      if (!s) return null;
      return { sessionId: s.id, human: s.human, revision: revision(s), match: s.match, memory: s.memory, journal: journalOf(s), project: (m) => project(s, m, revision(s)) };
    },
  };
}
