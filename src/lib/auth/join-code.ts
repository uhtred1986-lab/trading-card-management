/**
 * Join codes and player devices, the pure half — ported from gullet-cove-dm's
 * `src/lib/join-code.ts`. No database and no `next/*`: `scripts/verify/auth.ts`
 * checks it directly. The database half is `./access.ts`.
 */
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";

/** Uppercase letters and digits without the look-alikes 0/O, 1/I/L. 31 symbols. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
/** A code is valid for 24 hours and once. */
export const CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** Join attempts per caller: 10 a minute and 50 an hour. */
export const JOIN_LIMIT_PER_MINUTE = 10;
export const JOIN_LIMIT_PER_HOUR = 50;

/** A device counts as online when it was seen in the last 10 minutes. */
export const ONLINE_WINDOW_MS = 10 * 60 * 1000;
/** `lastSeenAt` is written at most this often per device. */
export const LAST_SEEN_THROTTLE_MS = 60 * 1000;

/** A fresh random code, drawn with the platform's CSPRNG. */
export function generateCode(pick: (max: number) => number = randomInt): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[pick(CODE_ALPHABET.length)];
  return code;
}

/** What the player typed, as the code it names: upper-cased, spaces and dashes dropped. */
export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "");
}

export function isWellFormedCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** SHA-256 (hex) of a normalised code: all the database ever holds of it. */
export function hashCode(code: string): string {
  return createHash("sha256").update(`join-code:${normaliseCode(code)}`).digest("hex");
}

/** A device's secret: 32 random bytes, base64url. Lives only in the player's signed cookie. */
export function newDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 (hex) of a device token: what `player_devices.token_hash` holds. */
export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(`device-token:${token}`).digest("hex");
}

/** The rate limit's key for one caller: an HMAC of the IP, so the table never holds an address. */
export function joinAttemptKey(ip: string, secret: string | undefined): string {
  const value = `join-attempt:${ip}`;
  return secret ? createHmac("sha256", secret).update(value).digest("hex") : createHash("sha256").update(value).digest("hex");
}

/** The caller's IP as Vercel reports it; a local `next dev` shares one bucket ("local"). */
export function callerIp(headers: { get(name: string): string | null }): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}

/** Over the limit, counting the attempt being made. */
export function joinRateLimited(lastMinute: number, lastHour: number): boolean {
  return lastMinute > JOIN_LIMIT_PER_MINUTE || lastHour > JOIN_LIMIT_PER_HOUR;
}

/** The device's label, fixed at join: "iPhone · App", "Desktop · Browser" … */
export function deviceLabel(userAgent: string | null | undefined, standalone: boolean): string {
  const ua = userAgent ?? "";
  let device = "Web";
  if (/iPhone/i.test(ua)) device = "iPhone";
  else if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua))) device = "iPad";
  else if (/Android/i.test(ua)) device = "Android";
  else if (/Windows|Macintosh|Mac OS X|Linux/i.test(ua)) device = "Desktop";
  return `${device} · ${standalone ? "App" : "Browser"}`;
}

export { joinUrl } from "./join-url";
