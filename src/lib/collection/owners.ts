import type { Db } from "@/db";
import { userOwners } from "@/lib/auth/users";
import { knownOwners } from "./queries";

/**
 * Every name that can sensibly own a card: the owners configured on logins,
 * whoever already owns something, and the person using the app right now.
 */
export async function ownerOptions(db: Db, current: string | null): Promise<string[]> {
  const [fromUsers, fromCards] = await Promise.all([userOwners(db).catch(() => []), knownOwners(db).catch(() => [])]);
  return [...new Set([...fromUsers, ...fromCards, ...(current ? [current] : [])])].sort((a, b) => a.localeCompare(b));
}
