/**
 * Deck rule checking. Nothing here ever *blocks* an edit — a deck can hold
 * anything, and this reports what is wrong with it so the UI can flag it.
 *
 * Two kinds of problem, deliberately separated: **incomplete** (you are still
 * building — no leader yet, fewer than 50 cards) and **illegal** (a rule is
 * actively broken — banned card, too many copies, oversized deck). Colour
 * mismatches are reported as warnings; they do not change the status.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { cards, deckCards } from "@/db/schema";

/** Bandai deck rules: 1 leader, exactly 50 main, up to 8 Z-deck, 4 copies unless the card says otherwise. */
export const RULES = { main: 50, zMax: 8, copies: 4 };

export type IssueSeverity = "illegal" | "incomplete" | "warning";
export type DeckStatus = "legal" | "incomplete" | "illegal";

export interface LegalityCard {
  cardId: string;
  zone: string;
  quantity: number;
  name: string;
  cardType: string;
  colors: string[];
  limitedTo: number | null;
  isBanned: boolean;
}

export interface DeckIssue {
  severity: IssueSeverity;
  message: string;
  cardId?: string;
}

export interface DeckFlag {
  severity: IssueSeverity;
  label: string;
}

export interface DeckLegality {
  status: DeckStatus;
  leaderCount: number;
  mainCount: number;
  zCount: number;
  sideCount: number;
  issues: DeckIssue[];
  /** "<zone>:<cardId>" → why that row is flagged, for highlighting it in a list. */
  flags: Record<string, DeckFlag>;
}

export const STATUS_LABEL: Record<DeckStatus, string> = {
  legal: "Legal",
  incomplete: "Incomplete",
  illegal: "Illegal",
};

export function copyLimit(card: { zone?: string; limitedTo: number | null }): number {
  if (card.zone === "leader") return 1;
  return card.limitedTo ?? RULES.copies;
}

export function legality(rows: LegalityCard[]): DeckLegality {
  const issues: DeckIssue[] = [];
  const flags: Record<string, DeckFlag> = {};
  const flag = (r: LegalityCard, severity: IssueSeverity, label: string) => {
    const key = `${r.zone}:${r.cardId}`;
    // Keep the most severe reason when a card breaks more than one rule.
    if (!flags[key] || (flags[key].severity === "warning" && severity !== "warning")) flags[key] = { severity, label };
    issues.push({ severity, message: `${r.name} (${r.cardId}): ${label}.`, cardId: r.cardId });
  };
  const count = (zone: string) => rows.filter((r) => r.zone === zone).reduce((n, r) => n + r.quantity, 0);
  const leaderCount = count("leader");
  const mainCount = count("main");
  const zCount = count("z");
  const sideCount = count("side");

  if (leaderCount === 0) issues.push({ severity: "incomplete", message: "No leader chosen yet." });
  else if (leaderCount > 1) issues.push({ severity: "illegal", message: `${leaderCount} leaders — a deck has exactly one.` });

  if (mainCount === 0) issues.push({ severity: "incomplete", message: `Main deck is empty — ${RULES.main} cards to go.` });
  else if (mainCount < RULES.main) issues.push({ severity: "incomplete", message: `Main deck has ${mainCount} of ${RULES.main} cards — ${RULES.main - mainCount} to go.` });
  else if (mainCount > RULES.main) issues.push({ severity: "illegal", message: `Main deck has ${mainCount} cards — ${mainCount - RULES.main} too many.` });

  if (zCount > RULES.zMax) issues.push({ severity: "illegal", message: `Z-Deck has ${zCount} cards; the maximum is ${RULES.zMax}.` });

  // Copies count across leader + main + Z; the sideboard is a scratch zone.
  const perCard = new Map<string, { n: number; row: LegalityCard }>();
  for (const r of rows) {
    if (r.zone === "side") continue;
    const e = perCard.get(r.cardId) ?? { n: 0, row: r };
    e.n += r.quantity;
    perCard.set(r.cardId, e);
  }
  for (const { n, row } of perCard.values()) {
    if (row.isBanned) flag(row, "illegal", "banned card");
    const limit = copyLimit(row);
    if (n > limit) flag(row, "illegal", `${n} copies, limit ${limit}`);
  }

  const leaderColors = new Set(rows.filter((r) => r.zone === "leader").flatMap((r) => r.colors));
  for (const r of rows) {
    if (r.zone === "side") continue;
    const isLeaderCard = r.cardType.endsWith("LEADER");
    if (r.zone === "leader" && !isLeaderCard) flag(r, "illegal", "not a Leader card");
    if (r.zone !== "leader" && isLeaderCard) flag(r, "illegal", "Leader cards belong in the leader slot");
    if (r.zone === "z" && !r.cardType.startsWith("Z-")) flag(r, "illegal", "only Z- cards go in the Z-Deck");
    if (
      r.zone !== "leader" &&
      leaderColors.size > 0 &&
      r.colors.length > 0 &&
      !r.colors.includes("Colorless") &&
      !r.colors.some((c) => leaderColors.has(c))
    ) {
      flag(r, "warning", `off-colour for a ${[...leaderColors].join("/")} leader`);
    }
  }

  const status: DeckStatus = issues.some((i) => i.severity === "illegal")
    ? "illegal"
    : issues.some((i) => i.severity === "incomplete")
      ? "incomplete"
      : "legal";
  return { status, leaderCount, mainCount, zCount, sideCount, issues, flags };
}

/** Legality for several decks at once — for the deck list and the leaders page. */
export async function legalityForDecks(db: Db, deckIds: number[]): Promise<Map<number, DeckLegality>> {
  const out = new Map<number, DeckLegality>();
  if (deckIds.length === 0) return out;
  const rows = await db
    .select({
      deckId: deckCards.deckId,
      cardId: deckCards.cardId,
      zone: deckCards.zone,
      quantity: deckCards.quantity,
      name: cards.name,
      cardType: cards.cardType,
      colors: cards.colors,
      limitedTo: cards.limitedTo,
      isBanned: cards.isBanned,
    })
    .from(deckCards)
    .innerJoin(cards, eq(cards.id, deckCards.cardId))
    .where(inArray(deckCards.deckId, deckIds));
  const byDeck = new Map<number, LegalityCard[]>();
  for (const r of rows) {
    const list = byDeck.get(r.deckId) ?? [];
    list.push(r);
    byDeck.set(r.deckId, list);
  }
  for (const id of deckIds) out.set(id, legality(byDeck.get(id) ?? []));
  return out;
}
