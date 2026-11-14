/*
 * Three jobs, each with caches of its own.
 *
 * 0. Offline reading (below, "offline reading", and "Offline reading" in
 *    docs/architecture/collection-and-decks.md): the last-seen collection, wishes and decks pages
 *    stay readable with no network. This is the one deliberate exception to "never cache a signed-in
 *    page" in job 2's paragraph, and it is held to a short list and to one person at a time: only
 *    `readableArea` paths, only a 200 that carries the proxy's `x-card-who` stamp, kept in
 *    `dbs-offline-pages-v1` for exactly that one `who`. Another `who`, a response without one, a 401
 *    or a visit to a sign-in page deletes the whole cache. Public build files (`/_next/static/`) go
 *    to `dbs-offline-static-v1`. Everything personal that belongs to those pages (the optimiser's
 *    pictures, the person's own card photos) goes in the same per-person cache. Nothing under `/api/`
 *    but `/api/card-photo/<id>`, and no `/settings`, `/cart`, `/login`, `/join`.
 *
 * 1. Card art, cached. The heavy payload in this app is card images from public CDNs, and they never
 *    change once published — so they are cached hard (`dbs-card-art-*`) and served from disk.
 *
 * 2. The offline shell (#659, `src/lib/arena/local/shell.ts`): `/arena/offline` and the static files
 *    of the build that serves it, in `dbs-arena-shell-<version>`, so the prepared app cold-launches
 *    with no network and plays a local match from a pack installed on the device.
 *
 * What the SHELL never caches (job 0 is separate): anything else from this app's own origin. The online app sits behind a
 * sign-in, and a cache of signed-in pages is a copy of the owner's collection in the browser
 * profile, outliving any logout. So: no signed-in page, no API body, no redirect, no RSC payload,
 * and nothing fetched with credentials. The shell's list comes from the build
 * (`/arena/offline/shell.json`), every path in it must pass `isShellAsset` (the build's public
 * `/_next/static/` files, the manifest, its icons), and the shell page itself is fetched with
 * `credentials: "omit"` — the HTML a signed-out stranger gets, which the proxy lets through because
 * the page is prerendered and reads no data.
 *
 * Updates: the page registers `/sw.js?v=<version>` (`src/components/ServiceWorker.tsx`), so a new
 * build is a new worker. It installs into a NEW cache; if any file fails, it deletes that partial
 * cache and fails, and the previous worker and its shell stay as they were. It does not call
 * `skipWaiting` and does not `clients.claim`: it waits until every window of the app is closed, so
 * a match in progress keeps the JS it started with. Activation keeps the current shell and the
 * newest complete one before it (reachable at `/arena/offline?shell=<version>`, for a saved match
 * played on that revision) and deletes only older shell caches and its own older art caches —
 * never a cache it does not own (`dbs-arena-pack-*` belongs to the pack store).
 *
 * Navigations go to the shell only when the browser reports no network (`navigator.onLine === false`),
 * one is installed and the page is `/arena` or below (the installed app's start page); `/` never does.
 * A failed fetch with the browser online is retried once and then gets a "server did not answer" page
 * (retry link, the shell as a choice) - never a redirect into offline mode (19 Oct 2026 bug).
 *
 * `scripts/verify/arena-offline-shell.mts` runs this file against a fake Cache Storage and fetch.
 */

const ART_CACHE = "dbs-card-art-v1";
const ART_PREFIX = "dbs-card-art-";
/** Mirrors `src/lib/arena/local/shell.ts`; the proof checks they agree. */
const SHELL_PREFIX = "dbs-arena-shell-";
const SHELL_PATH = "/arena/offline";
const SHELL_MANIFEST = "/arena/offline/shell.json";
const SHELL_META = "/__dbs-arena-shell/meta";
const SHELL_FORMAT = 1;
const SHELL_KEEP = 2;
const VERSION_PATTERN = /^[0-9a-f]{16}$/;
/** How many shell files are fetched at once during install. */
const PRECACHE_PARALLEL = 6;

