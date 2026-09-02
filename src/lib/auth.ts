import { headers } from "next/headers";

/**
 * Who is using the app right now: the HTTP Basic Auth username the proxy
 * accepted (see src/proxy.ts), or null when the app runs open (local dev).
 * Stored on collection lots as `owner` so cards added by different logins
 * can be told apart.
 */
export async function currentUser(): Promise<string | null> {
  const auth = (await headers()).get("authorization");
  return parseBasicUser(auth);
}

export function parseBasicUser(authorization: string | null): string | null {
  if (!authorization?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const user = decoded.split(":")[0]?.trim();
    return user ? user.slice(0, 64) : null;
  } catch {
    return null;
  }
}
