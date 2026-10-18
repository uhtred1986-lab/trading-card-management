import { and, count, eq, isNull, lt, notExists, or } from "drizzle-orm";
import type { Db } from "@/db";
import { oauthClients, oauthCodes, oauthTokens, type OauthClientRow } from "@/db/schema";
import { isAllowedSl, normaliseEmail, type AuthEnv } from "@/lib/auth/core";
import { isAddedSl } from "@/lib/auth/access";
import {
  ACCESS_TTL_SECONDS,
  CODE_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  addSeconds,
  isOAuthScope,
  isPkceChallenge,
  randomToken,
  redirectUriRegistered,
  sha256Hex,
  verifyPkce,
  type OAuthScope,
  type ParsedRegistration,
} from "./core";

/**
 * The database half of the OAuth server (ported from gullet-cove-dm). Every decision that grants or keeps access
 * is here, and `docs/architecture/auth.md` ("The MCP connector") lists them:
 *
 * - **Only hashes are stored** (`sha256Hex`).
 * - **Only an SL's address is ever bound to a code or a token** (`SL_EMAILS` or an `sl_accounts` row), asked again
 *   on every exchange, refresh and `/api/mcp` call: removing an SL cuts off their tokens. Players never get one.
 * - **A code is single use** (one conditional UPDATE); a second use revokes the tokens the first issued.
 * - **A refresh token is single use** (rotation); presenting an old one revokes the whole family.
 * - **A revoked client has no working token**; a refresh can never widen the scopes.
 *
 * Never throws for a bad credential: every refusal is a value, so a route turns it into the standard OAuth error.
 */

export type OAuthError = "invalid_request" | "invalid_client" | "invalid_grant" | "invalid_scope" | "invalid_target" | "server_error";
type Refused = { ok: false; error: OAuthError; description: string };
const refuse = (error: OAuthError, description: string): Refused => ({ ok: false, error, description });

export const MAX_CLIENTS = 200;
const STALE_CLIENT_SECONDS = 24 * 60 * 60;

/** Is this still an SL (an owner in `SL_EMAILS`, or an added SL)? */
export const stillSl = (db: Db, email: string, env: AuthEnv) => isAllowedSl(email, env, (e) => isAddedSl(db, e));

// ── Clients ────────────────────────────────────────────────────────────────

/** Stores a registration (the route has rate-limited and validated it). First sweeps what nobody used. */
export async function registerClient(db: Db, parsed: ParsedRegistration, now: Date): Promise<{ ok: true; clientId: string } | Refused> {
  const dayAgo = addSeconds(now, -STALE_CLIENT_SECONDS);
  await db
    .delete(oauthClients)
    .where(and(lt(oauthClients.createdAt, dayAgo), notExists(db.select({ one: oauthTokens.id }).from(oauthTokens).where(eq(oauthTokens.clientRef, oauthClients.id)))));
  await db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, dayAgo));
  await db.delete(oauthTokens).where(lt(oauthTokens.refreshExpiresAt, dayAgo));
  const [total] = await db.select({ n: count() }).from(oauthClients);
  if ((total?.n ?? 0) >= MAX_CLIENTS) return refuse("server_error", "Too many registered clients; try again later.");
  const clientId = randomToken(32);
  await db.insert(oauthClients).values({ clientId, name: parsed.name, redirectUris: parsed.redirectUris, createdAt: now });
  return { ok: true, clientId };
}

/** The client for a public id, or `null` when it is unknown **or revoked**. */
export async function findClient(db: Db, clientId: unknown): Promise<OauthClientRow | null> {
  if (typeof clientId !== "string" || clientId === "" || clientId.length > 64) return null;
  const [row] = await db.select().from(oauthClients).where(and(eq(oauthClients.clientId, clientId), isNull(oauthClients.revokedAt))).limit(1);
  return row ?? null;
}

// ── The authorization code (after the SL said Allow) ───────────────────────

export interface CodeRequest {
  client: OauthClientRow;
  /** The signed-in SL's Google address. */
  email: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: readonly OAuthScope[];
  resource: string;
}

