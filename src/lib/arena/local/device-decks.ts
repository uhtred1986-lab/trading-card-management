/**
 * A player's decks on this device (#793): the names a deck goes by in the device's one pack, the
 * check the server gives for it, and what the device does to add, update or remove one.
 *
 * The device holds ONE pack under the curated pack's id (`CURATED_PACK_ID`): the built-in starters
 * plus every deck the player chose. Adding a deck, or updating one whose list changed online, asks
 * the server (`/api/arena/offline/pack?decks=…`, signed in) for a new pack with the whole set and
 * installs it through the pack store (#658): staged → every image verified → one transaction moves
 * the pointer, so the old version stays playable until the new one is complete, an interrupted
 * download resumes, and a saved match keeps its pinned version. Removing a deck needs no server:
 * the device rebuilds the pack without it from what it already holds (`packWithout`, the same
 * portable `makeOfflinePack` the server seals with) and installs that.
 *
 * Browser-safe: no `node:`, no database, no auth. Shared with the server
 * (`src/lib/arena/offline-decks.ts`) for the keys, the check's shape and the list fingerprint.
 */
import { canonicalJson, replayHash } from "../replay-core";
import type { DeckInput } from "../types";
import { makeOfflinePack, requiredManifest, type OfflinePack } from "./pack";
import type { InstallOptions, InstalledVersion, PackStore } from "./pack-store";
import { PACK_PATH } from "./shell";
import { CURATED_PACK_ID, deleteSavedMatches, listSavedMatches, type SavedMatch } from "./prepare";

/** The curated pack's id, which the device pack keeps: one pointer, one pack per device. */
export const DEVICE_PACK_ID = CURATED_PACK_ID;
export const DEVICE_PACK_API = "/api/arena/offline/pack";
export const DEVICE_DECKS_API = "/api/arena/offline/decks";
/** What the server adds to the pack's `source.audit` when it carries a player's deck. */
export const PLAYER_DECKS_SOURCE = "; player decks: the app's catalog and stored card_rules records (#793)";

/** The pack key of a player's deck: `deck-<id>`. The built-in starters keep their own keys (`A`, `B`). */
export const offlineDeckKey = (deckId: number) => `deck-${deckId}`;

