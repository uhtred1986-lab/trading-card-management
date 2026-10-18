/**
 * Deck-weighted rules progress (owner decision, 18 Oct 2026): the measure is how many of the cards
 * in the owner's decks have CONFIRMED rules, not catalog-wide unread counts. Eligible decks are
 * game "dbs", not testing, owner-scoped (the rule of scripts/arena-immersion-inventory.mts); cards
 * are main + Z + leader, both faces (a leader's awakened side is `side = back` rows).
 *
 * `loadProgress` is two reads (deck cards, then the rules of those cards); `computeProgress` is pure.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rulesProgressSnapshots } from "@/db/schema";
import { rows } from "@/db/rows";
import { textArray } from "@/db/sqlx";
import type { OwnerScope } from "@/lib/collection/scope";

/** Where one skill row stands. `flagged` outranks the rest: a suspected misread is not confirmed. */
export type SkillBucket = "confirmed" | "owner" | "read" | "unread" | "flagged";
/** Where a whole card stands: its worst skill, or `missing` when it has skills and no rows. */
export type CardBucket = "confirmed" | "read" | "unread" | "flagged" | "missing";

export type DeckCardRow = { deckId: number; deckName: string; cardId: string; cardName: string; zone: string; quantity: number; hasSkill: boolean };
export type RuleRow = { id: number; cardId: string; status: string; source: string; confirmed: boolean; unreadCount: number; reviewFlag: string | null };

export function skillBucket(r: Pick<RuleRow, "status" | "source" | "confirmed" | "unreadCount" | "reviewFlag">): SkillBucket {
  if (r.reviewFlag) return "flagged";
  if (r.confirmed || r.status === "confirmed") return "confirmed";
  if (r.status === "corrected" || r.source === "user") return "owner";
  if (r.unreadCount > 0) return "unread";
  return "read";
}

export type CardProgress = {
  cardId: string;
  name: string;
  appearances: number; // eligible decks that run it
  copies: number; // total copies across those decks
  bucket: CardBucket;
  skills: Record<SkillBucket, number>;
  /** The rule row to open in the workbench: the first one that is not yet done. */
  ruleId: number | null;
};
export type DeckProgress = { deckId: number; name: string; total: number; confirmed: number; read: number; unread: number; flagged: number; missing: number };
export type Progress = {
  decks: DeckProgress[];
  cards: CardProgress[];
  total: number;
  confirmed: number;
  /** Skill rows of deck cards, by bucket. */
  skills: Record<SkillBucket, number>;
};

const emptySkills = (): Record<SkillBucket, number> => ({ confirmed: 0, owner: 0, read: 0, unread: 0, flagged: 0 });
const WORST: SkillBucket[] = ["flagged", "unread", "read"]; // order a card's open row is chosen in

