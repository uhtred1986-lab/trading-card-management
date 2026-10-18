import { protectedResourceMetadata } from "@/lib/oauth/core";
import { originOf } from "@/lib/oauth/http";

/** The path-suffixed form of the protected-resource metadata for `/api/mcp` (RFC 9728 §3): same answer as `../route.ts`. */
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return Response.json(protectedResourceMetadata(originOf(request)), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
