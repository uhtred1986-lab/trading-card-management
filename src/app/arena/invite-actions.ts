"use server";

import { headers } from "next/headers";
import { db } from "@/db";
import { currentUser, requireSl } from "@/lib/auth";
import { publicOrigin } from "@/lib/auth/core";
import { forgetAccessCache } from "@/lib/auth/proxy-checks";
import { inviteFriend, inviteMessage } from "@/lib/arena/friend-invite";
import { matchById } from "@/lib/arena/matches";

export type InviteResult = { ok: true; mode: "code" | "existing"; name: string; url: string; message: string } | { ok: false; error: string };

/**
 * The host's "Invite a friend" on the waiting screen. SL only (players cannot
 * mint players), and only for a match the caller hosts and nobody has joined.
 */
export async function inviteFriendAction(matchId: number, rawName: string): Promise<InviteResult> {
  const sl = await requireSl();
  const match = Number.isInteger(matchId) ? await matchById(db, matchId) : null;
  if (!match) return { ok: false, error: "That match is gone." };
  const me = await currentUser();
  if (!me || match.hostUser !== me) return { ok: false, error: "Only the host can invite for this match." };
  if (match.status !== "open") return { ok: false, error: "Someone has already joined this match." };

  const h = await headers();
  const origin = publicOrigin(h, `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`);
  const result = await inviteFriend(db, { rawName, matchPath: `/arena/match/${matchId}`, origin, createdBy: sl.login ?? sl.email, now: new Date() });
  if (!result.ok) return result;
  forgetAccessCache();
  return { ok: true, mode: result.mode, name: result.name, url: result.url, message: inviteMessage(match.hostUser, result.name, result.url, result.mode) };
}
