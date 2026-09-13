/**
 * The Android app's read-only decks (`src/lib/arena/deck-api.ts`,
 * `docs/arena-client-contract.md` §5.1) — pure shaping, no database.
 *
 * `deckSummary`/`deckDetail` turn a deck's rows plus the arena's own
 * playability check into the payload a client receives; `legality()` here is
 * the real function the web deck page renders from, not a stand-in, so a
 * change to what counts as a flag shows up here too.
 *
 * Part of `npm test`; run from `scripts/verify-arena.ts`, which fixes the order.
 */
import assert from "node:assert/strict";
import { deckDetail, deckSummary, playableReason, type DeckDetail, type DeckSummary } from "../../src/lib/arena/deck-api";
import { legality, type LegalityCard } from "../../src/lib/decks/legality";

const leaderCard = (over: Partial<LegalityCard> = {}): LegalityCard => ({
  cardId: "BT18-001",
  zone: "leader",
  quantity: 1,
  name: "Omega Shenron, the Corrupted",
  cardType: "LEADER",
  colors: ["Red"],
  limitedTo: null,
  isBanned: false,
  ...over,
});

const mainCard = (over: Partial<LegalityCard> = {}): LegalityCard => ({
  cardId: "BT18-020",
  zone: "main",
  quantity: 4,
  name: "Goku",
  cardType: "BATTLE",
  colors: ["Red"],
  limitedTo: null,
  isBanned: false,
  ...over,
});

// ── deckSummary ──────────────────────────────────────────────────────────

{
  const rows = [leaderCard(), mainCard()];
  const summary = deckSummary(
    {
      id: 1,
      name: "Red aggro",
      game: "dbs",
      isBuilt: false,
      leader: { id: "BT18-001", name: "Omega Shenron, the Corrupted", imageUrl: "https://example/leader.png", colors: ["Red"] },
      legality: legality(rows, "dbs"),
    },
    true,
  );
  const expected: DeckSummary = {
    id: 1,
    name: "Red aggro",
    game: "dbs",
    isBuilt: false,
    leader: { id: "BT18-001", name: "Omega Shenron, the Corrupted", imageUrl: "https://example/leader.png", colors: ["Red"] },
    status: "incomplete", // 4 main cards, nowhere near the 50-card minimum
    playable: true,
    playableReason: null,
  };
  assert.deepEqual(summary, expected, "a dbs deck with a leader is playable and carries no reason");
}

{
  // Not hidden, not silent: a Fusion World deck is listed and says why it
  // cannot be played — `playable` still comes from the caller, never guessed.
  const rows = [leaderCard({ cardId: "FB01-001", name: "Fusion Leader" })];
  const summary = deckSummary(
    { id: 2, name: "Fusion starter", game: "fusion", isBuilt: false, leader: null, legality: legality(rows, "fusion") },
    false,
  );
  assert.equal(summary.playable, false);
  assert.match(summary.playableReason ?? "", /Fusion World/, "says which game, not just that it cannot play");
}

{
  // A virtual dbs deck with no leader yet: still listed, still says why.
  const rows = [mainCard()];
  const summary = deckSummary({ id: 3, name: "Idea dump", game: "dbs", isBuilt: false, leader: null, legality: legality(rows, "dbs") }, false);
  assert.equal(summary.playable, false);
  assert.equal(summary.playableReason, "needs a leader before it can be played");
}

// ── playableReason: the branch deckSummary/deckDetail cannot reach today ───
// (deckInputFor's two gates are game and leader; this is the fallback for a
// future gate neither this module nor deckInputFor knows about yet.)
{
  assert.equal(playableReason("dbs", true, true), null);
  assert.equal(playableReason("dbs", false, true), "cannot be loaded into the arena");
}

// ── deckDetail ──────────────────────────────────────────────────────────

{
  const rows: LegalityCard[] = [
    leaderCard(),
    mainCard({ cardId: "BT18-021", name: "Banned Vegeta", isBanned: true }),
    mainCard({ cardId: "BT18-022", name: "Piccolo", quantity: 1 }),
    { cardId: "BT18-099", zone: "z", quantity: 2, name: "Z-Broly", cardType: "Z-BATTLE", colors: ["Red"], limitedTo: null, isBanned: false },
    { cardId: "BT18-050", zone: "side", quantity: 1, name: "Someday", cardType: "BATTLE", colors: ["Blue"], limitedTo: null, isBanned: false },
  ];
  const lg = legality(rows, "dbs");
  assert.ok(lg.flags["main:BT18-021"], "the fixture actually exercises a flagged row");

  const detail = deckDetail(
    {
      id: 4,
      name: "Red aggro",
      game: "dbs",
      isBuilt: true,
      legality: lg,
      cards: rows.map((r) => ({
        cardId: r.cardId,
        name: r.name,
        zone: r.zone as import("../../src/lib/decks/queries").Zone,
        quantity: r.quantity,
        cardType: r.cardType,
        colors: r.colors,
        imageUrl: null,
        energyCost: null,
      })),
    },
    true,
  );

  assert.equal(detail.leader?.id, "BT18-001", "the leader is read off the leader-zone row, not passed in separately");
  assert.deepEqual(detail.counts, { leader: lg.leaderCount, main: lg.mainCount, z: lg.zCount, side: lg.sideCount }, "counts are legality's, never recomputed");
  assert.equal(detail.cards.length, rows.length, "every row survives the shaping");

  const banned = detail.cards.find((c) => c.cardId === "BT18-021");
  assert.deepEqual(banned?.flag, lg.flags["main:BT18-021"], "a flagged row carries the exact flag the web deck page shows");

  const clean = detail.cards.find((c) => c.cardId === "BT18-022");
  assert.equal(clean?.flag, null, "an unflagged row carries no flag rather than an empty object");

  const expectedShape: DeckDetail = {
    id: 4,
    name: "Red aggro",
    game: "dbs",
    isBuilt: true,
    leader: detail.leader,
    status: lg.status,
    counts: detail.counts,
    cards: detail.cards,
    playable: true,
    playableReason: null,
  };
  assert.deepEqual(detail, expectedShape, "no field is dropped or renamed on the way out");
}

{
  // A deck with no leader row at all: `leader` is null, not a crash.
  const rows: LegalityCard[] = [mainCard()];
  const detail = deckDetail(
    {
      id: 5,
      name: "Idea dump",
      game: "dbs",
      isBuilt: false,
      legality: legality(rows, "dbs"),
      cards: rows.map((r) => ({ cardId: r.cardId, name: r.name, zone: r.zone as import("../../src/lib/decks/queries").Zone, quantity: r.quantity, cardType: r.cardType, colors: r.colors, imageUrl: null, energyCost: null })),
    },
    false,
  );
  assert.equal(detail.leader, null);
  assert.equal(detail.playableReason, "needs a leader before it can be played");
}
