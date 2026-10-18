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
import { currentPrinted } from "../../src/lib/rules-review/deck-review.ts";
import { faqKey, parseCardFaq } from "../../src/lib/rules-review/faq.ts";
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
const deps = { db, env: { GITHUB_ISSUES_TOKEN: "ghp_secret_token" } as Record<string, string | undefined>, scopes: BOTH, email: "owner@example.com" as string | undefined, fetch: fakeFetch };

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
const READ_TOOLS = ["list_open_families", "list_open_rules", "get_card", "list_assumptions", "deck_review_queue", "get_card_review"];
assert.deepEqual(await names(), [...READ_TOOLS, "confirm_rule", "flag_rule", "record_ruling", "comment_ruling"]);
assert.deepEqual(await names({ ...deps, scopes: READ }), READ_TOOLS, "rules-read lists no writing tool");
assert.equal((await tool("confirm_rule", { cardId: "BT1-001", skillIndex: 1, side: "front", confirmation: "ok" }, { ...deps, scopes: READ })).isError, true, "rules-read cannot confirm");
assert.equal((await tool("flag_rule", { cardId: "BT1-001", skillIndex: 1, side: "front", reason: "x" }, { ...deps, scopes: READ })).isError, true, "rules-read cannot flag");
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
assert.equal(rows.length, 3, "the record/comment tools never write card_rules");

// ── Deck review: queue, packets, confirm, flag ──
const GOOD = "[Auto] When you play this card, draw 1 card.";
await db.insert(schema.cards).values([
  { id: "BT1-002", setCode: "BT1", game: "dbs", name: "Vegeta", cardType: "BATTLE", colors: ["Red"], rarity: "C", rarityCode: "C", searchText: "vegeta", skill: GOOD },
  { id: "BT1-003", setCode: "BT1", game: "dbs", name: "Krillin", cardType: "BATTLE", colors: ["Red"], rarity: "C", rarityCode: "C", searchText: "krillin", skill: GOOD },
  { id: "BT1-004", setCode: "BT1", game: "dbs", name: "Piccolo", cardType: "BATTLE", colors: ["Red"], rarity: "C", rarityCode: "C", searchText: "piccolo", skill: GOOD },
  { id: "BT1-005", setCode: "BT1", game: "dbs", name: "Gohan", cardType: "BATTLE", colors: ["Red"], rarity: "C", rarityCode: "C", searchText: "gohan", skill: GOOD },
  { id: "BT1-006", setCode: "BT1", game: "dbs", name: "Not in a deck", cardType: "BATTLE", colors: ["Red"], rarity: "C", rarityCode: "C", searchText: "x", skill: GOOD },
] as never);
const printedNow = currentPrinted({ skill: GOOD, backSkill: null }, "front", 0);
assert.ok(printedNow, "the fixture skill parses");
const mk = (cardId: string, over: Record<string, unknown> = {}) => ({
  cardId, side: "front", skillIndex: 0, printed: printedNow, kind: "Auto", ops: [], status: "draft", source: "compiler", unread: [], reads: "draw 1 card", ...over,
});
await db.insert(schema.cardRules).values([
  mk("BT1-002"), // fully read draft: confirmable
  mk("BT1-003", { unread: ["do something odd"] }), // unread clause
  mk("BT1-004", { printed: "[Auto] An older wording." }), // stale printed text
  mk("BT1-005", { status: "confirmed", confirmedAt: new Date("2026-10-01") }), // already done: leaves the queue
  mk("BT1-006"),
] as never);
const slOwner = "owner@example.com";
const [mine, other, testing, fusion, shared] = await db
  .insert(schema.decks)
  .values([
    { name: "Mine", game: "dbs", owner: slOwner },
    { name: "Someone else's", game: "dbs", owner: "player-x" },
    { name: "Testing", game: "dbs", owner: slOwner, isTesting: true },
    { name: "Fusion", game: "fusion", owner: slOwner },
    { name: "Unowned", game: "dbs", owner: null },
  ] as never)
  .returning({ id: schema.decks.id });
