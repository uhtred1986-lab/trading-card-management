import { cookies } from "next/headers";
import { requireSignedInPage } from "@/lib/auth";
import { LocalArena } from "@/components/arena/session/LocalArena";
import { LIGHTING_COOKIE, lightingFrom } from "@/lib/arena/lighting";
import { SKIN_COOKIE, skinFrom } from "@/lib/arena/skin";
import { STAGING_COOKIE, stagingFrom } from "@/lib/arena/staging";

export const dynamic = "force-dynamic";

/**
 * Play on this device (#656): the board over a match that runs in the browser — a Worker and
 * IndexedDB, no match API, no provider, no database read. The page only checks who is asking and
 * reads the board's look from the cookies, as a game page does; a player may open it (it touches
 * no one's collection), and the card data comes from the pack file the player chooses.
 */
export default async function ArenaLocalPage({ searchParams }: { searchParams: Promise<{ skin?: string; staging?: string }> }) {
  await requireSignedInPage();
  const asked = await searchParams;
  const jar = await cookies();
  return (
    <LocalArena
      skin={skinFrom(asked.skin ?? jar.get(SKIN_COOKIE)?.value)}
      staging={stagingFrom(asked.staging ?? jar.get(STAGING_COOKIE)?.value)}
      lighting={lightingFrom(jar.get(LIGHTING_COOKIE)?.value)}
    />
  );
}
