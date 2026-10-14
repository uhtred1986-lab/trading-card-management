/**
 * The offline arena on a REAL Android phone, played by touch, with the evidence for a UX review
 * (`docs/arena-phone-ux-review.md`; the phone half of `docs/arena-offline-release.md` §8).
 *
 *   npm run build                                   # GITHUB_SHA set, in a worktree with no .env.local
 *   npm run arena:phone                             # the phone on USB: ~2-4 h, unattended
 *   npm run arena:phone -- --emulated --cases 1     # no phone: headless Chrome at 390 px (proves the tool, NOT a phone)
 *
 * One `next start` on this machine (no database, no sign-in: open mode), reached from the phone over
 * the cable (`adb reverse`), and the phone's Chrome driven over the DevTools protocol (`adb forward`
 * to `chrome_devtools_remote`, `Browser.connect` in `scripts/lib/cdp.mts`):
 *
 *   1. Prepare, online: `/arena/offline`, "Prepare for offline play", timed, until "Ready".
 *   2. Offline: the server stops, the `reverse` is removed and the phone goes into airplane mode
 *      (`cmd connectivity airplane-mode`, Android 11+). USB debugging keeps working in airplane mode.
 *   3. Each case: Chrome is force-stopped and cold-launched on `/arena`, which must land on the cached
 *      shell; decks and seat are chosen and the match is played to its END BY TOUCH: the human's move
 *      (`humanPick`, as `arena:offline-release`) is made by tapping what a player would tap — the prompt
 *      bar's button, the card, the row on its sheet, the attack target. A move no tap reached is a
 *      finding (`unreachable`), then made through the board's own `act` so the match goes on. The
 *      computer's turn is followed beat by beat ("Next" at the step pace).
 *   4. Recovery (A v B, first): reload and Continue; force-close at a choice and Continue; force-close
 *      just after a move, during the computer's turn, and Continue; every save failing (the quota
 *      fault of `arena:offline-release`) and "Try again".
 *   5. Airplane mode off, the port mappings removed, the phone's pace preference restored.
 *
 * Evidence (`arena-phone-runs/<time>/`, git-ignored): a screenshot at every human decision, every
 * beat of the computer's turn, every card review and every recovery screen, each beside the screen
 * facts (`scripts/lib/ux-probe.mts`) and the engine's truth at that moment; `run.json`; `findings.md`
 * (the objective findings, the §8 table filled in where a figure exists); `review.html` (the contact
 * sheet the review in `docs/arena-phone-ux-review.md` is done from, truth hidden until opened).
 *
 * Long tasks, frames and heap are measured while screenshots are taken, which costs the page time:
 * for budget figures run again with `--shots none`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { Browser, sleep, VIEWPORTS, type Page, type Viewport } from "./lib/cdp.mts";
import { Adb, type DeviceInfo } from "./lib/adb.mts";
import { BOARD, IDB_FAULT, readJournalExpr } from "./lib/local-arena-page.mts";
import { SCREEN_FACTS, checksOf, truthOf, type Finding, type ScreenFacts, type Truth } from "./lib/ux-probe.mts";
import { CONTRAST_AUDIT, type ContrastRow } from "./lib/contrast-audit.mts";
import { BOARD_BUDGETS } from "./lib/worker-budgets.ts";
import { pngFor } from "./verify/arena-pack-store-fixture.mts";
import { humanAsked, humanPick } from "./verify/arena-local-storage-driver.ts";
import { stableJson } from "../src/lib/arena/policy/contract.ts";
import { shortLabel } from "../src/components/arena/shared-model.ts";
import { SHELL_PATH } from "../src/lib/arena/local/shell.ts";
import type { Snapshot } from "../src/lib/arena/snapshot-core.ts";
import type { Action } from "../src/lib/arena/types.ts";

// ── arguments ───────────────────────────────────────────────────────────────────────────────────
const FLAGS: Record<string, boolean> = {
  "--emulated": false, "--serial": true, "--browser-package": true, "--port": true, "--devtools-port": true, "--cases": true,
  "--no-recovery": false, "--pace": true, "--shots": true, "--card-review-every": true, "--out": true, "--no-airplane": false,
  "--skip-prepare": false, "--total-timeout": true,
};
function usage(message: string): never {
  console.error(`arena:phone: ${message}`);
  console.error("Usage: npm run arena:phone -- [--emulated] [--serial S] [--browser-package com.android.chrome] [--port 3763] [--devtools-port 9222]\n" +
    "  [--cases all|none|N|A-v-B-first,...] [--no-recovery] [--pace step|slow|normal] [--shots all|decisions|none] [--card-review-every 12]\n" +
    "  [--out DIR] [--no-airplane] [--skip-prepare] [--total-timeout HOURS]");
  process.exit(2);
}
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (!(argv[i] in FLAGS)) usage(`unknown argument ${argv[i]}`);
  if (FLAGS[argv[i]]) i++;
}
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const EMULATED = argv.includes("--emulated");
const PORT = Number(flag("--port") ?? 3763);
const DEVTOOLS_PORT = Number(flag("--devtools-port") ?? 9222);
const PACE = flag("--pace") ?? "step";
const SHOTS = flag("--shots") ?? "all";
const REVIEW_EVERY = Number(flag("--card-review-every") ?? 12);
const TOTAL_MS = Number(flag("--total-timeout") ?? 10) * 3600_000;
const AIRPLANE = !argv.includes("--no-airplane");
const PREPARE = !argv.includes("--skip-prepare");
const RECOVERY = !argv.includes("--no-recovery");
if (!["step", "slow", "normal"].includes(PACE)) usage("--pace is step, slow or normal");
if (!["all", "decisions", "none"].includes(SHOTS)) usage("--shots is all, decisions or none");
if (![PORT, DEVTOOLS_PORT, REVIEW_EVERY, TOTAL_MS].every((n) => Number.isFinite(n) && n > 0)) usage("bad number");
if (!fs.existsSync(".next/BUILD_ID")) usage("no production build: run `npm run build` first (with GITHUB_SHA set)");

const ALL_CASES: Array<{ id: string; mine: string; theirs: string; seat: "p1" | "p2" }> = [
  { id: "A-v-B-first", mine: "A", theirs: "B", seat: "p1" }, { id: "A-v-B-second", mine: "A", theirs: "B", seat: "p2" },
  { id: "B-v-A-first", mine: "B", theirs: "A", seat: "p1" }, { id: "B-v-A-second", mine: "B", theirs: "A", seat: "p2" },
  { id: "A-v-A-first", mine: "A", theirs: "A", seat: "p1" }, { id: "A-v-A-second", mine: "A", theirs: "A", seat: "p2" },
  { id: "B-v-B-first", mine: "B", theirs: "B", seat: "p1" }, { id: "B-v-B-second", mine: "B", theirs: "B", seat: "p2" },
];
const casesArg = flag("--cases") ?? "all";
const CASES = casesArg === "all" ? ALL_CASES : casesArg === "none" ? [] : /^\d+$/.test(casesArg) ? ALL_CASES.slice(0, Number(casesArg)) : casesArg.split(",").map((id) => ALL_CASES.find((c) => c.id === id) ?? usage(`no case ${id} (${ALL_CASES.map((c) => c.id).join(", ")})`));

const BASE = `http://localhost:${PORT}`;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
const OUT = path.resolve(flag("--out") ?? path.join("arena-phone-runs", `${stamp}${EMULATED ? "-emulated" : ""}`));
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });
const logFile = path.join(OUT, "run.log");
const log = (s: string) => { const line = `${new Date().toISOString().slice(11, 19)} ${s}`; console.log(line); fs.appendFileSync(logFile, `${line}\n`); };

// ── page expressions ────────────────────────────────────────────────────────────────────────────
const BOARD_NOW = `((window.__bc && !window.__bc.closed) ? window.__bc : (window.__bc = ${BOARD}))`;
/** Long tasks, frame intervals and the Worker's first answer (as `arena:offline-release`); idempotent. */
const INSTRUMENT = `(() => {
  if (window.__rel) return;
  const rel = { long: [], frames: [], workerReady: [], marks: {} };
  window.__rel = rel;
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) rel.long.push({ start: e.startTime, ms: e.duration }); }).observe({ type: "longtask", buffered: true }); } catch {}
  let prev;
  const tick = (now) => { if (prev !== undefined && rel.frames.length < 200000) rel.frames.push({ at: now, ms: now - prev }); prev = now; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  const W = window.Worker;
  window.Worker = class extends W {
    constructor(url, options) {
      super(url, options);
      const t0 = performance.now();
      const once = () => { rel.workerReady.push(performance.now() - t0); this.removeEventListener("message", once); };
      this.addEventListener("message", once);
    }
  };
})()`;
/** Record every action the board is asked to make from now on (a tap's `send` ends in `act`). */
const ARM = `(() => { const b = ${BOARD_NOW}; if (!b) return false; if (!b.__phoneArmed) { const act = b.act.bind(b); b.act = (a, ...rest) => { (window.__acts ??= []).push(a); return act(a, ...rest); }; b.__phoneArmed = true; } window.__acts = []; return true; })()`;
const UI = `(() => {
  const bar = document.querySelector(".arena-bar");
  const buttons = bar ? [...bar.querySelectorAll("button")].filter((b) => !b.disabled && b.getBoundingClientRect().width > 0) : [];
  const text = (b) => b.innerText.trim();
  const dlg = [...document.querySelectorAll("dialog[open], [role=dialog], [role=alertdialog]")].some((d) => d.getBoundingClientRect().height > 0);
  const notice = [...document.querySelectorAll("[role=alertdialog]")].find((d) => d.getBoundingClientRect().height > 0);
  return {
    next: buttons.some((b) => text(b).startsWith("Next")), skip: buttons.some((b) => text(b) === "Skip"), retry: buttons.some((b) => text(b) === "Retry"),
    line: (bar?.querySelector("p")?.innerText ?? "").trim().slice(0, 200), dialog: dlg,
    storage: document.body.innerText.includes("Could not save on this device"),
    targeting: (bar?.innerText ?? "").includes("Choose what to attack"),
    notice: notice ? notice.innerText.replace(/\\s+/g, " ").trim().slice(0, 300) : null,
  };
})()`;
/** A blocking dialog or sheet: a card sheet, a search, or a no-target notice (`QuietNotice`, #783, `role=alertdialog`). */
const DIALOG_SEL = "dialog[open], [role=dialog], [role=alertdialog]";
const DIALOG = `[...document.querySelectorAll(${JSON.stringify(DIALOG_SEL)})].find((d) => d.getBoundingClientRect().height > 0)`;
/** The no-target notice of #783: it holds the board until its OK is tapped. */
const NOTICE = `[...document.querySelectorAll("[role=alertdialog]")].find((d) => d.getBoundingClientRect().height > 0)`;
const SKIP_IN_SHEET = String.raw`/^(close|expand|previous card|next card|details|abilities now|×|see the board|inspect energy)/i`;

