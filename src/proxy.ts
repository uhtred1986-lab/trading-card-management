import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * HTTP Basic Auth in front of everything — the app has no login of its own.
 * Only active when both env vars are set, so local dev stays open. Same
 * pattern as gullet-cove-dm.
 *
 * `/api/sync/*` is exempt: Vercel's cron can't send Basic credentials, and
 * that route already refuses anything without the `CRON_SECRET` bearer token.
 */
export function proxy(request: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;

  if (!user || !password) {
    return NextResponse.next();
  }

  const expected = "Basic " + Buffer.from(`${user}:${password}`).toString("base64");
  if (request.headers.get("authorization") === expected) {
    return NextResponse.next();
  }

  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="DBS Card Companion"' },
  });
}

export const config = {
  matcher: "/((?!_next/static|_next/image|favicon.ico|api/sync/).*)",
};
