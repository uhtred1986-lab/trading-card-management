/**
 * Persistent scan batches: photos + detections + review edits live in the
 * database while a batch is open, so a scan started on the phone can be
 * reviewed and confirmed on the PC. Completing a batch writes the lots and
 * drops the photo bytes; discarding drops everything.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, decks, ownedCards, scanBatches, scanItems, scanPhotos } from "@/db/schema";
import type { ScanCandidate, ScanDetection } from "@/lib/ai/scan";
import { addCardsToDeck } from "@/lib/decks/add";
import { expand } from "@/lib/collection/lots";
import { REVIEW_THRESHOLD } from "@/lib/ai/scan-match";

export type ScanMode = "single" | "batch";

export interface ScanPhotoMeta {
  id: number;
  batchId: number;
  position: number;
  width: number;
  height: number;
  status: "reading" | "done" | "error";
  error: string | null;
  found: number | null;
  unreadable: number | null;
}

export interface ScanItemRow {
  id: number;
  batchId: number;
  photoId: number;
  idx: number;
  detection: ScanDetection;
  chosen: ScanCandidate | null;
  manual: boolean;
  printId: string | null;
  quantity: number;
  condition: string;
  finish: string;
  include: boolean;
}

export interface ScanBatchSummary {
  id: number;
  name: string;
  mode: ScanMode;
  deckId: number | null;
  deckName: string | null;
  owner: string | null;
  createdAt: Date;
  updatedAt: Date;
  photos: number;
  items: number;
  needsReview: number;
  ready: number;
}

/** Same rule the review UI uses to flag a row. */
export function itemNeedsReview(i: Pick<ScanItemRow, "chosen" | "manual" | "detection">): boolean {
  return !i.chosen || (!i.manual && i.detection.matchConfidence < REVIEW_THRESHOLD);
}

function defaultName(now = new Date()): string {
  return `Scan ${now.toISOString().slice(0, 10)} ${now.toISOString().slice(11, 16)}`;
}

export async function createBatch(db: Db, mode: ScanMode, deckId: number | null = null, owner: string | null = null): Promise<number> {
  const [row] = await db.insert(scanBatches).values({ name: defaultName(), mode, deckId, owner }).returning({ id: scanBatches.id });
  return row.id;
}

export async function setBatchOwner(db: Db, batchId: number, owner: string | null): Promise<void> {
  await db.update(scanBatches).set({ owner: owner?.trim() || null, updatedAt: new Date() }).where(eq(scanBatches.id, batchId));
}

export async function setBatchDeck(db: Db, batchId: number, deckId: number | null): Promise<void> {
  await db.update(scanBatches).set({ deckId, updatedAt: new Date() }).where(eq(scanBatches.id, batchId));
}

export async function listOpenBatches(db: Db): Promise<ScanBatchSummary[]> {
  const batches = await db
    .select({ id: scanBatches.id, name: scanBatches.name, mode: scanBatches.mode, deckId: scanBatches.deckId, deckName: decks.name, owner: scanBatches.owner, createdAt: scanBatches.createdAt, updatedAt: scanBatches.updatedAt })
    .from(scanBatches)
    .leftJoin(decks, eq(decks.id, scanBatches.deckId))
    .where(eq(scanBatches.status, "open"))
    .orderBy(desc(scanBatches.updatedAt));
  if (batches.length === 0) return [];
  const ids = batches.map((b) => b.id);
  const [photoCounts, items] = await Promise.all([
    db
      .select({ batchId: scanPhotos.batchId, n: sql<number>`count(*)::int` })
      .from(scanPhotos)
      .where(inArray(scanPhotos.batchId, ids))
      .groupBy(scanPhotos.batchId),
    db
      .select({ batchId: scanItems.batchId, chosen: scanItems.chosen, manual: scanItems.manual, detection: scanItems.detection, include: scanItems.include, printId: scanItems.printId, quantity: scanItems.quantity })
      .from(scanItems)
      .where(inArray(scanItems.batchId, ids)),
  ]);
  const photos = new Map(photoCounts.map((p) => [p.batchId, p.n]));
  return batches.map((b) => {
    const mine = items.filter((i) => i.batchId === b.id);
    return {
      id: b.id,
      name: b.name,
      mode: b.mode as ScanMode,
      deckId: b.deckId,
      deckName: b.deckName,
      owner: b.owner,
      createdAt: b.createdAt,
      updatedAt: b.updatedAt,
      photos: photos.get(b.id) ?? 0,
      items: mine.length,
      needsReview: mine.filter((i) => itemNeedsReview({ chosen: i.chosen as ScanCandidate | null, manual: i.manual, detection: i.detection as ScanDetection })).length,
      ready: mine.filter((i) => i.include && i.printId).reduce((n, i) => n + i.quantity, 0),
    };
  });
}

