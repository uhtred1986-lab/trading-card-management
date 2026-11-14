"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cardPrints } from "@/db/schema";
import { currentOwner, requireSignedIn } from "@/lib/auth";
import { CardPhotoError, MAX_PHOTO_BYTES, deleteCardPhoto, saveCardPhoto } from "@/lib/collection/photos";

export type PhotoResult = { ok: true; photoId: number | null } | { ok: false; code: string; error: string };

/**
 * Fields: `printId` and `photo` (a File: WebP or JPEG, at most 400 KB). Stored
 * under the viewer's own owner name. Photos are not in the catalog cache, so
 * only the two pages that show them are revalidated.
 */
export async function saveCardPhotoAction(formData: FormData): Promise<PhotoResult> {
  await requireSignedIn();
  const owner = await currentOwner();
  const printId = String(formData.get("printId") ?? "");
  const file = formData.get("photo");
  if (!printId || !(file instanceof File)) return { ok: false, code: "bad_request", error: "No photo." };
  // Check the declared size before reading the body into memory.
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, code: "too_large", error: "The photo is too large." };
  try {
    const id = await saveCardPhoto(db, { printId, owner, data: Buffer.from(await file.arrayBuffer()), mime: file.type });
    revalidatePath("/collection");
    revalidatePath("/cards/[id]", "page");
    return { ok: true, photoId: id };
  } catch (e) {
    if (e instanceof CardPhotoError) return { ok: false, code: e.code, error: e.message };
    throw e;
  }
}

export async function removeCardPhotoAction(printId: string): Promise<PhotoResult> {
  await requireSignedIn();
  const owner = await currentOwner();
  const [print] = await db.select({ id: cardPrints.id }).from(cardPrints).where(eq(cardPrints.id, String(printId))).limit(1);
  if (!print) return { ok: false, code: "no_print", error: "Unknown print." };
  await deleteCardPhoto(db, { printId: print.id, owner });
  revalidatePath("/collection");
  revalidatePath("/cards/[id]", "page");
  return { ok: true, photoId: null };
}
