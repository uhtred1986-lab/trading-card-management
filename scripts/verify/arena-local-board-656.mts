/**
 * #656 (plan O3-05): the existing board on a local match — start, resume and finish.
 *
 * `LocalBoard` (`src/components/arena/session/local-board.ts`) is the `ArenaSession` the board gets
 * for a local match. Here it runs over everything real but the browser: the supervisor (#654), the
 * host (#652), the IndexedDB store (#653) on the fake IndexedDB, Node's Web Locks. The "board" is the
 * loop `ArenaStage` runs: watch the snapshots, answer the human's question with `act`, otherwise call
 * `advance`. The pack is the audited SD15/SD5 pair staged to qualify, as `arena-offline-pack.mts`
 * constructs it; since #757 resolved U1 the audited pack qualifies too and equals it.
 *
 *   1. The pack gate: the audited pack as built today qualifies; an unplayable one (the owner's Unison
 *      costs withheld) is refused with its reason named, before a worker is spent; a non-pack, an unknown deck, and a resume with another pack are refused too.
 *   2. Either seat, start to finish: a match started as p1 and one as p2 each play to the end through
 *      the board's session; "no match API or provider": `fetch` is never called. The p1 match is
 *      reloaded half way (the supervisor and its worker are dropped, a new page resumes from the
 *      journal) and continues on the identical board; the end result equals an uninterrupted run.
 *   3. Privacy: every snapshot the board is handed contains no card id the seat may not read, and
 *      no seed, journal, AI memory or receipt field.
 *   4. Finish and rematch: the terminal board is `over`; "Play again" opens a new match (new id) of the
 *      same pack, decks and seat, closes the old, and whatever the old worker still says never reaches
 *      the new board. The pointer follows the new match.
 *   5. Stale and refused moves: a stale revision, an out-of-turn move and a duplicate leave the
 *      journal as it was; the stale one refreshes the board.
 *   6. Failure and recovery shown to the player: a full device is `storage` with a retry that works,
 *      a second tab is read-only (`watching`) with "Play here instead", a worker that dies is restarted
 *      and the match goes on; each state has its notice (`describeBoard`), including none while all is well.
 *   7. Capabilities: only advance and rematch; no abandon, flag, plan, skin, staging or report.
 *   8. Boundary: the board module's import graph reaches no engine, database, server action or
 *      network; the page component does not call `fetch`.
 *
 *   npx tsx scripts/verify/arena-local-board-656.mts      (part of `npm test`)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { checkImportGraph, diskRead } from "../lib/import-graph.ts";
import { LocalBoard, LocalBoardError, browserPointerStore, describeBoard, memoryPointerStore, readPack, type LocalBoardDeps, type LocalPointer, type PointerStore } from "../../src/components/arena/session/local-board.ts";
import { createLocalMatchHost } from "../../src/lib/arena/local/worker.ts";
import { indexedDbJournalStore } from "../../src/lib/arena/local/storage.ts";
import type { SpawnedWorker } from "../../src/lib/arena/local/recovery.ts";
import type { LocalResponse } from "../../src/lib/arena/local/protocol.ts";
import type { Snapshot } from "../../src/lib/arena/snapshot-core.ts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { stableJson } from "../../src/lib/arena/policy/contract.ts";
import { hiddenFrom, strings } from "./arena-policy-permute.ts";
import { humanAsked, humanPick } from "./arena-local-storage-driver.ts";
import { auditPack, stagedPack, withheldCostsPack } from "./arena-local-worker-fixture.mts";
import { FakeIndexedDb, asFactory } from "./fake-indexeddb.ts";

const ROOT = process.cwd();
const DB = "proof-656";
const t0 = performance.now();
const fetchCalls: string[] = [];
globalThis.fetch = ((input: unknown) => { fetchCalls.push(String(input)); throw new Error("no network in this proof"); }) as typeof fetch;

const pack = await stagedPack();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const ids = (() => { let n = 0; return () => `00000656-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`; })();

// ── Killable in-process workers on one fake database, remembering their hosts for the leak audit ──
interface Spawned { port: SpawnedWorker; host: ReturnType<typeof createLocalMatchHost>; kill(): void; dead: () => boolean }
function world() {
  const fake = new FakeIndexedDb();
  const spawned: Spawned[] = [];
  const spawn = (): SpawnedWorker => {
    const listeners: { message: ((e: { data: unknown }) => void)[]; error: ((e: { message?: string }) => void)[] } = { message: [], error: [] };
    const store = indexedDbJournalStore({ factory: asFactory(fake), name: DB });
    let dead = false;
    const host = createLocalMatchHost({
      store,
      yieldNow: () => new Promise<void>((r) => setTimeout(r, 0)),
      post: (m: LocalResponse) => { if (dead) return; const copy = structuredClone(m); setTimeout(() => { if (!dead) for (const l of listeners.message) l({ data: copy }); }, 0); },
    });
    const port: SpawnedWorker = {
      postMessage: (m: unknown) => { if (dead) return; const copy = structuredClone(m); setTimeout(() => { if (!dead) void host.handle(copy); }, 0); },
      addEventListener: ((type: "message" | "error", l: never) => { (listeners[type] as unknown[]).push(l); }) as SpawnedWorker["addEventListener"],
      terminate: () => { dead = true; store.close(); },
    };
    host.hello();
    spawned.push({ port, host, kill: () => {
      port.terminate();
      for (const listener of listeners.error) listener({ message: "injected worker death" });
    }, dead: () => dead });
    return port;
  };
  return { fake, spawn, spawned };
}

const fixedRandom = (seed: number) => { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0x100000000; }; };
const depsOn = (w: ReturnType<typeof world>, pointers: PointerStore = memoryPointerStore(), extra: Partial<LocalBoardDeps> = {}): LocalBoardDeps => ({
  spawn: w.spawn,
  ownership: { factory: asFactory(w.fake), name: DB, heartbeatMs: 40 },
  supervisor: { hungMs: 10000, openMs: 60000, pingMs: 0 },
  pointers,
  newId: ids,
  random: fixedRandom(656),
  batch: 2,
  ...extra,
});
const journalOf = async (fake: FakeIndexedDb, matchId: string) => {
  const s = indexedDbJournalStore({ factory: asFactory(fake), name: DB });
  try { return await s.get(matchId); } finally { s.close(); }
};

// ── The audit: what the page was handed must hold nothing the seat may not read ──────────────────────
const promptKinds = new Map<string, number>();
const audit = { snapshots: 0, checked: 0, hiddenIds: 0 };
function auditBoard(board: LocalBoard, w: ReturnType<typeof world>, s: Snapshot): void {
  audit.snapshots++;
  const keys = strings(s).keys;
  for (const k of ["aiMemory", "receipts", "entries", "policySeed", "journal", "rng", "seed"]) assert.ok(!keys.has(k), `the board's snapshot carries no ${k}`);
  const live = w.spawned.filter((x) => !x.dead()).map((x) => x.host.inspect()).find((i) => i && i.journal.matchId === board.matchId);
  if (!live) return;
  const hidden = hiddenFrom(live.match.state, live.human);
  const seen = strings(s);
  audit.hiddenIds += hidden.size;
  const leaked = [...hidden].filter((id) => seen.values.has(id) || seen.keys.has(id));
  assert.deepEqual(leaked, [], "no card id the seat may not read reaches the board");
  audit.checked++;
}

/** What `ArenaStage` does: draw what it is shown, answer the human's question, otherwise ask for the computer's turn. */
async function stageLoop(board: LocalBoard, w: ReturnType<typeof world>, o: { stop?: (s: Snapshot) => boolean; onBoard?: (s: Snapshot) => void } = {}): Promise<"over" | "stopped"> {
  const seen: number[] = [];
  const handle = board.watch({ revision: 0, beat: 0, onConnection: () => {}, onSnapshot: (s) => { seen.push(s.game.revision); if (seen.length % 5 === 1) auditBoard(board, w, s); } });
  try {
    for (let step = 0; step < 6000; step++) {
      const snap = board.snapshot!;
      o.onBoard?.(snap);
      promptKinds.set(snap.view.prompt.kind, (promptKinds.get(snap.view.prompt.kind) ?? 0) + 1);
      if (snap.game.status === "over") return "over";
      if (o.stop?.(snap)) return "stopped";
      const r = humanAsked(snap) ? await board.act(humanPick(snap), snap.game.revision, ids()) : await board.advance();
      assert.equal(r.error, null, `no refusal at revision ${snap.game.revision}: ${r.error}; ${JSON.stringify(board.state)}`);
    }
    throw new Error("the loop did not finish");
  } finally {
    handle.stop();
    assert.ok(seen.every((r, i) => i === 0 || r > seen[i - 1]), "the board is only ever handed newer revisions");
  }
}
const humanMoves = async (fake: FakeIndexedDb, matchId: string) => (await journalOf(fake, matchId))!.entries.filter((e) => e.kind === "human").length;
const setupP1 = { decks: { p1: "A", p2: "B" }, human: "p1" as const };
const setupP2 = { decks: { p1: "B", p2: "A" }, human: "p2" as const };