const inDeck = (deckId: number, cardId: string) => ({ deckId, cardId, zone: "main", quantity: 2 });
await db.insert(schema.deckCards).values([
  inDeck(mine.id, "BT1-002"), inDeck(shared.id, "BT1-002"), inDeck(other.id, "BT1-002"),
  inDeck(mine.id, "BT1-003"), inDeck(mine.id, "BT1-004"), inDeck(mine.id, "BT1-005"), inDeck(mine.id, "BT1-001"),
  inDeck(testing.id, "BT1-006"), inDeck(fusion.id, "BT1-006"), inDeck(other.id, "BT1-006"),
] as never);

assert.equal((await tool("deck_review_queue", {}, { ...deps, email: undefined })).isError, true, "no SL address, no queue");
const q = (await tool("deck_review_queue", { limit: 10 })).out;
assert.equal(q.decks, 2, "own + unowned dbs decks; not testing, fusion or someone else's");
assert.deepEqual(q.cards.map((c: any) => c.cardId), ["BT1-002", "BT1-001", "BT1-003", "BT1-004"], "by deck appearances desc, then id; confirmed and out-of-deck cards absent");
assert.equal(q.cards[0].decks.count, 2, "the other owner's deck does not count");
assert.deepEqual(q.cards[0].decks.names, ["Mine", "Unowned"]);
assert.equal(q.cards[0].skills[0].canConfirm, true);
assert.equal(q.cards[2].skills[0].canConfirm, false);
assert.match(q.cards[2].skills[0].cannotConfirmBecause, /unread/);
assert.match(q.cards[3].skills[0].cannotConfirmBecause, /no longer matches/);
assert.equal(q.skillsConfirmed, 1);
const pg = (await tool("deck_review_queue", { limit: 2 })).out;
assert.equal(pg.cards.length, 2);
assert.equal(pg.nextOffset, 2);
assert.equal((await tool("deck_review_queue", { limit: 2, offset: 2 })).out.nextOffset, null);

// get_card_review: packet + the open rule-assumption issues that mention it
const issuesFetch = (async (url: string) =>
  url.includes("/issues?labels=")
    ? new Response(JSON.stringify([
        { number: 9, title: "Ruling: BT1-002 — draw", body: "", html_url: "u9" },
        { number: 10, title: "Ruling: BT1-0021 — other", body: "", html_url: "u10" },
        { number: 11, title: "pr", body: "BT1-002", html_url: "u11", pull_request: {} },
      ]))
    : new Response("{}")) as unknown as typeof fetch;
const pk = (await tool("get_card_review", { cardId: "bt1-002" }, { ...deps, fetch: issuesFetch })).out;
assert.equal(pk.name, "Vegeta");
assert.deepEqual(pk.openRuleAssumptionIssues.map((i: any) => i.number), [9]);
assert.equal(pk.skills[0].reading, "draw 1 card");
assert.equal((await tool("get_card_review", { cardId: "NOPE-1" })).isError, true);
const nogh = (await tool("get_card_review", { cardId: "BT1-002" }, { ...deps, env: {} })).out;
assert.match(nogh.openRuleAssumptionIssues, /not configured/);

// FAQ: parsed at pack time, keyed by padded id, shown in the packet
const faqHtml = '<h5 class="points baseTxt box-in">SD2-01\u3000Son Goku</h5><dl class="faqCol"><dt><i>Q1.</i><span class="textCol">Q one?</span></dt><dd><i>A1.</i><span class="textCol">Yes.<br>Really &amp; truly.</span></dd></dl>';
const parsedFaq = parseCardFaq(faqHtml);
assert.deepEqual(parsedFaq["SD2-001"], [{ name: "Son Goku", qa: [{ q: "Q one?", a: "Yes.\nReally & truly." }] }]);
assert.equal(faqKey("BT18-020_SPR"), "BT18-020");
const faqPacket = (await tool("get_card_review", { cardId: "BT1-001" })).out;
assert.ok(Array.isArray(faqPacket.faq), "FAQ is an array (BT1-001 has official Q/As)");
assert.ok(faqPacket.faq.length > 0 && faqPacket.faq[0].qa.length > 0);