/** This worker's shell version, from its own URL; null for a worker registered without one (art only). */
const VERSION = (() => {
  const v = new URL(self.location.href).searchParams.get("v");
  return v && VERSION_PATTERN.test(v) ? v : null;
})();
const shellCache = (v) => SHELL_PREFIX + v;

// Offline reading. The page cache is keyed by PERSON, not by URL alone: it holds one `who` at a time.
const PAGES_CACHE = "dbs-offline-pages-v1";
const STATIC_CACHE = "dbs-offline-static-v1";
/** The proxy's stamp on every response it lets through (`src/lib/auth/who.ts`). */
const WHO_HEADER = "x-card-who";
const WHO_META = "/__dbs-offline/who";
const START_META = "/__dbs-offline/start";
/** A cached RSC payload lives under this prefix, so it can never be mistaken for the page's HTML. */
const RSC_PREFIX = "/__dbs-offline/rsc";
const SIGN_IN_PATHS = ["/login", "/join", "/password-login"];
const PAGE_LIMIT = 60;
const MEDIA_LIMIT = 800;
const STATIC_LIMIT = 500;
/** How long a cached copy waits for the network before it is shown (a phone with a bar of signal and no data). */
const NET_PATIENCE = 8000;

/** The hosts in `next.config.ts` — the only cross-origin ones this worker will touch. */
const ART_HOSTS = new Set(["storage.googleapis.com", "www.dbs-cardgame.com", "tcgplayer-cdn.tcgplayer.com", "www.cardtrader.com", "cardtrader.com", "assets.tcgdex.net"]);

/** `isShellAsset` of `shell.ts`: the build's public static files, the manifest and its icons. Never a page, an API or a query. */
function isShellAsset(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("?") || path.includes("#") || path.includes("..") || path.includes("//")) return false;
  // Keep in sync with shell.ts: source maps are debugging metadata, not required game assets (#810).
  if (path.endsWith(".map")) return false;
  return path.startsWith("/_next/static/") || /^\/icons\/[\w.-]+$/.test(path) || path === "/manifest.webmanifest";
}

