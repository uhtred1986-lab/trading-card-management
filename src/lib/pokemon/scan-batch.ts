/**
 * A Pokémon binder page as a persisted scan batch (docs/pokemon/design.md §5), so a page started on
 * the phone can be finished on the PC. It reuses `scan_batches`, `scan_photos` and `scan_items`:
 *
 *  - the batch has `game = "pokemon"`; the Dragon Ball lists and actions look at `game = "dbs"` only;
 *  - the photo is stored before it is read (`storePhoto`), so a retry never needs the phone again;
 *  - an item's `detection` is the `PokemonScanDetection` (its candidates are live-source hits with
 *    name, set, number and image, so the review draws without a round trip), `chosen` the chosen hit,
 *    and `variant`, `language`, `quantity`, `include` the lot as it will be saved;
 *  - `printId` stays null (a Pokémon card has no local row until `ensurePokemonCard` stores it), and
 *    `saved_at` marks an item already written, so a repeated "save" never adds a card twice.
 *
 * Every function takes the `db` and the `Viewer`, so the scripts run it on PGlite. An id that is not
 * the viewer's answers `PokemonBatchNotFound` (an SL opens any), the same rule as the Dragon Ball
 * batches (`src/lib/auth/ownership.ts`). Nothing here calls a model: the read is `deps.read` and the
 * search `deps.search` of `identifyPokemonCards`.
 */
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { scanBatches, scanItems, scanPhotos } from "@/db/schema";
import { describeAiError } from "@/lib/ai/client";
import { prepareImage, type PreparedImage } from "@/lib/ai/scan";
import { AccessDenied, type Viewer } from "@/lib/auth";
import { assertOwnBatch } from "@/lib/auth/ownership";
import { MAX_COPIES } from "@/lib/collection/lots";
import { markPhoto, photoBytes, storePhoto } from "@/lib/scan/batches";
import { addPokemonLots, type PokemonLotLanguage } from "./collection";
import { variantFromFinish } from "./scan-match";
import { identifyPokemonCards, type PokemonScanDeps, type PokemonScanDetection } from "./scan";
import type { loadPokemonCard } from "./store";
import { POKEMON_VARIANTS, type PokemonHit, type PokemonVariant } from "./types";

/** What an id that is not the viewer's, or not a Pokémon batch, answers. The message is a German sentence the screen can show. */
export class PokemonBatchNotFound extends Error {
  constructor(message = "Diese Seite gibt es nicht.") {
    super(message);
    this.name = "PokemonBatchNotFound";
  }
}

export type PokemonItemState = "confirmed" | "check" | "skipped" | "saved";

export interface PokemonBatchItem {
  id: number;
  photoId: number;
  idx: number;
  detection: PokemonScanDetection;
  chosen: PokemonHit | null;
  /** The child (or the read) said yes. */
  include: boolean;
  /** Picked by hand, so it is as good as confirmed. */
  manual: boolean;
  /** Null until a variant is known (the card's variants are read when the cell is opened). */
  variant: PokemonVariant | null;
  language: PokemonLotLanguage;
  quantity: number;
  saved: boolean;
}

export interface PokemonBatchPhoto {
  id: number;
  position: number;
  width: number;
  height: number;
  status: "reading" | "done" | "error";
  error: string | null;
  found: number | null;
  unreadable: number | null;
}

export interface PokemonBatchState {
  batch: { id: number; name: string; deckId: number | null; owner: string | null; status: "open" | "done"; updatedAt: string };
  photos: PokemonBatchPhoto[];
  items: PokemonBatchItem[];
}

export interface PokemonBatchOffer {
  id: number;
  /** Cards still to save (not saved, not left out by hand). */
  cards: number;
  photos: number;
  updatedAt: string;
}

/** The state of one item as the grid draws it. */
export function itemState(i: Pick<PokemonBatchItem, "saved" | "chosen" | "include">): PokemonItemState {
  if (i.saved) return "saved";
  if (!i.chosen) return "check";
  return i.include ? "confirmed" : "skipped";
}

