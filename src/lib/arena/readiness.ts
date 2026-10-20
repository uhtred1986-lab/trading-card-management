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
import { parseSkills, skillLines } from "./text/cards";
import { runtimeSupportOfRow } from "./rules-store";

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
  incomplete: number;
  native: number;
  /** Cards whose catalogue has no printed skill text or native keyword. */
  plain: number;
  /** Runtime capability is separate from whether a person confirmed a row. */
  unsupportedSkills: number;
  unknownSkills: number;
  confirmedSupportedSkills: number;
  confirmedUnsupportedSkills: number;
  confirmedUnknownSkills: number;
  /** The open cards, for naming them and linking into Rules. */
  openCards: ReadinessCard[];
}

const empty = (deckId: number): DeckReadiness => ({
  deckId, total: 0, open: 0, draft: 0, corrected: 0, confirmed: 0, incomplete: 0, native: 0, plain: 0,
  unsupportedSkills: 0, unknownSkills: 0, confirmedSupportedSkills: 0, confirmedUnsupportedSkills: 0, confirmedUnknownSkills: 0,
  openCards: [],
});

type SkillRuleRow = {
  cardId: string;
  name: string;
  skill: string | null;
  backSkill: string | null;
  cardType?: string;
  colors?: string[];
  energyCost?: string | null;
  imageUrl?: string | null;
  zone?: string;
  quantity?: number;
  side: "front" | "back" | null;
  skillIndex: number | null;
  status: "open" | "draft" | "corrected" | "confirmed" | null;
  printed: string | null;
  kind: string | null;
  source: string | null;
  trigger: string[] | null;
  unread: string[] | null;
  ops: unknown;
  cost: unknown;
  usage?: unknown;
  validity?: unknown;
  combo?: unknown;
  cond?: unknown;
};

type CardAssessment = {
  state: CardRuleState;
  missingSkills: number;
  unsupportedSkills: number;
  unknownSkills: number;
  confirmedSupportedSkills: number;
  confirmedUnsupportedSkills: number;
  confirmedUnknownSkills: number;
};

function assessCard(ruleRows: SkillRuleRow[]): CardAssessment {
  const card = ruleRows[0];
  const expected: { side: "front" | "back"; index: number; printed: string }[] = [];
  let nativeSkills = 0;
  let hasText = false;
  for (const [side, text] of [["front", card.skill], ["back", card.backSkill]] as const) {
    if (text?.trim()) hasText = true;
    const lines = skillLines(text);
    for (const sk of parseSkills(text)) {
      if (!sk.effect.trim()) {
        nativeSkills++;
        continue;
      }
      expected.push({ side, index: sk.index, printed: lines[Math.floor(sk.index / 10)] ?? sk.raw });
    }
  }

  const byKey = new Map<string, SkillRuleRow>();
  for (const row of ruleRows) {
    if (row.side == null || row.skillIndex == null) continue;
    byKey.set(`${row.side}#${row.skillIndex}`, row);
  }

  const matched: SkillRuleRow[] = [];
  let missingSkills = 0;
  let unsupportedSkills = 0;
  let unknownSkills = nativeSkills;
  let confirmedSupportedSkills = 0;
  let confirmedUnsupportedSkills = 0;
  let confirmedUnknownSkills = 0;
  for (const skill of expected) {
    const row = byKey.get(`${skill.side}#${skill.index}`);
    // A row is current only when its stored printed line still matches the
    // catalogue line. Re-syncing skill text cannot make an older reading look
    // current just because its index happens to be reused.
    if (!row || row.printed !== skill.printed) {
      missingSkills++;
      continue;
    }
    matched.push(row);
    const support = runtimeSupportOfRow(row as unknown as Parameters<typeof runtimeSupportOfRow>[0]);
    if (support.unsupported.length) unsupportedSkills++;
    if (support.unknown.length) unknownSkills++;
    if (row.status === "confirmed") {
      if (support.unsupported.length) confirmedUnsupportedSkills++;
      else if (support.unknown.length) confirmedUnknownSkills++;
      else confirmedSupportedSkills++;
    }
  }

  const hasOpen = matched.some((r) => r.status === "open");
  const state: CardRuleState = hasOpen
    ? "open"
    : missingSkills > 0
      ? "incomplete"
      : matched.length
        ? matched.reduce<CardRuleState>((worst, row) => stateRank(row.status!) < stateRank(worst) ? row.status! : worst, "confirmed")
        : nativeSkills > 0
          ? "native"
          : hasText
            ? "incomplete"
            : "plain";

  return { state, missingSkills, unsupportedSkills, unknownSkills, confirmedSupportedSkills, confirmedUnsupportedSkills, confirmedUnknownSkills };
}

