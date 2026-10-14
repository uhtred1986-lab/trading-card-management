/**
 * #653 (plan O3-03): local matches journalled transactionally in IndexedDB — the Node half.
 *
 * The real store (`src/lib/arena/local/storage.ts`) runs on `fake-indexeddb.ts`, a FAKE IndexedDB
 * written for this proof (no IndexedDB package is installed and none may be added): it implements
 * the subset the store uses, with IndexedDB's buffered-until-commit, abort-discards-everything and
 * version-change semantics. The same store on Chrome's real IndexedDB, in a real Worker that is
 * killed mid-transaction: `npm run arena:local-storage-browser`.
 *
 * The host (`worker.ts`) and the page client (`session/local.ts`) are the real ones over #652's
 * in-process channel, playing the audited SD15/SD5 pair staged to qualify. Every run below is the
 * same game (`arena-local-storage-driver.ts`), so each is compared with one in-memory reference.
 *
 *   1. Same as in memory: the plain match on the store posts byte-identical messages to the
 *      in-memory one; #652's scripted run "b" (cancels, dispose, resume) ends in the same game.
 *   2. Reload: saved during a pending human choice and during an AI turn, closed, and resumed by a
 *      new host on a new connection — identical state, board (legal actions), AI memory, journal,
 *      and the identical next policy decision; played on, the same game to the end.
 *   3. Failure never half-commits: an aborted transaction, exhausted quota and a crash in the middle
 *      of a commit each leave the device's save exactly at the last committed revision (equal to the
 *      host's journal), are reported as named errors, and the match continues to the same end.
 *   4. Damaged saves are refused with their named code: corrupt, truncated (missing decision, a
 *      header gone), tampered (digest, chain), a forged save with recomputed digests (the replay
 *      refuses it), records and a database of a newer schema, another pack or interpreter.
 *      A commit never rewrites history. No IndexedDB at all is `storage`/`unavailable`.
 *   5. Versions: a database saved by schema 1 is upgraded additively and resumes; a failing
 *      migration leaves the old version and data; the newer database is refused, untouched.
 *   6. What is stored: exactly the journal's fields (header and decision records), no projected
 *      board, engine state, pack, account or collection data; keys are local strings in a
 *      browser-only database; no network call was made; `storage.ts` passes the offline boundary.
 *
 *   npx tsx scripts/verify/arena-local-storage.mts      (part of `npm test`)
 */
import assert from "node:assert/strict";
import path from "node:path";
import { checkImportGraph, diskRead, offlinePackRule } from "../lib/import-graph.ts";
import {
  DECISION_RECORD_FIELDS, LOCAL_DB_NAME, MATCH_RECORD_FIELDS, MIGRATIONS, STORAGE_SCHEMA, chainOf, indexedDbJournalStore, journalOfRecords, matchRecordOf,
  type DecisionRecord, type IndexedDbStoreOptions, type MatchRecord, type Migration,
} from "../../src/lib/arena/local/storage.ts";
import { memoryJournalStore, type MatchJournal } from "../../src/lib/arena/local/worker.ts";
import { LocalSessionError, LocalWorkerSession } from "../../src/components/arena/session/local.ts";
import { localStep } from "../../src/lib/arena/policy/boundary.ts";
import { localPolicy } from "../../src/lib/arena/policy/combat.ts";
import { stableJson } from "../../src/lib/arena/policy/contract.ts";
import { canonicalJson, replayHash } from "../../src/lib/arena/replay-core.ts";
import type { PlayerId } from "../../src/lib/arena/types.ts";
import { strings } from "./arena-policy-permute.ts";
import { inProcessChannel, type Channel } from "./arena-local-worker-channel.ts";
import { runScripted } from "./arena-local-worker-driver.ts";
import { GAME_ID, LoopRefused, aiAsked, humanAsked, playLoop, requestIds, resumeLoopMatch, startLoopMatch } from "./arena-local-storage-driver.ts";
import { OTHER_REVISION, otherPack, stagedPack } from "./arena-local-worker-fixture.mts";
import { FakeIndexedDb, asFactory } from "./fake-indexeddb.ts";

