import { NextResponse } from "next/server";
import { db } from "@/db";
import { describeAiError, hasAnthropic } from "@/lib/ai/client";
import { identifyCards, prepareImage } from "@/lib/ai/scan";
import { markPhoto, photoBytes, replaceItems, storePhoto } from "@/lib/scan/batches";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST multipart/form-data:
 *   { image: File, batchId, position?, mode }  — new photo: stored, then identified
 *   { photoId, mode }                           — retry on a stored photo
 *
 * The stored bytes are the downscaled image Claude sees, so the review can
 * crop them later on any device. They are deleted when the batch finishes.
 */
export async function POST(req: Request) {
  if (!hasAnthropic()) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });
  const form = await req.formData();
  const mode = form.get("mode") === "batch" ? "batch" : "single";
  const batchId = Number(form.get("batchId"));
  const retryPhotoId = Number(form.get("photoId")) || null;

  let photoId: number;
  let prepared;
  try {
    if (retryPhotoId) {
      const stored = await photoBytes(db, retryPhotoId);
      if (!stored) return NextResponse.json({ error: "Photo no longer stored." }, { status: 404 });
      photoId = retryPhotoId;
      prepared = await prepareImage(stored.data);
      await markPhoto(db, photoId, { status: "reading", error: null });
    } else {
      const file = form.get("image");
      if (!(file instanceof File)) return NextResponse.json({ error: "No image uploaded." }, { status: 400 });
      if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Image is larger than 20 MB." }, { status: 413 });
      if (!Number.isInteger(batchId)) return NextResponse.json({ error: "Missing batchId." }, { status: 400 });
      prepared = await prepareImage(Buffer.from(await file.arrayBuffer()));
      photoId = await storePhoto(db, batchId, Number(form.get("position")) || 0, prepared.buffer, prepared.width, prepared.height);
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  try {
    const { detections, result } = await identifyCards(db, prepared, mode);
    const stored = await db.query.scanPhotos.findFirst({ where: (p, { eq }) => eq(p.id, photoId), columns: { batchId: true } });
    const items = await replaceItems(db, stored?.batchId ?? batchId, photoId, detections);
    await markPhoto(db, photoId, { status: "done", error: null, found: items.length, unreadable: result.unreadable });
    return NextResponse.json({ photoId, width: prepared.width, height: prepared.height, items, unreadable: result.unreadable });
  } catch (err) {
    const message = describeAiError(err);
    await markPhoto(db, photoId, { status: "error", error: message });
    return NextResponse.json({ error: message, photoId, width: prepared.width, height: prepared.height }, { status: 502 });
  }
}
