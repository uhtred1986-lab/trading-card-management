/**
 * Offline reading (docs/pokemon/plan.md §10 item 11): the routing and the privacy rules of
 * `public/sw.js` for the collection, wishes and deck pages, run in Node against a fake Cache Storage
 * and fetch. The browser half (a real Chrome, the network switched off) is described in
 * docs/architecture/collection-and-decks.md, "Offline reading".
 *
 *   1. `readableArea` of the worker and `src/lib/offline-pages.ts` agree, and name exactly the pages
 *      meant: no /settings, /cart, /login, /join, /api, no deck editor or action path.
 *   2. `whoKey`: stable per person, different per person, carries no email.
 *   3. Online, a readable page is answered by the network and kept only when it carries `x-card-who`;
 *      offline the last copy is served (a query falls back to the page's last seen copy); a page never
 *      seen gets the notice (German under /pokemon, English elsewhere), status 503.
 *   4. Another person (a different `who`), a response with no stamp, a 401, and a visit to /login,
 *      /join or /password-login each delete everything kept: the next person never sees the last one's pages.
 *   5. Nothing else is kept: /settings, /cart, /api/*, a POST, a prefetch; card photos and the
 *      optimiser's pictures only while a person's cache exists, and only for that person.
 *   6. Followed links (RSC): kept under the exact request (the `_rsc` hash is Next's hash of its router headers), served offline, never when prefetching; a miss offline
 *      is a network error (Next then does a full page load, which the page copy answers). After a
 *      payload is kept the page's HTML is fetched too, so a page reached only by tapping is openable.
 *   7. A slow or failing network with a copy shows the copy; a 500 with a copy shows the copy; a 404 or
 *      a redirect is the truth.
 *   8. `/?source=pwa`: online it follows the redirect, remembers it for that person and hands the
 *      redirect on; offline the cold launch goes to the arena shell (Dragon Ball) or to the kept
 *      `/pokemon` (Pokémon), to the shell on a device with no memory, and to the notice with nothing.
 *   9. Build files: kept when no shell holds them, served offline, the shell's own copy wins.
 *  10. The worker still never calls skipWaiting or clients.claim, and keeps the art cache name the arena
 *      tests pin. The shell, its caches and its install are tested by `arena-offline-shell.mts`, which
 *      runs unchanged beside this one.
 *
 * Pure: no browser, no network, no database.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { OFFLINE_PAGES_CACHE, readableArea } from "../../src/lib/offline-pages.ts";
import { WHO_HEADER, whoKey } from "../../src/lib/auth/who.ts";

const ORIGIN = "https://cards.test";
const SOURCE = fs.readFileSync("public/sw.js", "utf8");
const abs = (u: string) => new URL(u, ORIGIN).href;
const keyOf = (req: unknown) => abs(typeof req === "string" ? req : (req as { url: string }).url);

type Stored = { body: ArrayBuffer; status: number; headers: [string, string][] };
function basic(r: Response, redirected = false, url = ""): Response {
  Object.defineProperty(r, "type", { value: "basic" });
  Object.defineProperty(r, "redirected", { value: redirected });
  if (url) Object.defineProperty(r, "url", { value: url });
  return r;
}
/** A Response whose clones keep `type`, `redirected` and `url`, as a browser's do. */
class KeepingResponse extends Response {
  clone(): Response {
    const copy = super.clone();
    for (const key of ["type", "redirected", "url"] as const) Object.defineProperty(copy, key, { value: this[key] });
    Object.defineProperty(copy, "clone", { value: KeepingResponse.prototype.clone });
    return copy;
  }
}
class FakeCache {
  entries = new Map<string, Stored>();
  async put(req: unknown, res: Response) {
    this.entries.set(keyOf(req), { body: await res.arrayBuffer(), status: res.status, headers: [...res.headers] });
  }
  async match(req: unknown) {
    const hit = this.entries.get(keyOf(req));
    return hit ? basic(new KeepingResponse(hit.body.slice(0), { status: hit.status, headers: hit.headers })) : undefined;
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(req: unknown) {
    return this.entries.delete(keyOf(req));
  }
  paths() {
    return [...this.entries.keys()].map((k) => k.slice(ORIGIN.length)).sort();
  }
}
class FakeCaches {
  map = new Map<string, FakeCache>();
  async open(n: string) {
    if (!this.map.has(n)) this.map.set(n, new FakeCache());
    return this.map.get(n)!;
  }
  async has(n: string) {
    return this.map.has(n);
  }
  async delete(n: string) {
    return this.map.delete(n);
  }
  async keys() {
    return [...this.map.keys()];
  }
}

type Route = { status?: number; body?: string; type?: string; who?: string | null; hang?: boolean };
const sendsTo = (path: string): Route => ({ body: `<!DOCTYPE html><html><head><meta id="__next-page-redirect" http-equiv="refresh" content="1;url=${path}"/></head><body>loading</body></html>` });
const SHELL_PATH = "/arena/offline";

function world() {
  const caches = new FakeCaches();
  const state = { online: true, report: undefined as boolean | undefined, who: "alice" as string | null, routes: {} as Record<string, Route>, hits: [] as string[], timers: [] as { fn: () => void; ms: number }[] };
  const handlers: Record<string, (e: unknown) => void> = {};
  const fetch = async (input: unknown) => {
    const url = keyOf(input);
    const path = url.slice(ORIGIN.length);
    state.hits.push(path);
    if (!state.online) throw new TypeError("Failed to fetch");
    const route = state.routes[path] ?? state.routes[path.split("?")[0]];
    if (route?.hang) return new Promise<Response>(() => {});
    if (!route) return basic(new KeepingResponse("not found", { status: 404, headers: { "content-type": "text/html" } }));
    const who = route.who === undefined ? state.who : route.who;
    const headers: Record<string, string> = { "content-type": route.type ?? "text/html; charset=utf-8" };
    if (who) headers[WHO_HEADER] = who;
    return basic(new KeepingResponse(route.body ?? `body of ${path}`, { status: route.status ?? 200, headers }));
  };
  const self = {
    location: new URL(`${ORIGIN}/sw.js`),
    addEventListener: (t: string, h: (e: unknown) => void) => {
      handlers[t] = h;
    },
  };
  const navigator = {
    get onLine() {
      return state.report ?? state.online;
    },
  };
  const fakeTimeout = (fn: () => void, ms: number) => {
    state.timers.push({ fn, ms });
    return state.timers.length;
  };
  const ctx = vm.createContext({ self, navigator, caches, fetch, Response: KeepingResponse, URL, Set, Promise, JSON, Date, Array, Error, TypeError, Number, TextDecoder, console, setTimeout: fakeTimeout, clearTimeout: () => {} });
  vm.runInContext(SOURCE, ctx, { filename: "public/sw.js" });
  const v = (e: string) => vm.runInContext(e, ctx);
  /** A fetch event: the worker's answer, or "pass"; everything the worker scheduled with waitUntil has finished. */
  const request = async (path: string, o: { mode?: string; method?: string; headers?: Record<string, string> } = {}): Promise<Response | "pass"> => {
    let answer: Promise<Response> | null = null;
    const pending: Promise<unknown>[] = [];
    handlers.fetch({
      request: { url: abs(path), method: o.method ?? "GET", mode: o.mode ?? "cors", headers: new Headers(o.headers ?? {}) },
      respondWith: (x: Promise<Response>) => {
        answer = x;
      },
      waitUntil: (x: Promise<unknown>) => pending.push(x),
    });
    if (!answer) return "pass";
    const out = await (answer as Promise<Response>);
    // What the worker handed to waitUntil has finished (a request that never answers is given up on).
    await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 40))]);
    return out;
  };
  const pages = () => caches.map.get("dbs-offline-pages-v1");
  return { caches, state, request, v, pages };
}
const text = async (r: Response | "pass") => (r === "pass" ? "pass" : await r.text());
const nav = { mode: "navigate" };