/** Finders: a function body (as text) returning candidate elements, best first. */
const F = {
  attr: (sel: string) => `() => [...document.querySelectorAll(${JSON.stringify(sel)})]`,
  card: (id: string) => `() => [...document.querySelectorAll('[data-arena-card="' + CSS.escape(${JSON.stringify(id)}) + '"]')]`,
  buttonText: (full: string) => `() => {
    const full = ${JSON.stringify(full.toLowerCase())}, short = ${JSON.stringify(shortLabel(full).toLowerCase())};
    const all = [...document.querySelectorAll("button")].filter((b) => !b.disabled);
    const t = (b) => b.innerText.replace(/\\s+/g, " ").trim().toLowerCase();
    const bar = (b) => (b.closest(".arena-bar") ? 0 : 1);
    return all.filter((b) => t(b) === full || t(b) === short || t(b).startsWith(full) || (short.length >= 6 && t(b).startsWith(short))).sort((a, b) => bar(a) - bar(b));
  }`,
  startsWith: (prefix: string) => `() => [...document.querySelectorAll("button")].filter((b) => !b.disabled && b.innerText.trim().startsWith(${JSON.stringify(prefix)}))`,
  ariaStarts: (prefix: string) => `() => [...document.querySelectorAll("button[aria-label]")].filter((b) => !b.disabled && b.getAttribute("aria-label").startsWith(${JSON.stringify(prefix)}))`,
  dialogRowNamed: (name: string) => `() => { const d = ${DIALOG}; return d ? [...d.querySelectorAll("button")].filter((b) => !b.disabled && b.innerText.includes(${JSON.stringify(name)})) : []; }`,
  sheetRow: (label: string, attack: boolean) => `() => {
    const d = ${DIALOG};
    if (!d) return [];
    const want = ${JSON.stringify(label.toLowerCase())}, short = ${JSON.stringify(shortLabel(label).toLowerCase())};
    const words = want.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const rows = [...d.querySelectorAll("button")].filter((b) => !b.disabled && !b.closest("[role=group]") && !${SKIP_IN_SHEET}.test((b.getAttribute("aria-label") || b.innerText || "").trim()));
    // An ability's button may say only "Activate": its row's ability text (data-ability-index) names it.
    const textOf = (b) => (b.innerText + " " + (b.closest("[data-ability-index]")?.innerText ?? "")).replace(/\\s+/g, " ").toLowerCase();
    const score = (b) => { const t = textOf(b); if (b.innerText.toLowerCase().includes(want)) return 100; if (${attack} && b.innerText.toLowerCase().startsWith("attack with")) return 90; if (t.includes(short)) return 80; return words.filter((w) => t.includes(w)).length; };
    const ranked = rows.map((b) => [b, score(b)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([b]) => b);
    return ranked.length ? ranked : rows.length === 1 ? rows : [];
  }`,
};

// ── the device ──────────────────────────────────────────────────────────────────────────────────
const DEVICE_VP: Viewport = { name: "device", width: 0, height: 0, mobile: true };
const EMU_VP = VIEWPORTS.find((v) => v.name === "phone")!;

interface Transport {
  readonly kind: "phone" | "emulated";
  info: DeviceInfo | Record<string, unknown>;
  browser: Browser | null;
  open(url: string): Promise<Page>;
  goOffline(): Promise<{ airplane: boolean; how: string }>;
  coldLaunch(url: string): Promise<{ page: Page; t0: number }>;
  kill(): Promise<void>;
  endCase(): Promise<void>;
  memoryBytes(): number | null;
  deviceShot(): Buffer | null;
  teardown(): Promise<void>;
}

class PhoneTransport implements Transport {
  readonly kind = "phone" as const;
  readonly adb: Adb;
  info: DeviceInfo;
  browser: Browser | null = null;
  private airplaneSet = false;
  constructor() {
    this.adb = Adb.open({ serial: flag("--serial"), browserPackage: flag("--browser-package") });
    this.info = this.adb.info();
    this.adb.stayAwake(true);
    this.adb.forwardDevtools(DEVTOOLS_PORT);
    this.adb.reverse(PORT);
  }
  private async connect(ms = 45000) {
    const end = Date.now() + ms;
    let last = "";
    while (Date.now() < end) {
      try { this.browser = await Browser.connect(`http://localhost:${DEVTOOLS_PORT}`); return this.browser; } catch (e) { last = (e as Error).message; }
      await sleep(500);
    }
    throw new Error(`the phone's browser did not open its DevTools socket in ${ms / 1000} s (${last}). Is ${this.adb.browserPackage} installed, the phone unlocked?`);
  }
  /** The tab on `url` the phone just opened, attached. */
  private async tab(url: string, ms = 45000): Promise<Page> {
    const b = this.browser ?? (await this.connect());
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const t = (await b.targets()).find((x) => x.type === "page" && x.url.startsWith(BASE));
      if (t) {
        const page = await b.attach(t.targetId, DEVICE_VP, { emulate: false });
        await page.beforeLoad(INSTRUMENT);
        return page;
      }
      await sleep(300);
    }
    throw new Error(`no tab on ${url} appeared on the phone in ${ms / 1000} s`);
  }
  private async closeOurTabs() {
    if (!this.browser) return;
    for (const t of await this.browser.targets().catch(() => [])) if (t.type === "page" && t.url.startsWith(BASE)) await this.browser.send("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  }
  async open(url: string) {
    if (!this.browser) await this.connect();
    await this.closeOurTabs();
    this.adb.openUrl(url);
    return this.tab(url);
  }
  async goOffline() {
    this.adb.reverseRemoveAll();
    if (!AIRPLANE) return { airplane: false, how: "--no-airplane: only the server is stopped and the reverse removed; Wi-Fi and data stay on" };
    const r = this.adb.setAirplane(true);
    this.airplaneSet = r.ok;
    return { airplane: r.ok, how: r.how };
  }
  async coldLaunch(url: string) {
    await this.closeOurTabs();
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.adb.forceStopBrowser();
    await sleep(800);
    const t0 = Date.now();
    this.adb.openUrl(url);
    await this.connect();
    return { page: await this.tab(url), t0 };
  }
  async kill() {
    this.adb.forceStopBrowser();
    await this.browser?.close().catch(() => {});
    this.browser = null;
  }
  async endCase() { await this.closeOurTabs(); }
  memoryBytes() { return this.adb.browserPss()?.totalBytes ?? null; }
  deviceShot() { try { return this.adb.screencap(); } catch { return null; } }
  async teardown() {
    await this.browser?.close().catch(() => {});
    if (this.airplaneSet || this.adb.airplaneOn()) this.adb.setAirplane(false);
    this.adb.reverseRemoveAll();
    this.adb.forwardRemove(DEVTOOLS_PORT);
    this.adb.stayAwake(false);
  }
}

class EmulatedTransport implements Transport {
  readonly kind = "emulated" as const;
  info: Record<string, unknown> = { what: "headless Chrome, 390x844 touch viewport: EMULATION, not a phone" };
  browser: Browser | null = null;
  private profile = fs.mkdtempSync(path.join(os.tmpdir(), "arena-phone-emulated-"));
  private offline = false;
  private async launch() {
    this.browser = await Browser.launch({ userDataDir: this.profile, args: this.offline ? ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"] : [] });
    const page = await this.browser.page(EMU_VP);
    await page.clipOverflow();
    await page.beforeLoad(INSTRUMENT);
    if (this.offline) await page.setOffline(true);
    return page;
  }
  async open(url: string) {
    const page = await this.launch();
    // No card CDN in a sandbox: the preparation's art requests are answered with placeholder PNGs (as arena:offline-release).
    await page.interceptFetch("*/_next/image*");
    page.onFetchPaused((p) => {
      const u = new URL(p.request.url).searchParams.get("url");
      if (!u) { void page.continueFetch(p.requestId); return; }
      setTimeout(() => void page.fulfillFetchBytes(p.requestId, pngFor(u), "image/png").catch(() => {}), 10);
    });
    await page.goto(url);
    return page;
  }
  async goOffline() {
    await this.browser?.close().catch(() => {});
    this.browser = null;
    this.offline = true;
    return { airplane: false, how: "emulated: every host but localhost unresolvable for the browser, and the tab offline" };
  }
  async coldLaunch(url: string) {
    await this.browser?.close().catch(() => {});
    const t0 = Date.now();
    const page = await this.launch();
    await page.goto(url).catch(() => {});
    return { page, t0 };
  }
  async kill() { await this.browser?.kill(); this.browser = null; }
  async endCase() {}
  memoryBytes() { return null; }
  deviceShot() { return null; }
  async teardown() {
    await this.browser?.close().catch(() => {});
    fs.rmSync(this.profile, { recursive: true, force: true });
  }
}

// ── the server ──────────────────────────────────────────────────────────────────────────────────
function startServer() {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(PORT), NODE_ENV: "production" };
  for (const k of Object.keys(env)) if (/^(DATABASE_URL|AUTH_SECRET|GOOGLE_CLIENT_|BASIC_AUTH_|SL_EMAILS|ARENA_ADMINS|ANTHROPIC|APP_ANTHROPIC|OPENROUTER|CLAUDE_CODE)/.test(k)) delete env[k];
  const proc = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  proc.stdout.on("data", (d) => { out += d; });
  proc.stderr.on("data", (d) => { out += d; });
  return { proc, log: () => out };
}
async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`${BASE}/arena/offline/shell.json`)).ok) return true; } catch { /* not yet */ }
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

// ── page helpers ────────────────────────────────────────────────────────────────────────────────
async function until(page: Page, predicate: string, ms = 30000, what = predicate) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.eval(predicate).catch(() => false)) return;
    await sleep(150);
  }
  throw new Error(`timed out (${ms / 1000} s) waiting for ${what}`);
}

interface Blocker { x: number; y: number; what: string; w: number; h: number }
interface TapResult { ok: boolean; why?: string; scrolled?: boolean; dismissed?: string; blockedBy?: Blocker }
/**
 * Touch the first candidate the finder returns that a finger can reach. A target off screen or under
 * something (a sticky bar, the tab bar, a pop-up) is first scrolled to the middle of the screen, as a
 * player would; `scrolled` says so. Still covered after that, the coverer is named in words.
 */
