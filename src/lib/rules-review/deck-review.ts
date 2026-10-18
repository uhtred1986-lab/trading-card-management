/**
 * The deck-first half of the rules-review connector (owner decision 18 Oct 2026): the cards in the owner's decks,
 * one packet each, and the only two writes the connector makes to `card_rules` — `confirm_rule` and `flag_rule`.
 *
 * Hard limits, all enforced here and tested on PGlite (`scripts/verify/rules-review-mcp.mts`):
 * - `confirm_rule` only turns a compiler `draft`/`open` row that is FULLY READ (no unread clause, a non-empty
 *   reading, nothing the engine could not run) and whose printed line is still the catalog's into `confirmed`. It
 *   never edits the program (`ops`, `cost`, `trigger`, `reads`), never touches a row a person already confirmed
 *   or corrected, never a Claude/user-sourced row.
 * - `flag_rule` only writes `review_flag`. It changes no status and no program.
 * - Queue and packets are scoped to the token's SL: decks of `slOwner(email)` or of nobody, game `dbs`, not testing
 *   (the same rule as `scripts/arena-immersion-inventory.mts`).
 */
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { cardRules, cards, deckCards, decks } from "@/db/schema";
import { slOwner } from "@/lib/auth/access";
import { parseSkills, skillLines } from "@/lib/arena/text/cards";
import faqData from "./faq.generated.json";
import { faqKey, type FaqByCard } from "./faq";
import { commentOnIssue, createIssue, findAssumptionIssues } from "./github";
import { flat } from "./wording";

const FAQ = faqData as FaqByCard;
const DONE = new Set(["confirmed", "corrected"]);
const ENERGY_MARKER = sql`upper(trim(${cards.cardType})) <> 'ENERGY MARKER'`;

export type Side = "front" | "back";

interface Row {
  id: number;
  cardId: string;
  side: string;
  skillIndex: number;
  kind: string;
  printed: string;
  reads: string;
  status: string;
  source: string;
  unread: string[];
  confirmedAt: Date | null;
  confirmedBy: string | null;
  confirmNote: string | null;
  reviewFlag: string | null;
}
interface CardInfo {
  id: string;
  name: string;
  backName: string | null;
  skill: string | null;
  backSkill: string | null;
}

const ruleCols = {
  id: cardRules.id,
  cardId: cardRules.cardId,
  side: cardRules.side,
  skillIndex: cardRules.skillIndex,
  kind: cardRules.kind,
  printed: cardRules.printed,
  reads: cardRules.reads,
  status: cardRules.status,
  source: cardRules.source,
  unread: cardRules.unread,
  confirmedAt: cardRules.confirmedAt,
  confirmedBy: cardRules.confirmedBy,
  confirmNote: cardRules.confirmNote,
  reviewFlag: cardRules.reviewFlag,
};
const cardCols = { id: cards.id, name: cards.name, backName: cards.backName, skill: cards.skill, backSkill: cards.backSkill };

const chunks = <T>(xs: T[], n = 500): T[][] => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** The line the catalog prints now for this skill, or null when it prints none (a row with a reused index is stale). */
export function currentPrinted(card: Pick<CardInfo, "skill" | "backSkill">, side: Side, skillIndex: number): string | null {
  const text = side === "front" ? card.skill : card.backSkill;
  const sk = parseSkills(text).find((s) => s.index === skillIndex);
  if (!sk || !sk.effect.trim()) return null;
  return skillLines(text)[Math.floor(skillIndex / 10)] ?? sk.raw;
}

/** Why `confirm_rule` would refuse this row, or null when it may be confirmed. */
export function confirmBlocker(row: Row, card: CardInfo): string | null {
  if (DONE.has(row.status)) return `already ${row.status}; a confirmed rule is never rewritten here`;
  if (row.status !== "draft" && row.status !== "open") return `status ${row.status} cannot be confirmed`;
  if (row.source !== "compiler") return `source is ${row.source}, not the compiler draft; only a compiler reading can be confirmed here`;
  if (row.unread.length > 0) return "it has an unread clause; the engine cannot read it yet, so there is nothing to confirm";
  if (!row.reads.trim()) return "it reads as nothing; flag it instead";
  const now = currentPrinted(card, row.side === "back" ? "back" : "front", row.skillIndex);
  if (now == null || now !== row.printed) return "the stored printed text no longer matches the current catalog; the row is stale";
  return null;
}