function stateRank(state: CardRuleState): number {
  return ["open", "incomplete", "draft", "corrected", "confirmed", "native", "plain"].indexOf(state);
}

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
    SELECT dc.deck_id AS "deckId", c.id AS "cardId", c.name, c.skill, c.back_skill AS "backSkill",
           r.side, r.skill_index AS "skillIndex", r.status, r.printed, r.kind, r.source, r.trigger, r.unread, r.ops, r.cost, r.usage, r.validity, r.combo, r.cond
    FROM deck_cards dc
    JOIN cards c ON c.id = dc.card_id
    LEFT JOIN card_rules r ON r.card_id = dc.card_id
    WHERE dc.deck_id IN (${idList(ids)})
    ORDER BY dc.deck_id, c.id
  `);
  const byDeckCard = new Map<string, { deckId: number; rows: SkillRuleRow[] }>();
  for (const row of rows<SkillRuleRow & { deckId: number }>(result)) {
    const deckId = Number(row.deckId);
    const key = `${deckId}#${row.cardId}`;
    const group = byDeckCard.get(key) ?? { deckId, rows: [] };
    group.rows.push(row);
    byDeckCard.set(key, group);
  }
  for (const { deckId, rows: cardRows } of byDeckCard.values()) {
    const d = out.get(deckId);
    if (!d) continue;
    const assessment = assessCard(cardRows);
    d.total++;
    d[assessment.state]++;
    d.unsupportedSkills += assessment.unsupportedSkills;
    d.unknownSkills += assessment.unknownSkills;
    d.confirmedSupportedSkills += assessment.confirmedSupportedSkills;
    d.confirmedUnsupportedSkills += assessment.confirmedUnsupportedSkills;
    d.confirmedUnknownSkills += assessment.confirmedUnknownSkills;
    if (assessment.state === "open") d.openCards.push({ id: cardRows[0].cardId, name: cardRows[0].name });
  }
  for (const d of out.values()) d.openCards.sort((a, b) => a.name.localeCompare(b.name));
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
 * Every card of one deck with its printed-skill coverage and worst review
 * state, in one query (#368, the "See the cards" sheet). `viewer` (an
 * `OwnerScope`) hides a deck the looker may not see the way `getDeck` does: the answer is an
 * empty list. A card in two zones comes back once per zone.
 */
export async function deckCardStates(db: Db, deckId: number, viewer?: OwnerScope): Promise<DeckPreviewCard[]> {
  const result = await db.execute(sql`
    SELECT dc.card_id AS "cardId", dc.zone AS "zone", dc.quantity AS "quantity",
           c.name AS "name", c.card_type AS "cardType", c.colors AS "colors",
           c.energy_cost AS "energyCost", c.image_url AS "imageUrl", c.skill, c.back_skill AS "backSkill",
           r.side, r.skill_index AS "skillIndex", r.status, r.printed, r.kind, r.source, r.trigger, r.unread, r.ops, r.cost, r.usage, r.validity, r.combo, r.cond
    FROM deck_cards dc
    JOIN decks d ON d.id = dc.deck_id
    JOIN cards c ON c.id = dc.card_id
    LEFT JOIN card_rules r ON r.card_id = dc.card_id
    WHERE dc.deck_id = ${deckId}
      ${viewer === undefined ? sql`` : viewer === null ? sql`AND d.owner IS NULL` : sql`AND d.owner = ${viewer}`}
    ORDER BY dc.zone, c.name
  `);
  const groups = new Map<string, { meta: SkillRuleRow & { cardId: string; zone: string; quantity: number }; rows: SkillRuleRow[] }>();
  for (const r of rows<SkillRuleRow & { cardId: string; zone: string; quantity: number }>(result)) {
    const key = `${r.zone}#${r.cardId}`;
    const group = groups.get(key) ?? { meta: r, rows: [] };
    group.rows.push(r);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ meta: r, rows: cardRows }) => {
    const assessment = assessCard(cardRows);
    return {
      cardId: r.cardId,
      zone: r.zone,
      quantity: Number(r.quantity),
      name: r.name,
      cardType: r.cardType ?? "",
      colors: r.colors ?? [],
      energyCost: r.energyCost ?? null,
      imageUrl: r.imageUrl ?? null,
      ...assessment,
    };
  });
}