async function tapFind(page: Page, finder: string, clearPopups = true): Promise<TapResult> {
  const p = await page.eval<{ x: number; y: number; scrolled: boolean } | { why: string; dismiss?: Blocker }>(`(() => {
    const els = (${finder})().filter(Boolean);
    if (!els.length) return { why: "not on the page" };
    const name = (e) => { for (let x = e; x && x !== document.body; x = x.parentElement) { const t = (x.getAttribute("aria-label") || x.innerText || "").replace(/\\s+/g, " ").trim(); if (t) return '"' + t.slice(0, 50) + '"'; } return e ? e.tagName.toLowerCase() : "nothing"; };
    const reach = (el) => {
      const r = el.getBoundingClientRect();
      for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.3], [0.5, 0.7], [0.3, 0.5], [0.7, 0.5], [0.2, 0.2], [0.8, 0.8]]) {
        const x = r.left + r.width * fx, y = r.top + r.height * fy;
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x, y };
      }
      return null;
    };
    let why = "covered";
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) { why = "not drawn"; continue; }
      const at = reach(el);
      if (at) return { ...at, scrolled: false };
      el.scrollIntoView({ block: "center", inline: "center" });
      const again = reach(el);
      if (again) return { ...again, scrolled: true };
      const q = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, q.left + q.width / 2)), Math.min(innerHeight - 1, Math.max(0, q.top + q.height / 2)));
      why = "covered by " + name(hit);
      // A skill pop-up (the spotlight) carries its own close button: a player closes it and taps again.
      let box = hit;
      while (box && box !== document.body && !box.querySelector('button[aria-label="Dismiss"]')) box = box.parentElement;
      const close = box && box !== document.body ? box.querySelector('button[aria-label="Dismiss"]') : null;
      if (close) { const c = close.getBoundingClientRect(); return { why, dismiss: { x: c.left + c.width / 2, y: c.top + c.height / 2, what: name(box), w: Math.round(c.width), h: Math.round(c.height) } }; }
    }
    return { why };
  })()`);
  if ("why" in p) {
    // Without clearPopups the caller is told what blocks the target and decides (a move's tap records it as a failure first).
    if (!p.dismiss || !clearPopups) return { ok: false, why: p.why, blockedBy: p.dismiss };
    await page.pointer("down", p.dismiss.x, p.dismiss.y);
    await sleep(60);
    await page.pointer("up", p.dismiss.x, p.dismiss.y);
    await sleep(350);
    const again = await tapFind(page, finder, false);
    return again.ok ? { ...again, dismissed: p.dismiss.what } : { ok: false, why: `${again.why} (after closing the pop-up ${p.dismiss.what})` };
  }
  if (p.scrolled) await sleep(250);
  await page.pointer("down", p.x, p.y);
  await sleep(60);
  await page.pointer("up", p.x, p.y);
  return { ok: true, scrolled: p.scrolled };
}
async function tapButton(page: Page, text: string) {
  return tapFind(page, F.startsWith(text));
}

interface View { kind: string; saving: boolean; matchId: string; snapshot: Snapshot | null }
async function view(page: Page): Promise<View | null> {
  const raw = await page.eval<string | null>(`(() => { const b = ${BOARD_NOW}; if (!b) return null; return JSON.stringify({ kind: b.state.kind, saving: b.saving, matchId: b.matchId, snapshot: b.supervisor.snapshot }); })()`).catch(() => null);
  return raw ? (JSON.parse(raw) as View) : null;
}
async function journalHumans(page: Page, matchId: string): Promise<number> {
  const j = await page.eval<{ entries: Array<{ kind: string }> } | null>(readJournalExpr(matchId));
  return j ? j.entries.filter((e) => e.kind === "human").length : -1;
}

// ── evidence ────────────────────────────────────────────────────────────────────────────────────
interface Shot {
  n: number; case: string; kind: string; file: string | null; deviceFile: string | null; at: string;
  revision: number | null; note: string | null; facts: ScreenFacts | null; truth: Truth | null; findings: Finding[];
}
const shots: Shot[] = [];
let shotN = 0;
async function shoot(page: Page, caseId: string, kind: string, s: Snapshot | null, o: { note?: string; decision?: boolean; logFrom?: number; device?: boolean; force?: boolean } = {}): Promise<Shot> {
  const wanted = o.force || SHOTS === "all" || (SHOTS === "decisions" && (kind === "decision" || kind === "unreachable"));
  const facts = await page.eval<ScreenFacts>(SCREEN_FACTS).catch(() => null);
  // The contrast walk is slow on a phone: the screens a player reads, not every beat.
  if (facts && ["decision", "card-review", "hand-review", "zones", "storage-full", "saved-match", "over"].includes(kind)) {
    const rows = await page.eval<ContrastRow[]>(CONTRAST_AUDIT).catch(() => [] as ContrastRow[]);
    const seen = new Set<string>();
    facts.lowContrast = rows.filter((r) => r.ratio < r.need && !r.image && /[\p{L}\p{N}]/u.test(r.text) && r.y >= 0 && r.y < facts.vh && !seen.has(r.text) && seen.add(r.text)).slice(0, 30).map((r) => ({ text: r.text, ratio: r.ratio, need: r.need }));
  }
  const truth = s ? truthOf(s, o.logFrom ?? s.log.length) : null;
  const n = ++shotN;
  const dir = path.join(OUT, "shots", caseId);
  fs.mkdirSync(dir, { recursive: true });
  let file: string | null = null;
  let deviceFile: string | null = null;
  if (wanted && SHOTS !== "none") {
    const img = await page.cdp<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 70 }).catch(() => null);
    if (img) { file = path.join("shots", caseId, `${String(n).padStart(5, "0")}-${kind}.jpg`); fs.writeFileSync(path.join(OUT, file), Buffer.from(img.data, "base64")); }
    if (o.device) {
      const png = T.deviceShot();
      if (png) { deviceFile = path.join("shots", caseId, `${String(n).padStart(5, "0")}-${kind}-device.png`); fs.writeFileSync(path.join(OUT, deviceFile), png); }
    }
  }
  const shot: Shot = { n, case: caseId, kind, file, deviceFile, at: new Date().toISOString(), revision: s?.game.revision ?? null, note: o.note ?? null, facts, truth, findings: facts ? checksOf(facts, truth, { decision: !!o.decision }) : [] };
  shots.push(shot);
  return shot;
}

// ── a human move, by touch ──────────────────────────────────────────────────────────────────────
interface Obstruction { target: string; by: string; closeW: number; closeH: number; shot: number; recovered: boolean }
/**
 * `tapped`: every control the move needed was directly reachable. `obstructed`: the move went through
 * only after the harness closed a pop-up covering it — a failure, not a tap. `tapToActMs` runs from the
 * player's first required interaction (a pop-up's close included) to the move; `recoveryMs` is the
 * part spent closing pop-ups and waiting for them to go.
 */
interface Attempt { revision: number; label: string; result: "tapped" | "obstructed" | "tapped-other" | "unreachable"; taps: string[]; scrolled: boolean; obstructions: Obstruction[]; recoveryMs: number; tapToActMs: number | null; problem: string | null; shot: number | null }
const cardIdOf = (a: Action): string | null => {
  const x = a as { card?: string | null; attacker?: string; cards?: string[] };
  if (typeof x.card === "string") return x.card;
  if (typeof x.attacker === "string") return x.attacker;
  if (Array.isArray(x.cards) && x.cards.length === 1) return x.cards[0];
  return null;
};
function cardName(s: Snapshot, id: string): string {
  const v = s.view;
  const all = [v.you.leader, v.them.leader, v.you.unison, v.them.unison, ...v.you.battle, ...v.them.battle, ...v.you.combo, ...v.them.combo, ...v.you.energy, ...v.them.energy, ...(v.you.hand ?? []), ...(v.you.choices ?? [])];
  return all.find((c) => c?.id === id)?.name ?? id;
}
async function tidy(page: Page) {
  const ui = await page.eval<{ targeting: boolean; dialog: boolean; notice: string | null }>(UI);
  if (ui.notice) return; // a notice is acknowledged by its OK in playOn, never dismissed as clutter
  if (ui.targeting) await tapButton(page, "Cancel");
  if (ui.dialog) {
    const r = await tapFind(page, `() => { const d = ${DIALOG}; return d ? [...d.querySelectorAll("button")].filter((b) => /^(close|×|see the board)/i.test((b.getAttribute("aria-label") || b.innerText || "").trim())) : []; }`);
    if (!r.ok) await page.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {});
    await sleep(300);
  }
}
async function perform(page: Page, caseId: string, s: Snapshot): Promise<Attempt> {
  const intent = humanPick(s);
  const key = stableJson(intent);
  const l = s.legal.find((x) => stableJson(x.action) === key)!;
  await page.eval(ARM);
  const taps: string[] = [];
  const t0 = Date.now();
  let firstTap: number | null = null;
  let scrolled = false;
  const obstructions: Obstruction[] = [];
  let recoveryMs = 0;
  const acts = () => page.eval<Action[]>("window.__acts ?? []");
  const sentWithin = async (ms: number) => { const end = Date.now() + ms; do { if ((await acts()).length) return true; await sleep(80); } while (Date.now() < end); return false; };
  const tap = async (what: string, finder: string) => {
    let r = await tapFind(page, finder, false);
    if (!r.ok && r.blockedBy) {
      // The control the move needs is under a skill pop-up: a UX failure in its own right (owner, #787
      // review), shot as the player sees it before anything is touched. The harness then closes the
      // pop-up only so the match can go on; the move is reported as obstructed, never as a plain tap.
      const b = r.blockedBy;
      const shot = await shoot(page, caseId, "obstructed", s, { force: true, note: `${what} for "${l.label}" is covered by the pop-up ${b.what}; its close control is ${b.w}x${b.h} px` });
      shot.findings.push({ kind: "obstructed-target", severity: "major", detail: `the move needs ${what}, covered by a skill pop-up; the way out is a ${b.w}x${b.h} px close control` });
      firstTap ??= Date.now(); // the player's first required interaction is closing the pop-up
      const tr = Date.now();
      await page.pointer("down", b.x, b.y);
      await sleep(60);
      await page.pointer("up", b.x, b.y);
      await sleep(350);
      r = await tapFind(page, finder, false);
      recoveryMs += Date.now() - tr;
      obstructions.push({ target: what, by: b.what, closeW: b.w, closeH: b.h, shot: shot.n, recovered: r.ok });
      taps.push(`${what}: covered by the pop-up ${b.what.slice(0, 40)}; the harness closed it (${b.w}x${b.h} px control)`);
    }
    taps.push(r.ok ? `${what}${r.scrolled ? " (had to scroll to it)" : ""}` : `${what}: ${r.why}`);
    if (r.scrolled) scrolled = true;
    if (r.ok) firstTap ??= Date.now();
    return r.ok;
  };
  const ui = () => page.eval<{ targeting: boolean; dialog: boolean }>(UI);
  let problem: string | null = null;
  try {
    const card = cardIdOf(intent);
    if (intent.type === "payCost") {
      await tap(`payment option ${intent.option}`, F.attr(`[data-payment-option="${intent.option}"]`));
    } else if (!card) {
      if (!(await tap(`button "${shortLabel(l.label)}"`, F.buttonText(l.label)))) {
        if (await tap("Choose from …", F.startsWith("Choose from"))) { await sleep(500); if (!(await tap(`"${l.label}"`, F.buttonText(l.label)))) await tap("Choose none", F.startsWith("Choose none")); }
      }
    } else {
      const name = cardName(s, card);
      const target = intent.type === "attack" ? intent.target : null;
      if ((await ui()).dialog && (await tap(`row "${name}"`, F.dialogRowNamed(name)))) { /* a search sheet already open */ }
      else if (await tap(`card "${name}"`, F.card(card))) { /* on the board or in the hand */ }
      else if (await tap("Choose from …", F.startsWith("Choose from"))) { await sleep(500); await tap(`row "${name}"`, F.dialogRowNamed(name)); }
      if (!(await sentWithin(900))) {
        let u = await ui();
        if (u.dialog) { await tap(`sheet row "${l.label}"`, F.sheetRow(l.label, intent.type === "attack")); if (!(await sentWithin(900))) u = await ui(); }
        if (target && u.targeting) await tap(`target "${cardName(s, target)}"`, F.card(target));
      }
    }
  } catch (e) { problem = (e as Error).message; }
  await sentWithin(1500);
  const sent = await acts();
  if (!sent.length) {
    const shot = await shoot(page, caseId, "unreachable", s, { note: `${l.label} — taps: ${taps.join(" → ") || "none"}`, force: true });
    await tidy(page);
    const err = await page.eval<string | null>(`${BOARD_NOW}.act(${key}, ${s.game.revision}, crypto.randomUUID()).then((r) => r.error)`).catch((e) => String(e));
    if (err) problem = `${problem ? `${problem}; ` : ""}the fallback act was refused: ${err}`;
    // A tap's `send` starts the computer's reply itself (ArenaStage `launchAdvance`); a move made past the
    // board does not, so the run asks for it, as arena:offline-release does after every human move.
    else await kickComputer(page);
    return { revision: s.game.revision, label: l.label, result: "unreachable", taps, scrolled, obstructions, recoveryMs, tapToActMs: null, problem, shot: shot.n };
  }
  const same = stableJson(sent[0]) === key;
  return { revision: s.game.revision, label: l.label, result: !same ? "tapped-other" : obstructions.length ? "obstructed" : "tapped", taps, scrolled, obstructions, recoveryMs, tapToActMs: firstTap ? Math.max(0, Date.now() - firstTap) : Date.now() - t0, problem: same ? problem : `tapping sent ${stableJson(sent[0]).slice(0, 160)}`, shot: null };
}

