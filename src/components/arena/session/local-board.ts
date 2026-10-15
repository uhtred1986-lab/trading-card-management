/**
 * The existing board on a local match (#656, plan O3-05): start, resume and finish with no
 * match API and no provider. `LocalBoard` is an `ArenaSession` over the page's
 * `LocalMatchSupervisor` (`src/lib/arena/local/recovery.ts`, #654) — one writer per match, a
 * restartable Worker, the IndexedDB journal — and adds what the board needs of a transport that
 * the supervisor does not own: the pack gate, a new match's identity, "Play again", the online
 * session's stale-board refresh, and a status the page can show (`describeBoard`).
 *
 * What it does not do, said once:
 *  - No engine. The pack is only read for its qualification flag, hash and deck keys; the worker
 *    validates and qualifies it again and is the authority (`unplayable` / `runtime`).
 *  - No abandon, flag, plan check, skin or staging switch, bug report: those are the online
 *    session's (server rows, cookies, the review queue). The capabilities say so and the board
 *    hides the controls. The protocol has no abandon; a match is left by leaving the page.
 *  - No pack store. Installing, verifying and removing packs is O4-03 (#658); until then the page
 *    is handed the pack (a file the player chose) and `LocalPointer` remembers only which match
 *    was last open, never a seed, a hand or a journal.
 *
 * Privacy: the board holds the human seat's snapshot and nothing else the worker knows. The seeds
 * for a new match are drawn here, handed to the worker and not kept by this module.
 */
import { capabilitiesOf, type ArenaSession, type SessionConnection, type SessionResult, type WatchHandle, type WatchOptions } from "./contract";
import { LocalWorkerSession, type LocalNewMatch, type LocalStartInput } from "./local";
import { LocalMatchSupervisor, type SpawnedWorker, type SupervisorOptions, type SupervisorState } from "../../../lib/arena/local/recovery";
import { ERROR_SENTENCE, type LocalErrorCode } from "../../../lib/arena/local/protocol";
import type { OwnershipOptions } from "../../../lib/arena/local/ownership";
import type { OfflinePack } from "../../../lib/arena/local/pack";
import type { Snapshot } from "@/lib/arena/snapshot";
import { localizeArt } from "@/lib/arena/local/art-urls";
import type { Action, PlayerId } from "@/lib/arena/types";
import { arenaDecklistsFromInputs, type ArenaDecklist } from "../decklist-model";

/** Why a board could not be opened at all (before any worker was started). */
export class LocalBoardError extends Error {
  constructor(readonly code: "pack" | "unplayable" | "deck" | "mismatch" | "environment", message: string, readonly reasons: string[] = []) {
    super(message);
    this.name = "LocalBoardError";
  }
}

/** The one thing remembered between visits: which match was open, and for which pack. No seed, no hand, no journal. */
export interface LocalPointer {
  matchId: string;
  gameId: number;
  packHash: string;
  packId: string;
  decks: { p1: string; p2: string };
  human: PlayerId;
  /** Display names for the picker, taken from the pack's decks. */
  names: { p1: string; p2: string };
  savedAt: number;
}

export interface PointerStore {
  get(): LocalPointer | null;
  set(pointer: LocalPointer): void;
  clear(): void;
}

export const POINTER_KEY = "dbs-arena-local-pointer";
const isPointer = (v: unknown): v is LocalPointer => {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  const deck = (d: unknown) => !!d && typeof d === "object" && typeof (d as Record<string, unknown>).p1 === "string" && typeof (d as Record<string, unknown>).p2 === "string";
  return typeof p.matchId === "string" && Number.isInteger(p.gameId) && typeof p.packHash === "string" && typeof p.packId === "string"
    && deck(p.decks) && deck(p.names) && (p.human === "p1" || p.human === "p2") && typeof p.savedAt === "number";
};

/** The pointer in a stored string; anything damaged or of the wrong shape is no pointer. */
export function readPointer(raw: string | null): LocalPointer | null {
  if (!raw) return null;
  try { const v: unknown = JSON.parse(raw); return isPointer(v) ? v : null; } catch { return null; }
}

