/**
 * #654, TEST-ONLY: what `scripts/arena-local-ownership-browser.mts` runs inside each of its tabs. Each
 * export is a step the harness calls in one tab or the other; the harness closes tabs, freezes them
 * (DevTools page lifecycle) and compares every board with its Node reference.
 *
 * The supervisor (`src/lib/arena/local/recovery.ts`) runs on real module Workers
 * (`./arena-local-ownership-worker.ts`: the real host and store, plus a fault switch), the origin's
 * real IndexedDB, Web Locks and BroadcastChannel.
 */
import type { LocalMatchSupervisor } from "../../src/lib/arena/local/recovery";
import { MatchOwnership, ownershipContext, readLease, LOCK_PREFIX } from "../../src/lib/arena/local/ownership";
import { indexedDbJournalStore } from "../../src/lib/arena/local/storage";
import { replayHash } from "../../src/lib/arena/replay-core";
import { aiAsked, humanAsked, humanPick, openSupervised, requestIds, supLoop, until } from "./arena-local-ownership-driver";

const PROOF = "/scripts/verify/arena-local-ownership-worker.ts";
// A fresh id stream per page load: a reloaded or second tab must not reuse a request id the saved receipts hold.
const ids = requestIds(1 + Math.floor(Math.random() * 0x7ffffffe));
const boards: Record<number, string> = {};
const workers: Worker[] = [];
const states: string[] = [];
let sup: LocalMatchSupervisor | null = null;

const record = async (s: { game: { revision: number } }) => { boards[s.game.revision] = await replayHash(s); };
function spawn() {
  const w = new Worker(PROOF, { type: "module" });
  workers.push(w);
  return w as Worker & { terminate(): void };
}
const current = () => workers[workers.length - 1];
const view = async () => {
  const s = sup!;
  if (s.snapshot) await record(s.snapshot);
  return { state: s.state, revision: s.snapshot?.game.revision ?? 0, board: s.snapshot ? await replayHash(s.snapshot) : null };
};
const proofMessage = (w: Worker, type: string) => new Promise<Record<string, unknown>>((resolve) => {
  const l = (e: MessageEvent) => { if (e.data && e.data.__proof === type) { w.removeEventListener("message", l); resolve(e.data); } };
  w.addEventListener("message", l);
});

export interface OpenOptions { lease?: boolean; hungMs?: number; ttlMs?: number; heartbeatMs?: number }

/** Open the match in this tab (start or resume): owner or watching. */
export async function open(pack: unknown, matchId: string, start: boolean, o: OpenOptions = {}) {
  sup = await openSupervised(pack, matchId, start, spawn, {
    hungMs: o.hungMs ?? 4000,
    openMs: 60000,
    pingMs: 1000,
    onState: (s) => { states.push(`${s.kind}${s.detail ? `: ${s.detail}` : ""}`); },
    ownership: o.lease ? { locks: null, ttlMs: o.ttlMs ?? 1500, heartbeatMs: o.heartbeatMs ?? 300 } : { heartbeatMs: o.heartbeatMs ?? 500 },
  });
  return view();
}

export function info() {
  return view();
}

/** Play until the board's revision is at least `min` and it is `kind`'s turn. */
export async function playTo(min: number, kind: "human" | "ai" | "any") {
  await supLoop(sup!, { nextId: ids, onBoard: record, stop: (s) => s.snapshot!.game.revision >= min && (kind === "any" || (kind === "human" ? humanAsked(s.snapshot!) : aiAsked(s.snapshot!))) });
  return view();
}

export async function playToEnd() {
  const r = await supLoop(sup!, { nextId: ids, onBoard: record });
  return { ...(await view()), result: r };
}

/** Try one move on the board shown: the answer's code. */
export async function tryMove() {
  const snap = sup!.snapshot!;
  const a = humanAsked(snap) ? await sup!.actRaw(humanPick(snap), snap.game.revision, ids()) : await sup!.advanceRaw(2);
  return { ok: a.ok, code: a.ok ? null : a.code, message: a.ok ? null : a.message, revision: sup!.snapshot!.game.revision };
}

