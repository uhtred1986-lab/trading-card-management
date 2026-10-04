import { parseBasicAuth } from "@/lib/auth-header";

/**
 * The old HTTP Basic Auth check, shared by `src/proxy.ts` and the
 * `/password-login` route while logins move to Google (SLs) and join codes
 * (players). Two sources of credentials, in this order:
 *   1. BASIC_AUTH_USER / BASIC_AUTH_PASSWORD from the environment;
 *   2. rows in `app_users`, managed at /settings/users.
 *
 * Verifying a scrypt hash costs ~100 ms, so an accepted header is remembered
 * for a few minutes instead of being re-derived on every request.
 */

const ACCEPTED_TTL_MS = 5 * 60_000;
const accepted = new Map<string, number>();

function remember(header: string) {
  accepted.set(header, Date.now() + ACCEPTED_TTL_MS);
  // The map only ever holds the handful of logins in use; prune expired ones.
  if (accepted.size > 50) for (const [k, exp] of accepted) if (exp < Date.now()) accepted.delete(k);
}

export interface BasicCheck {
  /** The header names a login the env pair or `app_users` accepts. */
  ok: boolean;
  /** Basic Auth is configured at all: the env pair, or at least one `app_users` row. */
  configured: boolean;
}

export async function checkBasicAuth(header: string | null): Promise<BasicCheck> {
  const envUser = process.env.BASIC_AUTH_USER;
  const envPassword = process.env.BASIC_AUTH_PASSWORD;
  const envConfigured = !!(envUser && envPassword);

  const cached = header ? accepted.get(header) : undefined;
  if (cached && cached > Date.now()) return { ok: true, configured: true };

  if (envConfigured && header === "Basic " + Buffer.from(`${envUser}:${envPassword}`).toString("base64")) {
    remember(header!);
    return { ok: true, configured: true };
  }

  const creds = parseBasicAuth(header);
  let hasUsers = false;
  try {
    const { db } = await import("@/db");
    const { appUsers } = await import("@/db/schema");
    const { authenticate } = await import("@/lib/auth/users");
    hasUsers = (await db.select({ id: appUsers.id }).from(appUsers).limit(1)).length > 0;
    if (creds && hasUsers && (await authenticate(db, creds.username, creds.password))) {
      remember(header!);
      return { ok: true, configured: true };
    }
  } catch {
    // The database is unreachable: fall back to the env pair alone rather than
    // locking the app open or shut on an outage.
  }
  return { ok: false, configured: envConfigured || hasUsers };
}

export function basicChallenge(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="DBS Card Companion"' },
  });
}
