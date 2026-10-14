/**
 * The offline shell (#659, plan O4-04): one page, `/arena/offline`, and the static files of the build
 * that serves it, kept by `public/sw.js` in a Cache Storage cache of their own so the prepared app
 * cold-launches with no network and plays a local match from an installed pack (`./pack-store.ts`).
 *
 * What goes in a shell cache, and nothing else:
 *   - the shell page, fetched by the worker with `credentials: "omit"` (no cookie, no Basic header),
 *     so the HTML is what a signed-out stranger gets. It is prerendered at build (`force-static`) and
 *     exempt from sign-in in `src/proxy.ts`; it reads no data, so there is nothing private in it;
 *   - every file under `/_next/static/` of that build (content-hashed JS, CSS and fonts — already
 *     public, the proxy never matched them), the web-app manifest and its icons (all
 *     exempt from sign-in already);
 *   - a meta record (`SHELL_META_PATH`) written LAST: a cache without it is an interrupted install
 *     and is never served.
 * Never a signed-in page, an API body, a redirect, or a response to a request that carried
 * credentials. The list is the build's (`/arena/offline/shell.json`), checked against
 * `isShellAsset` by the worker before a single file is fetched.
 *
 * Versions: the manifest's `version` is a digest of its file list and revision, so a new build is a
 * new version and an unchanged one is not. `ServiceWorker.tsx` registers `/sw.js?v=<version>`; a new
 * version installs into a NEW cache beside the old one and waits — no `skipWaiting`, no
 * `clients.claim` — until every window of the app is closed, so a running match is never switched
 * to other JS. A failed install deletes only its own partial cache and leaves the previous shell
 * active. On activation the current and the newest previous complete shell are kept; the previous
 * one stays reachable at `/arena/offline?shell=<version>`, for a saved match played on its revision.
 *
 * Compatibility: a pack is played by the shell whose interpreter revision is the pack's
 * (`compatibility.runtimeRevision`); `shellRefusal` says why any other pair is refused.
 *
 * Browser-safe: no `node:`, no database, no auth. The worker (`public/sw.js`) is plain JS and keeps
 * its own copy of these constants; `scripts/verify/arena-offline-shell.mts` checks they agree.
 */
export const SHELL_PATH = "/arena/offline";
export const SHELL_MANIFEST_PATH = "/arena/offline/shell.json";
/** The completeness marker inside a shell cache; a key only, never requested from the network. */
export const SHELL_META_PATH = "/__dbs-arena-shell/meta";
/** `CACHE_PREFIXES.shell` of `./pack-store.ts` (not imported, so the root layout's bundle stays free of the store). */
export const SHELL_CACHE_PREFIX = "dbs-arena-shell-";
export const SHELL_FORMAT = 1;
/** How many complete shells activation keeps: the current one and the newest before it. */
export const SHELL_KEEP = 2;
export const SHELL_VERSION_PATTERN = /^[0-9a-f]{16}$/;
/** The curated deck pack, built with this build (`/arena/offline/pack.json`, public: card text, rules and public art URLs only). */
export const PACK_PATH = "/arena/offline/pack.json";
/**
 * The device's "prepared for offline play" mark (#660): set by the preparation flow, read by
 * `ServiceWorker.tsx`. Until it is set a device keeps only the card-art worker and downloads no
 * shell; once set, every deploy's shell is downloaded and kept up to date. Removing all offline
 * data clears it.
 */
export const PREPARED_KEY = "dbs-arena-offline-prepared";

export function isPreparedDevice(): boolean {
  try { return localStorage.getItem(PREPARED_KEY) === "1"; } catch { return false; }
}

export function markPreparedDevice(prepared: boolean): void {
  try { if (prepared) localStorage.setItem(PREPARED_KEY, "1"); else localStorage.removeItem(PREPARED_KEY); } catch { /* no storage: the device cannot be prepared */ }
}

export interface ShellManifest {
  format: typeof SHELL_FORMAT;
  /** A digest of `revision` and `files`: the cache name's suffix. */
  version: string;
  /** The interpreter revision this build runs (a commit SHA), or null for an unpinned build. */
  revision: string | null;
  /** The page the worker precaches. */
  shell: typeof SHELL_PATH;
  /** Same-origin paths to precache, sorted, each passing `isShellAsset`. */
  files: string[];
}

export interface ShellMeta {
  format: number;
  version: string;
  revision: string | null;
  files: number;
  installedAt: number;
}

/** A path the shell may cache: the build's public static files, the manifest and its icons. Never a page, an API or a query. */
export function isShellAsset(path: string): boolean {
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("?") || path.includes("#") || path.includes("..") || path.includes("//")) return false;
  return path.startsWith("/_next/static/") || /^\/icons\/[\w.-]+$/.test(path) || path === "/manifest.webmanifest";
}

/** The manifest's problems; empty when the worker may install it. */
export function shellManifestProblems(m: unknown): string[] {
  if (!m || typeof m !== "object") return ["not an object"];
  const r = m as Record<string, unknown>;
  const out: string[] = [];
  if (r.format !== SHELL_FORMAT) out.push(`format ${String(r.format)} is not ${SHELL_FORMAT}`);
  if (typeof r.version !== "string" || !SHELL_VERSION_PATTERN.test(r.version)) out.push("no version");
  if (r.revision !== null && (typeof r.revision !== "string" || !/^[0-9a-f]{40}$/.test(r.revision))) out.push("revision is neither null nor a commit SHA");
  if (r.shell !== SHELL_PATH) out.push(`shell is not ${SHELL_PATH}`);
  if (!Array.isArray(r.files) || r.files.length === 0) out.push("no files");
  else for (const f of r.files) if (!isShellAsset(f as string)) out.push(`${String(f)} may not be cached by the shell`);
  return out;
}

/** Why this shell will not play a pack of `packRevision`, or null when it will. */
export function shellRefusal(shellRevision: string | null, packRevision: string): string | null {
  if (!shellRevision) return "This version of the app has no interpreter revision, so no pack can be checked against it.";
  if (shellRevision !== packRevision.toLowerCase()) return `The pack was made for app version ${packRevision.slice(0, 7)}; this is ${shellRevision.slice(0, 7)}.`;
  return null;
}

type CacheLike = Pick<CacheStorage, "keys" | "open">;

/** The complete shells on this device (newest first), read from their meta records. */
export async function installedShells(store: CacheLike | undefined = (globalThis as { caches?: CacheStorage }).caches): Promise<ShellMeta[]> {
  if (!store) return [];
  const out: ShellMeta[] = [];
  for (const name of await store.keys()) {
    if (!name.startsWith(SHELL_CACHE_PREFIX)) continue;
    try {
      const hit = await (await store.open(name)).match(SHELL_META_PATH);
      if (!hit) continue;
      const meta = (await hit.json()) as ShellMeta;
      if (meta && meta.version === name.slice(SHELL_CACHE_PREFIX.length)) out.push(meta);
    } catch {
      // An unreadable cache is no shell.
    }
  }
  return out.sort((a, b) => b.installedAt - a.installedAt);
}
