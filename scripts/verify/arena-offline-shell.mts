/**
 * #659: the offline shell's service worker, run in Node against a fake Cache Storage and fetch —
 * the routing, the install/activate rules and what may enter a shell cache. The browser half (cold
 * launch with the network gone, real Chrome caches) is `npm run arena:offline-shell-browser`.
 *
 *   1. `public/sw.js` and `src/lib/arena/local/shell.ts` agree (names, paths, `isShellAsset`).
 *   2. A good install precaches exactly the shell page and the manifest's files, every one fetched
 *      with `credentials: "omit"`, writes the meta record last, and never calls `skipWaiting`.
 *   3. A failed install (a file 500s, the page redirects to the sign-in, the list names a private
 *      path, the list is another version) deletes only its own partial cache; the previous shell is
 *      untouched and still served.
 *   4. Online routing: signed-in pages, API bodies, RSC payloads, redirects, POSTs and the shell list
 *      itself pass through and never enter any cache.
 *   5. Offline routing: the shell page and its files come from the cache (query strings such as
 *      `?dpl=` ignored), `/` and `/arena*` redirect to the shell, any other page gets the notice.
 *   6. Activation keeps the current and the newest previous complete shell, drops older and partial
 *      shells and old art caches, keeps the pack store's caches, and never calls `clients.claim`;
 *      `?shell=<version>` opens the kept previous shell.
 *   7. A worker registered without a version installs no shell and deletes none.
 *   8. The proxy exempts exactly `/arena/offline` and `/arena/offline/shell.json`.
 *   9. `shellManifestProblems` and `shellRefusal`.
 *
 * Pure: no browser, no network, no database.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { CACHE_PREFIXES } from "../../src/lib/arena/local/pack-store.ts";
import { SHELL_CACHE_PREFIX, SHELL_FORMAT, SHELL_KEEP, SHELL_MANIFEST_PATH, SHELL_META_PATH, SHELL_PATH, isShellAsset, shellManifestProblems, shellRefusal } from "../../src/lib/arena/local/shell.ts";
import { config as proxyConfig } from "../../src/proxy.ts";

const ORIGIN = "https://cards.test";
const SOURCE = fs.readFileSync("public/sw.js", "utf8");
const REV = "a659000000000000000000000000000000000659";

// ── fakes ────────────────────────────────────────────────────────────────────────────────────────

type Stored = { body: ArrayBuffer; status: number; headers: [string, string][] };
const abs = (u: string) => new URL(u, ORIGIN).href;
const keyOf = (req: unknown) => abs(typeof req === "string" ? req : (req as { url: string }).url);

class FakeCache {
  entries = new Map<string, Stored>();
  async put(req: unknown, res: Response) {
    this.entries.set(keyOf(req), { body: await res.arrayBuffer(), status: res.status, headers: [...res.headers] });
  }
  async match(req: unknown, opts?: { ignoreSearch?: boolean }) {
    let k = keyOf(req);
    if (opts?.ignoreSearch) k = k.split("?")[0];
    const hit = this.entries.get(k);
    if (!hit) return undefined;
    // Like Cache Storage: the stored response keeps the URL it was put under (without a query or fragment).
    const r = basic(new Response(hit.body.slice(0), { status: hit.status, headers: hit.headers }));
    Object.defineProperty(r, "url", { value: k });
    return r;
  }
  paths() { return [...this.entries.keys()].map((k) => k.slice(ORIGIN.length)).sort(); }
}
class FakeCaches {
  map = new Map<string, FakeCache>();
  async open(n: string) { if (!this.map.has(n)) this.map.set(n, new FakeCache()); return this.map.get(n)!; }
  async has(n: string) { return this.map.has(n); }
  async delete(n: string) { return this.map.delete(n); }
  async keys() { return [...this.map.keys()]; }
}
function basic(r: Response, redirected = false): Response {
  Object.defineProperty(r, "type", { value: "basic" });
  Object.defineProperty(r, "redirected", { value: redirected });
  return r;
}

type Route = { status?: number; body?: string; type?: string; redirect?: string };
type Call = { url: string; init: RequestInit | undefined };

function makeWorker(version: string | null, caches: FakeCaches, routes: () => Record<string, Route>, online: () => boolean) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const calls: Call[] = [];
  const spies = { skipWaiting: 0, claim: 0 };
  const fetch = async (input: unknown, init?: RequestInit) => {
    const url = keyOf(input);
    calls.push({ url: url.slice(ORIGIN.length), init });
    if (!online()) throw new TypeError("Failed to fetch");
    const path = new URL(url).pathname;
    const r = routes()[path] ?? routes()[url.slice(ORIGIN.length)];
    if (!r) return basic(new Response("not found", { status: 404, headers: { "content-type": "text/html" } }));
    if (r.redirect) {
      if (init?.redirect === "error") throw new TypeError("redirect refused");
      return basic(new Response(r.body ?? "", { status: 200, headers: { "content-type": "text/html" } }), true);
    }
    return basic(new Response(r.body ?? `body of ${path}`, { status: r.status ?? 200, headers: { "content-type": r.type ?? "application/javascript" } }));
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js${version ? `?v=${version}` : ""}`),
    addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h; },
    skipWaiting: () => { spies.skipWaiting++; return Promise.resolve(); },
    clients: { claim: () => { spies.claim++; return Promise.resolve(); } },
  };
  const ctx = vm.createContext({ self, caches, fetch, Response, URL, Set, Promise, JSON, Date, Array, Error, TypeError, console });
  vm.runInContext(SOURCE, ctx, { filename: "public/sw.js" });
  const lifecycle = async (t: "install" | "activate") => {
    let p: Promise<unknown> = Promise.resolve();
    handlers[t]({ waitUntil: (x: Promise<unknown>) => { p = x; } });
    await p;
  };
  /** A fetch event: the worker's answer, or `"pass"` when it leaves the request to the browser. */
  const request = async (path: string, o: { mode?: string; method?: string } = {}): Promise<Response | "pass"> => {
    let answer: Promise<Response> | null = null;
    handlers.fetch({ request: { url: abs(path), method: o.method ?? "GET", mode: o.mode ?? "cors" }, respondWith: (x: Promise<Response>) => { answer = x; } });
    return answer ? await answer : "pass";
  };
  return { ctx, calls, spies, lifecycle, request };
}