export function computeProgress(deckCards: DeckCardRow[], rules: RuleRow[]): Progress {
  const byCard = new Map<string, RuleRow[]>();
  for (const r of rules) (byCard.get(r.cardId) ?? byCard.set(r.cardId, []).get(r.cardId)!).push(r);

  const cardMap = new Map<string, CardProgress & { decks: Set<number> }>();
  const hasSkill = new Map<string, boolean>();
  for (const d of deckCards) {
    hasSkill.set(d.cardId, d.hasSkill || (hasSkill.get(d.cardId) ?? false));
    let c = cardMap.get(d.cardId);
    if (!c) {
      const mine = byCard.get(d.cardId) ?? [];
      const skills = emptySkills();
      let ruleId: number | null = null;
      let rank = 99;
      for (const r of mine) {
        const b = skillBucket(r);
        skills[b]++;
        const k = WORST.indexOf(b);
        if (k >= 0 && k < rank) { rank = k; ruleId = r.id; }
      }
      ruleId ??= mine[0]?.id ?? null;
      c = { cardId: d.cardId, name: d.cardName, appearances: 0, copies: 0, bucket: "missing", skills, ruleId, decks: new Set() };
      cardMap.set(d.cardId, c);
    }
    c.decks.add(d.deckId);
    c.copies += d.quantity;
  }

  // A card with no skill text and no rows has nothing to confirm: it is left out of every total.
  for (const [id, c] of cardMap) {
    const n = byCard.get(id)?.length ?? 0;
    if (n === 0 && !hasSkill.get(id)) { cardMap.delete(id); continue; }
    c.appearances = c.decks.size;
    const s = c.skills;
    c.bucket = n === 0 ? "missing" : s.flagged ? "flagged" : s.unread ? "unread" : s.read ? "read" : "confirmed";
  }

  const deckMap = new Map<number, DeckProgress>();
  const seen = new Set<string>();
  for (const d of deckCards) {
    const c = cardMap.get(d.cardId);
    if (!c) continue;
    let dp = deckMap.get(d.deckId);
    if (!dp) deckMap.set(d.deckId, (dp = { deckId: d.deckId, name: d.deckName, total: 0, confirmed: 0, read: 0, unread: 0, flagged: 0, missing: 0 }));
    const key = `${d.deckId}|${d.cardId}`;
    if (seen.has(key)) continue; // a card in main and Z counts once per deck
    seen.add(key);
    dp.total++;
    dp[c.bucket]++;
  }

  const cards: CardProgress[] = [...cardMap.values()].map((c) => ({ cardId: c.cardId, name: c.name, appearances: c.appearances, copies: c.copies, bucket: c.bucket, skills: c.skills, ruleId: c.ruleId }));
  const skills = emptySkills();
  for (const c of cards) for (const k of Object.keys(skills) as SkillBucket[]) skills[k] += c.skills[k];
  return {
    decks: [...deckMap.values()].sort((a, b) => b.confirmed / (b.total || 1) - a.confirmed / (a.total || 1) || a.name.localeCompare(b.name)),
    cards: cards.sort((a, b) => b.appearances - a.appearances || a.cardId.localeCompare(b.cardId)),
    total: cards.length,
    confirmed: cards.filter((c) => c.bucket === "confirmed").length,
    skills,
  };
}

export async function loadProgress(db: Db, scope: OwnerScope): Promise<Progress> {
  const ownerWhere = scope === undefined ? sql`` : scope === null ? sql`and d.owner is null` : sql`and d.owner = ${scope}`;
  const deckCards = rows<DeckCardRow>(await db.execute(sql`
    select d.id as "deckId", d.name as "deckName", dc.card_id as "cardId", c.name as "cardName", dc.zone, dc.quantity,
           (coalesce(btrim(c.skill), '') <> '' or coalesce(btrim(c.back_skill), '') <> '') as "hasSkill"
    from decks d
    join deck_cards dc on dc.deck_id = d.id and dc.zone in ('main', 'z', 'leader')
    join cards c on c.id = dc.card_id
    where d.game = 'dbs' and d.is_testing = false ${ownerWhere}`));
  const ids = [...new Set(deckCards.map((r) => r.cardId))];
  if (!ids.length) return computeProgress([], []);
  const rules = rows<RuleRow>(await db.execute(sql`
    select id, card_id as "cardId", status, source, (confirmed_at is not null) as confirmed,
           jsonb_array_length(unread)::int as "unreadCount", review_flag as "reviewFlag"
    from card_rules where card_id = any(${textArray(ids)})
    order by card_id, side, skill_index`));
  return computeProgress(deckCards, rules);
}

export type SnapshotRow = { date: string; confirmedCards: number; totalCards: number; readSkills: number; unreadSkills: number; flagged: number };

/** Writes today's snapshot unless one exists (at most one a day), then returns the history oldest first. */
export async function recordAndReadSnapshots(db: Db, p: Progress, today = new Date().toISOString().slice(0, 10)): Promise<SnapshotRow[]> {
  await db
    .insert(rulesProgressSnapshots)
    .values({ snapshotDate: today, confirmedCards: p.confirmed, totalCards: p.total, readSkills: p.skills.read, unreadSkills: p.skills.unread, flagged: p.skills.flagged })
    .onConflictDoNothing();
  const out = rows<SnapshotRow>(await db.execute(sql`
    select snapshot_date::text as date, confirmed_cards as "confirmedCards", total_cards as "totalCards",
           read_skills as "readSkills", unread_skills as "unreadSkills", flagged
    from rules_progress_snapshots order by snapshot_date`));
  return out;
}
