/**
 * A player's wishes, seen from the cart, and "mark as bought" (docs/pokemon/plan.md §8).
 *
 * Whose wants a looker may read: their own, and — for an SL — any player's. A player who names
 * another owner gets nothing back (not an error: a tampered URL meets an empty list). Every read
 * here takes the looker's `Viewer`; none trusts a name from the browser on its own.
 */
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardPrints, ctListings, ownedCards, players, wantList } from "@/db/schema";
import { AccessDenied, type Viewer } from "@/lib/auth";
import { ownerFor } from "@/lib/auth/ownership";
import { copiesOf, expand } from "@/lib/collection/lots";
import { listWants, type WantRow } from "@/lib/decks/swaps";
import { isPokemonCardId } from "@/lib/pokemon/types";
import { applyListingFilter, DEFAULT_LISTING_FILTER, languageCodeOf, type ListingFilter } from "./cart";

/** A source of wishes an SL can open in the cart: one player's list. */
export interface WishSource {
  /** The `want_list.owner` / `players.owner` name the list is stamped with. */
  owner: string;
  /** The player's name, for the label "Wishes of ‹name›". */
  name: string;
  /** Cards wished for (sum of quantities). */
  cards: number;
}

export const wishLabel = (name: string) => `Wishes of ${name}`;

/**
 * The players with wishes, for an SL: one entry per owner name (two players sharing a name are one
 * list), the viewer's own list left out (it is "my list"). A player gets nothing.
 */
export async function wishSources(db: Db, viewer: Viewer): Promise<WishSource[]> {
  if (viewer.kind !== "sl") return [];
  // Wishes first (one sum per owner), then the player's name for that owner: two players sharing an owner name do not double it.
  const wished = db
    .select({ owner: wantList.owner, cards: sql<number>`sum(${wantList.quantity})::int`.as("cards") })
    .from(wantList)
    .groupBy(wantList.owner)
    .as("wished");
  const found = await db
    .select({ owner: wished.owner, name: sql<string>`min(${players.name})`, cards: wished.cards })
    .from(wished)
    .innerJoin(players, eq(players.owner, wished.owner))
    .groupBy(wished.owner, wished.cards)
    .orderBy(sql`min(${players.name})`);
  return found.filter((r): r is typeof r & { owner: string } => r.owner !== null && Number(r.cards) > 0 && r.owner !== viewer.owner).map((r) => ({ owner: r.owner, name: r.name, cards: Number(r.cards) }));
}

/**
 * `owner`'s wishes as the viewer may see them. An SL may open any owner's list; a player only their
 * own (another name yields an empty list). The cart's own-list source stays `listWants`.
 */
export async function wishesOf(db: Db, viewer: Viewer, owner: string): Promise<WantRow[]> {
  const name = owner.trim();
  if (!name) return [];
  if (viewer.kind === "player" && viewer.owner !== name) return [];
  return listWants(db, name, false);
}

/** The name an SL sees a wish list under, or null when no such player has wishes. */
export async function wishSourceFor(db: Db, viewer: Viewer, owner: string): Promise<WishSource | null> {
  return (await wishSources(db, viewer)).find((s) => s.owner === owner.trim()) ?? null;
}

// ── mark as bought ───────────────────────────────────────────────────────────

export interface MarkBoughtInput {
  /** The wishing player's owner name (the want list the card leaves, and the owner the lots get). */
  owner: string;
  cardId: string;
  quantity: number;
  /** Price paid per copy in EUR cents; null when not known. */
  pricePaidCents: number | null;
  /** A print of the card; default: the cheapest listed variant, else the base print. */
  printId?: string | null;
  /** DE / EN; default: the filter's language, else the cheapest listing's, else EN. */
  language?: "DE" | "EN" | null;
  /** The cart's filter, for the defaults. */
  filter?: ListingFilter;
}

export interface MarkBoughtResult {
  ids: number[];
  printId: string;
  language: "DE" | "EN";
  bought: number;
  /** What is left of the wish (0 when it was removed). */
  wishLeft: number;
}

