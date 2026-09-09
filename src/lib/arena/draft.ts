/**
 * The drafter: the compiler run offline over card text, writing *drafts* into
 * `card_rules` for a person to confirm or correct. This is the only module
 * that calls the compiler in production; the engine reads rows.
 *
 * What it may do to a row depends on who owns it. A row the compiler wrote
 * (`source: compiler`, status open or draft) is the compiler's to rewrite. A
 * row a person confirmed or corrected, or that Claude drafted, is never
 * touched in its program: the drafter records what the compiler reads *now*
 * as `compilerDiff`, and the workbench shows the two side by side.
 */
import { eq, inArray, and } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaFeedback, cardRules, cards as cardsTable, settings } from "@/db/schema";
import { hasAnthropic } from "@/lib/ai/client";
import { DEFAULT_GAME } from "@/lib/catalog/games";
import { compileCardCached, compileSkill, parseSkills, skillLines, type CardDef, type CardScripts, type KeywordSkill, type Op } from "./engine";
import { compileCostProgram, costText, priceCondition } from "./engine/compile";
import type { Cond, CostRecord } from "./engine/script";
import { describeScript } from "./engine/script";

/**
 * The price shape moved to `script.ts` on 9 Sep 2026, so the rules language
 * can print and parse a whole record without importing the drafter (which
 * reaches the database). The name is re-exported from where it was born.
 */
export type { CostRecord };
import { clauseShape, triggersOf } from "./gaps";
import { cardDefFrom } from "./load";
import { clarifyRule } from "./ai/clarify";
import { loadRules, programOf, type RuleRow, type Side } from "./rules-store";

/** One skill of one card face, as the drafter would write it. */
export interface SkillRecord {
  cardId: string;
  side: Side;
  skillIndex: number;
  printed: string;
  kind: string;
  trigger: string[];
  cost: CostRecord | null;
  cond: Cond | null;
  ops: Op[];
  unread: string[];
  pattern: string | null;
  reads: string;
}

/**
 * Every skill with text of its own, compiled. A keyword on a line by itself
 * ([Blocker], [Critical]) is a rule the engine plays natively and gets no
 * record; there is nothing a person could confirm about it.
 */
export function skillRecords(def: CardDef): SkillRecord[] {
  const out: SkillRecord[] = [];
  for (const side of ["front", "back"] as const) {
    const text = side === "front" ? def.skill : def.back?.skill;
    if (!text) continue;
    const lines = skillLines(text);
    for (const sk of parseSkills(text)) {
      if (!sk.effect.trim()) continue;
      const script = compileSkill(sk);
      const { cond, ops } = hoist(script.ops);
      const permanent = sk.kind === "permanent";
      const unread = script.unsupported;
      out.push({
        cardId: def.id,
        side,
        skillIndex: sk.index,
        printed: lines[Math.floor(sk.index / 10)] ?? sk.raw,
        kind: sk.kind,
        trigger: triggersOf(sk),
        cost: costRecord(sk),
        cond,
        ops,
        unread,
        pattern: patternKey(sk, unread, script.ops),
        reads: describeScript(script.ops, { permanent }),
      });
    }
  }
  return out;
}

function costRecord(sk: ReturnType<typeof parseSkills>[number]): CostRecord | null {
  const text = costText(sk.cost);
  const orbs = Object.fromEntries(Object.entries(sk.energyCost).filter(([, v]) => v)) as Record<string, number>;
  if (!text && !Object.keys(orbs).length && !sk.energyEither.length && sk.markerCost == null && sk.burst == null && sk.spiritBoost == null) return null;
  return {
    text,
    orbs,
    either: sk.energyEither,
    marker: sk.markerCost,
    burst: sk.burst,
    spiritBoost: sk.spiritBoost,
    condition: priceCondition(sk)?.cond ?? null,
    program: compileCostProgram(sk)?.ops ?? null,
  };
}