// ── 1. The pack gate ───────────────────────────────────────────────────────────────────────────────
{
  const w = world();
  assert.equal((await auditPack()).qualification.playable, true, "the audited pack qualifies since #757 resolved U1");
  const real = await withheldCostsPack();
  assert.equal(real.qualification.playable, false, "the pack without the owner's Unison costs is unplayable");
  const spawnedBefore = w.spawned.length;
  await assert.rejects(LocalBoard.start(real, setupP1, depsOn(w)), (e: unknown) => {
    assert.ok(e instanceof LocalBoardError && e.code === "unplayable", "refused as unplayable");
    assert.match(e.message, /not playable yet/, "with a plain sentence");
    assert.ok(e.reasons.some((r) => /missing input: DB3-001 specifiedCost/.test(r)), "naming the missing input");
    return true;
  });
  assert.equal(w.spawned.length, spawnedBefore, "no worker was spent on it");
  assert.throws(() => readPack({ hello: "world" }), (e: unknown) => e instanceof LocalBoardError && e.code === "pack", "a non-pack is refused");
  assert.throws(() => readPack(null), LocalBoardError);
  // The page's gate follows the pack's flag but never trusts it: a forged flag is still refused by the worker.
  const forged = clone(real);
  forged.qualification = { playable: true, reasons: [] };
  const board = await LocalBoard.start(forged, setupP1, depsOn(w));
  assert.notEqual(board.state.kind, "owner", "a forged playable flag does not open a match: the worker validates the pack itself");
  assert.equal(board.snapshot, null, "and the board shows nothing");
  assert.ok(describeBoard(board.state, false), "the failure has a notice");
  await board.dispose();
  await assert.rejects(LocalBoard.start(pack, { decks: { p1: "A", p2: "Z" }, human: "p1" }, depsOn(w)), (e: unknown) => e instanceof LocalBoardError && e.code === "deck", "an unknown deck key is refused");
  const other = clone(pack);
  other.hash = "f".repeat(64);
  const ptr: LocalPointer = { matchId: "m", gameId: 1, packHash: pack.hash, packId: pack.id, decks: { p1: "A", p2: "B" }, human: "p1", names: { p1: "a", p2: "b" }, savedAt: 1 };
  await assert.rejects(LocalBoard.resume(other, ptr, depsOn(w)), (e: unknown) => e instanceof LocalBoardError && e.code === "mismatch" && /another deck pack/.test(e.message), "resume with another pack is refused with a sentence");
  console.log("  pack gate: ok");
}

