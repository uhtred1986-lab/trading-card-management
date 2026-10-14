/**
 * The local board's card art (#780, release blocker RB-1 of `docs/arena-offline-release.md`).
 *
 * The match's snapshots name each card's art by its catalog URL, which in airplane mode only the network
 * could answer. The installed pack holds every one of those images in the pack store (#658), verified.
 * `loadLocalArt` turns them into device-local object URLs keyed by the catalog URL, and `localizeArt`
 * swaps a snapshot's catalog URLs for them. It runs only inside the local board (`LocalBoard`), so the
 * Snapshot contract, the engine and the online `/arena/[id]` path are untouched: online has no map.
 */
import type { PackStore } from "./pack-store";

/** Catalog art URL -> an object URL of the pack store's copy of that image. */
export interface LocalArt {
  readonly hash: string;
  readonly urls: ReadonlyMap<string, string>;
  /** Free every object URL (the pack changed, or the page is leaving). */
  revoke(): void;
}

/** The ready pack `hash`'s images as object URLs. Reads the device only. */
export async function loadLocalArt(store: Pick<PackStore, "art">, hash: string): Promise<LocalArt> {
  const blobs = await store.art(hash);
  const urls = new Map<string, string>();
  for (const [url, blob] of blobs) urls.set(url, URL.createObjectURL(blob));
  return { hash, urls, revoke: () => { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); } };
}

/** `value` with every string that is a key of `urls` replaced by its object URL. Returns `value` itself when nothing matched. */
export function localizeArt<T>(value: T, urls: ReadonlyMap<string, string>): T {
  if (urls.size === 0) return value;
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return urls.get(v) ?? v;
    if (Array.isArray(v)) {
      let out: unknown[] | null = null;
      v.forEach((x, i) => { const y = walk(x); if (y !== x) (out ??= v.slice())[i] = y; });
      return out ?? v;
    }
    if (v && typeof v === "object") {
      let out: Record<string, unknown> | null = null;
      for (const [k, x] of Object.entries(v)) { const y = walk(x); if (y !== x) (out ??= { ...(v as Record<string, unknown>) })[k] = y; }
      return out ?? v;
    }
    return v;
  };
  return walk(value) as T;
}
