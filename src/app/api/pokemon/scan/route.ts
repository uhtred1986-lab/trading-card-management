import { db } from "@/db";
import { routeViewer } from "@/lib/auth";
import { handlePokemonScan } from "@/lib/pokemon/scan";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * `POST /api/pokemon/scan` (multipart: `image`, and `mode` = "single" | "batch"): reads the Pokémon
 * cards in one photo and matches each against TCGdex. `{ detections, unreadable }`. Nothing is
 * stored; the phone shows the matches and only a confirmed card is written (`addPokemonLotAction`).
 * Same provider routing and ledger as the Dragon Ball `/api/scan/quick`.
 */
export async function POST(req: Request) {
  const auth = await routeViewer();
  if (!auth.ok) return auth.response;
  return handlePokemonScan(req, db);
}
