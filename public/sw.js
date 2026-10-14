/*
 * Two jobs, each with caches of its own.
 *
 * 1. Card art, cached. The heavy payload in this app is card images from public CDNs, and they never
 *    change once published — so they are cached hard (`dbs-card-art-*`) and served from disk.
 *
 * 2. The offline shell (#659, `src/lib/arena/local/shell.ts`): `/arena/offline` and the static files
 *    of the build that serves it, in `dbs-arena-shell-<version>`, so the prepared app cold-launches
 *    with no network and plays a local match from a pack installed on the device.
 *
 * What it never caches: anything else from this app's own origin. The online app sits behind a
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
 * Navigations that fail for want of a network go to the shell when one is installed (`/`, `/arena`
 * and below — the installed app's start page), and otherwise get a short "you are offline" page.
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

/** The hosts in `next.config.ts` — the only cross-origin ones this worker will touch. */
const ART_HOSTS = new Set(["storage.googleapis.com", "www.dbs-cardgame.com", "tcgplayer-cdn.tcgplayer.com", "www.cardtrader.com", "cardtrader.com"]);

/** `isShellAsset` of `shell.ts`: the build's public static files, the manifest and its icons. Never a page, an API or a query. */
function isShellAsset(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("?") || path.includes("#") || path.includes("..") || path.includes("//")) return false;
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

  if (request.mode === "navigate") {
    event.respondWith(url.pathname === SHELL_PATH ? shellPage(request, url) : networkOrShell(request, url));
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

/** A static file: from any complete shell (an older shell's page still needs its own chunks), else the network, uncached. */
async function fromShells(request, path) {
  for (const s of await completeShells()) {
    const hit = await (await caches.open(s.name)).match(path);
    if (hit) return hit;
  }
  return fetch(request);
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

/** Any other page: the network, untouched; with no network, the shell for the arena's start pages, else a notice. */
async function networkOrShell(request, url) {
  try {
    return await fetch(request);
  } catch {
    const shells = await completeShells();
    const arena = url.pathname === "/" || url.pathname === "/arena" || url.pathname.startsWith("/arena/");
    if (shells.length && arena) return Response.redirect(new URL(SHELL_PATH, self.location.origin).href, 302);
    return new Response(offlinePage(shells.length > 0), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
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
