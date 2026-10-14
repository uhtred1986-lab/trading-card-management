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
 *   A. Online, first Chrome (#660: preparation is the only way the shell is downloaded):
 *      A0 an unprepared device has no shell cache and no versioned worker, even after visiting the
 *      arena; A1 "Prepare for offline play" is interrupted part-way through the card art (the
 *      script answers 503 after a dozen images): the page says so in plain words, shows NOT ready
 *      and keeps what it has; A2 "Try again" resumes (fetches only what is missing) and the page
 *      becomes ready, with `/sw.js?v=<version>` active and `dbs-arena-shell-<version>` complete.
 *      A pack made for another revision is refused. Online pages and an API are visited, to give the
 *      worker every chance to cache what it must not. A worker for a version the build does not
 *      have is registered: its install fails and the working shell stays active and complete.
 *      The pack's art goes through `/_next/image`, answered by this script over CDP (`--real-art`
 *      lets it reach the real CDNs instead).
 *   B. The server is stopped and Chrome quits.
 *   C. Offline, a NEW Chrome process on the same profile, with the network emulated off as well:
 *      `/arena` (the installed app's start page) lands on the cached shell; its JS, CSS and fonts
 *      load, the service worker controls it, the installed pack is listed, and a match starts on
 *      the board — the match worker's script and the interpreter both loaded from the cache.
 *   D. Every Cache Storage key on the profile is audited: the shell caches hold only the shell page,
 *      its meta record and public static files.
 *   E. Online again, a third Chrome on the profile: the storage figures show; "Remove the decks"
 *      says a saved match goes with them and removes both while the game files stay; "Remove
 *      everything" deletes the app's caches, databases, pointer, worker and mark and leaves an
 *      unrelated cache of the origin alone; a reload then downloads no shell again.
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
import { PREPARED_KEY, SHELL_CACHE_PREFIX, SHELL_META_PATH, SHELL_PATH, isShellAsset, type ShellManifest } from "../src/lib/arena/local/shell.ts";

function usage(message: string): never {
  console.error(`arena:offline-shell-browser: ${message}`);
  console.error("Usage: npm run arena:offline-shell-browser -- [--port N] [--shot PATH] [--shots DIR] [--real-art] [--json] [--total-timeout S]");
  process.exit(2);
}
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
for (const a of argv) if (a.startsWith("--") && !["--json", "--port", "--shot", "--shots", "--real-art", "--total-timeout"].includes(a)) usage(`unknown flag ${a}`);
const PORT = Number(flag("--port") ?? 3759);
const SHOT = flag("--shot");
/** A directory for the preparation page's screenshots (390 and 1440 wide, both skins). */
const SHOTS = flag("--shots");
/** Let the pack's art reach the real CDNs through this server's image endpoint, instead of answering it here. */
const REAL_ART = argv.includes("--real-art");
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
let server = startServer();
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
  const seen = await page.eval<string>(`document.body.innerText.replace(/\\s+/g, " ").slice(-1400) + " ALERTS: " + [...document.querySelectorAll("[role=alert]")].map((a) => a.innerText).join(" / ")`).catch(() => "");
  throw new Error(`timed out waiting for ${what}; the page said: ${seen}`);
}
async function setFile(page: Page, selector: string, file: string) {
  const { root } = await page.cdp<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1 });
  const { nodeId } = await page.cdp<{ nodeId: number }>("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`no ${selector}`);
  await page.cdp("DOM.setFileInputFiles", { nodeId, files: [file] });
}
/** Every Cache Storage name and key on the origin, read in the page. */
const cacheDump = (page: Page) => inPage<Record<string, string[]>>(page, `(async () => { const out = {}; for (const n of await caches.keys()) { const c = await caches.open(n); out[n] = (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search); } return out; })()`);
/** A real key press (Tab, Enter, Space), as a keyboard user makes it. */
async function key(page: Page, name: "Tab" | "Enter" | " ") {
  const code = name === "Tab" ? 9 : name === "Enter" ? 13 : 32;
  const text = name === "Enter" ? "\r" : name === " " ? " " : undefined;
  await page.cdp("Input.dispatchKeyEvent", { type: "keyDown", key: name, code: name === " " ? "Space" : name, windowsVirtualKeyCode: code, ...(text ? { text } : {}) });
  await page.cdp("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name === " " ? "Space" : name, windowsVirtualKeyCode: code });
}
/** Tab from the top of the page until the focused control reads `label`; the number of presses, or -1. */
async function tabTo(page: Page, label: string, max = 60): Promise<number> {
  await page.eval(`document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); 0`);
  for (let i = 1; i <= max; i++) {
    await key(page, "Tab");
    if (await page.eval<boolean>(`document.activeElement?.textContent?.trim() === ${JSON.stringify(label)}`)) return i;
  }
  return -1;
}
const clickText = (page: Page, text: string) => page.eval(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled); if (!b) return false; b.click(); return true; })()`);

try {
  if (!(await waitUp())) throw new Error(`next start did not come up on ${PORT}:\n${server.log()}`);
  const manifest = (await (await fetch(`${BASE}/arena/offline/shell.json`)).json()) as ShellManifest;
  report.manifest = { version: manifest.version, revision: manifest.revision, files: manifest.files.length };
  // A throw, not usage(): process.exit would skip `finally` and leave `next start` holding the port.
  if (!manifest.revision) throw new Error("the build has no interpreter revision: build with GITHUB_SHA=<40-hex> npm run build");
  const shellCacheName = SHELL_CACHE_PREFIX + manifest.version;
  let dump: Record<string, string[]> = {};

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
  let breakAfter = Infinity;
  let healed = true;
  const shotDir = SHOTS ? path.resolve(SHOTS) : null;
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  /** The preparation panel at 390 and 1440, in both skins (the skin is one attribute on the page's root). */
  async function shot(p: Page, name: string) {
    if (!shotDir) return;
    for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
      for (const skin of ["anime", "night"]) {
        await p.cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
        await p.eval(`document.documentElement.dataset.skin = ${JSON.stringify(skin)}`);
        await sleep(250);
        fs.writeFileSync(path.join(shotDir, `${name}-${w}-${skin}.png`), await p.screenshot(true));
      }
    }
    await p.eval(`document.documentElement.dataset.skin = "anime"`);
    await p.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  }
  await page.interceptFetch("*/_next/image*");
  page.onFetchPaused((p) => {
    const art = new URL(p.request.url).searchParams.get("url");
    if (!art) { void page.continueFetch(p.requestId); return; }
    artServed++;
    // After `breakAfter` images the endpoint fails (503) until healed: a connection that drops mid-download.
    if (!healed && artServed > breakAfter) { void page.fulfillFetch(p.requestId, "unavailable", 503); return; }
    if (REAL_ART) { void page.continueFetch(p.requestId); return; }
    setTimeout(() => void page.fulfillFetchBytes(p.requestId, pngFor(art), "image/png").catch(() => {}), 25);
  });
  await page.goto(`${BASE}${SHELL_PATH}`);
  await until(page, `document.querySelector("h1")?.textContent === "Play on this device"`, "the shell page");
  await until(page, `document.querySelector('[data-offline-status]')`, "the preparation panel");
  await inPage(page, `caches.open("unrelated-origin-cache").then((c) => c.put("/keep-me", new Response("not the app's")))`);

  // A0. an unprepared device downloads no shell
  await sleep(4000);
  await page.goto(`${BASE}/arena`);
  await sleep(3000);
  const bare = await inPage<{ regs: string[]; caches: string[]; marked: string | null }>(page, `(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).map((r) => (r.active || r.installing || r.waiting)?.scriptURL ?? ""), caches: await caches.keys(), marked: localStorage.getItem(${JSON.stringify(PREPARED_KEY)}) }))()`);
  report.unprepared = bare;
  check(!bare.caches.some((n) => n.startsWith(SHELL_CACHE_PREFIX)) && bare.regs.every((u) => !u.includes("?v=")) && bare.marked === null, `A0. an unprepared device has no shell cache and no versioned worker after visiting the arena (${bare.regs.map((u) => new URL(u).pathname).join(", ") || "no worker yet"})`);
  await page.goto(`${BASE}${SHELL_PATH}`);
  await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "not-ready" && [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Prepare for offline play")`, "the not-prepared panel");
  const bareText = await page.eval<string>(`document.querySelector('section[aria-label="Offline play"]').innerText`);
  check(/Not prepared for offline play/.test(bareText), "A0. the panel says it is not prepared and offers to prepare");
  await shot(page, "1-not-prepared");

  // A1. interrupted preparation: the art endpoint fails after a dozen images
  breakAfter = 12;
  healed = false;
  artServed = 0;
  const required = requiredArt(good).length;
  const presses = await tabTo(page, "Prepare for offline play");
  check(presses > 0, `A1. the Prepare button is reached with the keyboard alone (${presses} Tab presses)`);
  await key(page, "Enter");
  await until(page, `document.querySelector('[role=alert]')?.textContent.includes("interrupted")`, "the interruption notice", 120000);
  const broken = await page.eval<{ status: string; text: string; alert: string; buttons: string[] }>(`({ status: document.querySelector('[data-offline-status]').dataset.offlineStatus, text: document.querySelector('section[aria-label="Offline play"]').innerText, alert: document.querySelector('[role=alert]').innerText, buttons: [...document.querySelectorAll("button")].map((b) => b.textContent.trim()) })`);
  report.interrupted = { artServed, alert: broken.alert.slice(0, 200) };
  check(broken.status === "not-ready" && !/Ready for offline play/.test(broken.text), "A1. after the interruption the page is NOT ready");
  check(/interrupted/i.test(broken.alert) && /kept/i.test(broken.alert) && !/IndexedDB|service worker|hash|cache/i.test(broken.alert.split("Details")[0]), `A1. it says what happened and that progress is kept, in plain words (${broken.alert.replace(/\s+/g, " ").slice(0, 120)})`);
  check(broken.buttons.includes("Try again"), "A1. a Try again button is offered");
  const stagedLine = await page.eval<string>(`document.querySelector('[data-missing]')?.textContent ?? ""`);
  const verifiedBefore = Number(/stopped after (\d+) of (\d+)/.exec(stagedLine)?.[1] ?? -1);
  check(verifiedBefore > 0 && verifiedBefore < required, `A1. the page reports what is kept: ${stagedLine.trim().slice(0, 150)}`);
  dump = await cacheDump(page);
  check((dump[shellCacheName] ?? []).length === manifest.files.length + 2, "A1. the game files finished before the art stopped: the shell cache is complete, yet the page does not say ready");
  await shot(page, "2-interrupted");

  // A2. retry resumes
  healed = true;
  artServed = 0;
  await clickText(page, "Try again");
  await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "ready"`, "ready after the retry", 180000);
  report.retry = { artServed, verifiedBefore, required };
  check(artServed > 0 && artServed <= required - verifiedBefore, `A2. the retry fetched only the images still missing (${artServed} of ${required}, ${verifiedBefore} were already kept)`);
  const readyText = await page.eval<string>(`document.querySelector('section[aria-label="Offline play"]').innerText`);
  check(/Ready for offline play/.test(readyText) && /all \d+ card images/.test(readyText), "A2. the page now says ready, with the number of card images on the device");
  check(/This app uses about/.test(readyText), `A2. the storage use is shown (${(/This app uses about[^.]*\./.exec(readyText) ?? [""])[0]})`);
  const small = await page.eval<string[]>(`[...document.querySelectorAll('section[aria-label="Offline play"] button')].filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent.trim())`);
  check(small.length === 0, `A2. every button of the panel is at least 44 px tall on the phone (${small.join(", ") || "all"})`);
  await shot(page, "3-ready");
  // The card-art worker the page registered earlier is still running this window, so the shell's worker may wait
  // (it never takes over a running page); the shell is in the cache either way, and the art-only worker serves it offline.
  const sw = await inPage<{ url: string; state: string } | null>(page, `(async () => { for (let i = 0; i < 200; i++) { const r = await navigator.serviceWorker.getRegistration(); const w = [r?.installing, r?.waiting, r?.active].find((x) => x && x.scriptURL.includes(${JSON.stringify(manifest.version)})); if (w && w.state !== "installing") return { url: w.scriptURL, state: w.state }; await new Promise((x) => setTimeout(x, 150)); } return null; })()`, 90000);
  report.worker = sw;
  check(!!sw && sw.url.endsWith(`/sw.js?v=${manifest.version}`) && (sw.state === "installed" || sw.state === "activated"), `A2. preparing registered /sw.js?v=${manifest.version} (${sw?.state}; it waits for every window of the app to close, by design)`);
  dump = await cacheDump(page);
  check((dump[shellCacheName] ?? []).length === manifest.files.length + 2, `A2. ${shellCacheName} holds the shell page, its meta record and all ${manifest.files.length} listed files`);
  check(await page.eval<boolean>(`localStorage.getItem(${JSON.stringify(PREPARED_KEY)}) === "1"`), "A2. the device is marked prepared");

  await page.goto(`${BASE}${SHELL_PATH}`); // now under the worker
  await until(page, `navigator.serviceWorker.controller`, "control");
  await until(page, `document.querySelector('section[aria-label="Deck pack"] input[type=file]')`, "the deck file input");
  await clickText(page, "Choose a deck pack or add one from a file").catch(() => {});
  await page.eval(`document.querySelector('section[aria-label="Deck pack"] details').open = true`);
  await setFile(page, 'section[aria-label="Deck pack"] input[type=file]', otherFile);
  await until(page, `document.querySelector('[role=alert]')?.textContent.includes("not installed")`, "the refusal of another revision's pack", 120000);
  const refusal = await page.eval<string>(`document.querySelector('[role=alert]').textContent`);
  report.refusedInstall = refusal;
  check(/unplayable|interpreter revision/.test(refusal), `A. a pack made for another interpreter revision is refused at install (${refusal.slice(0, 140)})`);
  await until(page, `document.querySelector('li[data-pack-hash="${good.hash}"]')`, "the installed pack");
  check(true, "A. the pack this build serves at /arena/offline/pack.json is the pack the builder makes for this revision, and it is the one installed");

  // Give the worker every chance to cache what it must not: online pages and an API.
  for (const p of ["/collection", "/decks", "/settings", "/arena", "/arena/local"]) await page.goto(`${BASE}${p}`).catch(() => {});
  await page.goto(`${BASE}${SHELL_PATH}`);
  await inPage(page, `fetch("/api/v1/health").then((r) => r.status)`).catch(() => {});

  // An update whose install fails: a version the server does not describe.
  const bogus = "0123456789abcdef";
  const failed = await inPage<{ active: string; installing: boolean; waiting: string | null; caches: string[] }>(page, `(async () => {
    const r = await navigator.serviceWorker.register("/sw.js?v=${bogus}");
    const w = r.installing || r.waiting;
    if (w) await new Promise((res) => { if (w.state === "redundant") res(); w.addEventListener("statechange", () => { if (w.state === "redundant" || w.state === "installed") res(); }); });
    const now = await navigator.serviceWorker.getRegistration();
    return { active: now.active.scriptURL, installing: !!now.installing, waiting: now.waiting ? now.waiting.scriptURL : null, caches: await caches.keys() };
  })()`, 60000);
  report.failedUpdate = failed;
  // The prepared shell's worker is waiting for the window to close (the card-art worker is the active one): a failed install must leave it so.
  check((failed.waiting ?? failed.active).endsWith(`?v=${manifest.version}`) && !failed.installing && !failed.caches.includes(SHELL_CACHE_PREFIX + bogus) && failed.caches.includes(shellCacheName), "A. an update whose install fails leaves the prepared shell's worker in place and its cache whole; no partial cache stays");
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
  await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "ready"`, "the ready panel, offline");
  const offlineText = await page.eval<string>(`document.querySelector('section[aria-label="Offline play"]').innerText`);
  check(/Ready for offline play/.test(offlineText) && /offline, so updates cannot be checked/.test(offlineText), "C. offline, the panel reads the device and says ready (it cannot check for updates)");
  await shot(page, "4-ready-offline");
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
  // #783: a match on the shell's page takes the whole screen — no app header, no tab bar.
  const chrome = await page.eval<boolean>(`[...document.querySelectorAll("header, nav")].some((el) => el.getBoundingClientRect().height > 0 && getComputedStyle(el).display !== "none" && !el.closest(".arena"))`);
  check(!chrome, "C. the offline board shows no app header or tab bar (#783)");
  if (shotDir) {
    // The board offline, with the artwork read from the device, on the phone and the desktop (the shell's board is the night skin).
    for (const [w, h, mobile] of [[360, 800, true], [390, 844, true], [1440, 900, false]] as const) {
      await page.cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
      await sleep(1200);
      fs.writeFileSync(path.join(shotDir, `board-offline-${w}.png`), await page.screenshot(false));
    }
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  }
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

  // ── E. online again: storage, removal, and unpreparing ──────────────────────────────────────
  await browser.close();
  browser = null;
  server = startServer();
  if (!(await waitUp())) throw new Error(`next start did not come up again on ${PORT}:\n${server.log()}`);
  browser = await Browser.launch({ userDataDir: profile });
  page = await browser.page({ name: "phone", width: 390, height: 844, mobile: true });
  await page.goto(`${BASE}${SHELL_PATH}`);
  await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "ready"`, "the ready panel, online again");
  await until(page, `document.querySelector('[data-saves]')?.textContent.includes("1 saved match")`, "the saved match from the offline game");
  const storageText = await page.eval<string>(`document.querySelector('[data-storage]').innerText`);
  const usage = await inPage<{ usage: number; quota: number }>(page, `navigator.storage.estimate()`);
  check(/This app uses about [\d.]+ (KB|MB|GB)/.test(storageText) && usage.usage > 0, `E. the storage in use is shown (${(/This app uses about[^.]*\.\d?[^.]*\./.exec(storageText) ?? [storageText.slice(0, 90)])[0].replace(/\s+/g, " ")}; the browser reports ${usage.usage} of ${usage.quota} bytes)`);
  check(/1 saved match/.test(storageText), "E. the saved match from the offline game is listed");
  await shot(page, "5-storage");
  // 200% text: a 390 px phone at 200% browser zoom lays out 195 px wide, a 1440 px desktop 720 px wide.
  for (const [w, h, label, mobile] of [[195, 422, "390", true], [720, 450, "1440", false]] as const) {
    await page.cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile });
    await page.eval(`document.querySelector('[role=group]') ? 0 : 0`);
    await sleep(300);
    // The page's own content (the app-wide header and tab bar are older and out of this issue's scope).
    const wide = await page.eval<string[]>(`[...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 6).map((e) => e.tagName + "." + String(e.className).slice(0, 40) + " " + Math.round(e.getBoundingClientRect().right) + " " + (e.textContent || "").trim().slice(0, 30))`);
    const checked = await page.eval<number>(`document.querySelectorAll("main *").length`);
    check(checked > 50 && wide.length === 0, `E. at 200% text (${label} px wide screen, ${w} px layout) the page's content (${checked} elements) does not run past the edge${wide.length ? ` — wide: ${wide.join(" | ")}` : ""}`);
    if (shotDir) fs.writeFileSync(path.join(shotDir, `9-ready-text200-${label}.png`), await page.screenshot(true));
  }
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  // Remove the decks: the saved match goes with them, after the page says so.
  const toRemove = await tabTo(page, "Remove the decks");
  check(toRemove > 0, `E. "Remove the decks" is reached with the keyboard alone (${toRemove} Tab presses)`);
  await key(page, "Enter");
  await until(page, `document.querySelector('[role=group][aria-label="Remove the decks"]')`, "the removal question");
  const ask = await page.eval<string>(`document.querySelector('[role=group][aria-label="Remove the decks"]').innerText`);
  check(/saved match uses these decks and would be deleted/.test(ask) && /need a connection to prepare again/.test(ask), `E. removing the decks says a saved match goes with them and that a connection is needed to prepare again (${ask.replace(/\s+/g, " ").slice(0, 160)})`);
  await shot(page, "6-remove-decks");
  await clickText(page, "Delete the saved matches and remove the decks");
  await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "not-ready" && document.querySelector('[data-saves]')?.textContent.includes("No saved matches")`, "the device after removing the decks");
  const afterPack = await inPage<{ versions: number; art: number; matches: number; decisions: number; caches: string[]; pointer: string | null }>(page, `(async () => {
    const open = (name) => new Promise((res, rej) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const count = (db, store) => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).count(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const p = await open("dbs-arena-packs"); const l = await open("dbs-arena-local");
    const out = { versions: await count(p, "versions"), art: await count(p, "art"), matches: await count(l, "matches"), decisions: await count(l, "decisions"), caches: await caches.keys(), pointer: localStorage.getItem("dbs-arena-local-pointer") };
    p.close(); l.close(); return out;
  })()`);
  report.afterPackRemoved = afterPack;
  check(afterPack.versions === 0 && afterPack.art === 0 && afterPack.matches === 0 && afterPack.decisions === 0 && afterPack.pointer === null, "E. removing the decks removed the pack, every image, the saved match with its moves and its pointer");
  check(afterPack.caches.includes(shellCacheName), "E. the game files stay when only the decks are removed");
  await shot(page, "7-decks-removed");

  // Remove everything.
  await clickText(page, "Remove everything");
  await until(page, `document.querySelector('[role=group][aria-label="Remove everything"]')`, "the remove-everything question");
  const askAll = await page.eval<string>(`document.querySelector('[role=group][aria-label="Remove everything"]').innerText`);
  check(/nothing else this site stored is removed/i.test(askAll) && /Offline play stops/.test(askAll), "E. remove everything says what goes, that offline play stops, and that nothing else is removed");
  await page.eval(`document.querySelector('[role=group][aria-label="Remove everything"] button').click()`);
  await until(page, `document.querySelector('[data-notice]')?.textContent.includes("Everything for offline play was removed")`, "the removal notice", 60000);
  const gone = await inPage<{ regs: number; caches: string[]; marked: string | null; pointer: string | null; unrelated: string | null }>(page, `(async () => ({
    regs: (await navigator.serviceWorker.getRegistrations()).length, caches: await caches.keys(),
    marked: localStorage.getItem(${JSON.stringify(PREPARED_KEY)}), pointer: localStorage.getItem("dbs-arena-local-pointer"),
    unrelated: await (await (await caches.open("unrelated-origin-cache")).match("/keep-me"))?.text() ?? null,
  }))()`);
  report.afterEverythingRemoved = gone;
  check(gone.regs === 0 && gone.marked === null && gone.pointer === null, "E. removing everything unregistered the worker and cleared the prepared mark and the saved-match pointer");
  check(gone.caches.filter((n) => n !== "unrelated-origin-cache").length === 0, `E. every cache the app owns is gone (${gone.caches.join(", ")})`);
  check(gone.unrelated === "not the app's", "E. an unrelated cache of the same origin is untouched");
  const names = await inPage<string[]>(page, `indexedDB.databases().then((d) => d.map((x) => x.name))`);
  const left = await inPage<number>(page, `(async () => { let n = 0; for (const name of ["dbs-arena-packs", "dbs-arena-local"]) { if (!(await indexedDB.databases()).some((d) => d.name === name)) continue; const db = await new Promise((res) => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result); }); for (const s of db.objectStoreNames) n += await new Promise((res) => { const r = db.transaction(s).objectStore(s).count(); r.onsuccess = () => res(r.result); }); db.close(); } return n; })()`);
  check(left === 0, `E. the app's two databases hold nothing (${names.filter((n) => n.startsWith("dbs-")).join(", ") || "not present"})`);
  await shot(page, "8-removed");

  // A reload of an unprepared device downloads no shell again.
  await page.goto(`${BASE}${SHELL_PATH}`);
  await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "not-ready"`, "the unprepared panel after the reload");
  await sleep(4500);
  await page.goto(`${BASE}/arena`);
  await sleep(3000);
  const again = await inPage<{ regs: string[]; caches: string[] }>(page, `(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).map((r) => (r.active || r.installing || r.waiting)?.scriptURL ?? ""), caches: await caches.keys() }))()`);
  report.afterReload = again;
  check(!again.caches.some((n) => n.startsWith(SHELL_CACHE_PREFIX)) && again.regs.every((u) => !u.includes("?v=")), "E. after removal a reload downloads no shell again: the device is unprepared, with the card-art worker only");
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