const failures: string[] = [];
const notes: string[] = [];
async function check(what: string, fn: () => Promise<unknown> | void) {
  try {
    await fn();
    notes.push(`ok   ${what}`);
  } catch (e) {
    failures.push(what);
    notes.push(`FAIL ${what}: ${(e as Error).message}`);
  }
}

await check("1. the worker's readableArea equals src/lib/offline-pages.ts and names exactly the intended pages", () => {
  const w = world();
  const paths = [
    "/pokemon", "/pokemon/wishes", "/pokemon/decks", "/pokemon/decks/12", "/pokemon/decks/abc", "/collection", "/decks", "/decks/7",
    "/pokemon/decks/new", "/pokemon/add", "/pokemon/discover", "/pokemon/add/photo", "/decks/new", "/decks/preview", "/decks/7/edit", "/decks/x", "/pokemon/decks/1/x",
    "/collection/archived", "/cards/BT1-001", "/settings", "/settings/access", "/cart", "/login", "/join", "/password-login", "/api/cards", "/api/card-photo/3", "/arena", "/arena/offline", "/", "/me",
  ];
  for (const p of paths) assert.equal(w.v(`readableArea(${JSON.stringify(p)})`), readableArea(p), p);
  assert.equal(w.v("PAGES_CACHE"), OFFLINE_PAGES_CACHE, "the page side deletes the cache the worker keeps");
  assert.equal(JSON.stringify(w.v("SIGN_IN_PATHS")), JSON.stringify(["/login", "/join", "/password-login"]));
  assert.match(fs.readFileSync("src/components/ServiceWorker.tsx", "utf8"), /\["\/login", "\/join", "\/password-login"\]/, "ServiceWorker.tsx lists the same sign-in pages");
  const kept = paths.filter((p) => readableArea(p));
  assert.deepEqual(kept, ["/pokemon", "/pokemon/wishes", "/pokemon/decks", "/pokemon/decks/12", "/pokemon/decks/abc", "/collection", "/decks", "/decks/7"]);
  assert.equal(readableArea("/pokemon/wishes"), "pokemon");
  assert.equal(readableArea("/decks/7"), "dbs");
});

