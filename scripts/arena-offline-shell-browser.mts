#!/usr/bin/env node
/**
 * #659: the offline shell in Chrome against a production build — the browser half of
 * `scripts/verify/arena-offline-shell.mts`.
 *
 *   npm run build   (with GITHUB_SHA or VERCEL_GIT_COMMIT_SHA set: the shell's interpreter revision)
 *   npm run arena:offline-shell-browser -- [--port N] [--shot PATH] [--json] [--total-timeout S]
 *
 * It starts `next start` itself on the existing build (no DATABASE_URL, no sign-in variables: open
 * mode), and a Chrome on a profile directory of its own:
 *
 *   A. Online, first Chrome: the shell page registers `/sw.js?v=<version>`, which precaches the
 *      shell into `dbs-arena-shell-<version>`. A pack made for the shell's revision is installed
 *      through the page (its art through `/_next/image`, answered by this script over CDP), a pack
 *      made for another revision is refused. Online pages and an API are visited, to give the
 *      worker every chance to cache what it must not. A worker for a version the build does not
 *      have is registered: its install fails and the working shell stays active and complete.
 *   B. The server is stopped and Chrome quits.
 *   C. Offline, a NEW Chrome process on the same profile, with the network emulated off as well:
 *      `/arena` (the installed app's start page) lands on the cached shell; its JS, CSS and fonts
 *      load, the service worker controls it, the installed pack is listed, and a match starts on
 *      the board — the match worker's script and the interpreter both loaded from the cache.
 *   D. Every Cache Storage key on the profile is audited: the shell caches hold only the shell page,
 *      its meta record and public static files.
 *
 * What it cannot prove: the sign-in exclusions with real credentials (open mode has none — the
 * worker fetches the shell with `credentials: "omit"`, which the unit check proves, and D shows no
 * signed-in page or API body in any cache), a real phone, or a live deployment.
 *
 * Needs Chrome and a build; not part of `npm test`. Exit 0 ok, 1 a check failed, 2 usage/no Chrome/no build.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Browser, findChrome, sleep, type Page } from "./lib/cdp.mts";
import { buildMastersPack } from "./build-arena-offline-pack.mts";
import { pngFor } from "./verify/arena-pack-store-fixture.mts";
import { canonicalJson } from "../src/lib/arena/replay-core.ts";
import { requiredArt } from "../src/lib/arena/local/pack-store.ts";
import { SHELL_CACHE_PREFIX, SHELL_META_PATH, SHELL_PATH, isShellAsset, type ShellManifest } from "../src/lib/arena/local/shell.ts";

function usage(message: string): never {
  console.error(`arena:offline-shell-browser: ${message}`);
  console.error("Usage: npm run arena:offline-shell-browser -- [--port N] [--shot PATH] [--json] [--total-timeout S]");
  process.exit(2);
}
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
for (const a of argv) if (a.startsWith("--") && !["--json", "--port", "--shot", "--total-timeout"].includes(a)) usage(`unknown flag ${a}`);
const PORT = Number(flag("--port") ?? 3759);
const SHOT = flag("--shot");
const TOTAL_MS = Number(flag("--total-timeout") ?? 420) * 1000;
const JSON_OUT = argv.includes("--json");
if (!Number.isInteger(PORT) || PORT <= 0 || !Number.isFinite(TOTAL_MS) || TOTAL_MS <= 0) usage("bad --port or --total-timeout");
try { findChrome(); } catch (error) { usage((error as Error).message); }
if (!fs.existsSync(".next/BUILD_ID")) usage("no production build: run `npm run build` first");

const BASE = `http://localhost:${PORT}`;
const OTHER_REVISION = "b659000000000000000000000000000000000659";
const failures: string[] = [];
const notes: string[] = [];
const report: Record<string, unknown> = {};
const check = (ok: unknown, what: string) => { if (ok) notes.push(`ok   ${what}`); else { failures.push(what); notes.push(`FAIL ${what}`); } };

// ── the server: the existing build, open mode ──────────────────────────────────────────────────
function startServer() {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(PORT), NODE_ENV: "production" };
  for (const k of Object.keys(env)) if (/^(DATABASE_URL|AUTH_SECRET|GOOGLE_CLIENT_|BASIC_AUTH_|SL_EMAILS|ARENA_ADMINS)/.test(k)) delete env[k];
  const proc = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stdout.on("data", (d) => { log += d; });
  proc.stderr.on("data", (d) => { log += d; });
  return { proc, log: () => log };
}
async function waitUp(): Promise<boolean> {
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(`${BASE}/arena/offline/shell.json`); if (r.ok) return true; } catch {}
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

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "arena-offline-shell-"));
const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-offline-packs-"));
const server = startServer();
let browser: Browser | null = null;
const watchdog = setTimeout(async () => {
  console.error(`FAIL arena:offline-shell-browser: overall timeout of ${TOTAL_MS / 1000} s exceeded`);
  await browser?.close().catch(() => {});
  await stopServer(server);
  process.exit(1);
}, TOTAL_MS);

async function inPage<T>(page: Page, expr: string, timeoutMs = 60000): Promise<T> {
  const key = `__p${Math.random().toString(36).slice(2)}`;
  await page.eval(`globalThis.${key} = null; (async () => { try { globalThis.${key} = { ok: true, v: await (${expr}) }; } catch (e) { globalThis.${key} = { ok: false, e: String(e && e.stack || e) }; } })(); 0`);
  const end = Date.now() + timeoutMs;
  for (;;) {
    const r = await page.eval<{ ok: boolean; v?: T; e?: string } | null>(`globalThis.${key}`);
    if (r) { if (!r.ok) throw new Error(r.e); return r.v as T; }
    if (Date.now() > end) throw new Error(`timed out: ${expr.slice(0, 80)}`);
    await sleep(150);
  }
}
async function until(page: Page, expr: string, what: string, timeoutMs = 60000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await page.eval<boolean>(`(() => { try { return !!(${expr}); } catch { return false; } })()`).catch(() => false)) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${what}`);
}
async function setFile(page: Page, selector: string, file: string) {
  const { root } = await page.cdp<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1 });
  const { nodeId } = await page.cdp<{ nodeId: number }>("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`no ${selector}`);
  await page.cdp("DOM.setFileInputFiles", { nodeId, files: [file] });
}
/** Every Cache Storage name and key on the origin, read in the page. */
const cacheDump = (page: Page) => inPage<Record<string, string[]>>(page, `(async () => { const out = {}; for (const n of await caches.keys()) { const c = await caches.open(n); out[n] = (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search); } return out; })()`);
const clickText = (page: Page, text: string) => page.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);

