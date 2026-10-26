/**
 * Friend invite (`docs/arena-friend-invite-plan.md`) on an in-memory Postgres
 * (PGlite) with every migration applied, 0054's `decks.shareable` included.
 * No network, no DATABASE_URL. Run by `npm test`.
 *
 * Proves: the join link's `next` only ever names a 1 v 1 page; an invited
 * friend is a normal player who signs in with the one-time code; a taken name
 * is refused (a friend must never inherit someone's cards); and `joinMatch`
 * lets a guest borrow exactly the host's shareable decks and nothing else.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { ownerNameTaken, redeemJoinCode, previewJoinCode, resolvePlayerDevice, upsertSl } from "../src/lib/auth/access.ts";
import { joinUrl, safeNext } from "../src/lib/auth/join-url.ts";
import { inviteFriend, inviteMessage } from "../src/lib/arena/friend-invite.ts";
import { joinMatch, sharedDecksOf } from "../src/lib/arena/matches.ts";

// ── safeNext / joinUrl: no open redirect ──
for (const ok of ["/arena/match/1", "/arena/match/123456789"]) assert.equal(safeNext(ok), ok, ok);
for (const bad of [null, undefined, "", "/", "/arena", "/arena/match/", "/arena/match/x", "/arena/match/1/", "/arena/match/1?x=1", "/arena/match/1234567890", "//evil.example", "https://evil.example/arena/match/1", "/arena/match/1\n/evil", "/settings"]) {
  assert.equal(safeNext(bad as string | null | undefined), null, String(bad));
}
assert.equal(joinUrl("https://x.test/", "ABC234"), "https://x.test/join?c=ABC234");
assert.equal(joinUrl("https://x.test", "ABC234", "/arena/match/7"), "https://x.test/join?c=ABC234&next=%2Farena%2Fmatch%2F7");
assert.equal(joinUrl("https://x.test", "ABC234", "https://evil.example"), "https://x.test/join?c=ABC234", "an unsafe next is dropped, not encoded");

// ── the database, every migration applied ──
const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
const dir = path.resolve("drizzle");
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) await client.exec(s);
  }
}
const NOW = new Date("2026-10-16T12:00:00Z");
const ORIGIN = "https://cards.test";

// 0054's column is there, off by default.
const [probe] = await db.insert(schema.decks).values({ name: "probe", owner: "Pat" }).returning();
assert.equal(probe.shareable, false, "decks.shareable defaults to false");
await db.delete(schema.decks).where(eq(schema.decks.id, probe.id));

// ── ownerNameTaken: players, decks, cards, SLs; any case ──
await db.insert(schema.players).values({ name: "Anna", owner: "Anna" });
await db.insert(schema.decks).values({ name: "d", owner: "Ben" });
await client.exec(`insert into owned_cards (card_id, owner) select id, 'Cleo' from cards limit 1`);
await upsertSl(db, "dora@example.com", "Dora", "owner@example.com");
assert.equal(await ownerNameTaken(db, "anna"), true, "a player's owner, any case");
assert.equal(await ownerNameTaken(db, " ANNA "), true, "trimmed");
assert.equal(await ownerNameTaken(db, "ben"), true, "a deck's owner");
assert.equal(await ownerNameTaken(db, "dora"), true, "an SL's name");
assert.equal(await ownerNameTaken(db, "Zed"), false, "a free name");

// ── inviteFriend: a normal player, a one-time code, a link to the match ──
const invite = await inviteFriend(db, { rawName: "  Maya  ", matchPath: "/arena/match/5", origin: ORIGIN, createdBy: "pat", now: NOW });
assert.ok(invite.ok && invite.mode === "code", "a new friend gets a code");
if (!invite.ok || invite.mode !== "code") throw new Error("unreachable");
assert.equal(invite.name, "Maya");
const url = new URL(invite.url);
assert.equal(url.origin + url.pathname, `${ORIGIN}/join`);
assert.equal(url.searchParams.get("next"), "/arena/match/5");
const code = url.searchParams.get("c")!;
assert.match(code, /^[A-Z0-9]{6}$/);
const [maya] = await db.select().from(schema.players).where(eq(schema.players.name, "Maya"));
assert.deepEqual([maya.owner, maya.createdBy], ["Maya", "pat"], "a normal player under her own name");

assert.equal(await ownerNameTaken(db, "maya"), true, "now taken");
const clash = await inviteFriend(db, { rawName: "Anna", matchPath: "/arena/match/5", origin: ORIGIN, createdBy: "pat", now: NOW });
assert.ok(!clash.ok && /already used/.test(clash.error), "a name another person has is refused");
const blank = await inviteFriend(db, { rawName: "   ", matchPath: "/arena/match/5", origin: ORIGIN, createdBy: "pat", now: NOW });
assert.ok(!blank.ok, "a blank name is refused");

// The preview a link-preview bot makes spends nothing; the confirm spends it once.
assert.deepEqual(await previewJoinCode(db, code, NOW), { name: "Maya" });
assert.deepEqual(await previewJoinCode(db, code, NOW), { name: "Maya" }, "a second look still works");
const joined = await redeemJoinCode(db, code, "iPhone · Browser", NOW);
assert.ok(joined, "the confirm tap signs her in");
assert.equal(await redeemJoinCode(db, code, "iPhone · Browser", NOW), null, "one use");
const device = await resolvePlayerDevice(db, { playerId: joined!.playerId, deviceId: joined!.deviceId, tok: joined!.tok }, NOW);
assert.deepEqual([device?.name, device?.owner], ["Maya", "Maya"], "signed in as herself");

// Inviting her again: she has a live phone, so she only needs the match page.
const again = await inviteFriend(db, { rawName: "maya", matchPath: "/arena/match/6", origin: ORIGIN, createdBy: "pat", now: NOW });
assert.ok(again.ok && again.mode === "existing" && again.url === `${ORIGIN}/arena/match/6`, "a friend already signed in is sent the match link");
// Another host's invitee under that name is a different person: refused, never reused.
const other = await inviteFriend(db, { rawName: "Maya", matchPath: "/arena/match/6", origin: ORIGIN, createdBy: "someone-else", now: NOW });
assert.ok(!other.ok, "another host cannot claim her name");
// Invited but never opened the link: a fresh code replaces the old one.
const lazy = await inviteFriend(db, { rawName: "Lena", matchPath: "/arena/match/6", origin: ORIGIN, createdBy: "pat", now: NOW });
const lazy2 = await inviteFriend(db, { rawName: "Lena", matchPath: "/arena/match/6", origin: ORIGIN, createdBy: "pat", now: NOW });
assert.ok(lazy.ok && lazy2.ok && lazy.mode === "code" && lazy2.mode === "code");
const lazyCode = new URL((lazy as { url: string }).url).searchParams.get("c")!;
const lazyCode2 = new URL((lazy2 as { url: string }).url).searchParams.get("c")!;
assert.notEqual(lazyCode, lazyCode2);
assert.equal(await previewJoinCode(db, lazyCode, NOW), null, "the older code stops working");
assert.deepEqual(await previewJoinCode(db, lazyCode2, NOW), { name: "Lena" });

const text = inviteMessage("Pat", "Maya", invite.url, "code");
assert.ok(text.includes(invite.url) && text.includes("Pat") && text.includes("Maya") && /once/.test(text), "the message names everyone and says it works once");

// ── joinMatch + shareable decks ──
// The ownership guard runs before startGame, so a refusal never needs a startable deck.
const mk = async (name: string, owner: string | null, shareable = false, game = "dbs") =>
  (await db.insert(schema.decks).values({ name, owner, shareable, game }).returning({ id: schema.decks.id }))[0].id;
const hostDeck = await mk("Pat main", "Pat");
const patShared = await mk("Pat lend", "Pat", true);
const patPrivate = await mk("Pat private", "Pat", false);
const benShared = await mk("Ben lend", "Ben", true);
const mayaDeck = await mk("Maya own", "Maya");
const [match] = await db.insert(schema.arenaMatches).values({ hostUser: "Pat", hostDeckId: hostDeck, debug: true, engine: "rules" } as never).returning();

assert.deepEqual((await sharedDecksOf(db, hostDeck)).sort(), [patShared], "only the host's shareable decks");
assert.deepEqual(await sharedDecksOf(db, null), []);
const fusion = await mk("Pat fusion", "Pat", true, "fusion");
assert.ok((await sharedDecksOf(db, hostDeck)).includes(fusion), "a shareable deck of any game the arena plays is offered");

const refused = async (deck: number) => {
  await assert.rejects(() => joinMatch(db, match.id, "Maya", deck, "Maya"), /not yours/);
  const [m] = await db.select().from(schema.arenaMatches).where(eq(schema.arenaMatches.id, match.id));
  assert.equal(m.status, "open", "a refused join leaves the match open");
};
await refused(patPrivate);
await refused(benShared);
await refused(hostDeck);
await refused(99999);
// Accepted by the guard (the empty deck then fails to start, which is not "not yours" and puts the match back).
const reopen = () => db.update(schema.arenaMatches).set({ status: "open", guestUser: null, guestDeckId: null }).where(eq(schema.arenaMatches.id, match.id));
await assert.rejects(() => joinMatch(db, match.id, "Maya", patShared, "Maya"), (e: Error) => !/not yours/.test(e.message), "the host's shareable deck passes the guard");
await reopen();
await assert.rejects(() => joinMatch(db, match.id, "Maya", mayaDeck, "Maya"), (e: Error) => !/not yours/.test(e.message), "her own deck still passes");

console.log("friend invite: next is a 1 v 1 page only, a new friend is a normal player with a one-use code, a taken name is refused, and joinMatch lends exactly the host's shareable decks");

