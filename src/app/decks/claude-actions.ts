"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { strictGame } from "@/lib/catalog/games";
import { describeAiError, hasAnthropic } from "@/lib/ai/client";
import { buildDeckAroundCard, buildDeckWithClaude, hasFreeDraft } from "@/lib/ai/games/build";
import { currentOwner, requireSignedIn } from "@/lib/auth";

export type ClaudeBuildResponse =
  | { ok: true; deckId: number; mode: "draft" | "claude"; mainCount: number; toBuy: number; leaderName?: string; status: string | null; notes: string[] }
  | { ok: false; error: string };

function refresh() {
  revalidatePath("/leaders");
  revalidatePath("/decks");
  revalidatePath("/pokemon/decks");
}

/** "Build a deck with Claude" for any game: a Leader (Dragon Ball) or a card and / or a wish (Pokémon). A paid call. */
export async function buildDeckWithClaudeAction(game: string, input: { leaderId?: string | null; seedCardId?: string | null; wish?: string | null; format?: string | null }): Promise<ClaudeBuildResponse> {
  await requireSignedIn();
  if (!hasAnthropic()) return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
  try {
    const r = await buildDeckWithClaude(strictGame(game), input, { db, owner: await currentOwner() });
    refresh();
    return { ok: true, deckId: r.deckId, mode: r.mode, mainCount: r.mainCount, toBuy: r.toBuy, leaderName: r.leaderName, status: r.legality?.status ?? null, notes: r.notes };
  } catch (err) {
    return { ok: false, error: describeAiError(err) };
  }
}

/** "Build a deck around this card": the free draft (Pokémon) or Claude (a paid call; the only way for Dragon Ball). */
export async function buildDeckAroundCardAction(game: string, cardId: string, mode: "draft" | "claude", format?: string | null): Promise<ClaudeBuildResponse> {
  await requireSignedIn();
  try {
    const g = strictGame(game);
    const chosen = mode === "draft" && hasFreeDraft(g) ? "draft" : "claude";
    if (chosen === "claude" && !hasAnthropic()) return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
    const r = await buildDeckAroundCard(g, cardId, { db, owner: await currentOwner(), mode: chosen, format });
    refresh();
    return { ok: true, deckId: r.deckId, mode: r.mode, mainCount: r.mainCount, toBuy: r.toBuy, leaderName: r.leaderName, status: r.legality?.status ?? null, notes: r.notes };
  } catch (err) {
    return { ok: false, error: describeAiError(err) };
  }
}
