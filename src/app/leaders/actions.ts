"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { describeAiError, hasAnthropic } from "@/lib/ai/client";
import { suggestDeck } from "@/lib/ai/deck-builder";

export type BuildDeckResponse = { ok: true; deckId: number; mainCount: number; toBuy: number } | { ok: false; error: string };

export async function buildDeckAction(leaderId: string): Promise<BuildDeckResponse> {
  if (!hasAnthropic()) return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
  try {
    const { deckId, sanitised } = await suggestDeck(db, leaderId);
    revalidatePath("/leaders");
    revalidatePath("/decks");
    return { ok: true, deckId, mainCount: sanitised.mainCount, toBuy: [...sanitised.main, ...sanitised.z].reduce((n, c) => n + c.needToBuy, 0) };
  } catch (err) {
    return { ok: false, error: describeAiError(err) };
  }
}
