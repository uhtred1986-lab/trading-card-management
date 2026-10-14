/**
 * #658 (plan O4-03): offline packs installed, verified and updated atomically — the Node half.
 *
 * The real store (`src/lib/arena/local/pack-store.ts`) on `fake-indexeddb.ts` (IndexedDB's
 * buffered-until-commit and abort-discards-everything semantics, a byte quota), with a scripted
 * `fetch` and a real PNG decoder (`nodeDecode`, standing in for `createImageBitmap`; Chrome's own
 * decoder, SHA-256 and IndexedDB are `npm run arena:pack-store-browser`). The packs are the real
 * SD15/SD5 pack (`auditPack`) and a second version of it (`otherPack`, same id, another hash).
 *
 *   1. Interrupted or corrupt downloads never appear ready: a pack download cut off mid-stream, a
 *      pack with one byte changed, a truncated pack, the wrong version, a pack not playable here;
 *      art cut off mid-install (staged, never loadable), 404 art, an opaque response, a non-image,
 *      an image that does not decode, a short body. Art damaged or deleted on the device between
 *      download and readiness is found by the verify phase. A retry resumes (only the missing
 *      images are fetched again; damaged ones are re-fetched) and becomes ready.
 *   2. Updates: with v1 active and a saved match pinning v1 (a real journal header in
 *      `dbs-arena-local`), a failed update (bad art) and a full device (QuotaExceededError) each
 *      leave v1 active and loadable; a good update activates v2 in one step, reuses v1's verified
 *      images (no art download), keeps v1 for the match, refuses to remove it or the active one, and
 *      prunes v1 only once the match is gone. Unreadable saves prune nothing.
 *   3. Offline: with every fetch throwing, the active and the pinned version load, every image is
 *      read and re-checksummed from the device, `artUrls` gives device-local object URLs.
 *   4. `public/sw.js` activation deletes only its own old `dbs-card-art-*` caches, never a
 *      `dbs-arena-pack-*`, `dbs-arena-shell-*` or other cache.
 *
 *   npx tsx scripts/verify/arena-pack-store.mts      (part of `npm test`)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { packStore, requiredArt, PackStoreError, sameOriginArt, CACHE_PREFIXES, type PackStoreOptions, type InstallProgress } from "../../src/lib/arena/local/pack-store.ts";
import { indexedDbJournalStore } from "../../src/lib/arena/local/storage.ts";
import { JOURNAL_FORMAT, type MatchJournal } from "../../src/lib/arena/local/worker.ts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { auditPack, otherPack, LOCAL_REVISION } from "./arena-local-worker-fixture.mts";
import { FakeIndexedDb, asFactory } from "./fake-indexeddb.ts";
import { nodeDecode, pngFor } from "./arena-pack-store-fixture.mts";

const t0 = performance.now();
const v1 = await auditPack();
const v2 = await otherPack();
assert.equal(v1.id, v2.id, "the two versions are of one pack");
assert.notEqual(v1.hash, v2.hash, "and differ");
const text1 = canonicalJson(v1);
const text2 = canonicalJson(v2);
const required = requiredArt(v1);
assert.ok(required.length > 20, `the pack requires ${required.length} images`);
assert.deepEqual(requiredArt(v2), required, "both versions name the same art");

// ── A scripted network ──────────────────────────────────────────────────────────────────────────
type Rule = (url: string) => Response | Promise<Response> | null;
interface Net { calls: string[]; rules: Rule[]; offline: boolean }
const PACK_URL = "https://example.test/packs/masters.json";
function network(texts: Record<string, string>): Net & { fetch: typeof fetch } {
  const net: Net = { calls: [], rules: [], offline: false };
  const fetchFn = (async (input: string) => {
    const url = String(input);
    net.calls.push(url);
    if (net.offline) throw new TypeError("Failed to fetch (offline)");
    for (const r of net.rules) { const hit = await r(url); if (hit) return hit; }
    if (texts[url] !== undefined) return new Response(texts[url], { status: 200, headers: { "content-type": "application/json" } });
    const m = url.match(/^\/_next\/image\?url=([^&]+)/);
    if (m) {
      const art = decodeURIComponent(m[1]);
      const img = pngFor(art);
      return new Response(new Uint8Array(img), { status: 200, headers: { "content-type": "image/png", "content-length": String(img.length) } });
    }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  return Object.assign(net, { fetch: fetchFn });
}
const artUrlOf = (url: string) => sameOriginArt(url);
const isArtCall = (u: string) => u.startsWith("/_next/image?");
const opaque = () => ({ type: "opaque", ok: false, status: 0, headers: new Headers(), body: null }) as unknown as Response;
/** A body that delivers `first` bytes and then fails, as a dropped connection does. */
function cutOff(body: Uint8Array, first: number, headers: Record<string, string>): Response {
  let sent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) { if (!sent) { sent = true; c.enqueue(body.subarray(0, first)); } else c.error(new TypeError("network error: connection reset")); },
  });
  return new Response(stream, { status: 200, headers });
}

