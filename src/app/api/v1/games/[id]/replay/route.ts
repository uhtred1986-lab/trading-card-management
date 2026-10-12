import { db } from "@/db";
import { routeViewer } from "@/lib/auth";
import { fail, ok } from "@/lib/arena/api";
import { loadReplayExport } from "@/lib/arena/replay-export";

export const dynamic = "force-dynamic";

/** Admin-only export. Authentication and versus-seat authorization precede private bundle reads. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await routeViewer({ sl: true });
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return fail("bad_request", "game id must be a number");
  const result = await loadReplayExport(db, id, auth.viewer);
  if (result.kind === "not_found") return fail("not_found", `no game ${id}`);
  if (result.kind === "contract_mismatch") return fail("contract_mismatch", result.message);
  return ok(result.body);
}
