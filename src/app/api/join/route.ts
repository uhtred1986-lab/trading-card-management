import { NextResponse, type NextRequest } from "next/server";
import { JOIN_PAGE, PLAYER_COOKIE, playerCookieOptions, publicOrigin, signPlayer } from "@/lib/auth/core";
import { deviceLabel } from "@/lib/auth/join-code";
import { joinAttemptAllowed } from "@/lib/auth/join-flow";

/**
 * The join's confirm step: "Yes, that's me" on `/join` posts the code here.
 * A route, not a Server Function, because the browser has no session yet and
 * the proxy refuses a Server Function on a public path. Rate-limited first;
 * then the code is spent and the device made (`redeemJoinCode`, one use, two
 * phones racing get one device), and the signed `dbs-player` cookie is set.
 * A wrong, spent or expired code all get the same answer.
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const now = new Date();
  const origin = publicOrigin(request.headers, request.nextUrl.origin);
  const back = (error: string) => NextResponse.redirect(new URL(`${JOIN_PAGE}?error=${error}`, origin), 303);

  if (!(await joinAttemptAllowed(request.headers, now))) return back("limited");
  const form = await request.formData().catch(() => null);
  const code = form?.get("code");
  if (typeof code !== "string" || code.length > 20) return back("bad");
  const standalone = form?.get("standalone") === "1";

  const { db } = await import("@/db");
  const { redeemJoinCode } = await import("@/lib/auth/access");
  const joined = await redeemJoinCode(db, code, deviceLabel(request.headers.get("user-agent"), standalone), now);
  if (!joined) return back("bad");

  const response = NextResponse.redirect(new URL("/", origin), 303);
  response.cookies.set(PLAYER_COOKIE, await signPlayer({ playerId: joined.playerId, deviceId: joined.deviceId, tok: joined.tok }, process.env.AUTH_SECRET, now), playerCookieOptions(process.env));
  return response;
}
