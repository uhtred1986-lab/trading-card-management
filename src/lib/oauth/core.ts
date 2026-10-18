/**
 * The pure half of this app's OAuth 2.1 authorization server for the rules-review MCP connector, ported from
 * gullet-cove-dm: scopes, token and PKCE helpers, what a registration may say, and the two metadata documents.
 * No database, no request, no clock of its own — the database half is `store.ts`; the doors are the routes under
 * `src/app/api/oauth`, `src/app/api/mcp` and `src/app/.well-known`. Docs: docs/architecture/auth.md,
 * "The MCP connector".
 *
 * Specs: the MCP authorization spec (2025-06-18), OAuth 2.1 (PKCE with S256 only, exact redirect URIs, public
 * clients), RFC 7591 (dynamic registration), RFC 8414 / 9728 (metadata), RFC 7009 (revocation), RFC 8707 (`resource`).
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// ── Paths ──────────────────────────────────────────────────────────────────

export const MCP_PATH = "/api/mcp";
export const AUTHORIZE_PATH = "/oauth/authorize";
export const REGISTER_PATH = "/api/oauth/register";
export const TOKEN_PATH = "/api/oauth/token";
export const REVOKE_PATH = "/api/oauth/revoke";
export const PROTECTED_RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";
export const PROTECTED_RESOURCE_METADATA_PATH_MCP = "/.well-known/oauth-protected-resource/api/mcp";
export const AUTHORIZATION_SERVER_METADATA_PATH = "/.well-known/oauth-authorization-server";

// The proxy's list of these doors, `OAUTH_PUBLIC_PATHS`, lives in `lib/auth/core.ts` (scripts/verify/auth.ts keeps the two in step).

// ── Scopes ─────────────────────────────────────────────────────────────────

/**
 * The only scopes a client can be granted. `rules-read` lists and reads (open rules, a card, the assumptions);
 * `rules-write` lets it open and comment on `rule-assumption` GitHub issues. It never writes a rule: nothing in
 * this connector touches `card_rules`. `rules-write` starts unticked on the consent screen.
 */
export const OAUTH_SCOPES = ["rules-read", "rules-write"] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];

export const DEFAULT_SCOPES: readonly OAuthScope[] = ["rules-read"];
export const WRITING_SCOPES: readonly OAuthScope[] = ["rules-write"];

export function isOAuthScope(value: unknown): value is OAuthScope {
  return typeof value === "string" && (OAUTH_SCOPES as readonly string[]).includes(value);
}

/** `scope=rules-read rules-write` -> the list in the known order; `null` when any name is unknown. */
export function parseScopes(raw: string | null | undefined): OAuthScope[] | null {
  if (raw === null || raw === undefined || raw.trim() === "") return [...DEFAULT_SCOPES];
  const names = raw.trim().split(/\s+/);
  if (names.length > OAUTH_SCOPES.length * 2) return null;
  if (!names.every(isOAuthScope)) return null;
  return OAUTH_SCOPES.filter((scope) => names.includes(scope));
}

/** What the SL ticked, narrowed to what the client asked for. Never more than either. */
export function grantableScopes(requested: readonly string[], ticked: readonly string[]): OAuthScope[] {
  return OAUTH_SCOPES.filter((scope) => requested.includes(scope) && ticked.includes(scope));
}

// ── Lifetimes ──────────────────────────────────────────────────────────────

export const CODE_TTL_SECONDS = 60;
export const ACCESS_TTL_SECONDS = 60 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export const addSeconds = (from: Date, seconds: number) => new Date(from.getTime() + seconds * 1000);

// ── Secrets ────────────────────────────────────────────────────────────────