/** The computer is to move and nothing asked it: ask (the board's own `advance`). */
async function kickComputer(page: Page): Promise<boolean> {
  const v = await view(page);
  const s = v?.snapshot;
  if (!s || s.game.status === "over" || humanAsked(s)) return false;
  await page.eval<string | null>(`${BOARD_NOW}.advance().then((r) => r.error)`).catch(() => null);
  return true;
}

// ── card navigation ─────────────────────────────────────────────────────────────────────────────
interface Review { revision: number; target: string; opened: boolean; openMs: number | null; nameShown: boolean; pager: boolean; nextChanges: boolean | null; swipeChanges: boolean | null; closed: boolean; hand: { opened: boolean; cards: string | null } | null; zones: boolean | null; shots: number[]; obstructedBy: string | null }
const dialogName = (page: Page) => page.eval<string>(`(() => { const d = ${DIALOG}; return d ? (d.querySelector("h3")?.innerText ?? "").trim() : ""; })()`);
const dialogOpen = (page: Page) => page.eval<boolean>(`!!${DIALOG}`);
async function waitDialog(page: Page, open: boolean, ms = 2500) { const t = Date.now(); while (Date.now() - t < ms) { if ((await dialogOpen(page)) === open) return Date.now() - t; await sleep(60); } return null; }
async function closeDialog(page: Page) {
  await tapFind(page, F.ariaStarts("Close card review"));
  if ((await waitDialog(page, false, 1200)) === null) await tidy(page);
  return !(await dialogOpen(page));
}
async function cardReview(page: Page, caseId: string, s: Snapshot): Promise<Review | null> {
  const v = s.view;
  const quiet = (id: string) => !s.taps.byCard[id]?.length && !s.taps.whyByCard?.[id]?.length;
  const pick = [...v.them.battle, v.them.leader, v.you.leader, ...v.you.battle].find((c) => c && quiet(c.id));
  if (!pick) return null;
  const out: Review = { revision: s.game.revision, target: pick.name, opened: false, openMs: null, nameShown: false, pager: false, nextChanges: null, swipeChanges: null, closed: false, hand: null, zones: null, shots: [], obstructedBy: null };
  let r = await tapFind(page, F.card(pick.id), false);
  if (!r.ok && r.blockedBy) {
    // The card is under a skill pop-up: recorded (shot first), then closed so the review can go on.
    const b = r.blockedBy;
    const shot = await shoot(page, caseId, "obstructed", s, { force: true, note: `card review: ${pick.name} is covered by the pop-up ${b.what}; its close control is ${b.w}x${b.h} px` });
    shot.findings.push({ kind: "obstructed-target", severity: "major", detail: `reviewing ${pick.name} needs the card, covered by a skill pop-up; the way out is a ${b.w}x${b.h} px close control` });
    out.obstructedBy = `${b.what.slice(0, 40)} (close control ${b.w}x${b.h} px, shot ${shot.n})`;
    await page.pointer("down", b.x, b.y);
    await sleep(60);
    await page.pointer("up", b.x, b.y);
    await sleep(350);
    r = await tapFind(page, F.card(pick.id), false);
  }
  if (!r.ok) return { ...out, target: `${pick.name} (${r.why})` };
  out.openMs = await waitDialog(page, true);
  out.opened = out.openMs !== null;
  if (!out.opened) { out.shots.push((await shoot(page, caseId, "card-review-failed", s, { note: `tapped ${pick.name}, no review opened`, force: true })).n); return out; }
  await sleep(250);
  const name0 = await dialogName(page);
  out.nameShown = name0.includes(pick.name);
  out.shots.push((await shoot(page, caseId, "card-review", s, { note: `review of ${pick.name}` })).n);
  out.pager = (await page.eval<boolean>(`!!${DIALOG}?.querySelector('button[aria-label="Next card"]:not(:disabled)')`)) ?? false;
  if (out.pager) {
    await tapFind(page, `() => { const d = ${DIALOG}; return d ? [...d.querySelectorAll('button[aria-label="Next card"]')] : []; }`);
    await sleep(400);
    const name1 = await dialogName(page);
    out.nextChanges = name1 !== "" && name1 !== name0;
    out.shots.push((await shoot(page, caseId, "card-review-next", s, { note: `Next card: "${name0}" → "${name1}"` })).n);
    const before = name1;
    await page.swipe(DIALOG_SEL, 140, 0).catch(() => {});
    await sleep(500);
    out.swipeChanges = (await dialogOpen(page)) && (await dialogName(page)) !== before;
  }
  out.closed = await closeDialog(page);
  // The hand, one card after another
  if ((v.you.hand?.length ?? 0) >= 2) {
    const h = await tapFind(page, F.ariaStarts("Inspect your hand"));
    if (h.ok && (await waitDialog(page, true)) !== null) {
      await sleep(250);
      const pos = await page.eval<string>(`(${DIALOG}?.innerText.match(/\\d+ \\/ \\d+/) ?? [""])[0]`);
      out.hand = { opened: true, cards: pos || null };
      out.shots.push((await shoot(page, caseId, "hand-review", s, { note: `hand review ${pos}` })).n);
      await closeDialog(page);
    } else out.hand = { opened: false, cards: h.ok ? null : h.why ?? null };
  }
  // The public zones (drop, warp, ...)
  const z = await tapFind(page, F.ariaStarts("Inspect public zones"));
  if (z.ok && (await waitDialog(page, true)) !== null) {
    await sleep(250);
    out.zones = true;
    out.shots.push((await shoot(page, caseId, "zones", s, { note: "public zones" })).n);
    await tidy(page);
  } else out.zones = z.ok ? false : null;
  return out;
}

// ── playing a match ─────────────────────────────────────────────────────────────────────────────
interface Notice { revision: number; text: string; acknowledged: boolean; how: string; shot: number }
interface Play { decisions: number; attempts: Attempt[]; reviews: Review[]; notices: Notice[]; playbackShots: number; stalls: string[]; end: View | null }
const newPlay = (): Play => ({ decisions: 0, attempts: [], reviews: [], notices: [], playbackShots: 0, stalls: [], end: null });

/**
 * The no-target notice (#783) stands over the board, holding the story, the player's moves and the
 * computer's next advance until OK is tapped. Shot, then acknowledged through its own OK button.
 */