const ROOT = process.cwd();
const t0 = performance.now();
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const fetchCalls: string[] = [];
globalThis.fetch = ((input: unknown) => { fetchCalls.push(String(input)); throw new Error("no network in this proof"); }) as typeof fetch;

const pack = await stagedPack();
const DB = "proof-653";
const ids = requestIds(0x653);
let sessions = 0;
const opts = (awaitReady = true) => ({ newRequestId: ids, sessionId: `s${++sessions}`, awaitReady });
const storeOn = (fake: FakeIndexedDb, extra: Partial<IndexedDbStoreOptions> = {}) => indexedDbJournalStore({ factory: asFactory(fake), name: DB, ...extra });

// ── The in-memory reference ─────────────────────────────────────────────────────────────────────
const refCh = inProcessChannel({ store: memoryJournalStore() });
const refSession = await startLoopMatch(refCh.port, pack, "local-ref", { newRequestId: requestIds(0x6530), sessionId: "same" });
const refBoards = new Map<number, string>();
await playLoop(refSession, { nextId: requestIds(0x6531), onBoard: (s) => { refBoards.set(s.game.revision, canonicalJson(s)); } });
const refJournal = refCh.host.inspect()!.journal;
const refFinal = canonicalJson(refSession.snapshot);
const refStream = await Promise.all(refCh.posted.map((m) => replayHash(m)));
assert.equal(refSession.snapshot!.game.status, "over", "the reference match ends");
await refSession.dispose();
const sameBoard = (what: string) => (s: { game: { revision: number } }) => {
  const want = refBoards.get(s.game.revision);
  assert.ok(want !== undefined, `${what}: revision ${s.game.revision} exists in the reference`);
  assert.equal(canonicalJson(s), want, `${what}: the board at revision ${s.game.revision} is the reference's`);
};
const sameEnd = (what: string, session: LocalWorkerSession, ch: Channel) => {
  assert.equal(canonicalJson(session.snapshot), refFinal, `${what}: the final board is the reference's`);
  const j = ch.host.inspect()!.journal;
  assert.equal(j.trace, refJournal.trace, `${what}: the same game (trace)`);
  const decided = (x: MatchJournal) => x.entries.map((e) => (e.kind === "ai" ? e.id : stableJson(e.action)));
  assert.deepEqual(decided(j), decided(refJournal), `${what}: decision for decision (request ids aside)`);
  assert.equal(stableJson(j.aiMemory), stableJson(refJournal.aiMemory), `${what}: the AI's memory and RNG end where they would have`);
};
/** What the device holds for a match, read by a fresh connection. */
const onDevice = async (fake: FakeIndexedDb, matchId: string) => {
  const s = storeOn(fake);
  try { return await s.get(matchId); } finally { s.close(); }
};

// ── 1. Same as in memory ─────────────────────────────────────────────────────────────────────────
{
  const fake = new FakeIndexedDb();
  const ch = inProcessChannel({ store: storeOn(fake) });
  const s = await startLoopMatch(ch.port, pack, "local-ref", { newRequestId: requestIds(0x6530), sessionId: "same" });
  await playLoop(s, { nextId: requestIds(0x6531) });
  sameEnd("on IndexedDB", s, ch);
  // Same request ids, same match id: the message stream is byte-identical to the in-memory one.
  const stream = await Promise.all(ch.posted.map((m) => replayHash(m)));
  assert.deepEqual(stream, refStream, "the worker posts byte-identical messages on IndexedDB and in memory");
  assert.equal(stableJson(await onDevice(fake, "local-ref")), stableJson(ch.host.inspect()!.journal), "the device holds exactly the host's journal");
  await s.dispose();
}
{
  // #652's run "b" — batches of 1, cancels after first batches, disposed mid-advance and resumed — on the store.
  const fake = new FakeIndexedDb();
  const ch = inProcessChannel({ store: storeOn(fake) });
  const run = await runScripted("b", ch.port, ch.inject, pack);
  assert.equal(canonicalJson(run.final), refFinal, "run b on IndexedDB (cancelled, disposed, resumed from the device) ends in the reference board");
  assert.equal(ch.host.inspect()!.journal.trace, refJournal.trace, "and the same game");
  assert.ok(run.disposed && run.cancelsHonoured >= 2, "its dispose/resume and cancels ran");
  assert.equal(stableJson(await onDevice(fake, "match-b")), stableJson(ch.host.inspect()!.journal), "the device holds the host's journal");
  await run.session.dispose();
}

