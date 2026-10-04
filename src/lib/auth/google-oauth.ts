/**
 * Google sign-in for the SL, on `openid-client` (panva) — ported from
 * gullet-cove-dm. The authorization-code flow with PKCE (S256), `state` and
 * `nonce`, and the ID token's claims checked (issuer, audience, expiry, nonce).
 * No hand-written OAuth. The route handlers under `src/app/api/auth/` are thin
 * I/O around `beginSignIn` and `completeSignIn`.
 *
 * Docs: docs/architecture/auth.md.
 */
import * as client from "openid-client";
import { isAllowedSl, type AddedSlCheck, signFlow, signSession, verifyFlow, type AuthEnv, type OAuthFlow } from "./core";

export const GOOGLE_ISSUER = "https://accounts.google.com";

type FetchLike = client.CustomFetch;

let cachedConfig: Promise<client.Configuration> | null = null;

/**
 * Google's configuration from its `.well-known/openid-configuration`,
 * discovered once per server process and then reused. A failed discovery is
 * not cached, so the next sign-in tries again. `fetchImpl` is the test seam.
 */
export function googleConfig(env: AuthEnv, fetchImpl?: FetchLike): Promise<client.Configuration> {
  if (!cachedConfig) {
    const options = fetchImpl ? { [client.customFetch]: fetchImpl } : undefined;
    cachedConfig = client
      .discovery(new URL(GOOGLE_ISSUER), env.GOOGLE_CLIENT_ID ?? "", env.GOOGLE_CLIENT_SECRET ?? "", undefined, options)
      .then((config) => {
        if (fetchImpl) config[client.customFetch] = fetchImpl;
        return config;
      })
      .catch((error: unknown) => {
        cachedConfig = null;
        throw error;
      });
  }
  return cachedConfig;
}

/** Where Google should send the SL, and the signed cookie that remembers this attempt. */
export async function beginSignIn(config: client.Configuration, redirectUri: string, secret: string | undefined, now: Date): Promise<{ url: URL; flowCookie: string }> {
  const flow: OAuthFlow = {
    state: client.randomState(),
    verifier: client.randomPKCECodeVerifier(),
    nonce: client.randomNonce(),
  };
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid email",
    response_type: "code",
    code_challenge: await client.calculatePKCECodeChallenge(flow.verifier),
    code_challenge_method: "S256",
    state: flow.state,
    nonce: flow.nonce,
    // Always show Google's account chooser, so a refused address can try another.
    prompt: "select_account",
  });
  return { url, flowCookie: await signFlow(flow, secret, now) };
}

export type SignInResult =
  | { ok: true; email: string; sessionCookie: string }
  /** No flow cookie, or its state is not the one Google sent back. */
  | { ok: false; reason: "state" }
  /** A verified Google address that is not an SL. Nothing is stored for it. */
  | { ok: false; reason: "refused" }
  /** Anything else: Google said no, the code was bad, the token did not check out. */
  | { ok: false; reason: "failed" };

/**
 * The callback: check `state` against the signed flow cookie, trade the code
 * (with the PKCE verifier) for tokens, read the verified address, and sign a
 * session only for an address in `SL_EMAILS` or an added SL (`isAddedSl`). Never throws.
 */
export async function completeSignIn(config: client.Configuration, callbackUrl: URL, flowCookie: string | undefined, env: AuthEnv, now: Date, isAddedSl?: AddedSlCheck): Promise<SignInResult> {
  const flow = await verifyFlow(flowCookie, env.AUTH_SECRET, now);
  const returnedState = callbackUrl.searchParams.get("state");
  if (!flow || !returnedState || returnedState !== flow.state) return { ok: false, reason: "state" };
  if (callbackUrl.searchParams.has("error")) return { ok: false, reason: "failed" };

  let claims: client.IDToken | undefined;
  try {
    const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
      expectedNonce: flow.nonce,
      idTokenExpected: true,
    });
    claims = tokens.claims();
  } catch {
    return { ok: false, reason: "failed" };
  }

  const email = typeof claims?.email === "string" ? claims.email : null;
  if (!email || claims?.email_verified !== true) return { ok: false, reason: "refused" };
  if (!(await isAllowedSl(email, env, isAddedSl))) return { ok: false, reason: "refused" };
  return { ok: true, email, sessionCookie: await signSession(email, env.AUTH_SECRET, now) };
}
