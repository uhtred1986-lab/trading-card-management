#!/usr/bin/env node
/**
 * #661 (plan O4-06): the desktop half of the airplane-mode release matrix, in real Chrome against a
 * PRODUCTION build. The phone half is the owner's (`docs/arena-offline-release.md`).
 *
 *   GITHUB_SHA=<40-hex> npm run build
 *   GITHUB_SHA=<same>  npm run arena:offline-release -- [--port N] [--phone-emulated] [--json] [--out FILE] [--total-timeout S] [--trace DIR]
 *
 * One `next start` (no database, no sign-in: open mode) and one Chrome profile directory:
 *
 *   1. Online, the first Chrome presses "Prepare for offline play" on `/arena/offline` (the shell, the
 *      SD15/SD5 pack and its card art). The art is a placeholder PNG answered by this script (the
 *      sandbox has no card CDN; `scripts/arena-offline-shell-browser.mts` does the same): whether the
 *      real art downloads is NOT shown here.
 *   2. The server is stopped and Chrome quits. From here every Chrome is launched with
 *      `--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost` (no host resolves, the service worker's
 *      own fetches included) and the tab is emulated offline as well: airplane mode, in a desktop browser.
 *   3. Matrix: for each of the 8 cases (deck A or B on each side, the human first or second) a NEW Chrome
 *      process on the same profile cold-launches `/arena`, which lands on the cached shell; the case's
 *      decks and seat are chosen in the page; the match is played to its END through the page's own board
 *      (`LocalBoard.act` for the human, `advance` for the computer). Each end is compared with the same
 *      match played in Node (replay hash, final revision, the device's whole journal).
 *   4. Recovery case (A v B, human first), also from a cold, offline launch: the browser is quit and
 *      relaunched at a human choice (Continue from the saved-match card; board and legal actions equal
 *      the pre-quit ones), the Worker is terminated at a choice, every IndexedDB write fails (QuotaExceeded)
 *      then "Try again", every write transaction aborts then "Try again"; the match plays to its end and
 *      equals the Node reference decision for decision.
 *
 * Measured per case and compared with the BOARD budgets (#782: `BOARD_BUDGETS` in `scripts/lib/worker-budgets.ts`,
 * derived from this script's own runs, `docs/arena-worker-budgets.md` "Board budgets"; the #643 O1 page's
 * budgets are not applied here): cold launch to the shell, Worker start, click-to-board, every human
 * move's round trip, every computer advance, long tasks, frame intervals, V8 heap of page and Worker,
 * Chrome's resident memory. A budget that is exceeded is printed `OVER` and is a release blocker: this
 * script does not exit 0 for it unless `--record` is given (it still prints it). A budget it cannot
 * measure is printed `NOT MEASURED` and fails the run the same way. A metric that cannot be measured on
 * this page at all (`BOARD_UNMEASURABLE`: `userAgentMemoryBytes`) is printed `NOT MEASURABLE` with the
 * reason, and is neither a budget nor a pass. `--phone-emulated` is judged against the same desktop
 * budgets: emulation is not a phone and gets no budgets of its own (the physical phone is the owner's).
 *
 * The board's card images must LOAD in that state (a missing image is a failed check); the art here is
 * the placeholder PNGs of step 1.
 *
 * Not shown: a physical phone, real card art over the network, an update of the shell to a NEWER build
 * while a match is saved (`arena:offline-shell-browser` covers the service worker's update rules), the
 * Safari/Firefox engines. `--phone-emulated` runs the same matrix in a 390 px touch viewport with the
 * page's CPU throttled 4x: EMULATION, not a phone, and the throttle does not reach the Worker.
 *
 * `--trace DIR` (#782) records a CDP trace and a CPU profile of each case from the Start click to the end and
 * writes, per case, the raw trace (`*.trace.json`, open it in DevTools' Performance panel), the profile
 * (`*.cpuprofile`) and `*.long-tasks.json`: every main-thread task of 50 ms or more with what filled it
 * (`scripts/lib/long-task-trace.mts`). Build with `PROFILE_SOURCEMAPS=1` to see source files and lines
 * rather than minified names. Tracing slows the page: a traced run is for attribution, not for budgets.
 *
 * Needs Chrome and a build; not part of `npm test`. Exit 0 ok, 1 a check failed (or a budget is over or unmeasured and
 * `--record` is absent), 2 usage / no Chrome / no build.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Browser, findChrome, sleep, VIEWPORTS, type Page } from "./lib/cdp.mts";
import { BOARD, IDB_FAULT, WorkerTaps, clickText, readJournalExpr, textOf, until } from "./lib/local-arena-page.mts";
import { BOARD_BUDGETS, BOARD_UNMEASURABLE, distribution, type Dist } from "./lib/worker-budgets.ts";
import { chunkLabeler, longTasks, startTrace, type LongTaskBreakdown } from "./lib/long-task-trace.mts";
import { buildMastersPack } from "./build-arena-offline-pack.mts";
import { pngFor } from "./verify/arena-pack-store-fixture.mts";
import { humanAsked, humanPick, playLoop, requestIds } from "./verify/arena-local-storage-driver.ts";
import { inProcessChannel } from "./verify/arena-local-worker-channel.ts";
import { LocalWorkerSession } from "../src/components/arena/session/local.ts";
import { memoryJournalStore, type JournalEntry } from "../src/lib/arena/local/worker.ts";
import { replayHash } from "../src/lib/arena/replay-core.ts";
import { stableJson } from "../src/lib/arena/policy/contract.ts";
import { requiredArt } from "../src/lib/arena/local/pack-store.ts";
import { SHELL_PATH, type ShellManifest } from "../src/lib/arena/local/shell.ts";
import type { Snapshot } from "../src/lib/arena/snapshot-core.ts";

function usage(message: string): never {
  console.error(`arena:offline-release: ${message}`);
  console.error("Usage: npm run arena:offline-release -- [--port N] [--phone-emulated] [--record] [--json] [--out FILE] [--total-timeout S] [--trace DIR]");
  process.exit(2);
}
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
for (const a of argv) if (a.startsWith("--") && !["--json", "--port", "--out", "--phone-emulated", "--record", "--only", "--total-timeout", "--trace"].includes(a)) usage(`unknown flag ${a}`);
const PORT = Number(flag("--port") ?? 3762);
const OUT = flag("--out");
const JSON_OUT = argv.includes("--json");
const PHONE = argv.includes("--phone-emulated");
const RECORD = argv.includes("--record");
/** Development only: play the first N cases of the matrix (and skip the recovery case when N is given). */
const ONLY = flag("--only") ? Number(flag("--only")) : null;
const TOTAL_MS = Number(flag("--total-timeout") ?? 900) * 1000;
/** #782: a directory for a CDP trace and CPU profile of each case (Start click to the end) and its long-task breakdown. */
const TRACE_DIR = flag("--trace");
if (!Number.isInteger(PORT) || PORT <= 0 || !Number.isFinite(TOTAL_MS) || TOTAL_MS <= 0) usage("bad --port or --total-timeout");
// Chrome must exist (findChrome throws otherwise)
try { findChrome(); } catch (error) { usage((error as Error).message); }
if (!fs.existsSync(".next/BUILD_ID")) usage("no production build: run `npm run build` first (with GITHUB_SHA set)");

