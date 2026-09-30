/**
 * verify-db checks for rule readiness (#357): the one query's counts, and the
 * server-side block — `startGame` and `openMatch` refuse a deck with an open
 * rule, `joinMatch` refuses a joiner's. Kept in its own file so verify-db.mts
 * only gains one line.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { deckCardSets, readiness } from "../src/lib/arena/readiness.ts";
import { startGame } from "../src/lib/arena/games.ts";
import { joinMatch, openMatch } from "../src/lib/arena/matches.ts";

export async function verifyReadiness(db: Db): Promise<void> {
  const card = (id: string, name: string, cardType = "BATTLE") => ({ id, setCode: "BT18", name, cardType, rarity: "Common[C]", rarityCode: "C", searchText: `${id} ${name}`.toLowerCase() });
  await db.insert(schema.cards).values([
    card("BT18-900", "Ready Leader", "LEADER"),
    card("BT18-901", "Confirmed Card"),
    card("BT18-902", "Draft Card"),
    card("BT18-903", "Vanilla Card"),
    card("BT18-904", "Open Card"),
    card("BT18-905", "Corrected Card"),
    card("BT18-906", "Locked Leader", "LEADER"),
  ]);
  const rule = (cardId: string, status: string, skillIndex = 0) => ({ cardId, side: "front", skillIndex, printed: "x", kind: "Auto", status, source: "compiler" });
  await db.insert(schema.cardRules).values([
    rule("BT18-900", "confirmed"),
    rule("BT18-901", "confirmed"),
    rule("BT18-901", "confirmed", 1),
    rule("BT18-902", "draft"),
    rule("BT18-902", "confirmed", 1),
    rule("BT18-905", "corrected"),
    rule("BT18-904", "open"),
    rule("BT18-904", "confirmed", 1),
    rule("BT18-906", "confirmed"),
  ]);
  const mk = async (name: string, leader: string, mains: string[]) => {
    const [d] = await db.insert(schema.decks).values({ name, game: "dbs" }).returning({ id: schema.decks.id });
    await db.insert(schema.deckCards).values([
      { deckId: d.id, cardId: leader, zone: "leader", quantity: 1 },
      ...mains.map((cardId, i) => ({ deckId: d.id, cardId, zone: i === mains.length - 1 && mains.length > 3 ? "z" : "main", quantity: 4 })),
    ]);
    return d.id;
  };
  const ok = await mk("Ready Deck", "BT18-900", ["BT18-901", "BT18-902", "BT18-903", "BT18-905"]);
  const locked = await mk("Locked Deck", "BT18-906", ["BT18-901", "BT18-904"]);

  const r = await readiness(db, [ok, locked]);
  assert.deepEqual(
    { ...r.get(ok)!, openCards: [] },
    { deckId: ok, total: 5, open: 0, draft: 1, corrected: 1, confirmed: 2, plain: 1, openCards: [] },
    "worst state per distinct card: a card with a draft and a confirmed row is a draft; no rows is plain",
  );
  assert.equal(r.get(locked)!.open, 1, "the worst of open + confirmed rows is open");
  assert.equal(r.get(locked)!.total, 3, "leader counted");
  assert.deepEqual(r.get(locked)!.openCards, [{ id: "BT18-904", name: "Open Card" }]);
  assert.equal((await readiness(db, [])).size, 0);
  assert.equal((await deckCardSets(db, [ok, locked])).get(locked)!.size, 3);

  // The block, on every path that starts a game.
  await assert.rejects(startGame(db, locked, ok, "hotseat"), /"Locked Deck" has 1 card with no rule yet/, "the first deck is refused, named, with its count");
  await assert.rejects(startGame(db, ok, locked, "hotseat"), /"Locked Deck" has 1 card/, "so is the second");
  assert.ok((await startGame(db, ok, ok, "hotseat")) > 0, "a deck with only drafts plays");
  await assert.rejects(openMatch(db, "alice", locked, true, "legacy"), /"Locked Deck" has 1 card/, "a host's locked deck is refused at the invitation");
  const matchId = await openMatch(db, "alice", ok, true, "legacy");
  await assert.rejects(joinMatch(db, matchId, "bob", locked), /"Locked Deck" has 1 card/, "a joiner's locked deck is refused at join");
  const [m] = await db.select().from(schema.arenaMatches).where(eq(schema.arenaMatches.id, matchId));
  assert.equal(m.status, "open", "a refused join puts the match back");

  // Drafting the open rule lifts the block.
  await db.update(schema.cardRules).set({ status: "draft" }).where(eq(schema.cardRules.cardId, "BT18-904"));
  assert.equal((await readiness(db, [locked])).get(locked)!.open, 0);
  assert.ok((await startGame(db, locked, ok, "hotseat")) > 0, "drafted, the deck plays again");

  await db.delete(schema.arenaGames);
  await db.delete(schema.arenaMatches);
  await db.delete(schema.decks).where(eq(schema.decks.id, ok));
  await db.delete(schema.decks).where(eq(schema.decks.id, locked));
}