/** The deck id of a pack key, or null for a built-in starter. */
export function deckIdOfKey(key: string): number | null {
  const m = /^deck-(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
}

/**
 * The fingerprint of a deck list (`replayHash` of its `DeckInput`). The server reports the current
 * one; the device computes it from the deck it holds, and a difference means the list changed online.
 */
export const deckListHash = (deck: DeckInput): Promise<string> => replayHash({ name: deck.name, leader: deck.leader, main: deck.main, ...(deck.z?.length ? { z: deck.z } : {}) });

export interface BlockingCard {
  card: string;
  name: string;
  /** Plain words, one per problem. */
  reasons: string[];
}

/** The server's answer for one deck (`checkOfflineDecks`). */
export interface OfflineDeckCheck {
  deckId: number;
  key: string;
  name: string;
  /** True when the deck can be downloaded. */
  ready: boolean;
  /** Problems of the deck as a whole (no leader, wrong game). */
  problems: string[];
  /** The cards that keep it off the device, and why. */
  blocking: BlockingCard[];
  /** The list's fingerprint (`deckListHash`), null when the deck cannot be read as a game deck. */
  listHash: string | null;
}

/** Where the device pack with `deckIds` is downloaded from: the public starter pack when there are none. */
export function devicePackUrl(deckIds: readonly number[]): string {
  const ids = [...new Set(deckIds)].sort((a, b) => a - b);
  return ids.length ? `${DEVICE_PACK_API}?decks=${ids.join(",")}` : PACK_PATH;
}

/** One deck the device pack holds. */
export interface DeviceDeck {
  key: string;
  /** The app's deck id; null for a built-in starter. */
  deckId: number | null;
  name: string;
  leader: string;
  /** The list's fingerprint, to compare with the server's. */
  listHash: string;
  /** Distinct card faces with a picture. */
  images: number;
  /** The art URLs of its cards, both faces. */
  artUrls: string[];
}

export interface DevicePack {
  version: InstalledVersion;
  pack: OfflinePack;
  decks: DeviceDeck[];
}

/** The device's pack and the decks in it, read from the device only; null when there is none. */
export async function readDevicePack(store: Pick<PackStore, "active" | "load">): Promise<DevicePack | null> {
  const version = await store.active(DEVICE_PACK_ID);
  if (!version) return null;
  const pack = await store.load(version.hash);
  const decks: DeviceDeck[] = [];
  for (const d of pack.decks) {
    const ids = [...new Set([d.deck.leader, ...d.deck.main, ...(d.deck.z ?? [])])];
    const urls = new Set<string>();
    for (const id of ids) {
      const art = pack.bundle.payload.art[id];
      if (art?.front) urls.add(art.front);
      if (art?.back) urls.add(art.back);
    }
    const def = pack.bundle.payload.defs[d.deck.leader];
    decks.push({ key: d.key, deckId: deckIdOfKey(d.key), name: d.name, leader: def?.name ?? d.deck.leader, listHash: await deckListHash(d.deck), images: urls.size, artUrls: [...urls] });
  }
  return { version, pack, decks };
}

/** The app deck ids the device pack holds. */
export const deviceDeckIds = (device: DevicePack | null): number[] => (device?.decks ?? []).map((d) => d.deckId).filter((n): n is number => n !== null);

/**
 * The checks for `deckIds` from the server, or null when they cannot be read (offline, signed out,
 * a build without the route). A deck that is not the player's, or no longer exists, is absent.
 */
export async function fetchDeckChecks(deckIds: readonly number[], doFetch: typeof fetch = (...a) => fetch(...a)): Promise<Map<number, OfflineDeckCheck> | null> {
  if (!deckIds.length) return new Map();
  try {
    const res = await doFetch(`${DEVICE_DECKS_API}?ids=${[...new Set(deckIds)].join(",")}`, { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return null;
    const body = (await res.json()) as { decks?: OfflineDeckCheck[] };
    return new Map((body.decks ?? []).map((c) => [c.deckId, c]));
  } catch {
    return null;
  }
}

/** Put exactly `deckIds` (plus the starters) on the device: one new pack version, installed atomically. */
export function installDeviceDecks(store: Pick<PackStore, "install">, deckIds: readonly number[], options: InstallOptions = {}): Promise<InstalledVersion> {
  return store.install({ url: devicePackUrl(deckIds) }, options);
}

/**
 * The pack without the deck `key`, rebuilt on the device from what it holds: the remaining decks, and
 * only the definitions, programs and art they need. Sealed and validated by `makeOfflinePack`; the
 * interpreter revision, rulesets, blockers and the remaining decks are kept exactly. A built-in
 * starter cannot be removed this way: the starters always stay, so a fresh match is always possible.
 */
export async function packWithout(pack: OfflinePack, key: string): Promise<OfflinePack> {
  if (deckIdOfKey(key) === null) throw new Error(`${key} is a built-in deck; it stays on the device`);
  if (!pack.decks.some((d) => d.key === key)) throw new Error(`the pack on this device has no deck ${key}`);
  const decks = pack.decks.filter((d) => d.key !== key);
  const p = pack.bundle.payload;
  const { manifest } = requiredManifest(decks, p.defs, pack.dependencies, Object.keys(p.rulesetFiles));
  const keep = new Set(manifest.cards.map((c) => c.card));
  const pick = <T,>(rec: Record<string, T>, ok: (k: string) => boolean) => Object.fromEntries(Object.entries(rec).filter(([k]) => ok(k)));
  const stillPlayer = decks.some((d) => deckIdOfKey(d.key) !== null);
  return makeOfflinePack({
    id: pack.id,
    defs: pick(p.defs, (k) => keep.has(k)),
    scripts: pick(p.scripts, (k) => keep.has(k.replace(/#back$/, ""))),
    art: pick(p.art, (k) => keep.has(k)),
    rulesetFiles: p.rulesetFiles,
    runtimeRevision: pack.compatibility.runtimeRevision,
    source: stillPlayer ? pack.source : { ...pack.source, audit: pack.source.audit.replace(PLAYER_DECKS_SOURCE, "") },
    decks,
    dependencies: pack.dependencies.filter((d) => keep.has(d.from)),
    missingInputs: pack.missingInputs.filter((m) => keep.has(m.card)),
    blockers: pack.blockers,
  });
}

/** Take one of the player's decks off the device, with no connection: a new version without it. */
export async function removeDeviceDeck(store: Pick<PackStore, "install">, pack: OfflinePack, key: string, options: InstallOptions = {}): Promise<InstalledVersion> {
  return store.install({ text: canonicalJson(await packWithout(pack, key)) }, options);
}

/** The saved-match pointer's key (`POINTER_KEY` of `src/components/arena/session/local-board.ts`; the proof checks they agree). */
export const LOCAL_POINTER_KEY = "dbs-arena-local-pointer";

/** The saved matches that play `key` in either seat. */
export const matchesUsing = (saves: readonly SavedMatch[], key: string) => saves.filter((s) => s.decks?.p1 === key || s.decks?.p2 === key);

/**
 * Take a deck off the device: the saved matches that play it are deleted first (the caller has said
 * so to the player), the pointer forgotten if it named one, then the pack without the deck is
 * installed and the versions nothing uses any more are pruned. Saved matches of other decks keep
 * their pinned version and play on.
 */
export async function takeDeckOff(store: Pick<PackStore, "install" | "prune">, device: DevicePack, key: string, options: InstallOptions & { saves?: readonly SavedMatch[] } = {}): Promise<InstalledVersion> {
  const using = matchesUsing(options.saves ?? (await listSavedMatches().catch(() => [])), key);
  if (using.length) {
    await deleteSavedMatches(using.map((s) => s.matchId));
    try {
      const raw = localStorage.getItem(LOCAL_POINTER_KEY);
      const pointer = raw ? (JSON.parse(raw) as { matchId?: unknown }) : null;
      if (pointer && using.some((s) => s.matchId === pointer.matchId)) localStorage.removeItem(LOCAL_POINTER_KEY);
    } catch { /* no storage: no pointer to forget */ }
  }
  const v = await removeDeviceDeck(store, device.pack, key, options);
  await store.prune().catch(() => undefined);
  return v;
}

/** About how much of the device each deck's pictures take (an image two decks share counts for both). */
export async function deckBytes(store: Pick<PackStore, "art">, device: DevicePack): Promise<Map<string, number>> {
  const blobs = await store.art(device.version.hash);
  return new Map(device.decks.map((d) => [d.key, d.artUrls.reduce((n, u) => n + (blobs.get(u)?.size ?? 0), 0)]));
}
