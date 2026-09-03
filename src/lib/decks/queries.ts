import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cards, deckCards, decks } from "@/db/schema";
import { allocationForCards, type Allocation } from "./reservations";
import { legality, legalityForDecks, RULES } from "./legality";

export { legality, RULES };
export type { DeckLegality, DeckStatus, IssueSeverity } from "./legality";

export const ZONES = ["leader", "main", "z", "side"] as const;
export type Zone = (typeof ZONES)[number];

export const ZONE_LABEL: Record<Zone, string> = {
  leader: "Leader",
  main: "Main deck",
  z: "Z-Deck",
  side: "Sideboard / ideas",
};

export interface CardDeckMembership {
  id: number;
  name: string;
  isBuilt: boolean;
  zone: Zone;
  quantity: number;
}

/**
 * Every deck this card sits in. Deck slots reference the *card*, not one
 * particular copy, so this belongs to the card as a whole rather than to a
 * row of the collection table.
 */
export async function decksForCard(db: Db, cardId: string): Promise<CardDeckMembership[]> {
  const rows = await db
    .select({ id: decks.id, name: decks.name, isBuilt: decks.isBuilt, zone: deckCards.zone, quantity: deckCards.quantity })
    .from(deckCards)
    .innerJoin(decks, eq(decks.id, deckCards.deckId))
    .where(eq(deckCards.cardId, cardId))
    .orderBy(desc(decks.isBuilt), asc(decks.name));
  return rows.map((r) => ({ ...r, zone: r.zone as Zone }));
}

export async function listDecks(db: Db) {
  const rows = await db
    .select({
      id: decks.id,
      name: decks.name,
      description: decks.description,
      isBuilt: decks.isBuilt,
      updatedAt: decks.updatedAt,
      leaderId: sql<string | null>`(select dc.card_id from ${deckCards} dc where dc.deck_id = ${decks.id} and dc.zone = 'leader' limit 1)`,
    })
    .from(decks)
    .orderBy(desc(decks.isBuilt), desc(decks.updatedAt));
  const leaderIds = rows.map((r) => r.leaderId).filter((x): x is string => !!x);
  const [leaders, legalities] = await Promise.all([
    leaderIds.length
      ? db.select({ id: cards.id, name: cards.name, imageUrl: cards.imageUrl, colors: cards.colors }).from(cards).where(sql`${cards.id} in ${leaderIds}`)
      : Promise.resolve([]),
    legalityForDecks(db, rows.map((r) => r.id)),
  ]);
  const lm = new Map(leaders.map((l) => [l.id, l]));
  return rows.map((r) => {
    const legality = legalities.get(r.id)!;
    return { ...r, leader: r.leaderId ? (lm.get(r.leaderId) ?? null) : null, legality, mainCount: legality.mainCount };
  });
}

export interface DeckCardRow {
  cardId: string;
  zone: Zone;
  quantity: number;
  name: string;
  cardType: string;
  colors: string[];
  energyCost: string | null;
  power: number | null;
  rarityCode: string;
  imageUrl: string | null;
  backImageUrl: string | null;
  backName: string | null;
  limitedTo: number | null;
  isBanned: boolean;
  skill: string | null;
  characters: string[];
  traits: string[];
  alloc: Allocation;
}

export async function getDeck(db: Db, id: number) {
  const deck = await db.query.decks.findFirst({ where: eq(decks.id, id) });
  if (!deck) return null;
  const rows = await db
    .select({
      cardId: deckCards.cardId,
      zone: deckCards.zone,
      quantity: deckCards.quantity,
      name: cards.name,
      cardType: cards.cardType,
      colors: cards.colors,
      energyCost: cards.energyCost,
      power: cards.power,
      rarityCode: cards.rarityCode,
      imageUrl: cards.imageUrl,
      backImageUrl: cards.backImageUrl,
      backName: cards.backName,
      limitedTo: cards.limitedTo,
      isBanned: cards.isBanned,
      skill: cards.skill,
      characters: cards.characters,
      traits: cards.traits,
    })
    .from(deckCards)
    .innerJoin(cards, eq(cards.id, deckCards.cardId))
    .where(eq(deckCards.deckId, id))
    .orderBy(asc(deckCards.zone), asc(sql`nullif(regexp_replace(${cards.energyCost}, '\\D', '', 'g'), '')::int`), asc(cards.name));

  const alloc = await allocationForCards(db, [...new Set(rows.map((r) => r.cardId))]);
  const cardsOut: DeckCardRow[] = rows.map((r) => ({ ...r, zone: r.zone as Zone, alloc: alloc.get(r.cardId)! }));
  return { ...deck, cards: cardsOut, legality: legality(cardsOut) };
}

/** Plain-text decklist for prompts and export: "4 BT18-020 Omega Shenron, …". */
export function deckToText(rows: DeckCardRow[]): string {
  const lines: string[] = [];
  for (const z of ZONES) {
    const zr = rows.filter((r) => r.zone === z);
    if (!zr.length) continue;
    lines.push(`# ${ZONE_LABEL[z]}`);
    for (const r of zr) lines.push(`${r.quantity} ${r.cardId} ${r.name}`);
  }
  return lines.join("\n");
}

/** Parse "4 BT18-020", "4x BT18-020 Name", or "BT18-020" lines. Returns ids + qty. */
export function parseDeckList(text: string): { cardId: string; quantity: number; zone: Zone }[] {
  const out: { cardId: string; quantity: number; zone: Zone }[] = [];
  let zone: Zone = "main";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const l = line.toLowerCase();
      zone = l.includes("leader") ? "leader" : l.includes("z-deck") || l.includes("z deck") ? "z" : l.includes("side") ? "side" : "main";
      continue;
    }
    const m = /^(?:(\d+)\s*[xX]?\s+)?([A-Z]{1,5}\d*-\d{2,3}[A-Za-z0-9_]*|T_[A-Z]{3}_\d{2}|P-\d{3}[A-Za-z0-9_]*)/i.exec(line);
    if (!m) continue;
    out.push({ cardId: m[2].toUpperCase().split("_")[0], quantity: m[1] ? Number(m[1]) : 1, zone });
  }
  return out;
}
