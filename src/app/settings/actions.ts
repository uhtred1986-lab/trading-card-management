"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "@/db";
import { setDefaultEngine } from "@/lib/arena/engine-setting";
import { engineOr } from "@/lib/arena/engines";
import { encodeLighting, LIGHTING_COOKIE, lightingFrom } from "@/lib/arena/lighting";
import { SKIN_COOKIE, skinFrom } from "@/lib/arena/skin";
import { syncCatalog } from "@/lib/catalog/deckplanet";
import { syncFx } from "@/lib/pricing/fx";
import { syncPrices } from "@/lib/pricing/tcgcsv";
import { runSync } from "@/lib/sync";

/**
 * A failed sync is already recorded in `sync_runs` by `runSync`; swallowing
 * the rethrow here lets the Settings page render the error instead of Next's
 * generic 500 screen.
 */
async function quietly(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch {
    // recorded in sync_runs
  }
  revalidatePath("/", "layout");
}

export async function syncCatalogAction(): Promise<void> {
  await quietly(() => runSync(db, "catalog", () => syncCatalog(db)));
}

export async function syncCardTraderAction(): Promise<void> {
  const { syncCardTraderCatalog } = await import("@/lib/marketplace/cardtrader");
  await quietly(() => runSync(db, "cardtrader", () => syncCardTraderCatalog(db)));
}

export async function syncPricesAction(): Promise<void> {
  await quietly(async () => {
    await runSync(db, "fx", () => syncFx(db));
    await runSync(db, "prices", () => syncPrices(db));
  });
}

export async function syncMetaAction(): Promise<void> {
  const { syncMeta } = await import("@/lib/meta/sync");
  await quietly(() => runSync(db, "meta", () => syncMeta(db)));
}

/** The engine a new arena game is made on unless the form says otherwise (`engines.ts`). A setting, so it is flipped without a deploy. */
export async function chooseEngineAction(id: string): Promise<void> {
  await setDefaultEngine(db, engineOr(id));
  revalidatePath("/settings");
  revalidatePath("/arena");
}

/** Which skin paints the app: the same cookie the board's toggle sets. */
export async function chooseSkinAction(skin: string): Promise<void> {
  (await cookies()).set(SKIN_COOKIE, skinFrom(skin), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}

/**
 * Turn lighting (`docs/arena-turn-presence-spec.md` §3.5).
 *
 * A cookie rather than `localStorage`, like the skin and the staging beside
 * it: the board is painted on the server, so a palette the client had to read
 * first would flash the default one on every load. The blob is re-parsed
 * through `lightingFrom` before it is written, so nothing but a value the
 * board can actually use ever reaches the cookie — and the empty-tone case
 * writes a cookie holding no overrides at all, which is what "reset to
 * defaults" means here.
 */
export async function chooseLightingAction(blob: string): Promise<void> {
  const prefs = lightingFrom(blob);
  (await cookies()).set(LIGHTING_COOKIE, encodeLighting(prefs), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
