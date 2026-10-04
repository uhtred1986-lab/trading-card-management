"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { requireSignedIn } from "@/lib/auth";
import { revokeDevice } from "@/lib/auth/access";
import { forgetAccessCache } from "@/lib/auth/proxy-checks";

/** A player disconnects one of their own devices (another phone they lost, say). Never another player's. */
export async function disconnectMyDeviceAction(deviceId: number): Promise<void> {
  const viewer = await requireSignedIn();
  if (viewer.kind !== "player" || viewer.playerId === null) return;
  await revokeDevice(db, deviceId, new Date(), viewer.playerId);
  forgetAccessCache();
  revalidatePath("/me");
}