export async function getBatch(db: Db, id: number): Promise<{ batch: { id: number; name: string; mode: ScanMode; status: string; deckId: number | null; owner: string | null }; photos: ScanPhotoMeta[]; items: ScanItemRow[] } | null> {
  const batch = await db.query.scanBatches.findFirst({ where: eq(scanBatches.id, id) });
  if (!batch) return null;
  const [photos, items] = await Promise.all([
    db
      .select({
        id: scanPhotos.id,
        batchId: scanPhotos.batchId,
        position: scanPhotos.position,
        width: scanPhotos.width,
        height: scanPhotos.height,
        status: scanPhotos.status,
        error: scanPhotos.error,
        found: scanPhotos.found,
        unreadable: scanPhotos.unreadable,
      })
      .from(scanPhotos)
      .where(eq(scanPhotos.batchId, id))
      .orderBy(asc(scanPhotos.position), asc(scanPhotos.id)),
    db.select().from(scanItems).where(eq(scanItems.batchId, id)).orderBy(asc(scanItems.photoId), asc(scanItems.idx)),
  ]);
  return {
    batch: { id: batch.id, name: batch.name, mode: batch.mode as ScanMode, status: batch.status, deckId: batch.deckId, owner: batch.owner },
    photos: photos.map((p) => ({ ...p, status: p.status as ScanPhotoMeta["status"] })),
    items: items.map(rowToItem),
  };
}

function rowToItem(r: typeof scanItems.$inferSelect): ScanItemRow {
  return {
    id: r.id,
    batchId: r.batchId,
    photoId: r.photoId,
    idx: r.idx,
    detection: r.detection as ScanDetection,
    chosen: (r.chosen as ScanCandidate | null) ?? null,
    manual: r.manual,
    printId: r.printId,
    quantity: r.quantity,
    condition: r.condition,
    finish: r.finish,
    include: r.include,
  };
}

export async function photoBytes(db: Db, id: number): Promise<{ data: Buffer; batchId: number } | null> {
  const row = await db.query.scanPhotos.findFirst({ where: eq(scanPhotos.id, id), columns: { data: true, batchId: true } });
  return row?.data ? { data: row.data, batchId: row.batchId } : null;
}

/** Store the prepared image before identification so a retry never needs the phone again. */
export async function storePhoto(db: Db, batchId: number, position: number, data: Buffer, width: number, height: number): Promise<number> {
  const [row] = await db
    .insert(scanPhotos)
    .values({ batchId, position, data, width, height, status: "reading" })
    .returning({ id: scanPhotos.id });
  await touch(db, batchId);
  return row.id;
}

export async function markPhoto(db: Db, photoId: number, patch: { status: ScanPhotoMeta["status"]; error?: string | null; found?: number | null; unreadable?: number | null }): Promise<void> {
  await db.update(scanPhotos).set(patch).where(eq(scanPhotos.id, photoId));
}