// ── 2. Reload during a human choice and during an AI turn ────────────────────────────────────────
interface Captured { state: string; board: string; legal: string; memory: string; journal: string; next: string | null }
function capture(ch: Channel, session: LocalWorkerSession): Captured {
  const ins = ch.host.inspect()!;
  const ai: PlayerId = ins.human === "p1" ? "p2" : "p1";
  const asked = (ins.match.state.prompt as { player?: PlayerId }).player;
  // The next policy decision, asked of a fresh policy on a copy of the AI's memory (localStep is pure).
  const step = asked === ai ? localStep(ins.match, ai, ins.journal.entries.length, structuredClone(ins.memory), localPolicy()) : null;
  return {
    state: canonicalJson(ins.match.state),
    board: canonicalJson(session.snapshot),
    legal: canonicalJson(session.snapshot!.legal),
    memory: stableJson(ins.memory),
    journal: stableJson(ins.journal),
    next: step ? (step.ok ? `${step.id} -> ${canonicalJson(step.match.state)} ${stableJson(step.memory)}` : `refused ${step.reason}`) : null,
  };
}
const fakeR = new FakeIndexedDb();
{
  let ch = inProcessChannel({ store: storeOn(fakeR) });
  let s = await startLoopMatch(ch.port, pack, "local-r1", opts());
  const reload = async (what: string) => {
    const before = capture(ch, s);
    await s.dispose();
    // A reload: a new worker (host), a new connection to the same database.
    ch = inProcessChannel({ store: storeOn(fakeR) });
    s = await resumeLoopMatch(ch.port, pack, "local-r1", opts());
    const after = capture(ch, s);
    for (const k of Object.keys(before) as (keyof Captured)[]) assert.equal(after[k], before[k], `${what}: ${k} is identical after the reload`);
    return before;
  };
  assert.equal(await playLoop(s, { nextId: ids, onBoard: sameBoard("r1"), stop: (x) => x.revision >= 15 && humanAsked(x.snapshot!) }), "stopped");
  const h = await reload("during a human choice");
  assert.equal(h.next, null, "(the AI was not asked there)");
  assert.ok(JSON.parse(h.legal).length > 0, "(and the human had legal actions)");
  assert.equal(await playLoop(s, { nextId: ids, onBoard: sameBoard("r1"), stop: (x) => x.revision >= 30 && aiAsked(x.snapshot!) && (ch.host.inspect()!.match.state.prompt as { player?: string }).player === "p2" }), "stopped");
  const a = await reload("during an AI turn");
  assert.ok(a.next && !a.next.startsWith("refused"), "the AI was asked there, and its next decision is identical after the reload");
  assert.equal(await playLoop(s, { nextId: ids, onBoard: sameBoard("r1") }), "over");
  sameEnd("reloaded twice", s, ch);
  await s.dispose();
}

