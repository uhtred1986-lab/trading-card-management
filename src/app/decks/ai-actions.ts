"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { describeAiError, hasAnthropic } from "@/lib/ai/client";
import { runWizard, summariseDeck, type DeckSummary, type WizardSwap } from "@/lib/ai/deck";
import { setDeckCard } from "./actions";

export type SummaryResponse = { ok: true; summary: DeckSummary } | { ok: false; error: string };
export type WizardResponse = { ok: true; assessment: string; swaps: WizardSwap[] } | { ok: false; error: string };

export async function summariseDeckAction(deckId: number): Promise<SummaryResponse> {
  if (!hasAnthropic()) return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
  try {
    const { summary } = await summariseDeck(db, deckId);
    revalidatePath(`/decks/${deckId}`);
    return { ok: true, summary };
  } catch (err) {
    return { ok: false, error: describeAiError(err) };
  }
}

export async function wizardAction(deckId: number, scope: "owned" | "any"): Promise<WizardResponse> {
  if (!hasAnthropic()) return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
  try {
    const r = await runWizard(db, deckId, scope);
    return { ok: true, assessment: r.assessment, swaps: r.swaps };
  } catch (err) {
    return { ok: false, error: describeAiError(err) };
  }
}

/** Apply one accepted swap: lower the outgoing card, raise the incoming one (main deck). */
export async function applySwapAction(deckId: number, swap: { outCardId: string; outQuantity: number; inCardId: string; inQuantity: number }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { deckCardQuantity } = await import("./actions");
  const outNow = await deckCardQuantity(deckId, swap.outCardId, "main");
  const inNow = await deckCardQuantity(deckId, swap.inCardId, "main");
  const r1 = await setDeckCard(deckId, swap.outCardId, "main", Math.max(0, outNow - swap.outQuantity));
  if (!r1.ok) return { ok: false, error: `Blocked: short ${r1.conflicts[0]?.short} × ${r1.conflicts[0]?.name}` };
  const r2 = await setDeckCard(deckId, swap.inCardId, "main", inNow + swap.inQuantity);
  if (!r2.ok) {
    await setDeckCard(deckId, swap.outCardId, "main", outNow); // put it back
    return { ok: false, error: `Blocked: built deck is short ${r2.conflicts[0]?.short} × ${r2.conflicts[0]?.name}` };
  }
  return { ok: true };
}