/** Replace a photo's items with fresh detections (used on first scan and on retry). */
export async function replaceItems(db: Db, batchId: number, photoId: number, detections: ScanDetection[]): Promise<ScanItemRow[]> {
  return db.transaction(async (tx) => {
    await tx.delete(scanItems).where(eq(scanItems.photoId, photoId));
    if (detections.length === 0) return [];
    const rows = await tx
      .insert(scanItems)
      .values(
        detections.map((d, idx) => {
          const best = d.candidates[0] ?? null;
          return {
            batchId,
            photoId,
            idx,
            detection: d,
            chosen: best,
            manual: false,
            printId: best?.prints[0]?.id ?? null,
            include: !!best,
          };
        }),
      )
      .returning();
    await tx.update(scanBatches).set({ updatedAt: new Date() }).where(eq(scanBatches.id, batchId));
    return rows.map(rowToItem);
  });
}

export type ItemPatch = Partial<Pick<ScanItemRow, "chosen" | "manual" | "printId" | "quantity" | "condition" | "finish" | "include">>;

export async function updateItem(db: Db, id: number, patch: ItemPatch): Promise<void> {
  const set: Partial<typeof scanItems.$inferInsert> = { updatedAt: new Date() };
  if ("chosen" in patch) set.chosen = patch.chosen ?? null;
  if (patch.manual !== undefined) set.manual = patch.manual;
  if ("printId" in patch) set.printId = patch.printId ?? null;
  if (patch.quantity !== undefined) set.quantity = Math.max(1, Math.floor(patch.quantity));
  if (patch.condition !== undefined) set.condition = patch.condition;
  if (patch.finish !== undefined) set.finish = patch.finish;
  if (patch.include !== undefined) set.include = patch.include;
  const [row] = await db.update(scanItems).set(set).where(eq(scanItems.id, id)).returning({ batchId: scanItems.batchId });
  if (row) await touch(db, row.batchId);
}

async function touch(db: Db, batchId: number): Promise<void> {
  await db.update(scanBatches).set({ updatedAt: new Date() }).where(eq(scanBatches.id, batchId));
}

/**
 * Write every included, linked item to the collection, then drop the photo
 * bytes and items. The batch row stays as a record of what was added.
 */
export async function completeBatch(db: Db, batchId: number, owner: string | null = null): Promise<{ added: number; deckAdded: number; deckId: number | null }> {
  return db.transaction(async (tx) => {
    const batch = await tx.query.scanBatches.findFirst({ where: eq(scanBatches.id, batchId), columns: { deckId: true, owner: true } });
    const lotOwner = batch?.owner ?? owner;
    const items = await tx.select().from(scanItems).where(and(eq(scanItems.batchId, batchId), eq(scanItems.include, true)));
    const printIds = [...new Set(items.map((i) => i.printId).filter((p): p is string => !!p))];
    const prints = printIds.length ? await tx.select({ id: cardPrints.id, cardId: cardPrints.cardId }).from(cardPrints).where(inArray(cardPrints.id, printIds)) : [];
    const cardOf = new Map(prints.map((p) => [p.id, p.cardId]));
    // A reviewed row saying "3" becomes three rows — one per physical card.
    const lots = items
      .filter((i) => i.printId && cardOf.has(i.printId))
      .flatMap((i) => expand({ printId: i.printId!, cardId: cardOf.get(i.printId!)!, condition: i.condition, finish: i.finish, owner: lotOwner }, i.quantity));
    if (lots.length) await tx.insert(ownedCards).values(lots);
    const added = lots.length;
    const deckId = batch?.deckId ?? null;
    const deckAdded = deckId && lots.length ? (await addCardsToDeck(tx as unknown as Db, deckId, lots.map((l) => ({ cardId: l.cardId, quantity: 1 })))).added : 0;
    await tx.delete(scanItems).where(eq(scanItems.batchId, batchId));
    await tx.update(scanPhotos).set({ data: null }).where(eq(scanPhotos.batchId, batchId));
    await tx.update(scanBatches).set({ status: "done", addedCount: added, completedAt: new Date(), updatedAt: new Date() }).where(eq(scanBatches.id, batchId));
    return { added, deckAdded, deckId };
  });
}

export async function deleteBatch(db: Db, batchId: number): Promise<void> {
  await db.delete(scanBatches).where(eq(scanBatches.id, batchId));
}
