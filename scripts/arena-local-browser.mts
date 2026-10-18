#!/usr/bin/env node
/**
 * #657 (plan O3-06): local match recovery in real Chrome, against a PRODUCTION build of the app.
 *
 * `/arena/local` ("Play on this device", #656) is opened from `next start` with no database and no
 * auth (open local-dev mode). The match runs in the page's real module Worker on the real IndexedDB,
 * with real Web Locks between tabs. Every match/provider request — an API route, a server action, any
 * other host — is failed at the browser (CDP Fetch on the page and on every Worker it starts) and
 * counted, and between reloads the tab is taken fully offline (`Network.emulateNetworkConditions`).
 * The pack is the audited SD15/SD5 pack (`auditPack()`, qualifying since #757) chosen in the page's
 * file input, as a player does until the pack store (#658) lands.
 *
 * One match (human p1) is played start to finish with a failure at each checkpoint:
 *
 *   reload-choice     reload while the human is being asked; Continue from the saved-match card
 *   inject            the human moves, then the real Worker is posted the same `apply` again
 *                     (duplicate) and one with the old revision (stale), and the page's Worker object
 *                     is handed a duplicate and an older answer; nothing moves twice
 *   kill-choice       the real Worker is terminated, then the human moves: restart, applied once
 *   kill-ai           the real Worker is terminated mid AI advance
 *   reload-ai-turn    reload when the computer is to move (after the human's move, before any advance)
 *   reload-ai-batch   reload while an AI advance is running in the Worker
 *   storage-quota     every IndexedDB put in the Worker throws QuotaExceededError: the move is refused
 *                     with the device-full notice, the board stays; "Try again" works once there is room
 *   storage-abort     every read-write transaction in the Worker is aborted: likewise for an AI advance
 *   race              the tab is closed; two fresh tabs press Continue at the same instant: exactly one
 *                     writes, the other watches; "Play here instead" moves the writer, the old tab is fenced
 *
 * After every successful recovery the board must equal the uninterrupted reference (the same seeds,
 * decks and human choices replayed by the same host in Node, one AI decision per step): its replay
 * hash, its next legal actions, and — from the final journal — the next AI policy decision. At the
 * end the device's whole journal (every decision, the trace) equals the reference's: no move was
 * applied twice and none was lost. Every board any tab showed is checked against the reference.
 *
 * What this is NOT: physical-device evidence. It is headless desktop Chrome; storage faults are
 * injected into the Worker's IndexedDB calls (Chrome's quota override does not bite on localhost
 * headless). Phones, real full disks, OS-killed tabs and cold offline launch (O4) are the owner's.
 *
 *   npm run build && npm run arena:local-browser -- [--base URL] [--json] [--total-timeout S]
 *
 * Without `--base` it serves `.next` itself (`next start` on a free port, DATABASE_URL and the auth
 * variables removed). Needs Chrome and a production build; no database, no network. Not part of
 * `npm test`. Exit 0 ok, 1 a check failed, 2 usage / no Chrome / no build.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { Browser, findChrome, sleep, VIEWPORTS, type Page } from "./lib/cdp.mts";
import { BOARD, IDB_FAULT, WORKER_TAP, WorkerTaps, chooseLocalSetup, choosePack, clickText, readJournalExpr, textOf, until } from "./lib/local-arena-page.mts";
import { auditPack } from "./verify/arena-local-worker-fixture.mts";
import { inProcessChannel } from "./verify/arena-local-worker-channel.ts";
import { humanAsked, humanPick, playLoop, requestIds } from "./verify/arena-local-storage-driver.ts";
import { LocalWorkerSession } from "../src/components/arena/session/local.ts";
import { memoryJournalStore, type JournalEntry } from "../src/lib/arena/local/worker.ts";
import { replayHash } from "../src/lib/arena/replay-core.ts";
import { stableJson } from "../src/lib/arena/policy/contract.ts";
import type { Snapshot } from "../src/lib/arena/snapshot-core.ts";

function usage(message: string): never {
  console.error(`arena:local-browser: ${message}`);
  console.error("Usage: npm run arena:local-browser -- [--base URL] [--json] [--total-timeout S]");
  process.exit(2);
}
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--json") continue;
  if (a === "--base" || a === "--total-timeout") { i++; continue; }
  usage(`unknown argument ${a}`);
}
const TOTAL_MS = Number(flag("total-timeout") ?? 900) * 1000;
if (!Number.isFinite(TOTAL_MS) || TOTAL_MS <= 0) usage("--total-timeout must be a positive number of seconds");
const JSON_OUT = argv.includes("--json");
try { findChrome(); } catch (error) { console.error(`arena:local-browser: ${(error as Error).message}`); process.exit(2); }
setTimeout(() => { console.error(`arena:local-browser: gave up after ${TOTAL_MS / 1000} s`); stopServer(); process.exit(1); }, TOTAL_MS).unref();

// ── The server: a production build, no database, no auth ────────────────────────────────────────────
let server: ChildProcess | null = null;
/** Stop `next start` and the server process it forks (its own process group). */
const stopServer = () => { if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch { server.kill(); } } };
let base = flag("base")?.replace(/\/$/, "");
if (!base) {
  if (!existsSync(join(process.cwd(), ".next", "BUILD_ID"))) usage("no production build in .next — run `npm run build` first (or pass --base)");
  const port = await new Promise<number>((resolve) => { const s = createServer(); s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), NODE_ENV: "production" };
  for (const k of ["DATABASE_URL", "AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SL_EMAILS", "BASIC_AUTH_USER", "BASIC_AUTH_PASSWORD", "ANTHROPIC_API_KEY", "APP_ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) delete env[k];
  const child = spawn(process.execPath, [join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], { env, stdio: ["ignore", "ignore", "ignore"], detached: true });
  server = child;
  base = `http://localhost:${port}`;
  const t0 = Date.now();
  for (;;) {
    const ok = await fetch(`${base}/arena/local`).then((r) => r.ok, () => false);
    if (ok) break;
    if (Date.now() - t0 > 60000) { stopServer(); usage("the production server did not answer /arena/local in 60 s"); }
    await sleep(300);
  }
}
const URL_LOCAL = `${base}/arena/local?skin=night`;

// ── Checks and evidence ──────────────────────────────────────────────────────────────────────────
const failures: string[] = [];
const notes: string[] = [];
const check = (ok: unknown, what: string) => { if (ok) notes.push(`ok   ${what}`); else { failures.push(what); notes.push(`FAIL ${what}`); } return !!ok; };
const log = (s: string) => { if (!JSON_OUT) console.log(s); };

interface Checkpoint { scenario: string; revision: number; entries: number; hash: boolean; legal: boolean; detail: string }
const checkpoints: Checkpoint[] = [];
const seen = new Map<number, string>();
const wrongBoards = new Set<number>();
const missingRef = new Set<number>();

const packObject = await auditPack();
const packText = JSON.stringify(packObject);
// Both tabs are driven by CDP during the ownership proof. Keep headless Chrome
// from suspending the background tab's timers while the harness waits on it.
const browser = await Browser.launch({ args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] });
// Preserve browser exceptions when a recovery lands on the framework's error
// screen; the board text alone loses the cause of the failed render.
const browserErrors: string[] = [];
browser.on((method, params) => {
  if (method === "Runtime.exceptionThrown") browserErrors.push(JSON.stringify(params.exceptionDetails));
  if (method === "Runtime.consoleAPICalled" && params.type === "error") {
    browserErrors.push(params.args.map((arg: { value?: unknown; description?: string }) => arg.description ?? arg.value ?? "").join(" "));
  }
});
const taps = new WorkerTaps(browser, base);
const desk = VIEWPORTS.find((v) => v.name === "desk")!;

// ── Page helpers ─────────────────────────────────────────────────────────────────────────────────
const BOARD_NOW = `((window.__bc && !window.__bc.closed) ? window.__bc : (window.__bc = ${BOARD}))`;
interface View { kind: string; watching: string | null; restarts: number; saving: boolean; matchId: string; gameId: number; snapshot: Snapshot | null }
const view = async (page: Page): Promise<View | null> => {
  const raw = await page.eval<string | null>(`(() => { const b = ${BOARD_NOW}; if (!b) return null; const s = b.state; return JSON.stringify({ kind: s.kind, watching: s.watching, restarts: s.totalRestarts, saving: b.saving, matchId: b.matchId, gameId: b.gameId, snapshot: b.snapshot }); })()`);
  return raw ? (JSON.parse(raw) as View) : null;
};
async function newTab(): Promise<Page> {
  const page = await browser.page(desk);
  await taps.guard(page);
  await page.beforeLoad(`try { localStorage.setItem("arena.pace", "step"); } catch {}\n${WORKER_TAP}`);
  return page;
}
async function online(page: Page, on: boolean) { await page.setOffline(!on); }
async function quiet(page: Page, ms = 120000) {
  const t0 = Date.now();
  let calm = 0;
  while (Date.now() - t0 < ms) {
    const v = await view(page);
    if (v && !v.saving && (v.kind === "owner" || v.kind === "watching" || v.kind === "storage" || v.kind === "failed" || v.kind === "stopped")) { if (++calm >= 3) return v; } else calm = 0;
    await sleep(120);
  }
  const last = await view(page);
  throw new Error(`the board did not settle (${JSON.stringify(last && { kind: last.kind, saving: last.saving, restarts: last.restarts, revision: last.snapshot?.game.revision })})\n${(await textOf(page)).slice(0, 600)}\nBrowser errors:\n${browserErrors.slice(-8).join("\n")}`);
}
async function journal(page: Page, matchId: string): Promise<{ header: { seed: number; policySeed: number; decks: { p1: string; p2: string }; human: "p1" | "p2"; revision: number; trace: string; decisions: number }; entries: JournalEntry[] }> {
  const j = await page.eval(readJournalExpr(matchId));
  if (!j) throw new Error(`match ${matchId} is not on the device`);
  return j;
}
const humans = (entries: JournalEntry[]) => entries.filter((e) => e.kind === "human").length;
/** Open the saved match from the start screen: reload (online), choose the pack, Continue. */
async function reopen(page: Page, continueNow = true): Promise<void> {
  await online(page, true);
  await page.goto(URL_LOCAL);
  await page.waitFor("input[type=file]");
  await until(page, `document.body.textContent.includes("Saved match")`);
  await choosePack(page, packText);
  await until(page, `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === "Continue" && !b.disabled)`);
  if (!continueNow) return;
  await clickText(page, "Continue");
  await until(page, `(() => { const b = ${BOARD_NOW}; return !!(b && b.snapshot); })()`, 60000);
  await quiet(page);
  await online(page, false);
}

// ── The reference ────────────────────────────────────────────────────────────────────────────────
interface Ref { at: Map<number, { hash: string; legal: string }>; entries: JournalEntry[]; trace: string; final: string; finalRevision: number }
let ref: Ref | null = null;
async function reference(start: { matchId: string; gameId: number; seed: number; policySeed: number; decks: { p1: string; p2: string }; human: "p1" | "p2" }): Promise<Ref> {
  const ch = inProcessChannel({ store: memoryJournalStore() });
  const session = await LocalWorkerSession.start(ch.port, { ...start, pack: JSON.parse(packText), interpreterRevision: packObject.compatibility.runtimeRevision }, { newRequestId: requestIds(0x657), sessionId: "ref" });
  const at = new Map<number, { hash: string; legal: string }>();
  await playLoop(session, { nextId: requestIds(0x658), maxDecisions: 1, onBoard: async (s) => { at.set(s.game.revision, { hash: await replayHash(s), legal: stableJson(s.legal) }); } });
  const final = await replayHash(session.snapshot!);
  const j = ch.host.inspect()!.journal;
  const out = { at, entries: structuredClone(j.entries), trace: j.trace, final, finalRevision: session.snapshot!.game.revision };
  await session.dispose();
  return out;
}

/** Every board a tab shows is compared with the reference at its revision. */
async function audit(s: Snapshot): Promise<{ hash: boolean; legal: boolean }> {
  const r = ref!.at.get(s.game.revision);
  const h = await replayHash(s);
  seen.set(s.game.revision, h);
  if (!r) { missingRef.add(s.game.revision); return { hash: false, legal: false }; }
  if (r.hash !== h) wrongBoards.add(s.game.revision);
  return { hash: r.hash === h, legal: r.legal === stableJson(s.legal) };
}
async function checkpoint(page: Page, scenario: string, matchId: string, detail: string): Promise<View> {
  const v = await quiet(page);
  const s = v.snapshot!;
  const a = await audit(s);
  const j = await journal(page, matchId);
  checkpoints.push({ scenario, revision: s.game.revision, entries: j.entries.length, ...a, detail });
  check(a.hash, `${scenario}: replay hash at revision ${s.game.revision} equals the uninterrupted reference`);
  check(a.legal, `${scenario}: next legal actions at revision ${s.game.revision} equal the reference's (${s.legal.length})`);
  return v;
}

/** One board step as the stage takes it: answer the human's question, otherwise ask for the computer's turn. */
async function step(page: Page): Promise<"over" | "moved"> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const v = await view(page);
    if (!v?.snapshot) throw new Error("no board on the page");
    const s = v.snapshot;
    await audit(s);
    if (s.game.status === "over") return "over";
    if (v.saving) { await sleep(80); attempt--; continue; }
    const err = humanAsked(s)
      ? await page.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(s))}, ${s.game.revision}, crypto.randomUUID()).then((r) => r.error)`)
      : await page.eval<string | null>(`${BOARD_NOW}.advance().then((r) => r.error)`);
    if (err === null) return "moved";
    notes.push(`note step at revision ${s.game.revision} refused (${err}); retrying`);
    await sleep(200);
  }
  throw new Error("a step was refused eight times");
}
async function playUntil(page: Page, stop: (s: Snapshot) => boolean): Promise<Snapshot> {
  for (let i = 0; i < 3000; i++) {
    const v = await view(page);
    const s = v!.snapshot!;
    if (!v!.saving && stop(s)) return s;
    if ((await step(page)) === "over") return (await view(page))!.snapshot!;
  }
  throw new Error("playUntil did not stop");
}
const aiToMove = (s: Snapshot) => s.game.status !== "over" && !humanAsked(s);

// ── The run ──────────────────────────────────────────────────────────────────────────────────────
const t0 = Date.now();
let exitCode = 0;
try {
  // Start.
  const a = await newTab();
  await a.goto(URL_LOCAL);
  await a.waitFor("input[type=file]");
  await choosePack(a, packText);
  await chooseLocalSetup(a, "A", "B", "p1"); // the setup wizard of #829
  await online(a, false);
  if (!(await clickText(a, "Start match"))) throw new Error("no Start button");
  await until(a, `(() => { const b = ${BOARD_NOW}; return !!(b && b.snapshot && b.state.kind === "owner"); })()`, 60000);
  const first = await quiet(a);
  const matchId = first.matchId;
  const head = (await journal(a, matchId)).header;
  check(head.human === "p1", "the match was started offline (the tab had no network) in seat p1");
  log(`match ${matchId}: decks ${head.decks.p1} v ${head.decks.p2}; computing the uninterrupted reference…`);
  ref = await reference({ matchId, gameId: first.gameId, seed: head.seed, policySeed: head.policySeed, decks: head.decks, human: head.human });
  log(`reference: ${ref.entries.length} decisions, final revision ${ref.finalRevision}`);
  check((await audit(first.snapshot!)).hash, "the first board equals the reference's");

  // reload-choice
  await playUntil(a, (s) => s.game.revision >= 10 && humanAsked(s));
  const before = await journal(a, matchId);
  await reopen(a);
  let v = await checkpoint(a, "reload-choice", matchId, "reloaded while the human was asked");
  check(v.kind === "owner", "reload-choice: the tab is the match's writer again");
  check(humans((await journal(a, matchId)).entries) === humans(before.entries) && (await journal(a, matchId)).entries.length === before.entries.length, "reload-choice: the device's journal is unchanged by the reload");

  // inject: duplicate and stale messages
  {
    const s = await playUntil(a, (x) => x.game.revision >= 20 && humanAsked(x));
    const h0 = humans((await journal(a, matchId)).entries);
    const err = await a.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(s))}, ${s.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
    check(err === null, "inject: the human's move is accepted");
    const after = await quiet(a);
    const rev = after.snapshot!.game.revision;
    const answers = await a.eval<string>(`(async () => {
      const L = window.__local; const w = L.workers[L.workers.length - 1];
      const apply = [...L.sent].reverse().find((m) => m && m.type === "apply");
      const wait = (id) => new Promise((resolve) => { const t = setTimeout(() => resolve(null), 8000); const f = (e) => { if (e.data && e.data.requestId === id) { clearTimeout(t); w.removeEventListener("message", f); resolve(e.data); } }; w.addEventListener("message", f); });
      const dupAnswer = wait(apply.requestId); w.postMessage(apply); const dup = await dupAnswer;
      const staleId = crypto.randomUUID(); const staleAnswer = wait(staleId); w.postMessage({ ...apply, requestId: staleId }); const stale = await staleAnswer;
      const results = L.recv.filter((m) => m && (m.type === "result" || m.type === "snapshot") && m.snapshot);
      const older = results.find((m) => m.snapshot.game.revision < ${rev});
      const latest = results[results.length - 1];
      if (older) w.dispatchEvent(new MessageEvent("message", { data: older }));
      if (latest) w.dispatchEvent(new MessageEvent("message", { data: latest }));
      await new Promise((r) => setTimeout(r, 400));
      return JSON.stringify({ dup: dup && { type: dup.type, ok: dup.ok, code: dup.code, revision: dup.snapshot ? dup.snapshot.game.revision : null }, stale: stale && { type: stale.type, ok: stale.ok, code: stale.code }, olderRevision: older ? older.snapshot.game.revision : null, latest: !!latest });
    })()`);
    const r = JSON.parse(answers) as { dup: { ok: boolean; revision: number | null; code?: string } | null; stale: { ok: boolean; code?: string } | null; olderRevision: number | null; latest: boolean };
    check(r.dup && r.dup.ok, `inject: the duplicate apply is answered from its receipt (${JSON.stringify(r.dup)})`);
    check(r.stale && !r.stale.ok, `inject: the stale apply is refused (${r.stale?.code})`);
    check(r.olderRevision !== null && r.latest, `inject: an older answer (revision ${r.olderRevision}) and a duplicate answer were handed to the page's Worker object`);
    v = await checkpoint(a, "inject", matchId, `duplicate + stale apply to the Worker; stale (rev ${r.olderRevision}) + duplicate answers to the page`);
    check(v.snapshot!.game.revision === rev && v.kind === "owner", "inject: the board did not move and is still the writer");
    check(humans((await journal(a, matchId)).entries) === h0 + 1, "inject: the human's move is on the device exactly once");
  }

  // kill-choice
  {
    await playUntil(a, (x) => x.game.revision >= 28 && humanAsked(x));
    const s = (await view(a))!.snapshot!;
    const h0 = humans((await journal(a, matchId)).entries);
    const restarts0 = (await view(a))!.restarts;
    await a.eval(`window.__local.workers.forEach((w) => w.terminate())`);
    await a.eval(`void (window.__kpDone = undefined, ${BOARD_NOW}.act(${JSON.stringify(humanPick(s))}, ${s.game.revision}, crypto.randomUUID()).then((r) => { window.__kpDone = r.error; }))`);
    let restartingShown = false;
    for (let i = 0; i < 600 && (await a.eval<boolean>(`typeof window.__kpDone === "undefined"`)); i++) {
      if ((await textOf(a)).includes("The local game engine stopped")) restartingShown = true;
      await sleep(100);
    }
    const err = await a.eval<string | null>(`window.__kpDone`);
    v = await checkpoint(a, "kill-choice", matchId, "Worker terminated, then the human moved");
    check(err === null, `kill-choice: the move is applied after the engine restarts (${err})`);
    check(v.restarts > restarts0, `kill-choice: the Worker was restarted (${v.restarts})`);
    check(restartingShown, "kill-choice: the page said the engine stopped and was restarting");
    check(humans((await journal(a, matchId)).entries) === h0 + 1, "kill-choice: the move is on the device exactly once");
  }

  // kill-ai: the Worker is terminated while an AI advance is running in it (retried on a later AI turn when the turn was over too soon)
  {
    let inFlight = false;
    let restarts0 = 0;
    for (let attempt = 0; attempt < 12 && !inFlight; attempt++) {
      await playUntil(a, (x) => x.game.revision >= 34 && aiToMove(x));
      restarts0 = (await view(a))!.restarts;
      // Terminate in the dispatch call itself. Separate CDP reads of `saving`
      // and terminate calls can race a completed answer and claim a kill that
      // never interrupted the Worker (especially on a busy Windows host).
      await a.eval(`(() => {
        window.__kaKilled = false;
        for (const w of window.__local.workers) {
          const post = w.postMessage;
          w.postMessage = function(message, transfer) {
            const result = transfer ? post.call(this, message, transfer) : post.call(this, message);
            if (message?.type === "advance" && !window.__kaKilled) {
              window.__kaKilled = true;
              w.postMessage = post;
              w.terminate();
            }
            return result;
          };
        }
        window.__ka = ${BOARD_NOW}.advance().then((r) => r.error);
      })()`);
      await a.eval(`window.__ka`);
      inFlight = await a.eval<boolean>(`window.__kaKilled`);
    }
    check(inFlight, "kill-ai: the Worker was terminated while the advance was in flight");
    const err = await a.eval<string | null>(`window.__ka`);
    v = await checkpoint(a, "kill-ai", matchId, `Worker terminated mid AI advance (advance answered: ${err ?? "ok"})`);
    check(v.restarts > restarts0 && v.kind === "owner", `kill-ai: the Worker was restarted and the tab writes on (${v.kind}, ${v.restarts})`);
  }

  // reload-ai-turn: the computer is to move and no advance has been asked for yet
  {
    await playUntil(a, (x) => x.game.revision >= 40 && aiToMove(x));
    await reopen(a);
    v = await checkpoint(a, "reload-ai-turn", matchId, "reloaded with the computer to move, nothing in flight");
  }

  // reload-ai-batch: while an advance runs in the Worker
  {
    let inFlight = false;
    let r0 = 0;
    for (let attempt = 0; attempt < 12 && !inFlight; attempt++) {
      await playUntil(a, (x) => x.game.revision >= 46 && aiToMove(x));
      r0 = (await view(a))!.snapshot!.game.revision;
      await a.eval(`void (window.__kb = ${BOARD_NOW}.advance())`);
      await sleep(5);
      inFlight = await a.eval<boolean>(`${BOARD_NOW}.saving`);
      if (!inFlight) await a.eval(`window.__kb`);
    }
    check(inFlight, "reload-ai-batch: the advance was still in flight at the reload");
    await reopen(a);
    v = await checkpoint(a, "reload-ai-batch", matchId, `reloaded mid AI advance (from revision ${r0})`);
    check(v.kind === "owner", "reload-ai-batch: the tab is the writer again");
  }

  // storage-quota
  {
    const s = await playUntil(a, (x) => x.game.revision >= 52 && humanAsked(x));
    const j0 = await journal(a, matchId);
    const reached = await taps.inWorkers(a, IDB_FAULT.quota);
    check(reached >= 1, `storage-quota: the fault reached the match Worker (${reached})`);
    const err = await a.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(s))}, ${s.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
    await until(a, `document.body.textContent.includes("Could not save on this device")`, 20000).catch(() => {});
    const t = await textOf(a);
    const st = (await view(a))!;
    check(!!err && /could not be saved on this device/i.test(err), `storage-quota: the move is refused with the storage sentence (${err})`);
    check(st.kind === "storage" && t.includes("Could not save on this device") && t.includes("Free some space") && t.includes("Try again"), `storage-quota: the page shows the device-full notice with Try again (${st.kind})`);
    check(st.snapshot!.game.revision === s.game.revision, "storage-quota: the board stays at the last saved move");
    const j1 = await journal(a, matchId);
    check(j1.entries.length === j0.entries.length && j1.header.trace === j0.header.trace, "storage-quota: nothing was written");
    await taps.inWorkers(a, IDB_FAULT.clear);
    check(await clickText(a, "Try again"), "storage-quota: Try again pressed");
    await until(a, `(() => { const b = ${BOARD_NOW}; return b && b.state.kind === "owner"; })()`, 30000);
    v = await checkpoint(a, "storage-quota", matchId, "QuotaExceededError on every put, then Try again");
    const again = await a.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(v.snapshot!))}, ${v.snapshot!.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
    check(again === null, "storage-quota: the move is accepted once there is room");
    check(humans((await journal(a, matchId)).entries) === humans(j0.entries) + 1, "storage-quota: and is on the device once");
  }

  // storage-abort
  {
    const s = await playUntil(a, (x) => x.game.revision >= 58 && aiToMove(x));
    const j0 = await journal(a, matchId);
    check((await taps.inWorkers(a, IDB_FAULT.abort)) >= 1, "storage-abort: the fault reached the match Worker");
    const err = await a.eval<string | null>(`${BOARD_NOW}.advance().then((r) => r.error)`);
    await sleep(300);
    const st = (await view(a))!;
    const t = await textOf(a);
    check(!!err, `storage-abort: the advance is refused (${err})`);
    check((st.kind === "storage" || st.kind === "failed") && (t.includes("Try again")), `storage-abort: the page shows an actionable notice (${st.kind}: ${t.split("\n").find((l) => /save|cannot|stopped/i.test(l)) ?? "?"})`);
    check(st.snapshot!.game.revision === s.game.revision, "storage-abort: the board stays at the last saved move");
    const j1 = await journal(a, matchId);
    check(j1.entries.length === j0.entries.length, "storage-abort: nothing was written");
    await taps.inWorkers(a, IDB_FAULT.clear);
    check(await clickText(a, "Try again"), "storage-abort: Try again pressed");
    await until(a, `(() => { const b = ${BOARD_NOW}; return b && b.state.kind === "owner"; })()`, 30000);
    v = await checkpoint(a, "storage-abort", matchId, "every read-write transaction aborted, then Try again");
  }

  // race: two tabs press Continue at the same instant
  {
    await playUntil(a, (x) => x.game.revision >= 64 && humanAsked(x));
    const j0 = await journal(a, matchId);
    const lastRev = (await view(a))!.snapshot!.game.revision;
    // The first tab is closed (its Worker and its lock go with it); the match stays on the device.
    await a.close();
    const b = await newTab();
    const c = await newTab();
    await Promise.all([reopen(b, false), reopen(c, false)]);
    await Promise.all([online(b, false), online(c, false)]);
    await Promise.all([clickText(b, "Continue"), clickText(c, "Continue")]);
    const settled = async (p: Page) => {
      try {
        await until(p, `(() => { const x = ${BOARD_NOW}; return !!(x && x.snapshot && (x.state.kind === "owner" || x.state.kind === "watching")); })()`, 180000);
      } catch (error) {
        const diagnostics = await p.eval(`(async () => ({ locks: await navigator.locks.query(), sent: window.__local?.sent.slice(-8), received: window.__local?.recv.slice(-8).map(m => ({type:m.type, ok:m.ok, code:m.code, revision:m.revision})) }))()`);
        throw new Error(`${String(error)}\nTwo-tab diagnostics: ${JSON.stringify(diagnostics)}\nBrowser errors: ${browserErrors.join("\n")}`);
      }
      return quiet(p);
    };
    const [vb, vc] = await Promise.all([settled(b), settled(c)]);
    const owners = [vb, vc].filter((x) => x.kind === "owner").length;
    check(owners === 1, `race: exactly one tab writes (${vb.kind} / ${vc.kind})`);
    const [owner, watcher] = vb.kind === "owner" ? [b, c] : [c, b];
    const w = (await view(watcher))!;
    check(w.kind === "watching" && (await textOf(watcher)).includes("open in another tab"), "race: the other tab watches and says so");
    await checkpoint(owner, "race-owner", matchId, "won the simultaneous Continue");
    await checkpoint(watcher, "race-watcher", matchId, "lost the simultaneous Continue (read-only)");
    const ws = w.snapshot!;
    const refused = await watcher.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(ws))}, ${ws.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
    check(!!refused, `race: the watcher's move is refused (${refused})`);
    check((await journal(owner, matchId)).entries.length === j0.entries.length, "race: nothing was written by either tab");
    // "Play here instead" in the watcher: it becomes the writer, the other tab is fenced.
    check(await clickText(watcher, "Play here instead"), "race: Play here instead pressed in the watching tab");
    await until(watcher, `(() => { const x = ${BOARD_NOW}; return x && x.state.kind === "owner"; })()`, 120000);
    const tv = await checkpoint(watcher, "takeover", matchId, "took the match over");
    const os = (await view(owner))!.snapshot!;
    const lost = await owner.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(os))}, ${os.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
    await until(owner, `document.body.textContent.includes("took this match over")`, 30000).catch(() => {});
    check(!!lost && (await view(owner))!.kind === "watching" && (await textOf(owner)).includes("took this match over"), `race: the old writer's move is refused and it says another tab took over (${lost})`);
    check((await journal(watcher, matchId)).entries.length === j0.entries.length && tv.snapshot!.game.revision === lastRev, "race: the fenced tab wrote nothing");
    await owner.close();

    // To the end, in the new writer.
    const end = await playUntil(watcher, (x) => x.game.status === "over");
    const fin = await journal(watcher, matchId);
    check(end.game.status === "over", `the match was played to the end (revision ${end.game.revision})`);
    check((await replayHash(end)) === ref.final && end.game.revision === ref.finalRevision, "the final board equals the uninterrupted reference's");
    check(fin.header.trace === ref.trace, "the device's trace equals the reference's (equal traces, equal games)");
    // A human entry carries the page's request id (a fresh UUID per move); everything else must match.
    const decisions = (es: JournalEntry[]) => es.map((e) => (e.kind === "human" ? { seat: e.seat, kind: e.kind, action: e.action } : e));
    const firstDiff = decisions(fin.entries).findIndex((e, i) => stableJson(e) !== stableJson(decisions(ref!.entries)[i]));
    check(fin.entries.length === ref.entries.length && firstDiff < 0, `the device's journal equals the reference's, decision for decision (${fin.entries.length} decisions, ${humans(fin.entries)} human moves${firstDiff >= 0 ? `; first difference at #${firstDiff}` : ""})`);
    const ids = fin.entries.flatMap((e) => (e.kind === "human" ? [e.requestId] : []));
    check(new Set(ids).size === ids.length, "no human request was applied twice (every human entry has its own request id)");
    // Negative control: a reference on another game seed (another shuffle) is a different game, so the comparison has teeth.
    const head2 = fin.header;
    const other = await reference({ matchId, gameId: first.gameId, seed: head2.seed + 1, policySeed: head2.policySeed, decks: head2.decks, human: head2.human });
    check(other.trace !== fin.header.trace, "negative control: a reference on game seed +1 does not match the device's trace");
    // The next AI policy decision after every recovery.
    for (const cp of checkpoints) {
      const i = ref.entries.findIndex((e, k) => k >= cp.entries && e.kind === "ai");
      const same = i >= 0 && stableJson(decisions(fin.entries)[i]) === stableJson(decisions(ref.entries)[i]);
      check(i < 0 || same, `${cp.scenario}: the next AI decision after recovery (#${i}) equals the reference's`);
      (cp as Checkpoint & { nextAi?: string }).nextAi = i < 0 ? "none (game over)" : `#${i} ${(ref.entries[i] as { id?: string }).id ?? ""}`;
    }
    await watcher.close();
  }
} catch (e) {
  failures.push(`run aborted: ${(e as Error).stack ?? e}`);
} finally {
  await browser.close();
  stopServer();
}

