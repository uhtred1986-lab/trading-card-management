import { db } from "@/db";
import { NO_STORE, oauthError, readParams } from "@/lib/oauth/http";
import { revokeToken } from "@/lib/oauth/store";

/**
 * Token revocation (RFC 7009). **Public by design** (`isPublicPath`): the client proves itself by naming a token only
 * it holds plus its own `client_id`; `revokeToken` revokes the token's whole family, only for that client. The answer
 * is 200 whether or not the token existed. Docs: docs/architecture/auth.md, "The MCP connector".
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const params = await readParams(request);
  if (!params) return oauthError("invalid_request", "Send an application/x-www-form-urlencoded body.");
  try {
    await revokeToken(db, params.client_id, params.token, new Date());
  } catch {
    return oauthError("server_error", "Revocation is unavailable.");
  }
  return new Response(null, { status: 200, headers: NO_STORE });
}
