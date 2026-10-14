/**
 * #658, TEST-ONLY: what `scripts/arena-pack-store-browser.mts` runs inside the page — the real pack
 * store on Chrome's own IndexedDB, `fetch`, `crypto.subtle` and `createImageBitmap` (no decoder,
 * digest or factory is injected). `art` is the art server's origin (`arena-pack-store-fixture.mts`).
 */
import { packStore, PackStoreError, type PackStoreOptions } from "../../src/lib/arena/local/pack-store";

const name = (s: string) => decodeURIComponent(new URL(s).pathname.split("/").pop()!);
const store = (db: string, art: string, kind: string, extra: Partial<PackStoreOptions> = {}) =>
  packStore({ name: db, localName: `${db}-local`, interpreterRevision: null, retries: 0, artRequest: (u) => `${art}/${kind}/${encodeURIComponent(name(u))}`, ...extra });

const codeOf = (e: unknown) => (e instanceof PackStoreError ? `${e.code}: ${e.message}` : `not a PackStoreError: ${String(e)}`);

/** Install with real fetch (CORS), real SHA-256, real decode. */
export async function installGood(db: string, art: string) {
  const s = store(db, art, "art");
  const phases: string[] = [];
  const v = await s.install({ url: `${art}/pack.json` }, { onProgress: (p) => { if (!phases.includes(p.phase)) phases.push(p.phase); } });
  s.close();
  return { status: v.status, active: v.active, artVerified: v.artVerified, artRequired: v.artRequired, hash: v.hash, phases };
}

/** An image that is `image/png` but not a PNG: Chrome's decoder refuses it, the version is never ready. */
export async function installBadImage(db: string, art: string) {
  const s = store(db, art, "bad");
  let refused = "";
  try { await s.install({ url: `${art}/pack.json` }); } catch (e) { refused = codeOf(e); }
  const list = await s.list();
  s.close();
  return { refused, statuses: list.map((v) => v.status), active: list.some((v) => v.active) };
}

/** Art without CORS: a no-cors fetch gives a real opaque response — refused, though `Cache.put` of it would succeed. */
export async function installOpaque(db: string, art: string, sample: string) {
  // Only the art goes no-cors; the pack itself comes with CORS, so the refusal is the art's.
  const noCors: typeof fetch = (input, init) => fetch(input, String(input).includes("/plain/") ? { ...init, mode: "no-cors" } : init);
  const s = store(db, art, "plain", { fetch: noCors });
  let refused = "";
  try { await s.install({ url: `${art}/pack.json` }); } catch (e) { refused = codeOf(e); }
  // What a cache would have accepted: the same opaque response put into Cache Storage.
  const probe = await fetch(`${art}/plain/${encodeURIComponent(sample)}`, { mode: "no-cors" });
  const cache = await caches.open("dbs-arena-pack-probe-658");
  let cachePut = "ok";
  try { await cache.put("/probe", probe.clone()); } catch (e) { cachePut = String(e); }
  await caches.delete("dbs-arena-pack-probe-658");
  // And the default (cors) fetch of the same art: the browser refuses it outright.
  const s2 = store(`${db}-cors`, art, "plain");
  let corsRefused = "";
  try { await s2.install({ url: `${art}/pack.json` }); } catch (e) { corsRefused = codeOf(e); }
  const list = [...(await s.list()), ...(await s2.list())];
  s.close();
  s2.close();
  return { refused, probeType: probe.type, cachePut, corsRefused, statuses: list.map((v) => v.status), active: list.some((v) => v.active) };
}

/** With the network refused: load, read every image, re-checksum (inside `art`) and decode it with Chrome, and show one as an <img>. */
export async function offline(db: string, art: string, hash: string) {
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL) => { calls.push(String(input)); return Promise.reject(new TypeError("offline")); }) as typeof fetch;
  try {
    const s = store(db, art, "art");
    const pack = await s.load(hash);
    const images = await s.art(hash);
    const sizes: string[] = [];
    for (const blob of images.values()) {
      const bmp = await createImageBitmap(blob);
      sizes.push(`${bmp.width}x${bmp.height}`);
      bmp.close();
    }
    const urls = await s.artUrls(hash);
    const leader = urls.art[pack.decks[0].deck.leader].front ?? "";
    const img = new Image();
    img.src = leader;
    await img.decode();
    const shown = { src: leader.slice(0, 5), width: img.naturalWidth };
    urls.revoke();
    s.close();
    return { packHash: pack.hash, images: images.size, decoded: sizes.length, sizes: [...new Set(sizes)], shown, fetchCalls: calls };
  } finally {
    globalThis.fetch = realFetch;
  }
}

export async function listAll(db: string, art: string) {
  const s = store(db, art, "art");
  const list = await s.list();
  s.close();
  return list.map((v) => ({ hash: v.hash, status: v.status, active: v.active }));
}
