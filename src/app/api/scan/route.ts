import { NextResponse } from "next/server";
import { db } from "@/db";
import { describeAiError, hasAnthropic } from "@/lib/ai/client";
import { identifyCards } from "@/lib/ai/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST multipart/form-data { image: File, mode: "single" | "batch" }.
 * The image is resized in memory, sent to Claude, and discarded.
 */
export async function POST(req: Request) {
  if (!hasAnthropic()) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });
  const form = await req.formData();
  const file = form.get("image");
  const mode = form.get("mode") === "batch" ? "batch" : "single";
  if (!(file instanceof File)) return NextResponse.json({ error: "No image uploaded." }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Image is larger than 20 MB." }, { status: 413 });
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const { detections, result } = await identifyCards(db, buf, mode);
    return NextResponse.json({ detections, unreadable: result.unreadable });
  } catch (err) {
    return NextResponse.json({ error: describeAiError(err) }, { status: 502 });
  }
}