await check("2. whoKey is stable and per person, and holds no email", async () => {
  const a = await whoKey({ kind: "sl", email: "Owner@Example.com" }, "secret");
  assert.equal(a, await whoKey({ kind: "sl", email: "owner@example.com" }, "secret"));
  assert.notEqual(a, await whoKey({ kind: "sl", email: "other@example.com" }, "secret"));
  assert.notEqual(a, await whoKey({ kind: "sl", email: "owner@example.com" }, "another secret"));
  assert.notEqual(await whoKey({ kind: "player", playerId: 1 }, "secret"), await whoKey({ kind: "player", playerId: 2 }, "secret"));
  assert.notEqual(await whoKey({ kind: "open" }, undefined), await whoKey({ kind: "basic", header: "Basic x" }, undefined));
  assert.match(a, /^[0-9a-f]{24}$/);
  assert.ok(!a.includes("owner"));
});

await check("3. online pages are kept (with a stamp); offline the copy is served; a page never seen gets the notice", async () => {
  const w = world();
  w.state.routes = { "/collection": { body: "<html>alice collection</html>" }, "/pokemon": { body: "<html>alice pokemon</html>" }, "/collection?game=dbs": { body: "<html>filtered</html>" } };
  assert.equal(await text(await w.request("/collection", nav)), "<html>alice collection</html>");
  assert.equal(await text(await w.request("/collection?game=dbs", nav)), "<html>filtered</html>");
  await w.request("/pokemon", nav);
  assert.deepEqual(w.pages()!.paths(), ["/__dbs-offline/last/collection", "/__dbs-offline/who", "/collection", "/collection?game=dbs", "/pokemon"]);
  w.state.online = false;
  assert.equal(await text(await w.request("/collection", nav)), "<html>alice collection</html>");
  assert.equal(await text(await w.request("/collection?game=dbs", nav)), "<html>filtered</html>");
  assert.equal(await text(await w.request("/collection?game=fusion", nav)), "<html>filtered</html>", "a query never seen falls back to the page's last seen copy");
  const german = (await w.request("/pokemon/wishes", nav)) as Response;
  assert.equal(german.status, 503);
  assert.match(await german.text(), /Kein Internet/);
  const english = (await w.request("/decks/9", nav)) as Response;
  assert.equal(english.status, 503);
  assert.match(await english.text(), /No connection/);
  assert.equal(w.state.hits.filter((h) => h === "/pokemon/wishes").length, 0, "offline the network is not even asked");
  // The other Pokémon pages (adding, searching) need the server: German notice offline, the network otherwise, nothing kept.
  const needs = (await w.request("/pokemon/discover", nav)) as Response;
  assert.equal(needs.status, 503);
  assert.match(await needs.text(), /Das geht nur mit Internet/);
  w.state.online = true;
  w.state.routes["/pokemon/discover"] = { body: "<html>discover</html>" };
  assert.equal(await text(await w.request("/pokemon/discover", nav)), "<html>discover</html>");
  assert.ok(!w.pages()!.paths().includes("/pokemon/discover"), "a page that is not on the list is never kept");
  w.state.online = false;
  // The browser says online but nothing answers (a bar of signal, no data): a page never seen gets the same notice, with a retry link.
  w.state.report = true;
  const unreachable = (await w.request("/pokemon/wishes", nav)) as Response;
  assert.equal(unreachable.status, 503);
  const html = await unreachable.text();
  assert.match(html, /Kein Internet/);
  assert.match(html, /href="\/pokemon\/wishes"/, "a retry link");
  assert.equal(w.state.hits.filter((h) => h === "/pokemon/wishes").length, 2, "asked twice, then the notice");
  w.state.report = undefined;
});

