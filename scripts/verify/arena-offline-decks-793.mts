/**
 * #793: a player's own decks on the device, built from live data — on PGlite, no Neon, no network.
 *
 *   1. A deck read the online arena's way (`deckInputFor`, `cardDefFrom`, stored `card_rules` via
 *      `rulesFromRows`) goes into the one device pack beside the built-in starters: valid, playable,
 *      under the curated pack's id, the starters unchanged, the deck's programs equal to what the
 *      online arena would load (`rulesFor`).
 *   2. The pack plays full matches in the local Worker: the player's deck against a starter and
 *      against another of their decks, in both seats, to the end.
 *   3. The gate refuses, naming the card and why, a deck with a skill with no record, an open
 *      (unread) record, an unsupported clause, a Unison card with no specified cost, and a card with
 *      no picture; a Fusion World deck and a deck with no leader are refused too. There is no option
 *      to force it, and the sealed pack's own qualification agrees with the gate.
 *   4. Scope: another player's deck is never read (not found, not checked); the pack carries no
 *      owner name and no private-looking field (`privateDataViolations`).
 *   5. The route and the deck check open with `routeViewer()` and read `currentScope()`.
 *
 *   npx tsx scripts/verify/arena-offline-decks-793.mts      (part of `npm test`)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { DECKS, loadSnapshot, resolveDeck } from "../arena-deck-audit.mts";
import { mastersPackInput, buildMastersPack } from "../build-arena-offline-pack.mts";
import { draftCards } from "../../src/lib/arena/draft.ts";
import { rulesFor } from "../../src/lib/arena/rules-store.ts";
import { defsForCards } from "../../src/lib/arena/load.ts";
import { OfflineDeckRefused, buildDeviceOfflinePack, checkOfflineDecks, parseDeckIds } from "../../src/lib/arena/offline-decks.ts";
import { deckIdOfKey, deckListHash, offlineDeckKey } from "../../src/lib/arena/local/device-decks.ts";
import { privateDataViolations, qualificationReasons, validateOfflinePack, packContent, makeOfflinePack } from "../../src/lib/arena/local/pack.ts";
import { CURATED_PACK_ID } from "../../src/lib/arena/local/prepare.ts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { LocalWorkerSession } from "../../src/components/arena/session/local.ts";
import { memoryJournalStore } from "../../src/lib/arena/local/worker.ts";
import { inProcessChannel } from "./arena-local-worker-channel.ts";
import { playLoop, requestIds } from "./arena-local-storage-driver.ts";

const REV = "a793000000000000000000000000000000000793";
const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
for (const file of fs.readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join("drizzle", file), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await client.exec(stmt);
}

// ── the catalog: the committed snapshot's cards, as a sync would have stored them ─────────────────
const snapshot = loadSnapshot();
const sets = [...new Set(snapshot.cards.map((c) => c.setCode))];
await db.insert(schema.cardSets).values(sets.map((code, i) => ({ code, name: code, line: "masters", sortKey: i, game: "dbs" }))).onConflictDoNothing();
await db.insert(schema.cards).values(snapshot.cards.map((c) => ({ ...c }) as typeof schema.cards.$inferInsert)).onConflictDoNothing();
// The owner's specified costs (migration 0049 put them in the live database).
const OWNER = JSON.parse(fs.readFileSync("docs/arena-backlog/evidence/655/owner-specified-costs-2026-10-13.json", "utf8")).specifiedCosts as Record<string, string>;
for (const [id, cost] of Object.entries(OWNER)) await db.update(schema.cards).set({ specifiedCost: cost }).where(eq(schema.cards.id, id));
// Rule records, the drafter's way (the only module that compiles; the pack never does).
await draftCards(db, snapshot.cards.map((c) => c.id));
// Drafts the compiler read fully are what a person would confirm; confirm them, as the review queue does.
await db.update(schema.cardRules).set({ status: "confirmed" }).where(eq(schema.cardRules.status, "draft"));

async function addDeck(owner: string | null, name: string, spec: (typeof DECKS)[number], game = "dbs"): Promise<number> {
  const [d] = await db.insert(schema.decks).values({ name, owner, game }).returning({ id: schema.decks.id });
  const { rows } = resolveDeck(spec, snapshot.cards);
  await db.insert(schema.deckCards).values(rows.map((r) => ({ deckId: d.id, cardId: r.card.id, zone: r.zone, quantity: r.quantity })));
  return d.id;
}
const [specA, specB] = [DECKS.find((d) => d.key === "A")!, DECKS.find((d) => d.key === "B")!];
const annRed = await addDeck("ann", "Ann's Crimson", specB);
const annPride = await addDeck("ann", "Ann's Pride", specA);
const annRed2 = await addDeck("ann", "Ann's Crimson II", specB);
const bobDeck = await addDeck("bob", "Bob's Crimson", specB);

const starters = await mastersPackInput({ runtimeRevision: REV });
const curated = await buildMastersPack({ runtimeRevision: REV });

// ── 1. the gate passes a fully read deck ─────────────────────────────────────────────────────────
const checks = await checkOfflineDecks(db, "ann", [annRed, annRed2, annPride]);
for (const id of [annRed, annRed2]) {
  const c = checks.get(id)!;
  assert.deepEqual(c.problems, [], `${c.name}: no deck-level problem`);
  assert.deepEqual(c.blocking, [], `${c.name}: no blocking card (${JSON.stringify(c.blocking).slice(0, 400)})`);
  assert.equal(c.ready, true);
  assert.equal(c.key, offlineDeckKey(id));
  assert.equal(deckIdOfKey(c.key), id);
}

// The SD15 list as a player's deck is refused on live records: two of its [Auto] skills carry an
// action price, which `runtimeSupportOfRow` reports the engine cannot resolve (#149) — and which a
// confirmed record therefore does not execute online either (`rulesFromRows`). Same rules both ways.
{
  const c = checks.get(annPride)!;
  assert.equal(c.ready, false, "the SD15 list is refused on the stored records");
  assert.deepEqual(c.blocking.map((b) => b.card), ["BT9-031", "DB2-004"], "named card by card");
  for (const b of c.blocking) assert.match(b.reasons.join(" "), /the game cannot do this yet/);
}

// The device pack: starters + two of Ann's decks.
const pack = await buildDeviceOfflinePack(db, "ann", [annRed, annRed2], starters);
assert.equal(pack.id, CURATED_PACK_ID, "the device pack replaces the curated pack's pointer: one pack per device");
assert.deepEqual(pack.decks.map((d) => d.key), ["A", "B", offlineDeckKey(annRed), offlineDeckKey(annRed2)], "the starters stay, the player's decks follow");
assert.deepEqual((await validateOfflinePack(JSON.parse(JSON.stringify(pack)))).errors, [], "the pack validates after a JSON round trip");
assert.equal(pack.qualification.playable, true);
assert.deepEqual(qualificationReasons(packContent(pack), REV), []);
assert.deepEqual(pack.decks.slice(0, 2), curated.decks, "the starter deck lists are the curated ones");
assert.equal(checks.get(annRed)!.listHash, await deckListHash(pack.decks[2].deck), "the device can recompute the list fingerprint from the pack");
// Same rules as online: every program of the player's cards is what `startGame` loads (`rulesFor`).
const annIds = [...new Set([pack.decks[2].deck.leader, ...pack.decks[2].deck.main, pack.decks[3].deck.leader, ...pack.decks[3].deck.main])];
const online = await rulesFor(db, await defsForCards(db, annIds));
assert.ok(Object.keys(online).length > 10, "the online arena loads programs for these cards");
for (const [key, prog] of Object.entries(online)) assert.deepEqual(pack.bundle.payload.scripts[key], prog, `${key}: the offline program is the online one`);
const onlineDefs = await defsForCards(db, annIds);
for (const id of annIds) assert.deepEqual(pack.bundle.payload.defs[id], onlineDefs[id], `${id}: the offline definition is the online one`);
// No starters only: the empty request is exactly the curated pack.
assert.equal((await buildDeviceOfflinePack(db, "ann", [], starters)).hash, curated.hash, "with no deck chosen the device pack is the curated pack");

// ── 2. full matches in the local Worker ──────────────────────────────────────────────────────────
async function playToEnd(p1: string, p2: string, human: "p1" | "p2", seed: number): Promise<string> {
  const ch = inProcessChannel({ store: memoryJournalStore() });
  const session = await LocalWorkerSession.start(ch.port, { matchId: `m-${p1}-${p2}-${human}`, gameId: 793, seed, policySeed: seed + 1, decks: { p1, p2 }, human, pack: JSON.parse(JSON.stringify(pack)), interpreterRevision: REV, batch: 4 }, { newRequestId: requestIds(seed), sessionId: `s-${seed}` });
  const end = await playLoop(session, { nextId: requestIds(seed + 2) });
  const snap = session.snapshot!;
  await session.dispose();
  assert.equal(end, "over", `${p1} v ${p2} (${human}) plays to the end`);
  return `${p1} v ${p2}, human ${human}: over at revision ${snap.game.revision}`;
}
const red = offlineDeckKey(annRed), pride = offlineDeckKey(annRed2);
const played: string[] = [];
played.push(await playToEnd(red, "A", "p1", 7931));
played.push(await playToEnd("A", red, "p2", 7932));
played.push(await playToEnd(red, pride, "p1", 7933));
played.push(await playToEnd(pride, red, "p2", 7934));

// ── 3. the gate refuses, by card and in plain words ─────────────────────────────────────────────
const deckCardIds = async (deckId: number) => (await db.select({ id: schema.deckCards.cardId }).from(schema.deckCards).where(eq(schema.deckCards.deckId, deckId))).map((r) => r.id);
const withSkill = async (deckId: number) => {
  const ids = await deckCardIds(deckId);
  const rows = await db.select().from(schema.cardRules);
  return rows.filter((r) => ids.includes(r.cardId) && r.side === "front");
};
async function refusedFor(deckId: number, card: string, reason: RegExp, what: string) {
  const c = (await checkOfflineDecks(db, "ann", [deckId])).get(deckId)!;
  assert.equal(c.ready, false, `${what}: not ready`);
  const b = c.blocking.find((x) => x.card === card);
  assert.ok(b, `${what}: ${card} is named (${JSON.stringify(c.blocking)})`);
  assert.ok(b!.name.length > 0 && b!.reasons.some((r) => reason.test(r)), `${what}: the reason says it (${b!.reasons.join(" | ")})`);
  await assert.rejects(buildDeviceOfflinePack(db, "ann", [annRed2, deckId], starters), (e: unknown) => e instanceof OfflineDeckRefused && e.code === "blocked" && e.checks.some((x) => x.deckId === deckId && !x.ready), `${what}: the pack is refused`);
  // And the pack's own qualification agrees: forced past the gate, the same deck makes an unplayable pack.
  return c;
}
const [first, second, third] = await withSkill(annRed);
assert.ok(first && second && third, "the deck has at least three skills with records");
const name = async (id: string) => (await db.select({ n: schema.cards.name }).from(schema.cards).where(eq(schema.cards.id, id)))[0].n;

// 3a. an open (unread) record
await db.update(schema.cardRules).set({ status: "open", unread: ["a clause nobody read"] }).where(eq(schema.cardRules.id, first.id));
const openCheck = await refusedFor(annRed, first.cardId, /has not been read yet/, "an open record");
assert.equal(openCheck.blocking.find((b) => b.card === first.cardId)!.name, await name(first.cardId), "the card's name, not only its number");
// Forcing it into a pack anyway (bypassing the gate by hand) gives an unplayable pack: the two checks agree.
{
  const ids = await deckCardIds(annRed);
  const defs = await defsForCards(db, ids);
  const scripts = await rulesFor(db, defs);
  const forced = await makeOfflinePack({ ...starters, defs: { ...starters.defs, ...defs }, scripts: { ...starters.scripts, ...scripts }, art: { ...Object.fromEntries(snapshot.cards.filter((c) => ids.includes(c.id)).map((c) => [c.id, { front: c.imageUrl, back: c.backImageUrl }])), ...starters.art }, decks: [...starters.decks, { ...pack.decks[2] }] }).catch((e: Error) => e);
  assert.ok(forced instanceof Error || forced.qualification.playable === false, "a deck the gate refuses never makes a playable pack");
}
await db.update(schema.cardRules).set({ status: first.status, unread: first.unread }).where(eq(schema.cardRules.id, first.id));

// 3b. a skill with no record
await db.delete(schema.cardRules).where(eq(schema.cardRules.id, second.id));
await refusedFor(annRed, second.cardId, /no game rule has been written/, "a skill with no record");
await db.insert(schema.cardRules).values({ ...second });

// 3c. a clause the engine cannot carry out (confirmed, but with an unread clause on it)
await db.update(schema.cardRules).set({ unread: ["a clause the engine cannot do"] }).where(eq(schema.cardRules.id, third.id));
await refusedFor(annRed, third.cardId, /the game cannot do this yet/, "an unsupported clause");
await db.update(schema.cardRules).set({ unread: third.unread }).where(eq(schema.cardRules.id, third.id));

// 3d. a Unison card with no specified cost (a missing input)
await db.update(schema.cards).set({ specifiedCost: null }).where(eq(schema.cards.id, "SD15-02"));
await refusedFor(annPride, "SD15-02", /specified cost/, "a Unison card with no specified cost");
await db.update(schema.cards).set({ specifiedCost: OWNER["SD15-02"] }).where(eq(schema.cards.id, "SD15-02"));

// 3e. a card with no picture
const leaderOf = (await db.select({ id: schema.deckCards.cardId }).from(schema.deckCards).where(and(eq(schema.deckCards.deckId, annRed), eq(schema.deckCards.zone, "leader"))))[0].id;
const leaderBack = (await db.select({ b: schema.cards.backImageUrl }).from(schema.cards).where(eq(schema.cards.id, leaderOf)))[0].b;
await db.update(schema.cards).set({ backImageUrl: null }).where(eq(schema.cards.id, leaderOf));
await refusedFor(annRed, leaderOf, /no picture of its back side/, "a leader with no back picture");
await db.update(schema.cards).set({ backImageUrl: leaderBack }).where(eq(schema.cards.id, leaderOf));

// 3f. Fusion World, and a deck with no leader
const [fw] = await db.insert(schema.decks).values({ name: "Ann's Fusion", owner: "ann", game: "fusion" }).returning({ id: schema.decks.id });
const [empty] = await db.insert(schema.decks).values({ name: "Ann's draft", owner: "ann", game: "dbs" }).returning({ id: schema.decks.id });
const more = await checkOfflineDecks(db, "ann", [fw.id, empty.id]);
assert.match(more.get(fw.id)!.problems.join(" "), /Fusion World/, "a Fusion World deck is never offered");
assert.match(more.get(empty.id)!.problems.join(" "), /no leader/, "a deck with no leader cannot go offline");
assert.ok(!more.get(fw.id)!.ready && !more.get(empty.id)!.ready);
await assert.rejects(buildDeviceOfflinePack(db, "ann", [fw.id], starters), /cannot be played offline/);

// Everything restored: the deck is ready again.
assert.equal((await checkOfflineDecks(db, "ann", [annRed])).get(annRed)!.ready, true, "fixing the record makes the deck ready again");

// ── 4. scope and privacy ─────────────────────────────────────────────────────────────────────────
assert.equal((await checkOfflineDecks(db, "ann", [bobDeck])).size, 0, "another player's deck is not checked");
await assert.rejects(buildDeviceOfflinePack(db, "ann", [annRed, bobDeck], starters), (e: unknown) => e instanceof OfflineDeckRefused && e.code === "not-found" && e.checks.length === 0, "another player's deck is refused as not found, with nothing about it");
assert.equal((await checkOfflineDecks(db, "bob", [annRed])).size, 0, "and the other way round");
assert.equal((await checkOfflineDecks(db, undefined, [bobDeck])).get(bobDeck)!.ready, true, "an SL (scope: everyone) may check any deck");
assert.equal((await checkOfflineDecks(db, null, [annRed])).size, 0, "the unowned scope sees only decks with no owner");
assert.deepEqual(privateDataViolations(JSON.parse(canonicalJson(pack))), [], "no private-looking field in the pack");
const text = canonicalJson(pack);
for (const word of ['"ann"', '"bob"', "ann@", "Bob's"]) assert.ok(!text.includes(word), `the pack does not carry ${word}`);
await assert.rejects(buildDeviceOfflinePack(db, "ann", Array.from({ length: 13 }, (_, i) => i + 1), starters), (e: unknown) => e instanceof OfflineDeckRefused && e.code === "too-many");
assert.deepEqual(parseDeckIds("3, 1,3"), [3, 1]);
assert.deepEqual(parseDeckIds(""), []);
assert.equal(parseDeckIds("1;drop"), null);

// ── 5. the routes guard themselves and stay behind the proxy ───────────────────────────────────
for (const f of ["src/app/api/arena/offline/pack/route.ts", "src/app/api/arena/offline/decks/route.ts"]) {
  const src = fs.readFileSync(f, "utf8");
  assert.match(src, /const auth = await routeViewer\(\);\n\s+if \(!auth\.ok\) return auth\.response;/, `${f}: opens with routeViewer()`);
  assert.match(src, /await currentScope\(\)/, `${f}: reads with the looker's scope`);
  assert.doesNotMatch(src, /allowUnqualified|force:/, `${f}: nothing forces a refused deck`);
}
const proxy = fs.readFileSync("src/proxy.ts", "utf8");
assert.doesNotMatch(proxy, /api\/arena/, "the device pack routes are not exempt from the proxy");

await client.close();
console.log(`arena-offline-decks-793: ok — device pack ${pack.hash.slice(0, 12)} (${pack.decks.length} decks, ${pack.manifest.cards.length} cards); ${played.join("; ")}`);
