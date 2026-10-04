/**
 * The SL's Google sign-in, the pure half (`src/lib/auth/core.ts`) and the
 * callback's early refusals (`completeSignIn`). No request, no cookie jar, no
 * network. Run by `npm test`.
 */
import assert from "node:assert/strict";
import type { Configuration } from "openid-client";
import {
  CALLBACK_PATH,
  LOGIN_PAGE,
  LOGIN_START_PATH,
  PASSWORD_LOGIN_PATH,
  SESSION_REFRESH_AFTER_SECONDS,
  SESSION_TTL_SECONDS,
  decide,
  googleConfigured,
  isPublicPath,
  isSlEmail,
  missingAuthConfig,
  needsRefresh,
  parseSlEmails,
  publicOrigin,
  signFlow,
  signSession,
  slUsername,
  verifyFlow,
  verifySession,
  type VerifiedSession,
} from "../../src/lib/auth/core";
import { completeSignIn } from "../../src/lib/auth/google-oauth";

const SECRET = "s".repeat(40);
const OTHER = "o".repeat(40);
const ENV = { AUTH_SECRET: SECRET, SL_EMAILS: " Owner@Example.com , sl2@example.com,, ", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" };
const NOW = new Date("2026-10-04T12:00:00Z");
const later = (s: number) => new Date(NOW.getTime() + s * 1000);

async function main() {
  // ── Who is an SL ──
  assert.deepEqual(parseSlEmails(ENV.SL_EMAILS), ["owner@example.com", "sl2@example.com"]);
  assert.deepEqual(parseSlEmails(undefined), []);
  assert.equal(isSlEmail("OWNER@example.com ", ENV.SL_EMAILS), true);
  assert.equal(isSlEmail("player@example.com", ENV.SL_EMAILS), false);
  assert.equal(isSlEmail("", ENV.SL_EMAILS), false);
  assert.equal(isSlEmail(null, ENV.SL_EMAILS), false);

  // ── Configuration ──
  assert.deepEqual(missingAuthConfig(ENV), []);
  assert.equal(googleConfigured(ENV), true);
  assert.deepEqual(missingAuthConfig({}), ["AUTH_SECRET", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SL_EMAILS"]);
  assert.deepEqual(missingAuthConfig({ ...ENV, AUTH_SECRET: "short" }), ["AUTH_SECRET"], "a short secret counts as unset");
  assert.equal(googleConfigured({ ...ENV, SL_EMAILS: " , " }), false);

  // ── Session cookie ──
  const token = await signSession("Owner@Example.com", SECRET, NOW);
  const verified = await verifySession(token, ENV, NOW);
  assert.ok(verified);
  assert.deepEqual(verified.session, { role: "sl", email: "owner@example.com" });
  assert.equal(verified.expiresAt - verified.issuedAt, SESSION_TTL_SECONDS);
  assert.equal(await verifySession(token, { ...ENV, AUTH_SECRET: OTHER }, NOW), null, "another secret");
  assert.equal(await verifySession(token, { ...ENV, SL_EMAILS: "sl2@example.com" }, NOW), null, "leaving SL_EMAILS signs out");
  assert.equal(await verifySession(token, ENV, later(SESSION_TTL_SECONDS + 1)), null, "expired");
  assert.equal(await verifySession(token + "x", ENV, NOW), null, "tampered");
  assert.equal(await verifySession(undefined, ENV, NOW), null);
  assert.equal(await verifySession(token, { ...ENV, AUTH_SECRET: undefined }, NOW), null, "no secret, no session");
  await assert.rejects(() => signSession("owner@example.com", "short", NOW));

  assert.equal(needsRefresh(verified, NOW), false);
  assert.equal(needsRefresh(verified, later(SESSION_REFRESH_AFTER_SECONDS)), true);

  // ── Flow cookie, and the two never pass as each other ──
  const flow = { state: "st", verifier: "cv", nonce: "nn" };
  const flowToken = await signFlow(flow, SECRET, NOW);
  assert.deepEqual(await verifyFlow(flowToken, SECRET, NOW), flow);
  assert.equal(await verifyFlow(flowToken, OTHER, NOW), null);
  assert.equal(await verifyFlow(flowToken, SECRET, later(11 * 60)), null, "a flow lasts ten minutes");
  assert.equal(await verifySession(flowToken, ENV, NOW), null, "a flow cookie is no session");
  assert.equal(await verifyFlow(token, SECRET, NOW), null, "a session cookie is no flow");

  // ── Public paths ──
  for (const p of [LOGIN_PAGE, LOGIN_START_PATH, CALLBACK_PATH, PASSWORD_LOGIN_PATH, "/manifest.webmanifest", "/sw.js", "/icons/192.png", "/favicon.ico"]) {
    assert.equal(isPublicPath(p), true, p);
  }
  for (const p of ["/", "/collection", "/login/x", "/api/auth", "/api/auth/callback/google/x", "/password-login/x", "/settings/users", "/api/v1/decks"]) {
    assert.equal(isPublicPath(p), false, p);
  }

  // ── The proxy's decision ──
  const page = { pathname: "/collection", isAction: false, isApi: false };
  const api = { pathname: "/api/v1/decks", isAction: false, isApi: true };
  const action = { pathname: "/collection", isAction: true, isApi: false };
  const none = { verified: null, basicOk: false, basicConfigured: false, googleOn: false };
  const google = { ...none, googleOn: true, basicConfigured: true };
  const fresh: VerifiedSession = verified;

  assert.deepEqual(decide(page, none, NOW), { kind: "pass" }, "nothing configured: local dev runs open");
  assert.deepEqual(decide(page, { ...none, basicConfigured: true }, NOW), { kind: "challenge" }, "Basic only: the popup, as before");
  assert.deepEqual(decide(page, { ...none, basicConfigured: true, basicOk: true }, NOW), { kind: "pass" });
  assert.deepEqual(decide(page, google, NOW), { kind: "login" });
  assert.deepEqual(decide(api, google, NOW), { kind: "unauthorised" });
  assert.deepEqual(decide(action, google, NOW), { kind: "unauthorised" });
  assert.deepEqual(decide(page, { ...google, basicOk: true }, NOW), { kind: "pass" }, "an old password login still works");
  assert.deepEqual(decide(page, { ...google, verified: fresh }, NOW), { kind: "pass" });
  assert.deepEqual(decide(page, { ...google, verified: fresh }, later(SESSION_REFRESH_AFTER_SECONDS)), { kind: "pass-refresh", email: "owner@example.com" });
  assert.deepEqual(decide({ ...page, pathname: LOGIN_PAGE }, { ...google, verified: fresh }, NOW), { kind: "home" });
  assert.deepEqual(decide({ ...page, pathname: LOGIN_PAGE }, google, NOW), { kind: "pass" });
  assert.deepEqual(decide({ ...page, pathname: PASSWORD_LOGIN_PATH }, google, NOW), { kind: "pass" });
  assert.deepEqual(decide({ ...action, pathname: LOGIN_PAGE }, google, NOW), { kind: "unauthorised" }, "no Server Function through /login");
  assert.deepEqual(decide({ ...action, pathname: LOGIN_PAGE }, { ...none, basicConfigured: true }, NOW), { kind: "unauthorised" });

  // ── Names and origins ──
  assert.equal(slUsername("Owner@Example.com", { BASIC_AUTH_USER: " patvolny " }), "patvolny");
  assert.equal(slUsername("Owner@Example.com", {}), "owner@example.com");
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(publicOrigin(h({ "x-forwarded-host": "trading-card-management.vercel.app", "x-forwarded-proto": "https" }), "http://0.0.0.0:3000"), "https://trading-card-management.vercel.app");
  assert.equal(publicOrigin(h({ host: "localhost:3000" }), "http://0.0.0.0:3000"), "http://localhost:3000");
  assert.equal(publicOrigin(h({}), "http://0.0.0.0:3000"), "http://0.0.0.0:3000");

  // ── The callback refuses before talking to Google ──
  const noGoogle = {} as Configuration;
  const cb = (q: string) => new URL(`https://trading-card-management.vercel.app${CALLBACK_PATH}?${q}`);
  assert.deepEqual(await completeSignIn(noGoogle, cb("code=c&state=st"), undefined, ENV, NOW), { ok: false, reason: "state" }, "no flow cookie");
  assert.deepEqual(await completeSignIn(noGoogle, cb("code=c&state=other"), flowToken, ENV, NOW), { ok: false, reason: "state" }, "state mismatch");
  assert.deepEqual(await completeSignIn(noGoogle, cb("error=access_denied&state=st"), flowToken, ENV, NOW), { ok: false, reason: "failed" });
  assert.deepEqual(await completeSignIn(noGoogle, cb("code=c&state=st"), flowToken, { ...ENV, AUTH_SECRET: OTHER }, NOW), { ok: false, reason: "state" }, "a flow signed with another secret");

  console.log("auth: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
