/**
 * Query-level caching for data that only a sync (or one named writer) changes
 * — issue #383. Whole-page `revalidate` is not an option here: the root layout
 * reads a cookie and Basic Auth fronts every page, so every page is dynamic.
 * What is cached instead is the *result of a read*, in Next's data cache,
 * tagged by what it was read from:
 *
 * - `catalog` — `card_sets`, `cards`, `card_prints`.
 * - `prices`  — `tcg_groups`, `tcg_products`, `tcg_prices`, `fx_rates`.
 * - `meta`    — `meta_events`, `meta_results`, `meta_result_cards`.
 *
 * **Every writer of one of those tables expires its tag** — the route
 * handlers and server actions that call a sync, and `setSpecifiedCostAction`
 * (see `src/lib/cache/reads.ts` for the full list). The CLI scripts
 * (`sync:*`) run outside Next and cannot reach its cache, so every entry also
 * carries a TTL: `CACHE_TTL_SECONDS` is the most a script's write can stay
 * unseen.
 *
 * Never cache anything that reads ownership, decks, the collection, arena
 * state or a login here: the cache is shared by every viewer.
 *
 * `unstable_cache` rather than `"use cache"`: in this Next version the
 * directive needs `cacheComponents`, which forbids the `dynamic` segment
 * config every page in the app exports — adopting it is an app-wide migration,
 * not a query cache. `unstable_cache` works without the flag.
 */
import { revalidateTag, unstable_cache, updateTag } from "next/cache";

export const CACHE_TAGS = ["catalog", "prices", "meta"] as const;
export type CacheTag = (typeof CACHE_TAGS)[number];

/** 24 h: the backstop for writes made where no tag can be expired (the CLI syncs). */
export const CACHE_TTL_SECONDS = 24 * 60 * 60;

/**
 * How a result crosses the cache. `unstable_cache` stores `JSON.stringify` of
 * the result and hands back `JSON.parse` of it on a hit, so a `Date` comes back
 * a string and a `Map` comes back `{}`. `encode` turns the result into plain
 * JSON; `decode` must accept **both** the fresh encoded value (a miss returns
 * it without a round trip) and its JSON round trip (a hit).
 */
export interface Codec<R, S> {
  encode(value: R): S;
  decode(stored: S): R;
}

const names = new Set<string>();

/**
 * Wrap a read in the data cache. `name` is the cache key's fixed part and must
 * be unique: every wrapper shares one inner function, so the name is all that
 * tells two of them apart. Arguments join the key through `JSON.stringify`, so
 * pass plain values only — never the `db` handle.
 */
export function cachedRead<A extends unknown[], R, S = R>(name: string, tags: readonly CacheTag[], fn: (...args: A) => Promise<R>, codec?: Codec<R, S>): (...args: A) => Promise<R> {
  if (names.has(name)) throw new Error(`cachedRead: "${name}" is already taken — two reads would share one cache key`);
  names.add(name);
  const inner = unstable_cache(
    async (...args: A) => {
      const value = await fn(...args);
      return codec ? codec.encode(value) : value;
    },
    ["cached-read", name],
    { tags: [...tags], revalidate: CACHE_TTL_SECONDS },
  );
  return async (...args: A) => {
    const stored = await inner(...args);
    return codec ? codec.decode(stored as S) : (stored as R);
  };
}

/** Revive the named `Date` fields of each row (a hit hands them back as ISO strings). */
export function datesCodec<T extends object>(...fields: (keyof T)[]): Codec<T[], T[]> {
  return {
    encode: (rows) => rows,
    decode: (rows) => rows.map((r) => reviveDates(r, fields)),
  };
}

export function reviveDates<T extends object>(row: T, fields: (keyof T)[]): T {
  const out = { ...row };
  for (const f of fields) {
    const v = out[f] as unknown;
    if (typeof v === "string" || typeof v === "number") (out as Record<keyof T, unknown>)[f] = new Date(v);
  }
  return out;
}

/** A `Map` stored as its entries. */
export function mapCodec<K, V>(): Codec<Map<K, V>, [K, V][]> {
  return {
    encode: (m) => [...m.entries()],
    decode: (entries) => new Map(entries),
  };
}

/**
 * Expire tags from a **route handler** (the sync crons). Immediate expiry
 * rather than stale-while-revalidate: the next view after a sync reads fresh
 * rows instead of one more round of yesterday's.
 */
export function expireTagsFromRoute(...tags: CacheTag[]): void {
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
}

/** Expire tags from a **server action**: read-your-own-writes, the next render waits for fresh data. */
export function expireTagsFromAction(...tags: CacheTag[]): void {
  for (const tag of tags) updateTag(tag);
}
