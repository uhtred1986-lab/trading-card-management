/**
 * `card_rules`, read and written. The only module that touches the table.
 *
 * A rule is a record the engine plays from, the workbench shows and a person
 * confirms or corrects — never something recomputed at game time. Everything
 * that changes a row goes through here so the reading (`reads`) and the
 * version stay honest.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardRules } from "@/db/schema";
import { compileCardCached, describeScript, type CardDef, type CardScripts, type Op } from "./engine";
import type { Cond } from "./engine/script";

export type RuleRow = typeof cardRules.$inferSelect;
export type RuleStatus = "open" | "draft" | "confirmed" | "corrected";
export type RuleSource = "compiler" | "claude" | "user";
export type Side = "front" | "back";
export interface CompilerDiff {
  ops: Op[];
  unread: string[];
  at: string;
}

/** The program the engine runs: the hoisted condition, if any, wrapped back around the steps. */
export function programOf(row: Pick<RuleRow, "ops" | "cond">): Op[] {
  const ops = (row.ops as Op[]) ?? [];
  return row.cond ? [{ op: "if", cond: row.cond as Cond, then: ops }] : ops;
}

/** The key `ctx.scripts` is read by: the catalog id for a front, `<id>#back` for a leader's awakened side. */
export function scriptsKey(cardId: string, side: Side): string {
  return side === "back" ? `${cardId}#back` : cardId;
}

export async function loadRules(db: Db, cardIds: string[]): Promise<RuleRow[]> {
  const ids = [...new Set(cardIds)];
  if (!ids.length) return [];
  return db.select().from(cardRules).where(inArray(cardRules.cardId, ids));
}

/**
 * The programs the engine reads, from rows. Until the engine reads rows and
 * nothing else, skills without a row fall back to the compiler's reading so a
 * half-drafted catalog still plays.
 */
export async function rulesFor(db: Db, defs: Record<string, CardDef>): Promise<Record<string, CardScripts>> {
  const rows = await loadRules(db, Object.keys(defs));
  const out: Record<string, CardScripts> = {};
  for (const row of rows) {
    const d = defs[row.cardId];
    if (!d) continue;
    const side: Side = row.side === "back" ? "back" : "front";
    const key = scriptsKey(row.cardId, side);
    const base = out[key] ?? clone(compileCardCached(d, side));
    // An open row has no program: the skill is played as blank, and the
    // unread clauses stay on it so the log and the referee can say why.
    base.bySkill[row.skillIndex] = row.status === "open" ? { ops: [], unsupported: row.unread } : { ops: programOf(row), unsupported: [] };
    base.unsupported = Object.values(base.bySkill).flatMap((s) => s.unsupported);
    base.complete = base.unsupported.length === 0;
    out[key] = base;
  }
  return out;
}

function clone(s: CardScripts): CardScripts {
  return { bySkill: { ...s.bySkill }, complete: s.complete, unsupported: [...s.unsupported] };
}

export interface RuleWrite {
  cardId: string;
  side: Side;
  skillIndex: number;
  ops: Op[];
  source: RuleSource;
  status: RuleStatus;
  explanation?: string | null;
  /** Needed when the row does not exist yet; a row that exists keeps its own. */
  printed?: string;
  kind?: string;
}

/**
 * Write a program against a skill. A person's or Claude's program replaces
 * whatever was there and bumps the version; `reads` is regenerated so the row
 * never says one thing and does another.
 */
export async function saveRule(db: Db, w: RuleWrite): Promise<RuleRow> {
  const reads = describeScript(w.ops, { permanent: (w.kind ?? "").toLowerCase() === "permanent" });
  const existing = await db.query.cardRules.findFirst({ where: and(eq(cardRules.cardId, w.cardId), eq(cardRules.side, w.side), eq(cardRules.skillIndex, w.skillIndex)) });
  if (existing) {
    const [row] = await db
      .update(cardRules)
      .set({
        ops: w.ops,
        cond: null,
        source: w.source,
        status: w.status,
        explanation: w.explanation ?? existing.explanation,
        reads: describeScript(w.ops, { permanent: existing.kind.toLowerCase() === "permanent" }),
        unread: [],
        compilerDiff: null,
        version: sql`${cardRules.version} + 1`,
        confirmedAt: w.status === "confirmed" ? new Date() : existing.confirmedAt,
        updatedAt: new Date(),
      })
      .where(eq(cardRules.id, existing.id))
      .returning();
    return row;
  }
  if (w.printed == null || w.kind == null) throw new Error(`no rule row for ${w.cardId} ${w.side} [${w.skillIndex}] and no printed line to create one from`);
  const [row] = await db
    .insert(cardRules)
    .values({ cardId: w.cardId, side: w.side, skillIndex: w.skillIndex, printed: w.printed, kind: w.kind, ops: w.ops, source: w.source, status: w.status, explanation: w.explanation ?? null, reads })
    .returning();
  return row;
}

/** A person accepted the draft as it stands. */
export async function confirmRule(db: Db, id: number): Promise<void> {
  await db.update(cardRules).set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(cardRules.id, id));
}

/** The skill does nothing the engine should carry out — an empty program, owned by the person. */
export async function blankRule(db: Db, id: number, explanation: string | null): Promise<void> {
  await db
    .update(cardRules)
    .set({ ops: [], reads: "", unread: [], status: "corrected", source: "user", explanation, compilerDiff: null, version: sql`${cardRules.version} + 1`, updatedAt: new Date() })
    .where(eq(cardRules.id, id));
}

/** The drafter's note on a row it may not change: what the compiler reads now. Null clears it. */
export async function setCompilerDiff(db: Db, id: number, diff: CompilerDiff | null): Promise<void> {
  await db.update(cardRules).set({ compilerDiff: diff, updatedAt: new Date() }).where(eq(cardRules.id, id));
}

/** The person yields to the compiler's newer reading: the row becomes the compiler's draft again. */
export async function takeCompilerDiff(db: Db, id: number): Promise<void> {
  const row = await db.query.cardRules.findFirst({ where: eq(cardRules.id, id) });
  const diff = row?.compilerDiff as CompilerDiff | null | undefined;
  if (!row || !diff) return;
  await db
    .update(cardRules)
    .set({
      ops: diff.ops,
      cond: null,
      unread: diff.unread,
      reads: describeScript(diff.ops, { permanent: row.kind.toLowerCase() === "permanent" }),
      status: diff.unread.length ? "open" : "draft",
      source: "compiler",
      compilerDiff: null,
      confirmedAt: null,
      version: sql`${cardRules.version} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(cardRules.id, id));
}

export type RuleCounts = Record<RuleStatus, number>;

/** How many rules stand in each state, over the whole table or over some cards. */
export async function countRules(db: Db, cardIds?: string[]): Promise<RuleCounts> {
  const out: RuleCounts = { open: 0, draft: 0, confirmed: 0, corrected: 0 };
  if (cardIds && !cardIds.length) return out;
  const rows = await db
    .select({ status: cardRules.status, n: sql<number>`count(*)::int` })
    .from(cardRules)
    .where(cardIds ? inArray(cardRules.cardId, [...new Set(cardIds)]) : undefined)
    .groupBy(cardRules.status);
  for (const r of rows) if (r.status in out) out[r.status as RuleStatus] = r.n;
  return out;
}
