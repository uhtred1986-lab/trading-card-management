/**
 * A 1 v 1 invitation: from "I want to play" until both people have a deck.
 *
 * A game against Claude can be created in one go, because whoever starts it
 * chooses both decks. Two people cannot: each picks their own, and they are not
 * at the keyboard at the same moment. So a match is the waiting room, and the
 * *second* choice is what calls `startGame` — there is never a half-built game,
 * which is what keeps "a game is its seed plus its actions" true.
 *
 * Everything here is guarded by the login rather than by a token in a URL. The
 * app is two brothers behind Basic Auth; a secret link would be a second auth
 * surface for no gain (`docs/arena-client-contract.md` §9).
 */
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaMatches, decks as decksTable } from "@/db/schema";
import { startGame } from "./games";

export interface OpenMatch {
  id: number;
  hostUser: string;
  hostDeckId: number | null;
  hostDeckName: string | null;
  debug: boolean;
  createdAt: Date;
}

/**
 * Open a match and wait for the other player.
 *
 * Refused without a login, and that refusal is the useful one: a 1 v 1 is two
 * people, and with the app running open (no `BASIC_AUTH_*`, no `app_users`)
 * there is nobody to be the second. Hot-seat is what that machine wants.
 */
export async function openMatch(db: Db, hostUser: string | null, hostDeckId: number, debug: boolean): Promise<number> {
  if (!hostUser) throw new Error("a 1 v 1 needs two logins — add one at Settings → Users, or play hot-seat");
  const [row] = await db.insert(arenaMatches).values({ hostUser, hostDeckId, debug }).returning({ id: arenaMatches.id });
  return row.id;
}

/** Every match still waiting for someone, newest first, with the host's deck named. */
export async function listOpenMatches(db: Db): Promise<OpenMatch[]> {
  return db
    .select({
      id: arenaMatches.id,
      hostUser: arenaMatches.hostUser,
      hostDeckId: arenaMatches.hostDeckId,
      hostDeckName: decksTable.name,
      debug: arenaMatches.debug,
      createdAt: arenaMatches.createdAt,
    })
    .from(arenaMatches)
    .leftJoin(decksTable, eq(decksTable.id, arenaMatches.hostDeckId))
    .where(eq(arenaMatches.status, "open"))
    .orderBy(desc(arenaMatches.createdAt))
    .limit(20);
}

/** One match, for the host's waiting screen. */
export async function matchById(db: Db, id: number) {
  const row = await db.query.arenaMatches.findFirst({ where: eq(arenaMatches.id, id) });
  return row ?? null;
}

/**
 * Take the empty seat: choose a deck, and the game begins.
 *
 * The host is `p1` and the joiner `p2` — the coin flip inside `createGame`
 * decides who actually goes first, so the seats carry no advantage.
 *
 * The status guard is written into the `UPDATE` rather than checked before it,
 * so two people tapping Join at the same instant cannot both start a game from
 * one match: exactly one update matches a row, and the other is told the match
 * is taken.
 */
export async function joinMatch(db: Db, id: number, guestUser: string | null, guestDeckId: number): Promise<number> {
  if (!guestUser) throw new Error("a 1 v 1 needs two logins — add one at Settings → Users, or play hot-seat");
  const match = await matchById(db, id);
  if (!match) throw new Error("no such match");
  if (match.status !== "open") throw new Error("that match has already started");
  if (match.hostUser === guestUser) throw new Error("that is your own match — the other player joins it, or play hot-seat");
  if (!match.hostDeckId) throw new Error("the deck this match was opened with is gone");

  // Claim it first. Whoever loses this race never calls `startGame`, so a
  // refused join costs nothing but a message.
  const claimed = await db
    .update(arenaMatches)
    .set({ guestUser, guestDeckId, status: "starting", updatedAt: new Date() })
    .where(and(eq(arenaMatches.id, id), eq(arenaMatches.status, "open")))
    .returning({ id: arenaMatches.id });
  if (!claimed.length) throw new Error("that match has already started");

  try {
    const gameId = await startGame(db, match.hostDeckId, guestDeckId, "versus", match.debug, { p1User: match.hostUser, p2User: guestUser });
    await db.update(arenaMatches).set({ gameId, status: "started", updatedAt: new Date() }).where(eq(arenaMatches.id, id));
    return gameId;
  } catch (err) {
    // `startGame` refuses a deck with no leader or a Fusion World one. Put the
    // match back rather than stranding the host on a waiting screen forever.
    await db.update(arenaMatches).set({ guestUser: null, guestDeckId: null, status: "open", updatedAt: new Date() }).where(eq(arenaMatches.id, id));
    throw err;
  }
}

/** Called off. Only the host may, and only while nobody has joined. */
export async function cancelMatch(db: Db, id: number, user: string | null): Promise<void> {
  await db
    .update(arenaMatches)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(and(eq(arenaMatches.id, id), eq(arenaMatches.status, "open"), eq(arenaMatches.hostUser, user ?? "")));
}
