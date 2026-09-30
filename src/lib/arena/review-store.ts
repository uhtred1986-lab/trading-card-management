/**
 * The admin's flagged turns (issue #351): what `arena_flags` holds and the four
 * things done with it. Every function takes a `Db`, like `rules-store.ts`, so
 * `npm test` exercises them on PGlite. The admin check is not here — the server
 * actions and the review page make it, before they call any of this.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaFlags, arenaGames } from "@/db/schema";

/** A flag as the drawer and the review screen list it. */
export interface FlagLine {
  id: number;
  gameId: number;
  turn: number;
  beatIndex: number;
  note: string | null;
  flaggedBy: string | null;
  reviewerNote: string | null;
  resolved: boolean;
}

type FlagRow = typeof arenaFlags.$inferSelect;

export function flagLine(r: FlagRow): FlagLine {
  return { id: r.id, gameId: r.gameId, turn: r.turn, beatIndex: r.beatIndex, note: r.note, flaggedBy: r.flaggedBy, reviewerNote: r.reviewerNote, resolved: r.resolvedAt !== null };
}

/** The one-line note, trimmed and kept short; blank is no note. */
export function cleanNote(raw: string | null | undefined, max = 280): string | null {
  const t = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return t || null;
}

/**
 * Flag a turn. One flag per turn of a game: flagging it again changes nothing
 * and says `created: false`, with the flag that is already there.
 */
export async function flagTurn(db: Db, input: { gameId: number; turn: number; beatIndex: number; note?: string | null; flaggedBy: string | null }): Promise<{ created: boolean; flag: FlagLine }> {
  const [row] = await db
    .insert(arenaFlags)
    .values({ gameId: input.gameId, turn: input.turn, beatIndex: input.beatIndex, note: cleanNote(input.note), flaggedBy: input.flaggedBy })
    .onConflictDoNothing({ target: [arenaFlags.gameId, arenaFlags.turn] })
    .returning();
  if (row) return { created: true, flag: flagLine(row) };
  const [existing] = await db
    .select()
    .from(arenaFlags)
    .where(and(eq(arenaFlags.gameId, input.gameId), eq(arenaFlags.turn, input.turn)));
  return { created: false, flag: flagLine(existing) };
}

/** Save the reviewer's note on a flag and, when `resolve` is set, mark it resolved. Null when there is no such flag. */
export async function reviewFlag(db: Db, id: number, input: { reviewerNote: string | null; resolve: boolean }): Promise<FlagLine | null> {
  const [row] = await db
    .update(arenaFlags)
    .set({ reviewerNote: cleanNote(input.reviewerNote, 2000), ...(input.resolve ? { resolvedAt: new Date() } : {}) })
    .where(eq(arenaFlags.id, id))
    .returning();
  return row ? flagLine(row) : null;
}

/** Put a resolved flag back in the open list. */
export async function reopenFlag(db: Db, id: number): Promise<FlagLine | null> {
  const [row] = await db.update(arenaFlags).set({ resolvedAt: null }).where(eq(arenaFlags.id, id)).returning();
  return row ? flagLine(row) : null;
}

/** One game's flags, earliest turn first. */
export async function flagsForGame(db: Db, gameId: number): Promise<FlagLine[]> {
  const rows = await db.select().from(arenaFlags).where(eq(arenaFlags.gameId, gameId)).orderBy(asc(arenaFlags.turn));
  return rows.map(flagLine);
}

export interface FlaggedGame {
  id: number;
  p1Name: string;
  p2Name: string;
  mode: string;
  status: string;
  winner: string | null;
  turn: number;
  p1User: string | null;
  p2User: string | null;
  flags: number;
  open: number;
  latest: Date;
}

/** The games that have flags, the most recently flagged first. Resolved flags count unless `openOnly`. */
export async function gamesWithFlags(db: Db, openOnly = true): Promise<FlaggedGame[]> {
  const rows = await db
    .select({
      id: arenaGames.id,
      p1Name: arenaGames.p1Name,
      p2Name: arenaGames.p2Name,
      mode: arenaGames.mode,
      status: arenaGames.status,
      winner: arenaGames.winner,
      turn: arenaGames.turn,
      p1User: arenaGames.p1User,
      p2User: arenaGames.p2User,
      flags: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${arenaFlags.resolvedAt} is null)::int`,
      latest: sql<Date>`max(${arenaFlags.createdAt})`,
    })
    .from(arenaFlags)
    .innerJoin(arenaGames, eq(arenaGames.id, arenaFlags.gameId))
    .where(openOnly ? isNull(arenaFlags.resolvedAt) : undefined)
    .groupBy(arenaGames.id)
    .orderBy(desc(sql`max(${arenaFlags.createdAt})`), desc(arenaGames.id));
  return rows.map((r) => ({ ...r, latest: new Date(r.latest) }));
}
