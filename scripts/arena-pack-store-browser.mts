#!/usr/bin/env node
/**
 * #658: the offline pack store in Chrome — the browser half of `scripts/verify/arena-pack-store.mts`
 * (whose Node half runs on a fake IndexedDB with a PNG decoder of its own).
 *
 *   npm run arena:pack-store-browser -- [--json] [--total-timeout S]
 *
 * Headless Chrome (`scripts/lib/cdp.mts`), the repo's TypeScript served as ES modules
 * (`scripts/lib/module-server.mts`), and a second, cross-origin server for the pack and its art
 * (`serveArt` in `arena-pack-store-fixture.mts`: a distinct PNG per art URL of the real SD15/SD5
 * pack). Nothing is injected into the store: Chrome's IndexedDB, fetch, crypto.subtle and
 * createImageBitmap (`scripts/verify/arena-pack-store-page.ts`).
 *
 *   1. A good install: every image fetched with CORS, SHA-256'd and decoded by Chrome; ready, active.
 *   2. An image that is `image/png` but not a PNG: Chrome's decoder refuses it; never ready.
 *   3. Art without CORS: a no-cors fetch is a real opaque response — refused as `opaque`, although
 *      `Cache.put` of that very response succeeds; the default cors fetch is refused by the browser.
 *   4. After a page reload, with the art server closed and `fetch` refused: the pack loads, every
 *      image is read from IndexedDB, re-checksummed and decoded by Chrome, and one is shown as an
 *      <img> from a blob: URL. No request reached either server.
 *
 * Needs Chrome; not part of `npm test`. Exit 0 ok, 1 a check failed, 2 usage/no Chrome.
 */
import { Browser, findChrome } from "./lib/cdp.mts";
import { serveRepoModules } from "./lib/module-server.mts";
import { auditPack } from "./verify/arena-local-worker-fixture.mts";
import { artName, serveArt } from "./verify/arena-pack-store-fixture.mts";
import { requiredArt } from "../src/lib/arena/local/pack-store.ts";
import { canonicalJson } from "../src/lib/arena/replay-core.ts";

function usage(message: string): never {
  console.error(`arena:pack-store-browser: ${message}`);
  console.error("Usage: npm run arena:pack-store-browser -- [--json] [--total-timeout S]");
  process.exit(2);
}
const argv = process.argv.slice(2);
for (const a of argv) if (a.startsWith("--") && a !== "--json" && a !== "--total-timeout") usage(`unknown flag ${a}`);
const timeoutAt = argv.indexOf("--total-timeout");
const TOTAL_MS = (timeoutAt >= 0 ? Number(argv[timeoutAt + 1]) : 300) * 1000;
if (!Number.isFinite(TOTAL_MS) || TOTAL_MS <= 0) usage("--total-timeout must be a positive number of seconds");
const JSON_OUT = argv.includes("--json");
try { findChrome(); } catch (error) { console.error(`arena:pack-store-browser: ${(error as Error).message}`); process.exit(2); }

const PAGE = `<!doctype html><meta charset="utf-8"><title>arena pack store</title>
<script type="module">
  import * as P from "/scripts/verify/arena-pack-store-page.ts";
  globalThis.__P = P;
  globalThis.__ready = true;
</script>`;

const failures: string[] = [];
const notes: string[] = [];
const check = (ok: unknown, what: string) => { if (ok) notes.push(`ok   ${what}`); else { failures.push(what); notes.push(`FAIL ${what}`); } };

const pack = await auditPack();
const required = requiredArt(pack);
const modules = await serveRepoModules(process.cwd(), PAGE);
const art = await serveArt(pack, canonicalJson(pack));
const browser = await Browser.launch();
const watchdog = setTimeout(async () => {
  console.error(`FAIL arena:pack-store-browser: overall timeout of ${TOTAL_MS / 1000} s exceeded; stopping Chrome`);
  await browser.close();
  modules.close();
  await art.close();
  process.exit(1);
}, TOTAL_MS);

type Page = Awaited<ReturnType<Browser["page"]>>;
async function inPage<T>(page: Page, expr: string): Promise<T> {
  const key = `__p${Math.random().toString(36).slice(2)}`;
  await page.eval(`globalThis.${key} = null; (async () => { try { globalThis.${key} = { ok: true, v: await (${expr}) }; } catch (e) { globalThis.${key} = { ok: false, e: String(e && e.stack || e) }; } })(); 0`);
  for (;;) {
    const r = await page.eval<{ ok: boolean; v?: T; e?: string } | null>(`globalThis.${key}`);
    if (r) { if (!r.ok) throw new Error(r.e); return r.v as T; }
    await new Promise((res) => setTimeout(res, 150));
  }
}
async function load(page: Page) {
  await page.goto(`${modules.origin}/`, 60000);
  for (let i = 0; i < 200 && !(await page.eval<boolean>("!!globalThis.__ready")); i++) await new Promise((r) => setTimeout(r, 100));
}
const call = <T,>(page: Page, fn: string, ...args: unknown[]) => inPage<T>(page, `globalThis.__P.${fn}(${args.map((a) => JSON.stringify(a)).join(", ")})`);

