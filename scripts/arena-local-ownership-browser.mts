#!/usr/bin/env node
/**
 * #654: one writer per local match and worker recovery in real Chrome — the browser half of
 * `scripts/verify/arena-local-ownership.mts`. TWO tabs on one origin share the real IndexedDB, Web
 * Locks and BroadcastChannel; each runs a `LocalMatchSupervisor` (`src/lib/arena/local/recovery.ts`)
 * over real module Workers (`scripts/verify/arena-local-ownership-worker.ts`: the real host and store
 * plus a fault switch). In the tabs (`scripts/verify/arena-local-ownership-page.ts`):
 *
 *   1. claims at the same instant from both tabs, with Web Locks and with the lease alone: exactly
 *      one tab gets the match each time;
 *   2. tab A owns a match; tab B opens it and is watching (`busy-elsewhere`, the holder named), shows
 *      A's board read-only and follows A's commits; B's moves are refused and write nothing;
 *   3. concurrent writers: B takes the match over while A is in the middle of a long AI advance —
 *      exactly one keeps writing (B), A is refused and becomes a watcher, the device holds one linear
 *      history (the reference game);
 *   4. the holder's tab (B) is closed: A, waiting on the lock, takes over at once and resumes the
 *      identical board;
 *   5. A's worker is killed mid-AI-batch (its commit transaction open), after an AI batch was
 *      persisted, mid-human-move and after a human move was persisted: each time the supervisor
 *      notices the silence, restarts the worker, resumes at the last commit and answers — the move
 *      applied once (a duplicate answer after persistence), the batch recomputed — and the game ends
 *      on the reference's final board, decision for decision;
 *   6. a frozen owner (DevTools page lifecycle, lease-only mode): its lease ages, tab C takes over and
 *      plays; A is thawed, its move is refused (`busy-elsewhere`), it watches C's history, the device
 *      unchanged by it;
 *   7. dispose in each tab: no lock held or pending, the lease released, nothing left running.
 *
 * Every board any tab saw is compared with the Node reference at that revision. Every request is a
 * repo module: no server, no database. Needs Chrome; not part of `npm test`. Exit 0 ok, 1 a check
 * failed, 2 usage/no Chrome.
 *
 *   npm run arena:local-ownership-browser -- [--json] [--total-timeout S]
 */
import { Browser, findChrome } from "./lib/cdp.mts";
import { serveRepoModules } from "./lib/module-server.mts";
import { stagedPack } from "./verify/arena-local-worker-fixture.mts";
import { inProcessChannel } from "./verify/arena-local-worker-channel.ts";
import { memoryJournalStore, type MatchJournal } from "../src/lib/arena/local/worker.ts";
import { playLoop, requestIds, startLoopMatch } from "./verify/arena-local-storage-driver.ts";
import { replayHash } from "../src/lib/arena/replay-core.ts";
import { stableJson } from "../src/lib/arena/policy/contract.ts";

function usage(message: string): never {
  console.error(`arena:local-ownership-browser: ${message}`);
  console.error("Usage: npm run arena:local-ownership-browser -- [--json] [--total-timeout S]");
  process.exit(2);
}
const argv = process.argv.slice(2);
for (const a of argv) if (a.startsWith("--") && a !== "--json" && a !== "--total-timeout") usage(`unknown flag ${a}`);
const timeoutAt = argv.indexOf("--total-timeout");
const TOTAL_MS = (timeoutAt >= 0 ? Number(argv[timeoutAt + 1]) : 600) * 1000;
if (!Number.isFinite(TOTAL_MS) || TOTAL_MS <= 0) usage("--total-timeout must be a positive number of seconds");
const JSON_OUT = argv.includes("--json");
try { findChrome(); } catch (error) { console.error(`arena:local-ownership-browser: ${(error as Error).message}`); process.exit(2); }

const PAGE = `<!doctype html><meta charset="utf-8"><title>arena local ownership</title>
<script type="module">
  import * as P from "/scripts/verify/arena-local-ownership-page.ts";
  globalThis.__P = P;
  globalThis.__ready = true;
</script>`;
const RUN = Date.now().toString(36);
const MATCH = `local-654-${RUN}`;
const FROZEN = `local-654-frozen-${RUN}`;

const failures: string[] = [];
const notes: string[] = [];
const check = (ok: unknown, what: string) => { if (ok) notes.push(`ok   ${what}`); else { failures.push(what); notes.push(`FAIL ${what}`); } };

