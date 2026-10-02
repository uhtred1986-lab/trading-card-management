/**
 * The phone review queue's reads and the two writes of its own (#472). Every
 * write the queue makes besides these goes through the workbench's existing
 * actions unchanged — Reads right is `confirmRuleAction`, Undo of it is
 * `reopenRuleAction`, Confirm all is `confirmAllAction` and its Undo
 * `undoConfirmAction` — so this module adds only what had no action yet: a
 * Wrong verdict, which is words on the row (`explanation`) and a feedback note,
 * and its Undo. No column is added for either (the issue: no schema change).
 *
 * Takes `db` as an argument, like `rules-store.ts`, so `verify-db.mts` runs it
 * on PGlite.
 */
import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaFeedback, arenaGames, cardRules, cards } from "@/db/schema";
import { SKILL_LABELS } from "./beats";
import { firedInGame, type FiredSkill } from "./fired";
import { flagExplanation, isFlagged, orderQueue, type WrongVerdict } from "./rule-review";
import type { RuleRow } from "./rules-store";
import type { StoredProbe } from "./rules-store";
import type { Cond, CostRecord, Op } from "./vm/script";

/** One skill in the queue, as the phone gets it: the record, the card around it and what is known of its play. */
export interface ReviewItem {
  id: number;
  cardId: string;
  name: string;
  /** "Battle · Blue · cost 2". */
  meta: string;
  imageUrl: string | null;
  side: "front" | "back";
  skillIndex: number;
  /** The tag in words: "Auto", "Activate: Main". */
  kindLabel: string;
  /** …and as the row stores it ("auto"). */
  tag: string;
  printed: string;
  trigger: string[];
  cost: CostRecord | null;
  cond: Cond | null;
  ops: Op[];
  unread: string[];
  status: "open" | "draft" | "confirmed" | "corrected";
  source: "compiler" | "claude" | "user";
  pattern: string | null;
  explanation: string | null;
  timesSeen: number;
  probe: { outcome: string; at: string } | null;
  /** The game this skill fired in, when it is the recent game the queue was ordered by. */
  firedIn: number | null;
  decks: string[];
  /** Other unflagged drafts the same pattern produced — what "Confirm all" would also confirm. */
  sameWording: number;
}

type CardBits = { name: string; cardType: string; colors: string[]; energyCost: string | null; imageUrl: string | null };

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

function itemOf(rule: RuleRow, card: CardBits, extra: { decks: string[]; firedIn: number | null; sameWording: number }): ReviewItem {
  const probe = rule.probe as StoredProbe | null;
  const meta = [cap(card.cardType), card.colors.map(cap).join("/"), card.energyCost ? `cost ${card.energyCost}` : null].filter(Boolean).join(" · ");
  return {
    id: rule.id,
    cardId: rule.cardId,
    name: card.name,
    meta,
    imageUrl: card.imageUrl,
    side: rule.side === "back" ? "back" : "front",
    skillIndex: rule.skillIndex,
    kindLabel: SKILL_LABELS[rule.kind] ?? rule.kind,
    tag: rule.kind,
    printed: rule.printed,
    trigger: (rule.trigger as string[] | null) ?? [],
    cost: (rule.cost as CostRecord | null) ?? null,
    cond: (rule.cond as Cond | null) ?? null,
    ops: (rule.ops as Op[]) ?? [],
    unread: rule.unread,
    status: rule.status as ReviewItem["status"],
    source: rule.source as ReviewItem["source"],
    pattern: rule.pattern,
    explanation: rule.explanation,
    timesSeen: rule.timesSeen,
    probe: probe ? { outcome: probe.outcome, at: probe.at } : null,
    ...extra,
  };
}

const CARD_BITS = { name: cards.name, cardType: cards.cardType, colors: cards.colors, energyCost: cards.energyCost, imageUrl: cards.imageUrl };

/**
 * For each pattern, the unflagged drafts it produced. A flagged draft keeps its
 * pattern, and confirming it in bulk would undo the flag in silence, so it is
 * never counted, nor sent to `confirmAllAction`.
 */
export async function draftsByPattern(db: Db, patterns: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const keys = [...new Set(patterns.filter(Boolean))];
  if (!keys.length) return out;
  const rows = await db
    .select({ id: cardRules.id, pattern: cardRules.pattern, explanation: cardRules.explanation })
    .from(cardRules)
    .where(and(eq(cardRules.status, "draft"), inArray(cardRules.pattern, keys)));
  for (const r of rows) {
    if (!r.pattern || isFlagged(r.explanation)) continue;
    out.set(r.pattern, [...(out.get(r.pattern) ?? []), r.id]);
  }
  return out;
}

/** The drafts "Confirm all" on this row confirms: itself and every unflagged draft of the same pattern. */
export async function sameWordingIds(db: Db, ruleId: number): Promise<{ pattern: string; ids: number[] } | null> {
  const [row] = await db.select({ pattern: cardRules.pattern, status: cardRules.status }).from(cardRules).where(eq(cardRules.id, ruleId));
  if (!row?.pattern || row.status !== "draft") return null;
  const ids = (await draftsByPattern(db, [row.pattern])).get(row.pattern) ?? [];
  return ids.includes(ruleId) ? { pattern: row.pattern, ids } : null;
}