/** `localStorage`, tolerating its absence, a full quota and a blocked accessor: the pointer is a convenience, never the match. */
export function browserPointerStore(storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null = () => (typeof localStorage === "undefined" ? null : localStorage)): PointerStore {
  const guarded = <T,>(f: (s: Pick<Storage, "getItem" | "setItem" | "removeItem">) => T, fallback: T): T => {
    try { const s = storage(); return s ? f(s) : fallback; } catch { return fallback; }
  };
  return {
    get: () => guarded((s) => readPointer(s.getItem(POINTER_KEY)), null),
    set: (p) => guarded((s) => s.setItem(POINTER_KEY, JSON.stringify(p)), undefined),
    clear: () => guarded((s) => s.removeItem(POINTER_KEY), undefined),
  };
}

export function memoryPointerStore(): PointerStore & { value: LocalPointer | null } {
  const store = { value: null as LocalPointer | null, get: () => store.value, set: (p: LocalPointer) => { store.value = p; }, clear: () => { store.value = null; } };
  return store;
}

/** The facts of a pack the page needs (a pack file is untrusted: every field is checked). */
export interface PackFacts {
  pack: OfflinePack;
  hash: string;
  id: string;
  runtimeRevision: string;
  decks: { key: string; name: string; leader: string | null; isTesting?: boolean }[];
}

const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Whether the page may start a match from `raw`. A pack the audit still blocks is refused here with
 * its reasons, before a worker is spent on it (the worker would refuse it too).
 */
export function readPack(raw: unknown): PackFacts {
  if (!record(raw) || typeof raw.hash !== "string" || typeof raw.id !== "string" || !Array.isArray(raw.decks) || !record(raw.compatibility) || typeof raw.compatibility.runtimeRevision !== "string" || !record(raw.qualification)) {
    throw new LocalBoardError("pack", "That file is not an offline deck pack.");
  }
  const q = raw.qualification;
  if (q.playable !== true) {
    const reasons = Array.isArray(q.reasons) ? q.reasons.filter((r): r is string => typeof r === "string") : [];
    throw new LocalBoardError("unplayable", `This deck pack is not playable yet${reasons.length ? ` (${reasons.length} open ${reasons.length === 1 ? "reason" : "reasons"})` : ""}. It stays closed until its open blockers are resolved.`, reasons);
  }
  if (raw.decks.some((d) => record(d) && d.isTesting !== undefined && typeof d.isTesting !== "boolean")) throw new LocalBoardError("pack", "A deck's testing flag must be true or false.");
  const decks = raw.decks.flatMap((d) => (record(d) && typeof d.key === "string" ? [{ key: d.key, name: typeof d.name === "string" ? d.name : d.key, ...(d.isTesting ? { isTesting: true } : {}), leader: record(d.deck) && record(d.deck.leader) && typeof d.deck.leader.name === "string" ? d.deck.leader.name : null }] : []));
  if (decks.length < 1) throw new LocalBoardError("pack", "That deck pack has no decks.");
  return { pack: raw as unknown as OfflinePack, hash: raw.hash, id: raw.id, runtimeRevision: raw.compatibility.runtimeRevision, decks };
}

export interface LocalBoardDeps {
  /** Start a module Worker on `worker-entry.ts`. */
  spawn: () => SpawnedWorker;
  ownership?: OwnershipOptions;
  supervisor?: Partial<SupervisorOptions>;
  pointers?: PointerStore;
  newId?: () => string;
  /** A fraction in [0, 1); `Math.random` unless a proof fixes it. */
  random?: () => number;
  now?: () => number;
  /** AI decisions per committed batch. */
  batch?: number;
  /** The installed pack's images as object URLs (#780); without it the board addresses catalog URLs. */
  art?: ReadonlyMap<string, string>;
}

export interface LocalSetup {
  decks: { p1: string; p2: string };
  human: PlayerId;
}

export type BoardTone = "ok" | "busy" | "warn" | "error";
export type BoardAction = "retry" | "takeOver" | "stop" | "leave" | "discard";

/** What the page tells the player about the match's safety: one headline, one sentence, the actions that help. */
export interface BoardNotice {
  tone: BoardTone;
  headline: string;
  detail: string;
  /** The raw reason (ids, the device's own words), for a "Details" disclosure; never the headline. */
  technical: string | null;
  actions: BoardAction[];
}