async function refused(p: Promise<unknown>, code: string, what: string): Promise<PackStoreError> {
  try { await p; } catch (e) {
    assert.ok(e instanceof PackStoreError, `${what}: a PackStoreError (got ${e})`);
    assert.equal(e.code, code, `${what}: code ${code} (got ${e.code}: ${e.message})`);
    return e;
  }
  assert.fail(`${what}: expected refusal ${code}`);
}

let dbs = 0;
function fresh(net: { fetch: typeof fetch }, extra: Partial<PackStoreOptions> = {}, fake = new FakeIndexedDb()) {
  const name = `packs-${++dbs}`;
  const store = packStore({ name, factory: asFactory(fake), localName: `local-${dbs}`, fetch: net.fetch, decode: nodeDecode, interpreterRevision: LOCAL_REVISION, retries: 1, retryDelayMs: () => 0, locks: null, ...extra });
  return { store, fake, name, localName: `local-${dbs}` };
}
const notReady = async (store: ReturnType<typeof packStore>, hash: string, what: string) => {
  assert.equal(await store.active(v1.id), null, `${what}: nothing is active`);
  const v = (await store.list()).find((x) => x.hash === hash);
  assert.ok(!v || v.status === "staged", `${what}: the version is never ready`);
  await refused(store.load(hash), "unknown", `${what}: load refuses the unready version`);
};
const results: string[] = [];
const ok = (what: string) => results.push(`ok   ${what}`);

