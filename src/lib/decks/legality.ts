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
import { cards, deckCards, decks } from "@/db/schema";
import { DEFAULT_GAME, deckRules, gameInfo, gameOr, type Game } from "@/lib/catalog/games";
import { hasKeyword, rulesFor } from "./cardRules";

/**
 * Deck sizes and copy limits per game live in src/lib/catalog/games.ts.
 *
 * dbs — official Rule Manual v4.00 §6-1 (Masters): 1 leader, a **50-to-60**
 * card main deck (6-1-3), up to **10** Z-cards (6-1-4), 4 copies of a card
 * number unless the card says otherwise (6-1-5-1). The app used to enforce the
 * older line's "exactly 50, Z-deck 8"; the arena engine reads the same manual,
 * so both now agree (owner's decision, 3 Sep 2026).
 *
 * fusion — Fusion World Rule Manual v1.20 and the official deck-building FAQ:
 * 1 leader, 50–60 cards, 4 copies of a number, no Z-Deck, and a **hard** colour
 * rule ("if your Leader doesn't have a certain color, you can't include a card
 * with that color in your deck") — the one place the two games differ in kind
 * rather than in number.
 */
export const RULES = deckRules(DEFAULT_GAME);

/** "42/50" while the deck is still short, just the count once it is in range. */
export function mainCountLabel(n: number, game: Game = DEFAULT_GAME): string {
  const r = deckRules(game);
  return n < r.main ? `${n}/${r.main}` : `${n}`;
}

/** Whether a main-deck count is inside the game's legal range. */
export function mainCountOk(n: number, game: Game = DEFAULT_GAME): boolean {
  const r = deckRules(game);
  return n >= r.main && n <= r.mainMax;
}

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
  /** Needed to read deck-building rules printed on the cards themselves. */
  skill?: string | null;
  /**
   * The game the card belongs to. Left undefined by callers that only ever
   * deal with one game; a card whose game differs from the deck's is flagged.
   */
  game?: Game;
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

export interface KeywordRuleUse {
  keyword: string;
  max: number;
  used: number;
  unlimitedCopies: boolean;
}

export interface DeckLegality {
  status: DeckStatus;
  /** Pooled keyword limits in play, e.g. [Dragon Ball] 6/7. */
  keywordRules: KeywordRuleUse[];
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

export function copyLimit(card: { zone?: string; limitedTo: number | null }, game: Game = DEFAULT_GAME): number {
  if (card.zone === "leader") return 1;
  return card.limitedTo ?? deckRules(game).copies;
}

export function legality(rows: LegalityCard[], game: Game = DEFAULT_GAME): DeckLegality {
  const info = gameInfo(game);
  const RULES = info.deck;
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
  else if (mainCount > RULES.mainMax) issues.push({ severity: "illegal", message: `Main deck has ${mainCount} cards — ${mainCount - RULES.mainMax} over the ${RULES.mainMax}-card maximum.` });

  if (RULES.zMax === 0) {
    if (zCount > 0) issues.push({ severity: "illegal", message: `${info.short} has no Z-Deck — move those ${zCount} cards to the main deck or the sideboard.` });
  } else if (zCount > RULES.zMax) {
    issues.push({ severity: "illegal", message: `Z-Deck has ${zCount} cards; the maximum is ${RULES.zMax}.` });
  }

  // Copies count across leader + main + Z; the sideboard is a scratch zone.
  const perCard = new Map<string, { n: number; row: LegalityCard }>();
  for (const r of rows) {
    if (r.zone === "side") continue;
    const e = perCard.get(r.cardId) ?? { n: 0, row: r };
    e.n += r.quantity;
    perCard.set(r.cardId, e);
  }
  // Pooled keyword limits printed on the cards ([Dragon Ball], [Super Combo]).
  const rules = rulesFor(rows);
  const keywordRules: KeywordRuleUse[] = [];
  for (const rule of rules) {
    const members = rows.filter((r) => r.zone !== "side" && hasKeyword(r, rule.keyword));
    const used = members.reduce((n, r) => n + r.quantity, 0);
    keywordRules.push({ ...rule, used });
    if (used > rule.max) {
      issues.push({ severity: "illegal", message: `${used} [${rule.keyword}] cards — a deck may hold at most ${rule.max}.` });
      for (const m of members) flag(m, "illegal", `over the ${rule.max}-card [${rule.keyword}] limit`);
    }
  }
  /** A rule like [Dragon Ball] replaces the 4-copy limit rather than adding to it. */
  const copyLimitWaived = (row: LegalityCard) => rules.some((r) => r.unlimitedCopies && hasKeyword(row, r.keyword));

  for (const { n, row } of perCard.values()) {
    if (row.isBanned) flag(row, "illegal", "banned card");
    if (copyLimitWaived(row)) continue;
    const limit = copyLimit(row, game);
    if (n > limit) flag(row, "illegal", `${n} copies, limit ${limit}`);
  }

  const leaderColors = new Set(rows.filter((r) => r.zone === "leader").flatMap((r) => r.colors));
  for (const r of rows) {
    if (r.zone === "side") continue;
    // The two games share nothing but a brand, so a card from the other one
    // can never be played here. It is flagged, not refused — the same way a
    // banned card is — so a decklist pasted into the wrong deck still lands
    // somewhere you can see and fix it.
    if (r.game && r.game !== game) {
      flag(r, "illegal", `a ${gameInfo(r.game).short} card in a ${info.short} deck`);
      continue;
    }
    if (info.nonDeckTypes.includes(r.cardType)) {
      flag(r, "illegal", `${r.cardType.toLowerCase()} cards are not deck cards`);
      continue;
    }
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
      // Fusion World forbids off-colour cards outright; the original game
      // only makes them a bad idea.
      const why = `off-colour for a ${[...leaderColors].join("/")} leader`;
      if (RULES.colorStrict) flag(r, "illegal", why);
      else flag(r, "warning", why);
    }
  }

  const status: DeckStatus = issues.some((i) => i.severity === "illegal")
    ? "illegal"
    : issues.some((i) => i.severity === "incomplete")
      ? "incomplete"
      : "legal";
  return { status, keywordRules, leaderCount, mainCount, zCount, sideCount, issues, flags };
}

/** Legality for several decks at once — for the deck list and the leaders page. */
export async function legalityForDecks(db: Db, deckIds: number[]): Promise<Map<number, DeckLegality>> {
  const out = new Map<number, DeckLegality>();
  if (deckIds.length === 0) return out;
  const [rows, deckGames] = await Promise.all([
    db
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
        skill: cards.skill,
        game: cards.game,
      })
      .from(deckCards)
      .innerJoin(cards, eq(cards.id, deckCards.cardId))
      .where(inArray(deckCards.deckId, deckIds)),
    db.select({ id: decks.id, game: decks.game }).from(decks).where(inArray(decks.id, deckIds)),
  ]);
  const gameOf = new Map(deckGames.map((d) => [d.id, gameOr(d.game)]));
  const byDeck = new Map<number, LegalityCard[]>();
  for (const r of rows) {
    const list = byDeck.get(r.deckId) ?? [];
    list.push({ ...r, game: gameOr(r.game) });
    byDeck.set(r.deckId, list);
  }
  for (const id of deckIds) out.set(id, legality(byDeck.get(id) ?? [], gameOf.get(id)));
  return out;
}
