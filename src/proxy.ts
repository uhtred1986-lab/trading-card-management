import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseBasicAuth } from "@/lib/auth-header";

/**
 * HTTP Basic Auth in front of everything — the app has no login page.
 *
 * Two sources of credentials, in this order:
 *   1. BASIC_AUTH_USER / BASIC_AUTH_PASSWORD from the environment. This pair
 *      always works, so a mistake in the users table can never lock everyone
 *      out, and it is what bootstraps the first login.
 *   2. Rows in `app_users`, managed at /settings/users.
 *
 * With neither configured the app runs open, which is what local dev wants.
 * `/api/sync/*` is exempt: Vercel's cron can't send credentials, and that
 * route already requires the CRON_SECRET bearer token.
 *
 * The web-app manifest, its icons and the service worker are exempt too. The
 * browser fetches all three without credentials, so behind auth they 401 and
 * the app cannot be installed to a home screen at all. What they give away is
 * the app's name, its icon and a list of public card-image hosts — no data,
 * and no way in. Everything that reads the database stays protected.
 *
 * Next 16 runs this on the Node.js runtime, so the database is reachable here.
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

function challenge() {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="DBS Card Companion"' },
  });
}

export async function proxy(request: NextRequest) {
  const header = request.headers.get("authorization");
  const envUser = process.env.BASIC_AUTH_USER;
  const envPassword = process.env.BASIC_AUTH_PASSWORD;

  const cached = header ? accepted.get(header) : undefined;
  if (cached && cached > Date.now()) return NextResponse.next();

  if (envUser && envPassword && header === "Basic " + Buffer.from(`${envUser}:${envPassword}`).toString("base64")) {
    remember(header!);
    return NextResponse.next();
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
      return NextResponse.next();
    }
  } catch {
    // The database is unreachable: fall back to the env pair alone rather than
    // locking the app open or shut on an outage.
  }

  // Nothing configured anywhere — local dev runs open, as it always has.
  if (!envUser && !envPassword && !hasUsers) return NextResponse.next();
  return challenge();
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|api/sync/).*)",
};
