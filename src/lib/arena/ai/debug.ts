/**
 * The record of how the opponent played: every decision the server took, what
 * it was shown, what it picked and what that cost.
 *
 * It exists to be looked at afterwards — a game is only tunable if you can see
 * why it went the way it did. The card text the compiler could not read used
 * to live here too; it is on `card_rules` now, one row per skill, where the
 * rule it is about is.
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaDecisions } from "@/db/schema";

export interface DecisionRecord {
  gameId: number;
  turn: number;
  phase: string;
  promptKind: string;
  player: string;
  kind: "move" | "referee";
  decidedBy: "rule" | "claude" | "fallback";
  how: string;
  model?: string | null;
  menu?: string[] | null;
  chosenIndex?: number | null;
  chosenLabel?: string | null;
  say?: string | null;
  /** Only kept when the game has debug turned on; it is the bulk of the row. */
  promptText?: string | null;
  spend?: { input: number; output: number; cached: number; micros: number } | null;
  latencyMs?: number | null;
}

export async function recordDecision(db: Db, rec: DecisionRecord): Promise<void> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${arenaDecisions.seq}), 0) + 1` })
    .from(arenaDecisions)
    .where(eq(arenaDecisions.gameId, rec.gameId));
  await db.insert(arenaDecisions).values({
    gameId: rec.gameId,
    seq: next,
    turn: rec.turn,
    phase: rec.phase,
    promptKind: rec.promptKind,
    player: rec.player,
    kind: rec.kind,
    decidedBy: rec.decidedBy,
    how: rec.how,
    model: rec.model ?? null,
    menu: rec.menu ?? null,
    chosenIndex: rec.chosenIndex ?? null,
    chosenLabel: rec.chosenLabel ?? null,
    say: rec.say ?? null,
    promptText: rec.promptText ?? null,
    inputTokens: rec.spend?.input ?? 0,
    outputTokens: rec.spend?.output ?? 0,
    cachedTokens: rec.spend?.cached ?? 0,
    costMicros: rec.spend?.micros ?? 0,
    latencyMs: rec.latencyMs ?? null,
  });
}

// ── the backlog of text the compiler cannot read ───────────────────────────

/**
 * A clause with its numbers and its card, character and trait names blanked,
 * so that "choose up to 2 of your <Son Goku> cards" and "choose up to 1 of
 * your <Vegeta> cards" land on the same row of the backlog. That grouping is
 * the whole point: one rule in the compiler usually clears many cards at once.
 */






export async function decisionsFor(db: Db, gameId: number) {
  return db.select().from(arenaDecisions).where(eq(arenaDecisions.gameId, gameId)).orderBy(arenaDecisions.seq);
}
