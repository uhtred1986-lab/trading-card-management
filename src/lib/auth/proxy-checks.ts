import type { PlayerClaims } from "./core";

/**
 * The database checks the proxy (and the Google callback) make, each cached
 * per process for 30 seconds so a page load's dozen requests cost one read.
 * Pages and actions re-check without the cache (`getViewer()`), so removing an
 * SL or disconnecting a device refuses the next action at once and the next
 * page on another server instance within 30 seconds. Every failure answers
 * `false` (fail closed).
 */

const CACHE_MS = 30_000;
const slCache = new Map<string, { ok: boolean; until: number }>();
const deviceCache = new Map<string, { ok: boolean; until: number }>();

function prune(cache: Map<string, { until: number }>) {
  if (cache.size > 200) for (const [k, v] of cache) if (v.until < Date.now()) cache.delete(k);
}

/** Is this normalised address an added SL (`sl_accounts`)? */
export async function checkAddedSl(email: string): Promise<boolean> {
  const hit = slCache.get(email);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    const { db } = await import("@/db");
    const { isAddedSl } = await import("./access");
    ok = await isAddedSl(db, email);
  } catch {
    ok = false;
  }
  slCache.set(email, { ok, until: Date.now() + CACHE_MS });
  prune(slCache);
  return ok;
}

/** Is the device a verified player cookie names still live and this player's? */
export async function checkPlayerDevice(claims: PlayerClaims): Promise<boolean> {
  const key = `${claims.deviceId}:${claims.tok}`;
  const hit = deviceCache.get(key);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = false;
  try {
    const { db } = await import("@/db");
    const { resolvePlayerDevice } = await import("./access");
    ok = (await resolvePlayerDevice(db, claims, new Date(), false)) !== null;
  } catch {
    ok = false;
  }
  deviceCache.set(key, { ok, until: Date.now() + CACHE_MS });
  prune(deviceCache);
  return ok;
}

/** Forget cached answers on this instance, after a change made here (a device disconnected, an SL removed). */
export function forgetAccessCache() {
  slCache.clear();
  deviceCache.clear();
}
