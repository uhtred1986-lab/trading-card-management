import { LocalArena } from "@/components/arena/session/LocalArena";
import { runtimeRevision } from "@/lib/arena/replay-bundle";

/**
 * The offline shell (#659, `src/lib/arena/local/shell.ts`): "Play on this device" over the packs
 * installed on this device, as one page the service worker keeps with this build's static files, so
 * the prepared app opens with no network and no session.
 *
 * Prerendered at build (`force-static`): the HTML is one file, the same for everyone. It reads no
 * cookie, no viewer and no data — `cookies()` and `headers()` are empty here, so the root layout
 * renders the signed-out chrome, and the skin is the default. That is why it may skip the sign-in
 * (`src/proxy.ts` matcher, and the exemption in `scripts/verify/guards.ts`): everything it shows
 * comes from the browser's own storage, after the page has loaded. The links in it lead to the
 * online app, which keeps its sign-in.
 *
 * The interpreter revision is the build's, written into the page: a pack made for another one is
 * refused (`shellRefusal`).
 */
export const dynamic = "force-static";
export const revalidate = false;

export default async function ArenaOfflinePage() {
  return <LocalArena shell={{ revision: runtimeRevision() }} />;
}
