/**
 * #654 (plan O3-04): one writer per local match, and recovery of an interrupted worker — the Node half.
 *
 * Everything real but the browser: the supervisor (`src/lib/arena/local/recovery.ts`), the
 * ownership module (`ownership.ts`), the host (`worker.ts`), the IndexedDB store (`storage.ts`) on
 * the FAKE IndexedDB of #653 (`fake-indexeddb.ts`, which serialises overlapping transactions as
 * IndexedDB does), Node's own Web Locks (`navigator.locks`) and `BroadcastChannel`. A "worker" is
 * the host behind an in-process port that can be killed (nothing more is delivered either way and
 * its store connection closes), hung (a commit that never ends) or killed just before or just after
 * a commit is persisted. A "tab" is a supervisor with its own holder id and its own connections to
 * the one shared database. Every board any tab sees is compared with an in-memory reference game.
 *
 *   1. Racing writers: claims made at once — five tabs, both with Web Locks and with the lease
 *      alone — grant exactly one. Two workers resumed at the same revision, one under a superseded
 *      fence, race the same human move and the same AI turn: exactly one revision is accepted, the
 *      other refused as `busy-elsewhere`, the device holds one linear history.
 *   2. A second tab watches: `busy-elsewhere`, a read-only board that follows the holder's commits,
 *      its moves refused, nothing written. The holder vanishes (a closed or crashed tab): with Web
 *      Locks the watcher takes over at once, without them once the lease ages; either way it resumes
 *      the identical board and plays on to the reference's end.
 *   3. A suspended owner cannot overwrite a newer one: a frozen tab's lease ages, another takes it
 *      over and plays; the frozen tab wakes, its next move is refused (`busy-elsewhere`), it becomes
 *      a watcher of the new history, and the device holds exactly the new owner's game. An explicit
 *      "play here instead" steals a live tab's lock: the old tab is fenced at once.
 *   4. Recovery: a worker killed before and after persisting a human move, before and after
 *      persisting an AI batch, hung inside a commit, failing with an `error`, and dying while idle —
 *      each restarted and resumed at the last commit; the move is applied once (a duplicate answer
 *      when it had been committed), the AI batch recomputed; the game ends on the reference board,
 *      decision for decision, with the AI's memory and RNG where they would have been.
 *   5. Visible, cancellable, recoverable: every state change is reported; a worker that dies on every
 *      open stops as `failed` after `maxRestarts` and `retry()` recovers it; a hung open is cancelled
 *      by `stop()` and resumed by `retry()`; a full device is `storage` and recovers when space returns.
 *   6. Cleanup: `dispose()` leaves no worker, timer, channel, lock or lease held; the lease is released
 *      and another tab takes the match at once.
 *
 *   npx tsx scripts/verify/arena-local-ownership.mts      (part of `npm test`)
 *   The real-browser half (two Chrome tabs): npm run arena:local-ownership-browser
 */
import assert from "node:assert/strict";
import path from "node:path";
import { checkImportGraph, diskRead, offlinePackRule } from "../lib/import-graph.ts";
import { createLocalMatchHost, memoryJournalStore, type JournalStore, type MatchJournal } from "../../src/lib/arena/local/worker.ts";
import { indexedDbJournalStore, LEASE_RECORD_FIELDS, MIGRATIONS, OWNERS } from "../../src/lib/arena/local/storage.ts";
import { MatchOwnership, claimLease, ownershipContext, readLease, LOCK_PREFIX, type OwnershipOptions } from "../../src/lib/arena/local/ownership.ts";
import type { LocalMatchSupervisor, SpawnedWorker, SupervisorState } from "../../src/lib/arena/local/recovery.ts";
import { LocalWorkerSession } from "../../src/components/arena/session/local.ts";
import { envelope, type LocalResponse } from "../../src/lib/arena/local/protocol.ts";
import { stableJson } from "../../src/lib/arena/policy/contract.ts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { inProcessChannel } from "./arena-local-worker-channel.ts";
import { playLoop, startLoopMatch } from "./arena-local-storage-driver.ts";
import { GAME_ID, LOCAL_REVISION, aiAsked, humanAsked, humanPick, openSupervised, requestIds, supLoop, until } from "./arena-local-ownership-driver.ts";
import { stagedPack } from "./arena-local-worker-fixture.mts";
import { scriptedStart } from "./arena-local-worker-driver.ts";
import { FakeIndexedDb, asFactory } from "./fake-indexeddb.ts";

const ROOT = process.cwd();
const laps: string[] = [];
let lapT = performance.now();
const lap = (name: string) => { laps.push(`${name} ${((performance.now() - lapT) / 1000).toFixed(1)} s`); lapT = performance.now(); };
const t0 = performance.now();
const DB = "proof-654";
const fetchCalls: string[] = [];
globalThis.fetch = ((input: unknown) => { fetchCalls.push(String(input)); throw new Error("no network in this proof"); }) as typeof fetch;
const never = <T,>() => new Promise<T>(() => {});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pack = await stagedPack();
const ids = requestIds(0x654);

