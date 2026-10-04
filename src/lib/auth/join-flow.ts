import { callerIp, joinAttemptKey } from "./join-code";

/**
 * The join's rate limit, for the two steps a signed-out browser may take: the
 * `/join` page's lookup and the `/api/join` redeem. Every call records an
 * attempt keyed by an HMAC of the caller's IP and answers whether the caller
 * is over 10 a minute or 50 an hour. Fails closed: a limit that can't be
 * checked refuses.
 */
export async function joinAttemptAllowed(headers: { get(name: string): string | null }, now: Date): Promise<boolean> {
  try {
    const { db } = await import("@/db");
    const { recordJoinAttempt } = await import("./access");
    const { limited } = await recordJoinAttempt(db, joinAttemptKey(callerIp(headers), process.env.AUTH_SECRET), now);
    return !limited;
  } catch {
    return false;
  }
}
