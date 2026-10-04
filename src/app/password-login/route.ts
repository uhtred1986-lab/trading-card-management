import { NextResponse, type NextRequest } from "next/server";
import { publicOrigin } from "@/lib/auth/core";
import { basicChallenge, checkBasicAuth } from "@/lib/auth/basic";

/**
 * The old username-and-password sign-in, linked from `/login` while players
 * still have `app_users` logins rather than join codes. It asks for the
 * browser's Basic Auth popup until the credentials check out, then goes home;
 * the browser re-sends them on every later request, which `src/proxy.ts` still
 * accepts. At the root, not under `/api/auth`, because a browser re-sends Basic
 * credentials only below the directory that asked for them.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await checkBasicAuth(request.headers.get("authorization"));
  if (!check.ok) return basicChallenge();
  return NextResponse.redirect(new URL("/", publicOrigin(request.headers, request.nextUrl.origin)));
}