// ── The in-memory reference: one AI decision per advance, so it has a board at every revision ────────
const ref = new Map<number, string>();
const refCh = inProcessChannel({ store: memoryJournalStore() });
const refSession = await startLoopMatch(refCh.port, pack, "ref-654", { newRequestId: requestIds(0x6540), sessionId: "ref" });
await playLoop(refSession, { nextId: requestIds(0x6541), maxDecisions: 1, onBoard: (s) => { ref.set(s.game.revision, canonicalJson(s)); } });
const refFinal = canonicalJson(refSession.snapshot);
const refJournal: MatchJournal = refCh.host.inspect()!.journal;
await refSession.dispose();
assert.equal(refSession.snapshot!.game.status, "over", "the reference match ends");
const decided = (j: MatchJournal) => j.entries.map((e) => (e.kind === "ai" ? e.id : stableJson(e.action)));
lap("reference");
let boardsChecked = 0;
const sameBoard = (what: string) => (s: { game: { revision: number } }) => {
  boardsChecked++;
  assert.equal(canonicalJson(s), ref.get(s.game.revision), `${what}: the board at revision ${s.game.revision} is the reference's`);
};

// ── Killable in-process workers on the shared fake database ────────────────────────────────────────
type PutFault = "before" | "after" | "hang";
interface Plan {
  /** The next commit's fault (consumed). */
  next: PutFault | null;
  /** Every commit's fault while set (a worker that always dies). */
  always: PutFault | null;
  spawned: KillablePort[];
}
type KillablePort = SpawnedWorker & { dead: boolean; host: ReturnType<typeof createLocalMatchHost>; fireError(message: string): void };
const newPlan = (): Plan => ({ next: null, always: null, spawned: [] });

function spawner(fake: FakeIndexedDb, plan: Plan): () => SpawnedWorker {
  return () => {
    const listeners: { message: ((e: { data: unknown }) => void)[]; error: ((e: { message?: string }) => void)[] } = { message: [], error: [] };
    const inner = indexedDbJournalStore({ factory: asFactory(fake), name: DB });
    let dead = false;
    const kill = () => { dead = true; port.dead = true; inner.close(); };
    const store: JournalStore = {
      get: (id) => (dead ? never() : inner.get(id)),
      put: async (journal, fence) => {
        if (dead) return never();
        const fault = plan.always ?? plan.next;
        plan.next = null;
        if (fault === "before") { kill(); return never(); }
        if (fault === "hang") return never();
        await inner.put(journal, fence);
        if (fault === "after") { kill(); return never(); }
      },
    };
    const host = createLocalMatchHost({
      store,
      yieldNow: () => (dead ? never() : new Promise<void>((r) => setTimeout(r, 0))),
      post: (m: LocalResponse) => {
        if (dead) return;
        const copy = structuredClone(m);
        setTimeout(() => { if (!dead) for (const l of listeners.message) l({ data: copy }); }, 0);
      },
    });
    const port: KillablePort = {
      dead: false,
      host,
      postMessage: (m: unknown) => {
        if (dead) return;
        const copy = structuredClone(m);
        setTimeout(() => { if (!dead) void host.handle(copy); }, 0);
      },
      addEventListener: ((type: "message" | "error", l: never) => { (listeners[type] as unknown[]).push(l); }) as SpawnedWorker["addEventListener"],
      terminate: () => kill(),
      fireError: (message: string) => { for (const l of listeners.error) l({ message }); },
    };
    host.hello();
    plan.spawned.push(port);
    return port;
  };
}

const ownershipOn = (fake: FakeIndexedDb, o: OwnershipOptions = {}): OwnershipOptions => ({ factory: asFactory(fake), name: DB, heartbeatMs: 40, ...o });
const deviceJournal = async (fake: FakeIndexedDb, matchId: string) => {
  const s = indexedDbJournalStore({ factory: asFactory(fake), name: DB });
  try { return await s.get(matchId); } finally { s.close(); }
};
const states = (sup: LocalMatchSupervisor) => { const seen: SupervisorState[] = []; sup.onState((s) => seen.push(s)); return seen; };
const clean = (sup: LocalMatchSupervisor) => {
  const r = sup.resources();
  return !r.worker && !r.session && !r.ping && r.guards === 0 && !r.waiting && !r.hints && r.ownership === null && r.watchers === 0;
};
const locksHeld = async (matchId: string) => {
  const q = await (navigator as unknown as { locks: { query(): Promise<{ held?: { name: string }[]; pending?: { name: string }[] }> } }).locks.query();
  return [...(q.held ?? []), ...(q.pending ?? [])].filter((l) => l.name === LOCK_PREFIX + matchId).length;
};
/** Locks are let go asynchronously (the holder's callback settles): poll until none is left, up to 2 s. */
const locksLeft = async (matchId: string) => {
  for (let i = 0; i < 100; i++) { const n = await locksHeld(matchId); if (n === 0) return 0; await sleep(20); }
  return locksHeld(matchId);
};
// One process runs every "tab" and "worker", so a watcher replaying the journal holds up the owner's worker:
// multi-tab scenarios get a generous silence limit; the single-tab recovery ones a short one, to be quick.
const tabs = { hungMs: 10000, openMs: 60000, pingMs: 0 };
const fast = { hungMs: 400, openMs: 20000, pingMs: 0 };

