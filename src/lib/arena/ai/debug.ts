/**
 * The record of how the opponent played, and the list of card text it could
 * not read.
 *
 * Both exist to be looked at afterwards. A game is only tunable if you can see
 * what Claude was shown, what it picked and what that cost; and the compiler
 * only improves if the clauses that defeat it are written down where they can
 * be worked through.
 */
import { eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaDecisions, cardTextNotes } from "@/db/schema";
import type { Op } from "../engine";
import { clauseShape } from "../gaps";
import { loadRules } from "../rules-store";

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
 * The open rows of `card_rules` are the whole test. A note whose clause no
 * longer stands unread on the card it is about is finished by definition, so
 * this reads every card that has an open note — not only the cards in a deck,
 * because a stale note on a card you have stopped playing is just as wrong.
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

  const ids = [...new Set(open.map((n) => n.cardId))];
  const stillUnread = new Set((await unreadClausesFor(db, ids)).map(noteKey));
  // A card with no rule row at all is no evidence that its clause now
  // compiles — nothing has drafted it — so its notes are left exactly as they are.
  const drafted = new Set((await loadRules(db, ids)).map((r) => r.cardId));
  const stale = open.filter((n) => drafted.has(n.cardId) && !stillUnread.has(noteKey(n))).map((n) => n.id);

  if (stale.length) await db.update(cardTextNotes).set({ status: "done" }).where(inArray(cardTextNotes.id, stale));
  return stale.length;
}

/** Every clause the compiler could not read, from the open rows of `card_rules`, ready for the backlog. */
export async function unreadClausesFor(db: Db, cardIds: string[]): Promise<{ cardId: string; skillIndex: number; clause: string; skillText: string }[]> {
  const out: { cardId: string; skillIndex: number; clause: string; skillText: string }[] = [];
  for (const row of await loadRules(db, cardIds)) {
    if (row.status !== "open") continue;
    for (const clause of row.unread) out.push({ cardId: row.cardId, skillIndex: row.skillIndex, clause, skillText: row.printed });
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
