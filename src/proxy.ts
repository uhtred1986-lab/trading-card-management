import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  LOGIN_PAGE,
  PLAYER_COOKIE,
  SESSION_COOKIE,
  decide,
  googleConfigured,
  playerCookieOptions,
  playerNeedsRefresh,
  sessionCookieOptions,
  signPlayer,
  signSession,
  verifyPlayer,
  verifySession,
} from "@/lib/auth/core";
import { basicChallenge, checkBasicAuth } from "@/lib/auth/basic";
import { checkAddedSl, checkPlayerDevice } from "@/lib/auth/proxy-checks";

/**
 * The lock in front of every request the matcher sends here. Three ways in while
 * the app moves off HTTP Basic Auth (docs/architecture/auth.md):
 *
 *   1. an SL session cookie from the Google sign-in at `/login`
 *      (`AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SL_EMAILS`,
 *      plus the SLs added in Settings → Users & access);
 *   2. a player's device cookie from a join code at `/join`, whose device row
 *      must still be live (`src/lib/auth/proxy-checks.ts`); a player is sent
 *      away from the SL-only areas (`isSlOnlyPath`);
 *   3. HTTP Basic Auth as before: the BASIC_AUTH_USER / BASIC_AUTH_PASSWORD pair,
 *      which always works so a bad row can't lock everyone out, or a row in
 *      `app_users` (`src/lib/auth/basic.ts`).
 *
 * With Google set up, a signed-out page goes to `/login` (which links the old
 * password sign-in at `/password-login`) and an API route or Server Function
 * call gets a 401. Without it the browser's Basic Auth popup appears, exactly
 * as before. With nothing configured at all the app runs open — local dev.
 * The decision is `decide()` in `src/lib/auth/core.ts`, tested by
 * `scripts/verify/auth.ts`; this file is only the I/O.
 *
 * `/api/sync/*` is not matched: Vercel's cron can't sign in, and that route
 * requires the CRON_SECRET bearer token. `/api/ai/agent-sdk` (exactly that
 * path) is not matched for the same reason: its callers are other functions,
 * and it refuses anything without the AI_AGENT_SDK_SECRET header (#518).
 *
 * The web-app manifest, its icons and the service worker are not matched
 * either. The browser fetches all three without credentials, so behind auth
 * they 401 and the app cannot be installed to a home screen at all. What they
 * give away is the app's name, its icon and a list of public card-image hosts —
 * no data, and no way in.
 *
 * Next 16 runs this on the Node.js runtime, so the database is reachable here.
 */
export async function proxy(request: NextRequest) {
  const now = new Date();
  const env = process.env;
  const verified = await verifySession(request.cookies.get(SESSION_COOKIE)?.value, env, now, checkAddedSl);
  const playerCookie = verified ? null : await verifyPlayer(request.cookies.get(PLAYER_COOKIE)?.value, env.AUTH_SECRET, now);
  const player = playerCookie && (await checkPlayerDevice(playerCookie.claims)) ? playerCookie : null;
  const basic = verified || player ? { ok: false, configured: true } : await checkBasicAuth(request.headers.get("authorization"));
  const { pathname } = request.nextUrl;
  const decision = decide(
    {
      pathname,
      isAction: request.method === "POST" && request.headers.has("next-action"),
      isApi: pathname === "/api" || pathname.startsWith("/api/"),
    },
    { verified, player: player ? { refresh: playerNeedsRefresh(player, now) } : null, basicOk: basic.ok, basicConfigured: basic.configured, googleOn: googleConfigured(env) },
    now,
  );

  switch (decision.kind) {
    case "pass":
      return NextResponse.next();
    case "pass-refresh": {
      const response = NextResponse.next();
      response.cookies.set(SESSION_COOKIE, await signSession(decision.email, env.AUTH_SECRET, now), sessionCookieOptions(env));
      return response;
    }
    case "pass-refresh-player": {
      const response = NextResponse.next();
      response.cookies.set(PLAYER_COOKIE, await signPlayer(player!.claims, env.AUTH_SECRET, now), playerCookieOptions(env));
      return response;
    }
    case "home":
      return NextResponse.redirect(new URL("/", request.url));
    case "login":
      return NextResponse.redirect(new URL(LOGIN_PAGE, request.url));
    case "unauthorised":
      return new Response("Sign-in required", { status: 401 });
    case "forbidden":
      return new Response("Only an SL can do that", { status: 403 });
    case "challenge":
      return basicChallenge();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|api/sync/|api/ai/agent-sdk$).*)",
    // A Server Function POST runs on whatever route it is posted to, so it always meets the proxy,
    // even on a path the entry above skips.
    { source: "/:path*", has: [{ type: "header", key: "next-action" }] },
  ],
};