await check("4. another person, no stamp, a 401 and a sign-in page each delete what was kept", async () => {
  const fresh = async () => {
    const w = world();
    w.state.routes = { "/collection": { body: "<html>alice</html>" }, "/pokemon": { body: "<html>alice pokemon</html>" }, "/login": { body: "login" }, "/join": { body: "join" }, "/password-login": { body: "pw" } };
    await w.request("/collection", nav);
    await w.request("/pokemon", nav);
    assert.ok(w.pages()!.paths().includes("/collection"));
    return w;
  };
  {
    const w = await fresh();
    w.state.who = "bob";
    await w.request("/pokemon", nav);
    assert.deepEqual(w.pages()!.paths(), ["/__dbs-offline/who", "/pokemon"], "alice's collection is gone, bob's page is kept");
    w.state.online = false;
    assert.match(await text(await w.request("/pokemon", nav)), /alice pokemon/, "the copy is the one made for the current person");
    assert.equal(((await w.request("/collection", nav)) as Response).status, 503, "and alice's other page is not served to bob");
  }
  {
    const w = await fresh();
    w.state.routes["/pokemon"] = { body: "<html>unstamped</html>", who: null };
    await w.request("/pokemon", nav);
    assert.equal(w.pages(), undefined, "a page with no stamp empties the cache and is not kept");
  }
  {
    const w = await fresh();
    w.state.routes["/collection"] = { status: 401, body: "Sign-in required" };
    await w.request("/collection", nav);
    assert.equal(w.pages(), undefined);
  }
  for (const p of ["/login", "/join", "/password-login"]) {
    const w = await fresh();
    await w.request(p, nav);
    assert.equal(w.pages(), undefined, `${p} (navigation) forgets`);
    const w2 = await fresh();
    assert.notEqual(await w2.request(`${p}?_rsc=x`, { headers: { rsc: "1" } }), "pass");
    assert.equal(w2.pages(), undefined, `${p} (followed link) forgets`);
  }
  {
    const w = await fresh();
    w.state.online = false;
    await w.request("/login", nav);
    assert.equal(w.pages(), undefined, "even with no network");
  }
});

