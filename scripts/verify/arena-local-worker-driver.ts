/**
 * #652: the scripted local match both proofs play — `arena-local-worker.mts` (Node, in-process
 * channel) and `scripts/arena-local-worker-browser.mts` (headless Chrome, a real module Worker).
 *
 * It plays the human seat through `LocalWorkerSession` (the page client) from the snapshots alone,
 * and on the way sends what a broken or hostile page might: duplicates, conflicts, stale and
 * foreign requests, malformed and other-version messages, and forged worker messages the client
 * must ignore. Every refusal is checked to have changed nothing. Browser-safe: it imports the
 * client and the protocol only — no engine, no `node:`.
 */
import { LocalWorkerSession, type LocalNewMatch, type LocalSessionOptions, type WorkerPort } from "../../src/components/arena/session/local";
import { LOCAL_PROTOCOL, LOCAL_PROTOCOL_VERSION, type LocalResponse } from "../../src/lib/arena/local/protocol";
import type { Snapshot } from "../../src/lib/arena/snapshot-core";
import type { Action, PlayerId } from "../../src/lib/arena/types";

/** The scripted runs' constants: the same in Node and in Chrome, so their message streams can be compared byte for byte. */
export const LOCAL_REVISION = "a652000000000000000000000000000000000652";
export const OTHER_REVISION = "b652000000000000000000000000000000000652";
export const LOCAL_SEED = 652;
export const LOCAL_POLICY_SEED = 6521;
export const GAME_ID = 652;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A new match of the scripted pack: deck A (SD15) for the human in p1, deck B (SD5) for the AI. */
export function scriptedStart(pack: unknown, matchId: string, extra: Partial<LocalNewMatch> = {}): LocalNewMatch {
  return { matchId, gameId: GAME_ID, pack: clone(pack), decks: { p1: "A", p2: "B" }, human: "p1", seed: LOCAL_SEED, policySeed: LOCAL_POLICY_SEED, interpreterRevision: LOCAL_REVISION, batch: 4, ...extra };
}

/**
 * The two scripted runs. `a`: batches of 4, every refusal and forged message on the way.
 * `b`: the same match in batches of 1, each AI turn cancelled after its first batch (one at once),
 * disposed mid-advance at revision 40 or later and resumed from the journal.
 */
export async function runScripted(kind: "a" | "b", port: WorkerPort, inject: (data: unknown) => void, pack: unknown, extra: Partial<DriveOptions> = {}, sessionOptions: LocalSessionOptions = {}): Promise<DriveResult> {
  const nextId = requestIds(kind === "a" ? 0xa : 0xb);
  const session = await LocalWorkerSession.start(port, scriptedStart(pack, `match-${kind}`, kind === "b" ? { batch: 1 } : {}), { newRequestId: nextId, sessionId: `session-${kind}`, ...sessionOptions });
  const resume = (p: WorkerPort) => LocalWorkerSession.resume(p, { matchId: "match-b", gameId: GAME_ID, pack: clone(pack), interpreterRevision: LOCAL_REVISION, batch: 1 }, { newRequestId: nextId, sessionId: "session-c", awaitReady: false });
  return playScripted(session, kind === "a"
    ? { port, inject, nextId, abuse: true, ...extra }
    : { port, inject, nextId, cancel: true, disposeAt: 40, resume, ...extra });
}

export function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`check failed: ${message}`);
}

/** Deterministic UUID-shaped request ids, unique per `stream`. */
export function requestIds(stream: number): () => string {
  let n = 0;
  return () => `${stream.toString(16).padStart(8, "0")}-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`;
}

/** The human's move: a pure function of the board it is shown, so every run plays the same game. */
export function humanPick(snapshot: Snapshot): Action {
  const legal = snapshot.legal;
  const h = Math.imul(snapshot.game.revision + 0x9e37, 2654435761) >>> 0;
  return legal[h % legal.length].action;
}

const humanAsked = (s: Snapshot) => s.game.status !== "over" && s.decision?.actor === s.game.you && s.legal.length > 0;

