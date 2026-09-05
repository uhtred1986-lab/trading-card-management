import { ok, CONTRACT } from "@/lib/arena/api";

export const dynamic = "force-dynamic";

/**
 * What a client checks on launch. `minClient` is the oldest Android build the
 * server will still talk to; below it the app must update before it may play.
 */
export function GET() {
  return ok({
    contract: CONTRACT,
    minClient: 1,
    latestClient: 1,
    serverTime: new Date().toISOString(),
  });
}