// ── 2. Either seat, start to finish; reload half way; nothing leaves the device ─────────────────────────
const finals: Record<string, string> = {};
{
  // The reference: the p1 match uninterrupted.
  const w = world();
  const board = await LocalBoard.start(pack, setupP1, depsOn(w));
  assert.equal(board.state.kind, "owner", "the match opens as its writer");
  assert.equal(board.notice, null, "and all is well: nothing to say");
  assert.deepEqual(board.capabilities, { advance: true, abandon: false, rematch: true, flag: false, plan: false, skin: false, staging: false, report: false });
  assert.equal(await stageLoop(board, w), "over");
  finals.p1 = canonicalJson(board.snapshot);
  assert.equal(board.snapshot!.game.status, "over");
  assert.ok(board.snapshot!.over, "a terminal result with its reason");
  assert.equal(board.snapshot!.game.you, "p1");
  await board.dispose();
}
{
  const w = world();
  const pointers = memoryPointerStore();
  const board = await LocalBoard.start(pack, setupP1, depsOn(w, pointers));
  assert.equal(pointers.value?.matchId, board.matchId, "the pointer names the open match");
  assert.deepEqual(Object.keys(pointers.value!).sort(), ["decks", "gameId", "human", "matchId", "names", "packHash", "packId", "savedAt"], "and holds no seed, hand or journal");
  // Play until the human is asked after revision 40, then leave the page.
  assert.equal(await stageLoop(board, w, { stop: (s) => s.game.revision >= 40 && humanAsked(s) }), "stopped");
  const shown = canonicalJson(board.snapshot);
  const at = board.snapshot!.game.revision;
  const movesBefore = await humanMoves(w.fake, board.matchId);
  await board.dispose();
  assert.ok(w.spawned.every((x) => x.dead()), "leaving the page ends its worker");
  assert.equal(board.state.kind, "closed");
  // A new page: no state but the pointer and the device.
  const pointer = pointers.get()!;
  const resumed = await LocalBoard.resume(pack, pointer, depsOn(w, pointers));
  assert.equal(resumed.state.kind, "owner", "the saved match resumes as its writer");
  assert.equal(resumed.snapshot!.game.revision, at, "at the saved revision");
  assert.equal(canonicalJson(resumed.snapshot), shown, "on the identical board");
  assert.equal(resumed.human, "p1", "in the same seat");
  assert.equal(await humanMoves(w.fake, resumed.matchId), movesBefore, "nothing was replayed twice");
  assert.equal(await stageLoop(resumed, w), "over");
  assert.equal(canonicalJson(resumed.snapshot), finals.p1, "reloaded half way, the match ends exactly as the uninterrupted one");
  // Reload after the end: the final position and its result come back from the device.
  const finalMatch = resumed.matchId;
  await resumed.dispose();
  const again = await LocalBoard.resume(pack, pointers.get()!, depsOn(w, pointers));
  assert.equal(canonicalJson(again.snapshot), finals.p1, "a finished match resumes as its final board");
  assert.ok(again.snapshot!.over, "with its terminal result");
  assert.equal(again.matchId, finalMatch);
  await again.dispose();
  console.log(`  seat p1: reloaded at revision ${at}, ended at revision ${again.snapshot!.game.revision}`);
}
{
  const w = world();
  const board = await LocalBoard.start(pack, setupP2, depsOn(w));
  assert.equal(board.snapshot!.game.you, "p2", "the human sits in p2");
  assert.equal(await stageLoop(board, w), "over");
  assert.equal(board.snapshot!.game.you, "p2");
  assert.ok(board.snapshot!.over);

  // ── 4. Finish and rematch ────────────────────────────────────────────────────────────────────
  const late: number[] = [];
  board.watch({ revision: 0, beat: 0, onConnection: () => {}, onSnapshot: (s) => late.push(s.game.revision) });
  const lateBefore = late.length;
  const oldRevision = board.snapshot!.game.revision;
  let successor: LocalBoard | null = null;
  board.onSuccessor((n) => { successor = n; });
  const r = await board.rematch();
  assert.equal(r.error, null, "Play again succeeds");
  assert.ok(successor, "the page is handed the next match");
  const next = successor as unknown as LocalBoard;
  assert.notEqual(next.matchId, board.matchId, "a new match, a new name");
  assert.equal(next.human, "p2", "in the same seat");
  assert.deepEqual(next.setup, setupP2, "with the same decks");
  assert.equal(next.snapshot!.game.status, "playing", "a fresh game");
  assert.equal(board.state.kind, "closed", "the finished match is closed");
  assert.equal(board.snapshot!.game.revision, oldRevision, "and still shows its final board");
  assert.equal(late.length, lateBefore, "nothing the old match says reaches its watchers after the switch");
  const newRevision = next.snapshot!.game.revision;
  const refusedOld = await board.act({ type: "endTurn" } as never, newRevision, ids());
  assert.ok(refusedOld.error, "the old session accepts no move");
  assert.equal(next.snapshot!.game.revision, newRevision, "and the new board was not touched by it");
  assert.equal((await board.rematch()).error, "this game was closed", "a closed board cannot rematch again");
  assert.equal(await stageLoop(next, w, { stop: (s) => s.game.revision >= 30 && humanAsked(s) }), "stopped", "the next match is played on");
  await next.dispose();
  assert.equal(fetchCalls.length, 0, "no network call in a whole start, play, rematch and finish");
  console.log(`  seat p2: played to the end; rematch opened ${next.matchId.slice(-4)} and played on to revision ${next.snapshot!.game.revision}`);
}
{
  const w = world();
  const unfinished = await LocalBoard.start(pack, setupP1, depsOn(w));
  assert.equal((await unfinished.rematch()).error, "The match is not over yet.", "Play again is refused while the match is on");
  await unfinished.dispose();
}

