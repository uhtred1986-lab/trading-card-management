"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireSignedIn } from "@/lib/auth";
import { assertOwnBatch, assertOwnDeckIf, assertOwnScanItem, ownerFor } from "@/lib/auth/ownership";
import { completeBatch, createBatch, deleteBatch, setBatchDeck, setBatchLocation, setBatchOwner, updateItem, type ItemPatch, type ScanMode } from "@/lib/scan/batches";

export async function createBatchAction(mode: ScanMode, deckId: number | null = null, owner: string | null = null, locationId: number | null = null): Promise<number> {
  const viewer = await requireSignedIn();
  await assertOwnDeckIf(viewer, deckId);
  // A player's scans are always their own; an SL may scan someone else's cards.
  const id = await createBatch(db, mode, deckId, ownerFor(viewer, owner ?? undefined, viewer.owner), locationId);
  revalidatePath("/add/scan");
  revalidatePath("/add");
  return id;
}

export async function setBatchOwnerAction(batchId: number, owner: string | null): Promise<void> {
  const viewer = await requireSignedIn();
  await assertOwnBatch(viewer, batchId);
  if (viewer.kind === "player") return;
  await setBatchOwner(db, batchId, owner);
  revalidatePath("/add/scan");
}

export async function setBatchLocationAction(batchId: number, locationId: number | null): Promise<void> {
  await assertOwnBatch(await requireSignedIn(), batchId);
  await setBatchLocation(db, batchId, locationId);
  revalidatePath("/add/scan");
}

export async function setBatchDeckAction(batchId: number, deckId: number | null): Promise<void> {
  const viewer = await requireSignedIn();
  await assertOwnBatch(viewer, batchId);
  await assertOwnDeckIf(viewer, deckId);
  await setBatchDeck(db, batchId, deckId);
  revalidatePath("/add/scan");
}

export async function updateScanItemAction(id: number, patch: ItemPatch): Promise<void> {
  await assertOwnScanItem(await requireSignedIn(), id);
  await updateItem(db, id, patch);
}

export async function completeBatchAction(batchId: number): Promise<{ added: number; deckAdded: number; deckId: number | null }> {
  const viewer = await requireSignedIn();
  await assertOwnBatch(viewer, batchId);
  const r = await completeBatch(db, batchId, viewer.owner);
  revalidatePath("/", "layout");
  return r;
}

export async function deleteBatchAction(batchId: number): Promise<void> {
  await assertOwnBatch(await requireSignedIn(), batchId);
  await deleteBatch(db, batchId);
  revalidatePath("/add/scan");
  revalidatePath("/add");
}

export async function deleteBatchForm(formData: FormData) {
  await requireSignedIn();
  await deleteBatchAction(Number(formData.get("id")));
  redirect("/add/scan");
}
