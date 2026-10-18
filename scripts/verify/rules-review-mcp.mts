/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The claude.ai rules-review connector on PGlite with GitHub mocked, no network: the OAuth server
 * (registration, authorization code + PKCE, token exchange, refresh rotation and replay, SL-only,
 * revocation), the MCP tools and their scopes, and the `/api/mcp` route's locks.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { handleMcpPost } from "../../src/lib/rules-review/mcp.ts";
import { mcpOriginAllowed } from "../../src/lib/oauth/origin.ts";
import { authorizationServerMetadata, parseRegistration, pkceChallengeFor, resourceOf } from "../../src/lib/oauth/core.ts";
import { resolveAuthorizeRequest } from "../../src/lib/oauth/authorize.ts";
import { createAuthorizationCode, exchangeCode, refreshTokens, registerClient, revokeToken, verifyAccessToken } from "../../src/lib/oauth/store.ts";

const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
const dir = path.resolve("drizzle");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}

// ── Data ──
await db.insert(schema.cardSets).values({ code: "BT1", name: "Galactic Battle", game: "dbs", line: "legacy" });
await db.insert(schema.cards).values({ id: "BT1-001", setCode: "BT1", game: "dbs", name: "Son Goku", cardType: "BATTLE", colors: ["Red"], rarity: "C", rarityCode: "C", searchText: "son goku" } as never);
const rule = (skillIndex: number, unread: string[], status = "open") => ({
  cardId: "BT1-001", side: "front", skillIndex, printed: `printed ${skillIndex}`, kind: "Auto", ops: [], status, source: "compiler", unread, reads: "",
});
await db.insert(schema.cardRules).values([rule(0, ["send 3 <Frieza> cards to the Warp"]), rule(1, []), rule(2, ["send 5 <Goku> cards to the Warp"], "draft")] as never);

// ── The OAuth server ──
const ORIGIN = "https://trading-card-management.vercel.app";
const RESOURCE = resourceOf(ORIGIN);
const ENV = { SL_EMAILS: "owner@example.com" };
const NOW = new Date("2026-10-18T10:00:00Z");
const later = (s: number) => new Date(NOW.getTime() + s * 1000);

