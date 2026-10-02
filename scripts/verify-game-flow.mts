/**
 * verify-db checks for the saved-game round trip on the rules engine: what
 * `loadGame`, `applyToGame`, `clearBeats` and `snapshotOfGame` read and write.
 * Kept in its own file so verify-db.mts only gains one line.
 *
 * The performance work on that path (one query for the cards and their art,
 * the rules fetched beside them, `legal` worked out only when read, the beats
 * emptied in the move's own write, a move applied to the game it was decided
 * on) must change nothing a caller can see — this is where that is held.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { applyToGame, clearBeats, clearBeatsForTurn, loadGame, StaleGame, startGame, type LoadedGame } from "../src/lib/arena/games.ts";
import { artForGame, snapshotOfGame } from "../src/lib/arena/session.ts";
import { engineFor } from "../src/lib/arena/engines.ts";
import type { Action } from "../src/lib/arena/types.ts";

export async function verifyGameFlow(db: Db): Promise<void> {
  const card = (id: string, name: string, cardType: string, extra: Partial<typeof schema.cards.$inferInsert> = {}) => ({
    id,
    setCode: "BT18",
    name,
    cardType,
    rarity: "Common[C]",
    rarityCode: "C",
    searchText: `${id} ${name}`.toLowerCase(),
    colors: ["Red"],
    imageUrl: `https://img.example/${id}.png`,
    ...extra,
  });
  await db.insert(schema.cards).values([
    card("BT18-960", "Flow Leader", "LEADER", { power: 10000, backName: "Flow Leader Awakened", backPower: 15000, backImageUrl: "https://img.example/BT18-960-back.png" }),
    card("BT18-961", "Flow Fighter", "BATTLE", { power: 10000, energyCost: "1", comboPower: 5000 }),
    card("BT18-962", "Flow Brawler", "BATTLE", { power: 15000, energyCost: "2", comboPower: 5000 }),
  ]);
  const [deck] = await db.insert(schema.decks).values({ name: "Flow Deck", game: "dbs" }).returning({ id: schema.decks.id });
  await db.insert(schema.deckCards).values([
    { deckId: deck.id, cardId: "BT18-960", zone: "leader", quantity: 1 },
    { deckId: deck.id, cardId: "BT18-961", zone: "main", quantity: 25 },
    { deckId: deck.id, cardId: "BT18-962", zone: "main", quantity: 25 },
  ]);

  const id = await startGame(db, deck.id, deck.id, "hotseat", false, { p1User: null, p2User: null }, "rules");
  const engine = engineFor("rules");

  // ── loadGame: the context, the art beside it, and `legal` on demand ──
  const g0 = (await loadGame(db, id))!;
  assert.ok(g0, "a live game loads");
  assert.deepEqual(Object.keys(g0.ctx.defs).sort(), ["BT18-960", "BT18-961", "BT18-962"], "a definition for every card the state mentions");
  assert.deepEqual(g0.art["BT18-960"], { front: "https://img.example/BT18-960.png", back: "https://img.example/BT18-960-back.png" }, "art comes off the same rows");
  assert.equal(await artForGame(db, g0), g0.art, "artForGame hands back what loadGame read, no second trip");
  const legalNow = engine.legalActions(g0.ctx, g0.state);
  assert.deepEqual(g0.legal, legalNow, "`legal` reads the same as the engine's own menu");
  assert.equal(g0.legal, g0.legal, "and is worked out once, then kept");
  assert.ok(Object.keys(g0).includes("legal"), "it is an ordinary enumerable field to a spread or a JSON encoder");
  assert.deepEqual(JSON.parse(JSON.stringify(g0)).legal, JSON.parse(JSON.stringify(legalNow)));

  // `reuse` takes another load's context as it is.
  const g0b = (await loadGame(db, id, g0))!;
  assert.equal(g0b.ctx, g0.ctx, "a reused context is the same object, so per-definition caches stay warm");
  assert.equal(g0b.art, g0.art);

  // ── applyToGame: the same move, loaded fresh or handed in, writes the same row ──
  const play = (g: LoadedGame): Action => g.legal[0].action;
  const first = play(g0);
  const a = await applyToGame(db, id, first);
  const rowA = await db.query.arenaGames.findFirst({ where: eq(schema.arenaGames.id, id) });
  assert.equal(rowA!.version, g0.version + 1, "one write, one version");
  assert.deepEqual(a.legal, engine.legalActions(a.ctx, a.state), "the returned game's menu is the new board's");
  assert.deepEqual(rowA!.actions, [first]);

  // Handing in a game read before that write is refused, not played on the new board.
  await assert.rejects(applyToGame(db, id, first, undefined, { game: g0 }), StaleGame, "a move decided on a board that has moved on is refused");
  const rowAfterStale = await db.query.arenaGames.findFirst({ where: eq(schema.arenaGames.id, id) });
  assert.equal(rowAfterStale!.version, rowA!.version, "and writes nothing");
  await assert.rejects(applyToGame(db, id + 1000, play(a), undefined, { game: a }), /handed in for game/, "a game is only applied to its own row");

  // A game handed in that is current applies exactly as a fresh read would.
  const fresh = (await loadGame(db, id))!;
  const viaLoaded = await applyToGame(db, id, play(fresh), undefined, { game: fresh });
  const rowB = await db.query.arenaGames.findFirst({ where: eq(schema.arenaGames.id, id) });
  assert.equal(rowB!.version, fresh.version + 1);
  const replayed = engine.apply(fresh.ctx, fresh.state, play(fresh)).state;
  assert.deepEqual(rowB!.state, JSON.parse(JSON.stringify(replayed)), "the stored state is the engine's answer to that move on that board");
  assert.deepEqual(viaLoaded.state, replayed);

  // ── the beats: emptied in the move's own write, counter carried on ──
  const before = (await loadGame(db, id))!;
  const seqBefore = before.beats?.seq ?? 0;
  assert.ok(seqBefore > 0 && (before.beats?.list.length ?? 0) > 0, "two moves have left beats to play");
  const cleared = await applyToGame(db, id, play(before), undefined, { clearBeats: true });
  assert.ok(cleared.beats!.seq >= seqBefore, "the counter never restarts");
  assert.ok(cleared.beats!.list.every((b) => b.n > seqBefore), "only this move's beats are left on the queue");
  const rowC = await db.query.arenaGames.findFirst({ where: eq(schema.arenaGames.id, id) });
  assert.deepEqual(rowC!.beats, JSON.parse(JSON.stringify(cleared.beats)), "and that is what was written");

  // `clearBeats` on its own: one statement, the list emptied and the counter kept.
  await clearBeats(db, id);
  const rowD = await db.query.arenaGames.findFirst({ where: eq(schema.arenaGames.id, id) });
  assert.deepEqual(rowD!.beats, { seq: cleared.beats!.seq, list: [], art: {} });
  await db.update(schema.arenaGames).set({ beats: null }).where(eq(schema.arenaGames.id, id));
  await clearBeatsForTurn(db, id);
  const rowE = await db.query.arenaGames.findFirst({ where: eq(schema.arenaGames.id, id) });
  assert.deepEqual(rowE!.beats, { seq: 0, list: [], art: {} }, "a row with no beats yet starts its counter at 0");

  // In a 1 v 1 the queue is the other device's copy: `clearBeats: true` leaves it.
  await db.update(schema.arenaGames).set({ mode: "versus" }).where(eq(schema.arenaGames.id, id));
  const vs = (await loadGame(db, id))!;
  const vsSeq = vs.beats?.seq ?? 0;
  const vsAfter = await applyToGame(db, id, play(vs), undefined, { clearBeats: true });
  assert.ok(vsAfter.beats!.list.length >= (vs.beats?.list.length ?? 0), "nothing is emptied in a 1 v 1");
  assert.ok(vsAfter.beats!.seq >= vsSeq);

  // ── the snapshot reads the same whichever way the game was reached ──
  const s1 = await snapshotOfGame(db, (await loadGame(db, id))!);
  const s2 = await snapshotOfGame(db, vsAfter);
  assert.deepEqual(s1, s2, "a written game and a re-read one draw the same board");

  await db.delete(schema.arenaGames).where(eq(schema.arenaGames.id, id));
  await db.delete(schema.decks).where(eq(schema.decks.id, deck.id));
  console.log("verify-db: saved-game round trip on the rules engine ok");
}
