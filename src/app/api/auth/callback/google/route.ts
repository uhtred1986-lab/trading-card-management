import { NextResponse, type NextRequest } from "next/server";
import { CALLBACK_PATH, FLOW_COOKIE, LOGIN_PAGE, SESSION_COOKIE, flowCookieOptions, publicOrigin, sessionCookieOptions } from "@/lib/auth/core";
import { completeSignIn, googleConfig } from "@/lib/auth/google-oauth";

/**
 * Google sends the SL back here. Registered on the Google OAuth client as
 * `https://trading-card-management.vercel.app/api/auth/callback/google` and
 * `http://localhost:3000/api/auth/callback/google`.
 *
 * `completeSignIn` checks `state` against the signed flow cookie, trades the
 * code with the PKCE verifier, and signs a session only for a verified address
 * in `SL_EMAILS`. Anyone else goes back to `/login` with the refusal in words
 * and no cookie; nothing is stored for them. The flow cookie is cleared either
 * way. Docs: docs/architecture/auth.md.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const now = new Date();
  const origin = publicOrigin(request.headers, request.nextUrl.origin);
  const callbackUrl = new URL(CALLBACK_PATH + request.nextUrl.search, origin);
  const flowCookie = request.cookies.get(FLOW_COOKIE)?.value;

  let result: Awaited<ReturnType<typeof completeSignIn>>;
  try {
    result = await completeSignIn(await googleConfig(process.env), callbackUrl, flowCookie, process.env, now);
  } catch {
    result = { ok: false, reason: "failed" };
  }

  const target = result.ok ? new URL("/", origin) : new URL(`${LOGIN_PAGE}?error=${result.reason}`, origin);
  const response = NextResponse.redirect(target);
  response.cookies.set(FLOW_COOKIE, "", { ...flowCookieOptions(process.env), maxAge: 0 });
  if (result.ok) response.cookies.set(SESSION_COOKIE, result.sessionCookie, sessionCookieOptions(process.env));
  return response;
}
