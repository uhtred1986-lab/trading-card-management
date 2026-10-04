/**
 * Rule readiness per deck (#357, `docs/arena-home-spec.md` §3).
 *
 * A deck's readiness is its distinct cards counted by the worst state among
 * their `card_rules` rows: open > draft > corrected > confirmed. One query for
 * every deck asked about, never one per deck or per card. A deck with an
 * `open` card cannot be played (owner's ruling, 30 Sep 2026): on the rules
 * engine an open row plays as blank, so the game would not be the game on the
 * cards. Drafts never block.
 */
import { sql } from "drizzle-orm";
import type { OwnerScope } from "@/lib/collection/scope";
import type { Db } from "@/db";
import { rows } from "@/db/rows";
import type { CardRuleState, DeckPreviewCard } from "./deck-preview";

export interface ReadinessCard {
  id: string;
  name: string;
}

export interface DeckReadiness {
  deckId: number;
  /** Distinct cards in the deck, leader and Z cards included. */
  total: number;
  open: number;
  draft: number;
  corrected: number;
  confirmed: number;
  /** Cards with no rule row at all (no skill text): in `total` only. */
  plain: number;
  /** The open cards, for naming them and linking into Rules. */
  openCards: ReadinessCard[];
}

const empty = (deckId: number): DeckReadiness => ({ deckId, total: 0, open: 0, draft: 0, corrected: 0, confirmed: 0, plain: 0, openCards: [] });

const RANK_KEY = ["open", "draft", "corrected", "confirmed"] as const;

/** The worst-state rank of a card's `card_rules` rows: one expression for the counts and for the sheet (#368). */
const WORST_RANK = sql`min(CASE r.status WHEN 'open' THEN 0 WHEN 'draft' THEN 1 WHEN 'corrected' THEN 2 WHEN 'confirmed' THEN 3 END)`;

const idList = (ids: number[]) =>
  sql.join(
    ids.map((i) => sql`${i}`),
    sql`, `,
  );

/** Readiness of every deck in `deckIds`, in one round-trip. A deck with no cards maps to all zeros. */
export async function readiness(db: Db, deckIds: number[]): Promise<Map<number, DeckReadiness>> {
  const out = new Map<number, DeckReadiness>();
  const ids = [...new Set(deckIds)];
  for (const id of ids) out.set(id, empty(id));
  if (!ids.length) return out;
  const result = await db.execute(sql`
    SELECT w.deck_id AS "deckId", w.rank AS "rank", count(*)::int AS "n",
           coalesce(json_agg(json_build_object('id', w.card_id, 'name', w.name) ORDER BY w.name) FILTER (WHERE w.rank = 0), '[]'::json) AS "cards"
    FROM (
      SELECT dc.deck_id, dc.card_id, c.name,
             ${WORST_RANK} AS rank
      FROM deck_cards dc
      JOIN cards c ON c.id = dc.card_id
      LEFT JOIN card_rules r ON r.card_id = dc.card_id
      WHERE dc.deck_id IN (${idList(ids)})
      GROUP BY dc.deck_id, dc.card_id, c.name
    ) w
    GROUP BY w.deck_id, w.rank
  `);
  for (const r of rows<{ deckId: number; rank: number | null; n: number; cards: ReadinessCard[] | string }>(result)) {
    const d = out.get(Number(r.deckId));
    if (!d) continue;
    d.total += r.n;
    if (r.rank == null) {
      d.plain += r.n;
      continue;
    }
    const key = RANK_KEY[Number(r.rank)];
    d[key] += r.n;
    if (key === "open") d.openCards = typeof r.cards === "string" ? JSON.parse(r.cards) : r.cards;
  }
  return out;
}

/** A deck is locked when any of its cards has an open rule. */
export const isLocked = (r: DeckReadiness | undefined): boolean => !!r && r.open > 0;

/** The one wording every refusal uses. */
export const lockedMessage = (name: string, open: number) => `"${name}" has ${open} card${open === 1 ? "" : "s"} with no rule yet, so it cannot be played. Fix ${open === 1 ? "it" : "them"} in Rules first.`;

/**
 * The server's half of the block: throws naming the deck and the count when
 * any of `decks` has an open rule. One query for all of them.
 */
export async function assertDecksPlayable(db: Db, decks: { id: number; name: string }[]): Promise<void> {
  const r = await readiness(db, decks.map((d) => d.id));
  for (const d of decks) {
    const open = r.get(d.id)?.open ?? 0;
    if (open > 0) throw new Error(lockedMessage(d.name, open));
  }
}

/**
 * Each deck's distinct card ids in one query: what `/arena/rules` needs to
 * scope its worklist without calling `deckInputFor` once per deck.
 */
export async function deckCardSets(db: Db, deckIds: number[]): Promise<Map<number, Set<string>>> {
  const out = new Map<number, Set<string>>();
  const ids = [...new Set(deckIds)];
  if (!ids.length) return out;
  const result = await db.execute(sql`
    SELECT deck_id AS "deckId", array_agg(DISTINCT card_id) AS "cardIds"
    FROM deck_cards
    WHERE deck_id IN (${idList(ids)})
    GROUP BY deck_id
  `);
  for (const r of rows<{ deckId: number; cardIds: string[] }>(result)) out.set(Number(r.deckId), new Set(r.cardIds));
  return out;
}

/**
 * Every card of one deck with its worst rule state, in one query (#368, the
 * "See the cards" sheet). The state is the same worst-of-rows rank `readiness`
 * counts by, so the sheet and the strip above it never disagree. `viewer` (an
 * `OwnerScope`) hides a deck the looker may not see the way `getDeck` does: the answer is an
 * empty list. A card in two zones comes back once per zone.
 */
export async function deckCardStates(db: Db, deckId: number, viewer?: OwnerScope): Promise<DeckPreviewCard[]> {
  const result = await db.execute(sql`
    SELECT dc.card_id AS "cardId", dc.zone AS "zone", dc.quantity AS "quantity",
           c.name AS "name", c.card_type AS "cardType", c.colors AS "colors",
           c.energy_cost AS "energyCost", c.image_url AS "imageUrl", ${WORST_RANK} AS "rank"
    FROM deck_cards dc
    JOIN decks d ON d.id = dc.deck_id
    JOIN cards c ON c.id = dc.card_id
    LEFT JOIN card_rules r ON r.card_id = dc.card_id
    WHERE dc.deck_id = ${deckId}
      ${viewer === undefined ? sql`` : viewer === null ? sql`AND d.owner IS NULL` : sql`AND d.owner = ${viewer}`}
    GROUP BY dc.card_id, dc.zone, dc.quantity, c.name, c.card_type, c.colors, c.energy_cost, c.image_url
  `);
  type Row = { cardId: string; zone: string; quantity: number; name: string; cardType: string; colors: string[]; energyCost: string | null; imageUrl: string | null; rank: number | null };
  return rows<Row>(result).map((r) => ({
    cardId: r.cardId,
    zone: r.zone,
    quantity: Number(r.quantity),
    name: r.name,
    cardType: r.cardType,
    colors: r.colors ?? [],
    energyCost: r.energyCost,
    imageUrl: r.imageUrl,
    state: (r.rank == null ? "plain" : RANK_KEY[Number(r.rank)]) as CardRuleState,
  }));
}
