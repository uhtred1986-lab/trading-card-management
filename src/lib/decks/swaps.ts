/**
 * Persisted swap suggestions.
 *
 * The improvement wizard is a paid, slow call, so its advice is stored and
 * shown inline under the card it proposes replacing, instead of being
 * re-generated every time the deck is opened. Suggestions expire after a week
 * — by then the collection and the meta have both moved — and expired rows are
 * swept whenever a deck's suggestions are read, so nothing needs a cron.
 */
import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cards, deckSwaps, wantList } from "@/db/schema";
import { allocationForCards } from "./reservations";

export const SUGGESTION_TTL_DAYS = 7;

export interface SwapSuggestion {
  id: number;
  outCardId: string;
  inCardId: string;
  inName: string;
  inImageUrl: string | null;
  inCardType: string;
  inColors: string[];
  outQuantity: number;
  inQuantity: number;
  rationale: string;
  priority: string;
  context: string | null;
  createdAt: Date;
  expiresAt: Date;
  /** Copies owned and not reserved by another built deck — a swap you can make now. */
  inOwned: number;
  inAvailable: number;
  /** Already on the want list. */
  wanted: boolean;
}

export interface StoredSwap {
  outCardId: string;
  inCardId: string;
  outQuantity: number;
  inQuantity: number;
  rationale: string;
  priority: string;
}

export async function saveSuggestions(db: Db, deckId: number, runId: number | null, context: string | null, swaps: StoredSwap[]): Promise<number> {
  if (swaps.length === 0) return 0;
  const expiresAt = new Date(Date.now() + SUGGESTION_TTL_DAYS * 86400_000);
  await db
    .insert(deckSwaps)
    .values(swaps.map((s) => ({ ...s, deckId, runId, context, expiresAt })))
    .onConflictDoUpdate({
      target: [deckSwaps.deckId, deckSwaps.outCardId, deckSwaps.inCardId],
      // A repeat of the same advice refreshes it rather than piling up.
      set: {
        rationale: sql`excluded.rationale`,
        priority: sql`excluded.priority`,
        outQuantity: sql`excluded.out_quantity`,
        inQuantity: sql`excluded.in_quantity`,
        context: sql`excluded.context`,
        runId: sql`excluded.run_id`,
        status: "open",
        createdAt: new Date(),
        expiresAt,
      },
    });
  return swaps.length;
}

async function sweep(db: Db): Promise<void> {
  await db.delete(deckSwaps).where(lt(deckSwaps.expiresAt, new Date()));
}

/** Open suggestions for a deck, keyed by the card they propose removing. */
export async function suggestionsForDeck(db: Db, deckId: number): Promise<Map<string, SwapSuggestion[]>> {
  await sweep(db);
  const rows = await db
    .select({
      id: deckSwaps.id,
      outCardId: deckSwaps.outCardId,
      inCardId: deckSwaps.inCardId,
      outQuantity: deckSwaps.outQuantity,
      inQuantity: deckSwaps.inQuantity,
      rationale: deckSwaps.rationale,
      priority: deckSwaps.priority,
      context: deckSwaps.context,
      createdAt: deckSwaps.createdAt,
      expiresAt: deckSwaps.expiresAt,
      inName: cards.name,
      inImageUrl: cards.imageUrl,
      inCardType: cards.cardType,
      inColors: cards.colors,
    })
    .from(deckSwaps)
    .innerJoin(cards, eq(cards.id, deckSwaps.inCardId))
    .where(and(eq(deckSwaps.deckId, deckId), eq(deckSwaps.status, "open")))
    .orderBy(asc(deckSwaps.outCardId), sql`case ${deckSwaps.priority} when 'high' then 0 when 'medium' then 1 else 2 end`, desc(deckSwaps.createdAt));
  if (rows.length === 0) return new Map();

  const [alloc, wanted] = await Promise.all([
    allocationForCards(db, [...new Set(rows.map((r) => r.inCardId))]),
    db.select({ cardId: wantList.cardId }).from(wantList),
  ]);
  const onList = new Set(wanted.map((w) => w.cardId));

  const out = new Map<string, SwapSuggestion[]>();
  for (const r of rows) {
    const a = alloc.get(r.inCardId);
    const list = out.get(r.outCardId) ?? [];
    list.push({ ...r, inOwned: a?.owned ?? 0, inAvailable: a?.available ?? 0, wanted: onList.has(r.inCardId) });
    out.set(r.outCardId, list);
  }
  return out;
}

export async function markSuggestion(db: Db, id: number, status: "applied" | "dismissed"): Promise<{ deckId: number } | null> {
  const [row] = await db.update(deckSwaps).set({ status }).where(eq(deckSwaps.id, id)).returning({ deckId: deckSwaps.deckId });
  return row ?? null;
}

/** Everything the wizard has said about this deck lately, for the summary line. */
export async function suggestionCount(db: Db, deckId: number): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(deckSwaps)
    .where(and(eq(deckSwaps.deckId, deckId), eq(deckSwaps.status, "open")));
  return row?.n ?? 0;
}

// ── want list ──────────────────────────────────────────────────────────────

export interface WantRow {
  id: number;
  cardId: string;
  quantity: number;
  note: string | null;
  deckId: number | null;
  name: string;
  imageUrl: string | null;
}

export async function addWant(db: Db, cardId: string, quantity: number, note: string | null, deckId: number | null): Promise<void> {
  await db
    .insert(wantList)
    .values({ cardId, quantity: Math.max(1, quantity), note, deckId })
    .onConflictDoUpdate({
      target: wantList.cardId,
      // Wanting it again means wanting more of it, not a second row.
      set: { quantity: sql`${wantList.quantity} + ${Math.max(1, quantity)}`, note: sql`coalesce(excluded.note, ${wantList.note})` },
    });
}

export async function removeWant(db: Db, cardId: string): Promise<void> {
  await db.delete(wantList).where(eq(wantList.cardId, cardId));
}

export async function listWants(db: Db): Promise<WantRow[]> {
  return db
    .select({
      id: wantList.id,
      cardId: wantList.cardId,
      quantity: wantList.quantity,
      note: wantList.note,
      deckId: wantList.deckId,
      name: cards.name,
      imageUrl: cards.imageUrl,
    })
    .from(wantList)
    .innerJoin(cards, eq(cards.id, wantList.cardId))
    .orderBy(desc(wantList.createdAt));
}
