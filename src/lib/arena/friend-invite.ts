/**
 * Inviting a friend to a 1 v 1 with a token-only login (`docs/arena-friend-invite-plan.md`).
 *
 * One step for the host: name the friend, get a link. The friend becomes a
 * normal player (owner's call), signs in with the one-time code in that link
 * and lands on the match's deck picker. Nothing here is a new login mechanism:
 * it is `createPlayer` and `issueJoinCode` joined to a match page.
 */
import { and, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { playerDevices, players } from "@/db/schema";
import { cleanName, createInvitedPlayer, issueJoinCode } from "@/lib/auth/access";
import { joinUrl } from "@/lib/auth/join-url";

export type FriendInvite =
  | { ok: false; error: string }
  /** A code to send: a new friend, or one invited before who never opened it. */
  | { ok: true; mode: "code"; name: string; url: string; expiresAt: string }
  /** This friend already has a signed-in phone: they only need the match page. */
  | { ok: true; mode: "existing"; name: string; url: string };

/**
 * `matchPath` is `/arena/match/<id>` (the page the friend lands on); `origin`
 * is the public origin the link is built on. The caller has already checked the
 * host owns the match and is an SL.
 */
export async function inviteFriend(db: Db, input: { rawName: unknown; matchPath: string; origin: string; createdBy: string | null; now: Date }): Promise<FriendInvite> {
  const name = cleanName(input.rawName);
  if (!name) return { ok: false, error: "Type your friend's name (up to 60 characters)." };

  // Someone this host already invited under that name: reuse them rather than refuse.
  const lower = name.toLowerCase();
  const [known] = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(sql`lower(${players.owner}) = ${lower} and ${players.createdBy} is not distinct from ${input.createdBy}`)
    .limit(1);

  let playerId: number;
  let shown = name;
  if (known) {
    playerId = known.id;
    shown = known.name;
    const [live] = await db.select({ id: playerDevices.id }).from(playerDevices).where(and(sql`${playerDevices.playerId} = ${playerId}`, isNull(playerDevices.revokedAt))).limit(1);
    if (live) return { ok: true, mode: "existing", name: shown, url: `${input.origin.replace(/\/$/, "")}${input.matchPath}` };
  } else {
    const created = await createInvitedPlayer(db, name, input.createdBy);
    if (created === null) return { ok: false, error: `"${name}" is already used by someone else here. Add a surname or initial.` };
    playerId = created;
  }

  const issued = await issueJoinCode(db, playerId, input.now, input.createdBy);
  if (!issued) return { ok: false, error: "That player is gone." };
  return { ok: true, mode: "code", name: shown, url: joinUrl(input.origin, issued.code, input.matchPath), expiresAt: issued.expiresAt.toISOString() };
}

/** The message that goes into WhatsApp: who asks, what it is, how long the link lasts. */
export function inviteMessage(hostName: string, friendName: string, url: string, mode: "code" | "existing"): string {
  return mode === "code"
    ? `Hi ${friendName}! ${hostName} invites you to a Dragon Ball card match. Tap to join, no password needed (the link works once, for 24 hours): ${url}`
    : `Hi ${friendName}! ${hostName} invites you to a Dragon Ball card match. Tap to play: ${url}`;
}
