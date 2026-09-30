/**
 * The query cache of issue #383 (`src/lib/cache/tags.ts`), checked outside a
 * request — no database, no network, no dev server.
 *
 * `unstable_cache` runs outside a request when `globalThis.__incrementalCache`
 * holds an IncrementalCache, so this builds Next's own IncrementalCache over a
 * small in-memory handler and drives the real `cachedRead` through it. That
 * proves what the dev-server query log would show — a second read with the
 * same arguments never calls the query function — plus the two things a query
 * log cannot: a hit hands back JSON (so a `Date` or a `Map` needs its codec),
 * and expiring a tag makes only the reads carrying it run again.
 *
 * It then holds the wiring to account by reading source: every writer named in
 * `src/lib/cache/reads.ts` still expires its tags, and no cached read touches
 * the collection, decks or a login.
 */
import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";

// Next's server modules expect this global, which its own server installs at boot.
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage = AsyncLocalStorage;
const { IncrementalCache } = await import("next/dist/server/lib/incremental-cache/index.js");
const { CACHE_TTL_SECONDS, cachedRead, datesCodec, mapCodec, reviveDates } = await import("../src/lib/cache/tags.ts");

interface Entry {
  value: { revalidate?: number };
  tags: string[];
  lastModified: number;
}

/** The smallest cache handler IncrementalCache accepts: a Map, with tag expiry. */
class MemoryHandler {
  static store = new Map<string, Entry>();
  static expired = new Set<string>();
  async get(key: string) {
    const e = MemoryHandler.store.get(key);
    if (!e || e.tags.some((t) => MemoryHandler.expired.has(t))) return null;
    return { value: e.value, lastModified: e.lastModified };
  }
  async set(key: string, data: Entry["value"], ctx: { tags?: string[] }) {
    MemoryHandler.store.set(key, { value: data, tags: ctx.tags ?? [], lastModified: Date.now() });
    for (const t of ctx.tags ?? []) MemoryHandler.expired.delete(t);
  }
  async revalidateTag(tags: string | string[]) {
    for (const t of [tags].flat()) MemoryHandler.expired.add(t);
  }
  resetRequestCache() {}
}

const incrementalCache = new IncrementalCache({
  dev: false,
  minimalMode: false,
  requestHeaders: {},
  getPrerenderManifest: () => ({ version: 4, routes: {}, dynamicRoutes: {}, notFoundRoutes: [], preview: { previewModeId: "verify-cache" } }),
  CurCacheHandler: MemoryHandler,
  fetchCacheKeyPrefix: "",
} as never);
(globalThis as { __incrementalCache?: unknown }).__incrementalCache = incrementalCache;

// ── A second read with the same arguments issues no query ────────────────────
const calls: string[] = [];
const getCardLike = cachedRead(
  "verify:getCard",
  ["catalog"],
  async (id: string) => {
    calls.push(id);
    return { id, name: `card ${id}`, firstSeenAt: new Date("2026-09-01T00:00:00Z"), updatedAt: new Date("2026-09-02T00:00:00Z") };
  },
  { encode: (c) => c, decode: (c) => reviveDates(c, ["firstSeenAt", "updatedAt"]) },
);

const first = await getCardLike("BT18-020");
const second = await getCardLike("BT18-020");
assert.deepEqual(calls, ["BT18-020"], "the second read of the same card must come from the cache");
assert.deepEqual(second, first, "a hit returns what the miss returned");
assert.ok(second.firstSeenAt instanceof Date && second.updatedAt instanceof Date, "the codec revives the Date columns a hit hands back as strings");
await getCardLike("FB01-001");
assert.deepEqual(calls, ["BT18-020", "FB01-001"], "different arguments are a different key");

// Every stored entry carries the TTL backstop the CLI syncs rely on.
assert.ok(MemoryHandler.store.size >= 2, "the reads above were stored");
for (const e of MemoryHandler.store.values()) assert.equal(e.value.revalidate, CACHE_TTL_SECONDS, "every entry expires within the TTL");

// Without a codec a hit really is JSON: a Date comes back a string. This is why the codecs exist.
const raw = cachedRead("verify:raw", ["catalog"], async () => ({ at: new Date(0) }));
await raw();
assert.equal(typeof (await raw()).at, "string", "unstable_cache hands a hit back through JSON");

