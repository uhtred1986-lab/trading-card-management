"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { cards, deckCards, decks } from "@/db/schema";
import { quickSearch } from "@/lib/catalog/queries";
import { decksForCard, parseDeckList, ZONES, type CardDeckMembership, type Zone } from "@/lib/decks/queries";
import { zoneForType } from "@/lib/decks/add";
import { buildConflicts, type BuildConflict } from "@/lib/decks/reservations";

function revalidate(deckId?: number) {
  revalidatePath("/decks");
  revalidatePath("/collection");
  revalidatePath("/");
  if (deckId) revalidatePath(`/decks/${deckId}`);
}

/** Used by the DeckPicker on the add screens: create and return, no redirect. */
export async function createDeckAction(name: string): Promise<{ id: number; name: string; isBuilt: boolean }> {
  const clean = name.trim().slice(0, 120) || "Untitled deck";
  const [row] = await db.insert(decks).values({ name: clean }).returning({ id: decks.id, name: decks.name, isBuilt: decks.isBuilt });
  revalidate();
  return row;
}

export async function createDeckForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || "Untitled deck";
  const [row] = await db.insert(decks).values({ name }).returning({ id: decks.id });
  revalidate();
  redirect(`/decks/${row.id}`);
}

export async function updateDeck(id: number, patch: { name?: string; description?: string | null; metaNotes?: string | null; locationId?: number | null }) {
  await db
    .update(decks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(decks.id, id));
  revalidate(id);
}

export async function updateDeckForm(formData: FormData) {
  const id = Number(formData.get("id"));
  const location = String(formData.get("locationId") ?? "");
  await updateDeck(id, {
    name: String(formData.get("name") ?? "").trim() || "Untitled deck",
    description: (formData.get("description") as string)?.trim() || null,
    metaNotes: (formData.get("metaNotes") as string)?.trim() || null,
    locationId: location ? Number(location) : null,
  });
}

export async function deleteDeckForm(formData: FormData) {
  const id = Number(formData.get("id"));
  await db.delete(decks).where(eq(decks.id, id));
  revalidate();
  redirect("/decks");
}

export async function duplicateDeck(id: number): Promise<number> {
  const src = await db.query.decks.findFirst({ where: eq(decks.id, id) });
  if (!src) throw new Error("Deck not found");
  const [row] = await db
    .insert(decks)
    .values({ name: `${src.name} (copy)`, description: src.description, metaNotes: src.metaNotes })
    .returning({ id: decks.id });
  await db.execute(sql`insert into deck_cards (deck_id, card_id, zone, quantity) select ${row.id}, card_id, zone, quantity from deck_cards where deck_id = ${id}`);
  revalidate();
  return row.id;
}

export async function duplicateDeckForm(formData: FormData) {
  const newId = await duplicateDeck(Number(formData.get("id")));
  redirect(`/decks/${newId}`);
}

/**
 * Set the quantity of a card in a zone; 0 removes it. Changing a *built* deck
 * is allowed only while the collection can still cover it — otherwise the deck
 * would silently over-reserve.
 */
export async function setDeckCard(
  deckId: number,
  cardId: string,
  zone: Zone,
  quantity: number,
): Promise<{ ok: true } | { ok: false; conflicts: BuildConflict[] }> {
  if (!ZONES.includes(zone)) throw new Error("Bad zone");
  const q = Math.max(0, Math.floor(quantity));
  // Conflicts are computed *inside* the transaction (against the proposed
  // change) and carried out before the rollback discards it.
  let conflicts: BuildConflict[] = [];
  try {
    await db.transaction(async (tx) => {
      const deck = await tx.query.decks.findFirst({ where: eq(decks.id, deckId), columns: { isBuilt: true } });
      if (!deck) throw new Error("Deck not found");
      if (zone === "leader" && q > 0) {
        // One leader: replace whatever is there.
        await tx.delete(deckCards).where(and(eq(deckCards.deckId, deckId), eq(deckCards.zone, "leader")));
      }
      if (q === 0) {
        await tx.delete(deckCards).where(and(eq(deckCards.deckId, deckId), eq(deckCards.cardId, cardId), eq(deckCards.zone, zone)));
      } else {
        await tx
          .insert(deckCards)
          .values({ deckId, cardId, zone, quantity: zone === "leader" ? 1 : q })
          .onConflictDoUpdate({ target: [deckCards.deckId, deckCards.cardId, deckCards.zone], set: { quantity: zone === "leader" ? 1 : q } });
      }
      await tx.update(decks).set({ updatedAt: new Date() }).where(eq(decks.id, deckId));
      if (deck.isBuilt) {
        conflicts = await buildConflicts(tx as unknown as typeof db, deckId);
        if (conflicts.length) tx.rollback();
      }
    });
  } catch (err) {
    // drizzle's tx.rollback() throws; that's the expected path when blocked.
    if (!(conflicts.length && err instanceof Error && /rollback/i.test(err.message))) throw err;
  }
  if (conflicts.length) return { ok: false, conflicts };
  revalidate(deckId);
  return { ok: true };
}