/** A refusal with a sentence the screen can show as it is. */
export class MarkBoughtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkBoughtError";
  }
}

const finishOfSuffix = (suffix: string) => (suffix === "holo" || suffix === "reverse" ? "foil" : "normal");

/**
 * Move a wished card to the wishing player's collection: `quantity` lots stamped with the player's
 * owner name (one `owned_cards` row per copy, as everywhere), price paid in EUR, and the wish
 * reduced by that many or removed. SL only: the existing "an SL may enter lots for a player" right
 * (`ownerFor`). One transaction, so a failure leaves wish and collection as they were.
 */
export async function markWishBought(db: Db, viewer: Viewer, input: MarkBoughtInput): Promise<MarkBoughtResult> {
  if (viewer.kind !== "sl") throw new AccessDenied("Only an SL can buy for a player.");
  const wishOwner = input.owner.trim();
  if (!wishOwner) throw new MarkBoughtError("Whose wish is this?");
  const owner = ownerFor(viewer, wishOwner, viewer.owner);
  const price = input.pricePaidCents == null ? null : Math.round(Number(input.pricePaidCents));
  if (price != null && (!Number.isFinite(price) || price < 0)) throw new MarkBoughtError("The price must be zero or more.");
  const filter = input.filter ?? DEFAULT_LISTING_FILTER;

  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [wish] = await t
      .select({ id: wantList.id, quantity: wantList.quantity })
      .from(wantList)
      .where(and(eq(wantList.cardId, input.cardId), eq(wantList.owner, wishOwner)))
      .limit(1);
    if (!wish) throw new MarkBoughtError("That wish is no longer on the list.");
    const quantity = Math.min(copiesOf(input.quantity), wish.quantity);

    const prints = await t.select({ id: cardPrints.id, suffix: cardPrints.suffix, isBase: cardPrints.isBase, bp: cardPrints.ctBlueprintId }).from(cardPrints).where(eq(cardPrints.cardId, input.cardId)).orderBy(cardPrints.id);
    if (prints.length === 0) throw new MarkBoughtError("That card has no print to put in a collection.");

    // The cheapest listing that passes the filter tells the default variant and language.
    const listed = isPokemonCardId(input.cardId)
      ? applyListingFilter(await t.select().from(ctListings).where(eq(ctListings.cardId, input.cardId)).orderBy(ctListings.priceCents), filter).filter((l) => l.currency === "EUR" && !l.onVacation && l.quantity > 0)
      : [];
    const cheapest = listed[0] ?? null;
    const cheapestPrint = cheapest ? prints.find((p) => p.bp === cheapest.blueprintId) : undefined;

    let print = prints.find((p) => p.isBase) ?? prints[0];
    if (input.printId) {
      const asked = prints.find((p) => p.id === input.printId);
      if (!asked) throw new MarkBoughtError("That print belongs to another card.");
      print = asked;
    } else if (cheapestPrint) print = cheapestPrint;

    let language: "DE" | "EN" = "EN";
    if (input.language === "DE" || input.language === "EN") language = input.language;
    else if (filter.language !== "any") language = filter.language === "de" ? "DE" : "EN";
    else if (languageCodeOf(cheapest?.language) === "de") language = "DE";

    const rows = expand({ printId: print.id, cardId: input.cardId, owner, condition: "NM", finish: finishOfSuffix(print.suffix), language, pricePaidCents: price, currency: "EUR" }, quantity);
    const inserted = await t.insert(ownedCards).values(rows).returning({ id: ownedCards.id });

    const left = wish.quantity - quantity;
    if (left > 0) await t.update(wantList).set({ quantity: left }).where(eq(wantList.id, wish.id));
    else await t.delete(wantList).where(eq(wantList.id, wish.id));
    return { ids: inserted.map((r) => r.id), printId: print.id, language, bought: quantity, wishLeft: Math.max(0, left) };
  });
}
