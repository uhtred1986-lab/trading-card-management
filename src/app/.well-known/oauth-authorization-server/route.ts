import { authorizationServerMetadata } from "@/lib/oauth/core";
import { originOf } from "@/lib/oauth/http";

/**
 * RFC 8414 authorization-server metadata: where to register, authorize, exchange and revoke. Public by design (a
 * client reads it before it has anything), static, **no database, no secret**. Docs: docs/architecture/auth.md.
 */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(authorizationServerMetadata(originOf(request)), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