const rowToItem = (r: typeof scanItems.$inferSelect): PokemonBatchItem => ({
  id: r.id,
  photoId: r.photoId,
  idx: r.idx,
  detection: r.detection as PokemonScanDetection,
  chosen: (r.chosen as PokemonHit | null) ?? null,
  include: r.include,
  manual: r.manual,
  variant: r.variant && (POKEMON_VARIANTS as readonly string[]).includes(r.variant) ? (r.variant as PokemonVariant) : null,
  language: r.language === "EN" ? "EN" : "DE",
  quantity: r.quantity,
  saved: r.savedAt !== null,
});

const ownerIs = (owner: string | null) => (owner === null ? isNull(scanBatches.owner) : eq(scanBatches.owner, owner));

/** The Pokémon batch `batchId`, if it is the viewer's (an SL: any) and is a Pokémon batch. Otherwise `PokemonBatchNotFound`. */
async function requireBatch(db: Db, viewer: Viewer, batchId: number) {
  if (!Number.isInteger(batchId)) throw new PokemonBatchNotFound();
  try {
    await assertOwnBatch(viewer, batchId, db);
  } catch (e) {
    if (e instanceof AccessDenied) throw new PokemonBatchNotFound();
    throw e;
  }
  const row = await db.query.scanBatches.findFirst({ where: and(eq(scanBatches.id, batchId), eq(scanBatches.game, "pokemon")) });
  if (!row) throw new PokemonBatchNotFound();
  return row;
}

async function requireItem(db: Db, viewer: Viewer, itemId: number) {
  const row = Number.isInteger(itemId) ? await db.query.scanItems.findFirst({ where: eq(scanItems.id, itemId) }) : undefined;
  if (!row) throw new PokemonBatchNotFound();
  const batch = await requireBatch(db, viewer, row.batchId);
  return { item: row, batch };
}

/** A photo's batch, checked the same way. */
async function requirePhoto(db: Db, viewer: Viewer, photoId: number) {
  const row = Number.isInteger(photoId) ? await db.query.scanPhotos.findFirst({ where: eq(scanPhotos.id, photoId), columns: { id: true, batchId: true } }) : undefined;
  if (!row) throw new PokemonBatchNotFound();
  return { photo: row, batch: await requireBatch(db, viewer, row.batchId) };
}

async function touch(db: Db, batchId: number) {
  await db.update(scanBatches).set({ updatedAt: new Date() }).where(eq(scanBatches.id, batchId));
}

/** The viewer's own newest open Pokémon batch, or null. (An SL's list is also their own: they open another's by id.) */
export async function findOpenPokemonBatch(db: Db, viewer: Viewer): Promise<number | null> {
  const [row] = await db
    .select({ id: scanBatches.id })
    .from(scanBatches)
    .where(and(eq(scanBatches.game, "pokemon"), eq(scanBatches.status, "open"), ownerIs(viewer.owner)))
    .orderBy(desc(scanBatches.updatedAt), desc(scanBatches.id))
    .limit(1);
  return row?.id ?? null;
}

/** "Du hast noch eine angefangene Seite": the viewer's open Pokémon batch that has something in it, or null. */
export async function pokemonBatchOffer(db: Db, viewer: Viewer): Promise<PokemonBatchOffer | null> {
  const id = await findOpenPokemonBatch(db, viewer);
  if (id === null) return null;
  const [photos, items] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(scanPhotos).where(eq(scanPhotos.batchId, id)),
    db.select({ include: scanItems.include, chosen: scanItems.chosen, savedAt: scanItems.savedAt }).from(scanItems).where(eq(scanItems.batchId, id)),
  ]);
  const cards = items.filter((i) => i.savedAt === null).length;
  const batch = await db.query.scanBatches.findFirst({ where: eq(scanBatches.id, id), columns: { updatedAt: true } });
  // A batch with a photo that failed or found nothing is still worth continuing (the photo is stored); an empty one is not offered.
  if (cards === 0 && Number(photos[0]?.n ?? 0) === 0) return null;
  return { id, cards, photos: Number(photos[0]?.n ?? 0), updatedAt: (batch?.updatedAt ?? new Date()).toISOString() };
}

