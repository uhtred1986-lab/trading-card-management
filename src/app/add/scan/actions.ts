"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { completeBatch, createBatch, deleteBatch, updateItem, type ItemPatch, type ScanMode } from "@/lib/scan/batches";

export async function createBatchAction(mode: ScanMode): Promise<number> {
  const id = await createBatch(db, mode);
  revalidatePath("/add/scan");
  revalidatePath("/add");
  return id;
}

export async function updateScanItemAction(id: number, patch: ItemPatch): Promise<void> {
  await updateItem(db, id, patch);
}

export async function completeBatchAction(batchId: number): Promise<{ added: number }> {
  const r = await completeBatch(db, batchId);
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
