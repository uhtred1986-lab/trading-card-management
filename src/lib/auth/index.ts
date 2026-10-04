import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { parseBasicAuth } from "@/lib/auth-header";

import { isAdminUser, parseAdmins } from "./admin";
import { PLAYER_COOKIE, SESSION_COOKIE, defaultSlOwner, googleConfigured, verifyPlayer, verifySession } from "./core";

export { parseBasicAuth, parseBasicUser } from "@/lib/auth-header";

/**
 * Who is asking, worked out afresh on every call from the request's cookies
 * and headers — never trusted from the proxy (docs/architecture/auth.md):
 *
 * - `sl`: signed in with Google and still an SL (`SL_EMAILS` or `sl_accounts`);
 *   or, while Basic Auth lasts, the `BASIC_AUTH_USER` pair or an `app_users`
 *   login listed in `ARENA_ADMINS`; or anyone at all when no auth is
 *   configured (local dev, `via: "open"`, owner null).
 * - `player`: a joined device whose row is live (`playerId` set), or an
 *   `app_users` login that is not in `ARENA_ADMINS` (`playerId` null).
 *
 * `owner` is the name stamped on what they add and, for a player, the only
 * lots and decks they see.
 */
export type Viewer =
  | { kind: "sl"; via: "google" | "basic" | "open"; email: string | null; login: string | null; owner: string | null }
  | { kind: "player"; via: "code" | "basic"; playerId: number | null; deviceId: number | null; name: string; login: string; owner: string };

async function lazyDb() {
  const { db } = await import("@/db");
  return db;
}

async function viewerUncached(): Promise<Viewer | null> {
  const env = process.env;
  const now = new Date();
  const jar = await cookies();

  const slToken = jar.get(SESSION_COOKIE)?.value;
  if (slToken) {
    const verified = await verifySession(slToken, env, now, async (email) => {
      const { isAddedSl } = await import("./access");
      return isAddedSl(await lazyDb(), email);
    });
    if (verified) {
      const email = verified.session.email;
      let owner = defaultSlOwner(email, env);
      try {
        const { slOwner } = await import("./access");
        owner = await slOwner(await lazyDb(), email, env);
      } catch {
        // No database: the default name still keeps their own cards theirs.
      }
      return { kind: "sl", via: "google", email, login: owner, owner };
    }
  }

  const playerToken = jar.get(PLAYER_COOKIE)?.value;
  if (playerToken) {
    const verified = await verifyPlayer(playerToken, env.AUTH_SECRET, now);
    if (verified) {
      try {
        const { resolvePlayerDevice } = await import("./access");
        const p = await resolvePlayerDevice(await lazyDb(), verified.claims, now);
        if (p) return { kind: "player", via: "code", playerId: p.playerId, deviceId: p.deviceId, name: p.name, login: p.owner, owner: p.owner };
      } catch {
        // Fail closed: an unreadable device is no session.
      }
    }
  }

  const basic = parseBasicAuth((await headers()).get("authorization"));
  if (basic) {
    // The proxy already accepted this header (env pair or an active `app_users` row); nothing else reaches a page.
    const username = basic.username;
    let owner = username;
    try {
      const { ownerForUsername } = await import("./users");
      owner = (await ownerForUsername(await lazyDb(), username)) ?? username;
    } catch {
      // Keep the username as the owner.
    }
    const envPair = !!(env.BASIC_AUTH_USER && env.BASIC_AUTH_PASSWORD) && username === env.BASIC_AUTH_USER;
    if (envPair || parseAdmins(env.ARENA_ADMINS).includes(username.trim().toLowerCase())) {
      return { kind: "sl", via: "basic", email: null, login: username, owner };
    }
    return { kind: "player", via: "basic", playerId: null, deviceId: null, name: username, login: username, owner };
  }

  // No credentials at all got past the proxy only when nothing is configured: local dev, everyone is the SL.
  const basicEnv = !!(env.BASIC_AUTH_USER && env.BASIC_AUTH_PASSWORD);
  if (!googleConfigured(env) && !basicEnv) return { kind: "sl", via: "open", email: null, login: null, owner: null };
  return null;
}