// ── 3. Failures never half-commit ───────────────────────────────────────────────────────────────
{
  const fake = new FakeIndexedDb();
  const faults: NonNullable<IndexedDbStoreOptions["faults"]> = {};
  let ch = inProcessChannel({ store: storeOn(fake, { faults }) });
  let s = await startLoopMatch(ch.port, pack, "local-f", opts());
  const consistent = async (what: string, revision: number) => {
    const saved = await onDevice(fake, "local-f");
    assert.ok(saved, `${what}: the save is there`);
    assert.equal(saved.entries.length + 1, revision, `${what}: the save is at revision ${revision}`);
    assert.equal(stableJson(saved), stableJson(ch.host.inspect()!.journal), `${what}: the save is exactly the host's journal`);
    assert.equal(s.revision, revision, `${what}: the board is at revision ${revision}`);
  };
  const refusedLoop = async (what: string, stopAt: (x: LocalWorkerSession) => boolean, arm: () => void, disarm: () => void, code: string, reason: RegExp) => {
    await playLoop(s, { nextId: ids, onBoard: sameBoard(what), stop: stopAt });
    const before = s.revision;
    arm();
    const err = await playLoop(s, { nextId: ids, onBoard: sameBoard(what), maxSteps: 1 }).then(() => null, (e: unknown) => e);
    disarm();
    assert.ok(err instanceof LoopRefused, `${what}: refused (${String(err)})`);
    assert.equal(err.answer.code, code, `${what}: as ${code} (${err.message})`);
    assert.match(`${err.answer.message} ${(err.answer.reasons ?? []).join(" ")}`, reason, `${what}: names why`);
    await consistent(what, before);
  };
  // An aborted transaction during an AI batch.
  await refusedLoop("aborted AI batch", (x) => x.revision >= 10 && aiAsked(x.snapshot!),
    () => { faults.duringWrite = ({ tx }) => tx.abort(); }, () => { delete faults.duringWrite; }, "storage", /aborted/);
  // Quota exhausted on a human move.
  await refusedLoop("quota on a human move", (x) => x.revision >= 20 && humanAsked(x.snapshot!),
    () => { fake.quotaBytes = fake.usedBytes() + 8; }, () => { fake.quotaBytes = null; }, "storage", /storage is full|QuotaExceeded/);
  // Quota exhausted on an AI batch.
  await refusedLoop("quota on an AI batch", (x) => x.revision >= 24 && aiAsked(x.snapshot!),
    () => { fake.quotaBytes = fake.usedBytes() + 8; }, () => { fake.quotaBytes = null; }, "storage", /storage is full|QuotaExceeded/);
  // A crash in the middle of a commit: the decisions are written, the header is not, and the process dies.
  await playLoop(s, { nextId: ids, onBoard: sameBoard("crash"), stop: (x) => x.revision >= 34 && aiAsked(x.snapshot!) });
  const committed = s.revision;
  let crashedWith = 0;
  faults.duringWrite = ({ added }) => { crashedWith = added; fake.crash(); };
  void s.advanceRaw(2); // never answered: the worker died
  for (let i = 0; i < 50 && !fake.dead; i++) await new Promise((r) => setTimeout(r, 5));
  delete faults.duringWrite;
  assert.ok(fake.dead && crashedWith > 0, `the crash fell inside a commit that had queued ${crashedWith} decision(s)`);
  const revived = fake.revive();
  const saved = await (async () => { const st = storeOn(revived); try { return await st.get("local-f"); } finally { st.close(); } })();
  assert.equal(saved!.entries.length + 1, committed, `after the crash the save is at the last committed revision ${committed}`);
  ch = inProcessChannel({ store: storeOn(revived) });
  s = await resumeLoopMatch(ch.port, pack, "local-f", opts());
  assert.equal(s.revision, committed, "and resumes there");
  assert.equal(await playLoop(s, { nextId: ids, onBoard: sameBoard("after crash") }), "over");
  sameEnd("after an abort, two quota failures and a crash", s, ch);
  await s.dispose();
}