// ── 1. Interrupted or corrupt downloads never appear ready ──────────────────────────────────────
{
  const net = network({ [PACK_URL]: text1 });
  const { store } = fresh(net);
  const bytes = new TextEncoder().encode(text1);
  net.rules = [(u) => (u === PACK_URL ? cutOff(bytes, 1000, { "content-type": "application/json", "content-length": String(bytes.length) }) : null)];
  await refused(store.install({ url: PACK_URL }), "network", "a pack download cut off mid-stream");
  assert.deepEqual(await store.list(), [], "nothing is stored from an interrupted pack download");
  net.rules = [(u) => (u === PACK_URL ? new Response(text1.slice(0, 5000), { status: 200 }) : null)];
  await refused(store.install({ url: PACK_URL }), "invalid-pack", "a truncated pack (no length to catch it)");
  const flipped = text1.replace('"name":"', '"name":"X');
  net.rules = [(u) => (u === PACK_URL ? new Response(flipped, { status: 200 }) : null)];
  await refused(store.install({ url: PACK_URL }), "invalid-pack", "a pack with one field changed (hash mismatch)");
  net.rules = [];
  await refused(store.install({ url: PACK_URL, expectedHash: v2.hash }), "hash-mismatch", "a pack that is not the expected version");
  const strict = fresh(net, { interpreterRevision: "f".repeat(40) });
  await refused(strict.store.install({ url: PACK_URL }), "unplayable", "a pack not playable on this runtime");
  assert.deepEqual(await store.list(), [], "no refused pack is stored");
  ok("1. a cut-off, truncated, altered, wrong-version or unplayable pack is refused before anything is stored");
}
{
  // Art cut off part-way: staged, never ready; the retry resumes and only fetches what is missing.
  const net = network({ [PACK_URL]: text1 });
  const at = 10;
  let fail = true;
  const { store, fake, name } = fresh(net, { retries: 0, beforeArt: (_u, i) => { if (fail && i === at) throw new TypeError("network error: tab closed"); } });
  const progress: InstallProgress[] = [];
  await refused(store.install({ url: PACK_URL }, { onProgress: (p) => progress.push(p) }), "network", "art cut off part-way");
  await notReady(store, v1.hash, "art cut off part-way");
  const staged = (await store.list())[0];
  assert.equal(staged.status, "staged");
  assert.equal(staged.artVerified, at, `the ${at} images before the cut are verified and kept`);
  assert.ok(progress.some((p) => p.phase === "pack") && progress.some((p) => p.phase === "art"), "progress was reported per phase");
  fail = false;
  net.calls.length = 0;
  const p2: InstallProgress[] = [];
  const v = await store.install({ url: PACK_URL }, { onProgress: (p) => p2.push(p) });
  assert.equal(v.status, "ready");
  assert.ok(v.active);
  assert.equal(net.calls.filter(isArtCall).length, required.length - at, "the retry fetched only the images it did not have");
  assert.equal(p2.filter((p) => p.phase === "art").at(-1)!.resumed, at, "and reported them as resumed");
  assert.deepEqual(p2.map((p) => p.phase).filter((x, i, a) => a.indexOf(x) === i), ["pack", "art", "verify", "activate", "done"], "phases in order");
  assert.equal((await store.load(v1.hash)).hash, v1.hash, "the retried install loads");
  // Nothing beyond what the store declares is written.
  assert.deepEqual([...fake.databases.get(name)!.stores.keys()].sort(), ["art", "bodies", "pointers", "versions"]);
  ok(`1. art cut off at image ${at + 1}/${required.length}: staged, never active or loadable; the retry fetched ${required.length - at} images and became ready`);
}
for (const [label, code, rule] of [
  ["404 art", "missing-art", (u: string) => (u === artUrlOf(required[5]) ? new Response("", { status: 404 }) : null)],
  ["an opaque response", "opaque", (u: string) => (u === artUrlOf(required[5]) ? opaque() : null)],
  ["a non-image", "decode", (u: string) => (u === artUrlOf(required[5]) ? new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } }) : null)],
  ["an image that does not decode", "decode", (u: string) => (u === artUrlOf(required[5]) ? new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]), { status: 200, headers: { "content-type": "image/png" } }) : null)],
  ["an empty image", "decode", (u: string) => (u === artUrlOf(required[5]) ? new Response(new Uint8Array(0), { status: 200, headers: { "content-type": "image/png" } }) : null)],
  ["a body shorter than its Content-Length", "network", (u: string) => { if (u !== artUrlOf(required[5])) return null; const img = pngFor(required[5]); return new Response(new Uint8Array(img.subarray(0, 50)), { status: 200, headers: { "content-type": "image/png", "content-length": String(img.length) } }); }],
  ["a 503 that persists", "http", (u: string) => (u === artUrlOf(required[5]) ? new Response("", { status: 503 }) : null)],
] as const) {
  const net = network({ [PACK_URL]: text1 });
  net.rules = [rule];
  const { store } = fresh(net);
  const e = await refused(store.install({ url: PACK_URL }), code, label);
  await notReady(store, v1.hash, label);
  if (label === "an opaque response") assert.match(e.message, /cannot be checksummed or decoded/, "the opaque refusal says why");
  ok(`1. ${label}: refused as ${code}, never ready`);
}
{
  // A transient failure is retried within the install.
  const net = network({ [PACK_URL]: text1 });
  let flaky = 2;
  net.rules = [(u) => (u === artUrlOf(required[3]) && flaky-- > 0 ? new Response("", { status: 503 }) : null)];
  const { store } = fresh(net, { retries: 3 });
  assert.equal((await store.install({ url: PACK_URL })).status, "ready", "two 503s and then the image: ready");
  ok("1. a transient 503 is retried and the install completes");
}
for (const damage of ["altered", "deleted"] as const) {
  // Art damaged on the device between its download and readiness: the verify phase finds it.
  const net = network({ [PACK_URL]: text1 });
  const fake = new FakeIndexedDb();
  let armed = true;
  const { store, name } = fresh(net, {}, fake);
  const onProgress = (p: InstallProgress) => {
    if (!armed || p.phase !== "verify" || p.done !== 0) return;
    armed = false;
    const rows = fake.rows(name, "art");
    const [key, row] = [...rows][7] as [string, { bytes: ArrayBuffer }];
    if (damage === "deleted") rows.delete(key);
    else { const b = new Uint8Array(row.bytes.slice(0)); b[b.length - 20] ^= 0xff; rows.set(key, { ...row, bytes: b.buffer }); }
  };
  await refused(store.install({ url: PACK_URL }, { onProgress }), damage === "deleted" ? "missing-art" : "checksum", `an image ${damage} before readiness`);
  await notReady(store, v1.hash, `an image ${damage} before readiness`);
  net.calls.length = 0;
  assert.equal((await store.install({ url: PACK_URL })).status, "ready", "the retry repairs it");
  assert.equal(net.calls.filter(isArtCall).length, 1, "by fetching only the damaged image again");
  ok(`1. an image ${damage} on the device before readiness is caught by the verify phase; the retry re-fetches just it`);
}