/** Send raw messages to the worker beside the client, and wait for the worker's answer by request id. */
export function rawChannel(port: WorkerPort) {
  const waiting = new Map<string | null, ((m: LocalResponse) => void)[]>();
  port.addEventListener("message", (event) => {
    const m = event.data as LocalResponse & { requestId?: string | null };
    if (m?.type !== "result" && m?.type !== "error") return;
    const list = waiting.get(m.requestId ?? null);
    const next = list?.shift();
    if (next) next(m);
  });
  return {
    async send(message: unknown, expect: string | null): Promise<LocalResponse> {
      // Let the event being dispatched now (a browser runs microtasks between its listeners) finish
      // first, so an answer the client was just given is never taken for this request's.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return new Promise((resolve) => {
        const list = waiting.get(expect) ?? [];
        list.push(resolve);
        waiting.set(expect, list);
        port.postMessage(message);
      });
    },
  };
}

export interface DriveOptions {
  port: WorkerPort;
  /** Make a forged message look as if the worker sent it (the client must refuse or ignore it). */
  inject: (data: unknown) => void;
  nextId: () => string;
  /** Run the abuse and injection checks at the first human turns. */
  abuse?: boolean;
  /** Cancel each AI turn's advance after its first committed batch (and one immediately). */
  cancel?: boolean;
  /** Dispose the session during the advance that starts at this revision or later, then resume it. */
  disposeAt?: number;
  /** For `disposeAt`: resume the journalled match on the same worker. */
  resume?: (port: WorkerPort) => Promise<LocalWorkerSession>;
  maxSteps?: number;
  clock?: () => number;
  /** Called after every check that touched the worker, so a host-side proof can verify nothing moved. */
  unchanged?: (what: string, session: LocalWorkerSession) => void | Promise<void>;
}

export interface DriveResult {
  final: Snapshot;
  humanMoves: number;
  aiDecisions: number;
  advances: number;
  cancelsHonoured: number;
  disposed: boolean;
  checks: string[];
  /** Strictly increasing revisions as the board's watcher received them. */
  watched: number[];
  actMs: number[];
  /** Wall time of each advance that committed decisions, per decision. */
  aiMsPerDecision: number[];
  /** The session the match ends on (the resumed one after a dispose), and the one it started on. */
  session: LocalWorkerSession;
  first: LocalWorkerSession;
}

const env = { protocol: LOCAL_PROTOCOL, v: LOCAL_PROTOCOL_VERSION };

