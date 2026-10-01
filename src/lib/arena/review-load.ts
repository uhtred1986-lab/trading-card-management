/**
 * What `/arena/review` shows for one game and turn, read from the database
 * (issue #351): the flags, the decisions and — when the decks still load — the
 * replay from `review.ts`. The page has already checked the viewer is an admin.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaGames, cards as cardsTable } from "@/db/schema";
import { decisionsFor } from "./ai/debug";
import type { Action, EngineContext } from "./types";
import { engineOr } from "./engines";
import { deckInputFor, defsForCards } from "./load";
import { flagsForGame, type FlagLine } from "./review-store";
import { replayForReview, type Review } from "./review";
import { rulesFor } from "./rules-store";
import type { CardArt } from "./view";

export interface LoadedReview {
  flags: FlagLine[];
  /** Null when the game cannot be replayed; `why` says so and `decisions` is the fallback. */
  review: Review | null;
  why: string | null;
  /** The turn's recorded decisions, for when there is no board to show. */
  decisions: { seq: number; player: string; promptKind: string; chosenLabel: string | null; how: string; model: string | null }[];
  /** True when a saved move is not on the replayed menu: a deck was edited since the game, so the menus may differ. */
  drifted: boolean;
}

export async function loadReview(db: Db, gameId: number, turn: number | undefined): Promise<LoadedReview> {
  const [flags, rows] = await Promise.all([flagsForGame(db, gameId), decisionsFor(db, gameId)]);
  const asked = turn ?? flags[0]?.turn;
  const decisions = rows.filter((r) => asked === undefined || r.turn === asked).map((r) => ({ seq: r.seq, player: r.player, promptKind: r.promptKind, chosenLabel: r.chosenLabel, how: r.how, model: r.model }));
  const fallback = (why: string): LoadedReview => ({ flags, review: null, why, decisions, drifted: false });

  const row = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, gameId) });
  if (!row) return fallback("This game no longer exists.");
  if (row.snapshot) return fallback("This game was archived from the old engine; it keeps its last board, not its moves, so it cannot be replayed.");
  if (row.p1DeckId == null || row.p2DeckId == null) return fallback("A deck of this game has been deleted, so the game cannot be replayed from its seed.");
  const a = await deckInputFor(db, row.p1DeckId);
  const b = await deckInputFor(db, row.p2DeckId);
  if (!a || !b) return fallback("A deck of this game no longer loads, so the game cannot be replayed from its seed.");

  const ids = [...new Set([...a.cardIds, ...b.cardIds])];
  const defs = await defsForCards(db, ids);
  // The referee is off: a replay asks Claude nothing; every ruling is already an action in the log.
  const ctx: EngineContext = { defs, scripts: await rulesFor(db, defs), referee: false };
  const art = ids.length ? await db.select({ id: cardsTable.id, imageUrl: cardsTable.imageUrl, backImageUrl: cardsTable.backImageUrl }).from(cardsTable).where(inArray(cardsTable.id, ids)) : [];
  const images: Record<string, CardArt> = {};
  for (const r of art) images[r.id] = { front: r.imageUrl, back: r.backImageUrl };

  let review: Review;
  try {
    review = replayForReview({
      engine: engineOr(row.engine),
      ctx,
      options: { seed: row.seed, p1: a.input, p2: b.input },
      actions: (row.actions as Action[]) ?? [],
      decisions: rows,
      images,
      names: { p1: row.p1Name, p2: row.p2Name },
      turn: asked,
    });
  } catch (err) {
    return fallback(`The replay failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const drifted = !!review.drift || review.beats.some((x) => x.chosenIndex === null);
  return { flags, review, why: null, decisions, drifted };
}