assert.equal(MIGRATIONS.length, 2, "the local database is at schema version 2: matches, decisions, and the owners store #654 adds");
assert.equal(typeof navigator.locks?.request, "function", "(Node offers Web Locks, so both coordination modes are proved here)");

// ── 1. Racing writers ──────────────────────────────────────────────────────────────────────────────
{
  const fake = new FakeIndexedDb();
  // Five claims made at once on a free match, lease alone: IndexedDB serialises them, one wins.
  const claims = await Promise.all([...Array(5).keys()].map((i) => claimLease("race-lease", `tab-${i}`, { now: 1000 }, { factory: asFactory(fake), name: DB })));
  assert.equal(claims.filter((c) => c.ok).length, 1, "five simultaneous lease claims: exactly one is granted");
  const winner = claims.find((c) => c.ok)!;
  assert.ok(winner.ok && claims.filter((c) => !c.ok).every((c) => !c.ok && c.held.holder === winner.fence.holder && c.held.epoch === 1), "the others are told who holds it (epoch 1)");
  // Five tabs at once with Web Locks.
  const claimants = await Promise.all([...Array(5).keys()].map((i) => MatchOwnership.tryAcquire(ownershipContext("race-locks", ownershipOn(fake, { holder: `tab-${i}`, broadcast: null })))));
  assert.equal(claimants.filter((t) => t.ok).length, 1, "five simultaneous Web Lock claims: exactly one tab gets the match");
  assert.ok(claimants.every((t) => t.ok || t.via === "web-lock"), "the others are refused by the lock");
  for (const t of claimants) if (t.ok) await t.ownership.release();
  assert.equal(await locksLeft("race-locks"), 0, "and the lock is let go on release");

  // Two workers at the same revision race the same human move: A under epoch 1, B under epoch 2 (B took over).
  const plan = newPlan();
  const spawn = spawner(fake, plan);
  const a = await claimLease("race-move", "tab-a", { now: 1000 }, { factory: asFactory(fake), name: DB });
  assert.ok(a.ok);
  const sa = await LocalWorkerSession.start(spawn(), { ...scriptedStart(pack, "race-move", { batch: 2 }), writer: a.fence }, { newRequestId: requestIds(0x65a), sessionId: "a" });
  await playLoop(sa, { nextId: requestIds(0x65b), stop: (x) => x.revision >= 12 && humanAsked(x.snapshot!) });
  const at = sa.revision;
  const b = await claimLease("race-move", "tab-b", { now: 1001, force: true }, { factory: asFactory(fake), name: DB });
  assert.ok(b.ok && b.fence.epoch === 2, "B took the match over at epoch 2");
  const sb = await LocalWorkerSession.resume(spawn(), { matchId: "race-move", gameId: GAME_ID, pack: structuredClone(pack), interpreterRevision: LOCAL_REVISION, batch: 2, writer: b.fence }, { newRequestId: requestIds(0x65c), sessionId: "b" });
  assert.equal(sb.revision, at, "both sit at the same revision");
  const move = humanPick(sa.snapshot!);
  const [ra, rb] = await Promise.all([sa.actRaw(move, at, requestIds(0x65d)()), sb.actRaw(move, at, requestIds(0x65e)())]);
  assert.equal([ra, rb].filter((r) => r.ok).length, 1, "the same move raced from two workers: exactly one accepted revision");
  assert.ok(rb.ok && !ra.ok && ra.code === "busy-elsewhere", `the current owner's is accepted, the superseded one's refused as busy-elsewhere (${ra.ok ? "" : ra.message})`);
  // And the same AI turn.
  await playLoop(sb, { nextId: requestIds(0x65f), stop: (x) => aiAsked(x.snapshot!) });
  const aiAt = sb.revision;
  const [aa, ab] = await Promise.all([sa.advanceRaw(2), sb.advanceRaw(2)]);
  assert.ok(ab.ok && !aa.ok && aa.code === "busy-elsewhere", "the same AI turn raced: the owner's batch committed, the superseded worker's refused");
  const saved = (await deviceJournal(fake, "race-move"))!;
  assert.equal(saved.entries.length + 1, sb.revision, "the device holds the owner's revision");
  assert.ok(sb.revision > aiAt, "(which moved on)");
  assert.equal(stableJson(saved), stableJson(plan.spawned[1].host.inspect()!.journal), "and exactly the owner's journal: one linear history");
  assert.deepEqual(decided(saved), decided(refJournal).slice(0, saved.entries.length), "which is the reference game so far");
  assert.equal(plan.spawned[0].host.inspect()!.journal.entries.length + 1, at, "the superseded worker kept nothing it was refused");
  // A superseded worker stays read-only even if the lease looks free again.
  const again = await sa.actRaw(humanPick(sa.snapshot!), at, requestIds(0x660)());
  assert.ok(!again.ok && again.code === "busy-elsewhere", "a fenced worker refuses every later move");
  // An unfenced writer (an old page) cannot commit while a writer holds the match.
  const posted: LocalResponse[] = [];
  const unfenced = createLocalMatchHost({ post: (m) => posted.push(m), store: indexedDbJournalStore({ factory: asFactory(fake), name: DB }) });
  await unfenced.handle({ ...envelope(), type: "resume", requestId: requestIds(0x661)(), sessionId: "u", matchId: "race-move", gameId: GAME_ID, pack: structuredClone(pack), interpreterRevision: LOCAL_REVISION });
  assert.ok(posted.some((m) => m.type === "error" && m.code === "busy-elsewhere"), "a resume without the writer's fence is refused while the match is held");
  await sa.dispose().catch(() => {});
  await sb.dispose();
}