async function acknowledgeNotice(page: Page, caseId: string, s: Snapshot | null, text: string): Promise<Notice> {
  const shot = await shoot(page, caseId, "no-target-notice", s, { force: true, note: text });
  const r = await tapFind(page, `() => { const d = ${NOTICE}; return d ? [...d.querySelectorAll("button")].filter((b) => b.innerText.trim() === "OK") : []; }`);
  let gone = false;
  for (let i = 0; i < 20 && r.ok; i++) { if (!(await page.eval<boolean>(`!!${NOTICE}`))) { gone = true; break; } await sleep(100); }
  const n: Notice = { revision: s?.game.revision ?? -1, text, acknowledged: gone, how: r.ok ? (gone ? "OK tapped" : "OK tapped, the notice stayed") : `OK not tappable (${r.why})`, shot: shot.n };
  log(`  ${caseId}: no-target notice "${text.slice(0, 90)}" — ${n.how}`);
  return n;
}
async function playOn(page: Page, caseId: string, play: Play, o: { stop?: (s: Snapshot, decisions: number) => boolean; deadline: number }): Promise<View> {
  let lastLine = "";
  let logFrom = 0;
  let waitingSince = 0;
  let lastRevision = -1;
  for (;;) {
    if (Date.now() > o.deadline) throw new Error(`${caseId}: the case ran past its time limit`);
    const ui = await page.eval<{ next: boolean; skip: boolean; retry: boolean; line: string; dialog: boolean; storage: boolean; targeting: boolean; notice: string | null }>(UI).catch(() => null);
    const v = await view(page);
    if (!ui || !v?.snapshot) { await sleep(250); continue; }
    const s = v.snapshot;
    if (s.game.revision !== lastRevision) { lastRevision = s.game.revision; waitingSince = Date.now(); }
    if (ui.notice) {
      const n = await acknowledgeNotice(page, caseId, s, ui.notice);
      play.notices.push(n);
      if (!n.acknowledged) throw new Error(`${caseId}: a no-target notice could not be acknowledged by touch (${n.how})`);
      waitingSince = Date.now();
      continue;
    }
    if (ui.next || ui.skip) {
      // The story of a turn: one shot per beat ("Next" at the step pace, a change of line otherwise).
      if (ui.line !== lastLine) { await shoot(page, caseId, "playback", s, { note: ui.line, logFrom }); play.playbackShots++; lastLine = ui.line; logFrom = s.log.length; }
      if (ui.next) await tapButton(page, "Next");
      else if (Date.now() - waitingSince > 120_000) { play.stalls.push(`playback did not end in 120 s at revision ${s.game.revision}: "${ui.line}"`); await tapButton(page, "Skip"); }
      await sleep(ui.next ? 200 : 300);
      continue;
    }
    if (s.game.status === "over") {
      await sleep(600);
      await shoot(page, caseId, "over", s, { force: true, logFrom });
      play.end = v;
      return v;
    }
    if (ui.retry) {
      play.stalls.push(`the computer's move failed at revision ${s.game.revision} ("${ui.line}"): Retry pressed`);
      await shoot(page, caseId, "retry", s, { note: ui.line, force: true });
      await tapButton(page, "Retry");
      await sleep(500);
      continue;
    }
    if (v.saving || v.kind !== "owner" || !humanAsked(s)) {
      if (Date.now() - waitingSince > 45_000) {
        await shoot(page, caseId, "stall", s, { note: ui.line, force: true });
        const kicked = !humanAsked(s) && (await kickComputer(page));
        play.stalls.push(`nothing moved for 45 s at revision ${s.game.revision} (${v.kind}, "${ui.line}")${kicked ? "; the run asked the computer to move" : ""}`);
        waitingSince = Date.now();
      }
      await sleep(200);
      continue;
    }
    if (o.stop?.(s, play.decisions)) return v;
    // A human decision: the screen as the player sees it once it has come to rest (a player reads before
    // tapping), then (now and then) the card navigation, then the move.
    for (let i = 0; i < 12; i++) { if (!(await page.eval<boolean>(`document.getAnimations().some((a) => a.playState === "running" && Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))`).catch(() => false))) break; await sleep(150); }
    await sleep(150);
    play.decisions++;
    await shoot(page, caseId, "decision", s, { decision: true, logFrom, note: ui.line });
    logFrom = s.log.length;
    lastLine = "";
    if (play.decisions === 2 || play.decisions % REVIEW_EVERY === 0) {
      const r = await cardReview(page, caseId, s).catch((e) => { play.stalls.push(`card review failed: ${(e as Error).message}`); return null; });
      if (r) play.reviews.push(r);
      await tidy(page);
    }
    const a = await perform(page, caseId, s);
    play.attempts.push(a);
    if (a.result !== "tapped") log(`  ${caseId} r${a.revision}: ${a.result} "${a.label}" (${a.taps.join(" → ")})${a.problem ? ` — ${a.problem}` : ""}`);
    const t = Date.now();
    while (Date.now() - t < 30000) {
      const u = await page.eval<{ next: boolean; skip: boolean; storage: boolean; notice: string | null }>(UI).catch(() => null);
      const w = await view(page);
      if (u?.next || u?.skip || u?.storage || u?.notice || (w?.snapshot && w.snapshot.game.revision !== s.game.revision)) break;
      await sleep(100);
    }
  }
}

// ── one case ────────────────────────────────────────────────────────────────────────────────────
interface CaseResult {
  id: string; decks: string; seat: string; ok: boolean; error: string | null;
  coldLaunchToShellMs: number | null; landedOn: string | null; startTapToBoardMs: number | null;
  decisions: number; tapped: number; tappedOther: number; unreachable: number; obstructed: number; recoveryMs: { p50: number; max: number } | null; neededScroll: number; notices: Notice[]; tapToActMs: { p50: number; p95: number; max: number } | null;
  playbackShots: number; reviews: Review[]; stalls: string[]; revision: number | null; winner: string | null; reason: string | null;
  imagesOnFinalBoard: number; brokenImages: number; remoteImages: number;
  longTasks: number; longTaskMaxMs: number; framesOver50: number; frames: number; mainHeapAfterGc: number | null; workerHeapAfterGc: number | null;
  browserPssBytes: number | null; failedRequests: number; seconds: number;
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.max(0, Math.ceil(p * s.length) - 1)] : NaN; };

const workerSessions = new Map<string, string>();
async function watchWorkers(page: Page) {
  const b = T.browser!;
  const sid = (page as unknown as { sid: string }).sid;
  b.on((method, params, sessionId) => {
    if (method === "Target.attachedToTarget" && sessionId === sid && params.targetInfo?.type === "worker") workerSessions.set(params.sessionId, sid);
    if (method === "Target.detachedFromTarget") workerSessions.delete(params.sessionId);
  });
  await page.cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }).catch(() => {});
}
async function inWorkers(expression: string) {
  let n = 0;
  for (const s of workerSessions.keys()) if (await T.browser!.send("Runtime.evaluate", { expression }, s).then(() => true, () => false)) n++;
  return n;
}
async function heap(page: Page) {
  const used = async (session?: string) => {
    const send = (m: string) => (session ? T.browser!.send(m, {}, session) : page.cdp(m, {}));
    await send("HeapProfiler.collectGarbage").catch(() => {});
    return ((await send("Runtime.getHeapUsage")) as { usedSize: number }).usedSize;
  };
  const main = await used().catch(() => null);
  let worker: number | null = null;
  for (const s of workerSessions.keys()) { const w = await used(s).catch(() => null); if (w !== null) worker = Math.max(worker ?? 0, w); }
  return { main, worker };
}

let failedRequests = 0;
async function openShell(caseId: string): Promise<{ page: Page; shellMs: number; landedOn: string }> {
  workerSessions.clear();
  const { page, t0 } = await T.coldLaunch(`${BASE}/arena`);
  T.browser!.on((m) => { if (m === "Network.loadingFailed") failedRequests++; });
  await page.eval(INSTRUMENT).catch(() => {});
  await watchWorkers(page);
  await until(page, `document.querySelector("h1")?.textContent === "Play on this device"`, 90000, "the offline shell's heading");
  const shellMs = Date.now() - t0;
  const landedOn = await page.eval<string>("location.pathname");
  await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "ready"`, 60000, '"Ready for offline play"');
  await shoot(page, caseId, "launch", null, { force: true, device: true, note: `cold launch to the shell: ${shellMs} ms, landed on ${landedOn}` });
  return { page, shellMs, landedOn };
}
async function startMatch(page: Page, caseId: string, mine: string, theirs: string, seat: "p1" | "p2"): Promise<number> {
  await until(page, `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Start match" && !b.disabled)`, 60000, "Start match");
  // The deck pickers are native selects (the phone's own picker): set, as the picker would.
  await page.eval(`(() => {
    const set = (sel, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, v); sel.dispatchEvent(new Event("change", { bubbles: true })); };
    const [a, b] = document.querySelectorAll("section[aria-label='New match'] select");
    set(a, ${JSON.stringify(mine)}); set(b, ${JSON.stringify(theirs)});
  })()`);
  const seatTap = await tapFind(page, `() => [...document.querySelectorAll("fieldset button")].filter((b) => b.innerText.trim() === ${JSON.stringify(seat === "p1" ? "First" : "Second")})`);
  if (!seatTap.ok) throw new Error(`the seat button could not be tapped: ${seatTap.why}`);
  await sleep(200);
  await shoot(page, caseId, "new-match", null, { note: `${mine} v ${theirs}, ${seat === "p1" ? "first" : "second"}` });
  await page.eval(`window.__rel && (window.__rel.marks.click = performance.now()); 0`);
  const t = Date.now();
  const r = await tapButton(page, "Start match");
  if (!r.ok) throw new Error(`Start match could not be tapped: ${r.why}`);
  await until(page, `(() => { const b = ${BOARD_NOW}; return !!(b && b.supervisor.snapshot && b.state.kind === "owner"); })()`, 120000, "the first board");
  await page.eval(`window.__rel && (window.__rel.marks.board = performance.now()); 0`);
  return Date.now() - t;
}
function summarise(id: string, c: { mine: string; theirs: string; seat: string }, play: Play, extra: Partial<CaseResult>): CaseResult {
  const ms = play.attempts.flatMap((a) => (a.tapToActMs === null ? [] : [a.tapToActMs]));
  return {
    id, decks: `${c.mine} v ${c.theirs}`, seat: c.seat, ok: false, error: null, coldLaunchToShellMs: null, landedOn: null, startTapToBoardMs: null,
    decisions: play.decisions, tapped: play.attempts.filter((a) => a.result === "tapped").length, tappedOther: play.attempts.filter((a) => a.result === "tapped-other").length,
    unreachable: play.attempts.filter((a) => a.result === "unreachable").length, neededScroll: play.attempts.filter((a) => a.scrolled).length,
    obstructed: play.attempts.filter((a) => a.obstructions.length > 0).length,
    recoveryMs: ((r) => (r.length ? { p50: pct(r, 0.5), max: Math.max(...r) } : null))(play.attempts.filter((a) => a.obstructions.length).map((a) => a.recoveryMs)), notices: play.notices, tapToActMs: ms.length ? { p50: pct(ms, 0.5), p95: pct(ms, 0.95), max: Math.max(...ms) } : null,
    playbackShots: play.playbackShots, reviews: play.reviews, stalls: play.stalls, revision: null, winner: null, reason: null,
    imagesOnFinalBoard: 0, brokenImages: 0, remoteImages: 0, longTasks: 0, longTaskMaxMs: 0, framesOver50: 0, frames: 0, mainHeapAfterGc: null, workerHeapAfterGc: null,
    browserPssBytes: null, failedRequests: 0, seconds: 0, ...extra,
  };
}
async function finish(page: Page, res: CaseResult, end: View | null) {
  const s = end?.snapshot ?? null;
  res.revision = s?.game.revision ?? null;
  res.winner = s?.over ? (s.over as { winner?: string | null }).winner ?? null : null;
  res.reason = s?.over ? (s.over as { reason?: string | null }).reason ?? null : null;
  const img = await page.eval<{ n: number; broken: number; remote: number }>(`(() => { const i = [...document.querySelectorAll("img")]; return { n: i.length, broken: i.filter((x) => !(x.complete && x.naturalWidth > 0)).length, remote: i.filter((x) => /^https?:/.test(x.currentSrc) && !x.currentSrc.startsWith(location.origin)).length }; })()`).catch(() => ({ n: 0, broken: 0, remote: 0 }));
  Object.assign(res, { imagesOnFinalBoard: img.n, brokenImages: img.broken, remoteImages: img.remote });
  const rel = await page.eval<{ long: { start: number; ms: number }[]; frames: { at: number; ms: number }[]; marks: { click?: number } }>("window.__rel").catch(() => null);
  if (rel) {
    const from = rel.marks.click ?? 0;
    const long = rel.long.filter((t) => t.start >= from);
    const frames = rel.frames.filter((f) => f.at >= from);
    Object.assign(res, { longTasks: long.length, longTaskMaxMs: Math.round(Math.max(0, ...long.map((t) => t.ms))), frames: frames.length, framesOver50: frames.filter((f) => f.ms > 50).length });
  }
  const h = await heap(page);
  res.mainHeapAfterGc = h.main;
  res.workerHeapAfterGc = h.worker;
  res.browserPssBytes = T.memoryBytes();
  res.failedRequests = failedRequests;
}

