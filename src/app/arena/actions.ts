"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { cards as cardsTable } from "@/db/schema";
import { listDecks } from "@/lib/decks/queries";
import { noteUnreadText, setNoteStatus, unreadClausesOf } from "@/lib/arena/ai/debug";
import { cardDefFrom, deckInputFor } from "@/lib/arena/load";
import { describeAiError } from "@/lib/ai/client";
import { IllegalAction, type Action } from "@/lib/arena/engine";
import { abandonGame, applyToGame, startGame, type ArenaMode } from "@/lib/arena/games";
import { advance } from "@/lib/arena/ai/run";
import { reviewGame } from "@/lib/arena/ai/review";

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
  const all = await listDecks(db);
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