// The Node reference: one AI decision per advance, so it has a board at every revision.
const pack = await stagedPack();
const ref = new Map<number, string>();
const refCh = inProcessChannel({ store: memoryJournalStore() });
const refSession = await startLoopMatch(refCh.port, pack, MATCH, { newRequestId: requestIds(0x654), sessionId: "ref" });
await playLoop(refSession, { nextId: requestIds(0x655), maxDecisions: 1, onBoard: async (s) => { ref.set(s.game.revision, await replayHash(s)); } });
const refFinal = await replayHash(refSession.snapshot);
const refJournal: MatchJournal = refCh.host.inspect()!.journal;
await refSession.dispose();
const refDecisions = refJournal.entries.map((e) => (e.kind === "ai" ? e.id : JSON.stringify(e.action)));
const prefixOfRef = (d: { decisions: string[] } | null) => !!d && stableJson(d.decisions) === stableJson(refDecisions.slice(0, d.decisions.length));

const server = await serveRepoModules(process.cwd(), PAGE);
const browser = await Browser.launch();
const watchdog = setTimeout(async () => {
  console.error(`FAIL arena:local-ownership-browser: overall timeout of ${TOTAL_MS / 1000} s exceeded; stopping Chrome`);
  await browser.close();
  server.close();
  process.exit(1);
}, TOTAL_MS);

type Page = Awaited<ReturnType<Browser["page"]>>;
async function inPage<T>(page: Page, expr: string): Promise<T> {
  const key = `__p${Math.random().toString(36).slice(2)}`;
  await page.eval(`globalThis.${key} = null; (async () => { try { globalThis.${key} = { ok: true, v: await (${expr}) }; } catch (e) { globalThis.${key} = { ok: false, e: String(e && e.stack || e) }; } })(); 0`);
  for (;;) {
    const r = await page.eval<{ ok: boolean; v?: T; e?: string } | null>(`globalThis.${key}`);
    if (r) { if (!r.ok) throw new Error(r.e); return r.v as T; }
    await new Promise((res) => setTimeout(res, 100));
  }
}
async function load(page: Page) {
  await page.goto(`${server.origin}/`, 60000);
  for (let i = 0; i < 200 && !(await page.eval<boolean>("!!globalThis.__ready")); i++) await new Promise((r) => setTimeout(r, 100));
  await page.eval(`globalThis.__pack = JSON.parse(${JSON.stringify(JSON.stringify(pack))}); 0`);
}
const P = <T,>(page: Page, call: string) => inPage<T>(page, `globalThis.__P.${call}`);
const q = (v: unknown) => JSON.stringify(v);
interface View { state: { kind: string; code: string | null; detail: string | null; holder: string | null; watching: string | null; fence: { holder: string; epoch: number } | null; totalRestarts: number; mode: string }; revision: number; board: string | null }
interface Device { revision: number; decisions: string[]; trace: string; humanIds: string[] }
const allBoards = new Map<number, string>();
const takeBoards = async (page: Page) => { const s = await P<{ boards: Record<string, string> }>(page, "seen()"); for (const [r, h] of Object.entries(s.boards)) allBoards.set(Number(r), h); };
const isRef = (v: View) => v.board !== null && v.board === ref.get(v.revision);

