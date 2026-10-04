import type { Db } from "@/db";
import { userOwners } from "@/lib/auth/users";
import { knownOwners } from "./queries";

/**
 * Every name that can sensibly own a card: the owners configured on logins,
 * whoever already owns something, and the person using the app right now.
 * A player gets none: the owner pickers are an SL's tool (they hide when the
 * list is empty), and a player never sees who else has cards.
 */
export async function ownerOptions(db: Db, current: string | null, isPlayer = false): Promise<string[]> {
  if (isPlayer) return [];
  const [fromUsers, fromCards] = await Promise.all([userOwners(db).catch(() => []), knownOwners(db).catch(() => [])]);
  return [...new Set([...fromUsers, ...fromCards, ...(current ? [current] : [])])].sort((a, b) => a.localeCompare(b));
}
