"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PLAYER_COOKIE, SESSION_COOKIE, playerCookieOptions, sessionCookieOptions } from "@/lib/auth/core";
import { getViewer } from "@/lib/auth";

/**
 * Sign out of this browser: an SL's Google session is dropped (it lives only in
 * the signed cookie); a player's device is disconnected for good, so the same
 * phone needs a new code to come back. A Basic Auth login cannot be signed out
 * from a page (the browser holds those credentials until it is closed).
 */
export async function signOut(): Promise<void> {
  const viewer = await getViewer();
  const jar = await cookies();
  if (viewer?.kind === "player" && viewer.deviceId !== null && viewer.playerId !== null) {
    const { db } = await import("@/db");
    const { revokeDevice } = await import("@/lib/auth/access");
    const { forgetAccessCache } = await import("@/lib/auth/proxy-checks");
    await revokeDevice(db, viewer.deviceId, new Date(), viewer.playerId);
    forgetAccessCache();
  }
  jar.set(SESSION_COOKIE, "", { ...sessionCookieOptions(process.env), maxAge: 0 });
  jar.set(PLAYER_COOKIE, "", { ...playerCookieOptions(process.env), maxAge: 0 });
  redirect("/login");
}