/** Issues the one-time code, re-checking everything it is bound to. Returns the plaintext code once; only its hash is kept. */
export async function createAuthorizationCode(db: Db, request: CodeRequest, now: Date, env: AuthEnv = process.env): Promise<{ ok: true; code: string } | Refused> {
  if (!(await stillSl(db, request.email, env))) return refuse("invalid_request", "Not an SL address.");
  if (request.client.revokedAt) return refuse("invalid_client", "Client revoked.");
  if (!redirectUriRegistered(request.client.redirectUris, request.redirectUri)) return refuse("invalid_request", "redirect_uri is not registered.");
  if (!isPkceChallenge(request.codeChallenge)) return refuse("invalid_request", "code_challenge must be a S256 challenge.");
  if (request.scopes.length === 0 || !request.scopes.every(isOAuthScope)) return refuse("invalid_scope", "No valid scope.");
  const code = randomToken(32);
  await db.insert(oauthCodes).values({
    clientRef: request.client.id,
    codeHash: sha256Hex(code),
    email: normaliseEmail(request.email),
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scopes: [...request.scopes],
    resource: request.resource,
    expiresAt: addSeconds(now, CODE_TTL_SECONDS),
    createdAt: now,
  });
  return { ok: true, code };
}

// ── Tokens ─────────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function issueTokens(db: Db, client: OauthClientRow, grant: { email: string; scopes: string[]; resource: string; familyId: string }, now: Date): Promise<TokenResponse> {
  const access = randomToken(32);
  const refresh = randomToken(32);
  await db.insert(oauthTokens).values({
    clientRef: client.id,
    familyId: grant.familyId,
    email: grant.email,
    scopes: grant.scopes,
    resource: grant.resource,
    accessHash: sha256Hex(access),
    refreshHash: sha256Hex(refresh),
    accessExpiresAt: addSeconds(now, ACCESS_TTL_SECONDS),
    refreshExpiresAt: addSeconds(now, REFRESH_TTL_SECONDS),
    createdAt: now,
  });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_SECONDS, refresh_token: refresh, scope: grant.scopes.join(" ") };
}

async function revokeFamily(db: Db, familyId: string, now: Date) {
  await db.update(oauthTokens).set({ revokedAt: now }).where(and(eq(oauthTokens.familyId, familyId), isNull(oauthTokens.revokedAt)));
}

export interface CodeExchange {
  clientId: unknown;
  code: unknown;
  redirectUri: unknown;
  codeVerifier: unknown;
  resource?: unknown;
}

/**
 * `grant_type=authorization_code`: the client exists and owns the code; the code is claimed with one conditional
 * UPDATE (a replay revokes the first exchange's tokens); then, the code being spent whatever happens: not expired,
 * exact redirect URI, S256 PKCE, the address still an SL, the `resource` the one it was issued for.
 */
export async function exchangeCode(db: Db, input: CodeExchange, now: Date, env: AuthEnv = process.env): Promise<{ ok: true; tokens: TokenResponse } | Refused> {
  const client = await findClient(db, input.clientId);
  if (!client) return refuse("invalid_client", "Unknown or revoked client.");
  if (typeof input.code !== "string" || input.code === "" || input.code.length > 200) return refuse("invalid_grant", "Invalid code.");
  const [row] = await db.select().from(oauthCodes).where(eq(oauthCodes.codeHash, sha256Hex(input.code))).limit(1);
  if (!row || row.clientRef !== client.id) return refuse("invalid_grant", "Invalid code.");

  const familyId = randomToken(16);
  const claimed = await db
    .update(oauthCodes)
    .set({ usedAt: now, familyId })
    .where(and(eq(oauthCodes.id, row.id), isNull(oauthCodes.usedAt)))
    .returning({ id: oauthCodes.id });
  if (claimed.length === 0) {
    if (row.familyId) await revokeFamily(db, row.familyId, now);
    return refuse("invalid_grant", "Code already used.");
  }

  if (row.expiresAt.getTime() <= now.getTime()) return refuse("invalid_grant", "Code expired.");
  if (typeof input.redirectUri !== "string" || input.redirectUri !== row.redirectUri) return refuse("invalid_grant", "redirect_uri does not match.");
  if (!verifyPkce(input.codeVerifier, row.codeChallenge)) return refuse("invalid_grant", "PKCE verification failed.");
  if (!(await stillSl(db, row.email, env))) return refuse("invalid_grant", "Not an SL address.");
  if (input.resource !== undefined && input.resource !== row.resource) return refuse("invalid_target", "resource does not match.");

  return { ok: true, tokens: await issueTokens(db, client, { email: row.email, scopes: row.scopes, resource: row.resource, familyId }, now) };
}

export interface RefreshExchange {
  clientId: unknown;
  refreshToken: unknown;
  scope?: unknown;
}