/** The refusals a page could provoke at a human turn; none may move the game. */
async function abuseAt(session: LocalWorkerSession, raw: ReturnType<typeof rawChannel>, o: DriveOptions, checks: string[]): Promise<void> {
  const s0 = session.snapshot!;
  const r0 = s0.game.revision;
  const human = s0.game.you;
  const ai: PlayerId = human === "p1" ? "p2" : "p1";
  const expect = async (what: string, message: unknown, requestId: string | null, code: string | "duplicate") => {
    const answer = await raw.send(message, requestId);
    if (code === "duplicate") check(answer.type === "result" && answer.duplicate === true, `${what}: answered from the receipt (${JSON.stringify(answer).slice(0, 200)})`);
    else check(answer.type === "error" && answer.code === code, `${what}: refused as ${code} (got ${answer.type === "error" ? answer.code : answer.type})`);
    const now = await session.read();
    check(now.ok && now.revision === session.revision, `${what}: the worker's revision is still the board's`);
    await o.unchanged?.(what, session);
    checks.push(what);
  };
  const apply = (requestId: string, fields: Record<string, unknown>) => ({ ...env, type: "apply", requestId, sessionId: session.sessionId, actor: human, action: humanPick(s0), basedOn: r0, ...fields });

  {
    const id = o.nextId();
    const a = await raw.send({ ...env, type: "read", requestId: id, sessionId: "someone-elses-session" }, id);
    check(a.type === "error" && a.code === "session", "a foreign session id is refused");
    checks.push("foreign session refused");
  }
  { const id = o.nextId(); await expect("the computer's seat as actor", apply(id, { actor: ai }), id, "actor"); }
  { const id = o.nextId(); await expect("a revision that is not the board's", apply(id, { basedOn: r0 + 7 }), id, "stale"); }
  {
    const template = s0.legal.find((l) => typeof (l.action as { card?: unknown }).card === "string");
    if (template) {
      const id = o.nextId();
      await expect("a card named by the opponent's hidden position", apply(id, { action: { ...template.action, card: `?${ai}:deck:0` } }), id, "illegal");
      const id2 = o.nextId();
      await expect("an alias from an earlier revision", apply(id2, { action: { ...template.action, card: "?p1:nowhere:99" } }), id2, "illegal");
    }
  }
  // Malformed and other-version messages: answered without a request id when it is unreadable.
  for (const [what, message, code] of [
    ["a non-object message", 42, "malformed"],
    ["another protocol", { protocol: "something-else", v: 1, type: "read" }, "malformed"],
    ["an unknown request type", { ...env, type: "teleport", requestId: "x", sessionId: session.sessionId }, "malformed"],
    ["a request id that is not a UUID", { ...env, type: "read", requestId: "not-a-uuid", sessionId: session.sessionId }, "malformed"],
  ] as const) {
    await expect(what, message, null, code);
  }
  { const id = o.nextId(); await expect("an extra field", { ...env, type: "read", requestId: id, sessionId: session.sessionId, peek: "state" }, id, "malformed"); }
  { const id = o.nextId(); await expect("a missing basedOn", { ...env, type: "apply", requestId: id, sessionId: session.sessionId, actor: human, action: humanPick(s0) }, id, "malformed"); }
  { const id = o.nextId(); await expect("protocol version 2", { ...env, v: 2, type: "read", requestId: id, sessionId: session.sessionId }, id, "version"); }

  // The real move, then the same request again (a retry), then the same id for another payload.
  const id = o.nextId();
  const done = await session.act(humanPick(s0), r0, id);
  check(done.error === null, `the human's move is accepted (${done.error})`);
  const r1 = session.revision;
  check(r1 === r0 + 1, `one move is one revision (${r0} -> ${r1})`);
  await expect("the same request again", apply(id, {}), id, "duplicate");
  await expect("the same request id for another payload", apply(id, { basedOn: r1 }), id, "conflict");
  if (session.snapshot!.decision?.actor !== human) {
    const nid = o.nextId();
    await expect("a move while the computer is asked", { ...apply(nid, { basedOn: r1 }) }, nid, "actor");
  }

  // Forged worker messages: the client keeps its board.
  const held = session.snapshot!;
  const before = { revision: session.revision, ignored: session.diagnostics.ignored.length, refused: session.diagnostics.refused.length };
  const later = (revision: number, fields: Partial<Snapshot["game"]> = {}): Snapshot => ({ ...held, game: { ...held.game, revision, ...fields } });
  o.inject({ ...env, type: "result", requestId: o.nextId(), sessionId: session.sessionId, ok: true, revision: held.game.revision + 100, status: "over", snapshot: later(held.game.revision + 100) });
  o.inject({ ...env, type: "snapshot", sessionId: "another-session", revision: held.game.revision + 100, status: "playing", snapshot: later(held.game.revision + 100) });
  o.inject({ ...env, type: "snapshot", sessionId: session.sessionId, revision: held.game.revision - 1, status: "playing", snapshot: later(held.game.revision - 1) });
  o.inject({ ...env, type: "snapshot", sessionId: session.sessionId, revision: held.game.revision + 100, status: "playing", snapshot: later(held.game.revision + 100, { id: held.game.id + 1 }) });
  o.inject({ ...env, protocol: "another-protocol", type: "snapshot", sessionId: session.sessionId, revision: held.game.revision + 100, status: "playing", snapshot: later(held.game.revision + 100) });
  o.inject({ ...env, type: "snapshot", sessionId: session.sessionId, revision: held.game.revision + 100, status: "playing", snapshot: later(held.game.revision + 100), journal: [] });
  check(session.revision === before.revision && session.snapshot === held, "forged worker messages leave the client's board alone");
  check(session.diagnostics.ignored.length - before.ignored === 4, `four forged messages were ignored (${session.diagnostics.ignored.slice(before.ignored).join("; ")})`);
  check(session.diagnostics.refused.length - before.refused === 2, "two malformed ones were refused");
  checks.push("forged results and snapshots (unknown request, other session, older revision, other game, other protocol, extra field) ignored");
}