// ── 2. Updates keep the pinned version; failures keep the last usable one ──────────────────────
const V2_URL = "https://example.test/packs/masters-v2.json";
const net = network({ [PACK_URL]: text1, [V2_URL]: text2 });
const shared = fresh(net);
const { store, fake, name: packDb, localName } = shared;
await store.install({ url: PACK_URL });
const journal: MatchJournal = {
  format: JOURNAL_FORMAT, matchId: "saved-658", packHash: v1.hash, decks: { p1: "A", p2: "B" }, human: "p1", seed: 1, policySeed: 2,
  interpreterRevision: LOCAL_REVISION, policyVersion: "test", entries: [], aiMemory: {} as MatchJournal["aiMemory"], receipts: [], trace: "", status: "playing", interruption: null,
};
await indexedDbJournalStore({ factory: asFactory(fake), name: localName }).put(journal);
const pinnedV1 = (await store.list()).find((v) => v.hash === v1.hash)!;
assert.equal(pinnedV1.pinned, true, "the saved match's pack reads as pinned (from dbs-arena-local)");

async function v1StillServes(what: string) {
  const a = await store.active(v1.id);
  assert.equal(a?.hash, v1.hash, `${what}: v1 is still active`);
  assert.equal((await store.load(v1.hash)).hash, v1.hash, `${what}: v1 loads`);
  assert.equal((await store.art(v1.hash)).size, required.length, `${what}: v1's art reads`);
}
{
  net.rules = [(u) => (u === V2_URL ? new Response(text2.slice(0, -40), { status: 200 }) : null)];
  await refused(store.install({ url: V2_URL }), "invalid-pack", "a corrupt update");
  await v1StillServes("after a corrupt update");
  // Every image of v2 is new to the store only if v1's are gone; make one fail to force a failed art phase.
  net.rules = [];
  const before = new Map(fake.rows(packDb, "art"));
  fake.rows(packDb, "art").clear();
  net.rules = [(u) => (u === artUrlOf(required[9]) ? new Response("", { status: 404 }) : null)];
  await refused(store.install({ url: V2_URL }), "missing-art", "an update whose art fails");
  for (const [k, v] of before) fake.rows(packDb, "art").set(k, v);
  net.rules = [];
  await v1StillServes("after an update whose art failed");
  ok("2. a corrupt update and an update whose art failed leave v1 active, loadable and its art readable");

  // Quota: the device is full when the update's pack text is stored.
  await store.prune({ staged: true }); // the failed update's staged copy goes, so the update must store its text again
  assert.equal((await store.list()).length, 1, "only v1 is left");
  fake.quotaBytes = fake.usedBytes() + 1000;
  await refused(store.install({ url: V2_URL }), "quota", "an update on a full device");
  assert.equal((await store.list()).length, 1, "the aborted transaction stored nothing of v2");
  fake.quotaBytes = null;
  await v1StillServes("after the quota error");
  ok("2. an update on a full device fails as quota (QuotaExceededError) and v1 stays active and loadable");

  net.calls.length = 0;
  const up = await store.install({ url: V2_URL });
  assert.equal(up.hash, v2.hash);
  assert.ok(up.active, "v2 is active");
  assert.equal(net.calls.filter(isArtCall).length, 0, "the update reused every verified image (each re-checksummed)");
  const list = await store.list();
  const old = list.find((v) => v.hash === v1.hash);
  assert.ok(old && old.status === "ready" && !old.active && old.pinned, "v1 is kept, ready, inactive, pinned by the saved match");
  assert.equal((await store.load(v1.hash)).hash, v1.hash, "the saved match still loads its pinned v1");
  assert.equal((await store.art(v1.hash)).size, required.length, "and its art");
  await refused(store.remove(v1.hash), "pinned", "removing the pinned version");
  await refused(store.remove(v2.hash), "active", "removing the active version");
  ok("2. an update activates v2 in one step with no art download; v1 stays for the saved match and cannot be removed");

  const blind = packStore({ name: packDb, factory: asFactory(fake), fetch: net.fetch, decode: nodeDecode, interpreterRevision: LOCAL_REVISION, locks: null, pinnedHashes: async () => { throw new Error("unreadable"); } });
  const skipped = await blind.prune();
  assert.ok(skipped.skipped && skipped.versions.length === 0, "with the saves unreadable, prune deletes nothing");
  blind.close();
  fake.rows(localName, "matches").clear();
  const pruned = await store.prune();
  assert.deepEqual(pruned.versions, [v1.hash], "once the match is gone, v1 is pruned");
  assert.equal(pruned.art, 0, "and no image (v2 uses them all)");
  ok("2. unreadable saves prune nothing; once the saved match is gone, v1 is pruned and the shared art kept");
}

