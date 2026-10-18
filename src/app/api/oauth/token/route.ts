import { db } from "@/db";
import { exchangeCode, refreshTokens } from "@/lib/oauth/store";
import { NO_STORE, oauthError, readParams } from "@/lib/oauth/http";

/**
 * The token endpoint. **Public by design** (`isPublicPath`): a client holds no session, it holds a one-time code plus
 * its PKCE verifier, or a refresh token. Every credential is checked in `src/lib/oauth/store.ts` (`exchangeCode`,
 * `refreshTokens`); this file only reads the form and says the result. Refusals are the standard OAuth error body,
 * always `no-store`, never a stack trace. Docs: docs/architecture/auth.md, "The MCP connector".
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const now = new Date();
  const params = await readParams(request);
  if (!params) return oauthError("invalid_request", "Send an application/x-www-form-urlencoded body.");

  try {
    if (params.grant_type === "authorization_code") {
      const result = await exchangeCode(
        db,
        { clientId: params.client_id, code: params.code, redirectUri: params.redirect_uri, codeVerifier: params.code_verifier, resource: params.resource },
        now,
      );
      return result.ok ? Response.json(result.tokens, { headers: NO_STORE }) : oauthError(result.error, result.description);
    }
    if (params.grant_type === "refresh_token") {
      const result = await refreshTokens(db, { clientId: params.client_id, refreshToken: params.refresh_token, scope: params.scope }, now);
      return result.ok ? Response.json(result.tokens, { headers: NO_STORE }) : oauthError(result.error, result.description);
    }
    return oauthError("unsupported_grant_type", "Only authorization_code and refresh_token are supported.");
  } catch {
    return oauthError("server_error", "The token endpoint is unavailable.");
  }
}
