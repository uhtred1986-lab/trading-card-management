/**
 * The record of how the opponent played, and the list of card text it could
 * not read.
 *
 * Both exist to be looked at afterwards. A game is only tunable if you can see
 * what Claude was shown, what it picked and what that cost; and the compiler
 * only improves if the clauses that defeat it are written down where they can
 * be worked through.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaDecisions, cardTextNotes, cards as cardsTable } from "@/db/schema";
import { compileCardCached, parseSkills, type CardDef, type Op } from "../engine";
import { clauseShape } from "../gaps";
import { cardDefFrom } from "../load";

export interface DecisionRecord {
  gameId: number;
  turn: number;
  phase: string;
  promptKind: string;
  player: string;
  kind: "move" | "referee";
  decidedBy: "rule" | "claude" | "fallback";
  how: string;
  model?: string | null;
  menu?: string[] | null;
  chosenIndex?: number | null;
  chosenLabel?: string | null;
  say?: string | null;
  /** Only kept when the game has debug turned on; it is the bulk of the row. */
  promptText?: string | null;
  spend?: { input: number; output: number; cached: number; micros: number } | null;
  latencyMs?: number | null;
}

export async function recordDecision(db: Db, rec: DecisionRecord): Promise<void> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${arenaDecisions.seq}), 0) + 1` })
    .from(arenaDecisions)
    .where(eq(arenaDecisions.gameId, rec.gameId));
  await db.insert(arenaDecisions).values({
    gameId: rec.gameId,
    seq: next,
    turn: rec.turn,
    phase: rec.phase,
    promptKind: rec.promptKind,
    player: rec.player,
    kind: rec.kind,
    decidedBy: rec.decidedBy,
    how: rec.how,
    model: rec.model ?? null,
    menu: rec.menu ?? null,
    chosenIndex: rec.chosenIndex ?? null,
    chosenLabel: rec.chosenLabel ?? null,
    say: rec.say ?? null,
    promptText: rec.promptText ?? null,
    inputTokens: rec.spend?.input ?? 0,
    outputTokens: rec.spend?.output ?? 0,
    cachedTokens: rec.spend?.cached ?? 0,
    costMicros: rec.spend?.micros ?? 0,
    latencyMs: rec.latencyMs ?? null,
  });
}

// ── the backlog of text the compiler cannot read ───────────────────────────

/**
 * A clause with its numbers and its card, character and trait names blanked,
 * so that "choose up to 2 of your <Son Goku> cards" and "choose up to 1 of
 * your <Vegeta> cards" land on the same row of the backlog. That grouping is
 * the whole point: one rule in the compiler usually clears many cards at once.
 */
/** Note that a card's clause could not be read. Safe to call repeatedly. */
export async function noteUnreadText(db: Db, entries: { cardId: string; skillIndex: number; clause: string; skillText: string }[], seen: boolean, ruling?: { ops: Op[]; why: string }): Promise<void> {
  for (const e of entries) {
    if (!e.clause.trim()) continue;
    await db
      .insert(cardTextNotes)
      .values({
        cardId: e.cardId,
        skillIndex: e.skillIndex,
        clause: e.clause,
        pattern: clauseShape(e.clause),
        skillText: e.skillText,
        timesSeen: seen ? 1 : 0,
        lastSeenAt: seen ? new Date() : null,
        lastRuling: ruling ? ruling.ops : null,
        lastRulingWhy: ruling?.why ?? null,
      })
      .onConflictDoUpdate({
        target: [cardTextNotes.cardId, cardTextNotes.skillIndex, cardTextNotes.clause],
        set: {
          timesSeen: seen ? sql`${cardTextNotes.timesSeen} + 1` : sql`${cardTextNotes.timesSeen}`,
          lastSeenAt: seen ? new Date() : sql`${cardTextNotes.lastSeenAt}`,
          ...(ruling ? { lastRuling: ruling.ops, lastRulingWhy: ruling.why } : {}),
        },
      });
  }
}

/** What makes one note the note for one clause of one skill of one card. */
const noteKey = (e: { cardId: string; skillIndex: number; clause: string }) => `${e.cardId} ${e.skillIndex} ${e.clause}`;

/**
 * Close the notes whose clause the compiler has since learned to read.
 *
 * Nothing ever re-checked a note and the list only ever grew, so a rule that
 * cleared a whole group left every one of its rows sitting open — and that
 * page is read as what is left to do. It overstated it badly: of the 133 notes
 * open on 7 Sep 2026, 120 were wordings the compiler already read.
 *
 * `unreadClausesOf` is the whole test. A note whose clause no longer comes
 * back from the card it is about is finished by definition, so this re-reads
 * every card that has an open note — not only the cards in a deck, because a
 * stale note on a card you have stopped playing is just as wrong.
 *
 * Only the status moves: what was ruled, explained or briefed stays on the
 * row, and a `wontfix` is never touched. A note reopened by hand will close
 * again on the next sweep if the clause reads, which is the right way round —
 * the count has to mean something, and `mark done` is still there for a clause
 * that reads but reads *wrongly*, which no measure here can see.
 *
 * Returns how many it closed.
 */
export async function closeNotesNowRead(db: Db): Promise<number> {
  const open = await db
    .select({ id: cardTextNotes.id, cardId: cardTextNotes.cardId, skillIndex: cardTextNotes.skillIndex, clause: cardTextNotes.clause })
    .from(cardTextNotes)
    .where(eq(cardTextNotes.status, "open"));
  if (!open.length) return 0;

  const rows = await db
    .select()
    .from(cardsTable)
    .where(inArray(cardsTable.id, [...new Set(open.map((n) => n.cardId))]));
  const stillUnread = new Set(rows.flatMap((r) => unreadClausesOf(cardDefFrom(r))).map(noteKey));
  // A card that could not be read back is no evidence that its clause now
  // compiles, so its notes are left exactly as they are.
  const reRead = new Set(rows.map((r) => r.id));
  const stale = open.filter((n) => reRead.has(n.cardId) && !stillUnread.has(noteKey(n))).map((n) => n.id);

  if (stale.length) await db.update(cardTextNotes).set({ status: "done" }).where(inArray(cardTextNotes.id, stale));
  return stale.length;
}

/** Every clause of a card the compiler cannot read, ready for the backlog. */
export function unreadClausesOf(card: CardDef): { cardId: string; skillIndex: number; clause: string; skillText: string }[] {
  const out: { cardId: string; skillIndex: number; clause: string; skillText: string }[] = [];
  for (const side of ["front", "back"] as const) {
    const text = side === "front" ? card.skill : card.back?.skill;
    if (!text) continue;
    const scripts = compileCardCached(card, side);
    for (const sk of parseSkills(text)) {
      const sc = scripts.bySkill[sk.index];
      if (!sc || !sc.unsupported.length) continue;
      for (const clause of sc.unsupported) out.push({ cardId: card.id, skillIndex: sk.index, clause, skillText: sk.raw });
    }
  }
  return out;
}

export async function setNoteStatus(db: Db, id: number, status: "open" | "done" | "wontfix"): Promise<void> {
  await db.update(cardTextNotes).set({ status }).where(eq(cardTextNotes.id, id));
}

/** The backlog, grouped by clause shape — the order to work through it in. */
export async function backlogByPattern(db: Db, status: "open" | "done" | "wontfix" | "all" = "open") {
  const rows = await db
    .select()
    .from(cardTextNotes)
    .where(status === "all" ? sql`true` : eq(cardTextNotes.status, status));
  const groups = new Map<string, { pattern: string; cards: typeof rows; timesSeen: number }>();
  for (const r of rows) {
    const g = groups.get(r.pattern) ?? { pattern: r.pattern, cards: [] as typeof rows, timesSeen: 0 };
    g.cards.push(r);
    g.timesSeen += r.timesSeen;
    groups.set(r.pattern, g);
  }
  // Text that has actually come up in a game first, then whatever affects most cards.
  return [...groups.values()].sort((a, b) => b.timesSeen - a.timesSeen || b.cards.length - a.cards.length);
}

export async function decisionsFor(db: Db, gameId: number) {
  return db.select().from(arenaDecisions).where(eq(arenaDecisions.gameId, gameId)).orderBy(arenaDecisions.seq);
}

export async function openNoteFor(db: Db, cardId: string, skillIndex: number) {
  return db.query.cardTextNotes.findFirst({ where: and(eq(cardTextNotes.cardId, cardId), eq(cardTextNotes.skillIndex, skillIndex)) });
}