let advancing: Promise<{ ok: boolean; code: string | null }> | null = null;
/** Start a long AI advance and return at once (the race with another tab's takeover). */
export function startAdvance(max: number) {
  advancing = sup!.advanceRaw(max).then((a) => ({ ok: a.ok, code: a.ok ? null : a.code }));
  return true;
}
export async function awaitAdvance() {
  const r = await advancing!;
  return { ...r, ...(await view()) };
}

export async function takeOver() {
  await sup!.takeOver();
  return view();
}

export async function waitFor(kind: string, minRevision = 0, ms = 30000) {
  const ok = await until(() => sup!.state.kind === kind && (sup!.snapshot?.game.revision ?? 0) >= minRevision, ms, 25);
  return { ok, ...(await view()) };
}

/**
 * Kill the worker in the middle of a request: `hold` (before its commit is persisted, the commit's
 * transaction open) or `after` (persisted, unanswered). The supervisor must notice, restart, resume
 * and answer. `kind` picks the request: the human's move or an AI batch.
 */
export async function killDuring(fault: "hold" | "after", kind: "human" | "ai") {
  const s = sup!;
  const w = current();
  const at = s.snapshot!.game.revision;
  const board = await replayHash(s.snapshot);
  const restarts = s.state.totalRestarts;
  const armed = proofMessage(w, "armed");
  w.postMessage({ __proof: "arm", fault });
  await armed;
  const signal = proofMessage(w, fault === "hold" ? "holding" : "persisted");
  const requestId = ids();
  const asking = kind === "human" ? s.actRaw(humanPick(s.snapshot!), at, requestId) : s.advanceRaw(2);
  const sig = await signal;
  w.terminate(); // the worker dies here
  const answer = await asking;
  return {
    at, boardBefore: board, signal: sig, ok: answer.ok, code: answer.ok ? null : answer.code, duplicate: answer.ok ? !!answer.duplicate : false,
    restarts: s.state.totalRestarts - restarts, workers: workers.length, ...(await view()), requestId,
  };
}

/** Claim a fresh match at the same instant as another tab: the harness passes the same `goAt` to both. */
export async function claimAt(matchId: string, goAt: number, lease: boolean) {
  await new Promise((r) => setTimeout(r, Math.max(0, goAt - Date.now())));
  const ctx = ownershipContext(matchId, lease ? { locks: null, broadcast: null } : { broadcast: null });
  const got = await MatchOwnership.tryAcquire(ctx);
  if (got.ok) {
    const epoch = got.ownership.fence.epoch;
    // Hold it a moment so the other tab's claim cannot come after a release.
    setTimeout(() => { void got.ownership.release(); }, 1500);
    return { ok: true, epoch, mode: ctx.mode };
  }
  return { ok: false, holder: got.held?.holder ?? null, via: got.via, mode: ctx.mode };
}

export async function locks(matchId: string) {
  const q = await navigator.locks.query();
  const mine = (l: { name?: string }) => l.name === LOCK_PREFIX + matchId;
  return { held: (q.held ?? []).filter(mine).length, pending: (q.pending ?? []).filter(mine).length };
}

/** The match's history as the device holds it: the decisions in order (no request ids). */
export async function device(matchId: string) {
  const store = indexedDbJournalStore();
  try {
    const j = await store.get(matchId);
    return j ? { revision: j.entries.length + 1, decisions: j.entries.map((e) => (e.kind === "ai" ? e.id : JSON.stringify(e.action))), trace: j.trace, humanIds: j.entries.filter((e) => e.kind === "human").map((e) => (e as { requestId: string }).requestId) } : null;
  } finally { store.close(); }
}

export async function dispose(matchId: string) {
  const s = sup!;
  await s.dispose();
  const lease = await readLease(matchId);
  // Locks are let go asynchronously.
  let l = await locks(matchId);
  for (let i = 0; i < 50 && l.held + l.pending > 0; i++) { await new Promise((r) => setTimeout(r, 20)); l = await locks(matchId); }
  return { resources: s.resources(), state: s.state.kind, lease, locks: l };
}

export function seen() {
  return { boards, states };
}
