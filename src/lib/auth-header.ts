/**
 * Parsing the HTTP Basic Auth header. Kept free of `next/headers` and of any
 * database import so both the proxy and server components can use it.
 */

export interface BasicCredentials {
  username: string;
  password: string;
}

export function parseBasicAuth(authorization: string | null): BasicCredentials | null {
  if (!authorization?.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const at = decoded.indexOf(":");
    if (at < 0) return null;
    const username = decoded.slice(0, at).trim();
    // Only the first colon separates the two; a password may contain more.
    const password = decoded.slice(at + 1);
    return username ? { username: username.slice(0, 64), password } : null;
  } catch {
    return null;
  }
}

/** Just the username — what gets recorded as a card's owner by default. */
export function parseBasicUser(authorization: string | null): string | null {
  return parseBasicAuth(authorization)?.username ?? null;
}
