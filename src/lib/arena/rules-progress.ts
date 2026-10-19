/**
 * Deck-weighted rules progress (owner decision, 18 Oct 2026): the measure is how many of the cards
 * in the owner's decks have CONFIRMED rules, not catalog-wide unread counts. Eligible decks are
 * game "dbs", not testing, owner-scoped (the rule of scripts/arena-immersion-inventory.mts); cards
 * are main + Z + leader, both faces (a leader's awakened side is `side = back` rows). "Done" is
 * `ruleHealth`'s: confirmed or corrected, and nothing the engine cannot carry out.
 *
 * `loadProgress` is two reads (deck cards, then the rules of those cards); `computeProgress` is pure.
 */
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rulesProgressSnapshots } from "@/db/schema";
import { rows } from "@/db/rows";
import { textArray } from "@/db/sqlx";
import type { OwnerScope } from "@/lib/collection/scope";
import { cardHealth, currentRowsOf, RULE_HEALTHS, ruleHealth, type HealthRow, type RuleHealth } from "./rules-store";

/**
 * Where one skill stands, and where a whole card does (its worst skill): the four healths of
 * `ruleHealth` (rules-store.ts), so this page, the header counts and the queue agree. A printed
 * skill with no current rule row counts as `text-only`.
 */
export type SkillBucket = RuleHealth;
export type CardBucket = RuleHealth;

export type DeckCardRow = {
  deckId: number; deckName: string; cardId: string; cardName: string; zone: string; quantity: number; hasSkill: boolean;
  /** Printed skills with no current rule row (`cardHealthOf`); they count as text-only skills. Absent: unknown. */
  missingSkills?: number;
};
export type RuleRow = { id: number; cardId: string; health: RuleHealth };

export function skillBucket(r: Pick<RuleRow, "health">): SkillBucket {
  return r.health;
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
export type DeckProgress = { deckId: number; name: string; total: number } & Record<RuleHealth, number>;
export type Progress = {
  decks: DeckProgress[];
  cards: CardProgress[];
  total: number;
  /** Cards whose every skill is done. */
  done: number;
  /** Skill rows of deck cards, by bucket. */
  skills: Record<SkillBucket, number>;
};

const emptySkills = (): Record<SkillBucket, number> => ({ "text-only": 0, incomplete: 0, unchecked: 0, done: 0 });
const WORST: SkillBucket[] = ["text-only", "incomplete", "unchecked"]; // order a card's row to open is chosen in

export function computeProgress(deckCards: DeckCardRow[], rules: RuleRow[]): Progress {
  const byCard = new Map<string, RuleRow[]>();
  for (const r of rules) (byCard.get(r.cardId) ?? byCard.set(r.cardId, []).get(r.cardId)!).push(r);

  const cardMap = new Map<string, CardProgress & { decks: Set<number>; nothingToCheck: boolean }>();
  for (const d of deckCards) {
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
      // A printed skill with no current row is a skill the engine plays as blank. When the caller did
      // not count them (`missingSkills` absent), a card with text and no rows stands for one.
      const missing = d.missingSkills ?? (mine.length === 0 && d.hasSkill ? 1 : 0);
      skills["text-only"] += missing;
      c = { cardId: d.cardId, name: d.cardName, appearances: 0, copies: 0, bucket: "done", skills, ruleId, decks: new Set(), nothingToCheck: mine.length + missing === 0 };
      cardMap.set(d.cardId, c);
    }
    c.decks.add(d.deckId);
    c.copies += d.quantity;
  }

  // A card with no skill rows and nothing missing has nothing to check: it is left out of every total.
  for (const [id, c] of cardMap) {
    if (c.nothingToCheck) { cardMap.delete(id); continue; }
    c.appearances = c.decks.size;
    c.bucket = cardHealth(RULE_HEALTHS.filter((h) => c.skills[h] > 0));
  }

  const deckMap = new Map<number, DeckProgress>();
  const seen = new Set<string>();
  for (const d of deckCards) {
    const c = cardMap.get(d.cardId);
    if (!c) continue;
    let dp = deckMap.get(d.deckId);
    if (!dp) deckMap.set(d.deckId, (dp = { deckId: d.deckId, name: d.deckName, total: 0, "text-only": 0, incomplete: 0, unchecked: 0, done: 0 }));
    const key = `${d.deckId}|${d.cardId}`;
    if (seen.has(key)) continue; // a card in main and Z counts once per deck
    seen.add(key);
    dp.total++;
    dp[c.bucket]++;
  }

  const cards: CardProgress[] = [...cardMap.values()].map((c) => ({ cardId: c.cardId, name: c.name, appearances: c.appearances, copies: c.copies, bucket: c.bucket, skills: c.skills, ruleId: c.ruleId }));
  const skills = emptySkills();
  for (const c of cards) for (const k of RULE_HEALTHS) skills[k] += c.skills[k];
  return {
    decks: [...deckMap.values()].sort((a, b) => b.done / (b.total || 1) - a.done / (a.total || 1) || a.name.localeCompare(b.name)),
    cards: cards.sort((a, b) => b.appearances - a.appearances || a.cardId.localeCompare(b.cardId)),
    total: cards.length,
    done: cards.filter((c) => c.bucket === "done").length,
    skills,
  };
}