const BASE = `http://localhost:${PORT}`;
const VIEWPORT = PHONE ? VIEWPORTS.find((v) => v.name === "phone")! : VIEWPORTS.find((v) => v.name === "desk")!;
const failures: string[] = [];
const notes: string[] = [];
const log = (s: string) => { if (!JSON_OUT) console.log(s); };
const check = (ok: unknown, what: string) => { if (ok) notes.push(`ok   ${what}`); else { failures.push(what); notes.push(`FAIL ${what}`); } return !!ok; };

// ── the server: the existing build, open mode ──────────────────────────────────────────────────
function startServer() {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(PORT), NODE_ENV: "production" };
  for (const k of Object.keys(env)) if (/^(DATABASE_URL|AUTH_SECRET|GOOGLE_CLIENT_|BASIC_AUTH_|SL_EMAILS|ARENA_ADMINS|ANTHROPIC|APP_ANTHROPIC|OPENROUTER|CLAUDE_CODE)/.test(k)) delete env[k];
  const proc = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout.on("data", (d) => { out += d; });
  proc.stderr.on("data", (d) => { out += d; });
  return { proc, log: () => out };
}
async function waitUp(): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${BASE}/arena/offline/shell.json`); if (r.ok) return true; } catch { /* not up yet */ }
    await sleep(500);
  }
  return false;
}
async function stopServer(s: ReturnType<typeof startServer>) {
  if (s.proc.exitCode !== null) return;
  const gone = new Promise((r) => s.proc.once("exit", r));
  s.proc.kill("SIGTERM");
  await Promise.race([gone, sleep(5000)]);
  if (s.proc.exitCode === null) s.proc.kill("SIGKILL");
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "arena-offline-release-"));
const server = startServer();
let browser: Browser | null = null;
const watchdog = setTimeout(async () => {
  console.error(`FAIL arena:offline-release: overall timeout of ${TOTAL_MS / 1000} s exceeded`);
  await browser?.close().catch(() => {});
  await stopServer(server);
  process.exit(1);
}, TOTAL_MS);

// ── page helpers ────────────────────────────────────────────────────────────────────────────────
const BOARD_NOW = `((window.__bc && !window.__bc.closed) ? window.__bc : (window.__bc = ${BOARD}))`;
/** Before the page's scripts: long tasks, frame intervals, and the Worker's construction-to-first-message time. */
const INSTRUMENT = `(() => {
  if (window.__rel) return;
  const rel = { long: [], frames: [], workerReady: [], marks: {} };
  window.__rel = rel;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) rel.long.push({ start: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true }); } catch {}
  let prev;
  const tick = (now) => { if (prev !== undefined && rel.frames.length < 200000) rel.frames.push({ at: now, ms: now - prev }); prev = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const W = window.Worker;
  window.__local = { workers: [] };
  window.Worker = class extends W {
    constructor(url, options) {
      super(url, options);
      const t0 = performance.now();
      window.__local.workers.push(this);
      const once = () => { rel.workerReady.push(performance.now() - t0); this.removeEventListener("message", once); };
      this.addEventListener("message", once);
    }
  };
})();`;

interface View { kind: string; restarts: number; saving: boolean; matchId: string; gameId: number; snapshot: Snapshot | null; bytes: number }
async function view(page: Page): Promise<View | null> {
  const raw = await page.eval<string | null>(`(() => { const b = ${BOARD_NOW}; if (!b) return null; const s = b.state; const raw = b.supervisor.snapshot; const snap = JSON.stringify(raw); return JSON.stringify({ kind: s.kind, restarts: s.totalRestarts, saving: b.saving, matchId: b.matchId, gameId: b.gameId, bytes: snap ? snap.length : 0, snapshot: raw }); })()`);
  return raw ? (JSON.parse(raw) as View) : null;
}
async function quiet(page: Page, ms = 30000): Promise<View> {
  const t0 = Date.now();
  let calm = 0;
  while (Date.now() - t0 < ms) {
    const v = await view(page);
    if (v && v.snapshot && !v.saving && ["owner", "storage", "failed", "stopped"].includes(v.kind)) { if (++calm >= 3) return v; } else calm = 0;
    await sleep(100);
  }
  throw new Error(`the board did not settle\n${(await textOf(page)).slice(0, 500)}`);
}
async function journal(page: Page, matchId: string) {
  const j = await page.eval<{ header: { seed: number; policySeed: number; decks: { p1: string; p2: string }; human: "p1" | "p2"; revision: number; trace: string; decisions: number }; entries: JournalEntry[] } | null>(readJournalExpr(matchId));
  if (!j) throw new Error(`match ${matchId} is not on the device`);
  return j;
}

interface Timed { ms: number; err: string | null; revision: number }
/** One board step as the stage takes it: the human's question answered, otherwise the computer asked to move. Timed in the page. */
async function step(page: Page, v: View, stats: { human: number[]; ai: Timed[]; bytes: number[] }): Promise<void> {
  const s = v.snapshot!;
  stats.bytes.push(v.bytes);
  for (let attempt = 0; attempt < 8; attempt++) {
    const r = humanAsked(s)
      ? await page.eval<{ ms: number; err: string | null }>(`(async () => { const t = performance.now(); const r = await ${BOARD_NOW}.act(${JSON.stringify(humanPick(s))}, ${s.game.revision}, crypto.randomUUID()); return { ms: performance.now() - t, err: r.error }; })()`)
      : await page.eval<{ ms: number; err: string | null }>(`(async () => { const t = performance.now(); const r = await ${BOARD_NOW}.advance(); return { ms: performance.now() - t, err: r.error }; })()`);
    if (r.err === null) {
      if (humanAsked(s)) stats.human.push(r.ms);
      else { const after = (await view(page))?.snapshot; stats.ai.push({ ms: r.ms, err: null, revision: (after?.game.revision ?? s.game.revision) - s.game.revision }); }
      return;
    }
    notes.push(`note step at revision ${s.game.revision} refused (${r.err}); retrying`);
    await sleep(200);
  }
  throw new Error(`a step was refused eight times at revision ${s.game.revision}`);
}
async function playTo(page: Page, stats: { human: number[]; ai: Timed[]; bytes: number[] }, stop: (s: Snapshot) => boolean = () => false): Promise<View> {
  for (let i = 0; i < 4000; i++) {
    const v = await quiet(page);
    const s = v.snapshot!;
    if (s.game.status === "over" || stop(s)) return v;
    await step(page, v, stats);
  }
  throw new Error("the match did not end in 4000 steps");
}
const newStats = () => ({ human: [] as number[], ai: [] as Timed[], bytes: [] as number[] });

// ── the Node reference ──────────────────────────────────────────────────────────────────────────
interface Ref { entries: JournalEntry[]; trace: string; final: string; finalRevision: number; at: Map<number, { hash: string; legal: string }> }
async function reference(pack: unknown, revision: string, start: { matchId: string; gameId: number; seed: number; policySeed: number; decks: { p1: string; p2: string }; human: "p1" | "p2" }): Promise<Ref> {
  const ch = inProcessChannel({ store: memoryJournalStore() });
  const session = await LocalWorkerSession.start(ch.port, { ...start, pack: JSON.parse(JSON.stringify(pack)), interpreterRevision: revision }, { newRequestId: requestIds(0x661), sessionId: "ref" });
  const at = new Map<number, { hash: string; legal: string }>();
  await playLoop(session, { nextId: requestIds(0x662), maxDecisions: 1, onBoard: async (s) => { at.set(s.game.revision, { hash: await replayHash(s), legal: stableJson(s.legal) }); } });
  const final = await replayHash(session.snapshot!);
  const j = ch.host.inspect()!.journal;
  const out: Ref = { entries: structuredClone(j.entries), trace: j.trace, final, finalRevision: session.snapshot!.game.revision, at };
  await session.dispose();
  return out;
}

// ── instrumentation of one cold launch ──────────────────────────────────────────────────────────
interface Launch { page: Page; taps: WorkerTaps; requests: { url: string; sw: boolean }[]; failed: string[]; launchMs: number }
function chromeRssBytes(): number | null {
  try {
    const out = execSync(`ps -eo rss=,args=`, { encoding: "utf8", maxBuffer: 64 << 20 });
    let kb = 0;
    for (const line of out.split("\n")) if (line.includes(`--user-data-dir=${profile}`)) kb += Number(line.trim().split(/\s+/)[0]) || 0;
    return kb ? kb * 1024 : null;
  } catch { return null; }
}
async function coldLaunch(): Promise<Launch> {
  const t0 = Date.now();
  // Airplane mode for the whole browser process: no host but localhost resolves (the service worker's own fetches included; the emulated offline state of a page does not reach them), and nothing listens on localhost.
  browser = await Browser.launch({ userDataDir: profile, args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"] });
  const taps = new WorkerTaps(browser, BASE);
  const page = await browser.page(VIEWPORT);
  const requests: { url: string; sw: boolean }[] = [];
  const failed: string[] = [];
  const ids = new Map<string, string>();
  browser.on((method, p) => {
    if (method === "Network.requestWillBeSent") ids.set(p.requestId, p.request.url);
    if (method === "Network.responseReceived") requests.push({ url: p.response.url, sw: !!p.response.fromServiceWorker });
    if (method === "Network.loadingFailed" && !p.canceled) failed.push(ids.get(p.requestId) ?? p.requestId);
  });
  await taps.guard(page);
  // The guard also fails card-art CDN requests at the page; here the service worker must answer them (or the image is missing), so the page's own interception is switched off. The Workers keep theirs.
  await page.cdp("Fetch.disable");
  await page.beforeLoad(`try { localStorage.setItem("arena.pace", "step"); } catch {}\n${INSTRUMENT}`);
  await page.setOffline(true);
  if (PHONE) await page.cdp("Emulation.setCPUThrottlingRate", { rate: 4 });
  return { page, taps, requests, failed, launchMs: Date.now() - t0 };
}
async function openShell(l: Launch): Promise<{ shellMs: number; startableMs: number; where: string; controlled: boolean }> {
  const t0 = Date.now();
  await l.page.goto(`${BASE}/arena`);
  await until(l.page, `document.querySelector("h1")?.textContent === "Play on this device"`, 60000);
  const shellMs = Date.now() - t0;
  const where = await l.page.eval<string>("location.pathname");
  await until(l.page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "ready"`, 60000);
  await until(l.page, `navigator.serviceWorker.controller`, 30000);
  const controlled = true;
  return { shellMs, startableMs: Date.now() - t0, where, controlled };
}
async function chooseAndStart(page: Page, mine: string, theirs: string, seat: "p1" | "p2"): Promise<number> {
  await until(page, `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Start match" && !b.disabled)`, 60000);
  await page.eval(`(() => {
    const set = (sel, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, v); sel.dispatchEvent(new Event("change", { bubbles: true })); };
    const [a, b] = document.querySelectorAll("section[aria-label='New match'] select");
    set(a, ${JSON.stringify(mine)}); set(b, ${JSON.stringify(theirs)});
  })()`);
  await clickText(page, seat === "p1" ? "First" : "Second");
  await sleep(150);
  const chosen = await page.eval<{ a: string; b: string; seat: string }>(`(() => { const [a, b] = document.querySelectorAll("section[aria-label='New match'] select"); return { a: a.value, b: b.value, seat: [...document.querySelectorAll("fieldset button")].find((x) => x.getAttribute("aria-pressed") === "true")?.textContent.trim() }; })()`);
  if (chosen.a !== mine || chosen.b !== theirs || chosen.seat !== (seat === "p1" ? "First" : "Second")) throw new Error(`the form did not take the choice: ${JSON.stringify(chosen)}`);
  const t0 = await page.eval<number>(`performance.now()`);
  await page.eval(`window.__rel.marks.click = performance.now(); 0`);
  await clickText(page, "Start match");
  await until(page, `(() => { const b = ${BOARD_NOW}; return !!(b && b.snapshot && b.state.kind === "owner"); })()`, 120000);
  const t1 = await page.eval<number>(`performance.now()`);
  await page.eval(`window.__rel.marks.board = performance.now(); 0`);
  return t1 - t0;
}