/**
 * How a record is grouped with its siblings: the shape of the first clause the
 * compiler could not read, or the shape of the program it produced.
 *
 * A skill with neither — no unread text and no program — is not "nothing".
 * 1,089 of them are keyword lines whose reminder or specification text
 * compiles to no steps because the keyword itself is the rule the engine
 * plays ("[Z-Stack 1] Yellow <Son Goku> …"), and grouping them under `null`
 * put the largest group on the Patterns page out of sight. They group by
 * keyword; the 47 that are genuinely empty group together as `nothing`.
 */
export function patternKey(sk: { keyword: KeywordSkill | null }, unread: string[], ops: Op[]): string {
  if (unread.length) return clauseShape(unread[0]);
  return programShape(ops) || (sk.keyword ? `keyword:${sk.keyword.name}` : "nothing");
}

/** A program that is exactly one `if` with no `else` is shown as IF + DO; anything else keeps its shape. */
export function hoist(ops: Op[]): { cond: Cond | null; ops: Op[] } {
  const only = ops.length === 1 ? ops[0] : null;
  if (only && only.op === "if" && !only.else?.length) return { cond: only.cond, ops: only.then };
  return { cond: null, ops };
}

/**
 * The shape of a program, for grouping drafts that the same compiler rules
 * produced: "choose→ko", "delay:turnEnd[ko]", "if:isTurnPlayer[power→grant]".
 * Read off the output rather than traced through the compiler, which keeps the
 * compiler free of bookkeeping and gives the same key for the same reading.
 */
export function programShape(ops: Op[]): string {
  return ops
    .map((o) => {
      switch (o.op) {
        case "if":
          return `if:${o.cond.kind}[${programShape(o.then)}${o.else ? `|${programShape(o.else)}` : ""}]`;
        case "delay":
          return `delay:${o.at}[${programShape(o.ops)}]`;
        case "may":
          return `may[${programShape(o.ops)}]`;
        case "chooseMode":
          return `choose one[${o.modes.map((m) => programShape(m.ops)).join("/")}]`;
        case "forbid":
          return `forbid:${o.what}`;
        case "grant":
          return `grant:${o.keyword.name}`;
        default:
          return o.op;
      }
    })
    .join("→");
}

export interface DraftSummary {
  cards: number;
  skills: number;
  inserted: number;
  /** Compiler rows whose reading changed. */
  updated: number;
  /** Person-owned rows the compiler now reads differently. */
  diffed: number;
  /** Person-owned rows whose diff went away because the compiler agrees again. */
  agreed: number;
  /** Compiler rows for skills the card no longer prints. */
  deleted: number;
}

/**
 * jsonb hands keys back in its own order and never saw a key whose value was
 * `undefined` (JSON.stringify drops those on the way in), so equality is read
 * off a key-sorted form with the same keys dropped. Without the second half
 * every pass rewrote 8,000 rows: the compiler's selectors carry `mode:
 * undefined` and friends, and `undefined` against a missing key read as a change.
 */
export function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v as object)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort()
        .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
    );
  return v ?? null;
}
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const compilerOwns = (r: RuleRow) => r.source === "compiler" && (r.status === "open" || r.status === "draft");

/**
 * Draft the given cards. `onlyOpen` leaves compiler drafts alone and only
 * fills gaps: rows that do not exist yet and rows still open.
 */
