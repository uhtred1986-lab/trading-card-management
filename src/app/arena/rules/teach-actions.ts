"use server";

/**
 * The server half of the builder's two "Teach it" tabs (#473): "In my words"
 * and "Like a card". Both only *read* — what comes back is a `Rule` for the
 * builder to show as blocks, and nothing is saved until the owner saves there
 * (`saveRuleAction`). Both are refused to anyone who is not an arena admin,
 * because the first spends tokens and both show the engine's readings.
 *
 * In their own file rather than `app/arena/actions.ts`, which the builder
 * (#469) edits at the same time.
 */
import { and, eq, ilike, inArray, ne, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { cardRules, cards } from "@/db/schema";
import { describeAiError, hasAnthropic } from "@/lib/ai/client";
import { isArenaAdmin, requireSl } from "@/lib/auth";
import { claudeTeacher } from "@/lib/arena/ai/teach";
import { RULE_CLAUSES, type RuleClause } from "@/lib/arena/lang/path";
import { ruleById } from "@/lib/arena/rules-store";
import { clauseText, ruleOfRow } from "@/lib/arena/teach/common";
import { likePattern, rankLike, searchTerms, type LikeMatch, type LikeRow } from "@/lib/arena/teach/like";
import { MAX_QUESTIONS, teachInWords, type TeachOutcome, type TeachTurn } from "@/lib/arena/teach/words";

const MAX_SAID = 2000;

function clauseOf(raw: unknown): RuleClause | null {
  return typeof raw === "string" && (RULE_CLAUSES as readonly string[]).includes(raw) ? (raw as RuleClause) : null;
}

/** The answers so far, as the browser sent them: checked, never trusted. */
function turnsOf(raw: unknown): TeachTurn[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_QUESTIONS) return null;
  const out: TeachTurn[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") return null;
    const { question, options, answer } = t as Record<string, unknown>;
    if (typeof question !== "string" || typeof answer !== "string" || !Array.isArray(options) || options.some((o) => typeof o !== "string")) return null;
    out.push({ question: question.slice(0, 300), options: (options as string[]).slice(0, 4), answer: answer.slice(0, 300) });
  }
  return out;
}

/**
 * One turn of "In my words": the owner's explanation and the answers so far
 * go to Claude with the card, the clause and the record; a rule comes back
 * parsed and validated, or one question with tap answers, or why neither.
 */
export async function teachInWordsAction(ruleId: number, clause: RuleClause, said: string, turns: TeachTurn[]): Promise<TeachOutcome> {
  await requireSl();
  if (!(await isArenaAdmin())) return { kind: "error", message: "admins only" };
  const which = clauseOf(clause);
  const answered = turnsOf(turns);
  if (!which || !answered || typeof said !== "string") return { kind: "error", message: "that is not a question this panel asks" };
  if (!hasAnthropic()) return { kind: "error", message: "ANTHROPIC_API_KEY is not set — this needs Claude." };
  const row = await ruleById(db, ruleId);
  if (!row) return { kind: "error", message: "no such rule" };
  const [card] = await db.select({ cardType: cards.cardType, colors: cards.colors, energyCost: cards.energyCost, power: cards.power }).from(cards).where(eq(cards.id, row.cardId));
  const cardLine = card ? `${card.cardType}, ${card.colors.join("/") || "no colour"}, cost ${card.energyCost ?? "—"}, ${card.power ?? "—"} power` : "card details unknown";
  try {
    return await teachInWords(
      {
        ruleId: row.id,
        cardId: row.cardId,
        cardName: row.name,
        cardLine,
        printed: row.printed,
        kind: row.kind,
        clause: which,
        clauseWords: clauseText(row),
        unread: row.unread,
        current: ruleOfRow(row),
      },
      said.slice(0, MAX_SAID),
      answered,
      claudeTeacher(db, { ruleId: row.id, cardId: row.cardId, clause: which }),
    );
  } catch (err) {
    return { kind: "error", message: describeAiError(err) };
  }
}

export interface LikeResult {
  error: string | null;
  /** The words searched for: the clause being taught. */
  clauseWords: string;
  matches: LikeMatch[];
}

const POOL = 80;

/**
 * "Like a card": rules that say the same thing. The record's own `pattern`
 * first, then a text search over `card_rules.printed` — the clause's wording
 * with its numbers, colours and names left open, or the search box's words
 * when the owner typed some. The ranking, the highlight and the fitted copy
 * are `rankLike`'s.
 */
export async function likeCardsAction(ruleId: number, clause: RuleClause, query = ""): Promise<LikeResult> {
  await requireSl();
  if (!(await isArenaAdmin())) return { error: "admins only", clauseWords: "", matches: [] };
  const which = clauseOf(clause);
  if (!which) return { error: "no such clause", clauseWords: "", matches: [] };
  const row = await ruleById(db, ruleId);
  if (!row) return { error: "no such rule", clauseWords: "", matches: [] };
  const words = clauseText(row);
  const terms = searchTerms(typeof query === "string" ? query : "");

  // Checked rows and drafts are fetched apart, so a pattern with hundreds of
  // drafts cannot crowd the confirmed ones out of the pool.
  const pick = async (where: SQL | undefined) => {
    const q = (status: SQL) =>
      db
        .select({ rule: cardRules, name: cards.name })
        .from(cardRules)
        .innerJoin(cards, eq(cards.id, cardRules.cardId))
        .where(and(ne(cardRules.id, row.id), status, where))
        .limit(POOL / 2);
    return [...(await q(inArray(cardRules.status, ["confirmed", "corrected"]))), ...(await q(eq(cardRules.status, "draft")))];
  };
  const samePattern = row.pattern ? await pick(eq(cardRules.pattern, row.pattern)) : [];
  const byText = await pick(terms.length ? and(...terms.map((t) => ilike(cardRules.printed, t))) : ilike(cardRules.printed, likePattern(words)));

  const pool: LikeRow[] = [...samePattern, ...byText].map(({ rule: r, name }) => ({
    id: r.id,
    cardId: r.cardId,
    name,
    printed: r.printed,
    pattern: r.pattern,
    status: r.status,
    source: r.source,
    rule: ruleOfRow(r),
  }));
  const matches = rankLike({ id: row.id, pattern: row.pattern, clauseWords: words, rule: ruleOfRow(row) }, pool, which, { query });
  return { error: null, clauseWords: words, matches };
}