// ── a build ──────────────────────────────────────────────────────────────────────────────────────

function build(tag: string, version: string) {
  const files = [`/_next/static/chunks/${tag}-a.js`, `/_next/static/chunks/${tag}-b.css`, `/_next/static/media/${tag}-f.woff2`, "/icons/icon-192.png", "/manifest.webmanifest"].sort();
  const manifest = { format: SHELL_FORMAT, version, revision: REV, shell: SHELL_PATH, files };
  const routes: Record<string, Route> = {
    [SHELL_MANIFEST_PATH]: { body: JSON.stringify(manifest), type: "application/json" },
    [SHELL_PATH]: { body: `<!doctype html><title>shell ${tag}</title>`, type: "text/html; charset=utf-8" },
    // The online app: every one of these must stay out of every cache.
    "/collection": { body: "<html>owner's collection</html>", type: "text/html" },
    "/decks/1": { body: "<html>a deck</html>", type: "text/html" },
    "/settings": { body: "<html>settings</html>", type: "text/html" },
    "/arena": { body: "<html>arena</html>", type: "text/html" },
    "/api/cards": { body: '{"secret":"lots"}', type: "application/json" },
    "/me": { redirect: "/login" },
  };
  for (const f of files) routes[f] = { body: `${tag} ${f}` };
  return { manifest, routes, files };
}

// Install times in order of installation, whatever the clock does.
let clock = 1000;
Date.now = () => (clock += 1000);

const V1 = "1111111111111111";
const V2 = "2222222222222222";
const V3 = "3333333333333333";
const V4 = "4444444444444444";
const failures: string[] = [];
const notes: string[] = [];
async function check(what: string, fn: () => Promise<unknown> | void) {
  try { await fn(); notes.push(`ok   ${what}`); } catch (e) { failures.push(what); notes.push(`FAIL ${what}: ${(e as Error).message}`); }
}
const text = async (r: Response | "pass") => (r === "pass" ? "pass" : await r.text());