export async function draftCards(db: Db, ids: string[], opts: { onlyOpen?: boolean } = {}): Promise<DraftSummary> {
  const summary: DraftSummary = { cards: 0, skills: 0, inserted: 0, updated: 0, diffed: 0, agreed: 0, deleted: 0 };
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 400) {
    const slice = unique.slice(i, i + 400);
    // The arena plays the original game only; Fusion World text gets no rows.
    const rows = await db
      .select()
      .from(cardsTable)
      .where(and(inArray(cardsTable.id, slice), eq(cardsTable.game, DEFAULT_GAME)));
    const existing = new Map((await loadRules(db, slice)).map((r) => [`${r.cardId}#${r.side}#${r.skillIndex}`, r]));
    const inserts: (typeof cardRules.$inferInsert)[] = [];
    const seen = new Set<string>();
    const at = new Date().toISOString();

    for (const row of rows) {
      summary.cards++;
      for (const rec of skillRecords(cardDefFrom(row))) {
        summary.skills++;
        const key = `${rec.cardId}#${rec.side}#${rec.skillIndex}`;
        seen.add(key);
        const have = existing.get(key);
        const status = rec.unread.length ? "open" : "draft";
        if (!have) {
          inserts.push({ ...rec, status, source: "compiler" });
          summary.inserted++;
          continue;
        }
        if (compilerOwns(have)) {
          if (opts.onlyOpen && have.status !== "open") continue;
          const opsChanged = !same(have.ops, rec.ops) || !same(have.cond, rec.cond);
          const changed = opsChanged || !same(have.unread, rec.unread) || have.printed !== rec.printed || have.kind !== rec.kind || !same(have.trigger, rec.trigger) || !same(have.cost, rec.cost) || have.pattern !== rec.pattern || have.reads !== rec.reads || have.status !== status;
          if (!changed) continue;
          await db
            .update(cardRules)
            .set({ ...rec, status, ...(opsChanged ? { version: have.version + 1 } : {}), updatedAt: new Date() })
            .where(eq(cardRules.id, have.id));
          summary.updated++;
          continue;
        }
        // A row a person owns: the record is theirs. Refresh only what the
        // record is *about* — the printed line and the skill's tag, which come
        // off the card and are not editable — and note the compiler's own
        // reading beside it when the two differ. A skill the compiler cannot
        // read has no reading to offer: every Claude draft of an open skill was
        // getting a "the compiler reads this differently" strip that offered a
        // blank program with unread clauses.
        //
        // `trigger` and `cost` are **not** refreshed any more (9 Sep 2026).
        // They used to be, on the grounds that they were parsed metadata rather
        // than a reading; since Stage 1 the workbench can edit both and the
        // engine plays both off the row, so overwriting them here would revert
        // a person's WHEN or price on the next `arena:draft` with nothing
        // recording why. A `compilerDiff` for those two is Stage 2's.
        const fresh = rec.cond ? [{ op: "if" as const, cond: rec.cond, then: rec.ops }] : rec.ops;
        const differs = rec.unread.length === 0 && !same(fresh, programOf(have));
        const diff = differs ? { ops: fresh, unread: rec.unread, at } : null;
        const hadDiff = have.compilerDiff != null;
        const diffChanged = differs ? !same({ ops: (have.compilerDiff as { ops?: Op[] } | null)?.ops, unread: (have.compilerDiff as { unread?: string[] } | null)?.unread }, { ops: fresh, unread: rec.unread }) : hadDiff;
        const metaChanged = have.printed !== rec.printed || have.kind !== rec.kind;
        if (!diffChanged && !metaChanged) continue;
        await db
          .update(cardRules)
          .set({
            printed: rec.printed,
            kind: rec.kind,
            ...(diffChanged ? { compilerDiff: diff } : {}),
            updatedAt: new Date(),
          })
          .where(eq(cardRules.id, have.id));
        if (diffChanged) {
          if (differs) summary.diffed++;
          else summary.agreed++;
        }
      }
    }
    // Compiler rows for skills the card no longer prints (errata, a re-scrape).
    const stale = [...existing.values()].filter((r) => !seen.has(`${r.cardId}#${r.side}#${r.skillIndex}`) && compilerOwns(r) && rows.some((c) => c.id === r.cardId));
    if (stale.length) {
      await db.delete(cardRules).where(
        inArray(
          cardRules.id,
          stale.map((r) => r.id),
        ),
      );
      summary.deleted += stale.length;
    }
    for (let j = 0; j < inserts.length; j += 200) await db.insert(cardRules).values(inserts.slice(j, j + 200)).onConflictDoNothing();
  }
  return summary;
}