const keyOf = (r: Pick<Row, "cardId" | "side" | "skillIndex">) => `${r.cardId}${r.side === "back" ? "b" : ""}#${r.skillIndex}`;

function skillPacket(r: Row, card: CardInfo) {
  const blocker = confirmBlocker(r, card);
  return {
    key: keyOf(r),
    side: r.side,
    skillIndex: r.skillIndex,
    kind: r.kind,
    printed: r.printed,
    reading: r.reads || "(nothing)",
    status: r.status,
    unread: r.unread.map(flat),
    ...(r.reviewFlag ? { flagged: r.reviewFlag } : {}),
    ...(r.confirmedAt ? { confirmedAt: r.confirmedAt.toISOString(), confirmedBy: r.confirmedBy, confirmNote: r.confirmNote } : {}),
    canConfirm: blocker === null,
    ...(blocker && !DONE.has(r.status) ? { cannotConfirmBecause: blocker } : {}),
  };
}

const faqOf = (cardId: string) => FAQ[faqKey(cardId)] ?? [];

/** The owner's eligible decks: game dbs, not testing, owned by this SL's owner name or by nobody. */
async function eligibleDecks(db: Db, env: Record<string, string | undefined>, email: string) {
  const owner = await slOwner(db, email, env);
  const all = await db.select({ id: decks.id, name: decks.name, owner: decks.owner }).from(decks).where(and(eq(decks.game, "dbs"), eq(decks.isTesting, false)));
  return all.filter((d) => d.owner === owner || d.owner === null);
}

async function deckCardIndex(db: Db, deckList: { id: number; name: string }[]) {
  const names = new Map(deckList.map((d) => [d.id, d.name]));
  const byCard = new Map<string, Set<number>>();
  for (const part of chunks([...names.keys()])) {
    const rows = await db.select({ deckId: deckCards.deckId, cardId: deckCards.cardId }).from(deckCards).where(inArray(deckCards.deckId, part));
    for (const r of rows) (byCard.get(r.cardId) ?? byCard.set(r.cardId, new Set()).get(r.cardId)!).add(r.deckId);
  }
  return { names, byCard };
}

const decksOf = (ids: Set<number> | undefined, names: Map<number, string>) => ({
  count: ids?.size ?? 0,
  names: [...(ids ?? [])].map((i) => names.get(i) ?? "").sort((a, b) => a.localeCompare(b)),
});

async function rowsAndCards(db: Db, ids: string[]) {
  const rows: Row[] = [];
  const infos = new Map<string, CardInfo>();
  for (const part of chunks(ids)) {
    rows.push(
      ...((await db
        .select(ruleCols)
        .from(cardRules)
        .innerJoin(cards, eq(cards.id, cardRules.cardId))
        .where(and(inArray(cardRules.cardId, part), ENERGY_MARKER))
        .orderBy(asc(cardRules.cardId), asc(cardRules.side), asc(cardRules.skillIndex))) as Row[]),
    );
    for (const c of await db.select(cardCols).from(cards).where(inArray(cards.id, part))) infos.set(c.id, c);
  }
  return { rows, infos };
}

const num = (v: unknown, def: number, max: number) => Math.min(Math.max(Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : def, 0), max);

