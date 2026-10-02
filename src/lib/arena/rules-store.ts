/**
 * `card_rules`, read and written. The only module that touches the table.
 *
 * A rule is a record the engine plays from, the workbench shows and a person
 * confirms or corrects — never something recomputed at game time. Everything
 * that changes a row goes through here so the reading (`reads`) and the
 * version stay honest.
 */
import { and, asc, eq, ilike, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { cardRules, cards } from "@/db/schema";
import { describeScript, type CardScripts, type Op } from "./vm/script";
import { type CardDef } from "./types";
import type { Cond, PayWith, SkillPrice, XCost } from "./vm/script";
import type { Trigger } from "./types";
import { clauseShape, mechanismOf, PHRASING_ONLY } from "./gaps";
import type { EngineId } from "./engines";

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

/**
 * The price the engine charges, off the row (4-3-3). Until 8 Sep 2026 the
 * engine rebuilt this from the card's text on every activation, against the
 * rule that it never compiles card text at game time; the drafter has written
 * both halves to `card_rules.cost` since phase 2, and this hands them over.
 *
 * A row with no `cost` is a skill with **no** price, which is not the same as
 * a skill whose price the compiler could not read \u2014 that one has a `cost`
 * with both halves null, and the engine refuses it rather than resolving an
 * effect it did not charge for.
 */
function priceOfRow(row: Pick<RuleRow, "cost">): SkillPrice {
  const cost = row.cost as { condition?: Cond | null; program?: Op[] | null; x?: XCost; payWith?: PayWith[] } | null;
  return { condition: cost?.condition ?? null, ops: cost?.program ?? null, ...(cost?.x ? { x: cost.x } : {}), ...(cost?.payWith?.length ? { payWith: cost.payWith } : {}) };
}

/** The key `ctx.scripts` is read by: the catalog id for a front, `<id>#back` for a leader's awakened side. */
function scriptsKey(cardId: string, side: Side): string {
  return side === "back" ? `${cardId}#back` : cardId;
}

export async function loadRules(db: Db, cardIds: string[]): Promise<RuleRow[]> {
  const ids = [...new Set(cardIds)];
  if (!ids.length) return [];
  return db.select().from(cardRules).where(inArray(cardRules.cardId, ids));
}

/**
 * The programs the engine reads, from rows and nothing else. A skill with no
 * row has no program: the engine plays it as blank and says so in the log,
 * which is what `arena:draft` is for.
 */
export async function rulesFor(db: Db, defs: Record<string, CardDef>): Promise<Record<string, CardScripts>> {
  return rulesFromRows(await loadRules(db, Object.keys(defs)), defs);
}

/** `rulesFor`'s reading of rows already fetched — for a caller that fetches them beside the cards rather than after (`games.ts`'s `loadGame`). */
export function rulesFromRows(rows: RuleRow[], defs: Record<string, CardDef>): Record<string, CardScripts> {
  const out: Record<string, CardScripts> = {};
  for (const row of rows) {
    const d = defs[row.cardId];
    if (!d) continue;
    const side: Side = row.side === "back" ? "back" : "front";
    const key = scriptsKey(row.cardId, side);
    const base = out[key] ?? { bySkill: {}, complete: true, unsupported: [] };
    // An open row has no program: the skill is played as blank, and the
    // unread clauses stay on it so the log and the referee can say why.
    const price = priceOfRow(row);
    // The WHEN comes off the row too, for the same reason the price does: the
    // workbench can edit it, and a trigger the engine did not read would make
    // that edit a label and nothing more (`skillAnswersTo` in `triggers.ts`).
    const trigger = (row.trigger ?? []) as Trigger[];
    base.bySkill[row.skillIndex] = row.status === "open" ? { ops: [], unsupported: row.unread, price, trigger } : { ops: programOf(row), unsupported: [], price, trigger };
    base.unsupported = Object.values(base.bySkill).flatMap((s) => s.unsupported);
    base.complete = base.unsupported.length === 0;
    out[key] = base;
  }
  return out;
}

export interface RuleWrite {
  cardId: string;
  side: Side;
  skillIndex: number;
  ops: Op[];
  source: RuleSource;
  status: RuleStatus;
  explanation?: string | null;
  /**
   * The rest of the record, when the caller edited it — the text view on the
   * workbench does, the JSON view and "does nothing" do not. Left out, each
   * keeps what the row has; `cost: null` is a price being *removed* and is not
   * the same as leaving it out, so the three are read with `!== undefined`.
   */
  trigger?: string[];
  cost?: unknown;
  cond?: Cond | null;
  /** Needed when the row does not exist yet; a row that exists keeps its own. */
  printed?: string;
  kind?: string;
}

/**
 * Write a record against a skill. A person's or Claude's program replaces
 * whatever was there and bumps the version; `reads` is regenerated so the row
 * never says one thing and does another.
 */
export async function saveRule(db: Db, w: RuleWrite): Promise<RuleRow> {
  const existing = await db.query.cardRules.findFirst({ where: and(eq(cardRules.cardId, w.cardId), eq(cardRules.side, w.side), eq(cardRules.skillIndex, w.skillIndex)) });
  const kind = existing?.kind ?? w.kind ?? "";
  // The hoisted condition is part of the program, so the reading has to be of
  // the whole thing; describing the steps alone dropped the IF from the line
  // the workbench shows back.
  const reads = describeScript(programOf({ ops: w.ops, cond: w.cond ?? null }), { permanent: kind.toLowerCase() === "permanent" });
  if (existing) {
    const [row] = await db
      .update(cardRules)
      .set({
        ops: w.ops,
        cond: w.cond ?? null,
        ...(w.trigger !== undefined ? { trigger: w.trigger } : {}),
        ...(w.cost !== undefined ? { cost: w.cost } : {}),
        source: w.source,
        status: w.status,
        explanation: w.explanation ?? existing.explanation,
        reads,
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
    .values({
      cardId: w.cardId,
      side: w.side,
      skillIndex: w.skillIndex,
      printed: w.printed,
      kind: w.kind,
      ops: w.ops,
      cond: w.cond ?? null,
      ...(w.trigger !== undefined ? { trigger: w.trigger } : {}),
      ...(w.cost !== undefined ? { cost: w.cost } : {}),
      source: w.source,
      status: w.status,
      explanation: w.explanation ?? null,
      reads,
    })
    .returning();
  return row;
}

/**
 * The work item for teaching the compiler this wording, and the owner's or
 * Claude's words about the card. Written beside the program rather than into
 * it: the program fixes this card, the brief fixes every card phrased the
 * same way, and only the second ends the problem.
 */
export async function setBrief(db: Db, id: number, brief: { brief?: string | null; explanation?: string | null }): Promise<void> {
  await db
    .update(cardRules)
    .set({ ...(brief.brief !== undefined ? { brief: brief.brief } : {}), ...(brief.explanation !== undefined ? { explanation: brief.explanation } : {}), updatedAt: new Date() })
    .where(eq(cardRules.id, id));
}

/**
 * This skill came up in a game and the referee had to rule on it. The count is
 * what sorts the same-wording groups: a wording that has actually been played is
 * worth teaching the compiler before one that has not.
 */
export async function markRuleSeen(db: Db, cardId: string, side: Side, skillIndex: number): Promise<void> {
  await db
    .update(cardRules)
    .set({ timesSeen: sql`${cardRules.timesSeen} + 1`, lastSeenAt: new Date() })
    .where(and(eq(cardRules.cardId, cardId), eq(cardRules.side, side), eq(cardRules.skillIndex, skillIndex)));
}

/** A person accepted the draft as it stands. */
export async function confirmRule(db: Db, id: number): Promise<void> {
  await db.update(cardRules).set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(cardRules.id, id));
}

/**
 * Put a confirmed or corrected rule back in front of a person (issue #361, *Reopen for review*):
 * the same write `undoConfirmed` makes — status `draft`, the program and its version untouched — for one rule.
 */
export async function reopenRule(db: Db, id: number): Promise<void> {
  await db.update(cardRules).set({ status: "draft", confirmedAt: null, updatedAt: new Date() }).where(and(eq(cardRules.id, id), inArray(cardRules.status, ["confirmed", "corrected"])));
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

// ── reads for the workbench ─────────────────────────────────────────────────

export type WorklistRow = RuleRow & {
  name: string;
  setCode: string;
  /** The card is an X-cost one whose specified cost nobody entered (`specifiedCostUnknown`). Filled by `worklistPage`. */
  costUnknown?: boolean;
};

/** Every rule of the given cards, with the card's name and set beside it. */
export async function worklist(db: Db, cardIds: string[]): Promise<WorklistRow[]> {
  const ids = [...new Set(cardIds)];
  if (!ids.length) return [];
  const rows = await db
    .select({ rule: cardRules, name: cards.name, setCode: cards.setCode })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(inArray(cardRules.cardId, ids));
  return rows.map((r) => ({ ...r.rule, name: r.name, setCode: r.setCode }));
}

export async function ruleById(db: Db, id: number): Promise<WorklistRow | null> {
  const [r] = await db
    .select({ rule: cardRules, name: cards.name, setCode: cards.setCode })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(eq(cardRules.id, id));
  return r ? { ...r.rule, name: r.name, setCode: r.setCode } : null;
}

/** The other rules that share a pattern key: how many, and five to look at. */
export async function siblingsOf(db: Db, row: Pick<RuleRow, "id" | "pattern">): Promise<{ count: number; ids: string[] }> {
  if (!row.pattern) return { count: 0, ids: [] };
  const rows = await db
    .select({ cardId: cardRules.cardId })
    .from(cardRules)
    .where(and(eq(cardRules.pattern, row.pattern), ne(cardRules.id, row.id)));
  const ids = [...new Set(rows.map((r) => r.cardId))];
  return { count: ids.length, ids: ids.slice(0, 5) };
}


// ── the worklist over the whole catalog ─────────────────────────────────────

/**
 * Which rules a page is looking at. Everything here is a column except
 * `mechanism`, which is read off the first unread clause of an open row and
 * so is applied in TypeScript — over the 2,183 open rows, not the 13,563.
 */
export interface RuleFilter {
  /** Only these cards. Absent is the whole catalog; empty matches nothing. */
  cardIds?: string[];
  status?: RuleStatus;
  setCode?: string;
  source?: RuleSource;
  pattern?: string;
  mechanism?: string;
  /** Card name, card id or printed text. */
  q?: string;
  /** Exactly these rules: the scope "fired in game X" (`firedInGame`). */
  ruleIds?: number[];
  /** Only rules whose card the compiler now reads differently from what is stored (`compiler_diff`). */
  compilerDiff?: boolean;
  /** Only rules of an X-cost card with no specified cost entered. */
  costUnknown?: boolean;
}

/** `specifiedCostUnknown` in SQL: `def.energyCost === "X" && !def.specifiedCost`. */
const COST_UNKNOWN = sql<boolean>`(${cards.energyCost} = 'X' and coalesce(${cards.specifiedCost}, '') = '')`;

/** The filter as SQL, minus the parts that are not columns. `ignoreStatus` is for the segment counts. */
function rulePredicate(f: RuleFilter, ignoreStatus = false): SQL | undefined {
  const cs: (SQL | undefined)[] = [];
  if (f.cardIds) cs.push(f.cardIds.length ? inArray(cardRules.cardId, [...new Set(f.cardIds)]) : sql`false`);
  // A mechanism is a property of an open row, so asking for one asks for open rows.
  if (f.mechanism) cs.push(eq(cardRules.status, "open"));
  else if (f.status && !ignoreStatus) cs.push(eq(cardRules.status, f.status));
  if (f.setCode) cs.push(eq(cards.setCode, f.setCode));
  if (f.source) cs.push(eq(cardRules.source, f.source));
  if (f.ruleIds) cs.push(f.ruleIds.length ? inArray(cardRules.id, [...new Set(f.ruleIds)]) : sql`false`);
  if (f.compilerDiff) cs.push(isNotNull(cardRules.compilerDiff));
  if (f.costUnknown) cs.push(COST_UNKNOWN);
  if (f.pattern) cs.push(eq(cardRules.pattern, f.pattern));
  if (f.q?.trim()) {
    const like = `%${f.q.trim()}%`;
    cs.push(or(ilike(cards.name, like), ilike(cardRules.cardId, like), ilike(cardRules.printed, like)));
  }
  return cs.length ? and(...cs) : undefined;
}

/** Open first — those are the ones the engine plays as blank — then drafts, corrections, confirmed. */
const STATUS_ORDER = sql`case ${cardRules.status} when 'open' then 0 when 'draft' then 1 when 'corrected' then 2 else 3 end`;

export interface WorklistPage {
  rows: WorklistRow[];
  /** How many the filter matches, not how many are on this page. */
  total: number;
}

/**
 * One page of the worklist. The catalog is 13,563 rules, so the page asks the
 * database for the rows it shows and counts the rest.
 */
export async function worklistPage(db: Db, f: RuleFilter, page: { limit: number; offset: number }): Promise<WorklistPage> {
  const base = db
    .select({ rule: cardRules, name: cards.name, setCode: cards.setCode, costUnknown: COST_UNKNOWN })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(rulePredicate(f))
    .$dynamic();

  // A mechanism cannot be asked of the database: it is read off the clause the
  // compiler could not read. Open rows are few enough to sort here.
  if (f.mechanism) {
    const all = (await base.orderBy(STATUS_ORDER, asc(cardRules.cardId), asc(cardRules.skillIndex))).map((r) => ({ ...r.rule, name: r.name, setCode: r.setCode, costUnknown: r.costUnknown }));
    const mine = all.filter((r) => mechanismOf(r.unread[0] ?? "") === f.mechanism);
    return { rows: mine.slice(page.offset, page.offset + page.limit), total: mine.length };
  }

  const [rows, counted] = await Promise.all([
    base.orderBy(STATUS_ORDER, asc(cardRules.cardId), asc(cardRules.skillIndex)).limit(page.limit).offset(page.offset),
    db.select({ n: sql<number>`count(*)::int` }).from(cardRules).innerJoin(cards, eq(cards.id, cardRules.cardId)).where(rulePredicate(f)),
  ]);
  return { rows: rows.map((r) => ({ ...r.rule, name: r.name, setCode: r.setCode, costUnknown: r.costUnknown })), total: counted[0]?.n ?? 0 };
}

/** The segment row's numbers: the same filter, counted per status, with the status itself ignored. */
export async function statusCounts(db: Db, f: RuleFilter): Promise<RuleCounts> {
  const out: RuleCounts = { open: 0, draft: 0, confirmed: 0, corrected: 0 };
  if (f.mechanism) {
    const { total } = await worklistPage(db, f, { limit: 0, offset: 0 });
    out.open = total;
    return out;
  }
  const rows = await db
    .select({ status: cardRules.status, n: sql<number>`count(*)::int` })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(rulePredicate(f, true))
    .groupBy(cardRules.status);
  for (const r of rows) if (r.status in out) out[r.status as RuleStatus] = r.n;
  return out;
}

/** Every set that has rules, for the All-cards filter. */
export async function setsWithRules(db: Db): Promise<{ setCode: string; n: number }[]> {
  const rows = await db
    .select({ setCode: cards.setCode, n: sql<number>`count(*)::int` })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .groupBy(cards.setCode);
  return rows.sort((a, b) => a.setCode.localeCompare(b.setCode));
}

// ── confirming in bulk, and taking it back ──────────────────────────────────

/**
 * What one bulk confirm changed. Kept whole rather than as a filter, because
 * Undo has to put back exactly the rows it moved: re-running the filter would
 * also catch drafts confirmed since, and miss rows the filter no longer
 * matches. The version is what tells "still as I left it" from "edited since".
 */
export interface ConfirmBatch {
  at: string;
  rules: { id: number; version: number }[];
}

/**
 * Confirm every draft the filter matches — the page's "Confirm all drafts in
 * view", and the same-wording groups's "Confirm the pattern", which is the same
 * thing keyed by `pattern`.
 */
export async function confirmMatching(db: Db, f: RuleFilter): Promise<ConfirmBatch> {
  // An open row is not a draft, so a mechanism filter never confirms anything.
  if (f.mechanism) return { at: new Date().toISOString(), rules: [] };
  const matching = db
    .select({ id: cardRules.id })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(and(rulePredicate(f, true), eq(cardRules.status, "draft")));
  const rules = await db
    .update(cardRules)
    .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
    .where(inArray(cardRules.id, matching))
    .returning({ id: cardRules.id, version: cardRules.version });
  return { at: new Date().toISOString(), rules };
}

/**
 * Put a bulk confirm back. A row edited since — its version has moved, or it
 * is no longer confirmed — is left exactly as it is and counted, because the
 * undo of a mistake must not undo the work that followed it.
 */
export async function undoConfirmed(db: Db, batch: ConfirmBatch): Promise<{ reverted: number; kept: number }> {
  let reverted = 0;
  const byVersion = new Map<number, number[]>();
  for (const r of batch.rules) byVersion.set(r.version, [...(byVersion.get(r.version) ?? []), r.id]);
  for (const [version, ids] of byVersion) {
    for (let i = 0; i < ids.length; i += 500) {
      const back = await db
        .update(cardRules)
        .set({ status: "draft", confirmedAt: null, updatedAt: new Date() })
        .where(and(inArray(cardRules.id, ids.slice(i, i + 500)), eq(cardRules.status, "confirmed"), eq(cardRules.version, version)))
        .returning({ id: cardRules.id });
      reverted += back.length;
    }
  }
  return { reverted, kept: batch.rules.length - reverted };
}

// ── the same rules, grouped by the wording that produced them ───────────────

/**
 * One group of the same-wording groups: rules that came out of the compiler the same
 * way, or open rules whose text defeats it the same way.
 *
 * Two groupings, because the two halves are worked down differently. A draft
 * group is one compiler reading over many cards, and the question is whether
 * that reading is right — answered once for all of them. An open group is one
 * wording the compiler cannot read, and the question is what it would take;
 * grouping those by clause shape alone gives 1,654 groups for 2,183 rows, so
 * they are gathered by mechanism first and shape within it.
 */
export interface PatternGroup {
  /** What a link filters on: the pattern key, or the mechanism. */
  key: string;
  kind: "draft" | "open";
  /** The wording, or the shape of it. */
  label: string;
  mechanism?: string;
  rules: number;
  cards: number;
  /** What is on file about the wording: the work item, the owner's words, and whether a game has met it. */
  brief: string | null;
  explanation: string | null;
  timesSeen: number;
  examples: { id: number; cardId: string; name: string; printed: string; reads: string; unread: string[] }[];
}

/** Five examples a group shows, in card order. */
const EXAMPLES = 5;

/** What the groups below are made from: the columns a group and its examples show, never the program. */
interface LightRow {
  id: number;
  cardId: string;
  name: string;
  setCode: string;
  printed: string;
  reads: string;
  unread: string[];
  status: RuleStatus;
  source: RuleSource;
  pattern: string | null;
  skillIndex: number;
  hasDiff: boolean;
  costUnknown: boolean;
  timesSeen: number;
  brief: string | null;
  explanation: string | null;
}

async function lightRows(db: Db, f: RuleFilter): Promise<LightRow[]> {
  const rows = await db
    .select({
      id: cardRules.id,
      cardId: cardRules.cardId,
      name: cards.name,
      setCode: cards.setCode,
      printed: cardRules.printed,
      reads: cardRules.reads,
      unread: cardRules.unread,
      status: cardRules.status,
      source: cardRules.source,
      pattern: cardRules.pattern,
      skillIndex: cardRules.skillIndex,
      hasDiff: isNotNull(cardRules.compilerDiff),
      costUnknown: COST_UNKNOWN,
      timesSeen: cardRules.timesSeen,
      brief: cardRules.brief,
      explanation: cardRules.explanation,
    })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(rulePredicate(f))
    .orderBy(asc(cardRules.cardId), asc(cardRules.skillIndex));
  const mine = f.mechanism ? rows.filter((r) => mechanismOf(r.unread[0] ?? "") === f.mechanism) : rows;
  return mine as LightRow[];
}

const exampleOf = (r: LightRow): PatternGroup["examples"][number] => ({ id: r.id, cardId: r.cardId, name: r.name, printed: r.printed, reads: r.reads, unread: r.unread ?? [] });

/**
 * Rules grouped by the reading they came out as. Drafts by default, since one
 * reading covers 400 cards and confirming it once is how 11,375 drafts are
 * ever reviewed; a filter narrows it to a scope, a set or a state.
 */
export async function draftPatterns(db: Db, limit = 60, f: RuleFilter = {}): Promise<PatternGroup[]> {
  const filter: RuleFilter = { ...f, status: f.status ?? "draft" };
  const rows = (await lightRows(db, filter)).filter((r) => r.pattern);
  const byPattern = new Map<string, LightRow[]>();
  for (const r of rows) byPattern.set(r.pattern!, [...(byPattern.get(r.pattern!) ?? []), r]);
  return [...byPattern.entries()]
    .map(([pattern, rs]) => ({
      key: pattern,
      kind: "draft" as const,
      label: pattern,
      rules: rs.length,
      cards: new Set(rs.map((r) => r.cardId)).size,
      brief: rs.find((r) => r.brief)?.brief ?? null,
      explanation: rs.find((r) => r.explanation)?.explanation ?? null,
      timesSeen: rs.reduce((n, r) => n + r.timesSeen, 0),
      examples: rs.slice(0, EXAMPLES).map(exampleOf),
    }))
    .sort((a, b) => b.timesSeen - a.timesSeen || b.rules - a.rules || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Open rules, grouped by what their first unread clause would need, then by its shape. */
export async function openPatterns(db: Db, f: RuleFilter = {}): Promise<PatternGroup[]> {
  const open = await lightRows(db, { ...f, status: "open" });
  const groups = new Map<string, PatternGroup & { cardIds: Set<string> }>();
  for (const r of open) {
    const clause = r.unread[0] ?? "";
    const mechanism = mechanismOf(clause);
    const label = clauseShape(clause);
    const key = `${mechanism}\u0000${label}`;
    const g = groups.get(key) ?? { key: mechanism, kind: "open" as const, label, mechanism, rules: 0, cards: 0, brief: null, explanation: null, timesSeen: 0, examples: [], cardIds: new Set<string>() };
    g.rules++;
    g.cardIds.add(r.cardId);
    g.timesSeen += r.timesSeen;
    g.brief ??= r.brief;
    g.explanation ??= r.explanation;
    if (g.examples.length < EXAMPLES) g.examples.push(exampleOf(r));
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ cardIds, ...g }) => ({ ...g, cards: cardIds.size }))
    // A wording a game has actually met is the one worth teaching the compiler first.
    .sort((a, b) => b.timesSeen - a.timesSeen || b.rules - a.rules || a.label.localeCompare(b.label));
}

/**
 * The queue's *Group by reason* and *Group by set*. A group is exactly the
 * filter it links to, which is what lets "Confirm all in view" mean the same
 * thing on a group as on a list — so a rule with two reasons is in two groups.
 * `patch` is the query-string change that turns a group into that filter.
 */
export interface QueueGroup extends PatternGroup {
  patch: Record<string, string>;
  /** The filter a Confirm on this group is aimed at, beyond the page's own; null when a group must be looked at rather than waved through. */
  confirm: Partial<RuleFilter> | null;
}

export async function reasonGroups(db: Db, f: RuleFilter): Promise<QueueGroup[]> {
  const rows = await lightRows(db, f);
  const make = (key: string, label: string, hit: LightRow[], patch: Record<string, string>, confirm: Partial<RuleFilter> | null, mechanism?: string): QueueGroup | null =>
    hit.length
      ? {
          key,
          kind: "open",
          label,
          mechanism,
          rules: hit.length,
          cards: new Set(hit.map((r) => r.cardId)).size,
          brief: null,
          explanation: null,
          timesSeen: hit.reduce((n, r) => n + r.timesSeen, 0),
          examples: hit.slice(0, 3).map(exampleOf),
          patch,
          confirm,
        }
      : null;
  const out: (QueueGroup | null)[] = [
    // A compiler disagreement is a decision (take its reading or keep yours), not something to confirm in bulk.
    make("diff", "The compiler reads it differently now", rows.filter((r) => r.hasDiff), { reason: "diff" }, null),
    make("claude", "Claude drafted, not yet confirmed", rows.filter((r) => r.source === "claude" && r.status === "draft"), { source: "claude", state: "draft" }, { source: "claude" }),
    make("cost", "Specified cost unknown", rows.filter((r) => r.costUnknown), { reason: "cost" }, { costUnknown: true }),
  ];
  const byMech = new Map<string, LightRow[]>();
  for (const r of rows) {
    if (r.status !== "open") continue;
    const m = mechanismOf(r.unread[0] ?? "");
    byMech.set(m, [...(byMech.get(m) ?? []), r]);
  }
  for (const [key, hit] of [...byMech.entries()].sort((a, b) => b[1].length - a[1].length)) {
    out.push(make(`mech:${key}`, key === PHRASING_ONLY ? "Unread: phrasing only" : `Unread: ${key}`, hit, { mech: key, state: "open" }, null, key));
  }
  return out.filter((g): g is QueueGroup => g !== null);
}

/** *Group by set*: one group per set the filter reaches, in set order. */
export async function setGroups(db: Db, f: RuleFilter): Promise<QueueGroup[]> {
  const rows = await lightRows(db, f);
  const bySet = new Map<string, LightRow[]>();
  for (const r of rows) bySet.set(r.setCode, [...(bySet.get(r.setCode) ?? []), r]);
  return [...bySet.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([setCode, hit]) => ({
      key: `set:${setCode}`,
      kind: "open" as const,
      label: setCode,
      rules: hit.length,
      cards: new Set(hit.map((r) => r.cardId)).size,
      brief: null,
      explanation: null,
      timesSeen: 0,
      examples: hit.slice(0, 3).map(exampleOf),
      patch: { set: setCode },
      confirm: { setCode },
    }));
}

/** The rules behind some fired skills: `{ cardId, skillIndex }`, on either side of the card. */
export async function ruleIdsFor(db: Db, skills: { cardId: string; skillIndex: number }[]): Promise<number[]> {
  if (!skills.length) return [];
  const rows = await db
    .select({ id: cardRules.id, cardId: cardRules.cardId, skillIndex: cardRules.skillIndex })
    .from(cardRules)
    .where(inArray(cardRules.cardId, [...new Set(skills.map((s) => s.cardId))]));
  const want = new Set(skills.map((s) => `${s.cardId}\u0000${s.skillIndex}`));
  return rows.filter((r) => want.has(`${r.cardId}\u0000${r.skillIndex}`)).map((r) => r.id);
}

/**
 * The last probe of a rule, as the row keeps it: what was tried, what it
 * concluded, and the digest a re-probe compares. Written when a person
 * confirms the rule — that is the moment the answer is worth keeping — and by
 * `arena:probe --fill` for the rows confirmed before there were probes.
 */
export interface StoredProbe {
  scenario: string;
  outcome: string;
  digest: string;
  applied: string[];
  result: string[];
  assumptions: string[];
  /** ISO day, so the record can say when the answer was taken. */
  at: string;
  /**
   * Which engine this probe was run on (#161: "one digest per engine, or the
   * digest records the engine" — the latter, since a rule keeps one probe at
   * a time). `npm run arena:reprobe` re-probes on this same engine unless
   * told otherwise, so a legacy-probed rule is not silently compared against
   * a rules-engine run of a different board.
   */
  engine: EngineId;
}

export async function setProbe(db: Db, id: number, probe: StoredProbe): Promise<void> {
  await db.update(cardRules).set({ probe, updatedAt: new Date() }).where(eq(cardRules.id, id));
}

/**
 * The owner's word on what should happen, board by board (#470) — the
 * rule's own tests, written from Try it as each board is judged. A judgement
 * is about the card rather than one version of its rule, which is why it is
 * kept as it is made and survives the rule being edited: a row whose new
 * result no longer matches is how Try it turns red. `[]` clears them.
 */
export async function setExpectations(db: Db, id: number, expectations: unknown[]): Promise<void> {
  await db
    .update(cardRules)
    .set({ expectations: expectations.length ? expectations : null, updatedAt: new Date() })
    .where(eq(cardRules.id, id));
}

/** Every rule that carries a judgement, for `arena:reprobe`'s "expected X, now Y". */
export async function expectedRules(db: Db): Promise<WorklistRow[]> {
  const rows = await db
    .select({ rule: cardRules, name: cards.name, setCode: cards.setCode })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(isNotNull(cardRules.expectations));
  return rows.map((r) => ({ ...r.rule, name: r.name, setCode: r.setCode }));
}

/** Every rule that carries a probe, for `arena:reprobe`. */
export async function probedRules(db: Db): Promise<WorklistRow[]> {
  const rows = await db
    .select({ rule: cardRules, name: cards.name, setCode: cards.setCode })
    .from(cardRules)
    .innerJoin(cards, eq(cards.id, cardRules.cardId))
    .where(isNotNull(cardRules.probe));
  return rows.map((r) => ({ ...r.rule, name: r.name, setCode: r.setCode }));
}