const REASON: Partial<Record<LocalErrorCode, string>> = {
  storage: "Free some space on this device, then try again.",
  newer: "Reload the page to get the newer version.",
  journal: "The saved match is damaged and cannot be continued.",
  runtime: "This pack was built for another version of the game engine.",
  policy: "The saved match was recorded with another version of the computer opponent.",
  unplayable: "This deck pack cannot be played here.",
  version: "Reload the page: it and the local game engine are different versions.",
};

/**
 * The status line for a supervisor state: null while all is well. The wording is the player's:
 * what happened, whether the match is safe, what to do next.
 */
export function describeBoard(state: SupervisorState, over: boolean): BoardNotice | null {
  const safe = "The match is safe at its last saved move.";
  const technical = state.detail;
  switch (state.kind) {
    case "owner":
      return null;
    case "opening":
      return { tone: "busy", headline: "Opening the match…", detail: "Reading it from this device.", technical: null, actions: [] };
    case "recovering":
      return { tone: "busy", headline: "The local game engine stopped. Restarting it…", detail: `Attempt ${state.restarts}. ${safe}`, technical, actions: ["stop"] };
    case "storage":
      return { tone: "error", headline: "Could not save on this device", detail: `${(state.code && REASON[state.code]) ?? REASON.storage} ${safe}`, technical, actions: ["retry", "leave"] };
    case "failed": {
      const specific = state.code ? REASON[state.code] : undefined;
      const discard = state.code === "journal" || state.code === "runtime" || state.code === "policy" || state.code === "unplayable";
      return { tone: "error", headline: "This match cannot continue right now", detail: `${specific ?? (state.code ? `${ERROR_SENTENCE[state.code][0].toUpperCase()}${ERROR_SENTENCE[state.code].slice(1)}.` : "The local game engine failed.")}${discard ? "" : ` ${safe}`}`, technical, actions: discard ? ["discard", "leave"] : ["retry", "leave"] };
    }
    case "stopped":
      return { tone: "warn", headline: "Stopped", detail: `You stopped waiting. ${safe}`, technical, actions: ["retry", "leave"] };
    case "watching":
      return state.watching === "taken-over"
        ? { tone: "warn", headline: "Another tab took this match over", detail: "This tab now only shows it and will not save anything. Play here instead to take it back.", technical, actions: ["takeOver", "leave"] }
        : { tone: "warn", headline: "This match is open in another tab", detail: "This tab only shows it; moves are not accepted here. Play here instead to take it over — the other tab becomes read-only.", technical, actions: ["takeOver", "leave"] };
    case "closed":
      return { tone: "warn", headline: over ? "Match closed" : "This match was closed", detail: over ? "The final position is saved on this device." : "Open it again from the start page.", technical: null, actions: ["leave"] };
  }
}

const uuid = () => globalThis.crypto.randomUUID();

/** An `ArenaSession` over a local match, with start, resume and "Play again". */
export class LocalBoard implements ArenaSession {
  readonly capabilities = capabilitiesOf({ advance: () => this.advance(), rematch: () => this.rematch() });
  readonly gameId: number;
  readonly matchId: string;
  readonly human: PlayerId;
  readonly packFacts: PackFacts;
  readonly setup: LocalSetup;
  readonly decklists: Partial<Record<PlayerId, ArenaDecklist>>;
  private pendingCount = 0;
  private readonly listeners = new Set<() => void>();
  private readonly successors = new Set<(next: LocalBoard) => void>();
  private rematching: Promise<SessionResult> | null = null;
  private closed = false;
  private offState: (() => void) | null = null;

  private constructor(readonly supervisor: LocalMatchSupervisor, facts: PackFacts, setup: LocalSetup, identity: { matchId: string; gameId: number }, private readonly deps: LocalBoardDeps) {
    this.gameId = identity.gameId;
    this.matchId = identity.matchId;
    this.human = setup.human;
    this.packFacts = facts;
    this.setup = setup;
    const inputs: Partial<Record<PlayerId, OfflinePack["decks"][number]["deck"]>> = {};
    for (const seat of ["p1", "p2"] as const) {
      const deck = facts.pack.decks.find((candidate) => candidate.key === setup.decks[seat]);
      if (deck) inputs[seat] = deck.deck;
    }
    const decklists = arenaDecklistsFromInputs(inputs, facts.pack.bundle.payload.defs, facts.pack.bundle.payload.art);
    this.decklists = deps.art ? localizeArt(decklists, deps.art) : decklists;
    this.offState = supervisor.onState(() => this.changed());
  }