/** Play the scripted match to its end (or `maxSteps`). */
export async function playScripted(session0: LocalWorkerSession, o: DriveOptions): Promise<DriveResult> {
  const clock = o.clock ?? (() => Date.now());
  const raw = rawChannel(o.port);
  let session = session0;
  const watched: number[] = [];
  let lastFirstSnapshot: (() => void) | null = null;
  const watch = (s: LocalWorkerSession) => s.watch({
    revision: s.revision,
    beat: s.snapshot?.beats?.seq ?? 0,
    onConnection: () => {},
    onSnapshot: (snap) => {
      check(!watched.length || snap.game.revision > watched[watched.length - 1] || snap.game.revision === watched[watched.length - 1], "the watcher never goes back");
      if (!watched.length || snap.game.revision > watched[watched.length - 1]) watched.push(snap.game.revision);
      const hook = lastFirstSnapshot;
      lastFirstSnapshot = null;
      hook?.();
    },
  });
  let handle = watch(session);
  const checks: string[] = [];
  const result: Omit<DriveResult, "final" | "session" | "first" | "watched" | "checks"> = { humanMoves: 0, aiDecisions: 0, advances: 0, cancelsHonoured: 0, disposed: false, actMs: [], aiMsPerDecision: [] };
  let abused = 0;
  let immediateCancel = !!o.cancel;
  for (let step = 0; step < (o.maxSteps ?? 4000); step++) {
    const snap = session.snapshot!;
    if (snap.game.status === "over") break;
    check(session.status !== "interrupted", `the scripted match was interrupted: ${session.interruption}`);
    if (humanAsked(snap)) {
      if (o.abuse && abused < 2) {
        await abuseAt(session, raw, o, checks);
        abused++;
        result.humanMoves++;
        continue;
      }
      const t0 = clock();
      const r = await session.act(humanPick(snap), snap.game.revision, o.nextId());
      result.actMs.push(clock() - t0);
      check(r.error === null, `move at revision ${snap.game.revision} accepted (${r.error})`);
      result.humanMoves++;
      continue;
    }
    // The computer's turn.
    const from = session.revision;
    if (o.disposeAt !== undefined && !result.disposed && from >= o.disposeAt && o.resume) {
      const running = session.advanceRaw();
      await new Promise<void>((resolve) => { lastFirstSnapshot = resolve; });
      const committed = session.revision;
      await session.dispose();
      const answer = await running;
      check(!answer.ok && answer.code === "disposed", `the disposed advance is answered as disposed locally (${answer.ok ? "ok" : answer.code})`);
      const after = await session.read();
      check(!after.ok && after.code === "disposed", "a disposed session reads nothing");
      handle.stop();
      session = await o.resume(o.port);
      check(session.revision >= committed, `the resumed match is at least where the board was (${session.revision} >= ${committed})`);
      handle = watch(session);
      result.disposed = true;
      checks.push(`disposed during an advance at revision ${committed}, resumed at ${session.revision}`);
      continue;
    }
    if (immediateCancel) {
      immediateCancel = false;
      const running = session.advanceRaw();
      const cancelled = await session.cancel();
      const answer = await running;
      if (cancelled) {
        check(!answer.ok && answer.code === "cancelled", `an advance cancelled at once is answered as cancelled (${answer.ok ? "ok" : answer.code})`);
        result.cancelsHonoured++;
      }
      const now = await session.read();
      check(now.ok && now.revision === session.revision, "after a cancel the board is the worker's");
      checks.push(`advance cancelled at once: ${cancelled ? "dropped" : "finished first"} at revision ${session.revision}`);
      await o.unchanged?.("immediate cancel", session);
      continue;
    }
    const t0 = clock();
    if (o.cancel) lastFirstSnapshot = () => { void session.cancel().then((c) => { if (c) result.cancelsHonoured++; }); };
    const answer = await session.advanceRaw();
    lastFirstSnapshot = null;
    const ms = clock() - t0;
    result.advances++;
    const decided = session.revision - from;
    if (decided > 0) { result.aiDecisions += decided; result.aiMsPerDecision.push(ms / decided); }
    if (!answer.ok) {
      check(answer.code === "cancelled" && o.cancel, `advance refused: ${answer.code} ${answer.message}`);
      const now = await session.read();
      check(now.ok && now.revision === session.revision, "after a cancelled advance the board is the worker's");
      await o.unchanged?.("cancelled advance", session);
      continue;
    }
    check(decided > 0 || answer.stopped !== "limit", "an advance that stops on its bound decided something");
  }
  handle.stop();
  return { ...result, final: session.snapshot!, session, first: session0, watched, checks };
}