// ── what a page shows ───────────────────────────────────────────────────────────────────────────
async function pageFacts(page: Page) {
  return page.eval<{ imgs: number; sample: string[]; loaded: number; broken: number; blob: number; remote: number; alert: string | null }>(`(() => {
    const imgs = [...document.querySelectorAll("img")];
    return { imgs: imgs.length, sample: imgs.slice(0, 3).map((i) => i.currentSrc.slice(0, 120)), loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length, broken: imgs.filter((i) => !(i.complete && i.naturalWidth > 0)).length, blob: imgs.filter((i) => i.currentSrc.startsWith("blob:")).length, remote: imgs.filter((i) => /^https?:/.test(i.currentSrc) && !i.currentSrc.startsWith(location.origin)).length, alert: document.querySelector("[role=alert]")?.textContent ?? null };
  })()`);
}
async function heaps(page: Page, taps: WorkerTaps) {
  const used = async (session?: string) => {
    const send = (m: string) => (session ? browser!.send(m, {}, session) : page.cdp(m, {}));
    const before = (await send("Runtime.getHeapUsage")) as { usedSize: number };
    await send("HeapProfiler.collectGarbage").catch(() => {});
    const after = (await send("Runtime.getHeapUsage")) as { usedSize: number };
    return { before: before.usedSize, after: after.usedSize };
  };
  const main = await used();
  const workers = [];
  for (const s of taps.sessions(page)) workers.push(await used(s).catch(() => null));
  return { main, workers: workers.filter((w): w is { before: number; after: number } => !!w) };
}
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.max(0, Math.ceil(p * s.length) - 1)] : NaN; };

