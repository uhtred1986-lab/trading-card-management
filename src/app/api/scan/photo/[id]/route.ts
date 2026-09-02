import { db } from "@/db";
import { photoBytes } from "@/lib/scan/batches";

export const dynamic = "force-dynamic";

/** Serves a stored batch photo (the downscaled JPEG Claude saw). Gone once the batch is finished. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = await photoBytes(db, Number(id));
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.data), {
    headers: {
      "content-type": "image/jpeg",
      "cache-control": "private, max-age=3600",
    },
  });
}
