/**
 * Catalog rows → engine card definitions, and a saved deck → `DeckInput`.
 * The engine never touches the database; this is the one bridge.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { cards, deckCards, decks } from "@/db/schema";
import type { CardDef, CardType, Color, DeckInput } from "./engine";

type CardRow = typeof cards.$inferSelect;

const COLORS: Color[] = ["Red", "Blue", "Green", "Yellow", "Black", "Colorless"];

/** "4" → 4, "X" → "X", null/"" → null. */
export function energyCostOf(text: string | null | undefined): number | "X" | null {
  if (text == null || text === "") return null;
  if (/^x$/i.test(text.trim())) return "X";
  const n = Number(text.replace(/\D/g, ""));
  return Number.isFinite(n) && text.replace(/\D/g, "") !== "" ? n : null;
}

export function cardDefFrom(row: CardRow): CardDef {
  const colors = row.colors.filter((c): c is Color => (COLORS as string[]).includes(c));
  return {
    id: row.id,
    name: row.name,
    type: row.cardType as CardType,
    colors: colors.length ? colors : ["Colorless"],
    energyCost: energyCostOf(row.energyCost),
    zEnergyCost: row.zEnergyCost == null || row.zEnergyCost === "" ? null : (Number(row.zEnergyCost.replace(/\D/g, "")) ?? null),
    power: row.power,
    comboCost: row.comboCost,
    comboPower: row.comboPower,
    skill: row.skill,
    characters: row.characters,
    traits: row.traits,
    back: row.backName ? { name: row.backName, power: row.backPower, skill: row.backSkill } : null,
  };
}

export async function defsForCards(db: Db, ids: string[]): Promise<Record<string, CardDef>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return {};
  const rows = await db.select().from(cards).where(inArray(cards.id, unique));
  const out: Record<string, CardDef> = {};
  for (const r of rows) out[r.id] = cardDefFrom(r);
  return out;
}

/** A saved deck as the engine wants it: leader id, main list with repeats, Z-deck. */
export async function deckInputFor(db: Db, deckId: number): Promise<{ input: DeckInput; cardIds: string[] } | null> {
  const deck = await db.query.decks.findFirst({ where: eq(decks.id, deckId) });
  if (!deck) return null;
  const rows = await db.select({ cardId: deckCards.cardId, zone: deckCards.zone, quantity: deckCards.quantity }).from(deckCards).where(eq(deckCards.deckId, deckId));
  const leader = rows.find((r) => r.zone === "leader")?.cardId;
  if (!leader) return null;
  const expand = (zone: string) => rows.filter((r) => r.zone === zone).flatMap((r) => Array.from({ length: r.quantity }, () => r.cardId));
  const main = expand("main");
  const z = expand("z");
  return { input: { name: deck.name, leader, main, z }, cardIds: [leader, ...main, ...z] };
}