// ── one matrix case ─────────────────────────────────────────────────────────────────────────────
interface CaseResult {
  id: string; mine: string; theirs: string; seat: "p1" | "p2"; decks: { p1: string; p2: string };
  launchMs: number; shellMs: number; startableMs: number; workerReadyMs: number | null; matchStartMs: number;
  humanMoves: number; aiAdvances: number; aiDecisions: number; humanRtt: Dist | null; aiAdvanceRtt: Dist | null; aiMsPerDecision: Dist | null;
  revision: number; winner: string | null; reason: string | null; journalEntries: number; journalHumans: number;
  longTasks: number[]; longTaskAtStartMax: number; traced: LongTaskBreakdown[] | null; frames: number; frameP95: number; framesOver50: number;
  snapshotBytes: Dist | null; mainHeap: { before: number; after: number }; workerHeap: { before: number; after: number } | null; rssBytes: number | null;
  imgs: number; brokenImgs: number; blobImgs: number; remoteImgs: number; denied: number; webRequestsOffSw: string[];
  matchesNodeReference: boolean; seconds: number;
}
const results: CaseResult[] = [];
/** A human entry carries the page's request id (a fresh UUID per move); everything else must match the Node match. */
const decisions = (es: JournalEntry[]) => es.map((e) => (e.kind === "human" ? { seat: e.seat, kind: e.kind, action: e.action } : e));
const sameJournal = (a: JournalEntry[], b: JournalEntry[]) => a.length === b.length && stableJson(decisions(a)) === stableJson(decisions(b));
const uniqueIds = (es: JournalEntry[]) => { const ids = es.flatMap((e) => (e.kind === "human" ? [e.requestId] : [])); return new Set(ids).size === ids.length; };