try {
  if (!(await waitUp())) throw new Error(`next start did not come up on ${PORT}:\n${server.log()}`);
  const manifest = (await (await fetch(`${BASE}/arena/offline/shell.json`)).json()) as ShellManifest;
  report.manifest = { version: manifest.version, revision: manifest.revision, files: manifest.files.length };
  if (!manifest.revision) usage("the build has no interpreter revision: build with GITHUB_SHA=<40-hex> npm run build");
  const shellCacheName = SHELL_CACHE_PREFIX + manifest.version;

  const good = await buildMastersPack({ runtimeRevision: manifest.revision });
  const other = await buildMastersPack({ runtimeRevision: OTHER_REVISION });
  const goodFile = path.join(packDir, "good.json");
  const otherFile = path.join(packDir, "other.json");
  fs.writeFileSync(goodFile, canonicalJson(good));
  fs.writeFileSync(otherFile, canonicalJson(other));
  report.packs = { good: good.hash, playable: good.qualification.playable, art: requiredArt(good).length };

  // ── A. online, first Chrome ─────────────────────────────────────────────────────────────────
  browser = await Browser.launch({ userDataDir: profile });
  let page = await browser.page({ name: "phone", width: 390, height: 844, mobile: true });
  // The pack's art arrives through /_next/image, which would reach the real CDNs: answer it here.
  let artServed = 0;
  await page.interceptFetch("*/_next/image*");
  page.onFetchPaused((p) => {
    const art = new URL(p.request.url).searchParams.get("url");
    if (!art) { void page.continueFetch(p.requestId); return; }
    artServed++;
    void page.fulfillFetchBytes(p.requestId, pngFor(art), "image/png");
  });
  await page.goto(`${BASE}${SHELL_PATH}`);
  await until(page, `document.querySelector("h1")?.textContent === "Play on this device"`, "the shell page");
  const sw = await inPage<{ active: string; state: string } | null>(page, `(async () => { const r = await navigator.serviceWorker.ready; for (let i = 0; i < 200 && !(r.active && r.active.state === "activated" && r.active.scriptURL.includes(${JSON.stringify(manifest.version)})); i++) await new Promise((x) => setTimeout(x, 150)); return r.active ? { active: r.active.scriptURL, state: r.active.state } : null; })()`, 90000);
  report.worker = sw;
  check(sw?.state === "activated" && sw.active.endsWith(`/sw.js?v=${manifest.version}`), `A. the shell page registers /sw.js?v=${manifest.version} and it activates`);
  let dump = await cacheDump(page);
  check((dump[shellCacheName] ?? []).length === manifest.files.length + 2, `A. ${shellCacheName} holds the shell page, its meta record and all ${manifest.files.length} listed files`);

  await page.goto(`${BASE}${SHELL_PATH}`); // now under the worker
  await until(page, `navigator.serviceWorker.controller`, "control");
  await until(page, `document.querySelector('section[aria-label="Deck pack"] input[type=file]')`, "the pack file input");
  await setFile(page, 'section[aria-label="Deck pack"] input[type=file]', otherFile);
  await until(page, `document.querySelector('[role=alert]')?.textContent.includes("not installed")`, "the refusal of another revision's pack", 120000);
  const refusal = await page.eval<string>(`document.querySelector('[role=alert]').textContent`);
  report.refusedInstall = refusal;
  check(/unplayable|interpreter revision/.test(refusal), `A. a pack made for another interpreter revision is refused at install (${refusal.slice(0, 140)})`);
  await setFile(page, 'section[aria-label="Deck pack"] input[type=file]', goodFile);
  await until(page, `document.querySelector('li[data-pack-hash="${good.hash}"]')`, "the installed pack", 180000);
  check(artServed >= requiredArt(good).length, `A. the shell's pack is installed with its ${requiredArt(good).length} images (${artServed} /_next/image answers)`);

  // Give the worker every chance to cache what it must not: online pages and an API.
  for (const p of ["/collection", "/decks", "/settings", "/arena", "/arena/local"]) await page.goto(`${BASE}${p}`).catch(() => {});
  await page.goto(`${BASE}${SHELL_PATH}`);
  await inPage(page, `fetch("/api/v1/health").then((r) => r.status)`).catch(() => {});

  // An update whose install fails: a version the server does not describe.
  const bogus = "0123456789abcdef";
  const failed = await inPage<{ active: string; installing: boolean; waiting: boolean; caches: string[] }>(page, `(async () => {
    const r = await navigator.serviceWorker.register("/sw.js?v=${bogus}");
    const w = r.installing || r.waiting;
    if (w) await new Promise((res) => { if (w.state === "redundant") res(); w.addEventListener("statechange", () => { if (w.state === "redundant" || w.state === "installed") res(); }); });
    const now = await navigator.serviceWorker.getRegistration();
    return { active: now.active.scriptURL, installing: !!now.installing, waiting: !!now.waiting, caches: await caches.keys() };
  })()`, 60000);
  report.failedUpdate = failed;
  check(failed.active.endsWith(`?v=${manifest.version}`) && !failed.waiting && !failed.caches.includes(SHELL_CACHE_PREFIX + bogus) && failed.caches.includes(shellCacheName), "A. an update whose install fails leaves the working shell active and its cache whole; no partial cache stays");
  dump = await cacheDump(page);
  check((dump[shellCacheName] ?? []).length === manifest.files.length + 2, "A. … and every file of the working shell is still cached");

  // ── B. stop the server, quit Chrome ──────────────────────────────────────────────────────────
  await browser.close();
  browser = null;
  await stopServer(server);
  let reachable = true;
  try { await fetch(`${BASE}/`, { signal: AbortSignal.timeout(3000) }); } catch { reachable = false; }
  check(!reachable, `B. the server is stopped: ${BASE} refuses connections`);

  // ── C. offline, a new Chrome process on the same profile ───────────────────────────────────
  browser = await Browser.launch({ userDataDir: profile });
  page = await browser.page({ name: "phone", width: 390, height: 844, mobile: true });
  await page.setOffline(true);
  const failedLoads: string[] = [];
  const loaded: { url: string; sw: boolean; status: number }[] = [];
  const ids = new Map<string, string>();
  browser.on((method, p) => {
    if (method === "Network.requestWillBeSent") ids.set(p.requestId, p.request.url);
    if (method === "Network.responseReceived") loaded.push({ url: p.response.url, sw: !!p.response.fromServiceWorker, status: p.response.status });
    if (method === "Network.loadingFailed" && !p.canceled) failedLoads.push(`${ids.get(p.requestId) ?? p.requestId}: ${p.errorText}`);
  });
  await page.goto(`${BASE}/arena`);
  await until(page, `document.querySelector("h1")?.textContent === "Play on this device"`, "the shell, offline", 60000);
  const where = await page.eval<string>("location.pathname");
  check(where === SHELL_PATH, `C. a cold launch of /arena with no network lands on the cached shell (${where})`);
  await until(page, `navigator.serviceWorker.controller`, "control offline");
  const controller = await page.eval<string>("navigator.serviceWorker.controller.scriptURL");
  check(controller.endsWith(`?v=${manifest.version}`), "C. the service worker controls the page");
  const looks = await inPage<{ css: number; bg: string; fonts: { family: string; status: string }[]; scripts: number }>(page, `(async () => {
    const root = getComputedStyle(document.documentElement);
    const fams = [root.getPropertyValue("--font-impact"), root.getPropertyValue("--font-arena")].map((s) => s.split(",")[0].trim()).filter(Boolean);
    const fonts = [];
    for (const f of fams) { const got = await document.fonts.load("italic 800 20px " + f); fonts.push({ family: f, status: got.length ? got[0].status : "none" }); }
    return { css: document.styleSheets.length, bg: getComputedStyle(document.body).backgroundColor, fonts, scripts: document.scripts.length };
  })()`);
  report.offlineLooks = looks;
  const statics = loaded.filter((l) => new URL(l.url).pathname.startsWith("/_next/static/"));
  check(looks.css > 0 && statics.some((l) => l.url.includes(".css")) && looks.bg !== "rgba(0, 0, 0, 0)", `C. the CSS loads from the cache (${looks.css} sheets, body ${looks.bg})`);
  check(statics.filter((l) => l.url.endsWith(".js") || l.url.includes(".js?")).length > 0, `C. the JS loads from the cache (${statics.length} static responses)`);
  check(looks.fonts.length > 0 && looks.fonts.every((f) => f.status === "loaded"), `C. the fonts load from the cache (${looks.fonts.map((f) => `${f.family} ${f.status}`).join(", ")})`);
  check(statics.length > 0 && statics.every((l) => l.sw && l.status === 200), "C. every static response came from the service worker");
  await until(page, `document.querySelector('li[data-pack-hash="${good.hash}"]')`, "the installed pack, offline");
  check(true, "C. the installed pack is listed offline (read from IndexedDB)");
  await page.eval(`document.querySelector('li[data-pack-hash="${good.hash}"] button').click()`);
  await until(page, `[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Start match" && !b.disabled)`, "the new-match form");
  await clickText(page, "Start match");
  try {
    await until(page, `document.querySelector("#board")`, "the board", 120000);
  } catch (e) {
    report.boardPage = (await page.eval<string>("document.querySelector('main')?.innerText ?? ''").catch(() => "")).slice(0, 1500);
    report.boardTechnical = await page.eval<string>("[...document.querySelectorAll('details p.font-mono')].map((p) => p.textContent).join(' | ')").catch(() => "");
    report.failedLoads = failedLoads;
    throw e;
  }
  await sleep(1500);
  const board = await page.eval<{ board: boolean; alert: string | null }>(`({ board: !!document.querySelector("#board"), alert: document.querySelector('[role=alert]')?.textContent ?? null })`);
  report.board = board;
  check(board.board && !board.alert, "C. a match starts on the board offline: the interpreter ran");
  // The match runs in a dedicated Worker (Turbopack's `turbopack-worker-*.js?params=…` bootstrap); with the
  // server gone its script can only have come from the shell cache.
  const workerScripts = loaded.filter((l) => l.url.includes("/turbopack-worker"));
  const perfWorker = await page.eval<string[]>(`performance.getEntriesByType("resource").map((e) => e.name).filter((n) => n.includes("/turbopack-worker"))`);
  report.workerScripts = { network: workerScripts, performance: perfWorker.map((u) => u.split("?")[0]) };
  check(workerScripts.some((l) => l.sw && l.status === 200) || perfWorker.length > 0, `C. the match Worker's script was served by the service worker (${[...new Set([...workerScripts.map((l) => l.url), ...perfWorker].map((u) => new URL(u).pathname))].join(", ") || "none seen"})`);
  if (SHOT) { fs.mkdirSync(path.dirname(SHOT), { recursive: true }); fs.writeFileSync(SHOT, await page.screenshot(false)); notes.push(`shot ${SHOT}`); }
  const staticFailures = failedLoads.filter((f) => { const p = new URL(f.split(": ")[0], BASE).pathname; return p === SHELL_PATH || isShellAsset(p); });
  report.failedLoads = failedLoads;
  check(staticFailures.length === 0, `C. no shell file failed to load (${failedLoads.length} expected offline failures — the shell list and link prefetches: ${[...new Set(failedLoads.map((f) => new URL(f.split(": ")[0], BASE).pathname))].slice(0, 6).join(", ") || "none"})`);

  // ── D. audit every cache ────────────────────────────────────────────────────────────────────
  dump = await cacheDump(page);
  report.caches = Object.fromEntries(Object.entries(dump).map(([n, k]) => [n, k.length]));
  const shellKeys = Object.entries(dump).filter(([n]) => n.startsWith(SHELL_CACHE_PREFIX)).flatMap(([, k]) => k);
  const foreign = shellKeys.filter((k) => k !== SHELL_PATH && k !== SHELL_META_PATH && !isShellAsset(k));
  check(shellKeys.length > 0 && foreign.length === 0, `D. the shell caches hold only the shell page, its meta record and public static files (${shellKeys.length} keys)`);
  const anywhere = Object.values(dump).flat().filter((k) => /^\/(api|collection|decks|settings|login|me)\b/.test(k) || (k.startsWith("/arena") && k !== SHELL_PATH));
  check(anywhere.length === 0, `D. no signed-in page, API body or online arena page is in any cache (${Object.keys(dump).join(", ")})`);
} catch (e) {
  failures.push(`crashed: ${(e as Error).stack ?? e}`);
} finally {
  clearTimeout(watchdog);
  await browser?.close().catch(() => {});
  await stopServer(server);
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(packDir, { recursive: true, force: true });
}

if (JSON_OUT) console.log(JSON.stringify({ ok: failures.length === 0, notes, failures, report }, null, 2));
else {
  for (const n of notes) console.log(n);
  for (const f of failures.filter((f) => f.startsWith("crashed"))) console.log(`FAIL ${f}`);
  console.log(failures.length ? `arena:offline-shell-browser: ${failures.length} check(s) failed` : `arena:offline-shell-browser: ${notes.length} checks passed`);
}
process.exit(failures.length ? 1 : 0);