// ── 3. Offline ──────────────────────────────────────────────────────────────────────────────────
{
  net.offline = true;
  net.calls.length = 0;
  const reopened = packStore({ name: packDb, factory: asFactory(fake), localName, fetch: net.fetch, decode: nodeDecode, interpreterRevision: LOCAL_REVISION, locks: null });
  const a = await reopened.active(v2.id);
  assert.equal(a?.hash, v2.hash);
  const pack = await reopened.load(a!.hash);
  const art = await reopened.art(a!.hash);
  for (const url of required) {
    const blob = art.get(url)!;
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), pngFor(url), `${url}: the stored image is the one served`);
    await nodeDecode(blob);
  }
  const urls = await reopened.artUrls(a!.hash);
  const front = urls.art[pack.decks[0].deck.leader].front ?? "";
  assert.match(front, /^blob:/, "artUrls gives device-local object URLs");
  urls.revoke();
  assert.equal(net.calls.length, 0, "no network call was made");
  reopened.close();
  ok(`3. offline: the active pack loads and all ${required.length} images read, re-checksum and decode from the device with no network call`);
}

// ── 4. The service worker's activation cleanup ──────────────────────────────────────────────────
{
  const listeners: Record<string, (e: unknown) => void> = {};
  const names = ["dbs-card-art-v0", "dbs-card-art-v1", `${CACHE_PREFIXES.packs}masters`, `${CACHE_PREFIXES.shell}v3`, "workbox-precache", "other-app"];
  const deleted: string[] = [];
  const sandbox = {
    // Registered without a shell version (#659): the worker owns no shell, so it deletes none.
    self: { location: new URL("https://cards.test/sw.js"), addEventListener: (t: string, f: (e: unknown) => void) => { listeners[t] = f; }, skipWaiting() {}, clients: { claim: async () => {} } },
    caches: { keys: async () => names, delete: async (n: string) => { deleted.push(n); return true; } },
    URL, Response, fetch: () => { throw new Error("no fetch"); },
  };
  vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), sandbox);
  let done: Promise<unknown> = Promise.resolve();
  listeners.activate({ waitUntil: (p: Promise<unknown>) => { done = p; } });
  await done;
  assert.deepEqual(deleted, ["dbs-card-art-v0"], "only the worker's own old art cache is deleted");
  ok("4. sw.js activation deletes only its own old dbs-card-art-* cache; pack, shell and foreign caches survive");
}

for (const r of results) console.log(r);
console.log(`arena-pack-store: ${results.length} checks passed in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