/** The viewer's open Pokémon batch, or a new one. `deckId` is kept on a new batch only. */
export async function ensurePokemonBatch(db: Db, viewer: Viewer, deckId: number | null = null): Promise<number> {
  const open = await findOpenPokemonBatch(db, viewer);
  if (open !== null) return open;
  const now = new Date();
  const name = `Seite ${now.toISOString().slice(0, 10)} ${now.toISOString().slice(11, 16)}`;
  const [row] = await db.insert(scanBatches).values({ name, game: "pokemon", mode: "batch", deckId, owner: viewer.owner }).returning({ id: scanBatches.id });
  return row.id;
}

/** The whole batch as the review screen needs it. */
export async function getPokemonBatch(db: Db, viewer: Viewer, batchId: number): Promise<PokemonBatchState> {
  const batch = await requireBatch(db, viewer, batchId);
  const [photos, items] = await Promise.all([
    db
      .select({ id: scanPhotos.id, position: scanPhotos.position, width: scanPhotos.width, height: scanPhotos.height, status: scanPhotos.status, error: scanPhotos.error, found: scanPhotos.found, unreadable: scanPhotos.unreadable })
      .from(scanPhotos)
      .where(eq(scanPhotos.batchId, batchId))
      .orderBy(asc(scanPhotos.position), asc(scanPhotos.id)),
    db.select().from(scanItems).where(eq(scanItems.batchId, batchId)).orderBy(asc(scanItems.photoId), asc(scanItems.idx)),
  ]);
  return {
    batch: { id: batch.id, name: batch.name, deckId: batch.deckId, owner: batch.owner, status: batch.status === "done" ? "done" : "open", updatedAt: batch.updatedAt.toISOString() },
    photos: photos.map((p) => ({ ...p, status: p.status as PokemonBatchPhoto["status"] })),
    items: items.map(rowToItem),
  };
}

export async function setPokemonBatchDeck(db: Db, viewer: Viewer, batchId: number, deckId: number | null): Promise<void> {
  await requireBatch(db, viewer, batchId);
  await db.update(scanBatches).set({ deckId, updatedAt: new Date() }).where(eq(scanBatches.id, batchId));
}

/** A new photo for the batch: stored before it is read, so a failed read can be retried from the database. */
export async function addPokemonPhoto(db: Db, viewer: Viewer, batchId: number, image: Buffer | PreparedImage): Promise<{ photoId: number; prepared: PreparedImage }> {
  const batch = await requireBatch(db, viewer, batchId);
  if (batch.status !== "open") throw new PokemonBatchNotFound();
  const prepared = Buffer.isBuffer(image) ? await prepareImage(image) : image;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(scanPhotos).where(eq(scanPhotos.batchId, batchId));
  const photoId = await storePhoto(db, batchId, Number(n), prepared.buffer, prepared.width, prepared.height);
  return { photoId, prepared };
}

/** The first variant guess from what the model saw; refined by the card's real variants when the cell is opened. */
function startVariant(d: PokemonScanDetection): PokemonVariant | null {
  const f = d.seen.finish;
  return f === "holo" || f === "reverse" ? variantFromFinish(f, [...POKEMON_VARIANTS]) : null;
}

/** Replace a photo's unsaved items with fresh detections (first read and retry). Saved items stay. */
export async function replacePokemonItems(db: Db, batchId: number, photoId: number, detections: PokemonScanDetection[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(scanItems).where(and(eq(scanItems.photoId, photoId), isNull(scanItems.savedAt)));
    if (detections.length > 0) {
      await tx.insert(scanItems).values(
        detections.map((d, idx) => ({
          batchId,
          photoId,
          idx,
          detection: d,
          chosen: d.best,
          manual: false,
          printId: null,
          // Exact and likely reads start confirmed; an unsure read has no choice and waits for a tap.
          include: !!d.best,
          variant: startVariant(d),
          language: d.seen.language ?? "DE",
          quantity: 1,
        })),
      );
    }
    await tx.update(scanBatches).set({ updatedAt: new Date() }).where(eq(scanBatches.id, batchId));
  });
}

/**
 * Read a stored photo and keep what was read. The photo is marked `done` or `error` (with a German
 * sentence), so the screen shows a retry on a photo that failed. Never throws for a failed read.
 */
