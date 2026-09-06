"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { arenaFeedback, arenaGames, cardTextNotes, cards as cardsTable } from "@/db/schema";
import { listDecks } from "@/lib/decks/queries";
import { noteUnreadText, setNoteStatus, unreadClausesOf } from "@/lib/arena/ai/debug";
import { cardDefFrom, deckInputFor } from "@/lib/arena/load";
import { describeAiError } from "@/lib/ai/client";
import { IllegalAction, type Action } from "@/lib/arena/engine";
import { abandonGame, applyToGame, clearBeats, loadGame, startGame, type ArenaMode } from "@/lib/arena/games";
import { advance } from "@/lib/arena/ai/run";
import { reviewGame } from "@/lib/arena/ai/review";
import { clarifyCard } from "@/lib/arena/ai/clarify";
import { previewRule, removeRule, type RulePreview } from "@/lib/arena/rules";
import { saveScript } from "@/lib/arena/scripts";

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
  await db.insert(arenaFeedback).values({
    kind: "bug",
    gameId,
    note: text,
    cardId: cardId || null,
    turn: game.state.turn,
    phase: game.state.phase,
    prompt: game.state.prompt.kind,
    state: game.state,
    actions: (await db.query.arenaGames.findFirst({ where: eq(arenaGames.id, gameId) }))?.actions ?? [],
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
  if (!Number.isInteger(p1) || !Number.isInteger(p2)) throw new Error("pick two decks");
  const id = await startGame(db, p1, p2, mode, formData.get("debug") != null);
  revalidatePath("/arena");
  redirect(`/arena/${id}`);
}

/**
 * Apply one action, then let the server take every decision that is not
 * yours — Claude's moves, and any referee ruling. The engine decides what is
 * legal, so an action forged in the browser can only ever be refused.
 */
export async function act(gameId: number, action: Action): Promise<{ error: string | null }> {
  try {
    // Empty the animation queue first: from here until you act again, what
    // accumulates is one story — your move, then everything the server does
    // in reply. See `src/lib/arena/beats.ts`.
    await clearBeats(db, gameId);
    await applyToGame(db, gameId, action);
  } catch (err) {
    if (err instanceof IllegalAction) return { error: err.message };
    throw err;
  }
  const ran = await advance(db, gameId);
  revalidatePath(`/arena/${gameId}`);
  return { error: ran.error };
}

/** Used when a page loads and it is already Claude's turn, or a ruling is pending. */
export async function advanceGame(gameId: number): Promise<{ error: string | null }> {
  const ran = await advance(db, gameId);
  revalidatePath(`/arena/${gameId}`);
  return { error: ran.error };
}

export async function requestReview(gameId: number): Promise<{ error: string | null }> {
  try {
    await reviewGame(db, gameId);
  } catch (err) {
    return { error: describeAiError(err) };
  }
  revalidatePath(`/arena/${gameId}`);
  return { error: null };
}

export async function abandon(gameId: number) {
  await abandonGame(db, gameId);
  revalidatePath("/arena");
  redirect("/arena");
}

/** Fill the backlog from every deck you can actually play. */
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
