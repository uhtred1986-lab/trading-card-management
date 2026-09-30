/**
 * What the game-over panel says about the rules a finished game relied on
 * (#358, `docs/arena-home-spec.md` §2).
 *
 * `firedInGame` (`fired.ts`, #360) replays the game and says which skills
 * resolved; this keeps the ones whose rule is still a draft. The same replay
 * scopes `/arena/rules?game=<id>`, so the count here and the list there agree.
 * (The stored beats are not a substitute: capped, cleared each turn, and they
 * name a card instance rather than a skill index.)
 */
import { and, eq, or } from "drizzle-orm";
import type { Db } from "@/db";
import { cardRules, cards } from "@/db/schema";
import { firedInGame, type FiredSkill } from "./fired";

export interface DraftFired {
  /** Distinct `card_rules` rows in draft that resolved in the game. */
  count: number;
  /** Card names of the first two, first fired first. */
  names: string[];
}

/** The draft rules among `fired`: the ones nobody has checked yet. Open rules cannot be played, confirmed/corrected ones are checked. */
export async function draftAmong(db: Db, fired: FiredSkill[]): Promise<DraftFired> {
  if (!fired.length) return { count: 0, names: [] };
  const rows = await db
    .select({ id: cardRules.id, cardId: cardRules.cardId, skillIndex: cardRules.skillIndex, name: cards.name })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(and(eq(cardRules.status, "draft"), or(...fired.map((f) => and(eq(cardRules.cardId, f.cardId), eq(cardRules.skillIndex, f.skillIndex))))));
  // Keep the order the game fired them in.
  const order = new Map(fired.map((f, i) => [`${f.cardId}\u0000${f.skillIndex}`, i]));
  rows.sort((a, b) => (order.get(`${a.cardId}\u0000${a.skillIndex}`) ?? 0) - (order.get(`${b.cardId}\u0000${b.skillIndex}`) ?? 0));
  const names = [...new Set(rows.map((r) => r.name))].slice(0, 2);
  return { count: rows.length, names };
}

export async function draftFiredInGame(db: Db, gameId: number): Promise<DraftFired> {
  return draftAmong(db, await firedInGame(db, gameId));
}
