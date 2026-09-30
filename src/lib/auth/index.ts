import { headers } from "next/headers";
import { parseBasicUser } from "@/lib/auth-header";

import { isAdminUser } from "./admin";

export { parseBasicAuth, parseBasicUser } from "@/lib/auth-header";

/**
 * Who is using the app right now: the HTTP Basic Auth username the proxy
 * accepted (see src/proxy.ts), or null when the app runs open (local dev).
 */
export async function currentUser(): Promise<string | null> {
  return parseBasicUser((await headers()).get("authorization"));
}

/**
 * The name to stamp on cards this login adds. Usually the username, but a
 * login can be pointed at a different owner in /settings/users — two people
 * sharing one owner, or one person adding on someone else's behalf.
 *
 * The database is imported lazily so `currentUser()` still works in contexts
 * that have no connection string.
 */
export async function currentOwner(): Promise<string | null> {
  const username = await currentUser();
  if (!username) return null;
  try {
    const { db } = await import("@/db");
    const { ownerForUsername } = await import("./users");
    return await ownerForUsername(db, username);
  } catch {
    return username;
  }
}

/**
 * Whether this request may see the arena's internals (issue #350). Server-side
 * only: pass the answer down as a boolean prop, never work it out on the client.
 * See `./admin.ts` for the rule — listed in `ARENA_ADMINS`, or the app is open.
 */
export async function isArenaAdmin(): Promise<boolean> {
  const { ARENA_ADMINS, BASIC_AUTH_USER, BASIC_AUTH_PASSWORD } = process.env;
  return isAdminUser(await currentUser(), { ARENA_ADMINS, BASIC_AUTH_USER, BASIC_AUTH_PASSWORD });
}