export async function deckReviewQueue(deps: { db: Db; env: Record<string, string | undefined>; email?: string }, args: Record<string, unknown>) {
  if (!deps.email) throw new Error("no signed-in SL on this token");
  const { db } = deps;
  const deckList = await eligibleDecks(db, deps.env, deps.email);
  const { names, byCard } = await deckCardIndex(db, deckList);
  const { rows, infos } = await rowsAndCards(db, [...byCard.keys()]);
  const rowsByCard = new Map<string, Row[]>();
  for (const r of rows) (rowsByCard.get(r.cardId) ?? rowsByCard.set(r.cardId, []).get(r.cardId)!).push(r);
  const todo = [...rowsByCard.entries()]
    .filter(([, rs]) => rs.some((r) => !DONE.has(r.status)))
    .map(([id, rs]) => ({ id, rs, n: byCard.get(id)?.size ?? 0 }))
    .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id));
  const offset = num(args.offset, 0, 100000);
  const limit = Math.max(1, num(args.limit, 3, 10));
  const page = todo.slice(offset, offset + limit);
  const skillsTotal = [...rowsByCard.values()].reduce((n, rs) => n + rs.length, 0);
  const skillsDone = [...rowsByCard.values()].reduce((n, rs) => n + rs.filter((r) => DONE.has(r.status)).length, 0);
  return {
    decks: deckList.length,
    deckCards: byCard.size,
    cardsToReview: todo.length,
    skillsConfirmed: skillsDone,
    skillsTotal,
    offset,
    nextOffset: offset + page.length < todo.length ? offset + page.length : null,
    cards: page.map(({ id, rs, n }) => {
      const info = infos.get(id)!;
      return {
        cardId: id,
        name: info.name,
        ...(info.backName ? { backName: info.backName } : {}),
        decks: decksOf(byCard.get(id), names),
        deckAppearances: n,
        skills: rs.map((r) => skillPacket(r, info)),
        faq: faqOf(id),
      };
    }),
  };
}

/** `BT1-001B` -> `BT1-001` (the "b" in a skill key is the back face, not part of the id). */
const idOf = (raw: unknown) => String(raw ?? "").trim().toUpperCase().replace(/(-\d+)B$/, "$1");

async function loadCard(db: Db, id: string) {
  const [info] = await db.select(cardCols).from(cards).where(sql`upper(${cards.id}) = ${id}`).limit(1);
  if (!info) throw new Error(`no card ${id || "(empty cardId)"}`);
  const rows = (await db.select(ruleCols).from(cardRules).where(eq(cardRules.cardId, info.id)).orderBy(asc(cardRules.side), asc(cardRules.skillIndex))) as Row[];
  return { info, rows };
}

export async function getCardReview(deps: { db: Db; env: Record<string, string | undefined>; email?: string; fetch?: typeof fetch }, args: Record<string, unknown>) {
  if (!deps.email) throw new Error("no signed-in SL on this token");
  const { info, rows } = await loadCard(deps.db, idOf(args.cardId));
  const deckList = await eligibleDecks(deps.db, deps.env, deps.email);
  const { names, byCard } = await deckCardIndex(deps.db, deckList);
  let openIssues: unknown = "GITHUB_ISSUES_TOKEN is not configured; open issues were not checked";
  if (deps.env.GITHUB_ISSUES_TOKEN) {
    try {
      openIssues = await findAssumptionIssues(deps.env.GITHUB_ISSUES_TOKEN, info.id, deps.fetch);
    } catch (e) {
      openIssues = `could not list issues: ${e instanceof Error ? e.message : "failed"}`;
    }
  }
  return {
    cardId: info.id,
    name: info.name,
    ...(info.backName ? { backName: info.backName } : {}),
    decks: decksOf(byCard.get(info.id), names),
    skills: rows.map((r) => skillPacket(r, info)),
    faq: faqOf(info.id),
    openRuleAssumptionIssues: openIssues,
  };
}

function skillArgs(args: Record<string, unknown>) {
  const side = args.side;
  const skillIndex = Number(args.skillIndex);
  if (side !== "front" && side !== "back") throw new Error('side must be "front" or "back"');
  if (!Number.isInteger(skillIndex) || skillIndex < 0) throw new Error("skillIndex must be a non-negative integer");
  return { id: idOf(args.cardId), side: side as Side, skillIndex };
}