// ── Maps and date lists survive the round trip ───────────────────────────────
let mapCalls = 0;
const prices = cachedRead(
  "verify:prices",
  ["prices"],
  async (ids: string[]) => {
    mapCalls++;
    return new Map(ids.map((id) => [id, { normalCents: 100 }]));
  },
  mapCodec<string, { normalCents: number }>(),
);
const missMap = await prices(["a", "b"]);
const hitMap = await prices(["a", "b"]);
assert.equal(mapCalls, 1);
assert.ok(missMap instanceof Map && hitMap instanceof Map, "a Map on a miss and on a hit");
assert.deepEqual([...hitMap.entries()], [...missMap.entries()]);

const recent = cachedRead("verify:recent", ["catalog"], async () => [{ id: "FB05-001", firstSeenAt: new Date("2026-09-20T00:00:00Z") }], datesCodec<{ id: string; firstSeenAt: Date }>("firstSeenAt"));
await recent();
const recentHit = await recent();
assert.ok(recentHit[0].firstSeenAt instanceof Date && recentHit[0].firstSeenAt.toISOString() === "2026-09-20T00:00:00.000Z");

// ── Expiring a tag re-runs only the reads that carry it ──────────────────────
let metaCalls = 0;
const board = cachedRead("verify:meta", ["meta"], async () => {
  metaCalls++;
  return [1, 2, 3];
});
await board();
await board();
assert.equal(metaCalls, 1);

await incrementalCache.revalidateTag(["catalog"], undefined as never);
await getCardLike("BT18-020");
assert.deepEqual(calls, ["BT18-020", "FB01-001", "BT18-020"], "a catalog sync makes the next card view read the database again");
await prices(["a", "b"]);
await board();
assert.equal(mapCalls, 1, "expiring catalog leaves prices cached");
assert.equal(metaCalls, 1, "expiring catalog leaves meta cached");

await incrementalCache.revalidateTag(["meta"], undefined as never);
await board();
assert.equal(metaCalls, 2, "expiring meta re-reads the leaderboard");

// ── One name, one key ────────────────────────────────────────────────────────
assert.throws(() => cachedRead("verify:meta", ["meta"], async () => 0), /already taken/, "two reads may never share a key");

// ── Wiring: every writer still expires its tags ──────────────────────────────
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const writers: [file: string, needle: RegExp, why: string][] = [
  ["src/app/api/sync/prices/route.ts", /expireTagsFromRoute\("prices", "catalog"\)/, "the price cron writes prices and backfills card art"],
  ["src/app/api/sync/meta/route.ts", /expireTagsFromRoute\("meta"\)/, "the meta cron writes meta results"],
  ["src/app/settings/actions.ts", /quietly\(\["catalog"\], \(\) => runSync\(db, "catalog"/, "Settings → sync catalog"],
  ["src/app/settings/actions.ts", /quietly\(\["catalog"\], \(\) => runSync\(db, "cardtrader"/, "Settings → CardTrader writes leader faces"],
  ["src/app/settings/actions.ts", /quietly\(\["prices", "catalog"\], async/, "Settings → sync prices"],
  ["src/app/settings/actions.ts", /quietly\(\["meta"\], \(\) => runSync\(db, "meta"/, "Settings → sync meta"],
  ["src/app/settings/actions.ts", /expireTagsFromAction\(\.\.\.tags\)/, "quietly expires what it was given"],
];
for (const [file, needle, why] of writers) assert.match(src(file), needle, `${file}: ${why}`);
const arena = src("src/app/arena/actions.ts");
const specified = arena.slice(arena.indexOf("export async function setSpecifiedCostAction"));
assert.match(specified.slice(0, specified.indexOf("\n}\n")), /expireTagsFromAction\("catalog"\)/, "setSpecifiedCostAction writes cards.specified_cost");

// The shared cache must never hold anything per viewer.
const reads = src("src/lib/cache/reads.ts")
  .split("\n")
  .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
  .join("\n");
for (const banned of [/ownedCards|owned_cards/, /deckCards|deck_cards|@\/lib\/decks/, /@\/lib\/collection/, /@\/lib\/arena/, /@\/lib\/auth/, /ownedLeaders|searchCards/]) {
  assert.doesNotMatch(reads, banned, `src/lib/cache/reads.ts must not cache per-viewer data (${banned})`);
}

console.log("verify-cache: ok");
