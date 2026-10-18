import type { Db } from "@/db";
import type { OauthClientRow } from "@/db/schema";
import { isPkceChallenge, parseScopes, redirectUriRegistered, resourceOf, type OAuthScope } from "./core";
import { findClient } from "./store";

/**
 * Reads and validates one authorization request (`/oauth/authorize?…`), for the consent page and for the action
 * behind its buttons (which re-derives everything from its hidden fields). OAuth 2.1 order: the client must be
 * registered and unrevoked and `redirect_uri` exactly one of its URIs, else `error` (an error page, never a
 * redirect); only then is every other fault sent back to the client as `error=…&state=…`.
 */
export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
  resource?: string;
}

export type AuthorizeRequest =
  | { kind: "error" }
  | { kind: "redirect-error"; redirectUri: string; error: "unsupported_response_type" | "invalid_request" | "invalid_scope" | "invalid_target"; description: string; state: string | null }
  | { kind: "ok"; client: OauthClientRow; redirectUri: string; codeChallenge: string; requestedScopes: OAuthScope[]; state: string | null; resource: string };

const STATE_MAX = 500;

export async function resolveAuthorizeRequest(db: Db, params: AuthorizeParams, origin: string): Promise<AuthorizeRequest> {
  const client = await findClient(db, params.client_id);
  if (!client || !redirectUriRegistered(client.redirectUris, params.redirect_uri)) return { kind: "error" };
  const redirectUri = params.redirect_uri as string;
  const state = typeof params.state === "string" && params.state !== "" ? params.state.slice(0, STATE_MAX) : null;
  const back = (error: Extract<AuthorizeRequest, { kind: "redirect-error" }>["error"], description: string): AuthorizeRequest => ({ kind: "redirect-error", redirectUri, error, description, state });

  if (params.response_type !== "code") return back("unsupported_response_type", "response_type must be code.");
  if (!isPkceChallenge(params.code_challenge)) return back("invalid_request", "code_challenge is required (S256).");
  if (params.code_challenge_method !== "S256") return back("invalid_request", "code_challenge_method must be S256.");
  const requestedScopes = parseScopes(params.scope);
  if (!requestedScopes) return back("invalid_scope", "Unknown scope.");
  const resource = resourceOf(origin);
  if (params.resource !== undefined && params.resource !== "" && params.resource !== resource) return back("invalid_target", "resource must be this server's MCP endpoint.");

  return { kind: "ok", client, redirectUri, codeChallenge: params.code_challenge, requestedScopes, state, resource };
}

/** `redirect_uri` plus the answer's parameters, keeping whatever query the registered URI already had. */
export function redirectWith(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) if (value !== null) url.searchParams.set(name, value);
  return url.toString();
}