lap("races");
// ── 2. A second tab watches; the holder vanishes; the watcher takes over ─────────────────────────────
for (const mode of ["web-locks", "lease"] as const) {
  const fake = new FakeIndexedDb();
  const plan = newPlan();
  const spawn = spawner(fake, plan);
  let clock = 5_000_000;
  const own = (holder: string): OwnershipOptions => ownershipOn(fake, { holder, ...(mode === "lease" ? { locks: null, now: () => clock, ttlMs: 1000 } : {}) });
  const match = `watch-${mode}`;
  const a = await openSupervised(pack, match, true, spawn, { ...tabs, ownership: own("tab-a") });
  assert.equal(a.state.kind, "owner", `${mode}: the first tab owns the match`);
  assert.equal(a.state.mode, mode);
  await supLoop(a, { nextId: ids, onBoard: sameBoard(`${mode} a`), stop: (s) => s.snapshot!.game.revision >= 10 && humanAsked(s.snapshot!) });
  const bStates: SupervisorState[] = [];
  const b = await openSupervised(pack, match, false, spawn, { ...tabs, ownership: own("tab-b"), onState: (x) => bStates.push(x) });
  assert.equal(b.state.kind, "watching", `${mode}: the second tab is watching`);
  assert.equal(b.state.code, "busy-elsewhere");
  assert.equal(b.state.holder, "tab-a", `${mode}: it names the holder`);
  assert.equal(b.state.watching, "held-elsewhere");
  assert.equal(canonicalJson(b.snapshot), canonicalJson(a.snapshot), `${mode}: and shows the saved board, read-only`);
  const before = stableJson(await deviceJournal(fake, match));
  const refused = await b.actRaw(humanPick(b.snapshot!), b.snapshot!.game.revision, ids());
  assert.ok(!refused.ok && refused.code === "busy-elsewhere", `${mode}: the watcher's move is refused as busy-elsewhere`);
  const refusedAi = await b.advanceRaw(2);
  assert.ok(!refusedAi.ok && refusedAi.code === "busy-elsewhere", `${mode}: and so is an advance`);
  assert.equal(stableJson(await deviceJournal(fake, match)), before, `${mode}: nothing was written`);
  // The holder plays on; the watcher's board follows its commits (BroadcastChannel hints).
  await supLoop(a, { nextId: ids, onBoard: sameBoard(`${mode} a`), stop: (s) => s.snapshot!.game.revision >= 22 && humanAsked(s.snapshot!) });
  assert.ok(await until(() => b.snapshot!.game.revision === a.snapshot!.game.revision), `${mode}: the watcher's board follows the holder to revision ${a.snapshot!.game.revision}`);
  sameBoard(`${mode} b watching`)(b.snapshot!);
  // The holder's tab closes or crashes: no release, the lease stays as it was.
  const lastBoard = canonicalJson(a.snapshot);
  const lastRevision = a.snapshot!.game.revision;
  const aEpoch = a.state.fence!.epoch;
  a.vanish();
  if (mode === "lease") {
    await sleep(150);
    assert.equal(b.state.kind, "watching", "lease: while the vanished holder's lease is fresh, the watcher waits");
    clock += 1001;
  }
  assert.ok(await until(() => b.state.kind === "owner"), `${mode}: the watcher takes over (${b.state.kind} ${b.state.detail})`);
  assert.ok(b.state.fence!.epoch > aEpoch, `${mode}: under a new epoch (${b.state.fence!.epoch} after ${aEpoch})`);
  assert.equal(canonicalJson(b.snapshot), lastBoard, `${mode}: and resumes the identical board at revision ${lastRevision}`);
  assert.ok(bStates.some((s) => s.kind === "watching") && bStates.at(-1)!.kind === "owner", `${mode}: watching → owner was reported`);
  if (mode === "web-locks") {
    // Played to the end once (the lease mode resumes the same board and plays on a few moves; the game after that is the same code).
    assert.equal(await supLoop(b, { nextId: ids, onBoard: sameBoard(`${mode} b`) }), "over");
    assert.equal(canonicalJson(b.snapshot), refFinal, `${mode}: played to the end — the reference's final board`);
    const saved = (await deviceJournal(fake, match))!;
    assert.deepEqual(decided(saved), decided(refJournal), `${mode}: the device holds the reference game, decision for decision`);
    assert.equal(saved.trace, refJournal.trace);
    assert.equal(stableJson(saved.aiMemory), stableJson(refJournal.aiMemory), `${mode}: the AI's memory and RNG end where they would have`);
  } else {
    await supLoop(b, { nextId: ids, onBoard: sameBoard(`${mode} b`), stop: (s) => s.snapshot!.game.revision >= lastRevision + 8 });
    const saved = (await deviceJournal(fake, match))!;
    assert.deepEqual(decided(saved), decided(refJournal).slice(0, saved.entries.length), `${mode}: the device holds the reference game so far`);
  }
  await b.dispose();
  assert.ok(clean(b), `${mode}: dispose leaves nothing held (${JSON.stringify(b.resources())})`);
  const lease = await readLease(match, { factory: asFactory(fake), name: DB });
  assert.ok(lease?.released && lease.holder === "tab-b", `${mode}: the lease is released`);
  if (mode === "web-locks") assert.equal(await locksLeft(match), 0, "web-locks: no lock held or pending");
}