function offlinePage(withShell) {
  const more = withShell
    ? `<a href="${SHELL_PATH}">Play on this device</a> — the match runs offline from a pack installed here.`
    : "The board lives on the server, so it needs one. Your game is saved.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><style>
html,body{height:100%;margin:0;background:#090b15;color:#d5dbeb;
font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
div{height:100%;display:grid;place-content:center;text-align:center;padding:2rem;gap:.5rem}
b{color:#ffa733;font-size:1.1rem}small{color:#7d8bb0}a{color:#ffa733}
</style></head><body><div><b>No connection</b>
<small>${more}</small>
</div></body></html>`;
}

// ── install ────────────────────────────────────────────────────────────────────────────────────

self.addEventListener("install", (event) => {
  // No skipWaiting: the new worker waits until no window runs the old one (see the header).
  if (VERSION) event.waitUntil(installShell(VERSION));
});

async function readMeta(name) {
  if (!(await caches.has(name))) return null;
  const hit = await (await caches.open(name)).match(SHELL_META);
  if (!hit) return null;
  try {
    const meta = await hit.json();
    return meta && meta.version === name.slice(SHELL_PREFIX.length) ? meta : null;
  } catch {
    return null;
  }
}

/** A response the shell may keep: a same-origin 200, not redirected, from a credential-less request. */
function checkResponse(path, response, html) {
  if (!response.ok || response.status !== 200) throw new Error(`${path}: HTTP ${response.status}`);
  if (response.redirected || response.type !== "basic") throw new Error(`${path}: a ${response.redirected ? "redirected" : response.type} response is not cached`);
  const type = response.headers.get("content-type") || "";
  if (html && !type.startsWith("text/html")) throw new Error(`${path}: ${type || "no content type"} is not the shell page`);
}

async function installShell(version) {
  const name = shellCache(version);
  if (await readMeta(name)) return; // already complete (the same build registered again)
  await caches.delete(name); // what an interrupted install left
  try {
    const res = await fetch(SHELL_MANIFEST, { credentials: "omit", cache: "no-store", redirect: "error" });
    checkResponse(SHELL_MANIFEST, res, false);
    const manifest = await res.json();
    if (!manifest || manifest.format !== SHELL_FORMAT || manifest.shell !== SHELL_PATH || !Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("shell.json is not a shell manifest");
    // A deploy between the page's look and this one: install nothing; the page registers the newer version next time.
    if (manifest.version !== version) throw new Error(`shell.json describes ${manifest.version}, not ${version}`);
    const bad = manifest.files.filter((f) => !isShellAsset(f));
    if (bad.length) throw new Error(`shell.json lists paths the shell may not cache: ${bad.slice(0, 3).join(", ")}`);

    const cache = await caches.open(name);
    const queue = [SHELL_PATH, ...manifest.files];
    const worker = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        const r = await fetch(path, { credentials: "omit", cache: "reload", redirect: "error" });
        checkResponse(path, r, path === SHELL_PATH);
        await cache.put(path, r);
      }
    };
    await Promise.all(Array.from({ length: PRECACHE_PARALLEL }, worker));
    // Written last: a cache without it is incomplete and is never served.
    const meta = { format: SHELL_FORMAT, version, revision: manifest.revision ?? null, files: manifest.files.length, installedAt: Date.now() };
    await cache.put(SHELL_META, new Response(JSON.stringify(meta), { headers: { "content-type": "application/json" } }));
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
}

// ── activate ───────────────────────────────────────────────────────────────────────────────────

self.addEventListener("activate", (event) => {
  // No clients.claim: a page opened before this worker keeps the one it opened with.
  event.waitUntil(pruneCaches());
});

async function pruneCaches() {
  const names = await caches.keys();
  // Only this worker's own older art caches; never a cache it does not own.
  await Promise.all(names.filter((n) => n.startsWith(ART_PREFIX) && n !== ART_CACHE).map((n) => caches.delete(n)));
  if (!VERSION) return; // a worker without a shell leaves every shell alone
  const shells = [];
  for (const n of names.filter((x) => x.startsWith(SHELL_PREFIX))) shells.push({ name: n, meta: await readMeta(n) });
  const current = shellCache(VERSION);
  const others = shells.filter((s) => s.name !== current && s.meta).sort((a, b) => b.meta.installedAt - a.meta.installedAt);
  const keep = new Set([current, ...others.slice(0, SHELL_KEEP - 1).map((s) => s.name)]);
  await Promise.all(shells.filter((s) => !keep.has(s.name)).map((s) => caches.delete(s.name)));
}

// ── fetch ──────────────────────────────────────────────────────────────────────────────────────

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (ART_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirstArt(request));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (isShellAsset(url.pathname)) {
    event.respondWith(fromShells(request, url.pathname));
    return;
  }

  // A visit to a sign-in page (signing out lands on `/login`, a new person on `/join`) ends whatever
  // this device kept for the last person, before the page itself is asked for.
  if (SIGN_IN_PATHS.includes(url.pathname)) {
    event.respondWith(forgetPages().then(() => (request.mode === "navigate" ? networkOrShell(request, url) : fetch(request))));
    return;
  }

  if (isPersonalMedia(url.pathname)) {
    event.respondWith(personalMedia(request));
    return;
  }

  if (request.mode === "navigate") {
    if (url.pathname === SHELL_PATH) event.respondWith(shellPage(request, url));
    else if (url.pathname === "/" && url.searchParams.get("source") === "pwa") event.respondWith(startPage(request, url));
    else if (readableArea(url.pathname)) event.respondWith(readablePage(event, request, url));
    else event.respondWith(networkOrShell(request, url));
    return;
  }

  // The data Next fetches when the person taps through the app (an RSC payload), for the readable pages only.
  if (readableArea(url.pathname) && isRscFetch(request, url) && !request.headers.get("next-router-prefetch")) {
    event.respondWith(readableRsc(event, request, url));
    return;
  }

  // Everything else — this app's own pages' data, actions and API — is left alone.
});

/** The complete shell caches, the current one first. */
async function completeShells() {
  const names = (await caches.keys()).filter((n) => n.startsWith(SHELL_PREFIX));
  const out = [];
  for (const n of names) {
    const meta = await readMeta(n);
    if (meta) out.push({ name: n, meta });
  }
  return out.sort((a, b) => (a.meta.version === VERSION ? -1 : b.meta.version === VERSION ? 1 : b.meta.installedAt - a.meta.installedAt));
}

/**
 * A static file: from any complete shell (an older shell's page still needs its own chunks), else the
 * network, uncached. The cached response is re-wrapped: a Worker takes its `location` from the
 * response's URL, and the cached one has lost the request's query and fragment — where Turbopack's
 * worker bootstrap reads its `#params=` (without them the match Worker dies: "Missing worker
 * bootstrap config"). A constructed response has no URL, so the Worker keeps the one it asked for.
 */
async function fromShells(request, path) {
  for (const s of await completeShells()) {
    const hit = await (await caches.open(s.name)).match(path);
    if (hit) return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: hit.headers });
  }
  return staticFallback(request, path);
}

/**
 * A build file no shell holds (the app on a device not prepared for the arena): the network, and the
 * build's own `/_next/static/` files are kept in `dbs-offline-static-v1` so the readable pages can
 * start with no network. They are public and hashed by content, so one copy per path is right.
 */
async function staticFallback(request, path) {
  const keep = path.startsWith("/_next/static/");
  try {
    const response = await fetch(request);
    if (keep && response.ok && response.status === 200) {
      try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.put(at(path), response.clone());
        await trim(cache, () => true, STATIC_LIMIT);
      } catch {
        // A full disk is not a reason to fail the file.
      }
    }
    return response;
  } catch (error) {
    if (keep && (await caches.has(STATIC_CACHE))) {
      const hit = await (await caches.open(STATIC_CACHE)).match(at(path));
      if (hit) return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers: hit.headers });
    }
    throw error;
  }
}