// ── 4. Damaged saves are refused, by name ────────────────────────────────────────────────────────
const resumeError = async (fake: FakeIndexedDb, matchId = "local-r1", extra: Partial<{ pack: unknown; interpreterRevision: string }> = {}) => {
  const ch = inProcessChannel({ store: storeOn(fake) });
  const p = extra.pack ?? pack;
  const promise = extra.interpreterRevision
    ? LocalWorkerSession.resume(ch.port, { matchId, gameId: GAME_ID, pack: clone(p), interpreterRevision: extra.interpreterRevision }, opts())
    : resumeLoopMatch(ch.port, p, matchId, opts());
  const e = await promise.then(async (s) => { await s.dispose(); return null; }, (x: unknown) => x);
  assert.ok(e === null || e instanceof LocalSessionError, String(e));
  return e;
};
const headers = fakeR.rows(DB, "matches");
const decisions = fakeR.rows(DB, "decisions");
const keyH = JSON.stringify("local-r1");
const keyD = (i: number) => JSON.stringify(["local-r1", i]);
const goodHeader = clone(headers.get(keyH)) as MatchRecord;
const n = goodHeader.decisions;
let damagedCount = 0;
const damaged = async (what: string, damage: () => void, code: string, reason: RegExp) => {
  damagedCount++;
  const keepH = new Map(headers);
  const keepD = new Map(decisions);
  damage();
  const e = await resumeError(fakeR);
  assert.ok(e, `${what}: refused`);
  assert.equal(e.code, code, `${what}: as ${code} (${e.message})`);
  assert.match(`${e.message} ${e.reasons.join(" ")}`, reason, `${what}: named (${e.reasons.join("; ")})`);
  headers.clear(); for (const [k, v] of keepH) headers.set(k, v);
  decisions.clear(); for (const [k, v] of keepD) decisions.set(k, v);
};
assert.equal(await resumeError(fakeR), null, "the undamaged save resumes");
await damaged("a header that is not a record", () => headers.set(keyH, "garbage"), "journal", /corrupt: .*not a record/);
await damaged("a header with a field of the wrong type", () => headers.set(keyH, { ...goodHeader, seed: "652" }), "journal", /corrupt: .*seed/);
await damaged("a header with an unknown field", () => headers.set(keyH, { ...goodHeader, owner: "someone" }), "journal", /corrupt: .*unexpected field owner/);
await damaged("a header edited without its digest", () => headers.set(keyH, { ...goodHeader, aiMemory: { ...goodHeader.aiMemory, turn: goodHeader.aiMemory.turn + 1 } }), "journal", /tampered: .*digest/);
await damaged("a decision edited without its chain", () => {
  const d = clone(decisions.get(keyD(3))) as DecisionRecord;
  decisions.set(keyD(3), { ...d, entry: d.entry.kind === "ai" ? { ...d.entry, id: "menu:somethingElse" } : { ...d.entry, requestId: "00000000-0000-4000-8000-000000000000" } });
}, "journal", /tampered: .*decision 4/);
await damaged("a malformed decision", () => decisions.set(keyD(5), { ...(decisions.get(keyD(5)) as object), entry: { kind: "ai" } }), "journal", /corrupt: .*decision 6/);
await damaged("a missing last decision (truncated)", () => decisions.delete(keyD(n - 1)), "journal", /truncated: .*decision \d+ is missing/);
await damaged("a missing middle decision (truncated)", () => decisions.delete(keyD(7)), "journal", /truncated: .*decision 8 is missing/);
await damaged("decisions with no header (truncated)", () => headers.delete(keyH), "journal", /truncated: .*no header/);
await damaged("a decision beyond the header's count", () => decisions.set(keyD(n), { ...(decisions.get(keyD(0)) as object), index: n }), "journal", /corrupt: .*beyond/);
await damaged("a header of a newer record schema", () => headers.set(keyH, { ...goodHeader, schema: STORAGE_SCHEMA + 1 }), "newer", /newer: .*record schema 2/);
await damaged("a decision of a newer record schema", () => decisions.set(keyD(2), { ...(decisions.get(keyD(2)) as object), schema: STORAGE_SCHEMA + 1 }), "newer", /newer: .*record schema 2/);
await damaged("a forged save with recomputed digests (a changed AI decision)", () => {
  const journal = journalOfRecords(goodHeader, [...Array(n).keys()].map((i) => decisions.get(keyD(i)) as DecisionRecord));
  const k = journal.entries.findIndex((e, i) => i > 4 && e.kind === "ai");
  journal.entries[k] = { ...journal.entries[k], id: "menu:somethingElse" } as MatchJournal["entries"][number];
  const chains = chainOf("local-r1", journal.entries);
  journal.entries.forEach((entry, i) => decisions.set(keyD(i), { schema: STORAGE_SCHEMA, matchId: "local-r1", index: i, entry, chain: chains[i] }));
  headers.set(keyH, matchRecordOf(journal, chains));
}, "journal", /policy answered/);
{
  const other = await otherPack();
  assert.equal((await resumeError(fakeR, "local-r1", { pack: other }))?.code, "journal", "another pack than the match's is refused");
  assert.equal((await resumeError(fakeR, "local-r1", { interpreterRevision: OTHER_REVISION }))?.code, "runtime", "another interpreter revision is refused");
  assert.equal((await resumeError(fakeR, "nothing-saved"))?.code, "journal", "an unknown match is refused");
  assert.equal(await resumeError(fakeR), null, "and the save is still good after all of it");
}
{
  // A commit never rewrites history.
  const store = storeOn(fakeR);
  const saved = (await store.get("local-r1"))!;
  const rewrite = async (what: string, j: MatchJournal) => {
    const e = await store.put(j).then(() => null, (x: unknown) => x as { code?: string; message?: string });
    assert.equal(e?.code, "rewrite", `${what}: refused as rewrite (${e?.message})`);
  };
  await rewrite("a shorter journal", { ...clone(saved), entries: saved.entries.slice(0, -3) });
  await rewrite("a journal with a different past", { ...clone(saved), entries: saved.entries.map((e, i) => (i === saved.entries.findIndex((x) => x.kind === "ai") ? { ...e, id: "x" } : e)) });
  await rewrite("another seed", { ...clone(saved), seed: saved.seed + 1 });
  assert.equal(stableJson(await store.get("local-r1")), stableJson(saved), "the save is unchanged");
  store.close();
}
{
  // No IndexedDB at all: refused as storage/unavailable, not a crash.
  assert.equal((globalThis as { indexedDB?: unknown }).indexedDB, undefined, "(Node has no IndexedDB)");
  const ch = inProcessChannel({ store: indexedDbJournalStore() });
  const e = await startLoopMatch(ch.port, pack, "local-none", opts()).then(() => null, (x: unknown) => x as LocalSessionError);
  assert.equal(e?.code, "storage", "without IndexedDB a match is refused as storage");
  assert.match(e!.reasons.join(" "), /unavailable/, "named unavailable");
  assert.equal(ch.host.inspect(), null, "and no session exists");
}

