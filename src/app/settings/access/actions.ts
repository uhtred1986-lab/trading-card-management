"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { db } from "@/db";
import { requireSl } from "@/lib/auth";
import { cleanName, createPlayer, deleteOpenCodes, deletePlayer, isPlausibleEmail, issueJoinCode, reassignOwner, removeSl, revokeDevice, updatePlayer, upsertSl } from "@/lib/auth/access";
import { isSlEmail, normaliseEmail, publicOrigin } from "@/lib/auth/core";
import { joinUrl } from "@/lib/auth/join-url";
import { forgetAccessCache } from "@/lib/auth/proxy-checks";
import { players } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Settings → Users & access (docs/architecture/auth.md). Every function opens
 * with `requireSl()`. Adding and removing SLs is for an owner only (an address
 * in `SL_EMAILS`, or the Basic Auth env pair / open local dev while those last).
 */

export type AccessResult = { ok: true; message: string } | { ok: false; error: string };

const PAGE = "/settings/access";

function done(message: string): AccessResult {
  revalidatePath(PAGE);
  return { ok: true, message };
}

/** An owner: an address in `SL_EMAILS`, or the Basic Auth env pair / open local dev while those last. */
function isOwnerSl(sl: Awaited<ReturnType<typeof requireSl>>): boolean {
  return sl.via !== "google" || isSlEmail(sl.email, process.env.SL_EMAILS);
}

// ── Players ────────────────────────────────────────────────────────────────

export async function createPlayerAction(rawName: string, rawOwner: string): Promise<AccessResult> {
  const sl = await requireSl();
  const name = cleanName(rawName);
  if (!name) return { ok: false, error: "Give the player a name (up to 60 characters)." };
  const owner = cleanName(rawOwner) ?? name;
  await createPlayer(db, name, owner, sl.login ?? sl.email);
  return done(`${name} added. Make a join code for their phone.`);
}

export async function updatePlayerAction(id: number, rawName: string, rawOwner: string): Promise<AccessResult> {
  await requireSl();
  const name = cleanName(rawName);
  const owner = cleanName(rawOwner);
  if (!name || !owner) return { ok: false, error: "Name and owner name need 1–60 characters." };
  await updatePlayer(db, id, { name, owner });
  forgetAccessCache();
  return done(`Saved ${name}.`);
}

export async function deletePlayerAction(id: number): Promise<AccessResult> {
  await requireSl();
  await deletePlayer(db, id);
  forgetAccessCache();
  return done("Player removed and their devices signed out. Their cards and decks stay, listed under Unassigned.");
}

export type CodeResult = { ok: true; code: string; url: string; expiresAt: string } | { ok: false; error: string };

/** A fresh one-time code (24 h) for the player; the old unused one stops working. The plain code is only ever in this answer. */
export async function newJoinCodeAction(playerId: number): Promise<CodeResult> {
  const sl = await requireSl();
  const issued = await issueJoinCode(db, playerId, new Date(), sl.login ?? sl.email);
  if (!issued) return { ok: false, error: "That player is gone." };
  revalidatePath(PAGE);
  const h = await headers();
  const origin = publicOrigin(h, `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`);
  return { ok: true, code: issued.code, url: joinUrl(origin, issued.code), expiresAt: issued.expiresAt.toISOString() };
}

export async function cancelJoinCodeAction(playerId: number): Promise<AccessResult> {
  await requireSl();
  await deleteOpenCodes(db, playerId);
  return done("Code cancelled.");
}

export async function disconnectDeviceAction(deviceId: number): Promise<AccessResult> {
  await requireSl();
  await revokeDevice(db, deviceId, new Date());
  forgetAccessCache();
  return done("Device disconnected. It needs a new code to come back.");
}

/** Gives every lot and deck under an unassigned owner name (or none) to a player. */
export async function giveToPlayerAction(fromOwner: string | null, playerId: number): Promise<AccessResult> {
  await requireSl();
  const [player] = await db.select({ owner: players.owner, name: players.name }).from(players).where(eq(players.id, playerId)).limit(1);
  if (!player) return { ok: false, error: "That player is gone." };
  const moved = await reassignOwner(db, fromOwner, player.owner);
  return done(`${moved.lots} cards and ${moved.decks} decks now belong to ${player.name}.`);
}

// ── SLs ────────────────────────────────────────────────────────────────────

export async function addSlAction(rawEmail: string, rawOwner: string): Promise<AccessResult> {
  const sl = await requireSl();
  if (!isOwnerSl(sl)) return { ok: false, error: "Only an owner can add SLs." };
  const email = normaliseEmail(rawEmail);
  if (!isPlausibleEmail(email)) return { ok: false, error: "That doesn't look like a Google address." };
  const name = cleanName(rawOwner);
  if (!name) return { ok: false, error: "Give the SL an owner name (up to 60 characters)." };
  await upsertSl(db, email, name, sl.email ?? sl.login ?? "owner");
  forgetAccessCache();
  return done(`${email} can now sign in with Google as an SL.`);
}

export async function removeSlAction(rawEmail: string): Promise<AccessResult> {
  const sl = await requireSl();
  if (!isOwnerSl(sl)) return { ok: false, error: "Only an owner can remove SLs." };
  const email = normaliseEmail(rawEmail);
  if (isSlEmail(email, process.env.SL_EMAILS)) return { ok: false, error: "Owners are set in Vercel (SL_EMAILS), not here." };
  await removeSl(db, email);
  forgetAccessCache();
  return done(`${email} is no longer an SL and is signed out.`);
}

/** Sets the owner name an SL acts under. An SL may set their own; an owner may set anyone's. */
export async function setSlOwnerAction(rawEmail: string, rawOwner: string): Promise<AccessResult> {
  const sl = await requireSl();
  const email = normaliseEmail(rawEmail);
  if (!isOwnerSl(sl) && email !== sl.email) return { ok: false, error: "You can only change your own owner name." };
  const name = cleanName(rawOwner);
  if (!name) return { ok: false, error: "Owner names need 1–60 characters." };
  await upsertSl(db, email, name, sl.email ?? sl.login ?? "owner");
  return done(`${email} now records cards as ${name}.`);
}
