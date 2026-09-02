"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { refreshListingsForCard } from "@/lib/marketplace/cardtrader";

export async function refreshListingsForm(formData: FormData) {
  const cardId = String(formData.get("cardId") ?? "");
  await refreshListingsForCard(db, cardId);
  revalidatePath(`/cards/${encodeURIComponent(cardId)}`);
}