export async function loadProgress(db: Db, scope: OwnerScope): Promise<Progress> {
  const ownerWhere = scope === undefined ? sql`` : scope === null ? sql`and d.owner is null` : sql`and d.owner = ${scope}`;
  const deckCards = rows<DeckCardRow & { skill: string | null; backSkill: string | null }>(await db.execute(sql`
    select d.id as "deckId", d.name as "deckName", dc.card_id as "cardId", c.name as "cardName", dc.zone, dc.quantity,
           (coalesce(btrim(c.skill), '') <> '' or coalesce(btrim(c.back_skill), '') <> '') as "hasSkill",
           c.skill, c.back_skill as "backSkill"
    from decks d
    join deck_cards dc on dc.deck_id = d.id and dc.zone in ('main', 'z', 'leader')
    join cards c on c.id = dc.card_id
    where d.game = 'dbs' and d.is_testing = false ${ownerWhere}`));
  const ids = [...new Set(deckCards.map((r) => r.cardId))];
  if (!ids.length) return computeProgress([], []);
  const found = rows<HealthRow & { id: number; cardId: string; side: string; cond: unknown; reviewFlag: string | null; compilerDiff: unknown }>(await db.execute(sql`
    select id, card_id as "cardId", side, skill_index as "skillIndex", kind, printed, status, source, unread, ops, cond, cost, trigger,
           combo, usage, validity, review_flag as "reviewFlag", compiler_diff as "compilerDiff"
    from card_rules where card_id = any(${textArray(ids)})
    order by card_id, side, skill_index`));
  const rulesByCard = new Map<string, typeof found>();
  for (const r of found) (rulesByCard.get(r.cardId) ?? rulesByCard.set(r.cardId, []).get(r.cardId)!).push(r);
  // Only the rows that answer a printed skill count, as in a game (`rulesFromRows`); a printed skill
  // without one is a missing skill.
  const current: typeof found = [];
  const seenCard = new Set<string>();
  for (const d of deckCards) {
    if (seenCard.has(d.cardId)) continue;
    seenCard.add(d.cardId);
    const matched = currentRowsOf(d, rulesByCard.get(d.cardId) ?? []);
    d.missingSkills = matched.filter((m) => !m.row).length;
    for (const m of matched) if (m.row) current.push(m.row);
  }
  return computeProgress(deckCards, current.map((r) => ({ id: r.id, cardId: r.cardId, health: ruleHealth(r).health })));
}

/**
 * One row a day. The columns predate the four healths and keep their names: `confirmedCards` is the
 * cards that are done, `readSkills` the skills read but not checked, `unreadSkills` the text-only
 * ones and `flagged` the incomplete ones. History before 19 Oct 2026 counted the old buckets.
 */
export type SnapshotRow = { date: string; confirmedCards: number; totalCards: number; readSkills: number; unreadSkills: number; flagged: number };

/** Writes today's snapshot unless one exists (at most one a day), then returns the history oldest first. */
export async function recordAndReadSnapshots(db: Db, p: Progress, today = new Date().toISOString().slice(0, 10)): Promise<SnapshotRow[]> {
  await db
    .insert(rulesProgressSnapshots)
    .values({ snapshotDate: today, confirmedCards: p.done, totalCards: p.total, readSkills: p.skills.unchecked, unreadSkills: p.skills["text-only"], flagged: p.skills.incomplete })
    .onConflictDoNothing();
  const out = rows<SnapshotRow>(await db.execute(sql`
    select snapshot_date::text as date, confirmed_cards as "confirmedCards", total_cards as "totalCards",
           read_skills as "readSkills", unread_skills as "unreadSkills", flagged
    from rules_progress_snapshots order by snapshot_date`));
  return out;
}