/**
 * The viewer of this request, or null for nobody (outside a request, or a
 * stale cookie on a public page). Worked out once per request (`cache`), so a
 * page's guard, scope and owner reads share one session check.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  try {
    return await viewerUncached();
  } catch {
    // `cookies()` outside a request (a script) — nobody.
    return null;
  }
});

/** The SL signed in with Google on this request, or null. */
export async function currentSession(): Promise<{ email: string } | null> {
  const v = await getViewer();
  return v?.kind === "sl" && v.via === "google" && v.email ? { email: v.email } : null;
}

/**
 * Who is using the app right now, for arena seats, flags and feedback: the
 * owner name of an SL or player, the Basic Auth username, or null when the
 * app runs open (local dev).
 */
export async function currentUser(): Promise<string | null> {
  const v = await getViewer();
  return v?.login ?? null;
}

/** The name to stamp on cards and decks this person adds, and (for a player) the only ones they see. */
export async function currentOwner(): Promise<string | null> {
  const v = await getViewer();
  return v?.owner ?? null;
}

/**
 * Whose cards and decks this request may see (`OwnerScope`,
 * `src/lib/collection/scope.ts`): a player their own owner name only; an SL,
 * and local dev, everyone's (`undefined`). Pass it to every collection, deck
 * and reservation read.
 */
export async function currentScope(): Promise<string | undefined> {
  const v = await getViewer();
  return v?.kind === "player" ? v.owner : undefined;
}

/**
 * Whether this request may see the arena's internals (issue #350). Server-side
 * only: pass the answer down as a boolean prop, never work it out on the client.
 * Every SL may; see `./admin.ts` for the Basic Auth rule kept for scripts.
 */
export async function isArenaAdmin(): Promise<boolean> {
  const v = await getViewer();
  if (v?.kind === "sl") return true;
  if (v) return false;
  const { ARENA_ADMINS, BASIC_AUTH_USER, BASIC_AUTH_PASSWORD } = process.env;
  return isAdminUser(null, { ARENA_ADMINS, BASIC_AUTH_USER, BASIC_AUTH_PASSWORD });
}

// ── Guards ─────────────────────────────────────────────────────────────────

/** Thrown by an action guard. Next shows it as a failed action; only a tampered call ever meets it. */
export class AccessDenied extends Error {
  constructor(message = "Not allowed.") {
    super(message);
    this.name = "AccessDenied";
  }
}

/** Opens every Server Function and route only an SL may call. */
export async function requireSl(): Promise<Extract<Viewer, { kind: "sl" }>> {
  const v = await getViewer();
  if (v?.kind !== "sl") throw new AccessDenied(v ? "Only an SL can do that." : "Sign-in required.");
  return v;
}

/** Opens every Server Function and route any signed-in person may call. */
export async function requireSignedIn(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) throw new AccessDenied("Sign-in required.");
  return v;
}

/**
 * The first statement of every route handler behind the proxy: the viewer, or
 * the answer to send instead (401 nobody, 403 a player on an SL-only route).
 */
export async function routeViewer(opts: { sl?: boolean } = {}): Promise<{ ok: true; viewer: Viewer } | { ok: false; response: Response }> {
  const v = await getViewer();
  if (!v) return { ok: false, response: new Response("Sign-in required", { status: 401 }) };
  if (opts.sl && v.kind !== "sl") return { ok: false, response: new Response("Only an SL can do that", { status: 403 }) };
  return { ok: true, viewer: v };
}

/** The first statement of every SL-only page: a player goes home, nobody goes to `/login`. */
export async function requireSlPage(): Promise<Extract<Viewer, { kind: "sl" }>> {
  const v = await getViewer();
  if (!v) redirect("/login");
  if (v.kind !== "sl") redirect("/");
  return v;
}

/** The first statement of every other page. */
export async function requireSignedInPage(): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect("/login");
  return v;
}