// ── 3. Privacy: counted over every board above ─────────────────────────────────────────────────
// Every 5th snapshot of every board above (84 in all on the engine of 14 Oct; the games got shorter with #759).
assert.ok(audit.snapshots >= 50 && audit.checked >= 40, `the leak audit ran over ${audit.snapshots} snapshots (${audit.checked} against the host's hidden state)`);
assert.ok(audit.hiddenIds > 1000, "and the hidden state it compared against was not empty");
{
  // Negative control: the audit would catch a board that carried a hidden id.
  const w = world();
  const board = await LocalBoard.start(pack, setupP1, depsOn(w));
  const host = w.spawned.at(-1)!.host.inspect()!;
  const hidden = [...hiddenFrom(host.match.state, host.human)][0];
  const leaky = { ...board.snapshot!, spy: hidden } as unknown as Snapshot;
  assert.throws(() => auditBoard(board, w, leaky), /no card id the seat may not read/, "the leak audit has teeth");
  await board.dispose();
}

// ── 5. Stale and refused moves ─────────────────────────────────────────────────────────────────
{
  const w = world();
  const board = await LocalBoard.start(pack, setupP1, depsOn(w));
  await stageLoop(board, w, { stop: (s) => s.game.revision >= 8 && humanAsked(s) });
  const s = board.snapshot!;
  const before = stableJson((await journalOf(w.fake, board.matchId))!.entries);
  const stale = await board.act(humanPick(s), s.game.revision + 5, ids());
  assert.equal(stale.error, "the board has moved on — read it again", "a stale revision is refused with the sentence");
  const withCard = s.legal.find((l) => typeof (l.action as { card?: unknown }).card === "string");
  if (withCard) {
    const unknown = await board.act({ ...withCard.action, card: "?p2:deck:0" } as never, s.game.revision, ids());
    assert.equal(unknown.error, "that move is not allowed now", "a card the seat cannot see is refused");
  }
  assert.equal(stableJson((await journalOf(w.fake, board.matchId))!.entries), before, "the journal is byte-identical after the refusals");
  assert.equal(board.snapshot!.game.revision, s.game.revision, "and the board did not move");
  const id = ids();
  const first = await board.act(humanPick(s), s.game.revision, id);
  assert.equal(first.error, null);
  const rev = board.snapshot!.game.revision;
  const entries = (await journalOf(w.fake, board.matchId))!.entries.length;
  const again = await board.act(humanPick(s), s.game.revision, id);
  assert.equal(again.error, null, "a retried request is answered from its receipt");
  assert.equal(board.snapshot!.game.revision, rev, "and played once");
  assert.equal((await journalOf(w.fake, board.matchId))!.entries.length, entries, "the journal did not grow");
  assert.equal(board.saving, false, "nothing is left saving");
  await board.dispose();
  console.log("  stale, unknown card and duplicate: journal unchanged");
}