await check("5. nothing else is kept: settings, cart, other APIs, POSTs; photos and pictures only for the person", async () => {
  const w = world();
  w.state.routes = {
    "/collection": {},
    "/settings": { body: "<html>settings</html>" },
    "/cart": { body: "<html>cart</html>" },
    "/api/cards": { body: "{}", type: "application/json" },
    "/api/card-photo/7": { body: "jpeg", type: "image/jpeg" },
    "/_next/image?url=a&w=256&q=75": { body: "webp", type: "image/webp" },
  };
  // No person yet: pictures go straight to the network and are not kept anywhere.
  assert.equal(await text(await w.request("/api/card-photo/7")), "jpeg");
  assert.equal(w.pages(), undefined, "no cache without a person");
  for (const p of ["/settings", "/cart", "/me", "/cards/BT1-001"]) await w.request(p, nav);
  assert.equal(w.pages(), undefined);
  assert.equal(await w.request("/api/cards"), "pass");
  assert.equal(await w.request("/api/card-photo/7", { method: "POST" }), "pass");
  assert.equal(await w.request("/api/card-photo/abc"), "pass", "only a numeric photo id");
  await w.request("/collection", nav);
  await w.request("/api/card-photo/7");
  await w.request("/_next/image?url=a&w=256&q=75");
  assert.deepEqual(w.pages()!.paths(), ["/__dbs-offline/who", "/_next/image?url=a&w=256&q=75", "/api/card-photo/7", "/collection"]);
  w.state.online = false;
  assert.equal(await text(await w.request("/api/card-photo/7")), "jpeg");
  assert.equal(await text(await w.request("/_next/image?url=a&w=256&q=75")), "webp");
  assert.equal(((await w.request("/_next/image?url=never")) as Response).type, "error", "a picture never seen is a network error, not a page");
  assert.equal(await w.request("/settings", nav).then((r) => (r === "pass" ? 0 : (r as Response).status)), 503, "settings is never served from the cache");
});

await check("6. followed links (RSC): kept per exact request, served offline, never prefetches; HTML follows", async () => {
  const w = world();
  w.state.routes = { "/decks": { body: "<html>decks</html>" } };
  const rsc = (from: string, extra: Record<string, string> = {}) => ({ headers: { rsc: "1", "next-url": from, "next-router-state-tree": `tree-${Math.random()}`, ...extra } });
  w.state.routes["/decks?_rsc=h1"] = { body: "0:flight-a", type: "text/x-component" };
  w.state.routes["/decks?_rsc=h2"] = { body: "0:flight-b", type: "text/x-component" };
  assert.equal(await text(await w.request("/decks?_rsc=h1", rsc("/from-a"))), "0:flight-a");
  const kept = w.pages()!.paths();
  assert.ok(kept.some((p) => p.startsWith("/__dbs-offline/rsc/decks")), "the payload is kept");
  assert.ok(kept.includes("/decks"), "and the page's HTML, which a followed link never asks for");
  w.state.online = false;
  assert.equal(await text(await w.request("/decks?_rsc=h1", rsc("/from-a"))), "0:flight-a", "the same request (Next hashes its router headers into _rsc) finds its copy");
  const other = await w.request("/decks?_rsc=zzzz", rsc("/from-b"));
  assert.ok(other !== "pass" && other.type === "error", "another starting point has no copy: network error, so Next loads the page");
  assert.equal(await text(await w.request("/decks", nav)), "<html>decks</html>");
  assert.equal(await w.request("/decks?_rsc=h1", rsc("/from-a", { "next-router-prefetch": "1" })), "pass", "a prefetch is the browser's");
  assert.equal(await w.request("/arena?_rsc=h1", rsc("/from-a")), "pass");
  assert.equal(await w.request("/settings?_rsc=h1", rsc("/from-a")), "pass");
  assert.equal(await w.request("/decks", { method: "POST", headers: { "next-action": "x" } }), "pass");
});