/** `/arena/offline`: this worker's shell (or the one `?shell=` names), else the network, else the newest shell. */
async function shellPage(request, url) {
  const shells = await completeShells();
  const asked = url.searchParams.get("shell");
  const pick = (asked && shells.find((s) => s.meta.version === asked)) || shells.find((s) => s.meta.version === VERSION);
  if (pick) {
    const hit = await (await caches.open(pick.name)).match(SHELL_PATH);
    if (hit) return hit;
  }
  try {
    return await fetch(request);
  } catch {
    for (const s of shells) {
      const hit = await (await caches.open(s.name)).match(SHELL_PATH);
      if (hit) return hit;
    }
    return new Response(offlinePage(false), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  }
}

/** True only when the browser itself says there is no network. A thrown fetch alone (timeout, cold start, aborted navigation) is not that. */
function browserOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** The notice for a navigation that failed with the browser online: retry, and the shell as a choice (never a redirect). */
function unreachablePage(withShell, here) {
  const more = withShell
    ? `<a href="${here}">Try again</a> · <a href="${SHELL_PATH}">Play on this device</a>`
    : `<a href="${here}">Try again</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cannot reach the server</title><style>
html,body{height:100%;margin:0;background:#090b15;color:#d5dbeb;
font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
div{height:100%;display:grid;place-content:center;text-align:center;padding:2rem;gap:.5rem}
b{color:#ffa733;font-size:1.1rem}small{color:#7d8bb0}a{color:#ffa733}
</style></head><body><div><b>The server did not answer</b>
<small>${more}</small>
</div></body></html>`;
}

/**
 * Any other page: the network, untouched. A failed fetch is NOT "offline mode": the shell takes over
 * only when the browser reports no network at all, and then only for the arena (`/arena`, `/arena/*`)
 * - never for `/`, which gets the plain notice. A failure with the browser online (a slow cold start,
 * a dropped connection, an aborted navigation) is retried once, then shown as "the server did not
 * answer" with a retry link and the shell as a choice - it never silently lands the player in
 * "Play on this device".
 */
async function networkOrShell(request, url, load = () => fetch(request)) {
  try {
    return await load();
  } catch {
    const shells = await completeShells();
    const arena = url.pathname === "/arena" || url.pathname.startsWith("/arena/");
    if (browserOffline()) {
      if (shells.length && arena) return Response.redirect(new URL(SHELL_PATH, self.location.origin).href, 302);
      return new Response(offlinePage(shells.length > 0), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
    }
    try {
      return await load();
    } catch {
      return new Response(unreachablePage(shells.length > 0, url.pathname + url.search), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
    }
  }
}

async function cacheFirstArt(request) {
  const cache = await caches.open(ART_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const response = await fetch(request);
    // Opaque responses (cross-origin, no CORS) are cacheable and are what card
    // art actually is; a failed lookup is not, or a 404 would stick forever.
    if (response.ok || response.type === "opaque") await cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

// ── offline reading ────────────────────────────────────────────────────────────────────────────
//
// Network first, copy second, for the pages a person reads without needing the server: the Pokémon
// collection, wishes and decks, and the Dragon Ball collection and decks. What the page shows when
// the network is gone is what the device last saw. The one rule that matters: a copy is kept for ONE
// person (`x-card-who`), and goes the moment anything says that person is not here any more.

/** An absolute URL on this origin: the key a copy is kept under. */
const at = (path) => new URL(path, self.location.origin).href;

/** Which area a path belongs to when it is one of the readable pages, else null. Query strings do not matter here. */
function readableArea(path) {
  if (path === "/pokemon" || path === "/pokemon/wishes" || path === "/pokemon/decks") return "pokemon";
  if (/^\/pokemon\/decks\/[^/]+$/.test(path) && path !== "/pokemon/decks/new") return "pokemon";
  if (path === "/collection" || path === "/decks") return "dbs";
  if (/^\/decks\/\d+$/.test(path)) return "dbs";
  return null;
}

/** What Next fetches when a link is followed inside the app: the page as a flight payload. */
function isRscFetch(request, url) {
  return request.headers.get("rsc") === "1" || url.searchParams.has("_rsc");
}

/** The pictures of those pages that belong to a person: the optimiser's copies of card art and their own card photos. */
function isPersonalMedia(path) {
  return path === "/_next/image" || /^\/api\/card-photo\/\d+$/.test(path);
}

/** The key of a followed link's payload: the page, without Next's per-request `_rsc` hash, plus what the client already holds (the state tree decides what the payload leaves out). */
function rscKey(request, url) {
  const u = new URL(url.href);
  u.searchParams.delete("_rsc");
  const held = (request.headers.get("next-router-state-tree") || "") + "|" + (request.headers.get("next-url") || "");
  let h = 5381;
  for (let i = 0; i < held.length; i++) h = ((h * 33) ^ held.charCodeAt(i)) >>> 0;
  return `${RSC_PREFIX}${u.pathname}${u.search}${u.search ? "&" : "?"}t=${h.toString(36)}`;
}

const isMediaKey = (path) => isPersonalMedia(path);
const isPageKey = (path) => path !== WHO_META && path !== START_META && !isPersonalMedia(path);

/** Delete the oldest entries of one kind beyond `limit`. */
async function trim(cache, belongs, limit) {
  try {
    const keys = (await cache.keys()).filter((r) => belongs(new URL(r.url).pathname));
    for (const r of keys.slice(0, Math.max(0, keys.length - limit))) await cache.delete(r);
  } catch {
    // A cache that cannot be listed is left as it is.
  }
}

/** Everything kept for the last person. */
async function forgetPages() {
  try {
    await caches.delete(PAGES_CACHE);
  } catch {
    // Nothing to forget.
  }
}

/** The page cache, only if it exists and says whose it is. */
async function currentPages() {
  if (!(await caches.has(PAGES_CACHE))) return null;
  const cache = await caches.open(PAGES_CACHE);
  return (await cache.match(at(WHO_META))) ? cache : null;
}

/** The page cache of `who`: made when absent, emptied first when it was another person's, none without a `who`. */
async function pagesFor(who) {
  if (!who) {
    await forgetPages();
    return null;
  }
  if (await caches.has(PAGES_CACHE)) {
    const cache = await caches.open(PAGES_CACHE);
    const meta = await cache.match(at(WHO_META));
    if (meta && (await meta.text()) === who) return cache;
    await forgetPages();
  }
  const cache = await caches.open(PAGES_CACHE);
  await cache.put(at(WHO_META), new Response(who));
  return cache;
}

/**
 * Keep a copy of a response, or throw away the cache when the response says the person is gone:
 * a 401/403, or a page that came back with no stamp (unknown person). Only a plain 200 of the
 * expected type, not redirected, is kept; under `key` and, when the page had a query, also under its
 * bare path (the "last seen" of that page).
 */
async function storePage(response, key, type, alias) {
  if (response.status === 401 || response.status === 403) return forgetPages();
  if (response.status !== 200 || response.redirected || response.type !== "basic") return;
  if (!(response.headers.get("content-type") || "").startsWith(type)) return;
  const cache = await pagesFor(response.headers.get(WHO_HEADER));
  if (!cache) return;
  const second = alias && alias !== key ? response.clone() : null;
  await cache.put(at(key), response);
  if (second) await cache.put(at(alias), second);
  await trim(cache, isPageKey, PAGE_LIMIT);
}

/** Keep a copy without making the person wait for it. `response.clone()` is taken now, before the page reads the body. */
function keepLater(event, response, key, type, alias) {
  const job = storePage(response.clone(), key, type, alias).catch(() => {});
  if (event && typeof event.waitUntil === "function") event.waitUntil(job);
}

/**
 * The network, unless a copy exists and the network is slow, failed or answered with a server error:
 * then the copy. A response that is not a server error (a redirect to the sign-in, a 404) is the
 * truth and is returned as it is.
 */
async function networkFirst(event, load, hit) {
  const net = load().then(
    (r) => ({ r }),
    () => ({ failed: true }),
  );
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ late: true }), NET_PATIENCE);
  });
  const first = await Promise.race([net, late]);
  clearTimeout(timer);
  if (first.r) return first.r.status >= 500 ? hit : first.r;
  // Slow: the copy is shown now, and the answer still lands in the cache when it comes.
  if (first.late && event && typeof event.waitUntil === "function") event.waitUntil(net);
  return hit;
}

