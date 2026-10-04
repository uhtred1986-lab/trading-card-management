/**
 * SL accounts, players, join codes, devices and the join rate limit
 * (`src/lib/auth/access.ts`) on an in-memory Postgres (PGlite) with every
 * migration applied — including 0042's copy of `app_users` into `players`.
 * No network, no DATABASE_URL. Run by `npm test`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { eq } from "drizzle-orm";
import {
  createPlayer,
  deletePlayer,
  devicesOf,
  isAddedSl,
  issueJoinCode,
  listSls,
  playersOverview,
  previewJoinCode,
  reassignOwner,
  recordJoinAttempt,
  redeemJoinCode,
  removeSl,
  resolvePlayerDevice,
  revokeDevice,
  slOwner,
  unassignedOwners,
  upsertSl,
} from "../src/lib/auth/access.ts";

const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;

// Apply every migration, but seed an old password login just before 0042 so its copy into `players` is exercised.
const dir = path.resolve("drizzle");
for (const file of fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()) {
  if (file.startsWith("0042_")) {
    await client.exec(`insert into app_users (username, password_hash, owner) values ('anna', 'scrypt$x$y', 'Anna'), ('ben', 'scrypt$x$y', 'Ben')`);
  }
  for (const stmt of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) await client.exec(s);
  }
}

const NOW = new Date("2026-10-04T12:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
const ENV = { SL_EMAILS: "owner@example.com", BASIC_AUTH_USER: "patvolny" };

// ── 0042 copied the password logins ──
const migrated = await db.select().from(schema.players).orderBy(schema.players.name);
assert.deepEqual(
  migrated.map((p) => [p.name, p.owner]),
  [
    ["anna", "Anna"],
    ["ben", "Ben"],
  ],
);

// ── SLs ──
assert.equal(await isAddedSl(db, "sl2@example.com"), false);
assert.equal(await slOwner(db, "owner@example.com", ENV), "patvolny", "an owner with no row is the BASIC_AUTH_USER");
await upsertSl(db, " SL2@Example.com ", "Sam", "owner@example.com");
assert.equal(await isAddedSl(db, "sl2@example.com"), true);
assert.equal(await slOwner(db, "sl2@example.com", ENV), "Sam");
await upsertSl(db, "owner@example.com", "Pat", "owner@example.com");
assert.equal(await slOwner(db, "owner@example.com", ENV), "Pat", "an owner's own row names them");
const sls = await listSls(db, ENV);
assert.deepEqual(
  sls.map((s) => [s.email, s.owner, s.isOwner]),
  [
    ["owner@example.com", "Pat", true],
    ["sl2@example.com", "Sam", false],
  ],
);
await removeSl(db, "sl2@example.com");
assert.equal(await isAddedSl(db, "sl2@example.com"), false);

// ── Codes ──
const carla = await createPlayer(db, "Carla", "Carla", "Pat");
const first = await issueJoinCode(db, carla, NOW, "Pat");
assert.ok(first);
assert.match(first.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
assert.equal(first.expiresAt.getTime() - NOW.getTime(), 24 * 60 * 60 * 1000);
assert.deepEqual(await previewJoinCode(db, first.code.toLowerCase().replace(/^(...)/, "$1 "), NOW), { name: "Carla" }, "typed in lower case with a space");
const second = await issueJoinCode(db, carla, NOW, "Pat");
assert.ok(second);
assert.equal(await previewJoinCode(db, first.code, NOW), null, "a new code replaces the unused one");
assert.equal(await previewJoinCode(db, second.code, later(24 * 60 * 60 * 1000 + 1)), null, "expired");
assert.equal(await issueJoinCode(db, 99999, NOW, "Pat"), null, "no such player");
const stored = await db.select().from(schema.playerJoinCodes);
assert.ok(
  stored.every((r) => r.codeHash !== second.code && r.codeHash.length === 64),
  "only a hash is stored",
);

// ── Redeem: once, and the device is the player's ──
const joined = await redeemJoinCode(db, second.code, "iPhone · Browser", NOW);
assert.ok(joined);
assert.equal(joined.playerId, carla);
assert.equal(joined.name, "Carla");
assert.equal(await redeemJoinCode(db, second.code, "Android · Browser", NOW), null, "single use");
assert.equal(await previewJoinCode(db, second.code, NOW), null);
const claims = { playerId: joined.playerId, deviceId: joined.deviceId, tok: joined.tok };
assert.deepEqual(await resolvePlayerDevice(db, claims, NOW), { role: "player", playerId: carla, deviceId: joined.deviceId, name: "Carla", owner: "Carla" });
assert.equal(await resolvePlayerDevice(db, { ...claims, tok: joined.tok.replace(/.$/, "x") }, NOW), null, "wrong token");
assert.equal(await resolvePlayerDevice(db, { ...claims, playerId: migrated[0].id }, NOW), null, "another player's id");
const [device] = await db.select().from(schema.playerDevices);
assert.notEqual(device.tokenHash, joined.tok, "only the token's hash is stored");

// ── Overview ──
await db.insert(schema.cardSets).values({ code: "BT18", name: "Dawn of the Z-Legends", line: "legacy", sortKey: 18 });
await db.insert(schema.cards).values({ id: "BT18-020", setCode: "BT18", name: "Omega Shenron", cardType: "BATTLE", rarity: "Common[C]", rarityCode: "C", searchText: "x" });
await db.insert(schema.cardPrints).values({ id: "BT18-020", cardId: "BT18-020", suffix: "", label: "Standard", rarity: "C", isBase: true });
await db.insert(schema.ownedCards).values([
  { cardId: "BT18-020", printId: "BT18-020", owner: "Carla" },
  { cardId: "BT18-020", printId: "BT18-020", owner: null },
  { cardId: "BT18-020", printId: "BT18-020", owner: "ghost" },
]);
await db.insert(schema.decks).values({ name: "Old deck", game: "dbs", owner: null });
const overview = await playersOverview(db, NOW);
const carlaRow = overview.find((p) => p.id === carla)!;
assert.equal(carlaRow.lots, 1);
assert.equal(carlaRow.devices.length, 1);
assert.equal(carlaRow.openCodeExpiresAt, null, "the spent code is not open");

// ── Unassigned, and giving them to a player ──
const unassigned = await unassignedOwners(db, ENV);
assert.deepEqual(
  unassigned.map((u) => [u.owner, u.lots, u.decks]),
  [
    [null, 1, 1],
    ["ghost", 1, 0],
  ],
);
assert.deepEqual(await reassignOwner(db, null, "Carla"), { lots: 1, decks: 1 });
assert.deepEqual(
  (await unassignedOwners(db, ENV)).map((u) => u.owner),
  ["ghost"],
);

// ── Disconnect ──
assert.equal(await revokeDevice(db, joined.deviceId, NOW, migrated[0].id), false, "not another player's device");
assert.equal(await revokeDevice(db, joined.deviceId, NOW, carla), true);
assert.equal(await resolvePlayerDevice(db, claims, NOW), null, "a disconnected device is refused");
assert.equal((await devicesOf(db, carla)).length, 0);

// ── Deleting a player signs their devices out ──
const dora = await createPlayer(db, "Dora", "Dora", null);
const doraCode = await issueJoinCode(db, dora, NOW, null);
const doraJoined = await redeemJoinCode(db, doraCode!.code, "Desktop · Browser", NOW);
await deletePlayer(db, dora);
assert.equal(await resolvePlayerDevice(db, { playerId: dora, deviceId: doraJoined!.deviceId, tok: doraJoined!.tok }, NOW), null);

// ── Rate limit: 10 a minute ──
const results: boolean[] = [];
for (let i = 0; i < 11; i++) results.push((await recordJoinAttempt(db, "k1", later(i))).limited);
assert.deepEqual(results, [...Array(10).fill(false), true], "the eleventh in a minute is refused");
assert.equal((await recordJoinAttempt(db, "k2", NOW)).limited, false, "keys are separate");
assert.equal((await recordJoinAttempt(db, "k1", later(61_000))).limited, false, "a minute later it opens again");

// ── Reservations are per owner (4 Oct 2026) ──
{
  const { allocationForCards, buildConflicts } = await import("../src/lib/decks/reservations.ts");
  const { fileDeckAtLocation } = await import("../src/lib/decks/filing.ts");
  await db.insert(schema.cards).values({ id: "BT18-021", setCode: "BT18", name: "Goku", cardType: "BATTLE", rarity: "Common[C]", rarityCode: "C", searchText: "y" });
  await db.insert(schema.cardPrints).values({ id: "BT18-021", cardId: "BT18-021", suffix: "", label: "Standard", rarity: "C", isBase: true });
  // Eve owns one Goku, Finn owns three.
  await db.insert(schema.ownedCards).values([
    { cardId: "BT18-021", printId: "BT18-021", owner: "Eve" },
    { cardId: "BT18-021", printId: "BT18-021", owner: "Finn" },
    { cardId: "BT18-021", printId: "BT18-021", owner: "Finn" },
    { cardId: "BT18-021", printId: "BT18-021", owner: "Finn" },
  ]);
  const [finnDeck] = await db.insert(schema.decks).values({ name: "Finn's", game: "dbs", owner: "Finn", isBuilt: true }).returning({ id: schema.decks.id });
  await db.insert(schema.deckCards).values({ deckId: finnDeck.id, cardId: "BT18-021", zone: "main", quantity: 3 });
  const [eveDeck] = await db.insert(schema.decks).values({ name: "Eve's", game: "dbs", owner: "Eve" }).returning({ id: schema.decks.id });
  await db.insert(schema.deckCards).values({ deckId: eveDeck.id, cardId: "BT18-021", zone: "main", quantity: 1 });

  assert.deepEqual((await allocationForCards(db, ["BT18-021"], "Eve")).get("BT18-021"), { owned: 1, reserved: 0, available: 1 }, "Finn's built deck does not touch Eve's copy");
  assert.deepEqual((await allocationForCards(db, ["BT18-021"], "Finn")).get("BT18-021"), { owned: 3, reserved: 3, available: 0 });
  assert.deepEqual((await allocationForCards(db, ["BT18-021"])).get("BT18-021"), { owned: 4, reserved: 3, available: 1 }, "an SL's whole view adds everyone up");
  assert.deepEqual(await buildConflicts(db, eveDeck.id), [], "Eve can build hers from her own copy, whatever Finn has built");
  const [eveDeck2] = await db.insert(schema.decks).values({ name: "Eve's second", game: "dbs", owner: "Eve" }).returning({ id: schema.decks.id });
  await db.insert(schema.deckCards).values({ deckId: eveDeck2.id, cardId: "BT18-021", zone: "main", quantity: 2 });
  const short = await buildConflicts(db, eveDeck2.id);
  assert.equal(short[0]?.owned, 1, "only Eve's own copies count for Eve's deck");
  assert.equal(short[0]?.short, 1);

  // Filing moves only the deck owner's copies.
  const [box] = await db.insert(schema.storageLocations).values({ name: "Eve's box" }).returning({ id: schema.storageLocations.id });
  await db.update(schema.decks).set({ isBuilt: true, locationId: box.id }).where(eq(schema.decks.id, eveDeck.id));
  const filed = await fileDeckAtLocation(db, eveDeck.id);
  assert.equal(filed.filed, 1);
  const finnsCopies = await db.select().from(schema.ownedCards).where(eq(schema.ownedCards.owner, "Finn"));
  assert.ok(
    finnsCopies.every((c) => c.locationId === null),
    "Finn's copies stay where they were",
  );
}

console.log("verify-access-db: ok");
process.exit(0);
