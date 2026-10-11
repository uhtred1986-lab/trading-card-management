/**
 * The pure half of "See the cards" (#368): what one card of a deck looks like
 * in the sheet, and how the sheet groups and orders them. No database here, so
 * the client component and `verify-rules.ts` can both import it.
 */

/** A card's printed-skill coverage and review state (`readiness.ts`). */
export type CardRuleState = "open" | "incomplete" | "draft" | "corrected" | "confirmed" | "native" | "plain";

/** Worst first, the order `readiness()` ranks them in (plain last). */
export const STATE_ORDER: CardRuleState[] = ["open", "incomplete", "draft", "corrected", "confirmed", "native", "plain"];

export interface DeckPreviewCard {
  cardId: string;
  name: string;
  /** `deck_cards.zone`: leader | main | z | side. */
  zone: string;
  quantity: number;
  cardType: string;
  colors: string[];
  energyCost: string | null;
  imageUrl: string | null;
  state: CardRuleState;
  /** Printed effectful skills with no current matching rule record. */
  missingSkills?: number;
  /** Known runtime gaps among current rule records, independent of review status. */
  unsupportedSkills?: number;
  /** Contextual runtime support that cannot be decided from a saved record alone. */
  unknownSkills?: number;
}

export type PreviewGroupKey = "leader" | "battle" | "extra" | "z" | "side";

export interface PreviewGroup {
  key: PreviewGroupKey;
  label: string;
  /** Copies, not distinct cards. */
  copies: number;
  cards: DeckPreviewCard[];
}

const LABEL: Record<PreviewGroupKey, string> = { leader: "Leader", battle: "Battle", extra: "Extra", z: "Z-Deck", side: "Sideboard" };

/**
 * The deck's zones are leader | main | z | side; the game's Battle and Extra
 * decks are both `main`, told apart by the card's type.
 */
export function groupKeyOf(c: Pick<DeckPreviewCard, "zone" | "cardType">): PreviewGroupKey {
  if (c.zone === "leader") return "leader";
  if (c.zone === "z") return "z";
  if (c.zone === "side") return "side";
  return c.cardType.toUpperCase() === "EXTRA" ? "extra" : "battle";
}

/** Groups in display order, empty ones left out; open cards first in each, then by name. */
export function groupPreview(cards: DeckPreviewCard[]): PreviewGroup[] {
  const out = new Map<PreviewGroupKey, PreviewGroup>();
  for (const key of Object.keys(LABEL) as PreviewGroupKey[]) out.set(key, { key, label: LABEL[key], copies: 0, cards: [] });
  for (const c of cards) {
    const g = out.get(groupKeyOf(c))!;
    g.cards.push(c);
    g.copies += c.quantity;
  }
  const rank = (s: CardRuleState) => STATE_ORDER.indexOf(s);
  return [...out.values()]
    .filter((g) => g.cards.length > 0)
    .map((g) => ({ ...g, cards: [...g.cards].sort((a, b) => rank(a.state) - rank(b.state) || a.name.localeCompare(b.name)) }));
}
