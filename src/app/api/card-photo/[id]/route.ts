import { db } from "@/db";
import { currentScope, routeViewer } from "@/lib/auth";
import { readCardPhoto } from "@/lib/collection/photos";

export const dynamic = "force-dynamic";

/**
 * Serves a person's own card photo. The id changes whenever the photo is
 * replaced, so it can be cached for good; an id the looker may not see is a 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  const photo = await readCardPhoto(db, Number(id), await currentScope());
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: { "content-type": photo.mime, "cache-control": "private, max-age=31536000, immutable" },
  });
}
