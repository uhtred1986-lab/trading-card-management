/**
 * The SL's Google sign-in, the pure half — ported from gullet-cove-dm's
 * `src/lib/auth-core.ts`. Everything here is a function of its arguments (the
 * env, the secret, the clock), so `scripts/verify/auth.ts` checks it without a
 * request, a cookie jar or the network. `src/proxy.ts`, `./index.ts` and the
 * routes under `src/app/api/auth/` are the only callers; nothing else parses
 * the session cookie.
 *
 * During the move off HTTP Basic Auth both locks work side by side: a signed
 * SL session cookie, or a Basic Auth header the old checks accept. Once Google
 * is configured (`googleConfigured`), a signed-out page goes to `/login`
 * instead of the browser's password popup. Docs: docs/architecture/auth.md.
 */
import { SignJWT, jwtVerify } from "jose";

/** The SL session. */
export const SESSION_COOKIE = "dbs-session";
/** The OAuth round trip's short-lived cookie: state, PKCE verifier, nonce. */
export const FLOW_COOKIE = "dbs-oauth";

export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Sliding expiry: a session older than this is re-issued for another 30 days. */
export const SESSION_REFRESH_AFTER_SECONDS = 24 * 60 * 60;
export const FLOW_TTL_SECONDS = 10 * 60;

/** Where Google sends the SL back. Registered on the Google OAuth client for production and localhost:3000. */
export const CALLBACK_PATH = "/api/auth/callback/google";
export const LOGIN_START_PATH = "/api/auth/login";
export const LOGIN_PAGE = "/login";
/**
 * The old username-and-password sign-in, kept while logins move to codes: a
 * route that answers the browser's Basic Auth popup. It sits at the root so the
 * browser sends the remembered credentials to every page afterwards (browsers
 * re-send Basic credentials only below the directory that asked for them).
 */
export const PASSWORD_LOGIN_PATH = "/password-login";

/** Only the environment variables these helpers read. */
export type AuthEnv = {
  NODE_ENV?: string;
  AUTH_SECRET?: string;
  SL_EMAILS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  [name: string]: string | undefined;
};

export type SlSession = { role: "sl"; email: string };

// ── Who is an SL ───────────────────────────────────────────────────────────

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** `SL_EMAILS` is comma-separated; blanks are dropped, case and spaces don't count. */
export function parseSlEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(normaliseEmail)
    .filter((email) => email.length > 0);
}

export function isSlEmail(email: string | null | undefined, raw: string | undefined): boolean {
  if (typeof email !== "string") return false;
  const wanted = normaliseEmail(email);
  return wanted.length > 0 && parseSlEmails(raw).includes(wanted);
}

// ── Is Google sign-in set up ───────────────────────────────────────────────

/** A secret shorter than this is treated as unset (HS256 wants >= 256 bits). */
export const MIN_SECRET_LENGTH = 32;

/** The names of the variables still missing — never their values. */
export function missingAuthConfig(env: AuthEnv): string[] {
  const missing: string[] = [];
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < MIN_SECRET_LENGTH) missing.push("AUTH_SECRET");
  if (!env.GOOGLE_CLIENT_ID) missing.push("GOOGLE_CLIENT_ID");
  if (!env.GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (parseSlEmails(env.SL_EMAILS).length === 0) missing.push("SL_EMAILS");
  return missing;
}

/** Google sign-in is on only when every variable it needs is set. */
export function googleConfigured(env: AuthEnv): boolean {
  return missingAuthConfig(env).length === 0;
}

function keyOf(secret: string | undefined): Uint8Array | null {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return new TextEncoder().encode(secret);
}

// ── The session cookie ─────────────────────────────────────────────────────

const seconds = (now: Date) => Math.floor(now.getTime() / 1000);

/** A signed (HS256) token whose own claims are only `{ role: "sl", email }`, plus `iat`/`exp`. */
export async function signSession(email: string, secret: string | undefined, now: Date): Promise<string> {
  const key = keyOf(secret);
  if (!key) throw new Error("AUTH_SECRET is missing or shorter than 32 characters.");
  const iat = seconds(now);
  return new SignJWT({ role: "sl", email: normaliseEmail(email) })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_SECONDS)
    .sign(key);
}

export type VerifiedSession = { session: SlSession; issuedAt: number; expiresAt: number };

/**
 * The session in `token`, or `null` for anything wrong with it: no token, a bad
 * signature, expired, a payload that is not exactly an SL, or an address that
 * has since left `SL_EMAILS` (so removing an address signs it out on its next
 * request). Never throws.
 */
export async function verifySession(token: string | undefined | null, env: AuthEnv, now: Date): Promise<VerifiedSession | null> {
  const key = keyOf(env.AUTH_SECRET);
  if (!token || !key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], currentDate: now });
    if (payload.role !== "sl" || typeof payload.email !== "string") return null;
    if (typeof payload.iat !== "number" || typeof payload.exp !== "number") return null;
    if (!isSlEmail(payload.email, env.SL_EMAILS)) return null;
    return { session: { role: "sl", email: payload.email }, issuedAt: payload.iat, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

/** Sliding expiry: re-issue once a day, so 30 days of not opening the app signs the SL out. */
export function needsRefresh(verified: VerifiedSession, now: Date): boolean {
  return seconds(now) - verified.issuedAt >= SESSION_REFRESH_AFTER_SECONDS;
}

export type CookieOptions = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
};

export function sessionCookieOptions(env: AuthEnv): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/", maxAge: SESSION_TTL_SECONDS };
}