export async function confirmRule(deps: { db: Db; env: Record<string, string | undefined>; email?: string }, args: Record<string, unknown>) {
  if (!deps.email) throw new Error("no signed-in SL on this token");
  const confirmation = String(args.confirmation ?? "").trim();
  if (!confirmation) throw new Error("confirmation (the owner's words, verbatim) is required");
  if (confirmation.length > 2000) throw new Error("confirmation is too long (2000 characters at most)");
  const { id, side, skillIndex } = skillArgs(args);
  const { info, rows } = await loadCard(deps.db, id);
  const row = rows.find((r) => r.side === side && r.skillIndex === skillIndex);
  if (!row) throw new Error(`${info.id} has no stored ${side} skill ${skillIndex}`);
  const blocker = confirmBlocker(row, info);
  if (blocker) throw new Error(`not confirmed: ${blocker}`);
  // The same conditions again in the UPDATE, so a row that moved since the read is not confirmed by mistake.
  const done = await deps.db
    .update(cardRules)
    .set({ status: "confirmed", confirmedAt: new Date(), confirmedBy: deps.email.trim().toLowerCase(), confirmNote: confirmation, reviewFlag: null, updatedAt: new Date() })
    .where(
      and(
        eq(cardRules.id, row.id),
        inArray(cardRules.status, ["draft", "open"]),
        eq(cardRules.source, "compiler"),
        eq(cardRules.printed, row.printed),
        eq(cardRules.reads, row.reads),
        sql`jsonb_array_length(${cardRules.unread}) = 0`,
      ),
    )
    .returning({ id: cardRules.id });
  if (!done.length) throw new Error("not confirmed: the row changed while confirming; read the card again");
  return {
    confirmed: true,
    key: keyOf(row),
    name: info.name,
    printed: row.printed,
    reading: row.reads,
    confirmedBy: deps.email.trim().toLowerCase(),
    confirmation,
    ...(row.reviewFlag ? { clearedFlag: row.reviewFlag } : {}),
  };
}

export async function flagRule(
  deps: { db: Db; env: Record<string, string | undefined>; email?: string; fetch?: typeof fetch },
  args: Record<string, unknown>,
) {
  if (!deps.email) throw new Error("no signed-in SL on this token");
  const reason = flat(String(args.reason ?? ""));
  if (!reason) throw new Error("reason is required");
  if (reason.length > 500) throw new Error("reason is too long (500 characters at most)");
  const { id, side, skillIndex } = skillArgs(args);
  const { info, rows } = await loadCard(deps.db, id);
  const row = rows.find((r) => r.side === side && r.skillIndex === skillIndex);
  if (!row) throw new Error(`${info.id} has no stored ${side} skill ${skillIndex}`);
  const stamp = new Date();
  const entry = `${stamp.toISOString().slice(0, 10)} ${deps.email.trim().toLowerCase()}: ${reason}`;
  const merged = row.reviewFlag ? `${row.reviewFlag}\n${entry}`.slice(-1000) : entry;
  // Only the flag column: status, program and confirmation stay exactly as they were.
  await deps.db.update(cardRules).set({ reviewFlag: merged }).where(eq(cardRules.id, row.id));
  const out: Record<string, unknown> = { flagged: true, key: keyOf(row), status: row.status, flag: merged };
  const wantsIssue = args.openIssue === true || args.issueNumber != null;
  if (wantsIssue) {
    const token = deps.env.GITHUB_ISSUES_TOKEN;
    try {
      if (!token) throw new Error("GITHUB_ISSUES_TOKEN is not configured");
      const text = `Suspected misread of ${keyOf(row)} (${info.name}), flagged from the rules-review connector.\n\n> ${row.printed}\n\nStored reading: ${row.reads || "(nothing)"}\n\nReason: ${reason}`;
      if (args.issueNumber != null) {
        const n = Number(args.issueNumber);
        if (!Number.isInteger(n) || n <= 0) throw new Error("issueNumber must be a positive integer");
        out.issue = await commentOnIssue(token, n, text, deps.fetch);
      } else {
        out.issue = await createIssue(token, `Misread: ${keyOf(row)} — ${reason}`.slice(0, 200), `${text}\n\nStatus: flagged — to be decided with the owner`, deps.fetch);
      }
    } catch (e) {
      out.issueError = e instanceof Error ? e.message : "failed"; // the flag is saved either way
    }
  }
  return out;
}
