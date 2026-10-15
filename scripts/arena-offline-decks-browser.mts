#!/usr/bin/env node
/**
 * #793 in real Chrome against a PRODUCTION build: a player's own decks on the device, from
 * `/arena/offline` — with no database. The server half (`/api/arena/offline/pack`, `/decks`) needs
 * one, so this script builds the very packs and checks those routes would answer from a PGlite copy
 * of the live data (`scripts/verify/arena-offline-decks-fixture.mts`: the snapshot's cards, the
 * drafter's `card_rules`, two of a player's decks) and answers the page's requests for them itself
 * (CDP `Fetch`). Card art through `/_next/image` is answered with placeholder PNGs, as
 * `arena:offline-shell-browser` does.
 *
 *   GITHUB_SHA=<40-hex> npm run build
 *   GITHUB_SHA=<same>  npx tsx scripts/arena-offline-decks-browser.mts [--port N] [--shots DIR]
 *
 * The server runs WITH Basic Auth configured and the browser never signs in: `/arena` answers 401,
 * and `/arena/offline` — with "Remove everything" — still opens, so every player reaches it.
 *
 *   1. Prepare for offline play (the starters), then put the device pack with two of the player's
 *      decks on the device (the page's own "add a deck file" path; the deck page itself cannot render
 *      without a database).
 *   2. "Decks on this device" lists the starters and both decks with their storage; the server says
 *      one list changed online: the row says so, "Update" downloads the new pack through
 *      `/api/arena/offline/pack?decks=…` with progress, and the row is current again.
 *   3. Matches to the END through the page's board: the player's deck against a starter (human
 *      second), and against the other downloaded deck (human first).
 *   4. With the network off, "Remove" takes one deck off: no request is made, the other decks stay,
 *      the saved match of the removed deck goes and the other saved match stays; a new match on the
 *      remaining deck starts offline.
 *   5. Remove everything empties the device.
 *
 * Not shown here: the deck page's "Available offline" card (it needs the database), a real download
 * from the server routes against Neon, real card art. Needs Chrome and a build; not part of `npm test`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eq, and } from "drizzle-orm";
import { Browser, findChrome, sleep, type Page } from "./lib/cdp.mts";
import { BOARD, chooseLocalSetup } from "./lib/local-arena-page.mts";
import { mastersPackInput } from "./build-arena-offline-pack.mts";
import { pngFor } from "./verify/arena-pack-store-fixture.mts";
import { liveFixture } from "./verify/arena-offline-decks-fixture.mts";
import { humanAsked, humanPick } from "./verify/arena-local-storage-driver.ts";
import * as schema from "../src/db/schema.ts";
import { buildDeviceOfflinePack, checkOfflineDecks } from "../src/lib/arena/offline-decks.ts";
import { devicePackUrl, offlineDeckKey } from "../src/lib/arena/local/device-decks.ts";
import { canonicalJson } from "../src/lib/arena/replay-core.ts";
import { SHELL_PATH, type ShellManifest } from "../src/lib/arena/local/shell.ts";
import type { Snapshot } from "../src/lib/arena/snapshot-core.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const PORT = Number(flag("--port") ?? 3793);
const SHOTS = flag("--shots");
const TOTAL_MS = 900_000;
try { findChrome(); } catch (e) { console.error((e as Error).message); process.exit(2); }
if (!fs.existsSync(".next/BUILD_ID")) { console.error("no production build: run `npm run build` first"); process.exit(2); }
const BASE = `http://localhost:${PORT}`;
const notes: string[] = [];
const failures: string[] = [];
const check = (ok: unknown, what: string) => { if (ok) notes.push(`ok   ${what}`); else { failures.push(what); notes.push(`FAIL ${what}`); } };

function startServer() {
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(PORT), NODE_ENV: "production", BASIC_AUTH_USER: "owner793", BASIC_AUTH_PASSWORD: "not-used-by-the-browser" };
  for (const k of Object.keys(env)) if (/^(DATABASE_URL|AUTH_SECRET|GOOGLE_CLIENT_|SL_EMAILS|ARENA_ADMINS)/.test(k)) delete env[k];
  const proc = spawn(process.execPath, [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  proc.stdout.on("data", (d) => { log += d; });
  proc.stderr.on("data", (d) => { log += d; });
  return { proc, log: () => log };
}
const server = startServer();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "arena-offline-decks-"));
const packDir = fs.mkdtempSync(path.join(os.tmpdir(), "arena-offline-decks-packs-"));
let browser: Browser | null = null;
async function stopServer() {
  if (server.proc.exitCode !== null) return;
  const gone = new Promise((r) => server.proc.once("exit", r));
  server.proc.kill("SIGTERM");
  await Promise.race([gone, sleep(5000)]);
  if (server.proc.exitCode === null) server.proc.kill("SIGKILL");
}
const watchdog = setTimeout(async () => { console.error("FAIL arena-offline-decks-browser: overall timeout"); await browser?.close().catch(() => {}); await stopServer(); process.exit(1); }, TOTAL_MS);

async function until(page: Page, expr: string, what: string, timeoutMs = 60000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await page.eval<boolean>(`(() => { try { return !!(${expr}); } catch { return false; } })()`).catch(() => false)) return;
    await sleep(200);
  }
  const seen = await page.eval<string>(`document.body.innerText.replace(/\\s+/g, " ").slice(-1200)`).catch(() => "");
  throw new Error(`timed out waiting for ${what}; the page said: ${seen}`);
}
const clickText = (page: Page, text: string, scope = "document") => page.eval<boolean>(`(() => { const b = [...${scope}.querySelectorAll("button")].find((x) => x.textContent.trim() === ${JSON.stringify(text)} && !x.disabled && x.getClientRects().length > 0); if (!b) return false; b.click(); return true; })()`);
async function setFile(page: Page, selector: string, file: string) {
  const { root } = await page.cdp<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1 });
  const { nodeId } = await page.cdp<{ nodeId: number }>("DOM.querySelector", { nodeId: root.nodeId, selector });
  if (!nodeId) throw new Error(`no ${selector}`);
  await page.cdp("DOM.setFileInputFiles", { nodeId, files: [file] });
}
const deckRows = (page: Page) => page.eval<{ key: string; text: string; stale: boolean }[]>(`[...document.querySelectorAll("[data-device-deck]")].map((li) => ({ key: li.dataset.deviceDeck, text: li.innerText.replace(/\\s+/g, " "), stale: li.dataset.stale === "true" }))`);
async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]] as const) {
    for (const skin of ["anime", "night"]) {
      await page.cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile });
      await page.eval(`document.documentElement.dataset.skin = ${JSON.stringify(skin)}; document.querySelector("[data-device-decks]")?.scrollIntoView(); 0`);
      await sleep(250);
      fs.writeFileSync(path.join(SHOTS, `${name}-${w}-${skin}.png`), await page.screenshot(false));
    }
  }
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
}

// The board, as `arena:offline-release` drives it: the human's question answered with `humanPick`, otherwise the computer asked.
async function snapshot(page: Page): Promise<{ s: Snapshot; kind: string; saving: boolean; matchId: string } | null> {
  const raw = await page.eval<string | null>(`(() => { const b = ${BOARD}; if (!b) return null; return JSON.stringify({ s: b.supervisor.snapshot, kind: b.state.kind, saving: b.saving, matchId: b.matchId }); })()`);
  return raw ? JSON.parse(raw) : null;
}
async function playToEnd(page: Page): Promise<{ revision: number; matchId: string }> {
  for (let i = 0; i < 6000; i++) {
    const v = await snapshot(page);
    if (!v || !v.s || v.saving || v.kind !== "owner") { await sleep(80); continue; }
    if (v.s.game.status === "over") return { revision: v.s.game.revision, matchId: v.matchId };
    await page.eval(`document.querySelector("[data-arena-notice] button")?.click()`);
    const err = humanAsked(v.s)
      ? await page.eval<string | null>(`${BOARD}.act(${JSON.stringify(humanPick(v.s))}, ${v.s.game.revision}, crypto.randomUUID()).then((r) => r.error)`)
      : await page.eval<string | null>(`${BOARD}.advance().then((r) => r.error)`);
    if (err) await sleep(150);
  }
  throw new Error("the match did not end");
}
async function startMatch(page: Page, mine: string, theirs: string, seat: "First" | "Second") {
  await chooseLocalSetup(page, mine, theirs, seat === "First" ? "p1" : "p2");
  const labels = await page.eval<string[]>(`[...document.querySelectorAll("section[aria-label='New match'] legend")].map((s) => s.textContent.trim())`);
  await clickText(page, "Start match");
  await until(page, `(() => { const b = ${BOARD}; return !!(b && b.supervisor.snapshot && b.state.kind === "owner"); })()`, "the board", 120000);
  return labels;
}
const savedMatches = (page: Page) => page.eval<{ matchId: string; decks: { p1: string; p2: string } }[]>(`new Promise((res) => { const r = indexedDB.open("dbs-arena-local"); r.onsuccess = () => { const db = r.result; const q = db.transaction("matches").objectStore("matches").getAll(); q.onsuccess = () => { db.close(); res(q.result.map((h) => ({ matchId: h.matchId, decks: h.decks }))); }; }; })`);

try {
  // ── the live data, on PGlite ─────────────────────────────────────────────────────────────────
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { try { up = (await fetch(`${BASE}/arena/offline/shell.json`)).ok; } catch { await sleep(500); } }
  if (!up) throw new Error(`next start did not come up:\n${server.log()}`);
  const manifest = (await (await fetch(`${BASE}/arena/offline/shell.json`)).json()) as ShellManifest;
  if (!manifest.revision) throw new Error("the build has no interpreter revision: build with GITHUB_SHA=<40-hex>");
  const REV = manifest.revision;
  check((await fetch(`${BASE}/arena`)).status === 401, "the server asks for sign-in everywhere else: /arena answers 401 to this browser");
  check((await fetch(`${BASE}/api/arena/offline/pack?decks=1`)).status === 401, "the device pack route itself is behind sign-in (401 without credentials)");

  const fx = await liveFixture();
  const red = await fx.addDeck("ann", "Ann's Crimson", fx.specB);
  const red2 = await fx.addDeck("ann", "Ann's Crimson II", fx.specB);
  const starters = await mastersPackInput({ runtimeRevision: REV });
  const answers = new Map<string, string>();
  const packOf = async (ids: number[]) => canonicalJson(await buildDeviceOfflinePack(fx.db, "ann", ids, starters));
  const firstPack = await packOf([red, red2]);
  const firstFile = path.join(packDir, "device.json");
  fs.writeFileSync(firstFile, firstPack);
  // Then the list of the first deck changes online: one copy of a main card swapped for another.
  const rows = await fx.db.select().from(schema.deckCards).where(and(eq(schema.deckCards.deckId, red), eq(schema.deckCards.zone, "main")));
  const from = rows.find((r) => r.quantity > 1)!;
  const to = rows.find((r) => r.cardId !== from.cardId && r.quantity < 4)!;
  await fx.db.update(schema.deckCards).set({ quantity: from.quantity - 1 }).where(and(eq(schema.deckCards.deckId, red), eq(schema.deckCards.zone, "main"), eq(schema.deckCards.cardId, from.cardId)));
  await fx.db.update(schema.deckCards).set({ quantity: to.quantity + 1 }).where(and(eq(schema.deckCards.deckId, red), eq(schema.deckCards.zone, "main"), eq(schema.deckCards.cardId, to.cardId)));
  answers.set(devicePackUrl([red, red2]), await packOf([red, red2]));
  const checks = await checkOfflineDecks(fx.db, "ann", [red, red2]);
  answers.set(`/api/arena/offline/decks?ids=${red},${red2}`, JSON.stringify({ decks: [...checks.values()] }));
  answers.set(`/api/arena/offline/decks?ids=${red2}`, JSON.stringify({ decks: [checks.get(red2)] }));
  await fx.client.close();

  // ── 1. prepare, then the device pack with two of the player's decks ─────────────────────────
  browser = await Browser.launch({ userDataDir: profile });
  const page = await browser.page({ name: "phone", width: 390, height: 844, mobile: true });
  const served: string[] = [];
  await page.interceptFetch(["*/_next/image*", "*/api/arena/offline/*"]);
  page.onFetchPaused((p) => {
    const url = new URL(p.request.url);
    const art = url.searchParams.get("url");
    if (url.pathname === "/_next/image" && art) { setTimeout(() => void page.fulfillFetchBytes(p.requestId, pngFor(art), "image/png").catch(() => {}), 10); return; }
    const key = url.pathname + url.search;
    served.push(key);
    const body = answers.get(key);
    void page.fulfillFetch(p.requestId, body ?? JSON.stringify({ error: "not_found" }), body ? 200 : 404);
  });
  await page.goto(`${BASE}${SHELL_PATH}`);
  await until(page, `document.querySelector('[data-offline-status]')`, "the preparation panel (no sign-in)");
  await clickText(page, "Prepare for offline play");
  await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "ready"`, "ready with the starters", 240000);
  check(await page.eval<boolean>(`[...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Remove everything")`), "a prepared device offers Remove everything on /arena/offline, to a browser that never signed in");
  await until(page, `document.querySelectorAll("[data-device-deck]").length >= 2`, "the device's deck list").catch(() => {});
  check(JSON.stringify((await deckRows(page)).map((r) => r.key)) === JSON.stringify(["A", "B"]), "prepared: the starters are on the device");

  await page.eval(`document.querySelector('section[aria-label="Deck pack"] details').open = true; 0`);
  await setFile(page, 'section[aria-label="Deck pack"] input[type=file]', firstFile);
  await until(page, `document.querySelectorAll("[data-device-deck]").length === 4`, "the device pack with the player's decks", 180000);
  const k1 = offlineDeckKey(red), k2 = offlineDeckKey(red2);
  await until(page, `[...document.querySelectorAll("[data-device-deck]")].every((li) => /about \\d/.test(li.innerText))`, "each deck's storage").catch(() => {});
  let list = await deckRows(page);
  check(JSON.stringify(list.map((r) => r.key)) === JSON.stringify(["A", "B", k1, k2]), `the device holds ONE pack: the starters and both of the player's decks (${list.map((r) => r.key).join(", ")})`);
  check(list.slice(2).every((r) => /your deck/.test(r.text) && /card pictures, about \d/.test(r.text)), `each of the player's decks shows what it takes on the device (${list[2].text.slice(0, 120)})`);
  check(list.slice(0, 2).every((r) => /built in/.test(r.text) && !/Remove/.test(r.text)), "the built-in decks cannot be removed one by one");

  // ── 2. a changed list says so, and Update downloads it ───────────────────────────────────────
  await until(page, `document.querySelector('[data-device-deck="${k1}"]')?.dataset.stale === "true"`, "the changed-online flag");
  list = await deckRows(page);
  check(list.find((r) => r.key === k1)!.stale && !list.find((r) => r.key === k2)!.stale, `only the deck whose list changed online says so: "${list.find((r) => r.key === k1)!.text.match(/Its list changed[^.]*\./)?.[0]}"`);
  await shot(page, "1-device-decks-stale");
  const before = served.length;
  await clickText(page, "Update", `document.querySelector('[data-device-deck="${k1}"]')`);
  await until(page, `document.querySelector("[data-deck-progress]")`, "download progress", 30000).catch(() => {});
  const sawProgress = await page.eval<boolean>(`!!document.querySelector("[data-deck-progress]") || /up to date/.test(document.querySelector("[data-deck-notice]")?.textContent ?? "")`);
  await until(page, `/up to date/.test(document.querySelector("[data-deck-notice]")?.textContent ?? "")`, "the update to finish", 180000);
  check(sawProgress, "the update shows its progress");
  check(served.slice(before).includes(devicePackUrl([red, red2])), `the update downloaded the new pack from ${devicePackUrl([red, red2])}`);
  await until(page, `document.querySelector('[data-device-deck="${k1}"]') && document.querySelector('[data-device-deck="${k1}"]').dataset.stale !== "true"`, "the deck to be current");
  check(true, "after the update the deck is current: the flag is gone");
  await shot(page, "2-device-decks-current");

  // ── 3. full matches: against a starter, and against the other downloaded deck ───────────────
  const labels = await startMatch(page, k1, "A", "Second");
  check(labels.includes("Your deck") && labels.includes("Computer's deck"), `the form asks for "Your deck" and the "Computer's deck" (${labels.join(" / ")})`);
  const m1 = await playToEnd(page);
  check(true, `${k1} v starter A, human second: played to the end (revision ${m1.revision})`);
  await page.goto(`${BASE}${SHELL_PATH}`);
  await until(page, `document.querySelectorAll("[data-device-deck]").length === 4`, "the decks after the match");
  await startMatch(page, k2, k1, "First");
  const m2 = await playToEnd(page);
  check(true, `${k2} v ${k1}, human first: played to the end (revision ${m2.revision})`);
  await page.goto(`${BASE}${SHELL_PATH}`);
  await until(page, `document.querySelectorAll("[data-device-deck]").length === 4`, "the decks after the second match");
  const savesBefore = await savedMatches(page);

  // ── 4. remove one deck with the network off ──────────────────────────────────────────────────
  await page.setOffline(true);
  const offlineFrom = served.length;
  await clickText(page, "Remove", `document.querySelector('[data-device-deck="${k2}"]')`);
  await until(page, `document.querySelector('[role=group][aria-label^="Remove "]')`, "the removal question");
  const ask = await page.eval<string>(`document.querySelector('[role=group][aria-label^="Remove "]').innerText`);
  check(/would be deleted with it/.test(ask) && /other decks stay/.test(ask), `the page says what goes and what stays first: ${ask.replace(/\s+/g, " ").slice(0, 160)}`);
  await clickText(page, "Delete them and remove the deck");
  await until(page, `/taken off this device/.test(document.querySelector("[data-deck-notice]")?.textContent ?? "")`, "the removal", 60000);
  await until(page, `document.querySelectorAll("[data-device-deck]").length === 3`, "three decks left");
  list = await deckRows(page);
  check(JSON.stringify(list.map((r) => r.key)) === JSON.stringify(["A", "B", k1]), `offline, one deck came off and the others stayed (${list.map((r) => r.key).join(", ")})`);
  const during = served.slice(offlineFrom);
  check(!during.some((u) => u.startsWith("/api/arena/offline/pack")), `taking a deck off downloaded no pack: the device rebuilt it (requests meanwhile: ${during.join(", ") || "none"})`);
  const savesAfter = await savedMatches(page);
  const uses = (s: { decks: { p1: string; p2: string } }, k: string) => s.decks.p1 === k || s.decks.p2 === k;
  check(savesBefore.some((s) => uses(s, k2)) && !savesAfter.some((s) => uses(s, k2)), "the saved match that played the removed deck went with it");
  check(savesAfter.some((s) => uses(s, k1) && !uses(s, k2)), "the saved match that does not play it stayed");
  await shot(page, "3-device-decks-after-removal");
  await startMatch(page, k1, "B", "First");
  check(true, `offline, a new match starts on the remaining deck (${k1} v B)`);
  await page.setOffline(false);
  await page.goto(`${BASE}${SHELL_PATH}`);
  await until(page, `document.querySelectorAll("[data-device-deck]").length === 3`, "the decks again");

  // ── 5. remove everything ─────────────────────────────────────────────────────────────────────
  await clickText(page, "Remove everything");
  await until(page, `document.querySelector('[role=group][aria-label="Remove everything"]')`, "the question");
  await page.eval(`[...document.querySelectorAll('[role=group][aria-label="Remove everything"] button')].find((b) => b.textContent.trim() === "Remove everything").click()`);
  await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === "not-ready"`, "the device to be empty", 60000);
  check((await deckRows(page)).length === 0, "Remove everything took every deck off the device, for a browser that never signed in");
} catch (e) {
  failures.push(`crashed: ${(e as Error).stack ?? e}`);
} finally {
  clearTimeout(watchdog);
  await browser?.close().catch(() => {});
  await stopServer();
  fs.rmSync(profile, { recursive: true, force: true });
  fs.rmSync(packDir, { recursive: true, force: true });
}
for (const n of notes) console.log(n);
for (const f of failures.filter((f) => f.startsWith("crashed"))) console.log(`FAIL ${f}`);
console.log(failures.length ? `arena-offline-decks-browser: ${failures.length} check(s) failed` : `arena-offline-decks-browser: ${notes.length} checks passed`);
process.exit(failures.length ? 1 : 0);
