"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { cardPrints, ownedCards } from "@/db/schema";
import { currentUser } from "@/lib/auth";
import { CONDITIONS, FINISHES } from "@/lib/collection/queries";
import { parseEuroInput } from "@/lib/money";

export interface LotInput {
  printId: string;
  quantity: number;
  condition?: string;
  finish?: string;
  language?: string;
  acquiredOn?: string | null;
  /** Free text: "1,50" or "1.50"; per copy. */
  pricePaid?: string | null;
  currency?: string;
  notes?: string | null;
}

function normalise(input: LotInput) {
  const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1));
  const condition = (CONDITIONS as readonly string[]).includes(input.condition ?? "") ? input.condition! : "NM";
  const finish = (FINISHES as readonly string[]).includes(input.finish ?? "") ? input.finish! : "normal";
  const language = (input.language ?? "EN").toUpperCase().slice(0, 3) || "EN";
  const acquiredOn = input.acquiredOn && /^\d{4}-\d{2}-\d{2}$/.test(input.acquiredOn) ? input.acquiredOn : null;
  const pricePaidCents = input.pricePaid ? parseEuroInput(input.pricePaid) : null;
  const currency = input.currency === "USD" ? "USD" : "EUR";
  const notes = input.notes?.trim() || null;
  return { quantity, condition, finish, language, acquiredOn, pricePaidCents, currency, notes };
}

async function cardIdForPrint(printId: string): Promise<string> {
  const print = await db.query.cardPrints.findFirst({ where: eq(cardPrints.id, printId), columns: { cardId: true } });
  if (!print) throw new Error(`Unknown print ${printId}`);
  return print.cardId;
}

function revalidate(cardId: string) {
  revalidatePath("/");
  revalidatePath("/collection");
  revalidatePath(`/cards/${encodeURIComponent(cardId)}`);
}

export async function addLot(input: LotInput): Promise<{ id: number; cardId: string }> {
  const [cardId, owner] = await Promise.all([cardIdForPrint(input.printId), currentUser()]);
  const [row] = await db
    .insert(ownedCards)
    .values({ printId: input.printId, cardId, owner, ...normalise(input) })
    .returning({ id: ownedCards.id });
  revalidate(cardId);
  return { id: row.id, cardId };
}

/** Bulk entry (Path B): every row in one transaction so a typo doesn't half-commit. */
export async function addLots(inputs: LotInput[]): Promise<{ added: number }> {
  const clean = inputs.filter((i) => i.printId);
  if (clean.length === 0) return { added: 0 };
  const [cardIds, owner] = await Promise.all([Promise.all(clean.map((i) => cardIdForPrint(i.printId))), currentUser()]);
  await db.transaction(async (tx) => {
    await tx.insert(ownedCards).values(clean.map((i, idx) => ({ printId: i.printId, cardId: cardIds[idx], owner, ...normalise(i) })));
  });
  for (const id of new Set(cardIds)) revalidate(id);
  return { added: clean.reduce((n, i) => n + Math.max(1, Math.floor(Number(i.quantity) || 1)), 0) };
}

export async function updateLot(id: number, input: LotInput): Promise<void> {
  const cardId = await cardIdForPrint(input.printId);
  await db
    .update(ownedCards)
    .set({ printId: input.printId, cardId, ...normalise(input), updatedAt: new Date() })
    .where(eq(ownedCards.id, id));
  revalidate(cardId);
}

export async function deleteLot(id: number): Promise<void> {
  const [row] = await db.delete(ownedCards).where(eq(ownedCards.id, id)).returning({ cardId: ownedCards.cardId });
  if (row) revalidate(row.cardId);
}

/** Prints of a card for pickers (standard first). */
export async function printsForCardAction(cardId: string): Promise<{ id: string; label: string }[]> {
  const rows = await db.query.cardPrints.findMany({ where: eq(cardPrints.cardId, cardId), columns: { id: true, label: true, isBase: true } });
  return rows.sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.id.localeCompare(b.id)).map(({ id, label }) => ({ id, label }));
}

/** Form-action wrappers so plain <form> posts work without client JS. */
export async function addLotForm(formData: FormData) {
  await addLot({
    printId: String(formData.get("printId") ?? ""),
    quantity: Number(formData.get("quantity") ?? 1),
    condition: String(formData.get("condition") ?? "NM"),
    finish: String(formData.get("finish") ?? "normal"),
    language: String(formData.get("language") ?? "EN"),
    acquiredOn: (formData.get("acquiredOn") as string) || null,
    pricePaid: (formData.get("pricePaid") as string) || null,
    notes: (formData.get("notes") as string) || null,
  });
}

export async function deleteLotForm(formData: FormData) {
  await deleteLot(Number(formData.get("id")));
}