// 1. constants
await check("1. sw.js and shell.ts agree on names, paths and isShellAsset", () => {
  const w = makeWorker(V1, new FakeCaches(), () => ({}), () => true);
  const v = (e: string) => vm.runInContext(e, w.ctx);
  assert.equal(SHELL_CACHE_PREFIX, CACHE_PREFIXES.shell);
  assert.equal(v("SHELL_PREFIX"), SHELL_CACHE_PREFIX);
  assert.equal(v("ART_PREFIX"), CACHE_PREFIXES.cardArt);
  assert.equal(v("SHELL_PATH"), SHELL_PATH);
  assert.equal(v("SHELL_MANIFEST"), SHELL_MANIFEST_PATH);
  assert.equal(v("SHELL_META"), SHELL_META_PATH);
  assert.equal(v("SHELL_FORMAT"), SHELL_FORMAT);
  assert.equal(v("SHELL_KEEP"), SHELL_KEEP);
  for (const p of ["/_next/static/chunks/a.js", "/_next/static/media/x.woff2", "/icons/icon-192.png", "/manifest.webmanifest", "/arena/offline", "/collection", "/api/cards", "/_next/static/a.js?x=1", "/_next/static/../api", "/icons/a/b.png", "/_next/image", "/sw.js", "//evil/_next/static/a.js", "/login"]) {
    assert.equal(v(`isShellAsset(${JSON.stringify(p)})`), isShellAsset(p), p);
  }
  assert.equal(isShellAsset("/collection") || isShellAsset("/api/cards") || isShellAsset("/arena/offline") || isShellAsset("/_next/image"), false);
});

// 2. a good install
const caches = new FakeCaches();
const b1 = build("one", V1);
let online = true;
const w1 = makeWorker(V1, caches, () => b1.routes, () => online);
await check("2. a good install precaches exactly the shell page and the listed files, credential-less, meta last, no skipWaiting", async () => {
  await w1.lifecycle("install");
  const cache = caches.map.get(SHELL_CACHE_PREFIX + V1)!;
  assert.deepEqual(cache.paths(), [SHELL_META_PATH, SHELL_PATH, ...b1.files].sort());
  assert.equal(w1.calls.length, 1 + 1 + b1.files.length);
  for (const c of w1.calls) {
    assert.equal(c.init?.credentials, "omit", `${c.url} fetched without credentials`);
    assert.equal(c.init?.redirect, "error", `${c.url} refuses redirects`);
  }
  const meta = await (await cache.match(SHELL_META_PATH))!.json();
  assert.equal(meta.version, V1);
  assert.equal(meta.revision, REV);
  assert.equal(meta.files, b1.files.length);
  assert.equal(w1.spies.skipWaiting, 0, "install never calls skipWaiting");
});
await check("2. activation never calls clients.claim", async () => {
  await w1.lifecycle("activate");
  assert.equal(w1.spies.claim, 0);
});

// 4. online routing leaves the online app alone
await check("4. signed-in pages, API bodies, RSC, redirects, POSTs and shell.json pass through and enter no cache", async () => {
  const before = JSON.stringify([...caches.map].map(([n, c]) => [n, c.paths()]));
  for (const p of ["/collection", "/decks/1", "/settings", "/me", "/arena"]) {
    const r = await w1.request(p, { mode: "navigate" });
    assert.notEqual(r, "pass");
    assert.match(await text(r), p === "/me" ? /^$/ : /<html>/, `${p} answered from the network`);
  }
  for (const [p, o] of [["/api/cards", {}], ["/arena?_rsc=abc", {}], ["/arena/offline?_rsc=abc", {}], [SHELL_MANIFEST_PATH, {}], ["/api/cards", { method: "POST" }], ["/arena", { method: "POST" }]] as const) {
    assert.equal(await w1.request(p, o), "pass", `${p} ${"method" in o ? o.method : "GET"} is left to the browser`);
  }
  assert.equal(JSON.stringify([...caches.map].map(([n, c]) => [n, c.paths()])), before, "no cache changed");
  for (const [n, c] of caches.map) for (const p of c.paths()) assert.ok(p === SHELL_PATH || p === SHELL_META_PATH || isShellAsset(p), `${n} holds ${p}`);
});

