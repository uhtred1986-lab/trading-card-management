/** Offline proof for scripts/lib/immersion-inventory.mts (#852): sanitized fixture rows only, no database. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildInventory, inventoryCsv, type InventoryInput } from "../lib/immersion-inventory.mts";

const fx = JSON.parse(readFileSync(new URL("../fixtures/immersion-inventory-fixture.json", import.meta.url), "utf8"));
const base: InventoryInput = { ...fx, now: new Date("2026-10-18T00:00:00Z"), owner: "owner-a" };
const inv = buildInventory(base);

// Exclusion: the flag excludes; list+name together confirm a training deck; name-only and wording-only stay in, listed for review.
assert.equal(inv.counts.excludedTesting, 1);
assert.equal(inv.counts.excludedTrainingConfirmed, 1);
assert.equal(inv.counts.uncertainForReview, 2);
assert.deepEqual(inv.review.map((r) => r.ordinal), [1, 2]);
assert.ok(inv.review[0].reasons.some((r) => /exact name/.test(r)) && !inv.review[0].reasons.some((r) => /identical/.test(r)));
// Inclusion: built and virtual decks both count; the other game and the other owner never do.
assert.equal(inv.counts.builtDecks, 1);
assert.equal(inv.counts.virtualDecks, 3); // virtual deck 2 plus the two uncertain ones
assert.equal(inv.counts.eligibleDecks, 4);
assert.equal(inv.counts.candidateDecks, 6);

const entry = (character: string, face: string, form?: string) =>
  inv.entries.find((e) => e.character === character && e.face === face && (form === undefined || e.form === form))!;
// Duplicate forms merge across card ids, keeping both ids; the unmapped printing makes it an exception, not "covered".
assert.deepEqual(entry("Rival Beta", "front", "Rival Beta").cardIds, ["T1-002", "T2-003"]);
assert.equal(entry("Rival Beta", "front", "Rival Beta").status, "exception");
assert.equal(inv.counts.duplicateFormMerges, 1);
// Multi-character card appears under each of its characters; a name that differs from the mapping is an exception.
assert.ok(entry("Sage Gamma", "front").multiCharacter && entry("Sage Gamma", "front").cardIds.includes("T1-004"));
assert.equal(entry("Sage Gamma", "front").status, "exception");
assert.equal(inv.counts.multiCharacterCards, 1);
assert.equal(entry("Rival Beta", "front", "Beta & Gamma").status, "exception");
// Both Leader faces; the side deck is ignored; characters with no label are an exception.
assert.equal(entry("Hero Alpha", "front").status, "covered");
assert.equal(entry("Hero Alpha", "back").status, "covered");
assert.equal(entry("Hero Alpha", "front").tranche, 1);
assert.equal(entry("Hero Alpha", "back").tranche, 2);
assert.equal(entry("Hero Alpha", "front").deckCount, 2);
assert.equal(entry("Hero Alpha", "front").copies, 2);
assert.equal(entry("(no character label)", "front").status, "exception");
assert.ok(inv.entries.every((e) => e.form !== "Hero Epsilon" || e.copies === 2), "side-deck and excluded-deck copies not counted");
assert.equal(inv.coverage.cardFaces.covered, 3);
assert.equal(inv.coverage.tranche1CardFaces + inv.coverage.tranche2CardFaces, 3);

// Sanitized: nothing private reaches the output, and the hash ignores the clock.
const out = JSON.stringify(inv) + inventoryCsv(inv);
for (const secret of ["owner-a", "owner-b", "Real built", "Real virtual", "Flagged test", "Planned", "Wording only", "Other game", "Authored public"]) {
  assert.ok(!out.includes(secret), `leaked ${secret}`);
}
assert.equal(buildInventory({ ...base, now: new Date("2030-01-01T00:00:00Z") }).snapshotHash, inv.snapshotHash);
assert.notEqual(buildInventory({ ...base, deckCards: base.deckCards.slice(1) }).snapshotHash, inv.snapshotHash);
assert.match(inventoryCsv(inv), /^character,face,form,card_ids,/);

// Several owners need an explicit scope (and it is never echoed).
assert.throws(() => buildInventory({ ...base, owner: undefined }), /owners/);
// Empty inventory: no decks, then only excluded decks.
for (const input of [{ ...base, decks: [], deckCards: [] }, { ...base, decks: base.decks.filter((d) => d.id === 3) }]) {
  const empty = buildInventory(input);
  assert.equal(empty.counts.eligibleDecks, 0);
  assert.deepEqual(empty.entries, []);
  assert.deepEqual(empty.coverage.cardFaces, { covered: 0, missing: 0, exception: 0 });
  assert.equal(empty.counts.characters, 0);
}
console.log("arena-immersion-inventory: ok");
