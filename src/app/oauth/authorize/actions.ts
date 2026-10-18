"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { requireSl } from "@/lib/auth";
import { publicOrigin } from "@/lib/auth/core";
import { AUTHORIZE_PATH, grantableScopes } from "@/lib/oauth/core";
import { redirectWith, resolveAuthorizeRequest, type AuthorizeParams } from "@/lib/oauth/authorize";
import { createAuthorizationCode } from "@/lib/oauth/store";

/**
 * Allow / Deny on the consent screen. SL-only (`requireSl`: a player can never get a token), and the **only** place
 * an authorization code is issued. Nothing the browser posts is trusted: the hidden fields are validated again like
 * the page's own query (`resolveAuthorizeRequest`), the signed-in SL must have a Google address (a Basic Auth SL has
 * none to bind a token to), and the granted scopes are what the SL **ticked**, narrowed to what the client **asked
 * for** (`grantableScopes`): `rules-write` never rides along with `rules-read`.
 */
const field = (form: FormData, name: string) => {
  const value = form.get(name);
  return typeof value === "string" && value !== "" ? value : undefined;
};

export async function decideAuthorization(formData: FormData): Promise<void> {
  const sl = await requireSl();
  const now = new Date();
  const origin = publicOrigin(await headers(), "http://localhost:3000");
  const params: AuthorizeParams = {};
  for (const name of ["response_type", "client_id", "redirect_uri", "code_challenge", "code_challenge_method", "scope", "state", "resource"] as const) params[name] = field(formData, name);

  // Decide first, redirect last: `redirect()` works by throwing, so it stays outside any try block.
  let target: string = AUTHORIZE_PATH;
  const request = await resolveAuthorizeRequest(db, params, origin).catch(() => ({ kind: "error" as const }));
  if (request.kind === "redirect-error") {
    target = redirectWith(request.redirectUri, { error: request.error, error_description: request.description, state: request.state });
  } else if (request.kind === "ok") {
    const scopes = grantableScopes(request.requestedScopes, formData.getAll("grant").filter((v): v is string => typeof v === "string"));
    if (formData.get("decision") !== "allow" || scopes.length === 0 || !sl.email) {
      target = redirectWith(request.redirectUri, { error: "access_denied", state: request.state });
    } else {
      const created = await createAuthorizationCode(
        db,
        { client: request.client, email: sl.email, redirectUri: request.redirectUri, codeChallenge: request.codeChallenge, scopes, resource: request.resource },
        now,
      ).catch(() => null);
      target = created?.ok
        ? redirectWith(request.redirectUri, { code: created.code, state: request.state })
        : redirectWith(request.redirectUri, { error: "server_error", state: request.state });
    }
  }
  redirect(target);
}