async function runCase(c: (typeof ALL_CASES)[number], deadline: number): Promise<CaseResult> {
  const t0 = Date.now();
  const play = newPlay();
  failedRequests = 0;
  let res = summarise(c.id, c, play, {});
  let page: Page | null = null;
  try {
    const shell = await openShell(c.id);
    page = shell.page;
    const startMs = await startMatch(page, c.id, c.mine, c.theirs, c.seat);
    const end = await playOn(page, c.id, play, { deadline });
    res = summarise(c.id, c, play, { coldLaunchToShellMs: shell.shellMs, landedOn: shell.landedOn, startTapToBoardMs: startMs });
    await finish(page, res, end);
    // Played to the end is not enough: a move no tap reached means a player could not have played it (owner, #785 review).
    // An obstructed move fails the case too: the harness got past the pop-up, a player was blocked by it (#787 review).
    res.ok = end.snapshot?.game.status === "over" && res.unreachable === 0 && res.obstructed === 0 && res.notices.every((n) => n.acknowledged);
    if (!res.ok && !res.error) res.error = [res.unreachable ? `${res.unreachable} move(s) unreachable by touch` : "", res.obstructed ? `${res.obstructed} move(s) obstructed by a skill pop-up (the harness closed it and played on)` : "", res.notices.every((n) => n.acknowledged) ? "" : "a no-target notice could not be acknowledged"].filter(Boolean).join("; ");
  } catch (e) {
    res = summarise(c.id, c, play, { ...res, error: (e as Error).message });
    if (page) await shoot(page, c.id, "error", null, { note: (e as Error).message, force: true, device: true }).catch(() => {});
  } finally {
    res.seconds = Math.round((Date.now() - t0) / 1000);
    await T.endCase().catch(() => {});
  }
  log(`${c.id}: ${res.ok ? "PASS, played to the end by touch" : `FAIL: ${res.error}`} — ${res.decisions} decisions (${res.tapped} directly by tap, ${res.obstructed} obstructed by a pop-up, ${res.tappedOther} tap sent another move, ${res.unreachable} unreachable), ${res.playbackShots} beats shot, ${res.seconds} s`);
  return res;
}

// ── the recovery case ───────────────────────────────────────────────────────────────────────────
interface Step { what: string; ok: boolean; detail: string; shot: number | null }
async function recoveryCase(deadline: number): Promise<{ steps: Step[]; result: CaseResult }> {
  const id = "recovery";
  const steps: Step[] = [];
  const step = (what: string, ok: boolean, detail: string, shot: number | null = null) => { steps.push({ what, ok, detail, shot }); log(`  ${id}: ${ok ? "ok  " : "FAIL"} ${what} — ${detail}`); };
  const play = newPlay();
  const c = ALL_CASES[0];
  let { page } = await openShell(id);
  await startMatch(page, id, c.mine, c.theirs, c.seat);
  const continueSaved = async (how: string) => {
    await until(page, `!!document.querySelector('section[aria-label="Saved match"]')`, 60000, "the saved-match card");
    const shot = await shoot(page, id, "saved-match", null, { force: true, note: how });
    const r = await tapFind(page, `() => [...document.querySelectorAll("button")].filter((b) => b.innerText.trim() === "Continue" && !b.disabled)`);
    if (!r.ok) throw new Error(`Continue could not be tapped (${r.why})`);
    await until(page, `(() => { const b = ${BOARD_NOW}; return !!(b && b.supervisor.snapshot && b.state.kind === "owner"); })()`, 60000, "the board after Continue");
    await sleep(800);
    return shot.n;
  };
  const settle = async () => { for (let i = 0; i < 100; i++) { const v = await view(page); if (v?.snapshot && !v.saving && v.kind === "owner") return v; await sleep(150); } return (await view(page))!; };

  // 1. reload at a human choice
  let v = await playOn(page, id, play, { deadline, stop: (_s, d) => d >= 10 });
  let before = v.snapshot!;
  await page.cdp("Page.reload", {});
  let shotN0 = await continueSaved("after a reload at a human choice");
  v = await settle();
  step("reload at a human choice, Continue", v.snapshot!.game.revision === before.game.revision && stableJson(v.snapshot!.legal) === stableJson(before.legal), `revision ${before.game.revision} → ${v.snapshot!.game.revision}, same legal moves: ${stableJson(v.snapshot!.legal) === stableJson(before.legal)}`, shotN0);

  // 2. the browser is killed at a human choice
  v = await playOn(page, id, play, { deadline, stop: (_s, d) => d >= 16 });
  before = v.snapshot!;
  await T.kill();
  page = (await openShell(id)).page;
  shotN0 = await continueSaved("after the browser was force-closed at a human choice");
  v = await settle();
  step("force-close at a human choice, Continue", v.snapshot!.game.revision === before.game.revision, `revision ${before.game.revision} → ${v.snapshot!.game.revision}`, shotN0);

  // 3. the browser is killed just after a move, during the computer's turn
  v = await playOn(page, id, play, { deadline, stop: (_s, d) => d >= 22 });
  before = v.snapshot!;
  const humansBefore = await journalHumans(page, v.matchId);
  await page.eval(ARM);
  const a = await perform(page, id, before);
  for (let i = 0; i < 40 && (await journalHumans(page, v.matchId)) === humansBefore; i++) await sleep(50);
  await T.kill();
  page = (await openShell(id)).page;
  shotN0 = await continueSaved("after the browser was force-closed during the computer's turn");
  v = await settle();
  const humansAfter = await journalHumans(page, v.matchId);
  step("force-close during the computer's turn, Continue", v.snapshot!.game.revision > before.game.revision && humansAfter === humansBefore + 1, `the move ("${a.label}", ${a.result}) is on the device once (${humansBefore} → ${humansAfter} human moves); revision ${before.game.revision} → ${v.snapshot!.game.revision}`, shotN0);

  // 4. every save fails (device full), then there is room again
  v = await playOn(page, id, play, { deadline, stop: (_s, d) => d >= 26 });
  before = v.snapshot!;
  const reached = await inWorkers(IDB_FAULT.quota);
  if (!reached) step("device full", false, "the fault could not be put into the match Worker (no Worker session)");
  else {
    await perform(page, id, before);
    let notice = false;
    for (let i = 0; i < 80 && !notice; i++) { notice = await page.eval<boolean>(`document.body.innerText.includes("Could not save on this device")`); await sleep(150); }
    const shot = await shoot(page, id, "storage-full", before, { force: true, device: true, note: "every save fails" });
    const text = await page.eval<string>("document.body.innerText");
    step("device full: the notice", notice && text.includes("Try again"), notice ? `"Could not save on this device" with ${text.includes("Free some space") ? '"Free some space" and ' : ""}"Try again"` : "no device-full notice appeared", shot.n);
    await inWorkers(IDB_FAULT.clear);
    const r = await tapButton(page, "Try again");
    await sleep(1000);
    v = await settle();
    const shot2 = await shoot(page, id, "storage-recovered", v.snapshot, { force: true, note: "after Try again" });
    step("device full: Try again once there is room", r.ok && v.kind === "owner", `Try again ${r.ok ? "tapped" : `not tappable (${r.why})`}; the board is ${v.kind} at revision ${v.snapshot?.game.revision}`, shot2.n);
  }

  // 5. on to the end
  const end = await playOn(page, id, play, { deadline });
  const res = summarise(id, c, play, {});
  await finish(page, res, end);
  res.ok = end.snapshot?.game.status === "over" && steps.every((s) => s.ok) && res.unreachable === 0 && res.obstructed === 0 && res.notices.every((n) => n.acknowledged);
  if (res.obstructed) step("every move directly reachable", false, `${res.obstructed} move(s) obstructed by a skill pop-up (the harness closed it and played on)`);
  if (res.unreachable) step("every move made by touch", false, `${res.unreachable} move(s) unreachable by touch (made through the board only to keep collecting evidence)`);
  step("played to the end after every interruption", end.snapshot?.game.status === "over", `revision ${end.snapshot?.game.revision}`);
  await T.endCase();
  return { steps, result: res };
}

// ── the run ─────────────────────────────────────────────────────────────────────────────────────
let T: Transport;
const server = startServer();
const t0 = Date.now();
const run: Record<string, unknown> = { tool: "arena:phone", started: new Date().toISOString(), mode: EMULATED ? "EMULATED (headless Chrome, not a phone)" : "phone", pace: PACE, shots: SHOTS, port: PORT };
const results: CaseResult[] = [];
let recovery: { steps: Step[]; result: CaseResult } | null = null;
let fatal: string | null = null;
let tornDown = false;
async function teardown() {
  if (tornDown) return;
  tornDown = true;
  await T?.teardown().catch((e) => log(`teardown: ${(e as Error).message}`));
  await stopServer(server);
}
const watchdog = setTimeout(async () => { log(`FAIL the run passed its ${TOTAL_MS / 3600_000} h limit`); fatal = "time limit"; await teardown(); write(); process.exit(1); }, TOTAL_MS);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, async () => { log(`stopped by ${sig}: restoring the phone`); fatal = sig; await teardown(); write(); process.exit(130); });

