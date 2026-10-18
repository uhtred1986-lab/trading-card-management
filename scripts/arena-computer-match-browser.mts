#!/usr/bin/env node
/**
 * #898: the "Play the computer" match end to end, as a player meets it, in real headless Chrome
 * against a PRODUCTION build (`next start`, no database, no auth, no AI call).
 *
 *   npm run build   # with GITHUB_SHA set to a commit id, so the build has an interpreter revision
 *   npx tsx scripts/arena-computer-match-browser.mts [--base URL] [--out DIR] [--total-timeout S]
 *
 * Per viewport (phone 390x844 plays seat p2, desktop 1440x900 plays seat p1, so both seats are
 * played to the end), on a fresh browser profile:
 *
 *   prepare      /arena/offline on an unprepared device -> "Prepare for offline play" -> "Ready" (the
 *                curated Masters pack, built from the committed catalog snapshot; card art comes from
 *                its public CDN, so this one step needs the internet)
 *   start        the real setup (phone wizard / desktop form) -> Start match, 44 px targets, no overflow
 *   first move   the first question answered with a real tap on the board's own button
 *   reload       reload while the human is being asked -> "Saved match" -> Continue: same board
 *   offline      network OFF, the page reopened from the service worker cache, Continue: same board
 *   storage      (phone) every IndexedDB put in the Worker throws QuotaExceededError: the move is
 *                refused with the device-full notice, "Try again" works once there is room
 *   two tabs     (desktop) a second tab on the same match only watches; "Play here instead" moves the
 *                writer and fences the old tab
 *   finish       the match is played to its end; the board says it is over, the journal says over
 *   mismatch     a pack made for another game version is added from a file: it is refused with a reason
 *
 * Moves go through the page's own `LocalBoard.act()/advance()` into the real module Worker and
 * IndexedDB; only the first question is a real tap. Every stop is reported with its reason and how to
 * reproduce it. Emulated headless desktop Chrome; physical-device evidence is not collected here.
 * Not part of `npm test`. Exit 0 ok, 1 a check failed, 2 usage / no Chrome / no build.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { arg, Browser, findChrome, sleep, VIEWPORTS, type Page, type Viewport } from "./lib/cdp.mts";
import { BOARD, IDB_FAULT, WORKER_TAP, WorkerTaps, chooseLocalSetup, choosePack, clickText, readJournalExpr, textOf, until } from "./lib/local-arena-page.mts";
import { auditPack } from "./verify/arena-local-worker-fixture.mts";
import { humanAsked, humanPick } from "./verify/arena-local-storage-driver.ts";
import { stableJson } from "../src/lib/arena/policy/contract.ts";
import type { Snapshot } from "../src/lib/arena/snapshot-core.ts";

const usage = (m: string): never => { console.error(`arena:computer-match-browser: ${m}`); process.exit(2); };
try { findChrome(); } catch (e) { usage((e as Error).message); }
const TOTAL_MS = Number(arg("total-timeout") ?? 1500) * 1000;
const out = arg("out") ?? join(process.cwd(), "arena-computer-match-shots");
mkdirSync(out, { recursive: true });
setTimeout(() => { console.error("arena:computer-match-browser: gave up (total timeout)"); stopServer(); process.exit(1); }, TOTAL_MS).unref();

let server: ChildProcess | null = null;
const stopServer = () => { if (server?.pid) { try { server.kill(); } catch { /* gone */ } } };
let base = arg("base")?.replace(/\/$/, "");
if (!base) {
  if (!existsSync(join(process.cwd(), ".next", "BUILD_ID"))) usage("no production build in .next; run `npm run build` first (or pass --base)");
  const port = await new Promise<number>((resolve) => { const s = createServer(); s.listen(0, () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); }); });
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port), NODE_ENV: "production" };
  for (const k of ["DATABASE_URL", "AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SL_EMAILS", "BASIC_AUTH_USER", "BASIC_AUTH_PASSWORD", "ANTHROPIC_API_KEY", "APP_ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"]) delete env[k];
  server = spawn(process.execPath, [join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)], { env, stdio: "ignore" });
  base = `http://localhost:${port}`;
  const t0 = Date.now();
  while (!(await fetch(`${base}/arena/offline`).then((r) => r.ok, () => false))) {
    if (Date.now() - t0 > 60000) { stopServer(); usage("the production server did not answer /arena/offline in 60 s"); }
    await sleep(300);
  }
}
const URL_OFFLINE = `${base}/arena/offline`;

const notes: string[] = [];
const failures: string[] = [];
const stops: { viewport: string; stage: string; reason: string; reproduction: string }[] = [];
const check = (ok: unknown, what: string) => { notes.push(`${ok ? "ok  " : "FAIL"} ${what}`); console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); return !!ok; };