async function runCase(pack: unknown, revision: string, id: string, mine: string, theirs: string, seat: "p1" | "p2"): Promise<CaseResult> {
  const t00 = Date.now();
  const l = await coldLaunch();
  try {
    const shell = await openShell(l);
    check(shell.where === SHELL_PATH, `${id}: a cold launch of /arena with no network lands on the cached shell (${shell.where})`);
    const stopTrace = TRACE_DIR ? await startTrace(browser!, l.page) : null;
    const matchStartMs = await chooseAndStart(l.page, mine, theirs, seat);
    const first = await quiet(l.page);
    const head = (await journal(l.page, first.matchId)).header;
    check(head.human === seat && head.decks.p1 === (seat === "p1" ? mine : theirs) && head.decks.p2 === (seat === "p1" ? theirs : mine), `${id}: the device holds a match of ${head.decks.p1} v ${head.decks.p2} with the human in ${head.human}`);
    const ref = reference(pack, revision, { matchId: first.matchId, gameId: first.gameId, seed: head.seed, policySeed: head.policySeed, decks: head.decks, human: head.human });
    const stats = newStats();
    const end = await playTo(l.page, stats);
    let traced: LongTaskBreakdown[] | null = null;
    if (stopTrace && TRACE_DIR) {
      const t = await stopTrace();
      traced = longTasks(t.events, t.profile, { label: await chunkLabeler(path.join(".next", "static", "chunks")) });
      fs.mkdirSync(TRACE_DIR, { recursive: true });
      const slug = id.replace(/\W+/g, "-");
      fs.writeFileSync(path.join(TRACE_DIR, `${slug}.trace.json`), JSON.stringify({ traceEvents: t.events }));
      if (t.profile) fs.writeFileSync(path.join(TRACE_DIR, `${slug}.cpuprofile`), JSON.stringify(t.profile));
      fs.writeFileSync(path.join(TRACE_DIR, `${slug}.long-tasks.json`), JSON.stringify(traced, null, 2));
      for (const lt of traced) log(`  ${id}: traced long task ${lt.ms} ms at +${lt.startMs} ms: ${lt.byEvent.slice(0, 4).map(([k, v]) => `${k} ${v}`).join("; ")}${lt.bySource.length ? ` | under ${lt.bySource.slice(0, 3).map(([k, v]) => `${k} ${v}`).join("; ")}` : ""}`);
    }
    const s = end.snapshot!;
    check(s.game.status === "over", `${id}: the match reached its end (revision ${s.game.revision})`);
    const over = (s as unknown as { over?: { winner: string | null; reason: string | null } }).over ?? null;
    const j = await journal(l.page, end.matchId);
    const r = await ref;
    const humans = j.entries.filter((e) => e.kind === "human").length;
    const same = (await replayHash(s)) === r.final && s.game.revision === r.finalRevision && sameJournal(j.entries, r.entries) && uniqueIds(j.entries) && j.header.trace === r.trace;
    check(same, `${id}: the final board and the device's journal (${j.entries.length} decisions, ${humans} the human's) equal the same match played in Node`);
    let facts = await pageFacts(l.page);
    for (let i = 0; i < 40 && facts.broken > 0; i++) { await sleep(250); facts = await pageFacts(l.page); }
    check(!facts.alert && end.kind === "owner", `${id}: no alert on the page and the tab is the writer at the end (${end.kind}${facts.alert ? `: ${facts.alert}` : ""})`);
    check(facts.imgs > 0 && facts.broken === 0 && facts.remote === 0, `${id}: ${facts.imgs} images on the final board, ${facts.loaded} loaded, ${facts.broken} missing or broken (${facts.blob} from blob: URLs, ${facts.remote} addressed to a card CDN: ${facts.sample.slice(0, 2).join(' | ')})`);
    const attemptedApi = l.requests.filter((x) => { try { return new URL(x.url).pathname.startsWith("/api/"); } catch { return false; } });
    check(attemptedApi.length === 0 && l.taps.denied.length === 0, `${id}: no API route, server action or other host was asked (${l.taps.denied.length} denied, ${attemptedApi.length} API responses)`);
    const rel = await l.page.eval<{ long: { start: number; ms: number }[]; frames: { at: number; ms: number }[]; workerReady: number[]; marks: { click: number; board: number } }>(`window.__rel`);
    const play = rel.frames.filter((f) => f.at >= rel.marks.click);
    const longPlay = rel.long.filter((t) => t.start >= rel.marks.click);
    const atStart = rel.long.filter((t) => t.start + t.ms >= rel.marks.click && t.start <= rel.marks.board);
    const hp = await heaps(l.page, l.taps);
    const aiDecisions = j.entries.length - humans;
    const aiDist = stats.ai.map((a) => a.ms / Math.max(1, a.revision));
    const out: CaseResult = {
      id, mine, theirs, seat, decks: head.decks, launchMs: l.launchMs, shellMs: shell.shellMs, startableMs: shell.startableMs,
      workerReadyMs: rel.workerReady.length ? rel.workerReady[0] : null, matchStartMs,
      humanMoves: stats.human.length, aiAdvances: stats.ai.length, aiDecisions,
      humanRtt: distribution(stats.human), aiAdvanceRtt: distribution(stats.ai.map((a) => a.ms)), aiMsPerDecision: distribution(aiDist),
      revision: s.game.revision, winner: over?.winner ?? null, reason: over?.reason ?? null, journalEntries: j.entries.length, journalHumans: humans,
      longTasks: longPlay.map((t) => t.ms), longTaskAtStartMax: atStart.length ? Math.max(...atStart.map((t) => t.ms)) : 0, traced,
      frames: play.length, frameP95: q(play.map((f) => f.ms), 0.95), framesOver50: play.filter((f) => f.ms > 50).length,
      snapshotBytes: distribution(stats.bytes), mainHeap: hp.main, workerHeap: hp.workers[0] ?? null, rssBytes: chromeRssBytes(),
      imgs: facts.imgs, brokenImgs: facts.broken, blobImgs: facts.blob, remoteImgs: facts.remote, denied: l.taps.denied.length,
      webRequestsOffSw: l.requests.filter((x) => !x.sw && /^https?:/.test(x.url)).map((x) => x.url).slice(0, 10),
      matchesNodeReference: same, seconds: Math.round((Date.now() - t00) / 1000),
    };
    log(`${id}: ${head.decks.p1} v ${head.decks.p2}, human ${head.human}: ${s.game.revision} revisions, ${stats.human.length} human moves, winner ${over?.winner ?? "?"} (${over?.reason ?? "?"}), ${out.seconds} s`);
    return out;
  } finally {
    await browser?.close().catch(() => {});
    browser = null;
  }
}

