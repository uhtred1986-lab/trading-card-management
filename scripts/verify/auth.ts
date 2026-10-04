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
  isAllowedSl,
  isSlOnlyPath,
  JOIN_PAGE,
  JOIN_REDEEM_PATH,
  playerNeedsRefresh,
  signPlayer,
  verifyPlayer,
  PLAYER_TTL_SECONDS,
  isPublicPath,
  isSlEmail,
  missingAuthConfig,
  needsRefresh,
  parseSlEmails,
  publicOrigin,
  signFlow,
  signSession,
  defaultSlOwner,
  verifyFlow,
  verifySession,
  type VerifiedSession,
} from "../../src/lib/auth/core";
import { completeSignIn } from "../../src/lib/auth/google-oauth";
import { CODE_ALPHABET, callerIp, deviceLabel, generateCode, hashCode, hashDeviceToken, isWellFormedCode, joinAttemptKey, joinRateLimited, normaliseCode } from "../../src/lib/auth/join-code";
import { joinUrl } from "../../src/lib/auth/join-url";

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
  assert.equal(defaultSlOwner("Owner@Example.com", { BASIC_AUTH_USER: " patvolny " }), "patvolny");
  assert.equal(defaultSlOwner("Owner@Example.com", {}), "owner@example.com");
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

  // ── Added SLs ──
  const added = async (e: string) => e === "added@example.com";
  assert.equal(await isAllowedSl("Added@Example.com", ENV, added), true);
  assert.equal(await isAllowedSl("added@example.com", ENV), false, "no check, no added SL");
  assert.equal(
    await isAllowedSl("x@example.com", ENV, async () => {
      throw new Error("db down");
    }),
    false,
    "a failing check refuses",
  );
  const addedToken = await signSession("added@example.com", SECRET, NOW);
  assert.ok(await verifySession(addedToken, ENV, NOW, added));
  assert.equal(await verifySession(addedToken, ENV, NOW, async () => false), null, "removing the row signs them out");

  // ── Player cookie ──
  const claims = { playerId: 7, deviceId: 9, tok: "t".repeat(43) };
  const playerToken = await signPlayer(claims, SECRET, NOW);
  const vp = await verifyPlayer(playerToken, SECRET, NOW);
  assert.deepEqual(vp?.claims, claims);
  assert.equal(vp!.expiresAt - vp!.issuedAt, PLAYER_TTL_SECONDS);
  assert.equal(await verifyPlayer(playerToken, OTHER, NOW), null);
  assert.equal(await verifyPlayer(playerToken, SECRET, later(PLAYER_TTL_SECONDS + 1)), null);
  assert.equal(await verifySession(playerToken, ENV, NOW), null, "a player cookie is no SL session");
  assert.equal(await verifyPlayer(token, SECRET, NOW), null, "an SL session is no player cookie");
  assert.equal(await verifyPlayer(flowToken, SECRET, NOW), null);
  assert.equal(await verifyPlayer(await signPlayer({ ...claims, tok: "short" }, SECRET, NOW), SECRET, NOW), null, "a short token");
  assert.equal(playerNeedsRefresh(vp!, NOW), false);
  assert.equal(playerNeedsRefresh(vp!, later(SESSION_REFRESH_AFTER_SECONDS)), true);

  // ── SL-only paths and the player's decision ──
  for (const p of ["/settings", "/settings/access", "/settings/users", "/arena/rules", "/arena/rules/review", "/arena/review", "/arena/feedback", "/arena/12/debug", "/sets/BT18/review"])
    assert.equal(isSlOnlyPath(p), true, p);
  for (const p of ["/", "/collection", "/decks/3", "/arena", "/arena/12", "/arena/match/4", "/sets/BT18", "/settingsx", "/me", "/cart"]) assert.equal(isSlOnlyPath(p), false, p);
  assert.equal(isPublicPath(JOIN_PAGE), true);
  assert.equal(isPublicPath(JOIN_REDEEM_PATH), true);
  const asPlayer = { ...google, player: { refresh: false } };
  assert.deepEqual(decide(page, asPlayer, NOW), { kind: "pass" });
  assert.deepEqual(decide(api, asPlayer, NOW), { kind: "pass" });
  assert.deepEqual(decide(action, asPlayer, NOW), { kind: "pass" }, "player actions are guarded per action");
  assert.deepEqual(decide({ ...page, pathname: "/settings/access" }, asPlayer, NOW), { kind: "home" });
  assert.deepEqual(decide({ ...action, pathname: "/settings/access" }, asPlayer, NOW), { kind: "forbidden" });
  assert.deepEqual(decide({ ...page, pathname: JOIN_PAGE }, asPlayer, NOW), { kind: "home" });
  assert.deepEqual(decide({ ...page, pathname: LOGIN_PAGE }, asPlayer, NOW), { kind: "home" });
  assert.deepEqual(decide(page, { ...google, player: { refresh: true } }, NOW), { kind: "pass-refresh-player" });
  assert.deepEqual(decide(action, { ...google, player: { refresh: true } }, NOW), { kind: "pass" }, "never refreshed on an action");
  assert.deepEqual(decide({ ...action, pathname: JOIN_PAGE }, google, NOW), { kind: "unauthorised" }, "no Server Function through /join");
  assert.deepEqual(decide({ ...page, pathname: JOIN_PAGE }, google, NOW), { kind: "pass" });

  // ── Join codes ──
  assert.equal(CODE_ALPHABET.length, 31);
  for (const ch of "0O1IL") assert.equal(CODE_ALPHABET.includes(ch), false, ch);
  const g = generateCode();
  assert.equal(isWellFormedCode(g), true);
  assert.equal(
    generateCode(() => 0),
    "AAAAAA",
  );
  assert.equal(normaliseCode(" abc-23 4 "), "ABC234");
  assert.equal(isWellFormedCode("ABC23"), false);
  assert.equal(isWellFormedCode("ABC230"), false, "0 is not in the alphabet");
  assert.equal(hashCode("abc 234"), hashCode("ABC234"));
  assert.notEqual(hashCode("ABC234"), hashDeviceToken("ABC234"), "the two hashes are kept apart");
  assert.notEqual(joinAttemptKey("1.2.3.4", SECRET), joinAttemptKey("1.2.3.4", OTHER));
  assert.equal(joinAttemptKey("1.2.3.4", SECRET).includes("1.2.3.4"), false);
  assert.equal(callerIp(h({ "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1, 2.2.2.2" })), "9.9.9.9");
  assert.equal(callerIp(h({ "x-forwarded-for": "1.1.1.1, 2.2.2.2" })), "1.1.1.1");
  assert.equal(callerIp(h({})), "local");
  assert.equal(joinRateLimited(10, 50), false);
  assert.equal(joinRateLimited(11, 11), true);
  assert.equal(joinRateLimited(1, 51), true);
  assert.equal(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", true), "iPhone · App");
  assert.equal(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64)", false), "Desktop · Browser");
  assert.equal(deviceLabel(null, false), "Web · Browser");
  assert.equal(joinUrl("https://trading-card-management.vercel.app/", "ABC234"), "https://trading-card-management.vercel.app/join?c=ABC234");

  console.log("auth: ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