/**
 * The newest game that played this deck (or any deck), and the skills it
 * fired: what "drafts that fired in a recent game" means. A replay, like the
 * workbench's *fired in game* scope; a game that no longer replays is no game.
 */
export async function recentFired(db: Db, deckId: number | null): Promise<{ gameId: number | null; fired: FiredSkill[] }> {
  const where = deckId == null ? undefined : or(eq(arenaGames.p1DeckId, deckId), eq(arenaGames.p2DeckId, deckId));
  const [game] = await db.select({ id: arenaGames.id }).from(arenaGames).where(where).orderBy(desc(arenaGames.id)).limit(1);
  if (!game) return { gameId: null, fired: [] };
  try {
    return { gameId: game.id, fired: await firedInGame(db, game.id) };
  } catch {
    return { gameId: game.id, fired: [] };
  }
}

/**
 * The queue: the open and draft skills of these cards, in the order the phone
 * works them (`orderQueue`). A draft already flagged from the phone waits for
 * the computer and is left out.
 */
export async function reviewQueue(db: Db, o: { cardIds: string[]; decksOf: Map<string, string[]>; recent: { gameId: number | null; fired: FiredSkill[] } }): Promise<ReviewItem[]> {
  const ids = [...new Set(o.cardIds)];
  if (!ids.length) return [];
  const rows = await db
    .select({ rule: cardRules, card: CARD_BITS })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(and(inArray(cardRules.cardId, ids), inArray(cardRules.status, ["open", "draft"])));
  const live = rows.filter((r) => r.rule.status === "open" || !isFlagged(r.rule.explanation));
  const siblings = await draftsByPattern(
    db,
    live.filter((r) => r.rule.status === "draft").map((r) => r.rule.pattern ?? ""),
  );
  const fired = new Set(o.recent.fired.map((f) => `${f.cardId}\u0000${f.skillIndex}`));
  const items = live.map(({ rule, card }) =>
    itemOf(rule, card, {
      decks: o.decksOf.get(rule.cardId) ?? [],
      firedIn: fired.has(`${rule.cardId}\u0000${rule.skillIndex}`) ? o.recent.gameId : null,
      sameWording: rule.status === "draft" && rule.pattern ? Math.max(0, (siblings.get(rule.pattern)?.length ?? 1) - 1) : 0,
    }),
  );
  return orderQueue(items, o.recent.fired);
}

/** One skill as the queue shows it, read again after a write (Ask Claude). */
export async function reviewItemById(db: Db, id: number, extra: { decks: string[]; firedIn: number | null }): Promise<ReviewItem | null> {
  const [r] = await db.select({ rule: cardRules, card: CARD_BITS }).from(cardRules).innerJoin(cards, eq(cards.id, cardRules.cardId)).where(eq(cardRules.id, id));
  if (!r) return null;
  const siblings = r.rule.status === "draft" && r.rule.pattern ? ((await draftsByPattern(db, [r.rule.pattern])).get(r.rule.pattern)?.length ?? 1) - 1 : 0;
  return itemOf(r.rule, r.card, { ...extra, sameWording: Math.max(0, siblings) });
}

/** What Undo needs to take a Wrong verdict back exactly. */
export interface FlagReceipt {
  ruleId: number;
  previous: string | null;
  written: string;
  feedbackId: number;
}

/**
 * Wrong: the clause and the reason go into `explanation` (the earlier words
 * kept beneath), a note goes to the feedback list for the computer, and the
 * rule itself — status, program, version — is not touched. It stays a draft.
 */
export async function flagWrong(db: Db, ruleId: number, v: WrongVerdict, reportedBy: string | null = null): Promise<FlagReceipt | null> {
  const [row] = await db.select({ explanation: cardRules.explanation, cardId: cardRules.cardId, skillIndex: cardRules.skillIndex, printed: cardRules.printed, reads: cardRules.reads }).from(cardRules).where(eq(cardRules.id, ruleId));
  if (!row) return null;
  const written = flagExplanation(v, row.explanation);
  await db.update(cardRules).set({ explanation: written, updatedAt: new Date() }).where(eq(cardRules.id, ruleId));
  const [fb] = await db
    .insert(arenaFeedback)
    .values({ kind: "rule", cardId: row.cardId, skillIndex: row.skillIndex, noteId: ruleId, reportedBy, note: `${written.split("\n")[0]}: ${row.printed}`, resolution: row.reads || null })
    .returning({ id: arenaFeedback.id });
  return { ruleId, previous: row.explanation, written, feedbackId: fb.id };
}

/**
 * Undo of Wrong: the explanation goes back to what it was — only if it still
 * says what the flag wrote, so an undo never erases words added since — and
 * the feedback note is closed, not deleted, saying it was taken back.
 */
export async function unflagWrong(db: Db, r: FlagReceipt): Promise<{ restored: boolean }> {
  const back = await db
    .update(cardRules)
    .set({ explanation: r.previous, updatedAt: new Date() })
    .where(and(eq(cardRules.id, r.ruleId), eq(cardRules.explanation, r.written)))
    .returning({ id: cardRules.id });
  await db
    .update(arenaFeedback)
    .set({ status: "wontfix", resolution: "taken back on the phone" })
    .where(and(eq(arenaFeedback.id, r.feedbackId), eq(arenaFeedback.noteId, r.ruleId)));
  return { restored: back.length > 0 };
}