// ── the recovery case ───────────────────────────────────────────────────────────────────────────
async function recoveryCase(pack: unknown, revision: string) {
  const id = "R";
  const stats = newStats();
  let l = await coldLaunch();
  await openShell(l);
  await chooseAndStart(l.page, "A", "B", "p1");
  const first = await quiet(l.page);
  const head = (await journal(l.page, first.matchId)).header;
  const ref = await reference(pack, revision, { matchId: first.matchId, gameId: first.gameId, seed: head.seed, policySeed: head.policySeed, decks: head.decks, human: head.human });
  const seenBad = new Set<number>();
  const audit = async (v: View, what: string) => {
    const s = v.snapshot!;
    const r = ref.at.get(s.game.revision);
    const ok = !!r && r.hash === (await replayHash(s)) && r.legal === stableJson(s.legal);
    if (!ok) seenBad.add(s.game.revision);
    check(ok, `${id} ${what}: the board at revision ${s.game.revision} (hash and legal actions) equals the Node reference's`);
  };
  const humanTurn = (rev: number) => (x: Snapshot) => x.game.revision >= rev && humanAsked(x);
  const humanCount = async (page: Page) => (await journal(page, first.matchId)).entries.filter((e) => e.kind === "human").length;

  // 1. the browser is quit at a human choice and relaunched cold, offline: Continue
  await playTo(l.page, stats, humanTurn(12));
  const before = await quiet(l.page);
  const j0 = await journal(l.page, first.matchId);
  await browser!.close();
  browser = null;
  l = await coldLaunch();
  await l.page.goto(`${BASE}/arena`);
  await until(l.page, `document.body.textContent.includes("Saved match")`, 60000);
  await until(l.page, `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Continue" && !b.disabled)`, 60000);
  check(await clickText(l.page, "Continue"), `${id} relaunch: the saved match is offered on the cached shell and Continue is pressed`);
  await until(l.page, `(() => { const b = ${BOARD_NOW}; return !!(b && b.snapshot && b.state.kind === "owner"); })()`, 60000);
  let v = await quiet(l.page);
  check(v.snapshot!.game.revision === before.snapshot!.game.revision && stableJson(v.snapshot!.legal) === stableJson(before.snapshot!.legal), `${id} relaunch: the board and the legal actions are the ones from before the browser was quit (revision ${v.snapshot!.game.revision})`);
  await audit(v, "relaunch");
  check((await journal(l.page, first.matchId)).entries.length === j0.entries.length, `${id} relaunch: nothing was added or lost on the device`);

  // 2. the Worker is terminated at a human choice; the move is applied once after the restart
  {
    const s = (await playTo(l.page, stats, humanTurn(v.snapshot!.game.revision + 8))).snapshot!;
    const h0 = await humanCount(l.page);
    const restarts0 = (await view(l.page))!.restarts;
    await l.page.eval(`window.__local.workers.forEach((w) => w.terminate())`);
    const err = await l.page.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(s))}, ${s.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
    v = await quiet(l.page);
    check(err === null && v.restarts > restarts0, `${id} worker: the Worker was restarted (${v.restarts - restarts0}x) and the human's move was accepted (${err ?? "ok"})`);
    check((await humanCount(l.page)) === h0 + 1, `${id} worker: the move is on the device exactly once`);
    await audit(v, "worker");
  }

  // 3. storage failure: every IndexedDB write fails, then the device has room again
  {
    const s = (await playTo(l.page, stats, humanTurn(v.snapshot!.game.revision + 6))).snapshot!;
    const j1 = await journal(l.page, first.matchId);
    const reached = await l.taps.inWorkers(l.page, IDB_FAULT.quota);
    check(reached >= 1, `${id} storage: the fault reached the match Worker (${reached})`);
    const err = await l.page.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(s))}, ${s.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
    await until(l.page, `document.body.textContent.includes("Could not save on this device")`, 20000).catch(() => {});
    const t = await textOf(l.page);
    const st = (await view(l.page))!;
    check(!!err && /could not be saved on this device/i.test(err) && st.kind === "storage" && t.includes("Free some space") && t.includes("Try again"), `${id} storage: the move is refused with the device-full notice and Try again (${st.kind})`);
    check(st.snapshot!.game.revision === s.game.revision && (await journal(l.page, first.matchId)).entries.length === j1.entries.length, `${id} storage: the board stays at the last saved move and nothing was written`);
    await l.taps.inWorkers(l.page, IDB_FAULT.clear);
    check(await clickText(l.page, "Try again"), `${id} storage: Try again pressed`);
    await until(l.page, `(() => { const b = ${BOARD_NOW}; return b && b.state.kind === "owner"; })()`, 30000);
    v = await quiet(l.page);
    await audit(v, "storage");
    const again = await l.page.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(v.snapshot!))}, ${v.snapshot!.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
    check(again === null, `${id} storage: the move is accepted once there is room`);
  }

  // 4. storage failure: every write transaction is aborted during the computer's turn
  {
    const s = (await playTo(l.page, stats, (x) => x.game.status !== "over" && !humanAsked(x))).snapshot!;
    if (s.game.status !== "over") {
      const j2 = await journal(l.page, first.matchId);
      check((await l.taps.inWorkers(l.page, IDB_FAULT.abort)) >= 1, `${id} abort: the fault reached the match Worker`);
      const err = await l.page.eval<string | null>(`${BOARD_NOW}.advance().then((r) => r.error)`);
      await sleep(300);
      const st = (await view(l.page))!;
      const t = await textOf(l.page);
      check(!!err && (st.kind === "storage" || st.kind === "failed") && t.includes("Try again"), `${id} abort: the advance is refused with an actionable notice (${st.kind})`);
      check(st.snapshot!.game.revision === s.game.revision && (await journal(l.page, first.matchId)).entries.length === j2.entries.length, `${id} abort: the board stays at the last saved move and nothing was written`);
      await l.taps.inWorkers(l.page, IDB_FAULT.clear);
      check(await clickText(l.page, "Try again"), `${id} abort: Try again pressed`);
      await until(l.page, `(() => { const b = ${BOARD_NOW}; return b && b.state.kind === "owner"; })()`, 30000);
      v = await quiet(l.page);
      await audit(v, "abort");
    }
  }

  // 5. on to the end; the whole journal equals the reference's
  const end = await playTo(l.page, stats);
  const j = await journal(l.page, first.matchId);
  check(end.snapshot!.game.status === "over", `${id}: the match reached its end after every failure (revision ${end.snapshot!.game.revision})`);
  check(sameJournal(j.entries, ref.entries) && uniqueIds(j.entries) && j.header.trace === ref.trace && (await replayHash(end.snapshot!)) === ref.final, `${id}: the device's journal (${j.entries.length} decisions) and the final board equal the uninterrupted Node match, decision for decision`);
  check(seenBad.size === 0, `${id}: every checkpoint board equalled the reference`);
  let art = await pageFacts(l.page);
  for (let i = 0; i < 40 && art.broken > 0; i++) { await sleep(250); art = await pageFacts(l.page); }
  check(art.imgs > 0 && art.broken === 0 && art.remote === 0, `${id}: card art on the recovered board loads offline (${art.imgs} images, ${art.loaded} loaded, ${art.broken} missing, ${art.blob} from blob: URLs, ${art.remote} addressed to a card CDN)`);
  check(l.taps.denied.length === 0, `${id}: no match/provider request was made (${l.taps.denied.length} denied)`);
  await (browser as Browser | null)?.close().catch(() => {});
  browser = null;
  return { revision: end.snapshot!.game.revision, entries: j.entries.length };
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────
const t0 = Date.now();
let recovery: { revision: number; entries: number } | null = null;
let manifest: ShellManifest | null = null;
let chromeVersion = "";
try {
  if (!(await waitUp())) throw new Error(`next start did not come up on ${PORT}:\n${server.log()}`);
  manifest = (await (await fetch(`${BASE}/arena/offline/shell.json`)).json()) as ShellManifest;
  if (!manifest.revision) throw new Error("the build has no interpreter revision: build with GITHUB_SHA=<40-hex> npm run build");
  const pack = await buildMastersPack({ runtimeRevision: manifest.revision });
  check(pack.qualification.playable, `the SD15/SD5 pack is playable (${pack.hash.slice(0, 12)}, ${requiredArt(pack).length} images)`);

  // 1. prepare, online
  browser = await Browser.launch({ userDataDir: profile });
  const page = await browser.page(VIEWPORT);
  await page.interceptFetch("*/_next/image*");
  let art = 0;
  page.onFetchPaused((p) => {
    const url = new URL(p.request.url).searchParams.get("url");
    if (!url) { void page.continueFetch(p.requestId); return; }
    art++;
    setTimeout(() => void page.fulfillFetchBytes(p.requestId, pngFor(url), "image/png").catch(() => {}), 10);
  });
  chromeVersion = await page.eval<string>("navigator.userAgent").then((u) => /Chrome\/[\d.]+/.exec(u)?.[0] ?? u);
  await page.goto(`${BASE}${SHELL_PATH}`);
  await until(page, `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Prepare for offline play" && !b.disabled)`, 60000);
  const tp = Date.now();
  await clickText(page, "Prepare for offline play");
  await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "ready"`, 240000);
  const prepareMs = Date.now() - tp;
  check(true, `prepared online in ${(prepareMs / 1000).toFixed(1)} s (${art} art requests answered by this script with placeholder PNGs)`);
  await browser.close();
  browser = null;
  await stopServer(server);
  let reachable = true;
  try { await fetch(`${BASE}/`, { signal: AbortSignal.timeout(3000) }); } catch { reachable = false; }
  check(!reachable, `the server is stopped: ${BASE} refuses connections`);

  // 2. the matrix, each case from a cold offline launch
  const cases: [string, string, string, "p1" | "p2"][] = [
    ["A-v-B first", "A", "B", "p1"], ["A-v-B second", "A", "B", "p2"],
    ["B-v-A first", "B", "A", "p1"], ["B-v-A second", "B", "A", "p2"],
    ["A-v-A first", "A", "A", "p1"], ["A-v-A second", "A", "A", "p2"],
    ["B-v-B first", "B", "B", "p1"], ["B-v-B second", "B", "B", "p2"],
  ];
  for (const [id, mine, theirs, seat] of cases.slice(0, ONLY ?? cases.length)) results.push(await runCase(pack, manifest.revision, id, mine, theirs, seat));
  if (ONLY === null) recovery = await recoveryCase(pack, manifest.revision);
} catch (e) {
  failures.push(`the run stopped: ${(e as Error).message}`);
  notes.push(`FAIL the run stopped: ${(e as Error).stack ?? e}`);
} finally {
  clearTimeout(watchdog);
  await browser?.close().catch(() => {});
  await stopServer(server);
  fs.rmSync(profile, { recursive: true, force: true });
}

// ── budgets ─────────────────────────────────────────────────────────────────────────────────────
interface Row { budget: string; limit: number | null; unit: string; measured: number | null; verdict: "ok" | "OVER" | "NOT MEASURED" | "NOT MEASURABLE"; how: string }
const budget = (metric: string) => { const b = BOARD_BUDGETS.find((x) => x.metric === metric && !x.config); if (!b) throw new Error(`no board budget named ${metric}`); return b; };
const rows: Row[] = [];
const judge = (metric: string, measured: number | null, how: string) => {
  const b = budget(metric);
  const verdict = measured === null || Number.isNaN(measured) ? "NOT MEASURED" : (b.atLeast ? measured < b.limit : measured > b.limit) ? "OVER" : "ok";
  rows.push({ budget: metric, limit: b.limit, unit: b.unit, measured: measured === null || Number.isNaN(measured) ? null : Math.round(measured * 100) / 100, verdict, how });
};
if (results.length) {
  judge("roundTripMs.p95", Math.max(...results.map((r) => r.humanRtt?.p95 ?? NaN)), "worst case's p95 of the human move round trip (act to result), page-measured");
  judge("roundTripMs.max", Math.max(...results.map((r) => r.humanRtt?.max ?? NaN)), "slowest human move of all cases");
  judge("decisionMs.max", Math.max(...results.map((r) => r.aiMsPerDecision?.max ?? NaN)), "slowest computer advance divided by the decisions it committed, page-measured (as arena:local-worker-browser does)");
  judge("coldWorkerStartMs.p50", q(results.flatMap((r) => (r.workerReadyMs === null ? [] : [r.workerReadyMs])), 0.5), "Worker construction to its first message, from the service-worker cache, page-measured");
  judge("coldWorkerStartMs.max", Math.max(...results.map((r) => r.workerReadyMs ?? NaN)), "slowest of the cold starts");
  judge("matchStartMs.p95", q(results.map((r) => r.matchStartMs), 0.95), "Start-match click to the first board (includes the page's own render; nearest-rank p95 of the cases)");
  judge("frameIntervalMs.p95", Math.max(...results.map((r) => r.frameP95)), "worst case's p95 requestAnimationFrame interval from the Start click to the end");
  judge("framesOver50Ms", Math.max(...results.map((r) => r.framesOver50)), "most frames over 50 ms in one case (the budget counts ~1,300 frames)");
  judge("longTaskCount", Math.max(...results.map((r) => r.longTasks.length)), "most long tasks (>= 50 ms) in one case, Start click to the end");
  judge("longTaskMaxMs", Math.max(...results.flatMap((r) => r.longTasks), 0), "longest long task of all cases (0 = none seen)");
  judge("longTaskAtMatchStartMaxMs", Math.max(...results.map((r) => r.longTaskAtStartMax)), "longest long task overlapping the match start");
  judge("workerHeapRetainedBytes", Math.max(...results.map((r) => r.workerHeap?.after ?? NaN)), "match Worker V8 heap after a forced GC, end of one match");
  judge("workerHeapAfterBulkBytes", Math.max(...results.map((r) => r.workerHeap?.before ?? NaN)), "match Worker V8 heap at the end of one match before GC (the budget is after 20 games)");
  judge("mainHeapBytes", Math.max(...results.map((r) => r.mainHeap.after)), "page V8 heap after a forced GC, end of one match, WITH the React app");
  // Every board budget is judged: one this script has no figure for is a failure, not a silent pass.
  for (const b of BOARD_BUDGETS) if (!rows.some((r) => r.budget === b.metric)) judge(b.metric, null, "no figure for this budget in this run");
  for (const u of BOARD_UNMEASURABLE) rows.push({ budget: u.metric, limit: null, unit: "", measured: null, verdict: "NOT MEASURABLE", how: u.why });
}
const rss = results.map((r) => r.rssBytes).filter((x): x is number => x !== null);

const summary = {
  tool: "arena:offline-release", at: new Date().toISOString(), chrome: chromeVersion, viewport: VIEWPORT, cpuThrottle: PHONE ? "4x on the page only (emulation)" : "none",
  shell: manifest ? { version: manifest.version, revision: manifest.revision } : null,
  cases: results, recovery, budgets: rows, chromeRssBytes: rss.length ? { max: Math.max(...rss), min: Math.min(...rss) } : null,
  failures, seconds: Math.round((Date.now() - t0) / 1000),
  evidence: PHONE ? "headless desktop Chrome, EMULATED phone viewport and 4x page CPU throttle: not a phone" : "headless desktop Chrome: not a phone",
};
if (OUT) fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
if (JSON_OUT) console.log(JSON.stringify({ ...summary, notes }, null, 2));
else {
  for (const n of notes) console.log(n);
  console.log(`\n${chromeVersion}, ${VIEWPORT.width}x${VIEWPORT.height}${PHONE ? " (EMULATED phone, 4x page CPU throttle)" : ""}, shell ${manifest?.version ?? "?"}`);
  console.log("\ncase           launch  shell  startable  worker  start→board  human rtt p95/max  AI ms/dec p95/max  revs  winner  heap main/worker (MB, after GC)  RSS MB");
  for (const r of results) console.log(`${r.id.padEnd(14)} ${String(r.launchMs).padStart(5)}  ${String(r.shellMs).padStart(5)}  ${String(r.startableMs).padStart(9)}  ${String(Math.round(r.workerReadyMs ?? -1)).padStart(6)}  ${String(Math.round(r.matchStartMs)).padStart(11)}  ${(r.humanRtt ? `${r.humanRtt.p95}/${r.humanRtt.max}` : "-").padStart(17)}  ${(r.aiMsPerDecision ? `${r.aiMsPerDecision.p95}/${r.aiMsPerDecision.max}` : "-").padStart(17)}  ${String(r.revision).padStart(4)}  ${String(r.winner).padEnd(6)}  ${(r.mainHeap.after / 1e6).toFixed(1)}/${r.workerHeap ? (r.workerHeap.after / 1e6).toFixed(1) : "-"}  ${r.rssBytes ? (r.rssBytes / 1e6).toFixed(0) : "-"}`);
  console.log("\nboard budget (docs/arena-worker-budgets.md)        limit        measured      verdict");
  for (const r of rows) console.log(`${r.budget.padEnd(36)} ${String(r.limit ?? "-").padStart(10)} ${r.unit.padEnd(5)} ${String(r.measured ?? "-").padStart(10)}  ${r.verdict}   ${r.how}`);
  const over = rows.filter((r) => r.verdict === "OVER" || r.verdict === "NOT MEASURED");
  console.log(`\n${results.length} of 8 matrix cases played to the end${recovery ? `; recovery case ended at revision ${recovery.revision} (${recovery.entries} decisions)` : "; recovery case did not finish"}; ${summary.seconds} s`);
  console.log(`${over.length} budget(s) not met: ${over.map((r) => `${r.budget} ${r.verdict}`).join(", ") || "none"}`);
  console.log(PHONE ? "EMULATION only: not a phone." : "Headless desktop Chrome: not a phone. Physical-phone evidence: the owner's, unverified.");
  console.log(failures.length ? `\narena:offline-release: ${failures.length} FAILED\n${failures.join("\n")}` : "\narena:offline-release: every check passed");
}
const overBudgets = rows.some((r) => r.verdict === "OVER" || r.verdict === "NOT MEASURED");
process.exit(failures.length || (overBudgets && !RECORD) ? 1 : 0);
