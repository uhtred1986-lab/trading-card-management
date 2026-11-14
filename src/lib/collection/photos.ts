/**
 * A person's own photo of a card, shown in place of the catalog picture
 * (docs/architecture/collection-and-decks.md, "Own card photos"). Works for
 * every game. One photo per print and owner; the browser shrinks it first
 * (`PhotoOverride`), the server only enforces the limits below.
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPhotos, cardPrints } from "@/db/schema";
import type { OwnerScope } from "./scope";

/** The largest photo the server stores (the browser aims for 60 to 100 KB). */
export const MAX_PHOTO_BYTES = 400 * 1024;
/**
 * Photos one owner may keep. At about 100 KB each that is roughly 100 MB of
 * the shared Neon database per person, which is the budget this feature is
 * allowed; beyond it the owner removes one before adding another.
 */
export const MAX_PHOTOS_PER_OWNER = 1000;
export const PHOTO_MIMES = ["image/webp", "image/jpeg"] as const;

export type CardPhotoErrorCode = "too_large" | "bad_mime" | "limit" | "no_print" | "empty";

export class CardPhotoError extends Error {
  readonly code: CardPhotoErrorCode;
  constructor(code: CardPhotoErrorCode, message: string) {
    super(message);
    this.name = "CardPhotoError";
    this.code = code;
  }
}

const ownerIs = (owner: string | null) => (owner === null ? sql`${cardPhotos.owner} is null` : eq(cardPhotos.owner, owner));

/** Stores `data` as the owner's photo of the print, replacing any earlier one (the id changes, so a cached URL is never stale). */
export async function saveCardPhoto(db: Db, input: { printId: string; owner: string | null; data: Buffer; mime: string }): Promise<number> {
  const { printId, owner, data, mime } = input;
  if (!(PHOTO_MIMES as readonly string[]).includes(mime)) throw new CardPhotoError("bad_mime", "Only WebP or JPEG photos are accepted.");
  if (data.length === 0) throw new CardPhotoError("empty", "The photo is empty.");
  if (data.length > MAX_PHOTO_BYTES) throw new CardPhotoError("too_large", `The photo is over ${MAX_PHOTO_BYTES / 1024} KB.`);
  const [print] = await db.select({ cardId: cardPrints.cardId }).from(cardPrints).where(eq(cardPrints.id, printId)).limit(1);
  if (!print) throw new CardPhotoError("no_print", "Unknown print.");

  return db.transaction(async (tx) => {
    const deleted = await tx
      .delete(cardPhotos)
      .where(and(eq(cardPhotos.printId, printId), ownerIs(owner)))
      .returning({ id: cardPhotos.id });
    if (deleted.length === 0) {
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(cardPhotos).where(ownerIs(owner));
      if (Number(n?.n ?? 0) >= MAX_PHOTOS_PER_OWNER) throw new CardPhotoError("limit", `At most ${MAX_PHOTOS_PER_OWNER} own photos; remove one first.`);
    }
    const [row] = await tx.insert(cardPhotos).values({ printId, cardId: print.cardId, owner, data, mime, bytes: data.length }).returning({ id: cardPhotos.id });
    return row.id;
  });
}

export async function deleteCardPhoto(db: Db, input: { printId: string; owner: string | null }): Promise<void> {
  await db.delete(cardPhotos).where(and(eq(cardPhotos.printId, input.printId), ownerIs(input.owner)));
}

const scopeWhere = (scope: OwnerScope) => (scope === undefined ? undefined : ownerIs(scope));

/**
 * Photo ids for the given prints and cards, as the looker may see them: a
 * player (scope = their owner name) only their own, an SL (`undefined`) every
 * owner's. When several exist for one print the `prefer` owner's (the SL's
 * own) wins, else the newest. `byCard` is the best photo of any print of that card.
 */
export async function cardPhotoIds(
  db: Db,
  scope: OwnerScope,
  want: { printIds?: string[]; cardIds?: string[]; prefer?: string | null },
): Promise<{ byPrint: Map<string, number>; byCard: Map<string, number> }> {
  const byPrint = new Map<string, number>();
  const byCard = new Map<string, number>();
  const printIds = [...new Set(want.printIds ?? [])];
  const cardIds = [...new Set(want.cardIds ?? [])];
  if (printIds.length === 0 && cardIds.length === 0) return { byPrint, byCard };
  const match = or(printIds.length ? inArray(cardPhotos.printId, printIds) : undefined, cardIds.length ? inArray(cardPhotos.cardId, cardIds) : undefined);
  const rows = await db
    .select({ id: cardPhotos.id, printId: cardPhotos.printId, cardId: cardPhotos.cardId, owner: cardPhotos.owner })
    .from(cardPhotos)
    .where(and(scopeWhere(scope), match));
  // Best first: the preferred owner's, then the newest (highest id).
  const rank = (r: { id: number; owner: string | null }) => (want.prefer !== undefined && r.owner === want.prefer ? 1e12 : 0) + r.id;
  rows.sort((a, b) => rank(b) - rank(a));
  for (const r of rows) {
    if (!byPrint.has(r.printId)) byPrint.set(r.printId, r.id);
    if (!byCard.has(r.cardId)) byCard.set(r.cardId, r.id);
  }
  return { byPrint, byCard };
}

/** The photo's bytes when the looker may see it, else null (the route answers 404 either way). */
export async function readCardPhoto(db: Db, id: number, scope: OwnerScope): Promise<{ data: Buffer; mime: string } | null> {
  if (!Number.isInteger(id)) return null;
  const [row] = await db
    .select({ data: cardPhotos.data, mime: cardPhotos.mime })
    .from(cardPhotos)
    .where(and(eq(cardPhotos.id, id), scopeWhere(scope)))
    .limit(1);
  return row ?? null;
}
