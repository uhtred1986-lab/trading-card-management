/**
 * Paged fetch of the deckplanet card catalog. Pure of the database and of the
 * app's schema so `scripts/verify/deckplanet-paging.ts` can drive it with a
 * fake `fetch`.
 *
 * The API caps `limit` at 500 (13 Oct 2026: `limit=100000` answers
 * `{"error":"limit must be between 1 and 500"}`) and pages are 1-based
 * (`&page=2`; `&offset=` is ignored). Page 1 carries
 * `meta: { filter_count, page_count }`. A partial catalog must never reach the
 * upsert (it would look like cards disappearing), so every inconsistency
 * throws here, before any database write.
 */
export const DECKPLANET_PAGE_SIZE = 500;
const ATTEMPTS = 3;

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}>;

interface Page<T> {
  data?: unknown;
  error?: unknown;
  meta?: { filter_count?: unknown; page_count?: unknown };
  rows: T[];
}

export function catalogPageUrl(catalogPath: string, page: number): string {
  return `https://api.deckplanet.net/cardsearch/${catalogPath}?limit=${DECKPLANET_PAGE_SIZE}&page=${page}`;
}

async function fetchPage<T>(label: string, url: string, fetchFn: FetchLike): Promise<Page<T>> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetchFn(url, { headers: { accept: "application/json" } });
      if (!res.ok) {
        const err = new Error(`deckplanet ${label} ${res.status} ${res.statusText}`);
        // 4xx will not change on a retry; 5xx might.
        throw res.status < 500 ? Object.assign(err, { final: true }) : err;
      }
      const json = (await res.json()) as (Omit<Page<T>, "rows"> | null);
      if (!json || typeof json !== "object") throw Object.assign(new Error(`deckplanet ${label}: unexpected payload`), { final: true });
      if (json.error !== undefined) {
        throw Object.assign(new Error(`deckplanet ${label}: API error ${JSON.stringify(json.error)}`), { final: true });
      }
      if (!Array.isArray(json.data)) throw Object.assign(new Error(`deckplanet ${label}: unexpected payload shape`), { final: true });
      return { ...json, rows: json.data as T[] };
    } catch (e) {
      lastError = e;
      if ((e as { final?: boolean }).final) throw e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`deckplanet ${label}: fetch failed`);
}

function countField(v: unknown, what: string, label: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new Error(`deckplanet ${label}: meta.${what} missing or invalid (${JSON.stringify(v)})`);
  }
  return v;
}

/**
 * Fetch every page of one game's catalog and return the cards deduplicated by
 * `id`. Throws unless the deduplicated total equals `meta.filter_count`.
 */
export async function fetchCatalogPages<T extends { id: number }>(
  game: string,
  catalogPath: string,
  fetchFn: FetchLike = (url, init) => fetch(url, init),
): Promise<T[]> {
  const first = await fetchPage<T>(`${game} page 1`, catalogPageUrl(catalogPath, 1), fetchFn);
  const filterCount = countField(first.meta?.filter_count, "filter_count", game);
  const pageCount = countField(first.meta?.page_count, "page_count", game);
  if (filterCount > 0 && pageCount < 1) throw new Error(`deckplanet ${game}: filter_count ${filterCount} but page_count ${pageCount}`);

  const pages: T[][] = [first.rows];
  for (let p = 2; p <= pageCount; p++) {
    const page = await fetchPage<T>(`${game} page ${p}/${pageCount}`, catalogPageUrl(catalogPath, p), fetchFn);
    if (page.rows.length === 0) throw new Error(`deckplanet ${game}: page ${p} of ${pageCount} is empty`);
    pages.push(page.rows);
  }
  // Every page but the last must be full; a short one means rows went missing.
  for (let i = 0; i < pages.length - 1; i++) {
    if (pages[i].length !== DECKPLANET_PAGE_SIZE) {
      throw new Error(`deckplanet ${game}: page ${i + 1} of ${pageCount} has ${pages[i].length} rows, expected ${DECKPLANET_PAGE_SIZE}`);
    }
  }

  const byId = new Map<number, T>();
  for (const rows of pages) for (const card of rows) if (!byId.has(card.id)) byId.set(card.id, card);
  if (byId.size !== filterCount) {
    throw new Error(`deckplanet ${game}: assembled ${byId.size} distinct cards, API reports filter_count ${filterCount}`);
  }
  return [...byId.values()];
}