// confirm_rule: allowed case, then every refusal
const conf = (cardId: string, over: Record<string, unknown> = {}) =>
  tool("confirm_rule", { cardId, skillIndex: 0, side: "front", confirmation: "Ja, passt so.", ...over });
const before = (await db.select().from(schema.cardRules)).find((r) => r.cardId === "BT1-002")!;
await db.update(schema.cardRules).set({ reviewFlag: "looked odd" }).where((await import("drizzle-orm")).eq(schema.cardRules.id, before.id));
assert.equal((await conf("BT1-002", { confirmation: "  " })).isError, true, "the owner's words are required");
assert.equal((await conf("BT1-002", { side: "left" })).isError, true);
const ok = await conf("BT1-002");
assert.equal(ok.isError, false, ok.text);
assert.equal(ok.out.confirmed, true);
assert.equal(ok.out.reading, "draw 1 card", "the stored reading is returned");
const after = (await db.select().from(schema.cardRules)).find((r) => r.id === before.id)!;
assert.equal(after.status, "confirmed");
assert.equal(after.confirmedBy, "owner@example.com");
assert.equal(after.confirmNote, "Ja, passt so.");
assert.ok(after.confirmedAt);
assert.equal(after.reviewFlag, null, "confirming clears the flag");
assert.deepEqual([after.ops, after.reads, after.printed, after.version, after.source], [before.ops, before.reads, before.printed, before.version, before.source], "the program is untouched");
const again = await conf("BT1-002");
assert.equal(again.isError, true, "a confirmed rule is never re-confirmed or rewritten");
assert.match(again.text, /already confirmed/);
const unreadTry = await conf("BT1-003");
assert.match(unreadTry.text, /unread clause/);
assert.match((await conf("BT1-004")).text, /no longer matches/);
assert.match((await conf("BT1-001", { skillIndex: 0 })).text, /unread clause/, "an open unread row");
assert.match((await conf("BT1-001", { skillIndex: 1 })).text, /reads as nothing/, "an open row that reads as nothing");
assert.match((await conf("BT1-001", { skillIndex: 9 })).text, /no stored/);
await db.insert(schema.cardRules).values(mk("BT1-006", { skillIndex: 1, source: "claude" }) as never);
assert.match((await conf("BT1-006", { skillIndex: 1 })).text, /source is claude/);
assert.equal((await tool("confirm_rule", { cardId: "BT1-006", skillIndex: 0, side: "front", confirmation: "x" }, { ...deps, email: undefined })).isError, true);
assert.equal((await db.select().from(schema.cardRules)).filter((r) => r.status === "confirmed").length, 2, "only the one allowed row (plus the seeded one) is confirmed");

// flag_rule: only the flag moves; optional issue
const fl = await tool("flag_rule", { cardId: "BT1-003", skillIndex: 0, side: "front", reason: "reads the wrong target" });
assert.equal(fl.isError, false, fl.text);
const flagged = (await db.select().from(schema.cardRules)).find((r) => r.cardId === "BT1-003")!;
assert.match(flagged.reviewFlag ?? "", /reads the wrong target/);
assert.equal(flagged.status, "draft");
assert.equal((await tool("flag_rule", { cardId: "BT1-003", skillIndex: 0, side: "front", reason: "" })).isError, true);
const callsBefore = calls.length;
const withIssue = await tool("flag_rule", { cardId: "BT1-003", skillIndex: 0, side: "front", reason: "second thought", openIssue: true });
assert.equal(withIssue.out.issue.number, 77);
assert.equal(calls.length, callsBefore + 1);
assert.match(JSON.parse(calls.at(-1)!.init.body as string).title, /^Misread: BT1-003#0/);
const flagged2 = (await db.select().from(schema.cardRules)).find((r) => r.cardId === "BT1-003")!;
assert.match(flagged2.reviewFlag ?? "", /reads the wrong target[\s\S]*second thought/, "flags append");
const noToken = await tool("flag_rule", { cardId: "BT1-003", skillIndex: 0, side: "front", reason: "r", openIssue: true }, { ...deps, env: {} });
assert.equal(noToken.isError, false, "the flag is saved even when the issue cannot be");
assert.match(noToken.out.issueError, /not configured/);

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
