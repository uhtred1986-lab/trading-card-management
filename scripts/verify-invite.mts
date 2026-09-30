/**
 * verify-db checks for the 1 v 1 invite page (#369): what `inviteView` lets a
 * guest see (deck name and leader only), and that `joinMatch` with a named
 * owner refuses another login's deck. Own ids, so it cannot collide with the
 * other verify-db sections. The locked-deck refusal is #357's, in
 * verify-readiness.mts.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { inviteView, joinMatch, openMatch } from "../src/lib/arena/matches.ts";

export async function verifyInvite(db: Db): Promise<void> {
  const card = (id: string, name: string, cardType: string) => ({ id, setCode: "BT18", name, cardType, rarity: "Common[C]", rarityCode: "C", searchText: `${id} ${name}`.toLowerCase() });
  await db.insert(schema.cards).values([card("BT18-950", "Invite Leader", "LEADER"), card("BT18-951", "Invite Card", "BATTLE")]);
  const mk = async (name: string, owner: string | null) => {
    const [d] = await db.insert(schema.decks).values({ name, game: "dbs", owner }).returning({ id: schema.decks.id });
    await db.insert(schema.deckCards).values([
      { deckId: d.id, cardId: "BT18-950", zone: "leader", quantity: 1 },
      { deckId: d.id, cardId: "BT18-951", zone: "main", quantity: 4 },
    ]);
    return d.id;
  };
  const hostDeck = await mk("Invite Host Deck", "alice");
  const bobDeck = await mk("Invite Bob Deck", "bob");
  const carolDeck = await mk("Invite Carol Deck", "carol");
  const sharedDeck = await mk("Invite Shared Deck", null);

  const view = await inviteView(db, hostDeck);
  assert.deepEqual(view, { hostDeckName: "Invite Host Deck", leaderName: "Invite Leader", leaderImage: null }, "the guest sees the deck name and leader, nothing else");
  assert.deepEqual(await inviteView(db, null), { hostDeckName: null, leaderName: null, leaderImage: null });

  const matchId = await openMatch(db, "alice", hostDeck, true, "legacy");
  await assert.rejects(joinMatch(db, matchId, "bob", carolDeck, "bob"), /not yours/, "a guest cannot join with another login's deck");
  const [after] = await db.select().from(schema.arenaMatches).where(eq(schema.arenaMatches.id, matchId));
  assert.equal(after.status, "open", "the refused join left the match open");
  await assert.rejects(joinMatch(db, matchId, "alice", bobDeck, "alice"), /your own match/, "the host cannot take the guest seat");
  // An unowned deck passes the owner check; any later refusal would be the game's, not ownership's.
  try {
    await joinMatch(db, matchId, "bob", sharedDeck, "bob");
  } catch (err) {
    assert.doesNotMatch(String(err), /not yours/, "an unowned deck is nobody's secret");
  }
}