lap("watch+vanish");
// ── 3. A suspended owner cannot overwrite the new one; "play here instead" ───────────────────────────
{
  const fake = new FakeIndexedDb();
  const plan = newPlan();
  const spawn = spawner(fake, plan);
  let clock = 9_000_000;
  const own = (holder: string): OwnershipOptions => ownershipOn(fake, { holder, locks: null, now: () => clock, ttlMs: 1000 });
  const a = await openSupervised(pack, "frozen", true, spawn, { ...tabs, ownership: own("tab-a") });
  await supLoop(a, { nextId: ids, onBoard: sameBoard("frozen a"), stop: (s) => s.snapshot!.game.revision >= 14 && humanAsked(s.snapshot!) });
  const aBoard = a.snapshot!;
  const b = await openSupervised(pack, "frozen", false, spawn, { ...tabs, ownership: own("tab-b") });
  assert.equal(b.state.kind, "watching");
  a.freeze(); // suspended: no heartbeat, no ping; it keeps its worker and its belief that it owns the match
  clock += 1001;
  assert.ok(await until(() => b.state.kind === "owner"), "the frozen tab's lease aged and the other tab took over");
  await supLoop(b, { nextId: ids, onBoard: sameBoard("frozen b"), stop: (s) => s.snapshot!.game.revision >= aBoard.game.revision + 8 && humanAsked(s.snapshot!) });
  const newHistory = stableJson(await deviceJournal(fake, "frozen"));
  // The frozen tab wakes and acts on the board it was showing.
  assert.equal(a.state.kind, "owner", "(the frozen tab still believes it owns the match)");
  const late = await a.actRaw(humanPick(aBoard), aBoard.game.revision, ids());
  assert.ok(!late.ok && late.code === "busy-elsewhere", `the woken tab's move is refused as busy-elsewhere (${late.ok ? "" : late.message})`);
  assert.equal(stableJson(await deviceJournal(fake, "frozen")), newHistory, "the device still holds exactly the new owner's history");
  assert.ok(await until(() => a.state.kind === "watching" && a.snapshot!.game.revision === b.snapshot!.game.revision), "the woken tab becomes a watcher of the new history");
  assert.equal(a.state.watching, "taken-over");
  sameBoard("woken a")(a.snapshot!);
  // The woken tab chooses to play here instead: it takes the match back; B is fenced from its next commit.
  const taken = await a.takeOver();
  assert.equal(taken.kind, "owner", "takeOver: the woken tab plays here instead");
  const bLate = await b.actRaw(humanPick(b.snapshot!), b.snapshot!.game.revision, ids());
  assert.ok(!bLate.ok && bLate.code === "busy-elsewhere", "the tab it was taken from is refused as busy-elsewhere");
  assert.ok(await until(() => b.state.kind === "watching"), "and becomes a watcher");
  await b.dispose(); // (a watcher refreshes its view on every commit; the rest of this game needs none)
  assert.equal(await supLoop(a, { nextId: ids, onBoard: sameBoard("taken back") }), "over");
  assert.equal(canonicalJson(a.snapshot), refFinal, "the game ends on the reference board");
  assert.deepEqual(decided((await deviceJournal(fake, "frozen"))!), decided(refJournal), "one linear history, the reference's");
  await a.dispose();
  await b.dispose();
  assert.ok(clean(a) && clean(b), "both tabs disposed clean");
}
lap("frozen lease");
{
  // With Web Locks a frozen holder keeps its lock: the other tab stays a watcher (no split), and an explicit takeover steals it.
  const fake = new FakeIndexedDb();
  const plan = newPlan();
  const spawn = spawner(fake, plan);
  const a = await openSupervised(pack, "steal", true, spawn, { ...tabs, ownership: ownershipOn(fake, { holder: "tab-a" }) });
  await supLoop(a, { nextId: ids, onBoard: sameBoard("steal a"), stop: (s) => s.snapshot!.game.revision >= 8 && humanAsked(s.snapshot!) });
  const b = await openSupervised(pack, "steal", false, spawn, { ...tabs, ownership: ownershipOn(fake, { holder: "tab-b" }) });
  a.freeze();
  await sleep(200);
  assert.equal(b.state.kind, "watching", "web-locks: a frozen holder keeps its lock; the other tab keeps watching");
  assert.equal((await b.takeOver()).kind, "owner", "web-locks: takeOver steals the lock and the lease");
  assert.ok(await until(() => a.state.kind === "watching"), "the holder whose lock was stolen learns it and watches");
  const late = await a.actRaw(humanPick(a.snapshot!), a.snapshot!.game.revision, ids());
  assert.ok(!late.ok && late.code === "busy-elsewhere", "and its moves are refused");
  await a.dispose();
  await b.dispose();
  assert.equal(await locksLeft("steal"), 0, "no lock left");
}