try {
  T = EMULATED ? new EmulatedTransport() : new PhoneTransport();
  run.device = T.info;
  log(`device: ${JSON.stringify(T.info)}`);
  if (!(await waitUp())) throw new Error(`next start did not come up on ${PORT}:\n${server.log()}`);
  const manifest = (await (await fetch(`${BASE}/arena/offline/shell.json`)).json()) as { version: string; revision: string };
  run.shell = manifest;
  if (!manifest.revision) throw new Error("the build has no interpreter revision: build with GITHUB_SHA=<40-hex> npm run build");

  // 1. prepare, online (and set the pace this run plays at, remembering the phone's own)
  {
    const page = await T.open(`${BASE}${SHELL_PATH}`);
    await page.eval(INSTRUMENT).catch(() => {});
    run.browser = await page.eval<string>("navigator.userAgent");
    run.screen = await page.eval<{ w: number; h: number; dpr: number }>("({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })");
    run.pacePrevious = await page.eval<string | null>(`(() => { try { const p = localStorage.getItem("arena.pace"); localStorage.setItem("arena.pace", ${JSON.stringify(PACE)}); return p; } catch { return null; } })()`);
    if (PREPARE) {
      await until(page, `[...document.querySelectorAll("button")].some((b) => ["Prepare for offline play", "Update", "Carry on preparing"].includes(b.textContent.trim()) && !b.disabled) || document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "ready"`, 90000, "the preparation panel");
      const already = await page.eval<boolean>(`document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "ready" && ![...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Update")`);
      const tp = Date.now();
      if (!already) {
        const r = await tapFind(page, `() => [...document.querySelectorAll("button")].filter((b) => ["Prepare for offline play", "Update", "Carry on preparing"].includes(b.textContent.trim()) && !b.disabled)`);
        if (!r.ok) throw new Error(`"Prepare for offline play" could not be tapped: ${r.why}`);
        await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "ready"`, 600000, '"Ready for offline play"');
      }
      run.prepare = { ms: already ? 0 : Date.now() - tp, alreadyReady: already, page: (await page.eval<string>("document.body.innerText")).replace(/\s+/g, " ").slice(0, 600) };
      await shoot(page, "prepare", "prepared", null, { force: true, device: true, note: already ? "was already ready" : `prepared in ${((Date.now() - tp) / 1000).toFixed(1)} s` });
      log(`prepared ${already ? "(already ready)" : `in ${((Date.now() - tp) / 1000).toFixed(1)} s`}`);
    }
  }

  // 2. offline
  await stopServer(server);
  run.offline = await T.goOffline();
  let reachable = true;
  try { await fetch(`${BASE}/`, { signal: AbortSignal.timeout(3000) }); } catch { reachable = false; }
  log(`offline: airplane mode ${JSON.stringify(run.offline)}; server reachable: ${reachable}`);

  // 3. the matrix, 4. recovery
  const deadline = () => Math.min(t0 + TOTAL_MS - 120_000, Date.now() + 75 * 60_000);
  for (const c of CASES) { results.push(await runCase(c, deadline())); write(); }
  if (RECOVERY) {
    try { recovery = await recoveryCase(deadline()); } catch (e) { recovery = { steps: [{ what: "the recovery case", ok: false, detail: (e as Error).message, shot: null }], result: summarise("recovery", ALL_CASES[0], newPlay(), { error: (e as Error).message }) }; log(`recovery STOPPED: ${(e as Error).message}`); }
    write();
  }

  // 5. the phone's own pace back (on a page of the app, offline is fine)
  if (run.pacePrevious !== undefined) {
    const { page } = await T.coldLaunch(`${BASE}/arena`);
    await until(page, `document.querySelector("h1")?.textContent === "Play on this device"`, 60000).catch(() => {});
    await page.eval(`(() => { try { const p = ${JSON.stringify(run.pacePrevious)}; if (p === null) localStorage.removeItem("arena.pace"); else localStorage.setItem("arena.pace", p); } catch {} })()`).catch(() => {});
    await T.endCase();
  }
} catch (e) {
  fatal = (e as Error).stack ?? String(e);
  log(`FAIL the run stopped: ${fatal}`);
} finally {
  clearTimeout(watchdog);
  await teardown();
  write();
}
log(`done in ${Math.round((Date.now() - t0) / 60000)} min: ${path.relative(process.cwd(), OUT)}/findings.md and review.html`);
process.exit(fatal || results.some((r) => !r.ok) || (recovery && !recovery.result.ok) ? 1 : 0);

// ── writing it up ───────────────────────────────────────────────────────────────────────────────
function write() {
  const allFindings = shots.flatMap((s) => s.findings.map((f) => ({ ...f, shot: s })));
  run.finished = new Date().toISOString();
  run.minutes = Math.round((Date.now() - t0) / 60000);
  run.fatal = fatal;
  fs.writeFileSync(path.join(OUT, "run.json"), JSON.stringify({ ...run, cases: results, recovery, shots }, null, 1));
  fs.writeFileSync(path.join(OUT, "findings.md"), findingsMd(allFindings));
  fs.writeFileSync(path.join(OUT, "review.html"), reviewHtml());
}

function budgetRow(metric: string, measured: number | null, unit = "") {
  const b = BOARD_BUDGETS.find((x) => x.metric === metric && !x.config);
  if (!b) return `| ${metric} | ${measured ?? "—"} ${unit} | (no budget) |`;
  const over = measured === null || Number.isNaN(measured) ? "not measured" : (b.atLeast ? measured < b.limit : measured > b.limit) ? "**OVER**" : "within";
  return `| ${metric} | ${measured === null || Number.isNaN(measured) ? "—" : Math.round(measured)} ${b.unit} | ${b.limit} ${b.unit}: ${over} |`;
}

function findingsMd(all: Array<Finding & { shot: Shot }>): string {
  const L: string[] = [];
  const dev = run.device as Partial<DeviceInfo> & { what?: string };
  const offline = run.offline as { airplane: boolean; how: string } | undefined;
  L.push(`# Arena on the phone: run of ${String(run.started).slice(0, 16).replace("T", " ")} UTC`, "");
  if (EMULATED) L.push("> **EMULATED** — headless Chrome at 390 px. This proves the tool; it is not a phone and fills no row of the §8 table.", "");
  if (fatal) L.push(`> **The run stopped early:** ${fatal.split("\n")[0]}`, "");
  L.push("## The §8 table (`docs/arena-offline-release.md`)", "", "| Row | Result | Notes |", "|---|---|---|");
  const all8 = results;
  const caseRow = (id: string, label: string) => { const r = all8.find((x) => x.id === id); return `| ${label} | ${r ? (r.ok ? "pass: played to the end by touch" : `**FAIL**: ${r.error ?? "see the log"}`) : "not run"} | ${r ? `${r.decisions} decisions, ${r.unreachable} unreachable by tap, winner ${r.winner ?? "?"} (${r.reason ?? "?"}), ${Math.round(r.seconds / 60)} min` : ""} |`; };
  L.push(`| Phone model, OS, browser and version | ${dev.what ?? `${dev.manufacturer ?? ""} ${dev.model ?? ""}, Android ${dev.android ?? "?"}, ${dev.browserPackage ?? ""} ${dev.browserVersion ?? ""}`} | ${String(run.browser ?? "").slice(0, 140)}; screen ${JSON.stringify(run.screen ?? {})}; battery ${dev.batteryLevel ?? "?"}%${dev.charging ? " (charging)" : ""}; power saving ${dev.powerSave ?? "?"}; free ${dev.freeDataBytes ? `${(dev.freeDataBytes / 2 ** 30).toFixed(1)} GB` : "?"} |`);
  L.push(`| Commit built, tunnel URL | ${(run.shell as { revision?: string } | undefined)?.revision ?? "?"} | no tunnel: \`adb reverse\` to ${BASE} |`);
  const prep = run.prepare as { ms: number; alreadyReady: boolean; page: string } | undefined;
  L.push(`| Prepare time, storage shown | ${prep ? (prep.alreadyReady ? "already prepared" : `${(prep.ms / 1000).toFixed(1)} s`) : "skipped"} | ${prep?.page.match(/[\d.]+ ?[KMG]B[^.]*/)?.[0] ?? ""} |`);
  const launches = results.flatMap((r) => (r.coldLaunchToShellMs === null ? [] : [r.coldLaunchToShellMs]));
  L.push(`| Cold launch in airplane mode lands on the shell (time to the form) | ${results.length && results.every((r) => r.landedOn === SHELL_PATH) ? "yes" : results.length ? "**no**" : "not run"} | ${launches.length ? `${Math.min(...launches)}–${Math.max(...launches)} ms from the launch intent; airplane mode ${offline?.airplane ? "on" : `NOT switched (${offline?.how ?? "?"})`}` : ""} |`);
  L.push(caseRow("A-v-B-first", "A v B, human first: played to the end"), caseRow("A-v-B-second", "A v B, human second"), caseRow("B-v-A-first", "B v A, human first"), caseRow("B-v-A-second", "B v A, human second"));
  L.push(caseRow("A-v-A-first", "A v A, either seat (optional)"), caseRow("B-v-B-first", "B v B, either seat (optional)"));
  const imgs = results.filter((r) => r.ok);
  L.push(`| Every card image shows offline | ${imgs.length ? (imgs.every((r) => r.brokenImages === 0 && r.remoteImages === 0) ? "yes" : "**no**") : "not run"} | ${imgs.map((r) => `${r.id}: ${r.imagesOnFinalBoard - r.brokenImages}/${r.imagesOnFinalBoard}`).join("; ")} |`);
  const st = (what: string) => recovery?.steps.find((x) => x.what.startsWith(what));
  const stRow = (label: string, what: string) => { const x = st(what); return `| ${label} | ${x ? (x.ok ? "yes" : "**no**") : "not run"} | ${x ? `${x.detail}${x.shot ? ` (shot ${x.shot})` : ""}` : ""} |`; };
  L.push(stRow("Reload at a human choice, Continue", "reload"), stRow("Force-close mid-match, Continue", "force-close at a human"), stRow("Force-close during the computer's turn, Continue", "force-close during"), stRow("Storage failure notice and recovery", "device full: the notice"));
  L.push("| Memory-pressure return | not run | by hand: see `docs/arena-phone-ux-review.md` |");
  const starts = results.flatMap((r) => (r.startTapToBoardMs === null ? [] : [r.startTapToBoardMs]));
  L.push(`| Start to first board (budget 450 ms) | ${starts.length ? `${Math.max(...starts)} ms worst` : "—"} | tap on Start match to the first board, all cases: ${starts.join(", ")} ms |`);
  L.push(`| Long tasks per match, longest (board budget 12, 500 ms) | ${results.length ? `${Math.max(...results.map((r) => r.longTasks))}, ${Math.max(...results.map((r) => r.longTaskMaxMs))} ms` : "—"} | ${SHOTS === "none" ? "" : "**measured while screenshots were taken**: run `--shots none` for budget figures"} |`);
  L.push(`| Frames over 50 ms per match (budget 6) | ${results.length ? Math.max(...results.map((r) => r.framesOver50)) : "—"} | ${SHOTS === "none" ? "" : "same caveat"} |`);
  const mb = (b: number | null) => (b === null ? "?" : `${(b / 2 ** 20).toFixed(1)} MB`);
  L.push(`| JS heap after GC, page and Worker (budgets 8 MB, 16 MB) | ${results.length ? `${mb(Math.max(...results.map((r) => r.mainHeapAfterGc ?? 0)))}, ${mb(Math.max(...results.map((r) => r.workerHeapAfterGc ?? 0)))}` : "—"} | browser PSS (all its processes, what the phone pays): ${mb(Math.max(0, ...results.map((r) => r.browserPssBytes ?? 0)) || null)} |`);
  L.push(`| Anything else seen | | ${results.flatMap((r) => r.stalls).length} stall(s); see below |`, "");

  L.push("## Budgets (`BOARD_BUDGETS`)", "", "| Budget | Measured (worst case) | Limit |", "|---|---|---|");
  if (results.length) {
    L.push(budgetRow("matchStartMs.p95", pct(starts, 0.95)), budgetRow("longTaskCount", Math.max(...results.map((r) => r.longTasks))), budgetRow("longTaskMaxMs", Math.max(...results.map((r) => r.longTaskMaxMs))));
    L.push(budgetRow("framesOver50Ms", Math.max(...results.map((r) => r.framesOver50))), budgetRow("mainHeapBytes", Math.max(...results.map((r) => r.mainHeapAfterGc ?? NaN))), budgetRow("workerHeapRetainedBytes", Math.max(...results.map((r) => r.workerHeapAfterGc ?? NaN))));
  }
  L.push("", "## Playing by touch", "", "| Case | Decisions | Directly by tap | Obstructed (harness closed a pop-up) | Tap sent another move | Unreachable | Had to scroll to the control | First interaction → move p50 / p95 / max | Pop-up recovery p50 / max | Beats shot | Stalls |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of [...results, ...(recovery ? [recovery.result] : [])]) L.push(`| ${r.id} | ${r.decisions} | ${r.tapped} | ${r.obstructed} | ${r.tappedOther} | ${r.unreachable} | ${r.neededScroll} | ${r.tapToActMs ? `${r.tapToActMs.p50} / ${r.tapToActMs.p95} / ${r.tapToActMs.max} ms` : "—"} | ${r.recoveryMs ? `${r.recoveryMs.p50} / ${r.recoveryMs.max} ms` : "—"} | ${r.playbackShots} | ${r.stalls.length} |`);
  const obstructedShots = shots.filter((s) => s.kind === "obstructed");
  if (obstructedShots.length) {
    L.push("", "### Moves obstructed by a skill pop-up (a failure: the control the move needed was covered)", "", "The harness closed the pop-up only to keep the match going; a player meets the cover first, and its way out is the close control named below.", "");
    for (const s of obstructedShots.slice(0, 40)) L.push(`- ${s.case} r${s.revision}: ${s.note} (shot ${s.n})`);
    if (obstructedShots.length > 40) L.push(`- … ${obstructedShots.length - 40} more in run.json`);
  }
  const unreachable = shots.filter((s) => s.kind === "unreachable");
  if (unreachable.length) {
    L.push("", "### Moves no tap reached (each is a finding: a player could not have made it)", "");
    const byLabel = new Map<string, Shot[]>();
    for (const s of unreachable) { const k = (s.note ?? "").split(" — ")[0]; byLabel.set(k, [...(byLabel.get(k) ?? []), s]); }
    for (const [k, list] of byLabel) L.push(`- **${k}** ×${list.length} — ${list[0].note?.split(" — ")[1] ?? ""} (shots ${list.slice(0, 5).map((s) => s.n).join(", ")})`);
  }
  L.push("", "## Card navigation", "", "| Case | At revision | Card | Covered by a pop-up | Opened (ms) | Name shown | Pager / Next / swipe | Closed | Hand review | Zones |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const r of [...results, ...(recovery ? [recovery.result] : [])]) for (const v of r.reviews) L.push(`| ${r.id} | ${v.revision} | ${v.target} | ${v.obstructedBy ? `**yes**: ${v.obstructedBy}` : "no"} | ${v.opened ? `yes (${v.openMs})` : "**no**"} | ${v.nameShown ? "yes" : "**no**"} | ${v.pager ? `yes / ${v.nextChanges ? "changes" : "**no change**"} / ${v.swipeChanges === null ? "—" : v.swipeChanges ? "changes" : "no change"}` : "no pager"} | ${v.closed ? "yes" : "**no**"} | ${v.hand ? (v.hand.opened ? `yes (${v.hand.cards ?? "?"})` : `**no** (${v.hand.cards ?? ""})`) : "—"} | ${v.zones === null ? "—" : v.zones ? "yes" : "**no**"} |`);
  const allRuns = [...results, ...(recovery ? [recovery.result] : [])];
  const notices = allRuns.flatMap((r) => r.notices.map((n) => ({ ...n, case: r.id })));
  L.push("", "## No-target notices (#783)", "");
  if (!notices.length) L.push("**Not exercised:** no case met a no-target notice in this run, so acknowledging one by touch is unproven here.");
  else { L.push("| Case | At revision | Notice | Acknowledged by touch | Shot |", "|---|---|---|---|---|"); for (const n of notices) L.push(`| ${n.case} | ${n.revision} | ${n.text.replace(/\|/g, "/").slice(0, 140)} | ${n.acknowledged ? "yes" : `**no** (${n.how})`} | ${n.shot} |`); }
  if (recovery) { L.push("", "## Recovery", ""); for (const s of recovery.steps) L.push(`- ${s.ok ? "ok" : "**FAIL**"} ${s.what}: ${s.detail}${s.shot ? ` (shot ${s.shot})` : ""}`); }
  L.push("", "## Objective screen findings", "", "Counted over every shot; `decision` checks (the overview) only at human decisions with no sheet open.", "", "| Finding | Severity | Shots | Examples |", "|---|---|---|---|");
  const byKind = new Map<string, Array<Finding & { shot: Shot }>>();
  for (const f of all) byKind.set(`${f.kind}|${f.detail}`, [...(byKind.get(`${f.kind}|${f.detail}`) ?? []), f]);
  const rows = [...byKind.values()].sort((a, b) => (a[0].severity === b[0].severity ? b.length - a.length : a[0].severity === "major" ? -1 : 1));
  for (const list of rows.slice(0, 80)) L.push(`| ${list[0].kind}: ${list[0].detail.replace(/\|/g, "/")} | ${list[0].severity} | ${list.length} | ${list.slice(0, 4).map((f) => f.shot.n).join(", ")} |`);
  if (rows.length > 80) L.push(`| … ${rows.length - 80} more distinct findings in run.json | | | |`);
  const stalls = [...results, ...(recovery ? [recovery.result] : [])].flatMap((r) => r.stalls.map((s) => `${r.id}: ${s}`));
  if (stalls.length) { L.push("", "## Stalls and notes", ""); for (const s of stalls) L.push(`- ${s}`); }
  L.push("", "## Next", "", "Open `review.html` and follow the review in `docs/arena-phone-ux-review.md`; that page says what the judgement findings look like.", "");
  return L.join("\n");
}

function reviewHtml(): string {
  const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const groups = new Map<string, Shot[]>();
  for (const s of shots) groups.set(s.case, [...(groups.get(s.case) ?? []), s]);
  const truthText = (t: Truth | null) => t ? [
    `Turn ${t.turn}, ${t.turnPlayer === "you" ? "YOUR" : "THE OPPONENT'S"} turn · phase ${t.phase}${t.step ? ` · battle step ${t.step}` : ""}`,
    `Asked: ${t.asked ?? "nobody"} — ${t.question}${t.hint ? ` (${t.hint})` : ""} · ${t.legalMoves} legal moves`,
    `You (${t.you.name}): life ${t.you.life}, energy ${t.you.energyReady}/${t.you.energyTotal} ready, hand ${t.you.hand}, deck ${t.you.deck}, drop ${t.you.drop}; battle: ${t.you.battle.join(", ") || "—"}`,
    `${t.them.name}: life ${t.them.life}, energy ${t.them.energyReady}/${t.them.energyTotal} ready, hand ${t.them.hand}, deck ${t.them.deck}, drop ${t.them.drop}; battle: ${t.them.battle.join(", ") || "—"}`,
    t.battle ? `Battle: ${t.battle.attacker} (${t.battle.attackPower}) attacks ${t.battle.guard} (${t.battle.guardPower}), ${t.battle.step}` : "",
    t.newLog.length ? `Since the last shot: ${t.newLog.join(" / ")}` : "",
    t.over ? `Over: ${t.over}` : "",
  ].filter(Boolean).join("\n") : "(no board)";
  const cards = (list: Shot[]) => list.map((s) => `
    <figure id="s${s.n}" class="${s.kind}">
      ${s.file ? `<a href="${esc(s.file)}"><img loading="lazy" src="${esc(s.file)}" alt="shot ${s.n}"></a>` : `<div class="noimg">no image (--shots ${esc(SHOTS)})</div>`}
      <figcaption><b>#${s.n} ${esc(s.kind)}</b>${s.revision !== null ? ` · r${s.revision}` : ""}${s.note ? `<br>${esc(s.note)}` : ""}${s.deviceFile ? `<br><a href="${esc(s.deviceFile)}">device screenshot</a>` : ""}
        ${s.findings.length ? `<ul class="f">${s.findings.slice(0, 6).map((f) => `<li class="${f.severity}">${esc(f.kind)}: ${esc(f.detail)}</li>`).join("")}${s.findings.length > 6 ? `<li>… ${s.findings.length - 6} more</li>` : ""}</ul>` : ""}
        <details><summary>Engine truth (cold-read first)</summary><pre>${esc(truthText(s.truth))}</pre></details>
      </figcaption>
    </figure>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arena phone review</title>
<style>
:root{--bg:#fafafa;--fg:#111;--mut:#666;--card:#fff;--bd:#ddd;--maj:#b00020;--min:#8a5a00}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--mut:#aaa;--card:#1b1b1b;--bd:#333;--maj:#ff6b6b;--min:#e0b050}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
h1{font-size:20px}h2{font-size:17px;margin-top:28px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
figure{margin:0;background:var(--card);border:1px solid var(--bd);border-radius:8px;padding:8px}
figure img{width:100%;border-radius:4px;display:block}
figcaption{font-size:12px;color:var(--mut);margin-top:6px}figcaption b{color:var(--fg)}
pre{white-space:pre-wrap;font-size:11px}ul.f{padding-left:16px;margin:4px 0}
li.major{color:var(--maj)}li.minor{color:var(--min)}
figure.decision{border-color:#5b8def}figure.unreachable,figure.error,figure.stall{border-color:var(--maj)}
.noimg{height:120px;display:grid;place-items:center;color:var(--mut);border:1px dashed var(--bd)}
nav a{margin-right:12px}
</style></head><body>
<h1>Arena phone review — ${esc(String(run.started).slice(0, 16).replace("T", " "))} UTC${EMULATED ? " (EMULATED, not a phone)" : ""}</h1>
<p>${esc(JSON.stringify(run.device))}</p>
<p>Review with <code>docs/arena-phone-ux-review.md</code>: read each shot cold, write what you think the state is, <em>then</em> open "Engine truth". Blue: a human decision. Red: a move no tap reached, an error or a stall.</p>
<nav>${[...groups.keys()].map((k) => `<a href="#c-${esc(k)}">${esc(k)} (${groups.get(k)!.length})</a>`).join("")}</nav>
${[...groups].map(([k, list]) => `<h2 id="c-${esc(k)}">${esc(k)}</h2><div class="grid">${cards(list)}</div>`).join("\n")}
</body></html>`;
}