export async function readPokemonPhoto(db: Db, viewer: Viewer, photoId: number, deps: Partial<PokemonScanDeps> = {}): Promise<PokemonBatchState> {
  const { photo } = await requirePhoto(db, viewer, photoId);
  const stored = await photoBytes(db, photoId);
  if (!stored) throw new PokemonBatchNotFound("Das Foto ist nicht mehr gespeichert.");
  await markPhoto(db, photoId, { status: "reading", error: null });
  try {
    const { detections, unreadable } = await identifyPokemonCards(db, stored.data, "batch", deps);
    await replacePokemonItems(db, photo.batchId, photoId, detections);
    await markPhoto(db, photoId, { status: "done", error: null, found: detections.length, unreadable });
  } catch (err) {
    await markPhoto(db, photoId, { status: "error", error: describeAiError(err) });
  }
  return getPokemonBatch(db, viewer, photo.batchId);
}

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * The request behind `POST /api/pokemon/scan/batch` (multipart): `image` (a new photo) and optional
 * `batchId` (else the viewer's open batch, else a new one), or `photoId` (retry of a stored photo).
 * Answers `{ batchId, photoId, state }`; a failed read is a 200 with the photo marked `error`, since
 * the photo is stored and the screen offers the retry.
 */
export async function handlePokemonBatchScan(req: Request, db: Db, viewer: Viewer, deps: Partial<PokemonScanDeps> = {}): Promise<Response> {
  const available = deps.available ?? (await import("@/lib/ai/client")).hasAnthropic;
  if (!available()) return Response.json({ error: "ANTHROPIC_API_KEY is not set." }, { status: 503 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "No image uploaded." }, { status: 400 });
  }
  try {
    const retry = Number(form.get("photoId")) || null;
    let photoId: number;
    if (retry) {
      await requirePhoto(db, viewer, retry);
      photoId = retry;
    } else {
      const file = form.get("image");
      if (!(file instanceof File)) return Response.json({ error: "No image uploaded." }, { status: 400 });
      if (file.size > MAX_BYTES) return Response.json({ error: "Image is larger than 20 MB." }, { status: 413 });
      const asked = form.get("batchId");
      const batchId = asked !== null && asked !== "" ? Number(asked) : await ensurePokemonBatch(db, viewer);
      let stored;
      try {
        stored = await addPokemonPhoto(db, viewer, batchId, Buffer.from(await file.arrayBuffer()));
      } catch (e) {
        if (e instanceof PokemonBatchNotFound) throw e;
        return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
      }
      photoId = stored.photoId;
    }
    const state = await readPokemonPhoto(db, viewer, photoId, deps);
    return Response.json({ batchId: state.batch.id, photoId, state }, { headers: { "cache-control": "private, no-store" } });
  } catch (e) {
    if (e instanceof PokemonBatchNotFound) return Response.json({ error: "Not found." }, { status: 404 });
    return Response.json({ error: describeAiError(e) }, { status: 502 });
  }
}

export interface PokemonItemPatch {
  /** A card picked by hand (or null to clear). Picking one confirms the cell. */
  chosen?: PokemonHit | null;
  include?: boolean;
  variant?: PokemonVariant;
  language?: PokemonLotLanguage;
  quantity?: number;
}

/** One edit of one cell. A saved item cannot be edited. */
export async function updatePokemonItem(db: Db, viewer: Viewer, itemId: number, patch: PokemonItemPatch): Promise<PokemonBatchItem> {
  const { item } = await requireItem(db, viewer, itemId);
  if (item.savedAt !== null) throw new PokemonBatchNotFound("Diese Karte ist schon gespeichert.");
  const set: Partial<typeof scanItems.$inferInsert> = { updatedAt: new Date() };
  if ("chosen" in patch) {
    set.chosen = patch.chosen ?? null;
    set.manual = !!patch.chosen;
    if (patch.chosen) set.include = true;
    if (!patch.chosen) set.include = false;
    // A different card has different variants: the screen sets the right one next.
    if (patch.chosen && (item.chosen as PokemonHit | null)?.tcgdexId !== patch.chosen.tcgdexId) set.variant = null;
  }
  if (patch.include !== undefined) set.include = patch.include && !!(("chosen" in patch ? patch.chosen : item.chosen) ?? null);
  if (patch.variant !== undefined) {
    if (!(POKEMON_VARIANTS as readonly string[]).includes(patch.variant)) throw new Error("Unbekannte Variante.");
    set.variant = patch.variant;
  }
  if (patch.language !== undefined) {
    if (patch.language !== "DE" && patch.language !== "EN") throw new Error("Sprache: DE oder EN.");
    set.language = patch.language;
  }
  if (patch.quantity !== undefined) set.quantity = Math.min(MAX_COPIES, Math.max(1, Math.floor(Number(patch.quantity)) || 1));
  const [row] = await db.update(scanItems).set(set).where(eq(scanItems.id, itemId)).returning();
  await touch(db, item.batchId);
  return rowToItem(row);
}

