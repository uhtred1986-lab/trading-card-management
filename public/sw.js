/*
 * Card art, cached. That is the whole job.
 *
 * The heavy payload in this app is card images from four public CDNs, and they
 * never change once published — so they are cached hard and served from disk on
 * every later visit. A deck page that used to pull a few megabytes pulls none.
 *
 * It deliberately caches NOTHING from this app's own origin. The whole site
 * sits behind HTTP Basic Auth, and a cache of authenticated pages is a copy of
 * the owner's collection sitting in the browser profile, outliving any logout.
 * Not worth it to save a round trip on a page that is `force-dynamic` anyway.
 *
 * The one same-origin thing it does is answer a navigation that failed with a
 * short "you are offline" page, so a game that loses signal says so instead of
 * showing the browser's error — and so the app meets the installability bar,
 * which wants a fetch handler that can respond when the network cannot.
 */

const CACHE = "dbs-card-art-v1";

/** The hosts in `next.config.ts` — the only ones this worker will touch. */
const ART_HOSTS = new Set([
  "storage.googleapis.com",
  "www.dbs-cardgame.com",
  "tcgplayer-cdn.tcgplayer.com",
  "www.cardtrader.com",
  "cardtrader.com",
]);

const OFFLINE_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline</title><style>
html,body{height:100%;margin:0;background:#090b15;color:#d5dbeb;
font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
div{height:100%;display:grid;place-content:center;text-align:center;padding:2rem;gap:.5rem}
b{color:#ffa733;font-size:1.1rem}small{color:#7d8bb0}
</style></head><body><div><b>No connection</b>
<small>The board lives on the server, so it needs one. Your game is saved.</small>
</div></body></html>`;

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (ART_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkThenOfflineNotice(request));
    return;
  }

  // Everything else — this app's own pages, actions and API — is left alone.
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
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

async function networkThenOfflineNotice(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(OFFLINE_PAGE, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  }
}
