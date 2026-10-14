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
import { and, eq } from "drizzle-orm";
import * as schema from "../../src/db/schema.ts";
import { mastersPackInput, buildMastersPack } from "../build-arena-offline-pack.mts";
import { liveFixture } from "./arena-offline-decks-fixture.mts";
import { rulesFor } from "../../src/lib/arena/rules-store.ts";
import { defsForCards } from "../../src/lib/arena/load.ts";
import { OfflineDeckRefused, buildDeviceOfflinePack, checkOfflineDecks, parseDeckIds } from "../../src/lib/arena/offline-decks.ts";
import {
  DEVICE_PACK_ID, LOCAL_POINTER_KEY, PLAYER_DECKS_SOURCE, deckBytes, deckIdOfKey, deckListHash, deviceDeckIds, devicePackUrl, installDeviceDecks, matchesUsing,
  offlineDeckKey, packWithout, readDevicePack, takeDeckOff,
} from "../../src/lib/arena/local/device-decks.ts";
import { packStore } from "../../src/lib/arena/local/pack-store.ts";
import { PACK_PATH } from "../../src/lib/arena/local/shell.ts";
import { POINTER_KEY } from "../../src/components/arena/session/local-board.ts";
import { FakeIndexedDb, asFactory } from "./fake-indexeddb.ts";
import { nodeDecode, pngFor } from "./arena-pack-store-fixture.mts";
import { privateDataViolations, qualificationReasons, validateOfflinePack, packContent, makeOfflinePack } from "../../src/lib/arena/local/pack.ts";
import { CURATED_PACK_ID } from "../../src/lib/arena/local/prepare.ts";
import { canonicalJson } from "../../src/lib/arena/replay-core.ts";
import { LocalWorkerSession } from "../../src/components/arena/session/local.ts";
import { memoryJournalStore } from "../../src/lib/arena/local/worker.ts";
import { inProcessChannel } from "./arena-local-worker-channel.ts";
import { playLoop, requestIds } from "./arena-local-storage-driver.ts";

const REV = "a793000000000000000000000000000000000793";
const { client, db, snapshot, owner: OWNER, specA, specB, addDeck } = await liveFixture();

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

