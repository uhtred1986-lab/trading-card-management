"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { arenaFeedback, arenaGames, cardTextNotes, cards as cardsTable } from "@/db/schema";
import { listDecks } from "@/lib/decks/queries";
import { closeNotesNowRead, noteUnreadText, setNoteStatus, unreadClausesOf } from "@/lib/arena/ai/debug";
import { cardDefFrom, deckInputFor } from "@/lib/arena/load";
import { describeAiError } from "@/lib/ai/client";
import { IllegalAction, type Action, type GameState } from "@/lib/arena/engine";
import { abandonGame, applyToGame, clearBeatsForTurn, isVersus, loadGame, seatOf, StaleGame, startGame, type ArenaMode } from "@/lib/arena/games";
import { cancelMatch, joinMatch, matchById, openMatch } from "@/lib/arena/matches";
import { currentUser } from "@/lib/auth";
import { advance } from "@/lib/arena/ai/run";
import { reviewGame } from "@/lib/arena/ai/review";
import { clarifyCard } from "@/lib/arena/ai/clarify";
import { previewRule, removeRule, type RulePreview } from "@/lib/arena/rules";
import { saveScript } from "@/lib/arena/scripts";
import { SKIN_COOKIE, type ArenaSkin } from "@/lib/arena/skin";

/**
 * Which skin paints the board (`docs/arena-skin-spec.md` §3.1).
 *
 * A cookie rather than a column — a per-device preference that needs no
 * migration to try and none to change your mind — and a cookie rather than
 * `localStorage`, so the server sends the right skin and the board never
 * flashes the other one on load.
 */