/** 256 random bits, base64url: unguessable, so a plain hash is enough to store. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ── PKCE (S256 only) ───────────────────────────────────────────────────────

export function isPkceVerifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9\-._~]{43,128}$/.test(value);
}

export function isPkceChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9\-_]{43}$/.test(value);
}

export function pkceChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkce(verifier: unknown, challenge: string): boolean {
  if (!isPkceVerifier(verifier) || !isPkceChallenge(challenge)) return false;
  const expected = Buffer.from(pkceChallengeFor(verifier));
  const given = Buffer.from(challenge);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ── Redirect URIs and registration ─────────────────────────────────────────

const REDIRECT_URI_MAX = 2000;
export const MAX_REDIRECT_URIS = 10;
export const CLIENT_NAME_MAX = 80;
export const DEFAULT_CLIENT_NAME = "MCP client";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** `https://…` for any host, `http://` only for loopback; no credentials, no fragment, at most 2,000 characters. */
export function isAllowedRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > REDIRECT_URI_MAX) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username !== "" || url.password !== "" || url.hash !== "" || raw.includes("#")) return false;
  if (url.protocol === "https:") return url.hostname !== "";
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/** The requested URI is **exactly** one the client registered. */
export function redirectUriRegistered(registered: readonly string[], requested: string | null | undefined): requested is string {
  return typeof requested === "string" && requested !== "" && registered.includes(requested);
}

const UNSAFE_NAME_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069]", "g");

/** A name a client gave itself, made safe to print: no control characters, one line, clipped. */
export function cleanClientName(raw: unknown): string {
  const text = typeof raw === "string" ? raw : "";
  const cleaned = text.replace(UNSAFE_NAME_CHARS, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, CLIENT_NAME_MAX).trim() || DEFAULT_CLIENT_NAME;
}

export type RegistrationRefusal = { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string };
export type ParsedRegistration = { ok: true; name: string; redirectUris: string[] };

/** RFC 7591 §3.2: public clients only, the code flow and refresh tokens only, 1–10 redirect URIs. Anything else is ignored. */
export function parseRegistration(body: unknown): ParsedRegistration | RegistrationRefusal {
  const bad = (description: string): RegistrationRefusal => ({ ok: false, error: "invalid_client_metadata", description });
  if (typeof body !== "object" || body === null || Array.isArray(body)) return bad("The body must be a JSON object.");
  const meta = body as Record<string, unknown>;

  const uris = meta.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) return { ok: false, error: "invalid_redirect_uri", description: "redirect_uris is required." };
  if (uris.length > MAX_REDIRECT_URIS) return { ok: false, error: "invalid_redirect_uri", description: `At most ${MAX_REDIRECT_URIS} redirect URIs.` };
  if (!uris.every(isAllowedRedirectUri)) {
    return { ok: false, error: "invalid_redirect_uri", description: "Every redirect URI must be https, or http on localhost, with no fragment and no credentials." };
  }
  const redirectUris = [...new Set(uris as string[])];

  const method = meta.token_endpoint_auth_method;
  if (method !== undefined && method !== "none") return bad('Only public clients are supported: token_endpoint_auth_method must be "none".');
  const grants = meta.grant_types;
  if (grants !== undefined && (!Array.isArray(grants) || !grants.every((g) => g === "authorization_code" || g === "refresh_token"))) {
    return bad("grant_types may only be authorization_code and refresh_token.");
  }
  const responses = meta.response_types;
  if (responses !== undefined && (!Array.isArray(responses) || !responses.every((r) => r === "code"))) return bad('response_types may only be "code".');
  if (meta.client_name !== undefined && typeof meta.client_name !== "string") return bad("client_name must be a string.");

  return { ok: true, name: cleanClientName(meta.client_name), redirectUris };
}

// ── Metadata documents ─────────────────────────────────────────────────────

/** The one resource this server protects, as the audience a token is bound to (RFC 8707). */
export const resourceOf = (origin: string) => `${origin}${MCP_PATH}`;

export function protectedResourceMetadata(origin: string) {
  return {
    resource: resourceOf(origin),
    authorization_servers: [origin],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "DBS rules review",
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}${AUTHORIZE_PATH}`,
    token_endpoint: `${origin}${TOKEN_PATH}`,
    registration_endpoint: `${origin}${REGISTER_PATH}`,
    revocation_endpoint: `${origin}${REVOKE_PATH}`,
    scopes_supported: [...OAUTH_SCOPES],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
  };
}

/** `Bearer <token>` -> the token, else `null`. */
export function bearerToken(header: string | null | undefined): string | null {
  const match = /^Bearer ([^\s]+)$/i.exec(header ?? "");
  return match ? match[1] : null;
}