/** Scoped to `/api/auth`: only the login start and the callback ever see it. */
export function flowCookieOptions(env: AuthEnv): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: env.NODE_ENV === "production", path: "/api/auth", maxAge: FLOW_TTL_SECONDS };
}

// ── The OAuth round trip's own cookie ──────────────────────────────────────

export type OAuthFlow = { state: string; verifier: string; nonce: string };

/** Signed too, so the callback only trusts a flow this server started. */
export async function signFlow(flow: OAuthFlow, secret: string | undefined, now: Date): Promise<string> {
  const key = keyOf(secret);
  if (!key) throw new Error("AUTH_SECRET is missing or shorter than 32 characters.");
  const iat = seconds(now);
  return new SignJWT({ st: flow.state, cv: flow.verifier, nn: flow.nonce })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(iat)
    .setExpirationTime(iat + FLOW_TTL_SECONDS)
    .sign(key);
}

export async function verifyFlow(token: string | undefined | null, secret: string | undefined, now: Date): Promise<OAuthFlow | null> {
  const key = keyOf(secret);
  if (!token || !key) return null;
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"], currentDate: now });
    const { st, cv, nn } = payload;
    if (typeof st !== "string" || typeof cv !== "string" || typeof nn !== "string") return null;
    // A session token carries none of these, so it can never pass as a flow (and a flow has no role).
    return { state: st, verifier: cv, nonce: nn };
  } catch {
    return null;
  }
}

// ── What passes the proxy without signing in ───────────────────────────────

/**
 * Paths the proxy lets through signed out. Exactly these, no prefixes beyond
 * the ones named: the sign-in itself, and the files the browser fetches
 * without credentials (the web-app manifest, its icons and the service worker;
 * also skipped by the matcher). `/api/sync/*` and `/api/ai/agent-sdk` never
 * reach the proxy at all — the matcher leaves them out and each checks its own
 * bearer secret.
 */
export function isPublicPath(pathname: string): boolean {
  if (pathname === LOGIN_PAGE || pathname === LOGIN_START_PATH || pathname === CALLBACK_PATH) return true;
  if (pathname === PASSWORD_LOGIN_PATH) return true;
  if (pathname === "/manifest.webmanifest" || pathname === "/sw.js" || pathname === "/favicon.ico") return true;
  if (pathname.startsWith("/icons/") || pathname.startsWith("/_next/")) return true;
  return false;
}

export type ProxyDecision =
  | { kind: "pass" }
  | { kind: "pass-refresh"; email: string }
  /** Signed in and on `/login`: back to the home page. */
  | { kind: "home" }
  | { kind: "login" }
  | { kind: "unauthorised" }
  /** Google is not set up: the browser's Basic Auth popup, as before. */
  | { kind: "challenge" };

export type ProxyRequest = { pathname: string; isAction: boolean; isApi: boolean };

/**
 * What `src/proxy.ts` does with one request, as data.
 *
 * - `verified`: a valid SL session cookie.
 * - `basicOk`: the request carries a Basic Auth header the old checks accept
 *   (the env pair or an `app_users` row).
 * - `basicConfigured`: Basic Auth would be asked for at all (the env pair is
 *   set, or there are rows in `app_users`).
 * - `googleOn`: `googleConfigured(env)`.
 *
 * Nothing configured anywhere keeps local dev open, as it always was. A Server
 * Function posted to a public page is refused: Next runs an action on whatever
 * route it is posted to, and every action id is in the public JS, so `/login`
 * must not become a side door.
 */
export function decide(
  req: ProxyRequest,
  state: { verified: VerifiedSession | null; basicOk: boolean; basicConfigured: boolean; googleOn: boolean },
  now: Date,
): ProxyDecision {
  const { verified, basicOk, basicConfigured, googleOn } = state;
  if (verified) {
    if (req.pathname === LOGIN_PAGE) return { kind: "home" };
    return needsRefresh(verified, now) ? { kind: "pass-refresh", email: verified.session.email } : { kind: "pass" };
  }
  if (basicOk) return { kind: "pass" };
  if (!googleOn && !basicConfigured) return { kind: "pass" };
  if (isPublicPath(req.pathname)) return req.isAction ? { kind: "unauthorised" } : { kind: "pass" };
  if (!googleOn) return { kind: "challenge" };
  if (req.isAction || req.isApi) return { kind: "unauthorised" };
  return { kind: "login" };
}

/**
 * The origin the browser actually used, for every address the sign-in hands
 * out: the redirect_uri sent to Google, the callback URL it is checked against,
 * and the redirect after sign-in. `next dev -H 0.0.0.0` would otherwise make it
 * `http://0.0.0.0:3000`, which Google refuses. A spoofed header gains nothing:
 * Google only redirects to a URI registered on the client.
 */
export function publicOrigin(headers: Headers, fallbackOrigin: string): string {
  const host = (headers.get("x-forwarded-host") ?? headers.get("host"))?.split(",")[0]?.trim();
  if (!host) return fallbackOrigin;
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || new URL(fallbackOrigin).protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

/**
 * The name an SL session acts under everywhere the app stamps or compares an
 * owner (cards, decks, arena games, `ARENA_ADMINS`). Until SL accounts carry
 * their own owner name (next step of the move), an SL is the owner who used to
 * sign in with the `BASIC_AUTH_USER` pair, so their cards and decks stay
 * theirs; without that variable it is the address itself.
 */
export function slUsername(email: string, env: AuthEnv): string {
  const legacy = env.BASIC_AUTH_USER?.trim();
  return legacy ? legacy : normaliseEmail(email);
}
