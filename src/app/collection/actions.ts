"use server";

import { eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { cardPrints, ownedCards } from "@/db/schema";
import { currentOwner } from "@/lib/auth";
import { addCardsToDeck } from "@/lib/decks/add";
import { setCopyLocations } from "@/lib/collection/locations";
import { expand } from "@/lib/collection/lots";
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
  /** Whose card this is; defaults to the logged-in user's owner name. */
  owner?: string | null;
}

/** The stored shape of one physical card — no quantity; see lib/collection/lots.ts. */
function normalise(input: LotInput) {
  const condition = (CONDITIONS as readonly string[]).includes(input.condition ?? "") ? input.condition! : "NM";
  const finish = (FINISHES as readonly string[]).includes(input.finish ?? "") ? input.finish! : "normal";
  const language = (input.language ?? "EN").toUpperCase().slice(0, 3) || "EN";
  const acquiredOn = input.acquiredOn && /^\d{4}-\d{2}-\d{2}$/.test(input.acquiredOn) ? input.acquiredOn : null;
  const pricePaidCents = input.pricePaid ? parseEuroInput(input.pricePaid) : null;
  const currency = input.currency === "USD" ? "USD" : "EUR";
  const notes = input.notes?.trim() || null;
  return { condition, finish, language, acquiredOn, pricePaidCents, currency, notes };
}

async function cardIdForPrint(printId: string): Promise<string> {
  const print = await db.query.cardPrints.findFirst({ where: eq(cardPrints.id, printId), columns: { cardId: true } });
  if (!print) throw new Error(`Unknown print ${printId}`);
  return print.cardId;
}

function revalidateCards(cardIds: Iterable<string>) {
  revalidatePath("/");
  revalidatePath("/collection");
  for (const id of new Set(cardIds)) revalidatePath(`/cards/${encodeURIComponent(id)}`);
}

function revalidate(cardId: string) {
  revalidateCards([cardId]);
}

/**
 * Asking for 2 copies stores two rows — one per physical card — so each can
 * later carry its own finish or go to its own deck. `deckId` also adds them to
 * that deck (leader slot / Z-deck / main by card type).
 */
export async function addLot(input: LotInput, deckId: number | null = null): Promise<{ ids: number[]; cardId: string; added: number; deckAdded: number }> {
  const [cardId, fallback] = await Promise.all([cardIdForPrint(input.printId), currentOwner()]);
  const owner = input.owner?.trim() || fallback;
  const rows = expand({ printId: input.printId, cardId, owner, ...normalise(input) }, input.quantity);
  const result = await db.transaction(async (tx) => {
    const inserted = await tx.insert(ownedCards).values(rows).returning({ id: ownedCards.id });
    const deckAdded = deckId ? (await addCardsToDeck(tx as unknown as typeof db, deckId, [{ cardId, quantity: rows.length }])).added : 0;
    return { ids: inserted.map((r) => r.id), deckAdded };
  });
  revalidate(cardId);
  if (deckId) revalidatePath(`/decks/${deckId}`);
  return { ...result, cardId, added: rows.length };
}

/** Bulk entry (Path B): every row in one transaction so a typo doesn't half-commit. */
export async function addLots(inputs: LotInput[], deckId: number | null = null): Promise<{ added: number; deckAdded: number }> {
  const clean = inputs.filter((i) => i.printId);
  if (clean.length === 0) return { added: 0, deckAdded: 0 };
  const [cardIds, fallback] = await Promise.all([Promise.all(clean.map((i) => cardIdForPrint(i.printId))), currentOwner()]);
  const rows = clean.flatMap((i, idx) => expand({ printId: i.printId, cardId: cardIds[idx], owner: i.owner?.trim() || fallback, ...normalise(i) }, i.quantity));
  const deckAdded = await db.transaction(async (tx) => {
    await tx.insert(ownedCards).values(rows);
    return deckId ? (await addCardsToDeck(tx as unknown as typeof db, deckId, rows.map((r) => ({ cardId: r.cardId, quantity: 1 })))).added : 0;
  });
  for (const id of new Set(cardIds)) revalidate(id);
  if (deckId) revalidatePath(`/decks/${deckId}`);
  return { added: rows.length, deckAdded };
}

