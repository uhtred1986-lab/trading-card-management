"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "@/db";
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

/** Which skin paints the app: the same cookie the board's toggle sets. */
export async function chooseSkinAction(skin: string): Promise<void> {
  (await cookies()).set(SKIN_COOKIE, skinFrom(skin), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
}
