import { createHmac } from "node:crypto";
import { publicOrigin } from "@/lib/auth/core";
import { callerIp } from "@/lib/auth/join-code";
import type { OAuthError } from "./store";

/** What the OAuth and MCP route handlers share: the origin a request was made to, the JSON answers, the rate-limit key. */

export function originOf(request: Request): string {
  return publicOrigin(request.headers, new URL(request.url).origin);
}

/** Every token-bearing answer is `no-store` (RFC 6749 §5.1). */
export const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

type ErrorCode = OAuthError | "unsupported_grant_type" | "invalid_redirect_uri" | "invalid_client_metadata" | "too_many_requests";

export function oauthError(error: ErrorCode, description: string): Response {
  const status = error === "invalid_client" ? 401 : error === "server_error" ? 500 : error === "too_many_requests" ? 429 : 400;
  return Response.json({ error, error_description: description }, { status, headers: NO_STORE });
}

/** The body of the token and revoke endpoints: form-encoded (the standard) or JSON; clipped at 16 kB. */
export async function readParams(request: Request): Promise<Record<string, unknown> | null> {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  const text = await request.text();
  if (text.length > 16_000) return null;
  try {
    if (type.startsWith("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(text));
    if (type.startsWith("application/json")) {
      const parsed: unknown = JSON.parse(text);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    }
  } catch {
    return null;
  }
  return null;
}

/** An HMAC of the caller's IP under its own prefix, so registrations never share a counter with join attempts. */
export function oauthAttemptKey(ip: string, secret: string | undefined): string {
  return createHmac("sha256", secret ?? "oauth-attempt-no-secret").update(`oauth-register:${ip}`).digest("hex");
}

export const clientIp = (request: Request) => callerIp(request.headers);