// 5. offline routing
await check("5. offline: the shell and its files come from the cache; /, /arena and /arena/* redirect to it; other pages get the notice", async () => {
  online = false;
  assert.match(await text(await w1.request(SHELL_PATH, { mode: "navigate" })), /shell one/);
  assert.match(await text(await w1.request(`${SHELL_PATH}?from=launch`, { mode: "navigate" })), /shell one/);
  assert.equal(await text(await w1.request(b1.files[0])), `one ${b1.files[0]}`);
  assert.equal(await text(await w1.request(`${b1.files[0]}?dpl=dpl_abc`)), `one ${b1.files[0]}`, "?dpl= ignored");
  // A Worker takes its location from the response URL: a cached file must come back without one,
  // or Turbopack's worker bootstrap loses its `#params=` (found by the browser proof).
  const forWorker = await w1.request(`${b1.files[0]}#params=%5B%5D`);
  assert.ok(forWorker !== "pass" && forWorker.url === "", "a static file is answered by a constructed response (no URL)");
  for (const p of ["/", "/arena", "/arena/local", "/arena/42"]) {
    const r = await w1.request(p, { mode: "navigate" });
    assert.ok(r !== "pass" && r.status === 302 && r.headers.get("location") === `${ORIGIN}${SHELL_PATH}`, `${p} → shell`);
  }
  const notice = await w1.request("/collection", { mode: "navigate" });
  assert.ok(notice !== "pass" && notice.status === 503);
  assert.match(await notice.text(), /href="\/arena\/offline"/);
  assert.equal(await w1.request("/api/cards"), "pass", "an API call offline is still the browser's to fail");
  online = true;
});

// 3. failed installs
async function failedInstall(tag: string, version: string, breakIt: (b: ReturnType<typeof build>) => void, expect: RegExp) {
  const b = build(tag, version);
  breakIt(b);
  const w = makeWorker(version, caches, () => b.routes, () => true);
  await assert.rejects(w.lifecycle("install"), expect);
  assert.equal(caches.map.has(SHELL_CACHE_PREFIX + version), false, "the partial cache is deleted");
  assert.deepEqual(caches.map.get(SHELL_CACHE_PREFIX + V1)!.paths(), [SHELL_META_PATH, SHELL_PATH, ...b1.files].sort(), "the previous shell is untouched");
  online = false;
  assert.match(await text(await w1.request(SHELL_PATH, { mode: "navigate" })), /shell one/, "and still served");
  online = true;
  return w;
}
await check("3. a file that fails (500) fails the install; the previous shell stays", () => failedInstall("bad", V2, (b) => { b.routes[b.files[1]] = { status: 500 }; }, /HTTP 500/));
await check("3. a shell page redirected to the sign-in is refused", () => failedInstall("redir", V2, (b) => { b.routes[SHELL_PATH] = { redirect: "/login" }; }, /redirect refused/));
await check("3. a shell page that is not HTML is refused", () => failedInstall("json", V2, (b) => { b.routes[SHELL_PATH] = { body: "{}", type: "application/json" }; }, /not the shell page/));
await check("3. a list naming a private path is refused before any file is fetched", async () => {
  const w = await failedInstall("priv", V2, (b) => { b.manifest.files.push("/collection", "/api/cards"); b.routes[SHELL_MANIFEST_PATH] = { body: JSON.stringify(b.manifest), type: "application/json" }; }, /may not cache/);
  assert.deepEqual(w.calls.map((c) => c.url), [SHELL_MANIFEST_PATH]);
});
await check("3. a list of another version (a deploy in between) is refused", () => failedInstall("race", V2, (b) => { b.manifest.version = V3; b.routes[SHELL_MANIFEST_PATH] = { body: JSON.stringify(b.manifest), type: "application/json" }; }, /describes/));