check(wrongBoards.size === 0, `every board shown equals the reference at its revision (${seen.size} revisions seen${wrongBoards.size ? `; wrong at ${[...wrongBoards].join(", ")}` : ""})`);
check(missingRef.size === 0, `every board shown is a reference revision${missingRef.size ? ` (missing ${[...missingRef].join(", ")})` : ""}`);
check(taps.denied.length === 0, `no match/provider request was attempted (${taps.denied.length} denied: ${taps.denied.slice(0, 5).map((d) => `${d.method} ${d.url} — ${d.why}`).join("; ")})`);
const summary = {
  build: "production (next start)", base, pack: { id: packObject.id, hash: packObject.hash, playable: packObject.qualification.playable },
  checkpoints, denied: taps.denied, allowedRequests: taps.allowed.length, failures, browserErrors, seconds: Math.round((Date.now() - t0) / 1000),
  evidence: "headless desktop Chrome (emulation); physical-device evidence: not collected (owner)",
};
if (JSON_OUT) console.log(JSON.stringify({ ...summary, notes }, null, 2));
else {
  for (const n of notes) console.log(n);
  console.log("\ncheckpoint            revision  entries  hash  legal  next AI decision");
  for (const c of checkpoints) console.log(`${c.scenario.padEnd(20)}  ${String(c.revision).padStart(8)}  ${String(c.entries).padStart(7)}  ${c.hash ? "ok  " : "FAIL"}  ${c.legal ? "ok   " : "FAIL "}  ${(c as Checkpoint & { nextAi?: string }).nextAi ?? "?"}   (${c.detail})`);
  console.log(`\n${taps.allowed.length} page/asset requests allowed, ${taps.denied.length} match/provider requests denied, ${taps.art.length} card-art CDN requests failed offline; ${summary.seconds} s`);
  console.log("Browser emulation only (headless desktop Chrome). Physical-device evidence: unverified — the owner's.");
  console.log(failures.length ? `\narena:local-browser: ${failures.length} FAILED\n${failures.join("\n")}` : "\narena:local-browser: ok");
}
exitCode = failures.length ? 1 : 0;
process.exit(exitCode);
