import { NextResponse } from "next/server";
import { db } from "@/db";
import { syncMeta } from "@/lib/meta/sync";
import { runSync } from "@/lib/sync";
import { expireTagsFromRoute } from "@/lib/cache/tags";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Daily regional-results refresh, triggered by the Vercel cron in vercel.json.
 * Vercel sends `Authorization: Bearer $CRON_SECRET`; anything else is refused.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const meta = await runSync(db, "meta", () => syncMeta(db));
    return NextResponse.json({ meta });
  } finally {
    // Even a sync that failed part-way may have written (src/lib/cache/reads.ts).
    expireTagsFromRoute("meta");
  }
}
