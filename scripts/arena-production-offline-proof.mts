#!/usr/bin/env node
/**
 * #793: cold-launch a PREPARED production Chrome profile with every HTTP destination disconnected,
 * then play both downloaded decks against a starter and one another, in both seats.
 * No fixture, intercepted response, database connection, or online preparation is used here.
 * Usage and the separate, authorized online preparation step: docs/arena-production-offline-proof.md.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Browser, sleep, type Page } from "./lib/cdp.mts";
import { BOARD, WorkerTaps, clickText, readJournalExpr, until } from "./lib/local-arena-page.mts";
import { humanAsked, humanPick } from "./verify/arena-local-storage-driver.ts";
import type { Snapshot } from "../src/lib/arena/snapshot-core.ts";

const args = process.argv.slice(2);
function flag(name: string, fallback?: string): string {
  const i = args.indexOf(name);
  const value = i < 0 ? fallback : args[i + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing ${name}`);
  return value;
}
const profile = path.resolve(flag("--profile"));
const output = path.resolve(flag("--output", "proof-793"));
const base = new URL(flag("--url", "https://trading-card-management.vercel.app"));
assert(["http:", "https:"].includes(base.protocol), "--url must be HTTP(S)");
const deckIds = flag("--decks", "17,19").split(",").map(Number);
assert(deckIds.length === 2 && deckIds.every((id) => Number.isSafeInteger(id) && id > 0) && deckIds[0] !== deckIds[1], "--decks needs two distinct positive IDs");
assert(fs.existsSync(profile), "Profile must already exist; prepare it online first");
assert(fs.existsSync(path.join(profile, "Local State")), "Not a prepared Chrome user-data directory");
fs.mkdirSync(output, { recursive: true });
const shell = `${base.origin}/arena/offline`;
const keys = deckIds.map((id) => `deck-${id}`);
const report: Record<string, unknown> = {
  issue: 793, startedAt: new Date().toISOString(), origin: base.origin,
  productionOrigin: base.origin === "https://trading-card-management.vercel.app",
  offline: { browserProxy: "closed loopback port, all hosts including loopback", pageEmulation: true },
  matches: [], success: false,
};
let browser: Browser | undefined;
let watchdog: ReturnType<typeof setTimeout> | undefined;
let taps: WorkerTaps | undefined;
const memoryCached = new Set<string>();
const responses: Array<{ url: string; status: number; fromServiceWorker: boolean; fromDiskCache: boolean }> = [];

async function screenshot(page: Page, filename: string) {
  fs.writeFileSync(path.join(output, filename), await page.screenshot(false));
}
async function view(page: Page) {
  return page.eval<{ snapshot: Snapshot; kind: string; saving: boolean; matchId: string; packFacts: unknown } | null>(`(() => { const b = ${BOARD}; return b ? { snapshot: b.supervisor.snapshot, kind: b.state.kind, saving: b.saving, matchId: b.matchId, packFacts: { hash: b.packFacts.hash, id: b.packFacts.id, runtimeRevision: b.packFacts.runtimeRevision, decks: b.packFacts.decks, source: b.packFacts.pack.source } } : null; })()`);
}
async function playToEnd(page: Page) {
  const deadline = Date.now() + 10 * 60_000;
  let refusals = 0;
  while (Date.now() < deadline) {
    const v = await view(page);
    if (!v?.snapshot || v.saving) { await sleep(100); continue; }
    assert.equal(v.kind, "owner", `Board entered ${v.kind}`);
    const s = v.snapshot;
    if (s.game.status === "over") return v;
    await page.eval(`document.querySelector("[data-arena-notice] button")?.click()`);
    const error = humanAsked(s)
      ? await page.eval<string | null>(`${BOARD}.act(${JSON.stringify(humanPick(s))}, ${s.game.revision}, crypto.randomUUID()).then((r) => r.error)`)
      : await page.eval<string | null>(`${BOARD}.advance().then((r) => r.error)`);
    if (error) {
      assert(++refusals < 8, `Eight consecutive refused moves: ${error}`);
      await sleep(200);
    } else refusals = 0;
  }
  throw new Error("Match did not end within ten minutes");
}

try {
  // This intentionally prevents network access; it never routes around the environment proxy.
  // Unlike page-only CDP emulation, Chrome's proxy applies to service-worker fetches as well.
  browser = await Browser.launch({ userDataDir: profile, args: [
    "--proxy-server=http://127.0.0.1:9", "--proxy-bypass-list=<-loopback>",
    "--disable-quic", "--disable-background-networking",
  ] });
  watchdog = setTimeout(() => {
    report.error = "Overall timeout (90 minutes)";
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    void browser?.kill().finally(() => process.exit(1));
  }, 90 * 60_000);
  browser.on((method, params) => {
    if (method === "Network.requestServedFromCache") memoryCached.add(params.requestId);
    if (method === "Network.responseReceived") {
      const r = params.response;
      if (/^https?:/.test(r.url)) responses.push({ url: r.url, status: r.status, fromServiceWorker: !!r.fromServiceWorker, fromDiskCache: !!r.fromDiskCache || memoryCached.has(params.requestId) });
    }
  });
  const page = await browser.page({ name: "phone", width: 390, height: 844, mobile: true });
  taps = new WorkerTaps(browser, base.origin);
  await taps.guard(page);
  await page.setOffline(true);
  await page.goto(shell);
  await until(page, `document.querySelectorAll('[data-device-deck]').length >= 4`, 60_000);
  await until(page, `document.querySelector('[data-offline-status]')?.dataset.offlineStatus === 'ready'`, 60_000);
  assert.equal(await page.eval("navigator.onLine"), false);
  assert(await page.eval("!!navigator.serviceWorker.controller"), "Cold shell must be service-worker controlled");
  const decks = await page.eval<Array<{ key: string; text: string }>>(`[...document.querySelectorAll('[data-device-deck]')].map((d) => ({ key: d.dataset.deviceDeck, text: d.innerText }))`);
  for (const key of keys) assert(decks.some((d) => d.key === key && /your deck/.test(d.text)), `${key} must already be downloaded as your deck`);
  report.decks = decks;
  report.preparation = await page.eval(`document.querySelector('[data-offline-status]')?.innerText`);
  await screenshot(page, "prepared-offline.png");

  // An uncached URL is challenged from BOTH contexts. A service worker may serve the cached shell
  // while secretly using the network, so a rejected page fetch alone cannot establish isolation.
  const probe = `${base.origin}/__offline_proof_${crypto.randomUUID()}`;
  const expression = `fetch(${JSON.stringify(probe)}, { cache: "no-store" }).then(() => false, () => true)`;
  assert.equal(await page.eval(expression), true, "Uncached page fetch must reject");
  const sw = (await browser.targets()).find((t) => t.type === "service_worker" && t.url.startsWith(`${base.origin}/sw.js`));
  assert(sw, "Prepared service-worker target missing");
  const { sessionId } = await browser.send<{ sessionId: string }>("Target.attachToTarget", { targetId: sw.targetId, flatten: true });
  await browser.send("Network.enable", {}, sessionId);
  const challenge = await browser.send<{ result: { value?: boolean }; exceptionDetails?: unknown }>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  assert(!challenge.exceptionDetails && challenge.result.value === true, "Uncached service-worker fetch must reject through the browser proxy");
  report.offlineChallenges = { navigatorOnline: false, pageRejected: true, serviceWorkerRejected: true, serviceWorker: sw.url };

  const matrix = keys.flatMap((mine, i) => ["A", keys[1 - i]].flatMap((theirs) => (["First", "Second"] as const).map((seat) => ({ mine, theirs, seat }))));
  for (const [index, test] of matrix.entries()) {
    await page.goto(shell);
    await until(page, `[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Start match' && !b.disabled)`);
    await page.eval(`(() => {
      const [a,b] = document.querySelectorAll('section[aria-label="New match"] select');
      const set = (s,v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,v); s.dispatchEvent(new Event('change',{bubbles:true})); };
      set(a,${JSON.stringify(test.mine)}); set(b,${JSON.stringify(test.theirs)});
    })()`);
    assert(await clickText(page, test.seat), "Seat button missing");
    await sleep(200);
    assert(await clickText(page, "Start match"), "Start match missing");
    await until(page, `!!(${BOARD})?.supervisor.snapshot`, 120_000);
    const initial = await view(page);
    assert(initial?.snapshot);
    const human = test.seat === "First" ? "p1" : "p2";
    assert.equal(initial.snapshot.game.you, human);
    const final = await playToEnd(page);
    assert(final.snapshot.over, "Finished match must have an explicit outcome");
    assert.equal(final.snapshot.over.kind, "win", "Proof requires a played win, not interruption/concession/draw fallback");
    const journal = await page.eval<{ header: { status: string; decks: { p1: string; p2: string }; human: string; revision: number; decisions: number; trace: string } }>(readJournalExpr(final.matchId));
    assert(journal, "Finished match must be saved on device");
    assert.equal(journal.header.status, "over");
    assert(journal.header.decisions > 0, "Finished match must contain committed decisions");
    assert.equal(journal.header.human, human);
    assert.equal(journal.header.decks[human], test.mine);
    assert.equal(journal.header.decks[human === "p1" ? "p2" : "p1"], test.theirs);
    assert.equal(journal.header.revision, final.snapshot.game.revision);
    await clickText(page, "Skip");
    await until(page, `!!document.querySelector('.arena-end[role="dialog"]')`, 30_000);
    const endTitle = await page.eval<string>(`document.querySelector('.arena-end-title')?.textContent`);
    assert.equal(endTitle, final.snapshot.over.winner === human ? "VICTORY" : "DEFEAT");
    const filename = `match-${index + 1}-${test.mine}-${test.theirs}-${test.seat.toLowerCase()}.png`;
    await screenshot(page, filename);
    (report.matches as unknown[]).push({ ...test, matchId: final.matchId, header: journal.header, outcome: final.snapshot.over, endTitle, packFacts: final.packFacts, screenshot: filename });
    fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    console.log(`${index + 1}/8 ${test.mine} vs ${test.theirs}, ${test.seat}: over at revision ${final.snapshot.game.revision}`);
  }
  assert.equal(await page.eval("navigator.onLine"), false);
  const matchRequests = taps.denied.filter((r) => {
    const u = new URL(r.url);
    return !(u.origin === base.origin && u.pathname === "/api/arena/offline/decks" && r.method === "GET");
  });
  assert.equal(matchRequests.length, 0, "Match/provider requests were attempted while offline");
  assert.equal(taps.art.length, 0, "Card art requested a CDN instead of stored art");
  assert(!responses.some((r) => r.status >= 200 && r.status < 400 && !r.fromServiceWorker && !r.fromDiskCache), "A successful uncached network response escaped isolation");
  report.success = true;
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  if (watchdog) clearTimeout(watchdog);
  await browser?.close().catch(() => {});
  report.finishedAt = new Date().toISOString();
  report.responses = responses;
  report.blockedRequests = taps?.denied ?? [];
  report.artNetworkRequests = taps?.art ?? [];
  fs.writeFileSync(path.join(output, "report.json"), JSON.stringify(report, null, 2));
}
console.log(`${report.productionOrigin ? "Production" : "Local fixture"} offline proof ${report.success ? "passed" : "incomplete"}: ${path.join(output, "report.json")}`);
