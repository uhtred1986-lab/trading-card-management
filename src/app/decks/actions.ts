"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { cards, deckCards, decks } from "@/db/schema";
import { quickSearch } from "@/lib/catalog/queries";
import { DEFAULT_GAME, gameOr, type Game } from "@/lib/catalog/games";
import { decksForCard, parseDeckList, ZONES, type CardDeckMembership, type Zone } from "@/lib/decks/queries";
import { zoneForType, type DeckOption } from "@/lib/decks/add";
import { buildConflicts, type BuildConflict } from "@/lib/decks/reservations";
import { fileDeckAtLocation, type FilingResult } from "@/lib/decks/filing";

function revalidate(deckId?: number) {
  revalidatePath("/decks");
  revalidatePath("/collection");
  revalidatePath("/");
  if (deckId) revalidatePath(`/decks/${deckId}`);
}

/** Used by the DeckPicker on the add screens: create and return, no redirect. */
export async function createDeckAction(name: string, game: Game = DEFAULT_GAME): Promise<DeckOption> {
  const clean = name.trim().slice(0, 120) || "Untitled deck";
  const [row] = await db
    .insert(decks)
    .values({ name: clean, game: gameOr(game) })
    .returning({ id: decks.id, name: decks.name, isBuilt: decks.isBuilt, game: decks.game });
  revalidate();
  return { ...row, game: gameOr(row.game) };
}

export async function createDeckForm(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || "Untitled deck";
  const game = gameOr(formData.get("game"));
  const [row] = await db.insert(decks).values({ name, game }).returning({ id: decks.id });
  revalidate();
  redirect(`/decks/${row.id}`);
}

export async function updateDeck(id: number, patch: { name?: string; game?: Game; description?: string | null; metaNotes?: string | null; locationId?: number | null }) {
  await db
    .update(decks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(decks.id, id));
  // Moving a built deck to another box moves the cards in it.
  if (patch.locationId !== undefined) await fileDeckAtLocation(db, id);
  revalidate(id);
}

export async function updateDeckForm(formData: FormData) {
  const id = Number(formData.get("id"));
  await updateDeck(id, {
    name: String(formData.get("name") ?? "").trim() || "Untitled deck",
    // Switching games re-flags the cards already in the deck rather than
    // removing them; the deck page then shows what no longer belongs.
    game: gameOr(formData.get("game")),
    description: (formData.get("description") as string)?.trim() || null,
    metaNotes: (formData.get("metaNotes") as string)?.trim() || null,
  });
}

/**
 * Where the deck is kept. Saved on the spot rather than with the rest of the
 * settings form: an uncontrolled `<select defaultValue>` is re-applied by React
 * on every re-render, so a pick made before pressing Save was liable to snap
 * back to the old value — and then save it.
 *
 * Returns what the move did to the collection, because filing a built deck
 * quietly relocates every card in it.
 */
export async function setDeckLocationAction(deckId: number, locationId: number | null): Promise<FilingResult> {
  await db.update(decks).set({ locationId, updatedAt: new Date() }).where(eq(decks.id, deckId));
  const filing = await fileDeckAtLocation(db, deckId);
  revalidate(deckId);
  return filing;
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
    .values({ name: `${src.name} (copy)`, game: src.game, description: src.description, metaNotes: src.metaNotes })
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
  // A card added to a built deck joins it physically as well.
  await fileDeckAtLocation(db, deckId);
  revalidate(deckId);
  return { ok: true };
}

/** Flip built ↔ virtual. Building is blocked outright when the collection can't cover it. */
export async function setBuilt(deckId: number, built: boolean): Promise<{ ok: true; filing: FilingResult } | { ok: false; conflicts: BuildConflict[] }> {
  if (built) {
    const conflicts = await buildConflicts(db, deckId);
    if (conflicts.length) return { ok: false, conflicts };
  }
  await db
    .update(decks)
    .set({ isBuilt: built, builtAt: built ? new Date() : null, updatedAt: new Date() })
    .where(eq(decks.id, deckId));
  // The deck is now a physical object in a place, so its cards are there too.
  // Taking it apart leaves them filed: they don't move until you move them.
  const filing = await fileDeckAtLocation(db, deckId);
  revalidate(deckId);
  return { ok: true, filing };
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
  const deck = await db.query.decks.findFirst({ where: eq(decks.id, deckId), columns: { game: true } });
  const zone = zoneForType(card.cardType, gameOr(deck?.game));
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

/** Create a deck and drop this card straight into it, in the card's own game. */
export async function createDeckWithCardAction(cardId: string, name: string): Promise<CardDeckResult> {
  const card = await db.query.cards.findFirst({ where: eq(cards.id, cardId), columns: { game: true } });
  const deck = await createDeckAction(name, gameOr(card?.game));
  return addCardToDeckAction(cardId, deck.id);
}

/** Typeahead for the builder's search box, scoped to the deck's game. */
export async function searchCardsAction(q: string, game?: Game) {
  if (q.trim().length < 2) return [];
  return quickSearch(db, q, 15, undefined, game ? gameOr(game) : undefined);
}
