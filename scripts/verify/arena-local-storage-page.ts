/**
 * #653, TEST-ONLY: what `scripts/arena-local-storage-browser.mts` runs inside the page. Each step is
 * a function the harness calls; the harness reloads the page between steps, kills workers and
 * changes the origin's quota, and compares every board with its Node reference.
 *
 * Workers: `src/lib/arena/local/worker-entry.ts` (the real one) and, where a fault must fall inside
 * a transaction, `./arena-local-storage-worker.ts` (the same host and store plus a fault switch).
 * Both journal into the real `dbs-arena-local` database of this origin.
 */
import { LocalWorkerSession } from "../../src/components/arena/session/local";
import { replayHash } from "../../src/lib/arena/replay-core";
import { stableJson } from "../../src/lib/arena/policy/contract";
import {
  LOCAL_DB_NAME, MIGRATIONS, STORAGE_SCHEMA, indexedDbJournalStore, type Migration,
} from "../../src/lib/arena/local/storage";
import { LoopRefused, aiAsked, humanAsked, humanPick, playLoop, requestIds, resumeLoopMatch, startLoopMatch } from "./arena-local-storage-driver";

const REAL = "/src/lib/arena/local/worker-entry.ts";
const PROOF = "/scripts/verify/arena-local-storage-worker.ts";
// A fresh id stream per call and per page load: a reloaded page must not reuse a request id the saved receipts hold.
const ids = () => requestIds(1 + Math.floor(Math.random() * 0x7ffffffe));
let sessions = 0;
const boards: Record<number, string> = {};
const record = async (s: { game: { revision: number } }) => { boards[s.game.revision] = await replayHash(s); };
const sessionOptions = () => ({ newRequestId: ids(), sessionId: `page-${Date.now()}-${++sessions}` });

function worker(url: string): Worker {
  return new Worker(url, { type: "module" });
}
async function resume(url: string, pack: unknown, matchId: string) {
  const w = worker(url);
  const s = await resumeLoopMatch(w, pack, matchId, sessionOptions());
  return { w, s };
}
const proofMessage = (w: Worker, type: string) => new Promise<Record<string, unknown>>((resolve) => {
  const l = (e: MessageEvent) => { if (e.data && e.data.__proof === type) { w.removeEventListener("message", l); resolve(e.data); } };
  w.addEventListener("message", l);
});
async function arm(w: Worker, fault: "hold" | "abort") {
  const armed = proofMessage(w, "armed");
  w.postMessage({ __proof: "arm", fault });
  await armed;
}
async function saved(matchId: string) {
  const store = indexedDbJournalStore();
  try { return await store.get(matchId); } finally { store.close(); }
}
const errorOf = (e: unknown) => (e instanceof LoopRefused ? { code: e.answer.code, text: `${e.answer.message} ${(e.answer.reasons ?? []).join(" ")}` } : { code: (e as { code?: string }).code ?? "thrown", text: `${(e as Error).message} ${((e as { reasons?: string[] }).reasons ?? []).join(" ")}` });

/** Step 1: a new match on the real worker, played to a human choice at revision >= 15; the worker is then killed. */
export async function newMatch(pack: unknown, matchId: string) {
  const w = worker(REAL);
  const s = await startLoopMatch(w, pack, matchId, sessionOptions());
  await playLoop(s, { nextId: ids(), onBoard: record, stop: (x) => x.revision >= 15 && humanAsked(x.snapshot!) });
  const at = { revision: s.revision, board: await replayHash(s.snapshot), legal: s.snapshot!.legal.length };
  w.terminate();
  return { at, boards };
}

/** Step 2 (after a page reload): resume on a new worker; the board must be the one left. Then play to an AI turn, kill, resume again. */
export async function reloadAndAiTurn(pack: unknown, matchId: string) {
  const one = await resume(REAL, pack, matchId);
  const resumedAt = { revision: one.s.revision, board: await replayHash(one.s.snapshot) };
  await playLoop(one.s, { nextId: ids(), onBoard: record, stop: (x) => x.revision >= 30 && aiAsked(x.snapshot!) });
  const aiTurn = { revision: one.s.revision, board: await replayHash(one.s.snapshot) };
  one.w.terminate();
  const two = await resume(REAL, pack, matchId);
  const aiResumed = { revision: two.s.revision, board: await replayHash(two.s.snapshot) };
  // The next policy decision after the resume: one AI decision, whose board the harness compares with Node's.
  const next = await two.s.advanceRaw(1);
  if (!next.ok) throw new Error(`advance after resume refused: ${next.code} ${next.message}`);
  const nextBoard = { revision: two.s.revision, board: await replayHash(two.s.snapshot) };
  await record(two.s.snapshot!);
  two.w.terminate();
  return { resumedAt, aiTurn, aiResumed, nextBoard, boards };
}