export async function chooseSkin(gameId: number, skin: ArenaSkin) {
  (await cookies()).set(SKIN_COOKIE, skin, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  // The skin paints the whole app now, so every page is stale.
  revalidatePath("/", "layout");
  revalidatePath(`/arena/${gameId}`);
}

/**
 * Report something that went wrong, from the board.
 *
 * You type one sentence. Everything needed to reproduce it is copied in here
 * rather than asked for: the whole state, every action so far (so the game
 * replays exactly), whose decision it was, what was on offer, and the tail of
 * the log. A bug found while playing is the most valuable kind there is, and
 * it is only worth that if it can be replayed.
 */
export async function reportBug(gameId: number, note: string, cardId?: string | null): Promise<{ error: string | null }> {
  const text = note.trim();
  if (!text) return { error: "say what went wrong, in a few words" };
  const game = await loadGame(db, gameId);
  if (!game) return { error: "no such game" };
  // A report carries the whole state, both hands included. Either player in a
  // 1 v 1 may file one — that is the point — but only those two.
  const user = await currentUser();
  if (isVersus(game.mode) && !seatOf(game, user)) return { error: "this is not your game" };
  await db.insert(arenaFeedback).values({
    kind: "bug",
    gameId,
    note: text,
    reportedBy: user,
    cardId: cardId || null,
    turn: game.state.turn,
    phase: game.state.phase,
    prompt: game.state.prompt.kind,
    state: game.state,
    actions: game.actions,
    log: game.log.slice(-40),
    legal: game.legal.map((l) => l.label),
  });
  revalidatePath("/arena/feedback");
  return { error: null };
}

export async function setFeedbackStatus(id: number, status: "open" | "fixed" | "wontfix") {
  await db
    .update(arenaFeedback)
    .set({ status, resolvedAt: status === "open" ? null : new Date() })
    .where(eq(arenaFeedback.id, id));
  revalidatePath("/arena/feedback");
}

/**
 * What the engine would make of a line of card text, without keeping it.
 *
 * This is the whole point of the rules page: the compiler is the parser for
 * this language, so the honest way to let you set a rule is to let you write
 * the wording and read back what it means.
 */
export async function checkRule(line: string): Promise<RulePreview> {
  return previewRule(line);
}

/** Keep that reading against the card, where the engine will prefer it. */
export async function saveRule(cardId: string, skillIndex: number, side: "front" | "back", line: string): Promise<{ error: string | null }> {
  const p = previewRule(line);
  if (p.unsupported.length) return { error: `still unread: ${p.unsupported.join(" | ")}` };
  if (!p.ops.length) return { error: "that reads as doing nothing — save it only if the skill really does nothing" };
  await saveScript(db, { cardId, skillIndex, side, ops: p.ops, source: "user", explanation: line.trim(), meaning: p.reads });
  // Setting a rule by hand is you telling me the compiler could not read
  // something, which no coverage run can say — so it lands with the rest.
  await db.insert(arenaFeedback).values({ kind: "rule", cardId, skillIndex, note: line.trim(), resolution: p.reads });
  revalidatePath("/arena/rules");
  revalidatePath("/arena/feedback");
  return { error: null };
}

/** Save a program that reads as nothing, for skills the engine should ignore. */
export async function saveEmptyRule(cardId: string, skillIndex: number, side: "front" | "back", line: string): Promise<{ error: string | null }> {
  await saveScript(db, { cardId, skillIndex, side, ops: [], source: "user", explanation: line.trim(), meaning: "deliberately does nothing" });
  revalidatePath("/arena/rules");
  return { error: null };
}

export async function clearRule(cardId: string, skillIndex: number, side: "front" | "back") {
  await removeRule(db, cardId, skillIndex, side);
  revalidatePath("/arena/rules");
}

export async function startGameForm(formData: FormData) {
  const p1 = Number(formData.get("p1"));
  const p2 = Number(formData.get("p2"));
  const mode = String(formData.get("mode") ?? "hotseat") as ArenaMode;
  const debug = formData.get("debug") != null;
  if (!Number.isInteger(p1)) throw new Error("pick a deck");

  // A 1 v 1 cannot be created here: the other player picks their own deck, and
  // they are not at this keyboard. This opens the invitation and waits.
  if (isVersus(mode)) {
    const matchId = await openMatch(db, await currentUser(), p1, debug);
    revalidatePath("/arena");
    redirect(`/arena/match/${matchId}`);
  }

  if (!Number.isInteger(p2)) throw new Error("pick two decks");
  const id = await startGame(db, p1, p2, mode, debug);
  revalidatePath("/arena");
  redirect(`/arena/${id}`);
}

/** Take the empty seat in someone's 1 v 1, with a deck of your own. */
export async function joinMatchForm(formData: FormData) {
  const matchId = Number(formData.get("match"));
  const deckId = Number(formData.get("deck"));
  if (!Number.isInteger(matchId) || !Number.isInteger(deckId)) throw new Error("pick a deck");
  const gameId = await joinMatch(db, matchId, await currentUser(), deckId);
  revalidatePath("/arena");
  redirect(`/arena/${gameId}`);
}

/** Called off before anyone joined. */
export async function cancelMatchAction(matchId: number) {
  await cancelMatch(db, matchId, await currentUser());
  revalidatePath("/arena");
  redirect("/arena");
}

/**
 * Has the other player joined yet?
 *
 * The host's waiting screen asks this every couple of seconds. A server action
 * rather than an endpoint under `/api/v1`: nothing outside this page wants the
 * answer, and the contract is explicit that an endpoint with no consumer rots
 * (`docs/arena-client-contract.md` §5).
 */
export async function matchGameId(matchId: number): Promise<{ gameId: number | null; status: string }> {
  const m = await matchById(db, matchId);
  return { gameId: m?.gameId ?? null, status: m?.status ?? "cancelled" };
}

/**
 * Apply one action, then let the server take every decision that is not
 * yours — Claude's moves, and any referee ruling. The engine decides what is
 * legal, so an action forged in the browser can only ever be refused.
 *
 * The engine judges the *move*; it has never judged the *mover*, because until
 * now one person held both sides. In a 1 v 1 that is the whole question, so the
 * seat is checked here: this action arrives as a whole `Action` object rather
 * than an index into a menu, and without this your brother could play your
 * cards by asking for them.
 */
export async function act(gameId: number, action: Action): Promise<{ error: string | null }> {
  try {
    const refused = await refuse(gameId, true);
    if (refused) return { error: refused };
    // Empty the animation queue first: from here until you act again, what
    // accumulates is one story — your move, then everything the server does
    // in reply. Not in a 1 v 1, where the queue is also the other device's
    // only copy. See `src/lib/arena/beats.ts` and `clearBeatsForTurn`.
    await clearBeatsForTurn(db, gameId);
    await applyToGame(db, gameId, action);
  } catch (err) {
    if (err instanceof IllegalAction) return { error: err.message };
    if (err instanceof StaleGame) return { error: err.message };
    throw err;
  }
  const ran = await advance(db, gameId);
  revalidatePath(`/arena/${gameId}`);
  return { error: ran.error };
}

/**
 * Why this login may not act on this game, or null.
 *
 * Only a 1 v 1 has an answer: every other mode is one person holding both
 * sides, and a game with no seats belongs to whoever is logged in.
 *
 * Four columns rather than `loadGame`, deliberately. `loadGame` compiles every
 * card in the position and loads every stored script, and `applyToGame` is
 * about to do all of that again — a guard has no business paying for it twice.
 */
async function refuse(gameId: number, needTurn: boolean): Promise<string | null> {
  const [row] = await db
    .select({ mode: arenaGames.mode, p1User: arenaGames.p1User, p2User: arenaGames.p2User, state: arenaGames.state })
    .from(arenaGames)
    .where(eq(arenaGames.id, gameId))
    .limit(1);
  if (!row || !isVersus(row.mode)) return null;
  const seat = seatOf(row, await currentUser());
  if (!seat) return "this is not your game";
  if (!needTurn) return null;
  const prompt = (row.state as GameState).prompt;
  if ("player" in prompt && prompt.player && prompt.player !== seat) return "it is not your turn";
  return null;
}

/** Used when a page loads and it is already Claude's turn, or a ruling is pending. */
export async function advanceGame(gameId: number): Promise<{ error: string | null }> {
  // A ruling belongs to neither player, so either seat may ask for one — but
  // only a seat.
  const refused = await refuse(gameId, false);
  if (refused) return { error: refused };
  const ran = await advance(db, gameId);
  revalidatePath(`/arena/${gameId}`);
  return { error: ran.error };
}

export async function requestReview(gameId: number): Promise<{ error: string | null }> {
  const refused = await refuse(gameId, false);
  if (refused) return { error: refused };
  try {
    await reviewGame(db, gameId);
  } catch (err) {
    return { error: describeAiError(err) };
  }
  revalidatePath(`/arena/${gameId}`);
  return { error: null };
}

export async function abandon(gameId: number) {
  // Either seat may give up, and it ends the game for both.
  if (await refuse(gameId, false)) return;
  await abandonGame(db, gameId);
  revalidatePath("/arena");
  redirect("/arena");
}

/**
 * Fill the backlog from every deck you can actually play, and close whatever
 * the compiler has learned to read since it was written down.
 */
export async function sweepBacklog() {
  // Only the decks the arena can play: the compiler this backlog feeds reads
  // the original game's card text, not Fusion World's.
  const all = await listDecks(db, { game: "dbs" });
  const playable = all.filter((d) => d.leader && d.mainCount >= 50);
  const ids = new Set<string>();
  for (const d of playable) {
    const input = await deckInputFor(db, d.id);
    if (input) for (const id of input.cardIds) ids.add(id);
  }
  if (ids.size) {
    const rows = await db.select().from(cardsTable).where(inArray(cardsTable.id, [...ids]));
    for (const row of rows) await noteUnreadText(db, unreadClausesOf(cardDefFrom(row)), false);
  }
  // Adding first, then closing: a clause just written down is unread by
  // definition, so it survives the pass that follows it.
  await closeNotesNowRead(db);
  revalidatePath("/arena/backlog");
}

export async function markNote(noteId: number, status: "open" | "done") {
  await setNoteStatus(db, noteId, status);
  revalidatePath("/arena/backlog");
}

/**
 * You explain a card; Claude saves a program for it and writes the work item
 * for teaching the compiler the wording.
 */
export async function explainCard(noteId: number, explanation: string): Promise<{ error: string | null }> {
  let meaning: string | null = null;
  try {
    const r = await clarifyCard(db, noteId, explanation);
    meaning = r.clarification.meaning;
  } catch (err) {
    return { error: describeAiError(err) };
  }
  // Explaining a card is the same kind of thing as reporting a bug: you saw
  // something the measurements cannot. It goes to the same place.
  const note = await db.query.cardTextNotes.findFirst({ where: eq(cardTextNotes.id, noteId) });
  await db.insert(arenaFeedback).values({
    kind: "card",
    noteId,
    cardId: note?.cardId ?? null,
    skillIndex: note?.skillIndex ?? null,
    note: explanation.trim(),
    resolution: meaning,
  });
  revalidatePath("/arena/backlog");
  revalidatePath("/arena/feedback");
  return { error: null };
}