interface View { kind: string; saving: boolean; matchId: string; snapshot: Snapshot | null }
const BOARD_NOW = `((window.__bc && !window.__bc.closed) ? window.__bc : (window.__bc = ${BOARD}))`;
const view = async (page: Page): Promise<View | null> => {
  const raw = await page.eval<string | null>(`(() => { const b = ${BOARD_NOW}; if (!b) return null; return JSON.stringify({ kind: b.state.kind, saving: b.saving, matchId: b.matchId, snapshot: b.snapshot }); })()`);
  return raw ? (JSON.parse(raw) as View) : null;
};
async function quiet(page: Page, ms = 120000): Promise<View> {
  const t0 = Date.now();
  let calm = 0;
  while (Date.now() - t0 < ms) {
    const v = await view(page);
    if (v && !v.saving && ["owner", "watching", "storage", "failed", "stopped"].includes(v.kind)) { if (++calm >= 3) return v; } else calm = 0;
    await sleep(120);
  }
  throw new Error(`the board did not settle\n${(await textOf(page)).slice(0, 500)}`);
}
const journal = async (page: Page, matchId: string) => {
  const j = await page.eval<{ header: { status: string; human: string; decisions: number }; entries: { kind: string }[] } | null>(readJournalExpr(matchId));
  if (!j) throw new Error(`match ${matchId} is not on the device`);
  return j;
};
/** The whole board equal, but for the object URLs the card art is lent as (new on every page load). */
const plain = (s: Snapshot) => stableJson(s).replace(/blob:[^"]+/g, "blob");
const sameBoard = async (a: Snapshot, b: Snapshot) => a.game.revision === b.game.revision && plain(a) === plain(b);

async function step(page: Page): Promise<"over" | "moved"> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const v = await view(page);
    if (!v?.snapshot) throw new Error("no board on the page");
    const s = v.snapshot;
    if (s.game.status === "over") return "over";
    if (v.saving) { await sleep(80); attempt--; continue; }
    const err = humanAsked(s)
      ? await page.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(s))}, ${s.game.revision}, crypto.randomUUID()).then((r) => r.error)`)
      : await page.eval<string | null>(`${BOARD_NOW}.advance().then((r) => r.error)`);
    if (err === null) return "moved";
    notes.push(`note: a step at revision ${s.game.revision} was refused (${err}); retrying`);
    await sleep(200);
  }
  throw new Error("a step was refused eight times");
}
async function playUntil(page: Page, stop: (s: Snapshot) => boolean): Promise<Snapshot> {
  for (let i = 0; i < 4000; i++) {
    const v = await view(page);
    const s = v!.snapshot!;
    if (!v!.saving && stop(s)) return s;
    if ((await step(page)) === "over") return (await view(page))!.snapshot!;
  }
  throw new Error("playUntil did not stop");
}

const SET_UP_BROWSER = `try { localStorage.setItem("arena.pace", "step"); } catch {}\n${WORKER_TAP}`;
const shot = async (page: Page, vp: Viewport, name: string) => { try { writeFileSync(join(out, `${vp.name}-${name}.png`), await page.screenshot(false)); } catch { /* page gone */ } };
const layout = async (page: Page, vp: Viewport, what: string) => {
  const o = await page.eval<boolean>(`document.documentElement.scrollWidth > innerWidth + 1`);
  check(!o, `${vp.name}: ${what}: no horizontal scroll`);
};

const packText = JSON.stringify(await auditPack()); // the audited test pack: made for another game version than this build
const t0 = Date.now();
const evidence: Record<string, unknown> = {};

async function run(vp: Viewport, seat: "p1" | "p2") {
  const tag = vp.name;
  const browser = await Browser.launch({ args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"] });
  const taps = new WorkerTaps(browser, base!);
  let stage = "start";
  let repro = "";
  const at = (name: string, how: string) => { stage = name; repro = how; console.log(`-- ${tag}: ${name}`); };
  try {
    let page = await browser.page(vp);
    await page.beforeLoad(SET_UP_BROWSER);
    const reopen = async (p: Page, offline: boolean) => {
      await p.setOffline(offline);
      await p.goto(URL_OFFLINE);
      await until(p, `document.body.textContent.includes("Saved match")`, 60000);
      await until(p, `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === "Continue" && !b.disabled)`, 60000);
      if (offline) check(await p.eval<boolean>(`!!navigator.serviceWorker.controller`), `${tag}: the offline page was served by the service worker`);
    };
    const resume = async (p: Page) => {
      if (!(await clickText(p, "Continue"))) throw new Error("no Continue button");
      await until(p, `(() => { const b = ${BOARD_NOW}; return !!(b && b.snapshot); })()`, 60000);
      return quiet(p);
    };

    // prepare ------------------------------------------------------------------------------------
    at("prepare", `open ${URL_OFFLINE} on a fresh profile, press "Prepare for offline play" (needs the internet for card art)`);
    await page.goto(URL_OFFLINE);
    await until(page, `document.body.textContent.includes("Not prepared for offline play")`, 30000);
    await layout(page, vp, "unprepared page");
    await shot(page, vp, "1-unprepared");
    const prepH = await page.eval<number>(`[...document.querySelectorAll('button')].find((b) => /Prepare for offline play/.test(b.textContent)).getBoundingClientRect().height`);
    check(!vp.mobile || prepH >= 44, `${tag}: the Prepare button is ${Math.round(prepH)} px tall`);
    await page.eval(`[...document.querySelectorAll('button')].find((b) => /Prepare for offline play/.test(b.textContent)).click()`);
    await until(page, `document.body.textContent.includes("This device is ready for offline play.")`, 180000);
    await until(page, `document.body.textContent.includes("New match") || !!document.querySelector('[data-match-setup-open],[data-desktop-setup]')`, 60000);
    check(true, `${tag}: first preparation finished: "ready for offline play"`);
    await shot(page, vp, "2-prepared");

    // start --------------------------------------------------------------------------------------
    at("start", `choose decks A v B and seat ${seat} in the setup, press "Start match"`);
    await page.goto(URL_OFFLINE); // a normal visit after preparing; the Worker taps are attached from here
    await taps.guard(page);
    await page.goto(URL_OFFLINE);
    await until(page, `!!document.querySelector('section[aria-label="New match"]')`, 60000);
    await layout(page, vp, "setup");
    await shot(page, vp, "3-setup");
    await chooseLocalSetup(page, "A", "B", seat);
    await shot(page, vp, "4-setup-chosen");
    if (vp.mobile) {
      const h = await page.eval<number>(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith("Start match") && b.getClientRects().length).getBoundingClientRect().height`);
      check(h >= 44, `${tag}: the Start button is ${Math.round(h)} px tall`);
    }
    if (!(await clickText(page, "Start match"))) throw new Error("no Start match button");
    await until(page, `(() => { const b = ${BOARD_NOW}; return !!(b && b.snapshot && b.state.kind === "owner"); })()`, 90000);
    let v = await quiet(page);
    const matchId = v.matchId;
    check((await journal(page, matchId)).header.human === seat, `${tag}: the match started in seat ${seat} and is on the device`);

    // first move: a real tap on the board's own button -------------------------------------------------
    at("first move", "on the first question, tap the board's own Go first / Keep hand button");
    await playUntil(page, (s) => humanAsked(s));
    const marked = await page.eval<string | null>(`(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /^(Go first|Keep hand)/.test(x.textContent.trim()) && !x.disabled && x.getClientRects().length > 0);
      if (!b) return null;
      b.setAttribute("data-probe898", "1"); b.scrollIntoView({ block: "center" });
      const r = b.getBoundingClientRect();
      return JSON.stringify({ label: b.textContent.trim(), inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, h: Math.round(r.height) });
    })()`);
    if (marked) {
      const m = JSON.parse(marked) as { label: string; inView: boolean; h: number };
      check(m.inView, `${tag}: the first question's button "${m.label}" is on screen (${m.h} px tall)`);
      await shot(page, vp, "5-first-question");
      const rev = (await view(page))!.snapshot!.game.revision;
      await page.tap("[data-probe898]");
      await until(page, `(() => { const b = ${BOARD_NOW}; return !!(b && b.snapshot && b.snapshot.game.revision > ${rev}); })()`, 30000);
      check(true, `${tag}: tapping "${m.label}" moved the game on (revision ${rev} -> more)`);
    } else {
      notes.push(`note: ${tag}: the first question had no Go first / Keep hand button (the opening was answered by the computer's seat order); driven through act()`);
    }

    // board actions visible at a later human question --------------------------------------------------
    at("board actions", "play to move 12+ and look at the controls at a human question");
    await playUntil(page, (s) => s.game.revision >= 12 && humanAsked(s));
    const ctl = await page.eval<{ visible: number; labels: string[] }>(`(() => {
      const bs = [...document.querySelectorAll('button,[role=button]')].filter((b) => !b.disabled && b.getClientRects().length);
      const vis = bs.filter((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; });
      return { visible: vis.length, labels: vis.slice(0, 10).map((b) => (b.textContent.trim() || b.getAttribute("aria-label") || "?").slice(0, 24)) };
    })()`);
    check(ctl.visible > 0, `${tag}: board controls are on screen at a human question (${ctl.visible}: ${ctl.labels.join(" | ")})`);
    await layout(page, vp, "board");
    await shot(page, vp, "6-board-human-turn");

    // reload mid-choice --------------------------------------------------------------------------
    at("reload", `at a human question reload ${URL_OFFLINE}, press Continue in "Saved match"`);
    const before = (await playUntil(page, (s) => s.game.revision >= 20 && humanAsked(s)));
    const nBefore = (await journal(page, matchId)).entries.length;
    await reopen(page, false);
    await shot(page, vp, "7-saved-match");
    v = await resume(page);
    check(await sameBoard(before, v.snapshot!), `${tag}: after a reload the board is the same (revision ${before.game.revision}, every card, count and legal move equal)`);
    check((await journal(page, matchId)).entries.length === nBefore, `${tag}: the reload wrote nothing to the journal`);

    // offline reopen ----------------------------------------------------------------------------------
    at("offline", "press network OFF, reopen the page from the service worker, Continue");
    const mid = (await playUntil(page, (s) => s.game.revision >= 30 && humanAsked(s)));
    await reopen(page, true);
    v = await resume(page);
    check(await sameBoard(mid, v.snapshot!), `${tag}: reopened with no network the board is the same (revision ${mid.game.revision})`);
    await shot(page, vp, "8-offline-board");

    if (vp.mobile) {
      // storage refusal ------------------------------------------------------------------------------
      at("storage", "make every IndexedDB put in the Worker throw QuotaExceededError, make a move, then clear and press Try again");
      const s = await playUntil(page, (x) => x.game.revision >= 40 && humanAsked(x));
      const n0 = (await journal(page, matchId)).entries.length;
      check((await taps.inWorkers(page, IDB_FAULT.quota)) >= 1, `${tag}: the fault reached the match Worker`);
      const err = await page.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(s))}, ${s.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
      await until(page, `document.body.textContent.includes("Could not save on this device")`, 20000).catch(() => {});
      const t = await textOf(page);
      check(!!err && /could not be saved on this device/i.test(err) && t.includes("Free some space") && t.includes("Try again"), `${tag}: a full device refuses the move and says so with Try again (${err})`);
      check((await journal(page, matchId)).entries.length === n0 && (await view(page))!.snapshot!.game.revision === s.game.revision, `${tag}: nothing was written and the board stayed`);
      await shot(page, vp, "9-storage-full");
      await taps.inWorkers(page, IDB_FAULT.clear);
      await clickText(page, "Try again");
      await until(page, `(() => { const b = ${BOARD_NOW}; return b && b.state.kind === "owner"; })()`, 30000);
      v = await quiet(page);
      const again = await page.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(v.snapshot!))}, ${v.snapshot!.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
      check(again === null, `${tag}: once there is room the same move is accepted`);
    } else {
      // two tabs ----------------------------------------------------------------------------------------
      at("two tabs", "with the match open in a tab, open /arena/offline in a second tab and press Continue");
      await playUntil(page, (x) => x.game.revision >= 40 && humanAsked(x));
      const second = await browser.page(vp);
      await second.beforeLoad(SET_UP_BROWSER);
      await taps.guard(second);
      await second.setOffline(true);
      await second.goto(URL_OFFLINE);
      await until(second, `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === "Continue" && !b.disabled)`, 60000);
      await clickText(second, "Continue");
      await until(second, `document.body.textContent.includes("open in another tab")`, 60000);
      const w = await quiet(second);
      check(w.kind === "watching", `${tag}: the second tab only watches and says the match is open in another tab`);
      const ws = w.snapshot!;
      const refused = await second.eval<string | null>(`${BOARD_NOW}.act(${JSON.stringify(humanPick(ws))}, ${ws.game.revision}, crypto.randomUUID()).then((r) => r.error)`);
      check(!!refused, `${tag}: a move in the watching tab is refused (${refused})`);
      await shot(second, vp, "9-second-tab");
      await clickText(second, "Play here instead");
      await until(second, `(() => { const x = ${BOARD_NOW}; return x && x.state.kind === "owner"; })()`, 120000);
      await until(page, `document.body.textContent.includes("took this match over")`, 60000);
      check(true, `${tag}: "Play here instead" moved the writer; the first tab says another tab took over`);
      await page.close();
      page = second;
      await quiet(page);
    }

    // finish ---------------------------------------------------------------------------------------
    at("finish", "play the match to its end (moves via the board, the computer through the Worker)");
    const end = await playUntil(page, (s) => s.game.status === "over");
    check(end.game.status === "over" && !!end.over, `${tag}: the match reached its end (revision ${end.game.revision}; ${JSON.stringify(end.over)})`);
    const fin = await journal(page, matchId);
    check(fin.header.status === "over" && fin.entries.length > 20, `${tag}: the device's journal records an ended match (${fin.entries.length} decisions)`);
    const youWon = end.over?.winner === end.game.you;
    // The stage presents the ended match beat by beat; the player fast-forwards / taps Next to the end screen.
    let screen = "";
    for (let i = 0; i < 1200 && !screen; i++) {
      screen = await page.eval<string>(`(document.body.innerText.match(/VICTORY|DEFEAT|ABANDONED|GAME INTERRUPTED/) || [""])[0]`);
      if (!screen && !(await page.eval<boolean>(`(() => { const b = document.querySelector("[data-skip-chip]"); if (!b) return false; b.click(); return true; })()`)) && !(await clickText(page, "Next"))) await sleep(60);
    }
    const expected = end.over?.winner ? (youWon ? "VICTORY" : "DEFEAT") : "none (a draw has no screen word this script reads)";
    check(screen === expected, `${tag}: fast-forwarding (the board's own skip and Next) through the ended match reaches the ${expected} screen the engine's result calls for (shown: ${screen || "none"}; winner ${end.over?.winner ?? "none"}, reason ${end.over?.reason})`);
    evidence[`${tag}-result`] = { seat, winner: end.over?.winner ?? null, reason: end.over?.reason ?? null, revision: end.game.revision, decisions: fin.entries.length };
    await layout(page, vp, "game over");
    await shot(page, vp, "10-game-over");

    // mismatch --------------------------------------------------------------------------------------
    at("mismatch", "open /arena/offline, add the audited test pack (another game version) from a file");
    await page.setOffline(false);
    await page.goto(URL_OFFLINE);
    await until(page, `!!document.querySelector('input[type=file]')`, 30000).catch(async () => { await page.eval(`document.querySelector('details > summary')?.click()`); });
    await page.eval(`[...document.querySelectorAll('summary')].find((s) => /Choose a deck pack/.test(s.textContent))?.click()`);
    await until(page, `!!document.querySelector('input[type=file]')`, 30000);
    await choosePack(page, packText);
    await until(page, `!!document.querySelector('[data-refusal]') || !!document.querySelector('[role=alert]')`, 30000);
    const why = await page.eval<string>(`(document.querySelector('[data-refusal]') || document.querySelector('[role=alert]')).textContent`);
    const startable = await page.eval<boolean>(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim().startsWith("Start match") && !b.disabled && b.getClientRects().length)`);
    check(/version|revision|made for|cannot|not/i.test(why) && why.length > 15, `${tag}: a pack made for another game version is refused with a reason ("${why.trim().slice(0, 140)}")`);
    notes.push(`note: ${tag}: Start match enabled after the refused pack: ${startable} (the prepared pack stays chosen)`);
    await shot(page, vp, "11-pack-mismatch");
  } catch (e) {
    const reason = (e as Error).message.split("\n")[0];
    stops.push({ viewport: tag, stage, reason, reproduction: repro });
    failures.push(`${tag}: stopped at "${stage}": ${reason}`);
    console.log(`FAIL ${tag}: stopped at "${stage}": ${reason}\n     reproduce: ${repro}`);
  } finally {
    check(taps.denied.length === 0, `${tag}: no match or provider request left the page (${taps.denied.length} denied${taps.denied[0] ? `: ${taps.denied[0].method} ${taps.denied[0].url}` : ""})`);
    await browser.close();
  }
}

try {
  const phone = VIEWPORTS.find((v) => v.name === "phone")!;
  const desk = VIEWPORTS.find((v) => v.name === "desk")!;
  await run(phone, "p2");
  await run(desk, "p1");
} finally {
  stopServer();
}
const meta = { base, commit: process.env.GITHUB_SHA ?? null, seconds: Math.round((Date.now() - t0) / 1000), evidence: "headless Chrome with device emulation (390x844 phone, 1440x900 desktop); physical-device evidence not collected", stops, failures, results: evidence };
writeFileSync(join(out, "run.json"), JSON.stringify({ ...meta, notes }, null, 2));
console.log(`\n${failures.length ? `${failures.length} FAILED` : "all checks passed"}; ${meta.seconds} s; screenshots and run.json in ${out}`);
console.log("Emulated headless Chrome only. Physical-device evidence: unverified.");
process.exit(failures.length ? 1 : 0);
