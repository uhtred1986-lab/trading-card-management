import { db } from "@/db";
import { routeViewer } from "@/lib/auth";
import { handlePokemonBatchScan } from "@/lib/pokemon/scan-batch";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * `POST /api/pokemon/scan/batch` (multipart): a binder page that is kept. `image` adds a photo to
 * the viewer's open Pokémon batch (or to `batchId`, which must be theirs), stores it, then reads it;
 * `photoId` retries a stored photo. Answers `{ batchId, photoId, state }`. A batch, photo or id that is
 * not the viewer's answers 404 (an SL may open any). A single card stays on `/api/pokemon/scan`.
 */
export async function POST(req: Request) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  return handlePokemonBatchScan(req, db, auth.viewer);
}