async function pageHit(key, path) {
  const cache = await currentPages();
  if (!cache) return null;
  return (await cache.match(at(key), { ignoreVary: true })) || (await cache.match(at(path), { ignoreVary: true })) || null;
}

function neverSeenPage(path, withShell) {
  const de = path === "/pokemon" || path.startsWith("/pokemon/");
  const lead = de ? "Kein Internet" : "No connection";
  const body = de ? "Diese Seite hast du auf diesem Gerät noch nicht geöffnet, darum gibt es noch nichts zu zeigen. Mit Internet geht es wieder." : "This page has not been opened on this device yet, so there is nothing saved to show. It works again with a connection.";
  const back = de ? '<a href="/pokemon">Zur Sammlung</a>' : '<a href="/collection">Collection</a>';
  const arena = withShell && !de ? ` · <a href="${SHELL_PATH}">Play on this device</a>` : "";
  return `<!doctype html><html lang="${de ? "de" : "en"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${lead}</title><style>
html,body{height:100%;margin:0;background:#090b15;color:#d5dbeb;
font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
div{height:100%;display:grid;place-content:center;text-align:center;padding:2rem;gap:.5rem}
b{color:#ffa733;font-size:1.1rem}small{color:#7d8bb0}a{color:#ffa733}
</style></head><body><div><b>${lead}</b>
<small>${body}</small><small>${back}${arena}</small>
</div></body></html>`;
}