assert.equal(parseRegistration({ redirect_uris: ["http://evil.example/cb"] }).ok, false, "plain http only on loopback");
assert.equal(parseRegistration({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], token_endpoint_auth_method: "client_secret_post" }).ok, false);
const reg = parseRegistration({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" });
assert.ok(reg.ok);
const registered = await registerClient(db, reg, NOW);
assert.ok(registered.ok);
const clientId = registered.clientId;

const verifier = "a".repeat(64);
const challenge = pkceChallengeFor(verifier);
const authParams = { response_type: "code", client_id: clientId, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: challenge, code_challenge_method: "S256", scope: "rules-read rules-write", state: "st" };

assert.equal((await resolveAuthorizeRequest(db, { ...authParams, redirect_uri: "https://claude.ai/other" }, ORIGIN)).kind, "error", "unregistered redirect: error page, never a redirect");
assert.equal((await resolveAuthorizeRequest(db, { ...authParams, code_challenge_method: "plain" }, ORIGIN)).kind, "redirect-error");
assert.equal((await resolveAuthorizeRequest(db, { ...authParams, scope: "dm-read" }, ORIGIN)).kind, "redirect-error", "unknown scope");
const asked = await resolveAuthorizeRequest(db, authParams, ORIGIN);
assert.equal(asked.kind, "ok");
if (asked.kind !== "ok") throw new Error("unreachable");

const base = { client: asked.client, redirectUri: asked.redirectUri, codeChallenge: asked.codeChallenge, resource: asked.resource };
assert.equal((await createAuthorizationCode(db, { ...base, email: "player@example.com", scopes: ["rules-read"] }, NOW, ENV)).ok, false, "only an SL gets a code");
const code = await createAuthorizationCode(db, { ...base, email: "Owner@Example.com", scopes: ["rules-read"] }, NOW, ENV);
assert.ok(code.ok);

const exch = (c: string, over: Record<string, unknown> = {}, when = later(5)) =>
  exchangeCode(db, { clientId, code: c, redirectUri: asked.redirectUri, codeVerifier: verifier, resource: RESOURCE, ...over }, when, ENV);
const bad = await createAuthorizationCode(db, { ...base, email: "owner@example.com", scopes: ["rules-read"] }, NOW, ENV);
assert.ok(bad.ok);
assert.equal((await exch(bad.code, { codeVerifier: "b".repeat(64) })).ok, false, "wrong PKCE verifier");
assert.equal((await exch(bad.code)).ok, false, "a code is spent even by a failed attempt");
const tokens = await exch(code.code);
assert.ok(tokens.ok);
assert.equal(tokens.tokens.scope, "rules-read");
assert.equal((await exch(code.code)).ok, false, "single use");
assert.equal(await verifyAccessToken(db, tokens.tokens.access_token, RESOURCE, later(10), ENV), null, "replaying the code revoked the first tokens");

const code2 = await createAuthorizationCode(db, { ...base, email: "owner@example.com", scopes: ["rules-read", "rules-write"] }, NOW, ENV);
assert.ok(code2.ok);
const t2 = await exch(code2.code);
assert.ok(t2.ok);
const access = t2.tokens.access_token;
const verified = await verifyAccessToken(db, access, RESOURCE, later(10), ENV);
assert.deepEqual(verified?.scopes, ["rules-read", "rules-write"]);
assert.equal(await verifyAccessToken(db, access, `${ORIGIN}/other`, later(10), ENV), null, "bound to the resource");
assert.equal(await verifyAccessToken(db, access, RESOURCE, later(3700), ENV), null, "expires after an hour");
assert.equal(await verifyAccessToken(db, access, RESOURCE, later(10), { SL_EMAILS: "someone@else.com" }), null, "removing the SL cuts the token off");

const r1 = await refreshTokens(db, { clientId, refreshToken: t2.tokens.refresh_token, scope: "rules-write" }, later(3700), ENV);
assert.ok(r1.ok);
assert.equal(r1.tokens.scope, "rules-write", "a refresh may narrow");
assert.equal((await refreshTokens(db, { clientId, refreshToken: t2.tokens.refresh_token }, later(3800), ENV)).ok, false, "rotation: the old refresh token is spent");
assert.equal(await verifyAccessToken(db, r1.tokens.access_token, RESOURCE, later(3900), ENV), null, "a replay revoked the family");

const code3 = await createAuthorizationCode(db, { ...base, email: "owner@example.com", scopes: ["rules-read"] }, later(4000), ENV);
assert.ok(code3.ok);
const t3 = await exch(code3.code, {}, later(4001));
assert.ok(t3.ok);
assert.ok(await verifyAccessToken(db, t3.tokens.access_token, RESOURCE, later(4002), ENV));
await revokeToken(db, clientId, t3.tokens.access_token, later(4003));
assert.equal(await verifyAccessToken(db, t3.tokens.access_token, RESOURCE, later(4004), ENV), null, "revoked");

assert.equal(authorizationServerMetadata(ORIGIN).code_challenge_methods_supported[0], "S256");
assert.equal(mcpOriginAllowed(null, ORIGIN, {}), true);
assert.equal(mcpOriginAllowed("https://claude.ai", ORIGIN, {}), true);
assert.equal(mcpOriginAllowed("https://evil.example", ORIGIN, {}), false);
assert.equal(mcpOriginAllowed("null", ORIGIN, {}), false);

// ── The MCP tools ──
const calls: { url: string; init: RequestInit }[] = [];
const fakeFetch = (async (url: string, init: RequestInit) => {
  calls.push({ url, init });
  if (init.method === "POST") return new Response(JSON.stringify({ number: 77, html_url: "https://github.com/x/y/issues/77" }), { status: 201 });
  return new Response("{}", { status: 200 });
}) as unknown as typeof fetch;
const READ = ["rules-read"];
const BOTH = ["rules-read", "rules-write"];
const deps = { db, env: { GITHUB_ISSUES_TOKEN: "ghp_secret_token" } as Record<string, string | undefined>, scopes: BOTH, fetch: fakeFetch };

const rpc = async (method: string, params?: unknown, d = deps) => {
  const res = await handleMcpPost(new Request("http://x/api/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", ...(method.startsWith("notifications/") ? {} : { id: 1 }), method, params }) }), d);
  return res.status === 202 ? null : ((await res.json()) as any);
};
const tool = async (name: string, args: unknown, d = deps) => {
  const r = await rpc("tools/call", { name, arguments: args }, d);
  if (r.error) return { isError: true, out: {} as any, text: r.error.message as string };
  const text = r.result.content[0].text as string;
  return { isError: !!r.result.isError, out: text.startsWith("{") ? JSON.parse(text) : {}, text };
};