// ── 6. Failure and recovery, as the player sees it ─────────────────────────────────────────────
{
  // A full device.
  const w = world();
  const board = await LocalBoard.start(pack, setupP1, depsOn(w));
  await stageLoop(board, w, { stop: (s) => s.game.revision >= 20 && humanAsked(s) });
  const at = board.snapshot!.game.revision;
  const savingSeen: boolean[] = [];
  const off = board.subscribe(() => savingSeen.push(board.saving));
  w.fake.quotaBytes = w.fake.usedBytes() + 8;
  const full = await board.act(humanPick(board.snapshot!), at, ids());
  assert.match(full.error ?? "", /could not be saved on this device/, "the move is refused with the storage sentence");
  assert.equal(board.state.kind, "storage");
  const notice = board.notice!;
  assert.equal(notice.tone, "error");
  assert.deepEqual(notice.actions, ["retry", "leave"], "Retry and leave are offered");
  assert.match(notice.detail, /Free some space/, "it says what to do");
  assert.match(notice.detail, /safe at its last saved move/, "and that nothing is lost");
  assert.equal(board.snapshot!.game.revision, at, "the board stays at the last saved move");
  assert.ok(savingSeen.includes(true) && savingSeen.at(-1) === false, "the board reported saving, then done");
  off();
  w.fake.quotaBytes = null;
  assert.equal((await board.retry()).kind, "owner", "Retry works once there is space");
  assert.equal(board.notice, null);
  assert.equal((await board.act(humanPick(board.snapshot!), at, ids())).error, null, "and the move is accepted");
  await board.dispose();
}
{
  // A second tab, then taking the match over.
  const w = world();
  const pointers = memoryPointerStore();
  const a = await LocalBoard.start(pack, setupP1, depsOn(w, pointers));
  await stageLoop(a, w, { stop: (s) => s.game.revision >= 12 && humanAsked(s) });
  const b = await LocalBoard.resume(pack, pointers.get()!, depsOn(w, memoryPointerStore()));
  assert.equal(b.state.kind, "watching", "a second tab only watches");
  assert.equal(b.state.watching, "held-elsewhere");
  assert.equal(b.notice!.headline, "This match is open in another tab");
  assert.deepEqual(b.notice!.actions, ["takeOver", "leave"]);
  assert.equal(canonicalJson(b.snapshot), canonicalJson(a.snapshot), "and sees the same board");
  const refused = await b.act(humanPick(b.snapshot!), b.snapshot!.game.revision, ids());
  assert.equal(refused.error, "this game is open in another tab or window — it can only be watched here", "its moves are refused with the sentence");
  assert.equal((await b.takeOver()).kind, "owner", "Play here instead takes the match");
  assert.equal(b.notice, null);
  const lost = await a.act(humanPick(a.snapshot!), a.snapshot!.game.revision, ids());
  assert.ok(lost.error, "the first tab's next move is refused");
  assert.equal(a.state.kind, "watching");
  assert.equal(a.state.watching, "taken-over");
  assert.equal(a.notice!.headline, "Another tab took this match over", "and says so");
  assert.equal(await stageLoop(b, w, { stop: (s) => s.game.revision >= 40 && humanAsked(s) }), "stopped", "the new owner plays on");
  await a.dispose();
  await b.dispose();
  console.log("  second tab: watched, took over, old tab fenced");
}
{
  // An explicit worker failure exercises the board's recovery notice. Keep the
  // normal watchdog for healthy continuation: AI work can exceed 400 ms on this
  // in-process fixture. Silent death and watchdog expiry are proved in ownership.
  const w = world();
  const board = await LocalBoard.start(pack, setupP1, depsOn(w, memoryPointerStore()));
  await stageLoop(board, w, { stop: (s) => s.game.revision >= 16 && humanAsked(s) });
  const notices: string[] = [];
  board.subscribe(() => { const n = board.notice; if (n) notices.push(`${n.tone}:${n.headline}`); });
  w.spawned.filter((x) => !x.dead()).forEach((x) => x.kill());
  const s = board.snapshot!;
  const r = await board.act(humanPick(s), s.game.revision, ids());
  assert.equal(r.error, null, "the move is applied after the engine restarts");
  assert.equal(board.state.kind, "owner");
  assert.ok(board.state.totalRestarts >= 1, "the worker was restarted");
  assert.ok(notices.some((n) => n.startsWith("busy:The local game engine stopped")), `the restart was shown (${notices.join(" | ")})`);
  assert.equal(board.notice, null, "and cleared");
  assert.equal(await stageLoop(board, w, { stop: (s) => s.game.revision >= 40 && humanAsked(s) }), "stopped", "and the match goes on");
  await board.dispose();
}
{
  // Every state has a notice that reads as a sentence and offers a way forward.
  const base = { code: null, detail: null, restarts: 0, totalRestarts: 0, mode: "lease" as const, fence: null, holder: null, watching: null };
  const kinds = ["opening", "owner", "watching", "recovering", "storage", "failed", "stopped", "closed"] as const;
  for (const kind of kinds) {
    const n = describeBoard({ ...base, kind, code: kind === "storage" ? "storage" : null, detail: kind === "recovering" ? "the worker failed" : null, restarts: 1 }, false);
    if (kind === "owner") { assert.equal(n, null, "no notice while all is well"); continue; }
    assert.ok(n && n.headline && n.detail, `${kind} has a headline and a detail`);
    assert.ok(!/undefined|null|\[object/.test(`${n.headline} ${n.detail}`), `${kind}: no raw values in the text`);
    if (kind !== "opening") assert.ok(n.actions.length > 0, `${kind} offers an action`);
  }
  const damaged = describeBoard({ ...base, kind: "failed", code: "journal", detail: "this saved game cannot be continued" }, false)!;
  assert.deepEqual(damaged.actions, ["discard", "leave"], "a damaged save offers discard, not a retry that cannot help");
  assert.equal(describeBoard({ ...base, kind: "closed" }, true)!.headline, "Match closed");
}
{
  // The pointer store tolerates a missing, full or blocked localStorage.
  const store = browserPointerStore(() => { throw new Error("blocked"); });
  assert.equal(store.get(), null);
  store.set({ matchId: "m", gameId: 1, packHash: "h", packId: "p", decks: { p1: "A", p2: "B" }, human: "p1", names: { p1: "a", p2: "b" }, savedAt: 1 });
  store.clear();
  const mem = new Map<string, string>();
  const ok = browserPointerStore(() => ({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); }, removeItem: (k) => { mem.delete(k); } }));
  mem.set("dbs-arena-local-pointer", "{not json");
  assert.equal(ok.get(), null, "a damaged pointer is no pointer");
  mem.set("dbs-arena-local-pointer", JSON.stringify({ matchId: 3 }));
  assert.equal(ok.get(), null, "and so is one of the wrong shape");
}

