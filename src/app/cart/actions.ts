"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { describeAiError } from "@/lib/ai/client";
import { explainCart, type CartExplanation } from "@/lib/ai/cart";
import { refreshListingsForCard, CardTraderDisabled } from "@/lib/marketplace/cardtrader";
import { cartSettings, optimiseCart, saveCartSettings } from "@/lib/marketplace/cart";
import type { Want } from "@/lib/marketplace/optimizer";

/** Live refresh of every wanted card's listings, one card at a time (10 req/s ceiling). */
export async function refreshWantsAction(wants: Want[]): Promise<{ ok: true; cards: number } | { ok: false; error: string }> {
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

export async function explainCartAction(wants: Want[]): Promise<{ ok: true; explanation: CartExplanation } | { ok: false; error: string }> {
  try {
    const cfg = await cartSettings(db);
    const r = await optimiseCart(db, wants, cfg);
    const { explanation } = await explainCart(db, r.best, r.fewestSellers, cfg.preferences);
    return { ok: true, explanation };
  } catch (err) {
    return { ok: false, error: describeAiError(err) };
  }
}

export async function saveCartSettingsForm(formData: FormData) {
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
