"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { refreshListingsForCard } from "@/lib/marketplace/cardtrader";
import { requireSignedIn } from "@/lib/auth";

export async function refreshListingsForm(formData: FormData) {
  await requireSignedIn();
  const cardId = String(formData.get("cardId") ?? "");
  await refreshListingsForCard(db, cardId);
  revalidatePath(`/cards/${encodeURIComponent(cardId)}`);
}
