/**
 * The deckplanet catalog fetch pages at limit=500 and refuses to return a
 * partial catalog. Fake `fetch`, no network, no database.
 *
 * Part of `npm test`.
 */
import assert from "node:assert/strict";
import { DECKPLANET_PAGE_SIZE as SIZE, catalogPageUrl, fetchCatalogPages, type FetchLike } from "../../src/lib/catalog/deckplanet-fetch";

type Card = { id: number };
const cards = (from: number, n: number): Card[] => Array.from({ length: n }, (_, i) => ({ id: from + i }));

/** Serve `pages[p-1]` for `&page=p`, with the given meta; records the URLs asked. */
function fake(pages: unknown[], meta: unknown, calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url);
    const p = Number(new URL(url).searchParams.get("page"));
    const body = pages[p - 1];
    const json = body && typeof body === "object" && !Array.isArray(body) ? body : { data: body, meta };
    return { ok: true, status: 200, statusText: "OK", json: async () => json };
  };
}

async function rejects(p: Promise<unknown>, re: RegExp) {
  await assert.rejects(p, re);
}

// URL shape: limit=500, 1-based page.
assert.equal(catalogPageUrl("fusion_world_cards", 2), "https://api.deckplanet.net/cardsearch/fusion_world_cards?limit=500&page=2");

// Multi-page assembly: 500 + 500 + 120.
{
  const calls: string[] = [];
  const out = await fetchCatalogPages<Card>("dbs", "x", fake([cards(1, SIZE), cards(1 + SIZE, SIZE), cards(1 + 2 * SIZE, 120)], { filter_count: 1120, page_count: 3 }, calls));
  assert.equal(out.length, 1120);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((u, i) => u.includes("limit=500") && u.endsWith(`page=${i + 1}`)));
}

// Single page.
assert.equal((await fetchCatalogPages<Card>("dbs", "x", fake([cards(1, 7)], { filter_count: 7, page_count: 1 }))).length, 7);

// Dedupe by id across a page boundary (filter_count counts distinct cards).
{
  const p1 = cards(1, SIZE);
  const p2 = [...cards(SIZE, 1), ...cards(SIZE + 1, 9)]; // id SIZE repeats
  const out = await fetchCatalogPages<Card>("dbs", "x", fake([p1, p2], { filter_count: SIZE + 9, page_count: 2 }));
  assert.equal(out.length, SIZE + 9);
  assert.equal(new Set(out.map((c) => c.id)).size, out.length);
}

// Error object -> throws (even with HTTP 200), on page 1 and on a later page.
await rejects(fetchCatalogPages<Card>("dbs", "x", fake([{ error: "limit must be between 1 and 500" }], null)), /API error.*limit must be/);
await rejects(
  fetchCatalogPages<Card>("dbs", "x", fake([cards(1, SIZE), { error: "boom" }], { filter_count: SIZE + 5, page_count: 2 })),
  /page 2\/2.*API error/,
);

// Missing / empty page before the last.
await rejects(fetchCatalogPages<Card>("dbs", "x", fake([cards(1, SIZE), []], { filter_count: SIZE + 5, page_count: 2 })), /page 2 of 2 is empty/);
await rejects(fetchCatalogPages<Card>("dbs", "x", fake([cards(1, SIZE)], { filter_count: SIZE + 5, page_count: 2 })), /unexpected payload shape|empty/);

// Short page before the last.
await rejects(
  fetchCatalogPages<Card>("dbs", "x", fake([cards(1, SIZE - 1), cards(SIZE, 5)], { filter_count: SIZE + 4, page_count: 2 })),
  /page 1 of 2 has 499 rows/,
);

// Count mismatch.
await rejects(fetchCatalogPages<Card>("dbs", "x", fake([cards(1, SIZE), cards(SIZE + 1, 5)], { filter_count: SIZE + 6, page_count: 2 })), /filter_count/);

// Missing meta.
await rejects(fetchCatalogPages<Card>("dbs", "x", fake([cards(1, 3)], undefined)), /meta\.filter_count/);

// HTTP failure: 4xx is not retried, 5xx is retried then succeeds.
{
  let n = 0;
  const bad: FetchLike = async () => (n++, { ok: false, status: 400, statusText: "Bad", json: async () => ({}) });
  await rejects(fetchCatalogPages<Card>("dbs", "x", bad), /400/);
  assert.equal(n, 1);
  let m = 0;
  const flaky: FetchLike = async () => {
    if (m++ === 0) return { ok: false, status: 503, statusText: "Unavailable", json: async () => ({}) };
    return { ok: true, status: 200, statusText: "OK", json: async () => ({ data: cards(1, 2), meta: { filter_count: 2, page_count: 1 } }) };
  };
  assert.equal((await fetchCatalogPages<Card>("dbs", "x", flaky)).length, 2);
  assert.equal(m, 2);
}

console.log("verify deckplanet-paging: ok");
