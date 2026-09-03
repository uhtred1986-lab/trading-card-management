"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { describeAiError, hasAnthropic } from "@/lib/ai/client";
import { runWizard, summariseDeck, type DeckSummary } from "@/lib/ai/deck";
import { addWant, markSuggestion, removeWant, suggestionsForDeck, type SwapSuggestion } from "@/lib/decks/swaps";
import { setDeckCard } from "./actions";

export type SummaryResponse = { ok: true; summary: DeckSummary } | { ok: false; error: string };
export type WizardResponse = { ok: true; assessment: string; count: number } | { ok: false; error: string };
export type SwapActionResponse = { ok: true } | { ok: false; error: string };

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

/**
 * Ask for swaps. The suggestions are stored, so the page re-renders with them
 * under the cards they concern rather than handing them back for one screen.
 */
export async function wizardAction(deckId: number, scope: "owned" | "any", context: string | null): Promise<WizardResponse> {
  if (!hasAnthropic()) return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
  try {
    const r = await runWizard(db, deckId, scope, context?.trim() || null);
    revalidatePath(`/decks/${deckId}`);
    return { ok: true, assessment: r.assessment, count: r.swaps.length };
  } catch (err) {
    return { ok: false, error: describeAiError(err) };
  }
}

/** The suggestions for one deck, keyed by the card each proposes replacing. */
export async function suggestionsAction(deckId: number): Promise<Record<string, SwapSuggestion[]>> {
  return Object.fromEntries(await suggestionsForDeck(db, deckId));
}

/** Swap the cards over: out goes down, in goes up, in the deck's own zone. */
export async function applySwapAction(
  deckId: number,
  swap: { id?: number; outCardId: string; outQuantity: number; inCardId: string; inQuantity: number; zone?: string },
): Promise<SwapActionResponse> {
  const { deckCardQuantity } = await import("./actions");
  const zone = (swap.zone ?? "main") as "leader" | "main" | "z" | "side";
  const outNow = await deckCardQuantity(deckId, swap.outCardId, zone);
  const inNow = await deckCardQuantity(deckId, swap.inCardId, zone);
  const r1 = await setDeckCard(deckId, swap.outCardId, zone, Math.max(0, outNow - swap.outQuantity));
  if (!r1.ok) return { ok: false, error: `Blocked: short ${r1.conflicts[0]?.short} × ${r1.conflicts[0]?.name}` };
  const r2 = await setDeckCard(deckId, swap.inCardId, zone, inNow + swap.inQuantity);
  if (!r2.ok) {
    await setDeckCard(deckId, swap.outCardId, zone, outNow); // put it back
    return { ok: false, error: `Blocked: built deck is short ${r2.conflicts[0]?.short} × ${r2.conflicts[0]?.name}` };
  }
  if (swap.id) await markSuggestion(db, swap.id, "applied");
  revalidatePath(`/decks/${deckId}`);
  return { ok: true };
}

export async function dismissSuggestionAction(id: number): Promise<SwapActionResponse> {
  const row = await markSuggestion(db, id, "dismissed");
  if (row) revalidatePath(`/decks/${row.deckId}`);
  return { ok: true };
}

/** Park a card you'd have to buy, so the cart optimiser can price it later. */
export async function wantCardAction(cardId: string, quantity: number, note: string | null, deckId: number | null): Promise<SwapActionResponse> {
  await addWant(db, cardId, quantity, note, deckId);
  revalidatePath("/cart");
  if (deckId) revalidatePath(`/decks/${deckId}`);
  return { ok: true };
}

export async function unwantCardAction(cardId: string): Promise<SwapActionResponse> {
  await removeWant(db, cardId);
  revalidatePath("/cart");
  return { ok: true };
}
