/**
 * #660 (plan O4-05): offline preparation and local-data controls — the Node half
 * (`src/lib/arena/local/prepare.ts`, `src/components/arena/OfflinePreparation.tsx`; the real
 * browser half is `npm run arena:offline-shell-browser`).
 *
 *   1. `assess` says ready only when the game files, the finished deck pack and every card image are
 *      on the device AND the shell can play that pack; each missing part is named.
 *   2. `updateAvailable` compares a ready device with the server's current build.
 *   3. `friendlyError` words every failure for the player, with no implementation vocabulary.
 *   4. On the real pack store (fake IndexedDB): a prepared pack reads as ready; its removal is
 *      refused while a saved match pins it and succeeds once the match is deleted, taking its images.
 *   5. `prepareShell` marks the device prepared, reports the worker's progress and only returns once
 *      the shell cache is complete; a worker that fails to install is an error.
 *   6. `clearOfflineData` deletes the caches the app owns and its two databases and unprepares the
 *      device, and leaves every other cache alone; a failed step keeps the device marked.
 *   7. `ServiceWorker.tsx` downloads no shell for an unprepared device (source check), and the
 *      curated pack id agrees with the builder's.
 *
 *   npx tsx scripts/verify/arena-offline-prep.mts      (part of `npm test`)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { PackStoreError, packStore, CACHE_PREFIXES, PACK_DB_NAME, type InstalledVersion } from "../../src/lib/arena/local/pack-store.ts";
import { LOCAL_DB_NAME, StorageError, indexedDbJournalStore } from "../../src/lib/arena/local/storage.ts";
import { JOURNAL_FORMAT, type MatchJournal } from "../../src/lib/arena/local/worker.ts";
import { PREPARED_KEY, SHELL_CACHE_PREFIX, SHELL_META_PATH, SHELL_PATH, isPreparedDevice, markPreparedDevice, type ShellMeta } from "../../src/lib/arena/local/shell.ts";
import { CURATED_PACK_ID, PrepareError, assess, clearOfflineData, deleteSavedMatches, formatBytes, friendlyError, listSavedMatches, ownedCache, prepareShell, readFacts, updateAvailable, type DeviceFacts } from "../../src/lib/arena/local/prepare.ts";
import { PACK_ID } from "../build-arena-offline-pack.mts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { auditPack, LOCAL_REVISION } from "./arena-local-worker-fixture.mts";
import { FakeIndexedDb, asFactory } from "./fake-indexeddb.ts";
import { nodeDecode, pngFor } from "./arena-pack-store-fixture.mts";

const REV_A = "a".repeat(40);
const REV_B = "b".repeat(40);
const results: string[] = [];
async function check(what: string, body: () => void | Promise<void>) {
  await body();
  results.push(`ok   ${what}`);
}

const version = (over: Partial<InstalledVersion> = {}): InstalledVersion => ({
  hash: "h".repeat(64), id: CURATED_PACK_ID, runtimeRevision: REV_A, status: "ready", active: true, pinned: false,
  artVerified: 41, artRequired: 41, bytes: 1000, startedAt: 1, readyAt: 2, ...over,
});
const shellMeta = (revision: string | null, v = "1234567890abcdef"): ShellMeta => ({ format: 1, version: v, revision, files: 10, installedAt: 5 });
const facts = (over: Partial<DeviceFacts> = {}): DeviceFacts => ({ versions: [version()], staged: [], shells: [shellMeta(REV_A)], ...over });

// A localStorage for the mark.
const ls = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => ls.get(k) ?? null, setItem: (k: string, v: string) => void ls.set(k, v), removeItem: (k: string) => void ls.delete(k) };

await check("1. assess: ready only when game files, finished pack and every image are here and the game can play the pack", () => {
  assert.deepEqual(assess({ versions: [], staged: [], shells: [] }).missing, ["game files", "deck pack", "card artwork"], "an empty device misses everything");
  assert.equal(assess(facts()).ready, true);
  assert.deepEqual(assess(facts({ shells: [] })).missing, ["game files"], "no complete shell: not ready");
  assert.equal(assess(facts({ shells: [] })).ready, false);
  assert.deepEqual(assess(facts({ versions: [] })).missing, ["deck pack", "card artwork"], "no finished pack: not ready");
  assert.deepEqual(assess(facts({ versions: [version({ artVerified: 40 })] })).missing, ["card artwork"], "one image short: not ready");
  assert.equal(assess(facts({ versions: [version({ artVerified: 0, artRequired: 0 })] })).ready, false, "a pack that names no images is not proof of anything");
  assert.equal(assess(facts({ versions: [version({ active: false })] })).ready, false, "an inactive version is not the prepared pack");
  assert.equal(assess(facts({ versions: [version({ id: "someone-elses" })] })).ready, false, "another pack is not the curated one");
  assert.deepEqual(assess(facts({ shells: [shellMeta(REV_B)] })).missing, ["game files"], "a shell of another revision cannot play the pack");
  assert.equal(assess(facts({ shells: [shellMeta(null)] })).ready, false, "an unpinned shell plays no pack");
  assert.equal(assess(facts({ shells: [shellMeta(REV_B, "fedcba0987654321"), shellMeta(REV_A)] })).shell?.revision, REV_A, "the shell that matches is the one named");
});

await check("2. updateAvailable: a ready device against the server's current build", () => {
  assert.equal(updateAvailable(facts(), null), false, "offline: nothing to compare");
  assert.equal(updateAvailable(facts(), { version: "1234567890abcdef", revision: REV_A, files: 10 }), false, "the same build");
  assert.equal(updateAvailable(facts(), { version: "aaaaaaaaaaaaaaaa", revision: REV_A, files: 10 }), true, "a newer shell");
  assert.equal(updateAvailable(facts(), { version: "1234567890abcdef", revision: REV_B, files: 10 }), true, "a newer pack revision");
  assert.equal(updateAvailable(facts({ shells: [] }), { version: "aaaaaaaaaaaaaaaa", revision: REV_A, files: 10 }), false, "a device that is not ready needs preparing, not an update");
});

await check("3. friendlyError: plain words, no implementation vocabulary", () => {
  const jargon = /indexeddb|service ?worker|cache storage|\bhash\b|checksum|sha-?256|quota|manifest|pack file|revision|\bhttp\b|transaction/i;
  const errors: unknown[] = [
    new PackStoreError("quota", "x"), new PackStoreError("network", "x"), new PackStoreError("http", "x"), new PackStoreError("missing-art", "x"), new PackStoreError("opaque", "x"),
    new PackStoreError("decode", "x"), new PackStoreError("unplayable", "x"), new PackStoreError("invalid-pack", "x"), new PackStoreError("hash-mismatch", "x"), new PackStoreError("unavailable", "x"),
    new PackStoreError("newer", "x"), new PackStoreError("pinned", "x"), new PackStoreError("corrupt", "x"), new StorageError("quota", "x"),
    new PrepareError("shell", "x"), new PrepareError("no-pack", "x"), new PrepareError("unsupported", "x"), new PrepareError("offline", "x"), new PrepareError("remove", "x"), new Error("boom"),
  ];
  for (const e of errors) {
    const f = friendlyError(e);
    assert.ok(f.headline && f.detail, `a headline and what to do for ${(e as Error).name}`);
    assert.doesNotMatch(`${f.headline} ${f.detail}`, jargon, `no jargon in ${f.headline}`);
    assert.equal(f.technical, (e as Error).message, "the original message is kept for the details line");
  }
  assert.match(friendlyError(new PackStoreError("quota", "x")).headline, /out of storage/i);
  assert.match(friendlyError(new PackStoreError("network", "x")).detail, /kept/i, "an interruption says progress is kept");
  assert.equal(formatBytes(1234567), "1.2 MB");
});

// ── 4. the real store ───────────────────────────────────────────────────────────────────────────
const pack = await auditPack();
assert.equal(pack.id, PACK_ID);
assert.equal(CURATED_PACK_ID, PACK_ID, "the page's curated pack id is the builder's");
assert.equal(pack.bundle.payload.art["SD15-02"].front, "https://storage.googleapis.com/deckplanet_card_images/SD15-02.png", "SD15-02's image is the one that answers (the snapshot's _PR print is a 404)");
const text = canonicalJson(pack);
const art = new Set<string>();
const fetchFn = (async (input: string) => {
  const url = String(input);
  if (url === "/arena/offline/pack.json") return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  const m = url.match(/^\/_next\/image\?url=([^&]+)/);
  if (m) { art.add(url); const img = pngFor(decodeURIComponent(m[1])); return new Response(new Uint8Array(img), { status: 200, headers: { "content-type": "image/png", "content-length": String(img.length) } }); }
  return new Response("", { status: 404 });
}) as unknown as typeof fetch;
const fake = new FakeIndexedDb();
const PACK_DB_NAME_FOR_FAKE = "packs-prep";
const store = packStore({ name: "packs-prep", factory: asFactory(fake), localName: "local-prep", fetch: fetchFn, decode: nodeDecode, interpreterRevision: LOCAL_REVISION, retries: 0, retryDelayMs: () => 0, locks: null });

await check("4. a prepared pack reads as ready; removal waits for the saved match and takes its images", async () => {
  await store.install({ url: "/arena/offline/pack.json" });
  const f = await readFacts(store, async () => [shellMeta(LOCAL_REVISION)]);
  const r = assess(f);
  assert.equal(r.ready, true, "a finished install plus a complete shell is ready");
  assert.equal(r.pack!.artVerified, r.pack!.artRequired);
  assert.equal(assess(await readFacts(store, async () => [])).ready, false, "without the shell it is not");

  const journal: MatchJournal = {
    format: JOURNAL_FORMAT, matchId: "saved-660", packHash: pack.hash, decks: { p1: "A", p2: "B" }, human: "p1", seed: 1, policySeed: 2,
    interpreterRevision: LOCAL_REVISION, policyVersion: "test", entries: [], aiMemory: {} as MatchJournal["aiMemory"], receipts: [], trace: "", status: "playing", interruption: null,
  };
  const journals = indexedDbJournalStore({ factory: asFactory(fake), name: "local-prep" });
  await journals.put(journal);
  const saves = await listSavedMatches({ factory: asFactory(fake), name: "local-prep" });
  assert.deepEqual(saves.map((s) => [s.matchId, s.packHash, s.over]), [["saved-660", pack.hash, false]]);

  await assert.rejects(store.remove(pack.hash, { active: true }), (e: unknown) => e instanceof PackStoreError && e.code === "pinned", "a pinned pack is not removed, even deliberately");
  await assert.rejects(store.remove(pack.hash), (e: unknown) => e instanceof PackStoreError && e.code === "pinned");
  assert.equal((await store.active(pack.id))?.hash, pack.hash, "the pack and its pointer are untouched by the refusal");
  assert.ok((fake.rows(PACK_DB_NAME_FOR_FAKE, "art")).size > 20, "its images are still here");

  await deleteSavedMatches(["saved-660"], { factory: asFactory(fake), name: "local-prep" });
  assert.equal(await journals.get("saved-660"), null, "the saved match is gone");
  assert.deepEqual(await listSavedMatches({ factory: asFactory(fake), name: "local-prep" }), []);
  await assert.rejects(store.remove(pack.hash), (e: unknown) => e instanceof PackStoreError && e.code === "active", "the active pack needs the explicit option");
  await store.remove(pack.hash, { active: true });
  assert.deepEqual(await store.list(), [], "the pack is gone");
  assert.equal(await store.active(pack.id), null, "and nothing points at it");
  assert.equal(fake.rows(PACK_DB_NAME_FOR_FAKE, "art").size, 0, "with every image no other version names");
  assert.equal(assess(await readFacts(store, async () => [shellMeta(LOCAL_REVISION)])).ready, false, "the device is no longer ready");
  journals.close();
  store.close();
});

// ── 5. preparing the shell ──────────────────────────────────────────────────────────────────────
class FakeCaches {
  readonly map = new Map<string, Map<string, Response>>();
  async keys() { return [...this.map.keys()]; }
  async has(n: string) { return this.map.has(n); }
  async delete(n: string) { return this.map.delete(n); }
  async open(n: string) {
    if (!this.map.has(n)) this.map.set(n, new Map());
    const c = this.map.get(n)!;
    return { match: async (p: string) => c.get(p)?.clone(), keys: async () => [...c.keys()].map((k) => ({ url: k })), put: async (p: string, r: Response) => void c.set(p, r) };
  }
}
const metaResponse = (version: string) => new Response(JSON.stringify({ format: 1, version, revision: REV_A, files: 3, installedAt: 9 }), { headers: { "content-type": "application/json" } });

await check("5. prepareShell: marks the device, reports progress, returns only when the shell is complete, fails when the worker does", async () => {
  const caches = new FakeCaches();
  const V = "0123456789abcdef";
  let registered = "";
  let stateListener: (() => void) | null = null;
  const worker = { state: "installing", addEventListener: (_: string, f: () => void) => { stateListener = f; } };
  const sw = {
    getRegistration: async () => undefined,
    register: async (url: string) => {
      registered = url;
      // The worker downloads: three files, then (last) the meta record.
      void (async () => {
        const c = await caches.open(SHELL_CACHE_PREFIX + V);
        for (const p of [SHELL_PATH, "/_next/static/a.js", "/_next/static/b.js"]) { await new Promise((r) => setTimeout(r, 15)); await c.put(p, new Response("x")); }
        await new Promise((r) => setTimeout(r, 15));
        await c.put(SHELL_META_PATH, metaResponse(V));
      })();
      return { installing: worker, active: null, unregister: async () => true };
    },
  };
  markPreparedDevice(false);
  assert.equal(isPreparedDevice(), false);
  const seen: number[] = [];
  await prepareShell({ version: V, revision: REV_A, files: 2 }, 2, (p) => seen.push(p.done), undefined, { serviceWorker: sw as never, caches: caches as never, pollMs: 5 });
  assert.equal(registered, `/sw.js?v=${V}`);
  assert.equal(isPreparedDevice(), true, "preparing marks the device");
  assert.equal(ls.get(PREPARED_KEY), "1");
  assert.equal(seen[seen.length - 1], 4, "the last report is complete (2 files + page + meta)");
  assert.ok(seen.some((n) => n > 0 && n < 4), "and partial progress was reported on the way");
  // Already complete: returns without registering again.
  registered = "";
  await prepareShell({ version: V, revision: REV_A, files: 2 }, 2, () => {}, undefined, { serviceWorker: sw as never, caches: caches as never, pollMs: 5 });
  assert.equal(registered, "", "a complete shell is not downloaded again");

  // A worker that fails to install.
  const failing = new FakeCaches();
  const w2 = { state: "installing", addEventListener: (_: string, f: () => void) => { stateListener = f; } };
  const sw2 = { getRegistration: async () => undefined, register: async () => { setTimeout(() => { w2.state = "redundant"; stateListener?.(); }, 20); return { installing: w2, active: null, unregister: async () => true }; } };
  await assert.rejects(prepareShell({ version: "fedcba9876543210", revision: REV_A, files: 2 }, 2, () => {}, undefined, { serviceWorker: sw2 as never, caches: failing as never, pollMs: 5 }), (e: unknown) => e instanceof PrepareError && e.code === "shell");
  assert.equal((await failing.keys()).length, 0, "nothing complete is claimed");
  // Cancelled.
  const stop = new AbortController();
  const w3 = { state: "installing", addEventListener: () => {} };
  const sw3 = { getRegistration: async () => undefined, register: async () => { setTimeout(() => stop.abort(), 20); return { installing: w3, active: null, unregister: async () => true }; } };
  await assert.rejects(prepareShell({ version: "fedcba9876543211", revision: REV_A, files: 2 }, 2, () => {}, stop.signal, { serviceWorker: sw3 as never, caches: new FakeCaches() as never, pollMs: 5 }), (e: unknown) => e instanceof PrepareError);
  // No worker support.
  await assert.rejects(prepareShell({ version: V, revision: REV_A, files: 2 }, 2, () => {}, undefined, { serviceWorker: undefined, caches: undefined }).catch((e) => { throw e; }), (e: unknown) => e instanceof PrepareError);
});

// ── 6. clearing ─────────────────────────────────────────────────────────────────────────────────
await check("6. clearOfflineData: the app's own caches, databases, pointer and worker; nothing else; the mark only when all went", async () => {
  const caches = new FakeCaches();
  for (const n of [`${CACHE_PREFIXES.cardArt}v1`, `${SHELL_CACHE_PREFIX}0123456789abcdef`, `${CACHE_PREFIXES.packs}x`, "workbox-precache-v2", "dbs-card-art", "other-app", "my-dbs-arena-shell-"]) await caches.open(n);
  assert.deepEqual((await caches.keys()).filter(ownedCache).sort(), [`${CACHE_PREFIXES.cardArt}v1`, `${CACHE_PREFIXES.packs}x`, `${SHELL_CACHE_PREFIX}0123456789abcdef`].sort(), "ownership is by prefix");
  const deleted: string[] = [];
  const idb = (failOn?: string) => ({ deleteDatabase: (n: string) => { const r = { onsuccess: null as null | (() => void), onerror: null as null | (() => void), error: null as unknown }; setTimeout(() => { if (n === failOn) { r.error = new Error("blocked"); r.onerror?.(); } else { deleted.push(n); r.onsuccess?.(); } }, 1); return r as never; } });
  let unregistered = 0;
  const sw = { getRegistrations: async () => [{ unregister: async () => { unregistered++; return true; } }] as never };
  let pointer = 0;

  markPreparedDevice(true);
  const bad = await clearOfflineData({ caches: caches as never, indexedDB: idb(LOCAL_DB_NAME), serviceWorker: sw, forgetPointer: () => { pointer++; } });
  assert.deepEqual(bad.failed, [`database ${LOCAL_DB_NAME}`], "a failed step is reported");
  assert.equal(isPreparedDevice(), true, "and the device stays marked: it is not clean");
  assert.deepEqual(deleted, [PACK_DB_NAME], "the other steps still ran");

  deleted.length = 0;
  const good = await clearOfflineData({ caches: caches as never, indexedDB: idb(), serviceWorker: sw, forgetPointer: () => { pointer++; } });
  assert.deepEqual(good.failed, []);
  assert.deepEqual(deleted.sort(), [LOCAL_DB_NAME, PACK_DB_NAME].sort(), "exactly the two app databases");
  assert.deepEqual((await caches.keys()).sort(), ["dbs-card-art", "my-dbs-arena-shell-", "other-app", "workbox-precache-v2"].sort(), "no cache the app does not own is touched");
  assert.ok(unregistered >= 2 && pointer >= 2, "the worker is unregistered and the pointer forgotten");
  assert.equal(isPreparedDevice(), false, "the device is unprepared");
});

await check("7. an unprepared device downloads no shell; the curated pack id is the builder's", () => {
  const src = fs.readFileSync("src/components/ServiceWorker.tsx", "utf8");
  const gate = src.indexOf("isPreparedDevice()");
  const shellFetch = src.indexOf("SHELL_MANIFEST_PATH, {");
  assert.ok(gate > 0 && shellFetch > gate, "the shell list is read only after the prepared check");
  assert.match(src.slice(gate, shellFetch), /register\("\/sw\.js"\)[\s\S]*return;/, "an unprepared device registers the art-only worker and stops");
  assert.doesNotMatch(src.slice(gate, shellFetch), /sw\.js\?v=/, "and never a versioned one");
});

console.log(results.join("\n"));
console.log(`arena-offline-prep: ${results.length} checks passed`);