/** Step 3: kill the worker while a commit's transaction is open (AI batch, then a human move); the device keeps the last commit. */
export async function killMidTransaction(pack: unknown, matchId: string, kills: number) {
  const out: { kind: string; committed: number; added: number; onDevice: number; resumedAt: number; board: string }[] = [];
  for (let k = 0; k < kills; k++) {
    const { w, s } = await resume(PROOF, pack, matchId);
    await playLoop(s, { nextId: ids(), onBoard: record, stop: (x) => (k % 2 === 0 ? aiAsked(x.snapshot!) : humanAsked(x.snapshot!)) && x.revision >= 32 + 6 * k });
    const committed = s.revision;
    await arm(w, "hold");
    const holding = proofMessage(w, "holding");
    const kind = humanAsked(s.snapshot!) ? "human move" : "AI batch";
    if (kind === "human move") void s.act(humanPick(s.snapshot!), committed, ids()());
    else void s.advanceRaw(4);
    const h = await holding;
    w.terminate(); // the transaction is open: decisions (and header) queued, not committed
    const device = await saved(matchId);
    const back = await resume(REAL, pack, matchId);
    out.push({ kind, committed, added: Number(h.added), onDevice: device ? device.entries.length + 1 : -1, resumedAt: back.s.revision, board: await replayHash(back.s.snapshot) });
    back.w.terminate();
  }
  return { kills: out, boards };
}

/** Step 4: an injected abort (proof worker) and a quota failure (the harness has lowered the origin's quota). */
export async function abortInjected(pack: unknown, matchId: string) {
  const { w, s } = await resume(PROOF, pack, matchId);
  await playLoop(s, { nextId: ids(), onBoard: record, stop: (x) => aiAsked(x.snapshot!) });
  const before = stableJson(await saved(matchId));
  const at = s.revision;
  await arm(w, "abort");
  const error = await playLoop(s, { nextId: ids(), maxSteps: 1 }).then(() => null, errorOf);
  const after = stableJson(await saved(matchId));
  const read = await s.read();
  w.terminate();
  return { at, error, unchanged: before === after, boardStays: read.ok && read.revision === at };
}

export async function usage() {
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? null, quota: e.quota ?? null };
}

/** A small write into a database of its own: "ok", or the name of the error (QuotaExceededError under the lowered quota). */
export async function quotaProbe(): Promise<string> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("proof-653-quota-probe", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("probe", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    const tx = db.transaction("probe", "readwrite");
    tx.objectStore("probe").put({ id: 1, pad: "x".repeat(4096), at: Math.random() });
    return await new Promise<string>((resolve) => { tx.oncomplete = () => resolve("ok"); tx.onabort = () => resolve(tx.error?.name ?? "AbortError"); });
  } finally { db.close(); }
}

/** Step 5a: with the quota lowered, resume (which writes nothing), then try twice to play on; nothing is committed. Leaves the worker for 5b. */
let quotaSession: { w: Worker; s: LocalWorkerSession } | null = null;
export async function underQuota(pack: unknown, matchId: string) {
  quotaSession = await resume(REAL, pack, matchId);
  const s = quotaSession.s;
  const before = stableJson(await saved(matchId));
  const at = s.revision;
  const errors: { code: string; text: string }[] = [];
  for (let i = 0; i < 2; i++) {
    const e = await playLoop(s, { nextId: ids(), maxSteps: 1 }).then(() => null, errorOf);
    if (e) errors.push({ ...e, text: `${humanAsked(s.snapshot!) ? "human" : "ai"}: ${e.text}` });
  }
  const after = stableJson(await saved(matchId));
  return { at, revision: s.revision, errors, unchanged: before === after, estimate: await usage() };
}

/** Step 5b: the quota restored, the same session plays on to the end. */
export async function afterQuota() {
  const { w, s } = quotaSession!;
  const at = s.revision;
  await playLoop(s, { nextId: ids(), onBoard: record });
  const final = await replayHash(s.snapshot);
  await s.dispose();
  w.terminate();
  return { at, final, status: s.snapshot!.game.status, revision: s.revision, boards };
}