// ── 5. Versions ──────────────────────────────────────────────────────────────────────────────────
{
  assert.equal(MIGRATIONS.length, 2, "this build's schema is version 2 (#654 added the owners store)");
  const fake = new FakeIndexedDb();
  // Version 1 is the #653 build; version 2 is this one, whose real additive step adds the owners store (#654).
  const v1: Migration[] = MIGRATIONS.slice(0, 1);
  const v2: Migration[] = [...MIGRATIONS];
  const broken: Migration[] = [...v2, { version: 3, describe: "proof: a step that fails half-way", run(db) { db.createObjectStore("proof-half", { keyPath: "id" }); throw new Error("disk on fire"); } }];
  const journal = (await onDevice(fakeR, "local-r1"))!;
  const old = storeOn(fake, { migrations: v1 });
  await old.put(journal);
  old.close();
  assert.equal(fake.databases.get(DB)!.version, 1);
  // A newer build (schema 2) opens the schema-1 database: upgraded in place, the save intact and resumable.
  const upgraded = storeOn(fake, { migrations: v2 });
  assert.equal(stableJson(await upgraded.get("local-r1")), stableJson(journal), "after the upgrade to version 2 the save reads back identical");
  upgraded.close();
  assert.equal(fake.databases.get(DB)!.version, 2, "the database is at version 2");
  assert.ok(fake.databases.get(DB)!.stores.has("owners"), "with the owners store added (#654)");
  {
    const ch = inProcessChannel({ store: storeOn(fake, { migrations: v2 }) });
    const s = await resumeLoopMatch(ch.port, pack, "local-r1", opts());
    assert.equal(s.snapshot!.game.status, "over", "and resumes (the finished match, at its end)");
    assert.equal(canonicalJson(s.snapshot), refFinal);
    await s.dispose();
  }
  // A migration that fails: the upgrade aborts, the database stays at version 2 with its data.
  const failing = storeOn(fake, { migrations: broken });
  const e = await failing.get("local-r1").then(() => null, (x: unknown) => x as { code?: string; message?: string });
  assert.equal(e?.code, "upgrade", `a failing migration is refused as upgrade (${e?.message})`);
  assert.equal(fake.databases.get(DB)!.version, 2, "the database stays at version 2");
  assert.ok(!fake.databases.get(DB)!.stores.has("proof-half"), "without the half-made store");
  assert.equal(stableJson(await storeOn(fake, { migrations: v2 }).get("local-r1")), stableJson(journal), "and the save intact");
  // The older build (schema 1) meets the version-2 database: refused as newer, nothing touched.
  const before = stableJson([...fake.rows(DB, "matches")]);
  const older = storeOn(fake, { migrations: v1 });
  const refusedOld = await older.get("local-r1").then(() => null, (x: unknown) => x as { code?: string; message?: string });
  assert.equal(refusedOld?.code, "newer", `an older build refuses the newer database (${refusedOld?.message})`);
  {
    const ch = inProcessChannel({ store: storeOn(fake, { migrations: v1 }) });
    const err = await resumeLoopMatch(ch.port, pack, "local-r1", opts()).then(() => null, (x: unknown) => x as LocalSessionError);
    assert.equal(err?.code, "newer", "and the worker reports it as newer");
  }
  assert.equal(stableJson([...fake.rows(DB, "matches")]), before, "the newer database is untouched");
  assert.equal(fake.databases.get(DB)!.version, 2);
}