// The board met more than one kind of question through the local adapter (payments, choices, battle steps...).
assert.ok(promptKinds.size >= 4, `the matches asked ${promptKinds.size} kinds of question: ${[...promptKinds].map(([k, n]) => `${k}×${n}`).join(", ")}`);
console.log(`  questions answered through the local adapter: ${[...promptKinds].map(([k, n]) => `${k}×${n}`).join(", ")}`);

// ── 8. Boundary ────────────────────────────────────────────────────────────────────────────────
{
  const entry = path.join(ROOT, "src/components/arena/session/local-board.ts");
  const g = checkImportGraph(entry, ROOT, diskRead);
  assert.deepEqual(g.violations, [], "the local board has no forbidden runtime dependency");
  const lib = g.files.filter((f) => f.startsWith("src/lib/"));
  const allowed = new Set(["src/lib/arena/local/protocol.ts", "src/lib/arena/local/recovery.ts", "src/lib/arena/local/ownership.ts", "src/lib/arena/local/storage.ts", "src/lib/arena/local/art-urls.ts", "src/lib/arena/policy/contract.ts", "src/lib/arena/policy/observation.ts", "src/lib/arena/policy/rng.ts"]); // the last three are the journal store's hashing helpers (#653), not the engine
  assert.deepEqual(lib.filter((f) => !allowed.has(f)), [], `its value graph reaches no engine, policy or pack module (${lib.join(", ")})`);
  const src = fs.readFileSync(entry, "utf8");
  assert.ok(!/\bfetch\(/.test(src), "the board module never calls fetch");
  const ui = path.join(ROOT, "src/components/arena/session/LocalArena.tsx");
  if (fs.existsSync(ui)) {
    const text = fs.readFileSync(ui, "utf8");
    assert.ok(!/\bfetch\(|@\/app\/arena\/actions|next\/navigation/.test(text), "the page component calls no network and no server action");
    assert.ok(/new Worker\(new URL\("\.\.\/\.\.\/\.\.\/lib\/arena\/local\/worker-entry\.ts"/.test(text), "it starts the real module Worker");
  }
}

// ── 9. Offline art (#780): the board is handed the pack store's object URLs, never a catalog URL ──────
{
  const w = world();
  const plain = await LocalBoard.start(clone(pack), setupP1, depsOn(w));
  const catalog = [...strings(plain.snapshot!).values].filter((v) => /^https?:\/\//.test(v));
  assert.ok(catalog.length > 0, `the unlocalized board addresses catalog URLs (${catalog.length})`);
  await plain.dispose();
  const urls = new Map(catalog.map((u, i) => [u, `blob:local/${i}`] as const));
  const w2 = world();
  const board = await LocalBoard.start(clone(pack), setupP1, depsOn(w2, memoryPointerStore(), { art: urls }));
  const got: Snapshot[] = [];
  const h = board.watch({ revision: 0, beat: 0, onConnection: () => {}, onSnapshot: (s) => got.push(s) });
  const shown = board.snapshot!;
  assert.equal(board.snapshot, shown, "the localized snapshot is stable between reads");
  assert.deepEqual([...strings(shown).values].filter((v) => urls.has(v)), [], "no catalog URL the pack store holds is left on the board");
  assert.ok([...strings(shown).values].some((v) => v.startsWith("blob:local/")), "the pack store's URLs are on the board");
  await stageLoop(board, w2, { stop: (sn) => sn.game.revision > 6 });
  assert.ok(got.length > 0 && got.every((sn) => ![...strings(sn).values].some((v) => urls.has(v))), "watched snapshots are localized too");
  h.stop();
  await board.dispose();
}

console.log(`arena-local-board-656: ok — staged SD15/SD5 pack ${pack.hash.slice(0, 12)}…, ${audit.snapshots} snapshots audited (${audit.checked} against the host), ${fetchCalls.length} network calls, ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(0);
