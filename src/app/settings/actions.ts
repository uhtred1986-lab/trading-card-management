"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
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