const report: Record<string, unknown> = {};
try {
  const A = await browser.page({ name: "tab-a", width: 1000, height: 700, mobile: false });
  const B = await browser.page({ name: "tab-b", width: 1000, height: 700, mobile: false });
  await load(A);
  await load(B);
  report.userAgent = await A.eval<string>("navigator.userAgent");
  check(await A.eval<boolean>("!!navigator.locks && typeof BroadcastChannel === 'function'"), "Chrome offers Web Locks and BroadcastChannel");

  // 1. Claims at the same instant.
  for (const lease of [false, true]) {
    const rounds: string[] = [];
    let good = 0;
    for (let i = 0; i < 4; i++) {
      const id = `race-${lease ? "lease" : "locks"}-${RUN}-${i}`;
      const goAt = Date.now() + 600;
      const [ra, rb] = await Promise.all([P<{ ok: boolean; via?: string }>(A, `claimAt(${q(id)}, ${goAt}, ${lease})`), P<{ ok: boolean; via?: string }>(B, `claimAt(${q(id)}, ${goAt}, ${lease})`)]);
      if (Number(ra.ok) + Number(rb.ok) === 1) good++;
      rounds.push(`${ra.ok ? "A" : "-"}${rb.ok ? "B" : "-"}`);
    }
    check(good === 4, `1. ${lease ? "lease only" : "Web Locks"}: two tabs claiming at the same instant, four times — exactly one tab got the match each time (${rounds.join(" ")})`);
  }

  // 2. A owns, B watches.
  const a1 = await P<View>(A, `open(globalThis.__pack, ${q(MATCH)}, true)`);
  check(a1.state.kind === "owner" && a1.state.mode === "web-locks", `2. tab A opens a new match and owns it (${a1.state.kind}, ${a1.state.mode}, epoch ${a1.state.fence?.epoch})`);
  const a2 = await P<View>(A, `playTo(10, "human")`);
  const b1 = await P<View>(B, `open(globalThis.__pack, ${q(MATCH)}, false)`);
  check(b1.state.kind === "watching" && b1.state.code === "busy-elsewhere" && b1.state.holder === a1.state.fence?.holder, `2. tab B opening it is watching: busy-elsewhere, holder named (${b1.state.kind}, ${b1.state.code})`);
  check(b1.board === a2.board && b1.revision === a2.revision && isRef(b1), `2. B shows A's board read-only (revision ${b1.revision})`);
  const before = await P<Device>(A, `device(${q(MATCH)})`);
  const bTry = await P<{ ok: boolean; code: string | null }>(B, "tryMove()");
  const after = await P<Device>(A, `device(${q(MATCH)})`);
  check(!bTry.ok && bTry.code === "busy-elsewhere" && stableJson(before) === stableJson(after), "2. B's move is refused as busy-elsewhere and nothing is written");
  const a3 = await P<View>(A, `playTo(20, "human")`);
  const b2 = await P<View & { ok: boolean }>(B, `waitFor("watching", ${a3.revision})`);
  check(b2.ok && b2.revision === a3.revision && b2.board === a3.board, `2. B's board follows A's commits (to revision ${a3.revision})`);

  // 3. Concurrent writers: B takes over during A's long AI advance.
  await P<View>(A, `playTo(24, "ai")`);
  await P<boolean>(A, "startAdvance(60)");
  await new Promise((r) => setTimeout(r, 30));
  const bTook = await P<View>(B, "takeOver()");
  const aAdv = await P<View & { ok: boolean; code: string | null }>(A, "awaitAdvance()");
  check(bTook.state.kind === "owner" && (bTook.state.fence?.epoch ?? 0) > (a1.state.fence?.epoch ?? 0), `3. B takes the match over (epoch ${bTook.state.fence?.epoch}) while A is advancing`);
  const aAfter = await P<{ ok: boolean; code: string | null }>(A, "tryMove()");
  const aWatch = await P<View & { ok: boolean }>(A, `waitFor("watching")`);
  check((!aAdv.ok ? aAdv.code === "busy-elsewhere" : true) && !aAfter.ok && aAfter.code === "busy-elsewhere" && aWatch.ok && aWatch.state.watching === "taken-over",
    `3. A is refused (its advance: ${aAdv.ok ? "finished before the takeover" : aAdv.code}; its next move: ${aAfter.code}) and becomes a watcher`);
  report.statesA = (await P<{ states: string[] }>(A, "seen()")).states;
  report.statesB = (await P<{ states: string[] }>(B, "seen()")).states;
  const spurious = [...(report.statesA as string[]), ...(report.statesB as string[])].filter((x) => x.startsWith("recovering") || x.startsWith("failed"));
  check(!spurious.length && bTook.state.fence?.epoch === (a1.state.fence?.epoch ?? 0) + 1, `3. no worker restart in either tab, and exactly one new epoch for the takeover${spurious.length ? `: ${spurious.join("; ")}` : ""}`);
  const dev3 = await P<Device>(B, `device(${q(MATCH)})`);
  check(prefixOfRef(dev3), `3. the device holds one linear history: the reference game's first ${dev3?.decisions.length} decisions`);
  check(isRef(bTook) && bTook.revision === dev3!.revision, `3. B resumed at the device's last commit (revision ${bTook.revision}) on the reference board`);
  const b3 = await P<View>(B, `playTo(${bTook.revision + 6}, "human")`);
  const aSees = await P<View & { ok: boolean }>(A, `waitFor("watching", ${b3.revision})`);
  check(aSees.ok && aSees.board === b3.board, `3. A now follows B's history (revision ${b3.revision})`);

  // 4. The holder's tab (B) is closed: A takes over at once and resumes the identical board.
  await takeBoards(B);
  const bLast = await P<View>(B, "info()");
  const closedAt = Date.now();
  await B.close();
  const aOwner = await P<View & { ok: boolean }>(A, `waitFor("owner", 0, 30000)`);
  report.takeoverMs = Date.now() - closedAt;
  check(aOwner.ok && aOwner.revision === bLast.revision && aOwner.board === bLast.board && (aOwner.state.fence?.epoch ?? 0) > (bTook.state.fence?.epoch ?? 0),
    `4. B's tab closed: A takes over in ${report.takeoverMs} ms (epoch ${aOwner.state.fence?.epoch}) and resumes the identical board at revision ${aOwner.revision}`);

  // 5. Kills in A's worker.
  const kills: unknown[] = [];
  const kill = async (fault: "hold" | "after", kind: "human" | "ai", min: number) => {
    await P<View>(A, `playTo(${min}, ${q(kind)})`);
    const k = await P<View & { at: number; ok: boolean; code: string | null; duplicate: boolean; restarts: number; requestId: string; signal: Record<string, unknown> }>(A, `killDuring(${q(fault)}, ${q(kind)})`);
    kills.push({ fault, kind, at: k.at, revision: k.revision, ok: k.ok, duplicate: k.duplicate, restarts: k.restarts });
    return k;
  };
  const k1 = await kill("hold", "ai", aOwner.revision + 2);
  check(k1.ok && k1.restarts === 1 && k1.revision > k1.at && isRef(k1), `5. worker killed mid-AI-batch (transaction open, ${String(k1.signal.added)} decision(s) queued): restarted once, resumed at ${k1.at}, the batch recomputed — revision ${k1.revision} is the reference's board`);
  const k2 = await kill("after", "ai", k1.revision + 4);
  check(k2.ok && k2.restarts === 1 && k2.revision > k2.at && isRef(k2), `5. worker killed after an AI batch was persisted (revision ${String(k2.signal.revision)}): restarted, resumed there, the reference's board at ${k2.revision}`);
  const k3 = await kill("hold", "human", k2.revision + 2);
  check(k3.ok && !k3.duplicate && k3.restarts === 1 && k3.revision === k3.at + 1 && isRef(k3), `5. worker killed mid-human-move: restarted, the move sent again with its request id and applied once (revision ${k3.revision})`);
  const k4 = await kill("after", "human", k3.revision + 4);
  check(k4.ok && k4.duplicate && k4.restarts === 1 && k4.revision === k4.at + 1 && isRef(k4), `5. worker killed after a human move was persisted: restarted, the resent move answered from its receipt (duplicate), nothing played twice`);
  report.kills = kills;
  const end = await P<View & { result: string }>(A, "playToEnd()");
  const devEnd = await P<Device>(A, `device(${q(MATCH)})`);
  check(end.result === "over" && end.board === refFinal, `5. the game ends on the reference's final board (revision ${end.revision})`);
  check(!!devEnd && stableJson(devEnd.decisions) === stableJson(refDecisions) && devEnd.trace === refJournal.trace, `5. the device holds the reference game decision for decision (${devEnd?.decisions.length}), the same trace: no duplicate move, no RNG drift`);
  check(!!devEnd && [k3.requestId, k4.requestId].every((id) => devEnd.humanIds.filter((x) => x === id).length === 1), "5. each killed human move is on the device exactly once");
  await takeBoards(A);
  const dA = await P<{ resources: Record<string, unknown>; lease: { released: boolean } | null; locks: { held: number; pending: number } }>(A, `dispose(${q(MATCH)})`);
  const r = dA.resources as { worker: boolean; session: boolean; ping: boolean; guards: number; waiting: boolean; hints: boolean; ownership: unknown };
  check(!r.worker && !r.session && !r.ping && r.guards === 0 && !r.waiting && !r.hints && r.ownership === null && dA.lease?.released && dA.locks.held + dA.locks.pending === 0,
    "7. A disposed: no worker, timer, channel or lock left, the lease released");

  // 6. A frozen owner (lease-only mode).
  const C = await browser.page({ name: "tab-c", width: 1000, height: 700, mobile: false });
  await load(C);
  await load(A);
  const f1 = await P<View>(A, `open(globalThis.__pack, ${q(FROZEN)}, true, { lease: true })`);
  const f2 = await P<View>(A, `playTo(12, "human")`);
  const c1 = await P<View>(C, `open(globalThis.__pack, ${q(FROZEN)}, false, { lease: true })`);
  check(f1.state.kind === "owner" && f1.state.mode === "lease" && c1.state.kind === "watching", "6. lease-only: A owns a second match, C watches it");
  await A.cdp("Page.setWebLifecycleState", { state: "frozen" });
  const frozenAt = Date.now();
  const cOwner = await P<View & { ok: boolean }>(C, `waitFor("owner", 0, 30000)`);
  report.frozenTakeoverMs = Date.now() - frozenAt;
  check(cOwner.ok && cOwner.revision === f2.revision && cOwner.board === f2.board, `6. A frozen: its lease aged and C took over after ${report.frozenTakeoverMs} ms, at A's last board (revision ${cOwner.revision})`);
  const c2 = await P<View>(C, `playTo(${cOwner.revision + 8}, "human")`);
  const devC = await P<Device>(C, `device(${q(FROZEN)})`);
  await A.cdp("Page.setWebLifecycleState", { state: "active" });
  const aLate = await P<{ ok: boolean; code: string | null; message: string | null }>(A, "tryMove()");
  const devAfter = await P<Device>(C, `device(${q(FROZEN)})`);
  check(!aLate.ok && aLate.code === "busy-elsewhere", `6. A thawed: its move on the board it was showing is refused as busy-elsewhere (${aLate.message})`);
  check(stableJson(devAfter) === stableJson(devC) && prefixOfRef(devAfter), "6. the device holds exactly C's history, untouched by A, the reference game");
  const aFollows = await P<View & { ok: boolean }>(A, `waitFor("watching", ${c2.revision})`);
  check(aFollows.ok && aFollows.board === c2.board, `6. A becomes a watcher of C's history (revision ${c2.revision})`);
  await takeBoards(A);
  await takeBoards(C);
  for (const [name, page] of [["C", C], ["A", A]] as const) {
    const d = await P<{ resources: { worker: boolean; session: boolean; ping: boolean; guards: number; waiting: boolean; hints: boolean; ownership: unknown }; lease: { released: boolean; holder: string } | null; locks: { held: number; pending: number } }>(page, `dispose(${q(FROZEN)})`);
    const x = d.resources;
    check(!x.worker && !x.session && !x.ping && x.guards === 0 && !x.waiting && !x.hints && x.ownership === null && d.locks.held + d.locks.pending === 0, `7. ${name} disposed: nothing left running or held`);
    if (name === "C") check(d.lease?.released, "7. C (the owner) released the lease on dispose");
  }

  // Every board any tab saw.
  const wrong = [...allBoards].filter(([rev, h]) => ref.get(rev) !== h).map(([rev]) => rev);
  check(allBoards.size > 50 && wrong.length === 0, `every board the tabs saw (${allBoards.size} revisions) is the reference's${wrong.length ? `; differing at ${wrong.slice(0, 5).join(", ")}` : ""}`);
  const foreign = server.requests.filter((p) => p !== "/" && p !== "/favicon.ico" && !/^\/(src|scripts)\//.test(p));
  check(!foreign.length && !server.refused.length, `no request but repo modules (${server.requests.length} requests; no /api, no database)${foreign.length ? `: ${foreign.join(", ")}` : ""}`);
} catch (error) {
  failures.push(`browser run failed: ${(error as Error).message}`);
} finally {
  clearTimeout(watchdog);
  await browser.close();
  server.close();
}
report.checks = notes;
report.failures = failures;
if (JSON_OUT) console.log(JSON.stringify(report, null, 2));
else {
  console.log(String(report.userAgent ?? "(no browser)"));
  for (const n of notes) console.log(n);
  for (const f of failures.filter((f) => f.startsWith("browser run failed"))) console.log(`FAIL ${f}`);
  console.log(`takeover after a closed tab: ${String(report.takeoverMs)} ms; after a frozen one (lease only): ${String(report.frozenTakeoverMs)} ms`);
  console.log(failures.length ? "FAIL" : "ok");
}
process.exit(failures.length ? 1 : 0);
