"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { describeAiError } from "@/lib/ai/client";
import { explainCart, type CartExplanation } from "@/lib/ai/cart";
import { refreshListingsForCard, CardTraderDisabled } from "@/lib/marketplace/cardtrader";
import { cartSettings, listingFilterFrom, optimiseCart, saveCartSettings, type ListingFilter } from "@/lib/marketplace/cart";
import { MarkBoughtError, markWishBought } from "@/lib/marketplace/wishes";
import type { Want } from "@/lib/marketplace/optimizer";
import { requireSignedIn, requireSl } from "@/lib/auth";

/** Live refresh of every wanted card's listings, one card at a time (10 req/s ceiling). */
export async function refreshWantsAction(wants: Want[]): Promise<{ ok: true; cards: number } | { ok: false; error: string }> {
  await requireSignedIn();
  try {
    let n = 0;
    for (const w of wants) {
      await refreshListingsForCard(db, w.cardId);
      n++;
    }
    revalidatePath("/cart");
    return { ok: true, cards: n };
  } catch (err) {
    return { ok: false, error: err instanceof CardTraderDisabled ? err.message : err instanceof Error ? err.message : String(err) };
  }
}

export async function explainCartAction(wants: Want[], filter?: Partial<ListingFilter>): Promise<{ ok: true; explanation: CartExplanation } | { ok: false; error: string }> {
  await requireSignedIn();
  try {
    const cfg = await cartSettings(db);
    const r = await optimiseCart(db, wants, cfg, listingFilterFrom(filter?.language, filter?.condition));
    const { explanation } = await explainCart(db, r.best, r.fewestSellers, cfg.preferences);
    return { ok: true, explanation };
  } catch (err) {
    return { ok: false, error: describeAiError(err) };
  }
}

/** The optimiser's shipping and country settings are one row for the whole app: an SL's to change. */
export async function saveCartSettingsForm(formData: FormData) {
  await requireSl();
  const countries = String(formData.get("countries") ?? "")
    .split(/[,\s]+/)
    .map((c) => c.trim().toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));
  await saveCartSettings(db, {
    hubShippingCents: Math.round(Number(String(formData.get("hub") ?? "0").replace(",", ".")) * 100) || 0,
    directShippingCents: Math.round(Number(String(formData.get("direct") ?? "0").replace(",", ".")) * 100) || 0,
    countries,
    preferences: String(formData.get("preferences") ?? "").trim(),
  });
  revalidatePath("/cart");
}

/** "12,50" or "12.5" euros per copy to integer cents; empty means "price not known". */
function eurosToCents(v: string | number | null | undefined): number | null | "bad" {
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) : "bad";
}

/**
 * Mark a wished card as bought: SL only. `quantity` copies go to the wishing player's collection
 * (stamped with their owner name, price paid in EUR per copy) and leave their wish list.
 */
export async function markBoughtAction(input: {
  owner: string;
  cardId: string;
  quantity: number;
  /** Euros per copy, as typed. */
  priceEur: string | number | null;
  printId?: string | null;
  language?: string | null;
  /** The cart's filter, for the default variant and language. */
  filter?: Partial<ListingFilter>;
}): Promise<{ ok: true; bought: number; wishLeft: number; language: "DE" | "EN"; printId: string } | { ok: false; error: string }> {
  const viewer = await requireSl();
  const cents = eurosToCents(input.priceEur);
  if (cents === "bad") return { ok: false, error: "Enter the price per copy in euros, for example 4.50." };
  try {
    const lang = String(input.language ?? "").toUpperCase();
    const r = await markWishBought(db, viewer, {
      owner: String(input.owner ?? ""),
      cardId: String(input.cardId ?? ""),
      quantity: Number(input.quantity),
      pricePaidCents: cents,
      printId: input.printId ? String(input.printId) : null,
      language: lang === "DE" || lang === "EN" ? lang : null,
      filter: listingFilterFrom(input.filter?.language, input.filter?.condition),
    });
    revalidatePath("/cart");
    revalidatePath("/collection");
    revalidatePath(`/cards/${encodeURIComponent(input.cardId)}`);
    return { ok: true, bought: r.bought, wishLeft: r.wishLeft, language: r.language, printId: r.printId };
  } catch (err) {
    if (err instanceof MarkBoughtError) return { ok: false, error: err.message };
    throw err;
  }
}