  // ---- opening ----------------------------------------------------------------------------

  private static pointerOf(facts: PackFacts, setup: LocalSetup, identity: { matchId: string; gameId: number }, now: number): LocalPointer {
    const name = (key: string) => facts.decks.find((d) => d.key === key)?.name ?? key;
    return { matchId: identity.matchId, gameId: identity.gameId, packHash: facts.hash, packId: facts.id, decks: { ...setup.decks }, human: setup.human, names: { p1: name(setup.decks.p1), p2: name(setup.decks.p2) }, savedAt: now };
  }

  private static supervisorOptions(deps: LocalBoardDeps): SupervisorOptions {
    return { ...deps.supervisor, spawn: deps.spawn, sessions: LocalWorkerSession, ...(deps.ownership ? { ownership: deps.ownership } : {}) };
  }

  /** Start a new local match. Throws `LocalBoardError` for a pack or deck the page refuses; every other outcome is the board's `state`. */
  static async start(raw: unknown, setup: LocalSetup, deps: LocalBoardDeps): Promise<LocalBoard> {
    const facts = readPack(raw);
    for (const seat of ["p1", "p2"] as const) {
      if (!facts.decks.some((d) => d.key === setup.decks[seat])) throw new LocalBoardError("deck", `The pack has no deck ${setup.decks[seat]}.`);
    }
    const newId = deps.newId ?? uuid;
    const random = deps.random ?? Math.random;
    const draw = () => Math.floor(random() * 0x7fffffff);
    const identity = { matchId: newId(), gameId: 1 + draw() % 0x3fffffff };
    const input: LocalNewMatch = {
      matchId: identity.matchId, gameId: identity.gameId, pack: facts.pack, interpreterRevision: facts.runtimeRevision,
      decks: { ...setup.decks }, human: setup.human, seed: draw(), policySeed: draw(),
      ...(deps.batch ? { batch: deps.batch } : {}),
    };
    const supervisor = await LocalMatchSupervisor.open({ start: input }, LocalBoard.supervisorOptions(deps));
    const board = new LocalBoard(supervisor, facts, setup, identity, deps);
    board.remember(LocalBoard.pointerOf(facts, setup, identity, (deps.now ?? Date.now)()));
    return board;
  }

  /** Continue the match `pointer` names from the device's journal. The pack must be the one it was started from. */
  static async resume(raw: unknown, pointer: LocalPointer, deps: LocalBoardDeps): Promise<LocalBoard> {
    const facts = readPack(raw);
    if (facts.hash !== pointer.packHash) {
      throw new LocalBoardError("mismatch", `The saved match was started from another deck pack (${pointer.packId}). Choose that pack to continue it.`);
    }
    const input: LocalStartInput = { matchId: pointer.matchId, gameId: pointer.gameId, pack: facts.pack, interpreterRevision: facts.runtimeRevision, ...(deps.batch ? { batch: deps.batch } : {}) };
    const supervisor = await LocalMatchSupervisor.open({ resume: input }, LocalBoard.supervisorOptions(deps));
    const board = new LocalBoard(supervisor, facts, { decks: pointer.decks, human: pointer.human }, { matchId: pointer.matchId, gameId: pointer.gameId }, deps);
    board.remember({ ...pointer, savedAt: (deps.now ?? Date.now)() });
    return board;
  }

  private remember(pointer: LocalPointer): void {
    // Only a match this tab can write (or one already saved) is worth a "Continue": a failed open leaves nothing to resume.
    const kind = this.supervisor.state.kind;
    if (kind === "owner" || kind === "watching") this.deps.pointers?.set(pointer);
  }

  // ---- state for the page ----------------------------------------------------------------

