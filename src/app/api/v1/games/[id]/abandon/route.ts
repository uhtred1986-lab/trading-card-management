import { db } from "@/db";
import { fail, ok } from "@/lib/arena/api";
import { abandonGame } from "@/lib/arena/games";
import { snapshotOf } from "@/lib/arena/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Give up. The game stays readable; it just stops being playable. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");
  const before = await snapshotOf(db, id);
  if (!before) return fail("not_found", `no game ${id}`);
  await abandonGame(db, id);
  const snapshot = await snapshotOf(db, id);
  return snapshot ? ok(snapshot) : fail("not_found", `no game ${id}`);
}
