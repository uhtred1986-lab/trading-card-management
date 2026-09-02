import { NextResponse } from "next/server";
import { db } from "@/db";
import { describeAiError, hasAnthropic } from "@/lib/ai/client";
import { identifyCards } from "@/lib/ai/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Quick capture: one photo, one card, identified immediately. Nothing is
 * stored — the phone shows the match and asks for a quantity, and only the
 * confirmed lot is written (via addLot).
 */
export async function POST(req: Request) {
  if (!hasAnthropic()) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });
  const form = await req.formData();
  const file = form.get("image");
  if (!(file instanceof File)) return NextResponse.json({ error: "No image uploaded." }, { status: 400 });
  if (file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Image is larger than 20 MB." }, { status: 413 });
  try {
    const { detections, result } = await identifyCards(db, Buffer.from(await file.arrayBuffer()), "single");
    // Best-matched detection first; the client can still switch among the rest.
    const sorted = [...detections].sort((a, b) => b.matchConfidence - a.matchConfidence);
    return NextResponse.json({ detections: sorted, unreadable: result.unreadable });
  } catch (err) {
    return NextResponse.json({ error: describeAiError(err) }, { status: 502 });
  }
}
