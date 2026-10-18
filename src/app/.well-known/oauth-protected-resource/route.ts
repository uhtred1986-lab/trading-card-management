import { protectedResourceMetadata } from "@/lib/oauth/core";
import { originOf } from "@/lib/oauth/http";

/**
 * RFC 9728 protected-resource metadata for `/api/mcp`: names the authorization server that guards it. Public by
 * design (it is what a 401 from `/api/mcp` points at), static, **no database, no secret**. The path-suffixed twin
 * `/.well-known/oauth-protected-resource/api/mcp` answers the same. Docs: docs/architecture/auth.md.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(protectedResourceMetadata(originOf(request)), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