export interface PokemonCompleteResult {
  /** Cards (copies) written to the collection by this call. */
  added: number;
  deckAdded: number;
  deckId: number | null;
  /** Items that could not be saved; the batch stays open with them. */
  failed: { itemId: number; name: string; message: string }[];
  /** The batch is closed and its photos are gone. */
  done: boolean;
}

/**
 * Save every confirmed, unsaved item through the Pokémon add path (`addPokemonLots`: `ensurePokemonCard`
 * and one lot per copy, stamped with the batch owner, with the variant and language, and the batch's
 * deck when one was chosen). An item is claimed (`saved_at`) before it is written and released when the
 * write fails, so two taps never add a card twice. When nothing failed the batch is closed and the
 * photo bytes are dropped; the items stay, marked saved, as a record.
 */
export async function completePokemonBatch(db: Db, viewer: Viewer, batchId: number, deps: { load?: typeof loadPokemonCard } = {}): Promise<PokemonCompleteResult> {
  const batch = await requireBatch(db, viewer, batchId);
  if (batch.status !== "open") throw new PokemonBatchNotFound("Diese Seite ist schon gespeichert.");
  // The copies belong to the batch's owner, whoever completes it (an SL finishing a player's page).
  const asOwner = { ...viewer, owner: batch.owner } as Viewer;
  const todo = await db
    .select()
    .from(scanItems)
    .where(and(eq(scanItems.batchId, batchId), eq(scanItems.include, true), isNull(scanItems.savedAt)))
    .orderBy(asc(scanItems.photoId), asc(scanItems.idx));
  let added = 0;
  let deckAdded = 0;
  const failed: PokemonCompleteResult["failed"] = [];
  for (const it of todo) {
    const hit = it.chosen as PokemonHit | null;
    if (!hit) continue;
    const claimed = await db.update(scanItems).set({ savedAt: new Date() }).where(and(eq(scanItems.id, it.id), isNull(scanItems.savedAt))).returning({ id: scanItems.id });
    if (claimed.length === 0) continue; // another tap got there first
    try {
      const r = await addPokemonLots(
        db,
        asOwner,
        { tcgdexId: hit.tcgdexId, variant: rowToItem(it).variant ?? "normal", language: rowToItem(it).language, quantity: it.quantity, deckId: batch.deckId },
        deps,
      );
      added += r.added;
      deckAdded += r.deckAdded;
    } catch (e) {
      await db.update(scanItems).set({ savedAt: null }).where(eq(scanItems.id, it.id));
      failed.push({ itemId: it.id, name: hit.name, message: e instanceof Error && e.message ? e.message : "Das hat nicht geklappt." });
    }
  }
  let done = false;
  if (failed.length === 0) {
    const [{ total }] = await db.select({ total: sql<number>`coalesce(sum(${scanItems.quantity}) filter (where ${scanItems.savedAt} is not null), 0)::int` }).from(scanItems).where(eq(scanItems.batchId, batchId));
    await db.update(scanPhotos).set({ data: null }).where(eq(scanPhotos.batchId, batchId));
    await db.update(scanBatches).set({ status: "done", addedCount: Number(total ?? 0), completedAt: new Date(), updatedAt: new Date() }).where(eq(scanBatches.id, batchId));
    done = true;
  } else {
    await touch(db, batchId);
  }
  return { added, deckAdded, deckId: batch.deckId, failed, done };
}

/** Throw the whole page away: photos and items go with the batch. */
export async function discardPokemonBatch(db: Db, viewer: Viewer, batchId: number): Promise<void> {
  await requireBatch(db, viewer, batchId);
  await db.delete(scanBatches).where(eq(scanBatches.id, batchId));
}
