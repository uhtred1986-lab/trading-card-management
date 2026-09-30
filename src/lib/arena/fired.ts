/**
 * Which skills a saved game actually resolved, in the order they first did —
 * the scope behind `/arena/rules?game=<id>` (issue #360; ah-04 links to it).
 *
 * A game is its seed plus its actions, so the skills are read by replaying the
 * log on the engine that wrote it and collecting the `skill` events, the same
 * replay `arena:diff` does. The decks are read as they are now: a deck edited
 * since the game changes the shuffle, the replay may stop early, and what it
 * found up to there is what is returned.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaGames } from "@/db/schema";
import type { Action, EngineContext } from "./engine";
import { engineFor, engineOr, legacyState } from "./engines";
import { deckInputFor, defsForCards } from "./load";
import { rulesFor } from "./rules-store";

export interface FiredSkill {
  cardId: string;
  skillIndex: number;
}

/** Distinct skills, first fired first. Empty for a game that is gone or whose decks no longer load. */
export async function firedInGame(db: Db, gameId: number): Promise<FiredSkill[]> {
  const row = await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, gameId) });
  if (!row || row.snapshot || row.p1DeckId == null || row.p2DeckId == null) return [];
  const a = await deckInputFor(db, row.p1DeckId);
  const b = await deckInputFor(db, row.p2DeckId);
  if (!a || !b) return [];
  const engine = engineFor(engineOr(row.engine));
  const defs = await defsForCards(db, [...new Set([...a.cardIds, ...b.cardIds])]);
  // The referee is off: a replay must not ask Claude anything; every ruling is in the log.
  const ctx: EngineContext = { defs, scripts: await rulesFor(db, defs), referee: false };

  const seen = new Set<string>();
  const out: FiredSkill[] = [];
  const collect = (events: { type: string; card?: string; skill?: number }[], cards: Record<string, { cardId: string }>) => {
    for (const ev of events) {
      if (ev.type !== "skill" || ev.card === undefined || ev.skill === undefined) continue;
      const cardId = cards[ev.card]?.cardId;
      if (!cardId || cardId.startsWith("TOKEN:")) continue;
      const key = `${cardId}\u0000${ev.skill}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ cardId, skillIndex: ev.skill });
    }
  };

  try {
    const made = engine.createGame(ctx, { seed: row.seed, p1: a.input, p2: b.input });
    let state = made.state;
    collect(made.events, legacyState(state).cards);
    for (const action of (row.actions as Action[]) ?? []) {
      const step = engine.apply(ctx, state, action);
      state = step.state;
      collect(step.events, legacyState(state).cards);
    }
  } catch {
    // A deck edited since makes the replay diverge; keep what it reached.
  }
  return out;
}