/** A readable page: the network first (and the answer kept), the last-seen copy when there is none. */
async function readablePage(event, request, url) {
  const key = url.pathname + url.search;
  const load = async () => {
    const response = await fetch(request);
    keepLater(event, response, key, "text/html", url.pathname);
    return response;
  };
  const hit = await pageHit(key, url.pathname);
  if (browserOffline()) {
    if (hit) return hit;
    return new Response(neverSeenPage(url.pathname, (await completeShells()).length > 0), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  }
  if (!hit) return networkOrShell(request, url, load);
  return networkFirst(event, load, hit);
}

/** The payload of a followed link. With none to show, the failure sends Next to a full page load, which `readablePage` answers. */
async function readableRsc(event, request, url) {
  const key = rscKey(request, url);
  const load = async () => {
    const response = await fetch(request);
    keepLater(event, response, key, "text/x-component");
    return response;
  };
  const cache = await currentPages();
  const hit = cache ? await cache.match(at(key), { ignoreVary: true }) : null;
  if (browserOffline()) return hit || Response.error();
  if (!hit) return load();
  return networkFirst(event, load, hit);
}

/** A picture of those pages: kept for the same person only, copy first (a card picture does not change under its address). */
async function personalMedia(request) {
  const cache = await currentPages();
  if (!cache) return fetch(request);
  const hit = await cache.match(request.url, { ignoreVary: true });
  if (hit) return hit;
  try {
    const response = await fetch(request);
    if (response.ok && response.status === 200) {
      const copy = response.clone();
      try {
        await cache.put(request.url, copy);
        await trim(cache, isMediaKey, MEDIA_LIMIT);
      } catch {
        // A full disk is not a reason to fail the picture.
      }
    }
    return response;
  } catch {
    return Response.error();
  }
}

/**
 * The installed app's start URL, `/?source=pwa`, which the server turns into `/arena` or `/pokemon`
 * per person (src/app/page.tsx). Online the worker asks, follows the redirect itself and remembers
 * where it went (for this person only); offline it sends the cold launch where it went last:
 * the arena's shell for the arena, the kept page for `/pokemon`. With nothing remembered a device that
 * has an arena shell goes to the arena (that was the start page before), else to a kept `/pokemon`.
 */
async function startPage(request, url) {
  if (browserOffline()) return offlineStart();
  let response;
  try {
    response = await fetch(url.href, { credentials: "same-origin", redirect: "follow" });
  } catch {
    return networkOrShell(request, url);
  }
  if (!response.redirected) return response;
  const to = new URL(response.url);
  try {
    if (response.body) void response.body.cancel();
  } catch {
    // The body was never going to be used.
  }
  if (to.origin !== self.location.origin || to.pathname === "/") return networkOrShell(request, url);
  if (!SIGN_IN_PATHS.includes(to.pathname)) {
    try {
      const cache = await pagesFor(response.headers.get(WHO_HEADER));
      if (cache) await cache.put(at(START_META), new Response(to.pathname + to.search));
    } catch {
      // Not remembering is not a reason to fail the launch.
    }
  }
  return Response.redirect(to.href, 302);
}

async function offlineStart() {
  const shells = await completeShells();
  const cache = await currentPages();
  const meta = cache ? await cache.match(at(START_META)) : null;
  const start = meta ? await meta.text() : null;
  const go = (path) => Response.redirect(new URL(path, self.location.origin).href, 302);
  if (start) {
    const path = new URL(start, self.location.origin).pathname;
    if ((path === "/arena" || path.startsWith("/arena/")) && shells.length) return go(SHELL_PATH);
    if (readableArea(path) && (await pageHit(start, path))) return go(start);
  } else {
    if (shells.length) return go(SHELL_PATH);
    if (cache && (await cache.match(at("/pokemon"), { ignoreVary: true }))) return go("/pokemon");
  }
  return new Response(offlinePage(shells.length > 0), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
}