  get state(): SupervisorState { return this.supervisor.state; }
  get snapshot(): Snapshot | null { return this.localized(this.supervisor.snapshot); }

  /** Offline art (#780): catalog URLs in a snapshot become the pack store's object URLs. Cached by snapshot identity. */
  private readonly localizedOf = new WeakMap<Snapshot, Snapshot>();
  private localized(s: Snapshot | null): Snapshot | null {
    const urls = this.deps.art;
    if (!s || !urls || urls.size === 0) return s;
    let out = this.localizedOf.get(s);
    if (!out) { out = localizeArt(s, urls); this.localizedOf.set(s, out); }
    return out;
  }
  /** A move or an AI turn is being committed to the device. */
  get saving(): boolean { return this.pendingCount > 0; }
  get notice(): BoardNotice | null { return describeBoard(this.state, !!this.snapshot?.over); }

  /** Called on any change of state or of the saving flag. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Called with the next match when "Play again" opened one. */
  onSuccessor(listener: (next: LocalBoard) => void): () => void {
    this.successors.add(listener);
    return () => { this.successors.delete(listener); };
  }

  private changed(): void { for (const l of this.listeners) l(); }

  private async tracked<T>(work: () => Promise<T>): Promise<T> {
    this.pendingCount++;
    this.changed();
    try { return await work(); } finally { this.pendingCount--; this.changed(); }
  }

  // ---- ArenaSession ----------------------------------------------------------------------

  async act(action: Action, basedOn: number, requestId: string): Promise<SessionResult> {
    const answer = await this.tracked(() => this.supervisor.actRaw(action, basedOn, requestId));
    if (answer.ok) return { error: null };
    // The online path shows the refusal and lets the poll bring the newer board; here the worker's board is read again.
    if (answer.code === "stale" || answer.code === "busy-elsewhere" || answer.code === "illegal") this.supervisor.refresh();
    return { error: ERROR_SENTENCE[answer.code] };
  }

  async advance(): Promise<SessionResult> {
    const answer = await this.tracked(() => this.supervisor.advanceRaw());
    if (answer.ok) return { error: null };
    return { error: ERROR_SENTENCE[answer.code] };
  }

  watch(options: WatchOptions): WatchHandle {
    return this.supervisor.watch(this.deps.art ? { ...options, onSnapshot: (s) => options.onSnapshot(this.localized(s) ?? s) } : options);
  }
  refresh(): void { this.supervisor.refresh(); }

  /** "Play again": a new match of the same pack, decks and seat; this one is closed once the new one is open. */
  rematch(): Promise<SessionResult> {
    this.rematching ??= this.doRematch().finally(() => { this.rematching = null; });
    return this.rematching;
  }

  private async doRematch(): Promise<SessionResult> {
    if (this.closed) return { error: ERROR_SENTENCE.disposed };
    if (!this.snapshot?.over) return { error: "The match is not over yet." };
    let next: LocalBoard;
    try {
      next = await LocalBoard.start(this.packFacts.pack, this.setup, this.deps);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
    if (next.state.kind !== "owner" || !next.snapshot) {
      const notice = next.notice;
      const why = notice ? `${notice.headline}. ${notice.detail}` : ERROR_SENTENCE.internal;
      await next.dispose();
      return { error: why };
    }
    for (const l of this.successors) l(next);
    await this.dispose();
    return { error: null };
  }

  /** The player's recovery actions, passed to the supervisor. */
  retry(): Promise<SupervisorState> { return this.supervisor.retry(); }
  takeOver(): Promise<SupervisorState> { return this.supervisor.takeOver(); }
  stop(): Promise<void> { return this.supervisor.stop(); }

  /** Forget which match was open (the journal stays on the device; removing it is O4's control). */
  forget(): void { this.deps.pointers?.clear(); }

  /** Let go of the worker and the match's writer lease; the match stays on the device at its last commit. */
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.offState?.();
    this.offState = null;
    await this.supervisor.dispose();
    this.changed();
    this.listeners.clear();
  }

  get connection(): SessionConnection {
    const k = this.state.kind;
    return k === "owner" ? "connected" : k === "watching" || k === "stopped" ? "paused" : k === "opening" || k === "recovering" ? "reconnecting" : "offline";
  }
}