await check("7. slow or failing network with a copy shows the copy; a 500 too; a 404 or a redirect is the truth", async () => {
  const w = world();
  w.state.routes = { "/decks/3": { body: "<html>deck 3</html>" } };
  await w.request("/decks/3", nav);
  // A 500 is not shown over a copy.
  w.state.routes["/decks/3"] = { status: 500, body: "boom" };
  assert.equal(await text(await w.request("/decks/3", nav)), "<html>deck 3</html>");
  // A 404 is: the deck is gone.
  w.state.routes["/decks/3"] = { status: 404, body: "gone" };
  assert.equal(await text(await w.request("/decks/3", nav)), "gone");
  // A failing network (online by the flag, fetch throws): the copy.
  const down = world();
  down.state.routes = { "/decks/3": { body: "<html>deck 3</html>" } };
  await down.request("/decks/3", nav);
  down.state.routes["/decks/3"] = { hang: true };
  const pending = down.request("/decks/3", nav);
  await new Promise((r) => setTimeout(r, 20));
  const late = down.state.timers.find((t) => t.ms >= 8000);
  assert.ok(late, "the patience timer is set");
  for (const t of down.state.timers) t.fn();
  assert.equal(await text(await pending), "<html>deck 3</html>", "a network that does not answer shows the copy");
});

await check("8. /?source=pwa: online it remembers where it led; offline the cold launch goes there", async () => {
  const start = "/?source=pwa";
  // A Dragon Ball user, a prepared device (an arena shell exists).
  {
    const w = world();
    w.state.routes = { "/?source=pwa": sendsTo("/arena"), "/arena": {} };
    const shell = await w.caches.open("dbs-arena-shell-1111111111111111");
    await shell.put(SHELL_PATH, new Response("shell"));
    await shell.put("/__dbs-arena-shell/meta", new Response(JSON.stringify({ version: "1111111111111111", installedAt: 1 })));
    const online = (await w.request(start, nav)) as Response;
    assert.equal(online.status, 200, "online the start page is the network, untouched");
    assert.match(await online.text(), /__next-page-redirect/);
    assert.ok(w.pages()!.paths().includes("/__dbs-offline/start"));
    w.state.online = false;
    const off = (await w.request(start, nav)) as Response;
    assert.ok(off.status === 302 && off.headers.get("location") === `${ORIGIN}${SHELL_PATH}`, "offline: the arena shell, as /arena was");
    // `/` itself stays what it was: a notice, never the shell.
    const home = (await w.request("/", nav)) as Response;
    assert.equal(home.status, 503);
    assert.ok(!home.headers.get("location"));
  }
  // A Pokémon player: the start leads to /pokemon, which is kept.
  {
    const w = world();
    w.state.routes = { "/?source=pwa": sendsTo("/pokemon"), "/pokemon": { body: "<html>sammlung</html>" } };
    const online = (await w.request(start, nav)) as Response;
    assert.match(await online.text(), /url=\/pokemon/);
    await w.request("/pokemon", nav);
    w.state.online = false;
    const off = (await w.request(start, nav)) as Response;
    assert.ok(off.status === 302 && off.headers.get("location") === `${ORIGIN}/pokemon`, "offline: the last-seen /pokemon");
    assert.match(await text(await w.request("/pokemon", nav)), /sammlung/);
  }
  // Nothing remembered: a shell wins, else a kept /pokemon, else the notice.
  {
    const w = world();
    w.state.online = false;
    const nothing = (await w.request(start, nav)) as Response;
    assert.equal(nothing.status, 503);
    const shell = await w.caches.open("dbs-arena-shell-2222222222222222");
    await shell.put(SHELL_PATH, new Response("shell"));
    await shell.put("/__dbs-arena-shell/meta", new Response(JSON.stringify({ version: "2222222222222222", installedAt: 1 })));
    const withShell = (await w.request(start, nav)) as Response;
    assert.equal(withShell.headers.get("location"), `${ORIGIN}${SHELL_PATH}`);
  }
  // Another person's memory is gone with their cache.
  {
    const w = world();
    w.state.routes = { "/?source=pwa": sendsTo("/pokemon"), "/pokemon": {}, "/login": {} };
    await w.request(start, nav);
    await w.request("/login", nav);
    assert.equal(w.pages(), undefined);
  }
  // A failure with the browser online is still never an offline launch (the 19 Oct 2026 bug).
  {
    const w = world();
    w.state.routes = { "/?source=pwa": sendsTo("/arena") };
    const shell = await w.caches.open("dbs-arena-shell-3333333333333333");
    await shell.put(SHELL_PATH, new Response("shell"));
    await shell.put("/__dbs-arena-shell/meta", new Response(JSON.stringify({ version: "3333333333333333", installedAt: 1 })));
    await w.request(start, nav);
    w.state.online = false;
    w.state.report = true;
    const failed = (await w.request(start, nav)) as Response;
    assert.equal(failed.status, 503);
    assert.ok(!failed.headers.get("location"), "fetch failing with the browser online is a notice, not the arena");
    // And a page that is kept is shown for it all the same (a phone with a bar and no data).
    w.state.routes["/collection"] = {};
    w.state.online = true;
    w.state.report = undefined;
    await w.request("/collection", nav);
    w.state.online = false;
    w.state.report = true;
    assert.match(await text(await w.request("/collection", nav)), /body of \/collection/);
  }
});

