import { cookies, headers } from "next/headers";
import { parseBasicUser } from "@/lib/auth-header";

import { isAdminUser } from "./admin";
import { SESSION_COOKIE, slUsername, verifySession, type SlSession } from "./core";

export { parseBasicAuth, parseBasicUser } from "@/lib/auth-header";

/**
 * The SL signed in with Google on this request, or null. Re-verified on every
 * call (signature, expiry, still in `SL_EMAILS`), never trusted from the proxy.
 */
export async function currentSession(): Promise<SlSession | null> {
  const verified = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, process.env, new Date());
  return verified?.session ?? null;
}

/**
 * Who is using the app right now: an SL's name (`slUsername`) when they signed
 * in with Google, else the HTTP Basic Auth username the proxy accepted (see
 * src/proxy.ts), or null when the app runs open (local dev).
 */
export async function currentUser(): Promise<string | null> {
  const session = await currentSession();
  if (session) return slUsername(session.email, process.env);
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
 * An SL signed in with Google always may; otherwise see `./admin.ts` — listed in
 * `ARENA_ADMINS`, or the app is open.
 */
export async function isArenaAdmin(): Promise<boolean> {
  if (await currentSession()) return true;
  const { ARENA_ADMINS, BASIC_AUTH_USER, BASIC_AUTH_PASSWORD } = process.env;
  return isAdminUser(await currentUser(), { ARENA_ADMINS, BASIC_AUTH_USER, BASIC_AUTH_PASSWORD });
}