/** Step 6: every byte stored for the match, read raw. */
export async function dump() {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(LOCAL_DB_NAME); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const all = (store: string) => new Promise<unknown[]>((resolve, reject) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const out = { version: db.version, stores: [...db.objectStoreNames], matches: await all("matches"), decisions: await all("decisions"), databases: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : null };
  db.close();
  return out;
}

/** Step 7: damage the real save, resume on the real worker: each refused by name; restored, it resumes. */
export async function damagedResumes(pack: unknown, matchId: string) {
  const open = () => new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open(LOCAL_DB_NAME); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  const read = async (store: string, key: IDBValidKey) => {
    const db = await open();
    const r = db.transaction(store).objectStore(store).get(key);
    const v = await new Promise<Record<string, unknown>>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    db.close();
    return v;
  };
  const write = async (fn: (matches: IDBObjectStore, decisions: IDBObjectStore) => void) => {
    const db = await open();
    const tx = db.transaction(["matches", "decisions"], "readwrite");
    fn(tx.objectStore("matches"), tx.objectStore("decisions"));
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = () => reject(tx.error); });
    db.close();
  };
  const header = await read("matches", matchId);
  const n = header.decisions as number;
  const d3 = await read("decisions", [matchId, 3]);
  const last = await read("decisions", [matchId, n - 1]);
  const tryResume = async () => {
    const w = worker(REAL);
    try {
      const s = await resumeLoopMatch(w, pack, matchId, sessionOptions());
      return { code: "ok", text: String(s.revision) };
    } catch (e) { return errorOf(e); } finally { w.terminate(); }
  };
  const restore = () => write((m, d) => { m.put(header); d.put(d3); d.put(last); });
  const cases: Record<string, { code: string; text: string }> = {};
  const damage = async (name: string, fn: (m: IDBObjectStore, d: IDBObjectStore) => void) => { await write(fn); cases[name] = await tryResume(); await restore(); };
  await damage("tamperedHeader", (m) => { m.put({ ...header, trace: "00000000" }); });
  await damage("tamperedDecision", (_m, d) => { d.put({ ...d3, entry: { ...(d3.entry as object), seat: (d3.entry as { seat: string }).seat === "p1" ? "p2" : "p1" } }); });
  await damage("truncated", (_m, d) => { d.delete([matchId, n - 1]); });
  await damage("newerRecord", (m) => { m.put({ ...header, schema: STORAGE_SCHEMA + 1 }); });
  await damage("corrupt", (m) => { m.put({ ...header, decks: "A,B" }); });
  cases.restored = await tryResume();
  return cases;
}

/** Step 8: the schema upgrade path on real IndexedDB, in a database of its own. */
export async function versions(matchId: string) {
  const name = "proof-653-versions";
  const journal = await saved(matchId);
  const v2: Migration[] = [...MIGRATIONS, { version: 2, describe: "proof: an additive step", run(db) { db.createObjectStore("proof-notes", { keyPath: "id" }); } }];
  const broken: Migration[] = [...v2, { version: 3, describe: "proof: fails half-way", run(db) { db.createObjectStore("proof-half", { keyPath: "id" }); throw new Error("disk on fire"); } }];
  const versionOf = () => new Promise<{ version: number; stores: string[] }>((resolve) => { const r = indexedDB.open(name); r.onsuccess = () => { const v = { version: r.result.version, stores: [...r.result.objectStoreNames] }; r.result.close(); resolve(v); }; });
  const attempt = async (migrations: readonly Migration[], j?: typeof journal) => {
    const store = indexedDbJournalStore({ name, migrations });
    try {
      if (j) await store.put(j);
      return { ok: stableJson(await store.get(matchId)) === stableJson(journal), code: null as string | null };
    } catch (e) { return { ok: false, code: (e as { code?: string }).code ?? "thrown" }; } finally { store.close(); }
  };
  const v1Write = await attempt(MIGRATIONS, journal!);
  const atV1 = await versionOf();
  const upgraded = await attempt(v2);
  const atV2 = await versionOf();
  const failing = await attempt(broken);
  const afterFailing = await versionOf();
  const stillV2 = await attempt(v2);
  const olderBuild = await attempt(MIGRATIONS);
  const afterOlder = await versionOf();
  const intact = await attempt(v2);
  return { v1Write, atV1, upgraded, atV2, failing, afterFailing, stillV2, olderBuild, afterOlder, intact };
}