assert.equal((await rpc("initialize", { protocolVersion: "2025-03-26" })).result.serverInfo.name, "dbs-rules-review");
assert.equal(await rpc("notifications/initialized"), null);
const names = (d = deps) => rpc("tools/list", undefined, d).then((r) => r.result.tools.map((t: { name: string }) => t.name));
assert.deepEqual(await names(), ["list_open_families", "list_open_rules", "get_card", "list_assumptions", "record_ruling", "comment_ruling"]);
assert.deepEqual(await names({ ...deps, scopes: READ }), ["list_open_families", "list_open_rules", "get_card", "list_assumptions"], "rules-read lists no writing tool");
assert.equal((await tool("record_ruling", { cardIds: ["A-1"], title: "t", decision: "d" }, { ...deps, scopes: READ })).isError, true, "and cannot call one");

const fam = (await tool("list_open_families", {})).out;
assert.equal(fam.openSkills, 2);
assert.equal(fam.families, 1);
assert.equal(fam.top[0].count, 2);

const open = (await tool("list_open_rules", { set: "BT1", limit: 1 })).out;
assert.equal(open.total, 2);
assert.equal(open.rules[0].key, "BT1-001#0");
assert.equal((await tool("list_open_rules", { idPrefix: "EX" })).out.total, 0);

const card = (await tool("get_card", { cardId: "bt1-001" })).out;
assert.equal(card.skills.length, 3);
assert.equal(card.skills[0].confirmed, false);
assert.ok((await tool("list_assumptions", {})).out.total > 0);

const rec = await tool("record_ruling", { cardIds: ["BT1-001"], title: "Warp", decision: "Up to 1 per name.\nSecond line." });
assert.equal(rec.out.issueNumber, 77);
const sent = JSON.parse(calls[0].init.body as string);
assert.equal(calls[0].url, "https://api.github.com/repos/uhtred1986-lab/trading-card-management/issues");
assert.deepEqual(sent.labels, ["rule-assumption"]);
assert.match(sent.title, /^Ruling: BT1-001 — Warp$/);
assert.match(sent.body, /> Up to 1 per name\.\n> Second line\./);
assert.ok(!JSON.stringify(rec).includes("ghp_secret_token"));
assert.equal((await tool("record_ruling", { cardIds: [], title: "x", decision: "y" })).isError, true);
assert.equal((await tool("record_ruling", { cardIds: ["A-1"], title: "x", decision: "y" }, { ...deps, env: {} })).isError, true);
const unlabelled = (async (_u: string, init: RequestInit) =>
  init.method === "POST" ? new Response(JSON.stringify({ html_url: "u" }), { status: 201 }) : new Response(JSON.stringify({ labels: [{ name: "bug" }] }))) as unknown as typeof fetch;
assert.equal((await tool("comment_ruling", { issueNumber: 5, text: "hi" }, { ...deps, fetch: unlabelled })).isError, true, "only rule-assumption issues");
const rows = await db.select().from(schema.cardRules);
assert.equal(rows.length, 3, "the MCP never writes card_rules");

// ── The route's locks ──
process.env.SL_EMAILS = "owner@example.com";
const route = await import("../../src/app/api/mcp/route.ts");
const post = (headers: Record<string, string> = {}) => new Request("https://x.test/api/mcp", { method: "POST", headers, body: "{}" });
const noBearer = await route.POST(post());
assert.equal(noBearer.status, 401);
assert.match(noBearer.headers.get("www-authenticate") ?? "", /resource_metadata="https:\/\/x\.test\/\.well-known\/oauth-protected-resource"/);
assert.equal((await route.POST(post({ origin: "https://evil.example" }))).status, 403);
assert.equal(route.GET().status, 405);

console.log("rules-review-mcp: ok");
process.exit(0);