/**
 * Flip one collection lot between foil and non-foil. Its own action because
 * it is a one-tap edit from the card page, and because the finish changes
 * which market price the lot is valued at.
 */
export async function setLotFinishAction(lotId: number, foil: boolean): Promise<{ ok: boolean }> {
  const [row] = await db
    .update(ownedCards)
    .set({ finish: foil ? "foil" : "normal", updatedAt: new Date() })
    .where(eq(ownedCards.id, lotId))
    .returning({ cardId: ownedCards.cardId });
  if (!row) return { ok: false };
  revalidate(row.cardId);
  return { ok: true };
}

/**
 * Re-assign one physical card to a different owner (or to nobody). Only the
 * card page offers this — adding and the collection popover keep using the
 * logged-in user, which is right almost always.
 */
export async function setLotOwnerAction(lotId: number, owner: string | null): Promise<{ ok: boolean; owner: string | null }> {
  const clean = owner?.trim().slice(0, 64) || null;
  const [row] = await db
    .update(ownedCards)
    .set({ owner: clean, updatedAt: new Date() })
    .where(eq(ownedCards.id, lotId))
    .returning({ cardId: ownedCards.cardId });
  if (!row) return { ok: false, owner: null };
  revalidate(row.cardId);
  return { ok: true, owner: clean };
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

export interface CopyRow {
  id: number;
  printId: string;
  printLabel: string;
  condition: string;
  finish: string;
  language: string;
}

/** The individual physical cards of one card id, for the collection popover. */
export async function copiesForCardAction(cardId: string): Promise<CopyRow[]> {
  const rows = await db
    .select({
      id: ownedCards.id,
      printId: ownedCards.printId,
      printLabel: cardPrints.label,
      condition: ownedCards.condition,
      finish: ownedCards.finish,
      language: ownedCards.language,
    })
    .from(ownedCards)
    .innerJoin(cardPrints, eq(cardPrints.id, ownedCards.printId))
    .where(eq(ownedCards.cardId, cardId))
    .orderBy(ownedCards.id);
  return rows;
}

/** Add one more physical copy, matching the newest one you already own. */
export async function addCopyAction(cardId: string): Promise<CopyRow[]> {
  const existing = await copiesForCardAction(cardId);
  const like = existing[existing.length - 1];
  const printId =
    like?.printId ??
    (await db.query.cardPrints.findFirst({ where: (p, { and, eq: e }) => and(e(p.cardId, cardId), e(p.isBase, true)), columns: { id: true } }))?.id ??
    (await db.query.cardPrints.findFirst({ where: (p, { eq: e }) => e(p.cardId, cardId), columns: { id: true } }))?.id;
  if (!printId) throw new Error(`No print to add for ${cardId}`);
  await db.insert(ownedCards).values({
    printId,
    cardId,
    owner: await currentOwner(),
    condition: like?.condition ?? "NM",
    finish: like?.finish ?? "normal",
    language: like?.language ?? "EN",
  });
  revalidate(cardId);
  return copiesForCardAction(cardId);
}

/** Remove one physical copy and hand back what is left. */
export async function removeCopyAction(lotId: number, cardId: string): Promise<CopyRow[]> {
  await db.delete(ownedCards).where(eq(ownedCards.id, lotId));
  revalidate(cardId);
  return copiesForCardAction(cardId);
}

export async function setCopyFinishAction(lotId: number, foil: boolean, cardId: string): Promise<CopyRow[]> {
  await db.update(ownedCards).set({ finish: foil ? "foil" : "normal", updatedAt: new Date() }).where(eq(ownedCards.id, lotId));
  revalidate(cardId);
  return copiesForCardAction(cardId);
}

/** Put this card into a deck (leader slot / Z-deck / main by card type). */
export async function assignToDeckAction(cardId: string, deckId: number, quantity = 1): Promise<{ added: number }> {
  const r = await addCardsToDeck(db, deckId, [{ cardId, quantity }]);
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  revalidate(cardId);
  return r;
}

/** Prints of a card for pickers (standard first). */
export async function printsForCardAction(cardId: string): Promise<{ id: string; label: string }[]> {
  const rows = await db.query.cardPrints.findMany({ where: eq(cardPrints.cardId, cardId), columns: { id: true, label: true, isBase: true } });
  return rows.sort((a, b) => Number(b.isBase) - Number(a.isBase) || a.id.localeCompare(b.id)).map(({ id, label }) => ({ id, label }));
}

/** Form-action wrappers so plain <form> posts work without client JS. */
export async function addLotForm(formData: FormData) {
  const deckId = Number(formData.get("deckId")) || null;
  await addLot(
    {
      printId: String(formData.get("printId") ?? ""),
      quantity: Number(formData.get("quantity") ?? 1),
      condition: String(formData.get("condition") ?? "NM"),
      finish: String(formData.get("finish") ?? "normal"),
      language: String(formData.get("language") ?? "EN"),
      acquiredOn: (formData.get("acquiredOn") as string) || null,
      pricePaid: (formData.get("pricePaid") as string) || null,
      notes: (formData.get("notes") as string) || null,
    },
    deckId,
  );
}

export async function deleteLotForm(formData: FormData) {
  await deleteLot(Number(formData.get("id")));
}

// ── Bulk edits from the collection list ────────────────────────────────────
// The list selects individual physical cards, so every one of these takes lot
// ids and touches exactly the copies that were ticked — never a whole card.

/** A stray id list this long is not a real selection; the whole collection is. */
const MAX_BULK = 20000;

function cleanIds(lotIds: number[]): number[] {
  return [...new Set(lotIds.filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_BULK);
}

/** Re-assign the selected copies to an owner, or to nobody. */
/** Mass-assign a storage location, so a shelf-full can be filed in one go. */
export async function bulkSetLocationAction(lotIds: number[], locationId: number | null): Promise<{ updated: number }> {
  const ids = cleanIds(lotIds);
  if (ids.length === 0) return { updated: 0 };
  const cardIds = await setCopyLocations(db, ids, locationId);
  revalidateCards(cardIds);
  revalidatePath("/collection");
  return { updated: cardIds.length };
}

export async function bulkSetOwnerAction(lotIds: number[], owner: string | null): Promise<{ updated: number }> {
  const ids = cleanIds(lotIds);
  if (ids.length === 0) return { updated: 0 };
  const clean = owner?.trim().slice(0, 64) || null;
  const rows = await db
    .update(ownedCards)
    .set({ owner: clean, updatedAt: new Date() })
    .where(inArray(ownedCards.id, ids))
    .returning({ cardId: ownedCards.cardId });
  revalidateCards(rows.map((r) => r.cardId));
  return { updated: rows.length };
}

/** Mark the selected copies foil or non-foil — this changes what they are worth. */
export async function bulkSetFinishAction(lotIds: number[], foil: boolean): Promise<{ updated: number }> {
  const ids = cleanIds(lotIds);
  if (ids.length === 0) return { updated: 0 };
  const rows = await db
    .update(ownedCards)
    .set({ finish: foil ? "foil" : "normal", updatedAt: new Date() })
    .where(inArray(ownedCards.id, ids))
    .returning({ cardId: ownedCards.cardId });
  revalidateCards(rows.map((r) => r.cardId));
  return { updated: rows.length };
}

export async function bulkDeleteCopiesAction(lotIds: number[]): Promise<{ deleted: number }> {
  const ids = cleanIds(lotIds);
  if (ids.length === 0) return { deleted: 0 };
  const rows = await db.delete(ownedCards).where(inArray(ownedCards.id, ids)).returning({ cardId: ownedCards.cardId });
  revalidateCards(rows.map((r) => r.cardId));
  return { deleted: rows.length };
}

/**
 * Send the selected copies' cards to a deck. Two ticked copies of one card ask
 * for two slots; `addCardsToDeck` still never caps or replaces, so an illegal
 * count is flagged on the deck rather than silently dropped.
 */
export async function bulkAddToDeckAction(lotIds: number[], deckId: number): Promise<{ added: number }> {
  const ids = cleanIds(lotIds);
  if (ids.length === 0 || !deckId) return { added: 0 };
  const rows = await db.select({ cardId: ownedCards.cardId }).from(ownedCards).where(inArray(ownedCards.id, ids));
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.cardId, (totals.get(r.cardId) ?? 0) + 1);
  const result = await addCardsToDeck(db, deckId, [...totals].map(([cardId, quantity]) => ({ cardId, quantity })));
  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/decks");
  revalidateCards([...totals.keys()]);
  return result;
}