/** Flip built ↔ virtual. Building is blocked outright when the collection can't cover it. */
export async function setBuilt(deckId: number, built: boolean): Promise<{ ok: true } | { ok: false; conflicts: BuildConflict[] }> {
  if (built) {
    const conflicts = await buildConflicts(db, deckId);
    if (conflicts.length) return { ok: false, conflicts };
  }
  await db
    .update(decks)
    .set({ isBuilt: built, builtAt: built ? new Date() : null, updatedAt: new Date() })
    .where(eq(decks.id, deckId));
  revalidate(deckId);
  return { ok: true };
}

/** Paste a decklist; unknown numbers are reported back, known ones are added. */
export async function importDeckList(deckId: number, text: string): Promise<{ added: number; unknown: string[] }> {
  const parsed = parseDeckList(text);
  if (!parsed.length) return { added: 0, unknown: [] };
  const ids = [...new Set(parsed.map((p) => p.cardId))];
  const known = new Set((await db.select({ id: cards.id }).from(cards).where(sql`${cards.id} in ${ids}`)).map((r) => r.id));
  const unknown = ids.filter((i) => !known.has(i));
  let added = 0;
  for (const p of parsed) {
    if (!known.has(p.cardId)) continue;
    const r = await setDeckCard(deckId, p.cardId, p.zone, p.quantity);
    if (r.ok) added += p.quantity;
  }
  return { added, unknown };
}

export async function importDeckListForm(formData: FormData) {
  await importDeckList(Number(formData.get("id")), String(formData.get("list") ?? ""));
}

/** Current quantity of a card in a zone (0 if absent) — the builder adds one to it. */
export async function deckCardQuantity(deckId: number, cardId: string, zone: Zone): Promise<number> {
  const row = await db.query.deckCards.findFirst({
    where: and(eq(deckCards.deckId, deckId), eq(deckCards.cardId, cardId), eq(deckCards.zone, zone)),
    columns: { quantity: true },
  });
  return row?.quantity ?? 0;
}

export type CardDeckResult = { ok: true; decks: CardDeckMembership[] } | { ok: false; error: string; decks: CardDeckMembership[] };

/** Which decks hold this card — for the control on the card page. */
export async function decksForCardAction(cardId: string): Promise<CardDeckMembership[]> {
  return decksForCard(db, cardId);
}

/**
 * Put the card in a deck from the card page. Routed through `setDeckCard` so a
 * built deck still can't be pushed past what you own — that check is about
 * owning the cards, not about deck rules.
 */
export async function addCardToDeckAction(cardId: string, deckId: number): Promise<CardDeckResult> {
  const card = await db.query.cards.findFirst({ where: eq(cards.id, cardId), columns: { cardType: true } });
  if (!card) return { ok: false, error: "Unknown card.", decks: await decksForCard(db, cardId) };
  const zone = zoneForType(card.cardType);
  const current = await deckCardQuantity(deckId, cardId, zone);
  const r = await setDeckCard(deckId, cardId, zone, current + 1);
  if (!r.ok) {
    const c = r.conflicts[0];
    return { ok: false, error: c ? `That built deck would be short ${c.short} × ${c.name}.` : "Blocked by a built deck.", decks: await decksForCard(db, cardId) };
  }
  return { ok: true, decks: await decksForCard(db, cardId) };
}

/** Take the card out of one deck entirely, whichever zone it sat in. */
export async function removeCardFromDeckAction(cardId: string, deckId: number): Promise<CardDeckResult> {
  await db.delete(deckCards).where(and(eq(deckCards.deckId, deckId), eq(deckCards.cardId, cardId)));
  await db.update(decks).set({ updatedAt: new Date() }).where(eq(decks.id, deckId));
  revalidate(deckId);
  revalidatePath(`/cards/${encodeURIComponent(cardId)}`);
  return { ok: true, decks: await decksForCard(db, cardId) };
}

/** Create a deck and drop this card straight into it. */
export async function createDeckWithCardAction(cardId: string, name: string): Promise<CardDeckResult> {
  const deck = await createDeckAction(name);
  return addCardToDeckAction(cardId, deck.id);
}

/** Typeahead for the builder's search box. */
export async function searchCardsAction(q: string) {
  if (q.trim().length < 2) return [];
  return quickSearch(db, q, 15);
}