// ── 6. What is stored ────────────────────────────────────────────────────────────────────────────
{
  const hostJournal = (await onDevice(fakeR, "local-r1"))!;
  const head = headers.get(keyH) as Record<string, unknown>;
  assert.deepEqual(Object.keys(head).sort(), [...MATCH_RECORD_FIELDS].sort(), "the header has exactly the journal's fields and its bookkeeping");
  for (const [k, v] of decisions) {
    assert.deepEqual(Object.keys(v as object).sort(), [...DECISION_RECORD_FIELDS].sort(), `decision ${k} has exactly its fields`);
  }
  const allRows = [...fakeR.databases.get(DB)!.stores.values()].flatMap((s) => [...s.rows.values()]);
  const seen = strings(allRows);
  for (const k of ["owner", "email", "user", "account", "collection", "lots", "price", "snapshot", "state", "prompt", "bundle", "defs", "library", "legal"]) {
    assert.ok(!seen.keys.has(k), `nothing stored has a ${k} field`);
  }
  assert.ok(![...seen.values].some((v) => /@[a-z0-9-]+\./i.test(v)), "no email address is stored");
  assert.equal(stableJson(head.decks), stableJson({ p1: "A", p2: "B" }), "decks are named by the pack's deck keys only");
  assert.ok(!JSON.stringify(allRows).includes(JSON.stringify(pack.bundle).slice(0, 200)), "the pack's content is not stored (only its hash)");
  assert.equal(head.packHash, pack.hash);
  // The stored journal is exactly what the worker held: nothing more is derivable from the device than from the worker.
  assert.equal(stableJson(journalOfRecords(head as unknown as MatchRecord, [...Array(n).keys()].map((i) => decisions.get(keyD(i)) as DecisionRecord))), stableJson(hostJournal));
  assert.equal(typeof head.matchId, "string", "local match ids are strings in the browser's own database");
  {
    // A local match id can never be a server match's (an integer `games` id): all-digit ids are refused.
    const ch = inProcessChannel({ store: storeOn(new FakeIndexedDb()) });
    const e = await startLoopMatch(ch.port, pack, "652", opts()).then(() => null, (x: unknown) => x as LocalSessionError);
    assert.equal(e?.code, "malformed", "a match id that is a server match's number is refused");
    assert.match(e!.message, /server match/);
  }
  assert.equal(LOCAL_DB_NAME, "dbs-arena-local");
  assert.deepEqual(fetchCalls, [], "no network call was made");
  const graph = checkImportGraph(path.join(ROOT, "src/lib/arena/local/storage.ts"), ROOT, diskRead, { forbidFile: offlinePackRule });
  assert.deepEqual(graph.violations, [], "storage.ts reaches no database, provider, Node builtin or network module");
  const entry = checkImportGraph(path.join(ROOT, "src/lib/arena/local/worker-entry.ts"), ROOT, diskRead, { forbidFile: offlinePackRule });
  assert.ok(entry.files.includes("src/lib/arena/local/storage.ts") && !entry.violations.length, "the worker entry journals through storage.ts and stays inside the boundary");
}

console.log(`arena-local-storage: ok — reference match of ${refJournal.entries.length} decisions on the FAKE IndexedDB (scripts/verify/fake-indexeddb.ts): identical to memory (messages byte for byte), reloaded during a human choice and an AI turn, abort/quota/crash leave the last commit, ${damagedCount} damaged saves refused by name, schema 1→2 upgrade, nothing private stored; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log("  the real-IndexedDB half: npm run arena:local-storage-browser");
