import { db } from "@/db";
import { recordJoinAttempt } from "@/lib/auth/access";
import { parseRegistration } from "@/lib/oauth/core";
import { NO_STORE, clientIp, oauthAttemptKey, oauthError } from "@/lib/oauth/http";
import { registerClient } from "@/lib/oauth/store";

/**
 * Dynamic client registration (RFC 7591): claude.ai registers itself here before it asks the SL for anything.
 * **Public by design** (`isPublicPath`; the client has no account), and harmless by design: a registration only
 * creates a name and a redirect-URI list and grants nothing. Access comes only from the SL's Allow on
 * `/oauth/authorize`. Locks: rate limit first (the join-attempt counter, own key prefix; fail closed), a JSON body of
 * at most 10 kB, `parseRegistration`, and `registerClient` (sweeps stale rows, refuses past 200).
 * Docs: docs/architecture/auth.md, "The MCP connector".
 */
export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 10_000;

export async function POST(request: Request) {
  const now = new Date();
  try {
    const { limited } = await recordJoinAttempt(db, oauthAttemptKey(clientIp(request), process.env.AUTH_SECRET), now);
    if (limited) return oauthError("too_many_requests", "Too many registrations; wait a minute.");
  } catch {
    return oauthError("server_error", "Registration is unavailable.");
  }

  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return oauthError("invalid_client_metadata", "Send application/json.");
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length === 0 || text.length > MAX_BODY_CHARS) return oauthError("invalid_client_metadata", "The body is empty or too long.");
    body = JSON.parse(text);
  } catch {
    return oauthError("invalid_client_metadata", "The body is not JSON.");
  }

  const parsed = parseRegistration(body);
  if (!parsed.ok) return oauthError(parsed.error, parsed.description);

  try {
    const stored = await registerClient(db, parsed, now);
    if (!stored.ok) return oauthError(stored.error, stored.description);
    return Response.json(
      {
        client_id: stored.clientId,
        client_id_issued_at: Math.floor(now.getTime() / 1000),
        client_name: parsed.name,
        redirect_uris: parsed.redirectUris,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
      { status: 201, headers: NO_STORE },
    );
  } catch {
    return oauthError("server_error", "Registration is unavailable.");
  }
}
