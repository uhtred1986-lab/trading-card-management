"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { arenaFeedback, arenaGames, cardTextNotes } from "@/db/schema";
import { listDecks } from "@/lib/decks/queries";
import { closeNotesNowRead, noteUnreadText, setNoteStatus, unreadClausesFor } from "@/lib/arena/ai/debug";
import { deckInputFor } from "@/lib/arena/load";
import { describeAiError } from "@/lib/ai/client";
import { IllegalAction, validateProgram, type Action, type GameState } from "@/lib/arena/engine";
import { abandonGame, applyToGame, clearBeatsForTurn, isVersus, loadGame, seatOf, StaleGame, startGame, type ArenaMode } from "@/lib/arena/games";
import { cancelMatch, joinMatch, matchById, openMatch } from "@/lib/arena/matches";
import { currentUser } from "@/lib/auth";
import { advance } from "@/lib/arena/ai/run";
import { reviewGame } from "@/lib/arena/ai/review";
import { clarifyCard, clarifyRule } from "@/lib/arena/ai/clarify";
import { blankRule, confirmRule, ruleById, saveRule, setCompilerDiff, takeCompilerDiff } from "@/lib/arena/rules-store";
import { SKIN_COOKIE, type ArenaSkin } from "@/lib/arena/skin";
import { STAGING_COOKIE, type ArenaStaging } from "@/lib/arena/staging";

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
 * How a battle is staged (`docs/arena-battle-staging-spec.md` §3.6).
 *
 * A cookie for the same reason the skin is one: the staging decides what the
 * middle of the board looks like the moment a battle is open, so it is read
 * on the server and nothing flashes. Only this game's page is stale — a
 * staging paints nothing outside the board.
 */
export async function chooseStaging(gameId: number, staging: ArenaStaging) {
  (await cookies()).set(STAGING_COOKIE, staging, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
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

// ── the Rules Workbench ─────────────────────────────────────────────────────
// Every write here regenerates the row's reading through the store and files
// an `arena_feedback` row of kind `rule`, so `arena:feedback` still lists what
// a person decided about a card.

async function noteRule(id: number, note: string, resolution: string | null) {
  const row = await ruleById(db, id);
  await db.insert(arenaFeedback).values({ kind: "rule", cardId: row?.cardId ?? null, skillIndex: row?.skillIndex ?? null, note, resolution });
  revalidatePath("/arena/rules");
  revalidatePath("/arena/feedback");
}

/** Draft → confirmed: the program stays, the person's acceptance is recorded. */
export async function confirmRuleAction(id: number): Promise<{ error: string | null }> {
  const row = await ruleById(db, id);
  if (!row) return { error: "no such rule" };
  await confirmRule(db, id);
  await noteRule(id, `confirmed: ${row.printed}`, row.reads);
  return { error: null };
}

/**
 * A program written by hand (or corrected in the JSON view). `patternWrong`
 * also files a compiler brief on the backlog with this program as the
 * expected reading, for the case where every card phrased this way is misread.
 */
export async function saveRuleAction(id: number, ops: unknown, explanation: string | null, patternWrong = false): Promise<{ error: string | null }> {
  if (!validateProgram(ops)) return { error: "that is not a valid program — every step needs its required fields and known values" };
  const row = await ruleById(db, id);
  if (!row) return { error: "no such rule" };
  const saved = await saveRule(db, { cardId: row.cardId, side: row.side === "back" ? "back" : "front", skillIndex: row.skillIndex, ops, source: "user", status: "corrected", explanation });
  if (patternWrong && row.pattern) {
    const clause = row.unread[0] ?? row.printed.replace(/^\s*(?:\[[^\]]*\]\s*)+/, "").trim();
    await noteUnreadText(db, [{ cardId: row.cardId, skillIndex: row.skillIndex, clause, skillText: row.printed }], false);
    await db
      .update(cardTextNotes)
      .set({
        explanation: explanation ?? `corrected by hand on the workbench; the pattern "${row.pattern}" reads this wording wrongly`,
        explainedAt: new Date(),
        lastRuling: ops,
        lastRulingWhy: saved.reads,
        brief: `## Wording\n${row.printed}\n\n## What it should emit\n\`\`\`json\n${JSON.stringify(ops, null, 2)}\n\`\`\`\n\nThe compiler's pattern \`${row.pattern}\` produced a different program for this and ${row.pattern ? "its siblings" : "this card"}; the owner corrected this one by hand and marked the pattern wrong.`,
      })
      .where(and(eq(cardTextNotes.cardId, row.cardId), eq(cardTextNotes.skillIndex, row.skillIndex), eq(cardTextNotes.clause, clause)));
    revalidatePath("/arena/backlog");
  }
  await noteRule(id, `corrected by hand${patternWrong ? " (the pattern is wrong)" : ""}: ${row.printed}`, saved.reads);
  return { error: null };
}

/** An empty program, owned by the person: the skill does nothing the engine should carry out. */
export async function blankRuleAction(id: number, explanation: string | null): Promise<{ error: string | null }> {
  const row = await ruleById(db, id);
  if (!row) return { error: "no such rule" };
  await blankRule(db, id, explanation);
  await noteRule(id, `marked as does nothing: ${row.printed}`, null);
  return { error: null };
}

/** The compiler now reads the text differently, and the person yields to it. */
export async function takeCompilerAction(id: number): Promise<{ error: string | null }> {
  await takeCompilerDiff(db, id);
  await noteRule(id, "took the compiler's newer reading", (await ruleById(db, id))?.reads ?? null);
  return { error: null };
}

/** …or keeps their own; the diff is cleared until the compiler changes its mind again. */
export async function keepMineAction(id: number): Promise<{ error: string | null }> {
  await setCompilerDiff(db, id, null);
  await noteRule(id, "kept their own reading over the compiler's", null);
  return { error: null };
}

/** You explain the card; Claude answers with a program that lands as its draft, and a brief for the compiler. */
export async function explainRuleAction(id: number, explanation: string): Promise<{ error: string | null }> {
  const row = await ruleById(db, id);
  if (!row) return { error: "no such rule" };
  try {
    const r = await clarifyRule(db, row, explanation);
    await db.insert(arenaFeedback).values({ kind: "card", noteId: r.noteId, cardId: row.cardId, skillIndex: row.skillIndex, note: explanation.trim(), resolution: r.clarification.meaning });
  } catch (err) {
    return { error: describeAiError(err) };
  }
  revalidatePath("/arena/rules");
  revalidatePath("/arena/backlog");
  revalidatePath("/arena/feedback");
  return { error: null };
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
  const [row] = await db.select({ mode: arenaGames.mode, p1User: arenaGames.p1User, p2User: arenaGames.p2User, state: arenaGames.state }).from(arenaGames).where(eq(arenaGames.id, gameId)).limit(1);
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
  if (ids.size) await noteUnreadText(db, await unreadClausesFor(db, [...ids]), false);
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
