import { db } from "@/db";
import { handleMcpPost } from "@/lib/rules-review/mcp";
import { mcpOriginAllowed } from "@/lib/oauth/origin";
import { PROTECTED_RESOURCE_METADATA_PATH, bearerToken, resourceOf } from "@/lib/oauth/core";
import { originOf } from "@/lib/oauth/http";
import { verifyAccessToken } from "@/lib/oauth/store";

/**
 * The rules-review MCP endpoint for the claude.ai connector: Streamable HTTP, stateless, POST only. **Public to the
 * proxy by design** (`isPublicPath`): an MCP client has no browser session, so this route authenticates itself, and
 * every request passes these locks in order:
 *
 * 1. `Origin`, where the request carries one, must be this site, claude.ai/claude.com, a loopback page or an origin in
 *    `MCP_ALLOWED_ORIGINS` (`mcpOriginAllowed`): the spec's DNS-rebinding guard. 403 otherwise.
 * 2. `GET` and `DELETE` answer 405 (no server-initiated stream, no sessions).
 * 3. A `Bearer` access token is required and must pass `verifyAccessToken` (unknown, expired, revoked, client revoked,
 *    wrong resource, or the address is no longer an SL): **401** with
 *    `WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource"`, one answer for
 *    every failure so nothing says which check failed.
 * 4. Only then is anything parsed: `handleMcpPost` serves exactly the tools of the token's granted scopes.
 *
 * Reads rules; the only write is a labelled GitHub issue (`rules-write`). Docs: docs/architecture/auth.md,
 * "The MCP connector".
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function unauthorized(origin: string, presented: boolean): Response {
  const challenge = `Bearer${presented ? ' error="invalid_token",' : ""} resource_metadata="${origin}${PROTECTED_RESOURCE_METADATA_PATH}"`;
  return Response.json({ error: presented ? "invalid_token" : "unauthorized" }, { status: 401, headers: { ...NO_STORE, "WWW-Authenticate": challenge } });
}

const methodNotAllowed = () => new Response("Method Not Allowed", { status: 405, headers: { ...NO_STORE, Allow: "POST" } });

export async function POST(request: Request) {
  const origin = originOf(request);
  if (!mcpOriginAllowed(request.headers.get("origin"), origin)) return Response.json({ error: "forbidden_origin" }, { status: 403, headers: NO_STORE });

  const bearer = bearerToken(request.headers.get("authorization"));
  if (!bearer) return unauthorized(origin, false);
  let token: Awaited<ReturnType<typeof verifyAccessToken>>;
  try {
    token = await verifyAccessToken(db, bearer, resourceOf(origin), new Date());
  } catch {
    return Response.json({ error: "server_error" }, { status: 503, headers: NO_STORE });
  }
  if (!token) return unauthorized(origin, true);

  return handleMcpPost(request, { db, env: process.env, scopes: token.scopes });
}

export function GET() {
  return methodNotAllowed();
}

export function DELETE() {
  return methodNotAllowed();
}