const report: Record<string, unknown> = {};
try {
  const page = await browser.page({ name: "desk", width: 1280, height: 800, mobile: false });
  await load(page);
  report.userAgent = await page.eval<string>("navigator.userAgent");

  const good = await call<{ status: string; active: boolean; artVerified: number; artRequired: number; hash: string; phases: string[] }>(page, "installGood", "good", art.origin);
  report.good = good;
  check(good.status === "ready" && good.active && good.hash === pack.hash, "1. the pack installs, ready and active, on Chrome's IndexedDB");
  check(good.artVerified === required.length && good.artRequired === required.length, `1. all ${required.length} images were fetched with CORS, SHA-256'd and decoded by createImageBitmap`);
  check(good.phases.join(",") === "pack,art,verify,activate,done", `1. progress phases ${good.phases.join(" → ")}`);
  const artFetched = art.requests.filter((r) => r.startsWith("/art/")).length;
  check(artFetched === required.length, `1. ${artFetched} art requests reached the server`);

  const bad = await call<{ refused: string; statuses: string[]; active: boolean }>(page, "installBadImage", "bad", art.origin);
  report.bad = bad;
  check(bad.refused.startsWith("decode: art ") && !bad.active && bad.statuses.length === 1 && bad.statuses.every((s) => s === "staged"), `2. an image/png that is not a PNG is refused by Chrome's decoder (${bad.refused.slice(0, 120)}); never ready`);

  const opq = await call<{ refused: string; probeType: string; cachePut: string; corsRefused: string; statuses: string[]; active: boolean }>(page, "installOpaque", "opaque", art.origin, artName(required[0]));
  report.opaque = opq;
  check(opq.probeType === "opaque" && opq.cachePut === "ok", "3. the no-cors response is opaque and Cache.put accepts it");
  check(opq.refused.startsWith("opaque: art ") && !opq.active && opq.statuses.length === 2 && opq.statuses.every((s) => s === "staged"), `3. the store refuses it as opaque (${opq.refused.slice(0, 120)}); never ready`);
  check(opq.corsRefused.startsWith("network: art "), `3. the default cors fetch of art without CORS is refused by the browser (${opq.corsRefused.slice(0, 100)})`);

  // 4. Offline: reload, close the art server, refuse fetch.
  await load(page);
  await art.close();
  const before = art.requests.length;
  const modulesBefore = modules.requests.length;
  const off = await call<{ packHash: string; images: number; decoded: number; sizes: string[]; shown: { src: string; width: number }; fetchCalls: string[] }>(page, "offline", "good", art.origin, pack.hash);
  report.offline = off;
  check(off.packHash === pack.hash && off.images === required.length && off.decoded === required.length, `4. offline after a reload: the pack loads and all ${off.decoded} images are read from IndexedDB, re-checksummed and decoded (${off.sizes.join(", ")})`);
  check(off.shown.src === "blob:" && off.shown.width > 0, "4. an image shows as an <img> from a blob: URL of the stored bytes");
  check(off.fetchCalls.length === 0 && art.requests.length === before && modules.requests.length === modulesBefore, "4. no fetch was made and no request reached either server");
  const list = await call<{ hash: string; status: string; active: boolean }[]>(page, "listAll", "good", art.origin);
  check(list.length === 1 && list[0].status === "ready" && list[0].active, "4. the installation survived the reload");
} catch (e) {
  failures.push(`crashed: ${(e as Error).stack ?? e}`);
} finally {
  clearTimeout(watchdog);
  await browser.close();
  modules.close();
  await art.close().catch(() => {});
}

if (JSON_OUT) console.log(JSON.stringify({ ok: failures.length === 0, notes, failures, report }, null, 2));
else {
  for (const n of notes) console.log(n);
  for (const f of failures.filter((f) => f.startsWith("crashed"))) console.log(`FAIL ${f}`);
  console.log(failures.length ? `arena:pack-store-browser: ${failures.length} check(s) failed` : `arena:pack-store-browser: ${notes.length} checks passed (${report.userAgent})`);
}
process.exit(failures.length ? 1 : 0);
