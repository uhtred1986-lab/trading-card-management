/**
 * Where cards physically are. A short list you maintain yourself — "Binder 1",
 * "Trade box", "Deck shelf" — attached to individual copies so a card can be
 * found without turning the shelf out.
 *
 * Locations are archived rather than deleted when they fall out of use, so the
 * copies still say where they were last kept.
 */
import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { decks, ownedCards, storageLocations } from "@/db/schema";

export interface StorageLocation {
  id: number;
  name: string;
  note: string | null;
  isArchived: boolean;
  sortKey: number;
  /** How many physical cards are kept there. */
  cards: number;
  /** How many built or planned decks live there. */
  decks: number;
}

export async function listLocations(db: Db, includeArchived = true): Promise<StorageLocation[]> {
  // Counted with a plain grouped query rather than a correlated subquery in a
  // `sql` template — that renders without the correlation and returns 0 for all.
  const [places, counts, deckCounts] = await Promise.all([
    db
      .select({ id: storageLocations.id, name: storageLocations.name, note: storageLocations.note, isArchived: storageLocations.isArchived, sortKey: storageLocations.sortKey })
      .from(storageLocations)
      .orderBy(asc(storageLocations.sortKey), asc(storageLocations.name)),
    db
      .select({ locationId: ownedCards.locationId, n: sql<number>`count(*)::int` })
      .from(ownedCards)
      .groupBy(ownedCards.locationId),
    db
      .select({ locationId: decks.locationId, n: sql<number>`count(*)::int` })
      .from(decks)
      .groupBy(decks.locationId),
  ]);
  const held = new Map(counts.map((c) => [c.locationId, c.n]));
  const decked = new Map(deckCounts.map((c) => [c.locationId, c.n]));
  const rows = places.map((p) => ({ ...p, cards: held.get(p.id) ?? 0, decks: decked.get(p.id) ?? 0 }));
  return includeArchived ? rows : rows.filter((r) => !r.isArchived);
}

export async function createLocation(db: Db, name: string, note: string | null): Promise<StorageLocation | null> {
  const clean = name.trim().slice(0, 80);
  if (!clean) return null;
  const [row] = await db
    .insert(storageLocations)
    .values({ name: clean, note: note?.trim() || null })
    .onConflictDoNothing({ target: storageLocations.name })
    .returning({ id: storageLocations.id, name: storageLocations.name, note: storageLocations.note, isArchived: storageLocations.isArchived, sortKey: storageLocations.sortKey });
  return row ? { ...row, cards: 0, decks: 0 } : null;
}

export async function updateLocation(db: Db, id: number, patch: { name?: string; note?: string | null; isArchived?: boolean; sortKey?: number }): Promise<void> {
  const set: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const clean = patch.name.trim().slice(0, 80);
    if (clean) set.name = clean;
  }
  if (patch.note !== undefined) set.note = patch.note?.trim() || null;
  if (patch.isArchived !== undefined) set.isArchived = patch.isArchived;
  if (patch.sortKey !== undefined) set.sortKey = patch.sortKey;
  if (Object.keys(set).length === 0) return;
  await db.update(storageLocations).set(set).where(eq(storageLocations.id, id));
}

/** Copies kept there fall back to "no location" rather than being deleted. */
export async function deleteLocation(db: Db, id: number): Promise<void> {
  await db.delete(storageLocations).where(eq(storageLocations.id, id));
}

export async function setCopyLocations(db: Db, lotIds: number[], locationId: number | null): Promise<string[]> {
  if (lotIds.length === 0) return [];
  const rows = await db
    .update(ownedCards)
    .set({ locationId, updatedAt: new Date() })
    .where(inArray(ownedCards.id, lotIds))
    .returning({ cardId: ownedCards.cardId });
  return rows.map((r) => r.cardId);
}
