"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { currentOwner } from "@/lib/auth";
import { completeBatch, createBatch, deleteBatch, setBatchDeck, setBatchLocation, setBatchOwner, updateItem, type ItemPatch, type ScanMode } from "@/lib/scan/batches";

export async function createBatchAction(mode: ScanMode, deckId: number | null = null, owner: string | null = null, locationId: number | null = null): Promise<number> {
  const id = await createBatch(db, mode, deckId, owner ?? (await currentOwner()), locationId);
  revalidatePath("/add/scan");
  revalidatePath("/add");
  return id;
}

export async function setBatchOwnerAction(batchId: number, owner: string | null): Promise<void> {
  await setBatchOwner(db, batchId, owner);
  revalidatePath("/add/scan");
}

export async function setBatchLocationAction(batchId: number, locationId: number | null): Promise<void> {
  await setBatchLocation(db, batchId, locationId);
  revalidatePath("/add/scan");
}

export async function setBatchDeckAction(batchId: number, deckId: number | null): Promise<void> {
  await setBatchDeck(db, batchId, deckId);
  revalidatePath("/add/scan");
}

export async function updateScanItemAction(id: number, patch: ItemPatch): Promise<void> {
  await updateItem(db, id, patch);
}

export async function completeBatchAction(batchId: number): Promise<{ added: number; deckAdded: number; deckId: number | null }> {
  const r = await completeBatch(db, batchId, await currentOwner());
  revalidatePath("/", "layout");
  return r;
}

export async function deleteBatchAction(batchId: number): Promise<void> {
  await deleteBatch(db, batchId);
  revalidatePath("/add/scan");
  revalidatePath("/add");
}

export async function deleteBatchForm(formData: FormData) {
  await deleteBatchAction(Number(formData.get("id")));
  redirect("/add/scan");
}
