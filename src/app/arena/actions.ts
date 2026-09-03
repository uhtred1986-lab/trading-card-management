"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { IllegalAction, type Action } from "@/lib/arena/engine";
import { abandonGame, applyToGame, startGame, type ArenaMode } from "@/lib/arena/games";

export async function startGameForm(formData: FormData) {
  const p1 = Number(formData.get("p1"));
  const p2 = Number(formData.get("p2"));
  const mode = String(formData.get("mode") ?? "hotseat") as ArenaMode;
  if (!Number.isInteger(p1) || !Number.isInteger(p2)) throw new Error("pick two decks");
  const id = await startGame(db, p1, p2, mode);
  revalidatePath("/arena");
  redirect(`/arena/${id}`);
}

/**
 * Apply one action. The engine decides what is legal, so an action forged in
 * the browser can only ever be refused — never trusted.
 */
export async function act(gameId: number, action: Action): Promise<{ error: string | null }> {
  try {
    await applyToGame(db, gameId, action);
  } catch (err) {
    if (err instanceof IllegalAction) return { error: err.message };
    throw err;
  }
  revalidatePath(`/arena/${gameId}`);
  return { error: null };
}

export async function abandon(gameId: number) {
  await abandonGame(db, gameId);
  revalidatePath("/arena");
  redirect("/arena");
}