/** `grant_type=refresh_token`, with rotation; a replayed or revoked refresh token revokes the whole family. */
export async function refreshTokens(db: Db, input: RefreshExchange, now: Date, env: AuthEnv = process.env): Promise<{ ok: true; tokens: TokenResponse } | Refused> {
  const client = await findClient(db, input.clientId);
  if (!client) return refuse("invalid_client", "Unknown or revoked client.");
  if (typeof input.refreshToken !== "string" || input.refreshToken === "" || input.refreshToken.length > 200) return refuse("invalid_grant", "Invalid refresh token.");
  const [row] = await db.select().from(oauthTokens).where(eq(oauthTokens.refreshHash, sha256Hex(input.refreshToken))).limit(1);
  if (!row || row.clientRef !== client.id) return refuse("invalid_grant", "Invalid refresh token.");

  if (row.refreshUsedAt || row.revokedAt) {
    await revokeFamily(db, row.familyId, now);
    return refuse("invalid_grant", "Refresh token already used.");
  }
  if (row.refreshExpiresAt.getTime() <= now.getTime()) return refuse("invalid_grant", "Refresh token expired.");
  if (!(await stillSl(db, row.email, env))) return refuse("invalid_grant", "Not an SL address.");

  let scopes = row.scopes;
  if (typeof input.scope === "string" && input.scope.trim() !== "") {
    const asked = input.scope.trim().split(/\s+/);
    if (!asked.every((scope) => row.scopes.includes(scope))) return refuse("invalid_scope", "A refresh cannot widen the scopes.");
    scopes = row.scopes.filter((scope) => asked.includes(scope));
  }

  const claimed = await db
    .update(oauthTokens)
    .set({ refreshUsedAt: now })
    .where(and(eq(oauthTokens.id, row.id), isNull(oauthTokens.refreshUsedAt), isNull(oauthTokens.revokedAt)))
    .returning({ id: oauthTokens.id });
  if (claimed.length === 0) {
    await revokeFamily(db, row.familyId, now);
    return refuse("invalid_grant", "Refresh token already used.");
  }
  return { ok: true, tokens: await issueTokens(db, client, { email: row.email, scopes, resource: row.resource, familyId: row.familyId }, now) };
}

/** RFC 7009: revokes the token's whole family, only for the client it was issued to. Unknown tokens are not an error. */
export async function revokeToken(db: Db, clientId: unknown, token: unknown, now: Date): Promise<void> {
  const client = await findClient(db, clientId);
  if (!client || typeof token !== "string" || token === "" || token.length > 200) return;
  const hash = sha256Hex(token);
  const [row] = await db
    .select({ familyId: oauthTokens.familyId })
    .from(oauthTokens)
    .where(and(eq(oauthTokens.clientRef, client.id), or(eq(oauthTokens.accessHash, hash), eq(oauthTokens.refreshHash, hash))))
    .limit(1);
  if (row) await revokeFamily(db, row.familyId, now);
}

// ── The check `/api/mcp` makes on every call ───────────────────────────────

export interface VerifiedToken {
  tokenId: number;
  clientId: string;
  clientName: string;
  email: string;
  scopes: OAuthScope[];
}

const LAST_USED_EVERY_SECONDS = 60;

/**
 * Is this bearer token good **right now**, for this resource? The hash is on file, not revoked, not expired, bound to
 * this resource, its client exists and is not revoked, **and its address is still an SL**. `null` for every failure
 * alike (the route answers one 401 and says nothing about which check failed).
 */
export async function verifyAccessToken(db: Db, token: string, resource: string, now: Date, env: AuthEnv = process.env): Promise<VerifiedToken | null> {
  if (token === "" || token.length > 200) return null;
  const [row] = await db
    .select({ token: oauthTokens, client: oauthClients })
    .from(oauthTokens)
    .innerJoin(oauthClients, eq(oauthTokens.clientRef, oauthClients.id))
    .where(eq(oauthTokens.accessHash, sha256Hex(token)))
    .limit(1);
  if (!row) return null;
  if (row.token.revokedAt || row.client.revokedAt) return null;
  if (row.token.accessExpiresAt.getTime() <= now.getTime()) return null;
  if (row.token.resource !== resource) return null;
  if (!(await stillSl(db, row.token.email, env))) return null;
  const scopes = row.token.scopes.filter(isOAuthScope);
  if (scopes.length === 0) return null;
  await db
    .update(oauthClients)
    .set({ lastUsedAt: now })
    .where(and(eq(oauthClients.id, row.client.id), or(isNull(oauthClients.lastUsedAt), lt(oauthClients.lastUsedAt, addSeconds(now, -LAST_USED_EVERY_SECONDS)))));
  return { tokenId: row.token.id, clientId: row.client.clientId, clientName: row.client.name, email: row.token.email, scopes };
}