await check("9. build files: kept when no shell holds them, served offline", async () => {
  const w = world();
  w.state.routes = { "/_next/static/chunks/a.js": { body: "console.log(1)", type: "application/javascript" } };
  assert.equal(await text(await w.request("/_next/static/chunks/a.js?dpl=abc")), "console.log(1)");
  assert.deepEqual(w.caches.map.get("dbs-offline-static-v1")!.paths(), ["/_next/static/chunks/a.js"]);
  w.state.online = false;
  const hit = (await w.request("/_next/static/chunks/a.js?dpl=abc")) as Response;
  assert.equal(await hit.text(), "console.log(1)");
  await assert.rejects((w.request("/_next/static/chunks/never.js") as Promise<Response>), /Failed to fetch/);
});

await check("9b. card art at a size never fetched: offline, the optimiser copy of that picture or the small TCGdex file stands in", async () => {
  const w = world();
  w.state.routes = { "/collection": {}, "/_next/image?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fa%2Fb%2F1%2Fhigh.webp&w=256&q=75": { body: "optimised", type: "image/webp" } };
  await w.request("/collection", nav);
  await w.request("/_next/image?url=https%3A%2F%2Fassets.tcgdex.net%2Fen%2Fa%2Fb%2F1%2Fhigh.webp&w=256&q=75");
  const art = await w.caches.open("dbs-card-art-v1");
  await art.put("https://assets.tcgdex.net/en/a/b/2/low.webp", new Response("small"));
  w.state.online = false;
  assert.equal(await text(await w.request("https://assets.tcgdex.net/en/a/b/1/high.webp", { mode: "no-cors" })), "optimised");
  assert.equal(await text(await w.request("https://assets.tcgdex.net/en/a/b/2/high.webp", { mode: "no-cors" })), "small");
  const none = await w.request("https://assets.tcgdex.net/en/a/b/3/high.webp", { mode: "no-cors" });
  assert.ok(none !== "pass" && none.type === "error", "nothing near: a network error, as before");
});

await check("10. the worker still never skips waiting or claims, and its art cache name is the one the arena tests pin", () => {
  assert.ok(!/self\.skipWaiting\(|clients\.claim\(/.test(SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "no skipWaiting / clients.claim call");
  assert.match(SOURCE, /const ART_CACHE = "dbs-card-art-v1"/);
});

console.log(notes.join("\n"));
if (failures.length) {
  console.error(`offline-reading: ${failures.length} failed`);
  process.exit(1);
}
console.log(`offline-reading: ok — ${notes.length} checks`);
