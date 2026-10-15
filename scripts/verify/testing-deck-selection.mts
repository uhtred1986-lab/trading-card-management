/** Testing flags are display metadata: legacy packs, selection and saved input stay compatible. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { decks } from "../../src/db/schema.ts";
import { liveFixture } from "./arena-offline-decks-fixture.mts";
import { buildDeviceOfflinePack, checkOfflineDecks } from "../../src/lib/arena/offline-decks.ts";
import { readDevicePack } from "../../src/lib/arena/local/device-decks.ts";
import { mastersPackInput } from "../build-arena-offline-pack.mts";
import { makeOfflinePack, validateOfflinePack, privateDataViolations } from "../../src/lib/arena/local/pack.ts";
import { deckListHash } from "../../src/lib/arena/local/device-decks.ts";
import { selectableDecks, selectedDeckKeys } from "../../src/lib/arena/local/deck-selection.ts";
import { readPack } from "../../src/components/arena/session/local-board.ts";

const input = await mastersPackInput({ runtimeRevision: "8270000000000000000000000000000000000827" });
const old = await makeOfflinePack(input);
const flagged = await makeOfflinePack({ ...input, decks: input.decks.map((deck, i) => i === 0 ? { ...deck, isTesting: true } : deck) });
assert.deepEqual((await validateOfflinePack(old)).errors, []);
assert.deepEqual((await validateOfflinePack(flagged)).errors, []);
assert.deepEqual(privateDataViolations(flagged), []);
assert.notEqual(old.hash, flagged.hash, "a flag change creates a new pinned pack, not a saved-match mutation");
assert.deepEqual(old.bundle, flagged.bundle, "the testing flag cannot change game/rule inputs");
assert.equal(await deckListHash(old.decks[0].deck), await deckListHash(old.decks[0].deck, false), "normal legacy hashes stay stable");
assert.notEqual(await deckListHash(old.decks[0].deck), await deckListHash(old.decks[0].deck, true), "a flag-only online edit requires an offline Update");
const facts = readPack(flagged);
assert.deepEqual(selectableDecks(facts.decks).map(d => d.key), [facts.decks[1].key]);
assert.equal(selectableDecks(facts.decks, true).length, 2);
assert.equal(selectableDecks(readPack(old).decks).length, 2, "old packs have no hidden testing decks");
assert.deepEqual(selectedDeckKeys(selectableDecks(facts.decks), facts.decks[0].key, facts.decks[0].key), { mine: facts.decks[1].key, theirs: facts.decks[1].key }, "both selected test decks are replaced when hidden");
assert.deepEqual(selectedDeckKeys([], "test", "test"), { mine: "", theirs: "" }, "all-hidden pack cannot retain a submitted selection");
const malformed = structuredClone(flagged) as unknown as { decks: { isTesting?: unknown }[] };
malformed.decks[0].isTesting = "false";
assert.ok(privateDataViolations(malformed).some(e => e.includes("isTesting")));
assert.throws(() => readPack(malformed), /testing flag/);
console.log("testing-deck-selection: legacy packs, metadata isolation, update fingerprints, both-seat filtering and malformed flags pass");

// A flag-only database edit must reach the downloaded pack and its update check.
const fixture = await liveFixture();
try {
  const id = await fixture.addDeck("tester", "Crimson test", fixture.specB);
  const before = (await checkOfflineDecks(fixture.db, "tester", [id])).get(id)!;
  assert.equal(before.isTesting, undefined);
  await fixture.db.update(decks).set({ isTesting: true }).where(eq(decks.id, id));
  const after = (await checkOfflineDecks(fixture.db, "tester", [id])).get(id)!;
  assert.equal(after.isTesting, true);
  assert.notEqual(after.listHash, before.listHash);
  const downloaded = await buildDeviceOfflinePack(fixture.db, "tester", [id], input);
  const entry = downloaded.decks.find(d => d.key === after.key)!;
  assert.equal(entry.isTesting, true);
  const device = await readDevicePack({
    active: async () => ({ hash: downloaded.hash, id: downloaded.id, runtimeRevision: input.runtimeRevision, status: "ready", active: true, pinned: false, artVerified: 0, artRequired: 0, bytes: 0, startedAt: 0, readyAt: 0 }),
    load: async () => downloaded,
  });
  assert.ok(device);
  assert.equal(device.decks.find(d => d.key === after.key)!.isTesting, true);
  assert.equal(device.decks.find(d => d.key === after.key)!.listHash, after.listHash);
  assert.equal((await checkOfflineDecks(fixture.db, "someone-else", [id])).size, 0);
} finally { await fixture.client.close(); }
console.log("testing-deck-selection: persisted flag reaches scoped download and update check");