lap("steal");
// ── 4 and 5. Recovery: killed, hung, failing, idle; visible, cancellable, recoverable ───────────────
{
  const fake = new FakeIndexedDb();
  const plan = newPlan();
  const spawn = spawner(fake, plan);
  const sup = await openSupervised(pack, "recover", true, spawn, { ...fast, ownership: ownershipOn(fake, { holder: "tab-r" }) });
  const seen = states(sup);
  const check = (s: { game: { revision: number } }) => sameBoard("recovery")(s);
  const toHuman = (min: number) => supLoop(sup, { nextId: ids, onBoard: check, stop: (s) => s.snapshot!.game.revision >= min && humanAsked(s.snapshot!) });
  const toAi = (min: number) => supLoop(sup, { nextId: ids, onBoard: check, stop: (s) => s.snapshot!.game.revision >= min && aiAsked(s.snapshot!) });
  const report: string[] = [];

  // A human move, the worker killed before its commit is persisted: restarted, resumed at basedOn, sent again — applied once.
  for (const fault of ["before", "after"] as const) {
    await toHuman(fault === "before" ? 6 : 12);
    const at = sup.snapshot!.game.revision;
    const restartsBefore = sup.state.totalRestarts;
    plan.next = fault;
    const id = ids();
    const answer = await sup.actRaw(humanPick(sup.snapshot!), at, id);
    assert.ok(answer.ok, `a human move with the worker killed ${fault} persisting it: answered (${answer.ok ? "" : answer.message})`);
    assert.equal(sup.state.totalRestarts, restartsBefore + 1, `${fault}: one restart`);
    assert.equal(answer.revision, at + 1, `${fault}: one revision further`);
    assert.equal(!!answer.duplicate, fault === "after", fault === "after" ? "after: answered from its journalled receipt (a duplicate, nothing played twice)" : "before: played once, on the new worker");
    const j = (await deviceJournal(fake, "recover"))!;
    assert.equal(j.entries.filter((e) => e.kind === "human" && e.requestId === id).length, 1, `${fault}: the move is on the device exactly once`);
    check(sup.snapshot!);
    report.push(`human move killed ${fault} persisting`);
  }
  // An AI batch, the worker killed before and after its commit is persisted: the batch is computed again.
  for (const fault of ["before", "after"] as const) {
    await toAi(fault === "before" ? 18 : 26);
    const at = sup.snapshot!.game.revision;
    plan.next = fault;
    const answer = await sup.advanceRaw(2);
    assert.ok(answer.ok, `an AI batch with the worker killed ${fault} persisting it: answered`);
    assert.ok(sup.snapshot!.game.revision > at, `${fault}: the AI moved on`);
    check(sup.snapshot!);
    report.push(`AI batch killed ${fault} persisting`);
  }
  // Hung inside a commit (alive, silent): the watchdog declares it hung after hungMs and restarts it.
  await toAi(32);
  plan.next = "hang";
  const hungAt = Date.now();
  assert.ok((await sup.advanceRaw(2)).ok, "a worker hung inside an AI commit: restarted and answered");
  assert.ok(Date.now() - hungAt >= fast.hungMs, "(after the watchdog's silence limit)");
  assert.ok(seen.some((s) => s.kind === "recovering" && /did not answer/.test(s.detail ?? "")), "reported as recovering: the worker did not answer");
  report.push("hung inside a commit");
  // A worker `error` event: restarted at once.
  await toHuman(36);
  {
    const at = sup.snapshot!.game.revision;
    const port = plan.spawned.at(-1)!;
    const pending = sup.actRaw(humanPick(sup.snapshot!), at, ids());
    port.fireError("boom");
    port.terminate();
    const r = await pending;
    assert.ok(r.ok, "a worker that fails with an error event mid-move: restarted, the move answered");
    assert.ok(seen.some((s) => s.kind === "recovering" && /boom/.test(s.detail ?? "")), "reported with the worker's error");
    report.push("error event");
  }
  // Every state change was visible.
  assert.ok(seen.filter((s) => s.kind === "recovering").length >= 6, `each restart was reported as recovering (${seen.filter((s) => s.kind === "recovering").length})`);
  assert.ok(seen.every((s, i) => s.kind !== "recovering" || seen.slice(i + 1).some((x) => x.kind === "owner")), "and each was followed by owner again");

  // A device out of space: refused as storage, visible, and recoverable once there is space.
  await toHuman(40);
  {
    const at = sup.snapshot!.game.revision;
    fake.quotaBytes = fake.usedBytes() + 8;
    const r = await sup.actRaw(humanPick(sup.snapshot!), at, ids());
    assert.ok(!r.ok && r.code === "storage", "a full device: the move is refused as storage");
    assert.equal(sup.state.kind, "storage", "the supervisor shows the storage state");
    assert.equal(sup.snapshot!.game.revision, at, "and the board stays at the last commit");
    fake.quotaBytes = null;
    assert.equal((await sup.retry()).kind, "owner", "retry() after space returns: owner again");
    report.push("full device");
  }
  // The rest of the game, then compare.
  assert.equal(await supLoop(sup, { nextId: ids, onBoard: check }), "over");
  assert.equal(canonicalJson(sup.snapshot), refFinal, "after every kill, hang, error and refusal: the reference's final board");
  const saved = (await deviceJournal(fake, "recover"))!;
  assert.deepEqual(decided(saved), decided(refJournal), "decision for decision the reference game: no move duplicated or lost");
  assert.equal(saved.trace, refJournal.trace, "the same trace");
  assert.equal(stableJson(saved.aiMemory), stableJson(refJournal.aiMemory), "the AI's memory and RNG where they would have been (no RNG drift)");
  assert.equal(saved.entries.filter((e) => e.kind === "human").length, refJournal.entries.filter((e) => e.kind === "human").length, "as many human moves as the reference");
  await sup.dispose();
  assert.ok(clean(sup), "disposed clean");
  console.log(`  recovery: ${report.join(", ")}; ${sup.state.totalRestarts} restarts in all`);
}
lap("recovery");
{
  // Idle death found by the ping; a worker that dies on every open fails after maxRestarts and retry() recovers it; stop() cancels a hung open.
  const fake = new FakeIndexedDb();
  const plan = newPlan();
  const spawn = spawner(fake, plan);
  const sup = await openSupervised(pack, "idle", true, spawn, { hungMs: 300, openMs: 400, pingMs: 50, maxRestarts: 2, ownership: ownershipOn(fake, { holder: "tab-i" }) });
  const seen = states(sup);
  await supLoop(sup, { nextId: ids, onBoard: sameBoard("idle"), stop: (s) => s.snapshot!.game.revision >= 6 && humanAsked(s.snapshot!) });
  const board = canonicalJson(sup.snapshot);
  plan.spawned.at(-1)!.terminate();
  assert.ok(await until(() => seen.some((s) => s.kind === "recovering") && sup.state.kind === "owner"), "a worker that dies while idle: the ping finds it and it is restarted");
  assert.equal(canonicalJson(sup.snapshot), board, "at the same board");
  // Every open dies.
  plan.always = "before";
  plan.spawned.at(-1)!.terminate();
  assert.ok(await until(() => sup.state.kind === "failed"), `a worker that dies on every open: failed after maxRestarts (${sup.state.kind})`);
  assert.match(sup.state.detail ?? "", /stopped 2 time\(s\) in a row.*last saved move/, "named, with the match safe at its last saved move");
  const refusedWhileFailed = await sup.actRaw(humanPick(sup.snapshot!), sup.snapshot!.game.revision, ids());
  assert.ok(!refusedWhileFailed.ok, "moves are refused while failed");
  plan.always = null;
  assert.equal((await sup.retry()).kind, "owner", "retry(): recovered");
  assert.equal(canonicalJson(sup.snapshot), board, "at the same board");
  // A hung open, cancelled by stop(), resumed by retry().
  plan.always = "hang";
  plan.spawned.at(-1)!.terminate();
  assert.ok(await until(() => sup.state.kind === "recovering"), "(recovering)");
  await sup.stop();
  assert.equal(sup.state.kind, "stopped", "stop() cancels the recovery: stopped");
  assert.ok(!sup.resources().worker && !sup.resources().ping, "with no worker left running");
  plan.always = null;
  assert.equal((await sup.retry()).kind, "owner", "retry() after stop(): owner again");
  assert.equal(canonicalJson(sup.snapshot), board, "at the same board");
  await supLoop(sup, { nextId: ids, onBoard: sameBoard("idle"), stop: (s) => s.snapshot!.game.revision >= 16 });
  assert.deepEqual(decided((await deviceJournal(fake, "idle"))!), decided(refJournal).slice(0, sup.snapshot!.game.revision - 1), "and plays on: the reference game");
  await sup.dispose();
  assert.ok(clean(sup), "disposed clean");
  assert.equal(await locksLeft("idle"), 0, "no lock left");
}
lap("idle/failed/stop");
{
  // Reload during a choice and during an AI turn: dispose, open again — the identical board and the same game.
  const fake = new FakeIndexedDb();
  const spawn = spawner(fake, newPlan());
  let sup = await openSupervised(pack, "reload", true, spawn, { ...fast, ownership: ownershipOn(fake, { holder: "tab-1" }) });
  for (const [min, want] of [[10, humanAsked], [20, aiAsked]] as const) {
    await supLoop(sup, { nextId: ids, onBoard: sameBoard("reload"), stop: (s) => s.snapshot!.game.revision >= min && want(s.snapshot!) });
    const board = canonicalJson(sup.snapshot);
    await sup.dispose();
    assert.ok(clean(sup));
    sup = await openSupervised(pack, "reload", false, spawn, { ...fast, ownership: ownershipOn(fake, { holder: `tab-${min}` }) });
    assert.equal(sup.state.kind, "owner", "a reloaded tab takes the released match at once");
    assert.equal(canonicalJson(sup.snapshot), board, `reloaded during ${want === humanAsked ? "a choice" : "an AI turn"}: the identical board`);
  }
  await supLoop(sup, { nextId: ids, onBoard: sameBoard("reload"), stop: (s) => s.snapshot!.game.revision >= 28 });
  await sup.dispose();
}