/** Every card of the original game, optionally one set. */
export async function catalogIds(db: Db, set?: string): Promise<string[]> {
  const rows = await db
    .select({ id: cardsTable.id })
    .from(cardsTable)
    .where(set ? and(eq(cardsTable.game, DEFAULT_GAME), eq(cardsTable.setCode, set)) : eq(cardsTable.game, DEFAULT_GAME));
  return rows.map((r) => r.id);
}

/**
 * What `rulesFor` would return had every card been drafted and every draft
 * confirmed — for the tests and the fuzzer, which have no database. Evaluated
 * on access and memoised, so a definition added to `defs` after the context
 * was built (the tests do this) has its rules too. The one place besides
 * `skillRecords` that compiles a whole card.
 */
export function rulesFromCompiler(defs: Record<string, CardDef>): Record<string, CardScripts> {
  // Memoised per definition object, not per id: a test that redefines a card
  // under the same id gets the new card's rules.
  return new Proxy({} as Record<string, CardScripts>, {
    get(_, key) {
      if (typeof key !== "string") return undefined;
      const [id, back] = key.split("#");
      const d = defs[id];
      return d ? compileCardCached(d, back === "back" ? "back" : "front") : undefined;
    },
  });
}

// ── new and changed cards at sync: what the compiler cannot read, Claude drafts ──

export interface ReviewSummary {
  /** Open rows put to Claude. */
  asked: number;
  /** …that came back as a program and are now Claude's drafts. */
  drafted: number;
  /** …that failed (no program, invalid, or an error), noted in `arena_feedback` and left open. */
  failed: number;
  /** Open rows left over, budget included. */
  stillOpen: number;
}

const DEFAULT_REVIEW_BUDGET = 400;

/** The review budget per sync run: a setting, so it is changed without a deploy. 0 means unlimited. */
export async function reviewBudget(db: Db): Promise<number> {
  const row = await db.query.settings.findFirst({ where: eq(settings.key, "arena") });
  const v = (row?.value as { reviewBudget?: unknown } | null)?.reviewBudget;
  return typeof v === "number" && v >= 0 ? v : DEFAULT_REVIEW_BUDGET;
}

/**
 * For every skill of these cards the compiler left open, ask Claude for a
 * program through the same path the workbench's "Explain to Claude" uses —
 * with nobody's explanation, so the prompt says "read the card yourself".
 * What comes back is Claude's draft (`source: claude`, `status: draft`) and is
 * listed under the worklist's "Claude drafted" chip for one sitting's review.
 * Every call is an `ai_runs` row, so the cost is visible.
 */
export async function reviewOpenRules(db: Db, ids: string[], opts: { budget?: number } = {}): Promise<ReviewSummary> {
  const budget = opts.budget ?? (await reviewBudget(db));
  const out: ReviewSummary = { asked: 0, drafted: 0, failed: 0, stillOpen: 0 };
  const open = (await loadRules(db, ids)).filter((r) => r.status === "open");
  out.stillOpen = open.length;
  if (!open.length) return out;
  if (!hasAnthropic()) {
    await db.insert(arenaFeedback).values({ kind: "rule", note: `review skipped: ${open.length} open rule${open.length === 1 ? "" : "s"} and no ANTHROPIC_API_KEY` });
    return out;
  }
  for (const row of open) {
    if (budget > 0 && out.asked >= budget) break;
    out.asked++;
    try {
      const r = await clarifyRule(db, row, null);
      if (r.saved) {
        out.drafted++;
        out.stillOpen--;
      } else {
        out.failed++;
        await db.insert(arenaFeedback).values({ kind: "rule", cardId: row.cardId, skillIndex: row.skillIndex, note: `Claude could not draft this at sync: ${r.clarification.question || r.clarification.meaning || "no program came back"}` });
      }
    } catch (err) {
      out.failed++;
      await db.insert(arenaFeedback).values({ kind: "rule", cardId: row.cardId, skillIndex: row.skillIndex, note: `Claude review failed at sync: ${err instanceof Error ? err.message : String(err)}` });
    }
  }
  return out;
}
