"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { syncCatalog } from "@/lib/catalog/deckplanet";
import { syncFx } from "@/lib/pricing/fx";
import { syncPrices } from "@/lib/pricing/tcgcsv";
import { runSync } from "@/lib/sync";

export async function syncCatalogAction(): Promise<void> {
  await runSync(db, "catalog", () => syncCatalog(db));
  revalidatePath("/", "layout");
}

export async function syncCardTraderAction(): Promise<void> {
  const { syncCardTraderCatalog } = await import("@/lib/marketplace/cardtrader");
  await runSync(db, "cardtrader", () => syncCardTraderCatalog(db));
  revalidatePath("/", "layout");
}

export async function syncPricesAction(): Promise<void> {
  await runSync(db, "fx", () => syncFx(db));
  await runSync(db, "prices", () => syncPrices(db));
  revalidatePath("/", "layout");
}
