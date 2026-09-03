import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with scrypt from node:crypto — no native dependency, and
 * available because Next 16 runs `proxy.ts` on the Node.js runtime.
 *
 * Verifying costs ~100 ms on purpose, which is why the proxy caches a
 * successful Authorization header for a few minutes rather than re-deriving
 * the key on every request.
 */

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  try {
    const expected = Buffer.from(keyHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** Reject the passwords that make a login pointless. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (/^\s|\s$/.test(password)) return "Leading or trailing spaces will be hard to type.";
  return null;
}

export function usernameProblem(username: string): string | null {
  if (!/^[A-Za-z0-9._-]{2,32}$/.test(username)) return "2–32 characters: letters, digits, dot, dash or underscore.";
  if (username.includes(":")) return "A colon can't appear in a Basic Auth username.";
  return null;
}