lap("reload");
// ── 6. What is stored for ownership, and the boundary ─────────────────────────────────────────────────
{
  const fake = new FakeIndexedDb();
  const o = await MatchOwnership.tryAcquire(ownershipContext("stored", ownershipOn(fake, { holder: "tab-s", broadcast: null, locks: null })));
  assert.ok(o.ok);
  const rows = [...fake.rows(DB, OWNERS).values()] as Record<string, unknown>[];
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]).sort(), [...LEASE_RECORD_FIELDS].sort(), "a lease record has exactly its fields: no account, no board");
  assert.ok(o.ok && o.ownership.resources().timer, "(a heartbeat runs while held)");
  if (o.ok) await o.ownership.release();
  assert.ok(o.ok && !o.ownership.resources().timer && !o.ownership.resources().channel, "release stops the heartbeat");
  for (const file of ["src/lib/arena/local/ownership.ts", "src/lib/arena/local/recovery.ts"]) {
    const g = checkImportGraph(path.join(ROOT, file), ROOT, diskRead, { forbidFile: offlinePackRule });
    assert.deepEqual(g.violations, [], `${file} reaches no database, provider, Node builtin or network module`);
    assert.ok(!g.files.some((f) => /src\/lib\/arena\/(browser|vm|policy\/(main|combat|choices|boundary))/.test(f)), `${file} loads no engine or policy`);
  }
  assert.deepEqual(fetchCalls, [], "no network call was made");
}

console.log(`arena-local-ownership: ok — one writer per match (Web Locks and the lease fallback, races, watchers, takeovers, a frozen owner fenced), worker recovery (killed before/after persistence of a move and an AI batch, hung, error, idle; failed/stopped/storage recovered), ${boardsChecked} boards equal to the reference; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(`  sections: ${laps.join(", ")}`);
console.log("  the real-browser half (two tabs): npm run arena:local-ownership-browser");