// ── 6. the device: one pack, decks added and taken off atomically, removal with no connection ───
{
  const texts = new Map<string, string>([[PACK_PATH, canonicalJson(curated)]]);
  for (const ids of [[annRed], [annRed, annRed2]]) texts.set(devicePackUrl(ids), canonicalJson(await buildDeviceOfflinePack(db, "ann", ids, starters)));
  const calls: string[] = [];
  let offline = false;
  const fetchFn = (async (input: string) => {
    const url = String(input);
    calls.push(url);
    if (offline) throw new TypeError("Failed to fetch (offline)");
    if (texts.has(url)) return new Response(texts.get(url)!, { status: 200, headers: { "content-type": "application/json" } });
    const m = url.match(/^\/_next\/image\?url=([^&]+)/);
    if (m) { const img = pngFor(decodeURIComponent(m[1])); return new Response(new Uint8Array(img), { status: 200, headers: { "content-type": "image/png", "content-length": String(img.length) } }); }
    return new Response("", { status: 404 });
  }) as unknown as typeof fetch;
  const store = packStore({ name: "packs-793", factory: asFactory(new FakeIndexedDb()), localName: "local-793", fetch: fetchFn, decode: nodeDecode, interpreterRevision: REV, retries: 1, retryDelayMs: () => 0, locks: null });

  assert.equal(devicePackUrl([]), PACK_PATH, "no deck of the player's: the public starter pack");
  assert.equal(devicePackUrl([5, 2, 5]), "/api/arena/offline/pack?decks=2,5");
  await installDeviceDecks(store, []);
  let device = (await readDevicePack(store))!;
  assert.deepEqual(device.decks.map((d) => d.key), ["A", "B"], "a prepared device holds the starters");
  assert.deepEqual(deviceDeckIds(device), []);

  const progress: string[] = [];
  await installDeviceDecks(store, [annRed], { onProgress: (p) => progress.push(p.phase) });
  device = (await readDevicePack(store))!;
  assert.deepEqual(device.decks.map((d) => d.key), ["A", "B", red], "a downloaded deck joins the starters");
  assert.ok(progress.includes("pack") && progress.includes("art") && progress.at(-1) === "done", `real progress through the phases (${[...new Set(progress)].join(" → ")})`);
  assert.equal(device.decks[2].listHash, checks.get(annRed)!.listHash, "the device's fingerprint equals the server's: not stale");

  const firstVersion = device.version.hash;
  await installDeviceDecks(store, [annRed, annRed2]);
  device = (await readDevicePack(store))!;
  assert.deepEqual(deviceDeckIds(device), [annRed, annRed2], "a second deck: one pack with both");
  assert.equal((await store.list()).filter((v) => v.status === "ready" && v.id === DEVICE_PACK_ID && v.active).length, 1, "one active version");
  assert.ok(!(await store.list()).some((v) => v.hash === firstVersion), "the superseded version, pinned by no saved match, is pruned");
  const sizes = await deckBytes(store, device);
  assert.ok([...sizes.values()].every((n) => n > 0), "each deck's pictures have a size on the device");

  // Remove one deck with no connection: the device rebuilds its pack and installs it.
  offline = true;
  const before = calls.length;
  await takeDeckOff(store, device, red, { saves: [] });
  assert.deepEqual(calls.slice(before), [], "removing a deck makes no request at all");
  device = (await readDevicePack(store))!;
  assert.deepEqual(device.decks.map((d) => d.key), ["A", "B", pride], "the other decks stay");
  assert.deepEqual((await validateOfflinePack(device.pack)).errors, [], "the rebuilt pack validates");
  assert.equal(device.pack.qualification.playable, true);
  assert.ok(device.pack.source.audit.endsWith(PLAYER_DECKS_SOURCE), "it still names the player's decks as a source");
  await assert.rejects(packWithout(device.pack, "A"), /built-in deck/, "a built-in starter stays");
  const onlyStarters = await packWithout(device.pack, pride);
  assert.deepEqual(onlyStarters.decks.map((d) => d.key), ["A", "B"]);
  assert.equal(onlyStarters.source.audit, curated.source.audit, "with no deck of the player's left, the source is the curated one again");
  assert.deepEqual(Object.keys(onlyStarters.bundle.payload.defs).sort(), Object.keys(curated.bundle.payload.defs).sort(), "and it carries the starters' cards only");
  // A match on the rebuilt pack, from the device's copy.
  const ch = inProcessChannel({ store: memoryJournalStore() });
  const session = await LocalWorkerSession.start(ch.port, { matchId: "after-removal", gameId: 793, seed: 7935, policySeed: 7936, decks: { p1: pride, p2: "B" }, human: "p2", pack: JSON.parse(JSON.stringify(device.pack)), interpreterRevision: REV, batch: 4 }, { newRequestId: requestIds(7935), sessionId: "s-after" });
  assert.equal(await playLoop(session, { nextId: requestIds(7937) }), "over", "the remaining deck still plays to the end after another was removed");
  await session.dispose();
  played.push(`after removal ${pride} v B, human p2: over`);

  // Saved matches: those that play the removed deck go with it, the others stay.
  const saves = [{ matchId: "m1", packHash: "x", moves: 3, over: false, decks: { p1: red, p2: "A" } }, { matchId: "m2", packHash: "x", moves: 3, over: false, decks: { p1: "A", p2: pride } }, { matchId: "m3", packHash: "x", moves: null, over: false, decks: null }];
  assert.deepEqual(matchesUsing(saves, red).map((s) => s.matchId), ["m1"], "only the saved match that plays the deck is taken with it");
  assert.equal(LOCAL_POINTER_KEY, POINTER_KEY, "the pointer key is the board's");
  store.close();
}

await client.close();
console.log(`arena-offline-decks-793: ok — device pack ${pack.hash.slice(0, 12)} (${pack.decks.length} decks, ${pack.manifest.cards.length} cards); ${played.join("; ")}`);
