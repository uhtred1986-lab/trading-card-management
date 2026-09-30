/**
 * Who counts as an arena admin (issue #350): the people who see the engine's
 * internals — the REF badge, "Engine reads", raw card ids, the raw log, the
 * debug pages. Pure, so a verify script can exercise it with no request, no
 * database and no `next/headers`; `isArenaAdmin()` in `./index.ts` is the thin
 * server-side wrapper that reads the real user and environment.
 */

/** `ARENA_ADMINS`: comma-separated logins, trimmed, compared case-insensitively. */
export function parseAdmins(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Basic Auth is on when the proxy would challenge: both env variables set (`src/proxy.ts`). */
export function basicAuthOn(env: { BASIC_AUTH_USER?: string; BASIC_AUTH_PASSWORD?: string }): boolean {
  return !!(env.BASIC_AUTH_USER && env.BASIC_AUTH_PASSWORD);
}

/**
 * Admin when the app runs open (Basic Auth off and nobody signed in: local dev,
 * where everyone is the owner), or when `user` is listed in `ARENA_ADMINS`.
 * With auth on and the list unset, nobody is admin.
 */
export function isAdminUser(user: string | null, env: { ARENA_ADMINS?: string; BASIC_AUTH_USER?: string; BASIC_AUTH_PASSWORD?: string }): boolean {
  // A login that arrived through the users table (no env pair) still means auth is on.
  if (!basicAuthOn(env) && user === null) return true;
  return user !== null && parseAdmins(env.ARENA_ADMINS).includes(user.trim().toLowerCase());
}