// 6. updates and retention
await check("6. activation keeps the current and the newest previous shell, drops older and partial ones and old art, keeps pack caches", async () => {
  {
    const b2 = build("two", V2);
    const w2 = makeWorker(V2, caches, () => b2.routes, () => true);
    await w2.lifecycle("install");
    await w2.lifecycle("activate");
    assert.deepEqual((await caches.keys()).filter((n) => n.startsWith(SHELL_CACHE_PREFIX)).sort(), [SHELL_CACHE_PREFIX + V1, SHELL_CACHE_PREFIX + V2]);
    const b3 = build("three", V3);
    const w3 = makeWorker(V3, caches, () => b3.routes, () => true);
    await w3.lifecycle("install");
    // Clutter that activation must sort out: a partial shell, an old art cache, and caches it does not own.
    (await caches.open(SHELL_CACHE_PREFIX + V4)).put(SHELL_PATH, new Response("partial"));
    await caches.open("dbs-card-art-v0");
    await caches.open("dbs-card-art-v1");
    await caches.open(`${CACHE_PREFIXES.packs}x`);
    await caches.open("someone-else");
    await w3.lifecycle("activate");
    assert.deepEqual((await caches.keys()).sort(), [`${CACHE_PREFIXES.packs}x`, "dbs-card-art-v1", SHELL_CACHE_PREFIX + V2, SHELL_CACHE_PREFIX + V3, "someone-else"].sort());
    assert.equal(w2.spies.skipWaiting + w3.spies.skipWaiting + w2.spies.claim + w3.spies.claim, 0);
    online = false;
    assert.match(await text(await w3.request(SHELL_PATH, { mode: "navigate" })), /shell three/);
    assert.match(await text(await w3.request(`${SHELL_PATH}?shell=${V2}`, { mode: "navigate" })), /shell two/, "?shell= opens the kept previous shell");
    assert.equal(await text(await w3.request(b2.files[0])), `two ${b2.files[0]}`, "and its own chunks still load");
    assert.match(await text(await w3.request(`${SHELL_PATH}?shell=${V1}`, { mode: "navigate" })), /shell three/, "a pruned shell falls back to the current one");
    online = true;
  }
});

// 7. no version
await check("7. a worker registered without a version installs no shell and deletes none", async () => {
  const before = (await caches.keys()).sort();
  const w = makeWorker(null, caches, () => b1.routes, () => true);
  await w.lifecycle("install");
  await w.lifecycle("activate");
  assert.equal(w.calls.length, 0);
  assert.deepEqual((await caches.keys()).sort(), before);
});

// 8. proxy
await check("8. the proxy exempts exactly /arena/offline and its shell.json; the rest of the arena keeps the sign-in", () => {
  const matcher = (proxyConfig as unknown as { matcher: [string, ...unknown[]] }).matcher[0];
  const re = new RegExp(`^${matcher}$`);
  for (const p of [SHELL_PATH, SHELL_MANIFEST_PATH, "/sw.js", "/manifest.webmanifest", "/icons/icon-192.png", "/_next/static/chunks/a.js"]) assert.equal(re.test(p), false, `${p} is exempt`);
  for (const p of ["/arena", "/arena/local", "/arena/offline/", "/arena/offline/x", "/arena/offlinex", "/arena/offline/shell.jsonx", "/arena/offline/shell.json/x", "/arena/1", "/collection", "/settings", "/api/cards", "/"]) assert.equal(re.test(p), true, `${p} keeps the sign-in`);
});

// 9. pure helpers
await check("9. shellManifestProblems and shellRefusal", () => {
  assert.deepEqual(shellManifestProblems(b1.manifest), []);
  assert.ok(shellManifestProblems({ ...b1.manifest, files: ["/collection"] }).some((p) => p.includes("/collection")));
  assert.ok(shellManifestProblems({ ...b1.manifest, version: "x" }).length > 0);
  assert.ok(shellManifestProblems({ ...b1.manifest, revision: "main" }).length > 0);
  assert.equal(shellRefusal(REV, REV), null);
  assert.equal(shellRefusal(REV, REV.toUpperCase()), null);
  assert.match(shellRefusal(REV, "b".repeat(40))!, /made for app version bbbbbbb; this is a659000/);
  assert.match(shellRefusal(null, REV)!, /no interpreter revision/);
});

console.log(notes.join("\n"));
if (failures.length) {
  console.error(`arena-offline-shell: ${failures.length} failed`);
  process.exit(1);
}
console.log(`arena-offline-shell: ok — ${notes.length} checks`);
