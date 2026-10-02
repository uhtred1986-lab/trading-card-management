/**
 * The phone's rule review queue (#472, `/arena/rules/review`): one skill at a
 * time, its printed text first, and one tap to say whether the engine reads it
 * right. This file is the part with no database and no React — what the text
 * view underlines, what each clause reads as, the one sentence under it, the
 * order of the queue and the words a "Wrong" verdict leaves on the row — so
 * `scripts/verify/rule-review.ts` can hold all of it on fixture cards.
 *
 * **Where a clause's printed words come from.** The record carries no span
 * data: the compiler keeps no clause → op bookkeeping (`draft.ts`'s
 * `programShape` reads its output, by design), so nothing on a `card_rules`
 * row says which printed words produced which step. What the row *does* carry
 * is text of its own, and a span here is only ever that text found in the
 * printed line, never an inference about it:
 *
 *   - `slice` — the clause is a piece the compiler or `parseSkills` cut out of
 *     the printed line and kept verbatim: every `unread` clause, and the
 *     cost's `text`. Found exactly once (exact case first, then any case), it
 *     is underlined; an unread one red and dashed.
 *   - `words` — the record's own plain-English reading of a WHEN, IF or DO
 *     clause (`describeTrigger`, `describeCond`, `describeScript`) appears in
 *     the printed line word for word, exactly once, on word boundaries
 *     ("when this card attacks", "draw 1", "negate the attack").
 *
 * Anything else — a reading in the engine's own words ("this card +5000 power
 * for the turn"), a phrase printed twice, a candidate that would overlap a
 * skill tag or a clause already placed — gets no span. It is listed under the
 * text with its reading instead, as the issue asks: a span is never guessed.
 *
 * Client-safe: everything it imports is pure.
 */
import { describeTrigger } from "./gaps";
import { keywordPlays } from "./glossary";
import { costSentence, describeCond, describeScript, type Cond, type CostRecord, type Op } from "./vm/script";
import type { RulePath } from "./lang/path";

/** The four clause blocks of a record, as the text view tags them. */
export type ClauseTag = "WHEN" | "COST" | "IF" | "DO";

/** What the text view needs off a `card_rules` row. */
export interface ReviewRecord {
  /** The row's `kind`: "auto", "activate:main", "permanent", "counter:attack"… */
  tag: string;
  printed: string;
  trigger: string[];
  cost: CostRecord | null;
  cond: Cond | null;
  ops: Op[];
  unread: string[];
  status: "open" | "draft" | "confirmed" | "corrected";
  pattern: string | null;
}

export interface Span {
  start: number;
  end: number;
}

/** How a span was tied to the printed words (see the file comment). */
export type TieBy = "slice" | "words";

export interface ReviewClause {
  /** Where the clause lives in the rule (`lang/path.ts`): `trigger[0]`, `cost`, `cond`, `ops[2]`, or the whole `ops`. */
  path: RulePath;
  tag: ClauseTag;
  /** The engine's reading of this clause, in its own words. */
  reads: string;
  span: Span | null;
  by: TieBy | null;
}

export interface UnreadClause {
  text: string;
  span: Span | null;
}

export type Segment =
  | { kind: "plain"; text: string }
  /** A bracketed skill tag: `[Auto]`, `[Once per turn]`. */
  | { kind: "tag"; text: string }
  | { kind: "clause"; text: string; clause: number }
  | { kind: "unread"; text: string; unread: number };

export interface ReviewText {
  /** The printed line, whitespace collapsed: every span indexes into this. */
  printed: string;
  segments: Segment[];
  /** Every clause the record reads, spanned or not, in rule order. */
  clauses: ReviewClause[];
  unread: UnreadClause[];
  /** "The engine will …": one sentence for the whole skill. */
  will: string;
  /** The engine plays this skill as blank: some of it is unread. */
  blank: boolean;
}

/** The printed line as the screen shows it. */
export function printedLine(printed: string): string {
  return printed.replace(/\s+/g, " ").trim();
}

/** Curly apostrophes and quotes read as straight ones, so "KO’d" finds "KO'd". Same length, so indices hold. */
function fold(s: string, caseless: boolean): string {
  const straight = s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  // ASCII only: `toLowerCase` may change a string's length, and the spans index the original.
  return caseless ? straight.replace(/[A-Z]/g, (c) => c.toLowerCase()) : straight;
}

const WORD = /[A-Za-z0-9]/;

/**
 * Where `needle` occurs in `hay` — only when it occurs exactly once. Twice is
 * two candidates, and choosing between them would be a guess.
 */
export function findOnce(hay: string, needle: string, o: { caseless?: boolean; words?: boolean } = {}): Span | null {
  const n = fold(needle.trim(), !!o.caseless);
  if (!n) return null;
  const h = fold(hay, !!o.caseless);
  const hits: number[] = [];
  for (let at = h.indexOf(n); at >= 0; at = h.indexOf(n, at + 1)) {
    if (o.words && ((at > 0 && WORD.test(h[at - 1]) && WORD.test(n[0])) || (at + n.length < h.length && WORD.test(h[at + n.length]) && WORD.test(n[n.length - 1])))) continue;
    hits.push(at);
    if (hits.length > 1) return null;
  }
  return hits.length === 1 ? { start: hits[0], end: hits[0] + n.length } : null;
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** The bracketed tags of a printed line: `[Auto]`, `[Activate:Main]`, `[Once per turn]`. */
function tagSpans(printed: string): Span[] {
  return [...printed.matchAll(/\[[^\]]*\]/g)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
}

/** The WHEN reading of a skill that names no moment: the tag says when the engine looks at it. */
export function whenLine(trigger: readonly string[], tag: string): string {
  const said = describeTrigger(trigger);
  if (said) return said;
  if (tag === "permanent") return "while this card is where the skill is valid";
  if (tag.startsWith("activate")) return "when you activate it";
  if (tag.startsWith("counter")) return "at the counter timing the tag names";
  return "at no moment the engine knows";
}

/** The keyword whose rule plays a keyword line with no steps of its own, if this is one. */
function keywordRule(r: Pick<ReviewRecord, "pattern" | "ops" | "cond">): string | null {
  if (r.ops.length || r.cond || !r.pattern?.startsWith("keyword:")) return null;
  return keywordPlays(r.pattern.slice("keyword:".length))?.tag ?? r.pattern.slice("keyword:".length);
}

/** Every clause the record reads, before any of them is placed on the text. */
export function clausesOf(r: ReviewRecord): Omit<ReviewClause, "span" | "by">[] {
  const permanent = r.tag === "permanent";
  const out: Omit<ReviewClause, "span" | "by">[] = [];
  if (r.trigger.length) r.trigger.forEach((t, i) => out.push({ path: `trigger[${i}]`, tag: "WHEN", reads: describeTrigger([t]) }));
  else out.push({ path: "trigger", tag: "WHEN", reads: whenLine([], r.tag) });
  const cost = costSentence(r.cost) ?? r.cost?.text ?? null;
  if (cost) out.push({ path: "cost", tag: "COST", reads: cost });
  if (r.cond) out.push({ path: "cond", tag: "IF", reads: describeCond(r.cond) });
  if (r.ops.length) r.ops.forEach((op, i) => out.push({ path: `ops[${i}]`, tag: "DO", reads: describeScript([op], { permanent }) }));
  else {
    const kw = keywordRule(r);
    // An open row with nothing read has no DO of its own: its unread clauses say what is missing.
    if (kw) out.push({ path: "ops", tag: "DO", reads: `played by the engine's ${kw} rule` });
    else if (r.status !== "open" || !r.unread.length) out.push({ path: "ops", tag: "DO", reads: "nothing" });
  }
  return out;
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "The engine will …": the whole skill in one sentence, or why it does nothing. */
export function willSentence(r: ReviewRecord): string {
  if (r.unread.length && r.status === "open") return "Nothing yet. Part of this skill is unread, so the engine plays the whole skill as blank.";
  const permanent = r.tag === "permanent";
  const program = r.cond ? [{ op: "if", cond: r.cond, then: r.ops } as Op] : r.ops;
  const kw = keywordRule(r);
  const body = describeScript(program, { permanent }) || (kw ? `play it by its ${kw} rule` : "do nothing");
  const cost = costSentence(r.cost);
  return `${cap(whenLine(r.trigger, r.tag))}${cost ? ` (cost: ${cost})` : ""}, ${body}.`;
}

/**
 * The text view of one record: the printed line cut into plain text, skill
 * tags and clauses, with every clause listed whether it has a span or not.
 */
export function reviewText(r: ReviewRecord): ReviewText {
  const printed = printedLine(r.printed);
  const taken: Span[] = tagSpans(printed);
  const claim = (span: Span | null): Span | null => {
    if (!span || taken.some((t) => overlaps(t, span))) return null;
    taken.push(span);
    return span;
  };

  // Slices first: they are the printed words themselves.
  const unread: UnreadClause[] = r.unread.map((text) => ({ text, span: claim(findOnce(printed, text) ?? findOnce(printed, text, { caseless: true })) }));
  const clauses: ReviewClause[] = clausesOf(r).map((c) => ({ ...c, span: null, by: null }));
  for (const c of clauses) {
    if (c.tag !== "COST" || !r.cost?.text) continue;
    c.span = claim(findOnce(printed, r.cost.text) ?? findOnce(printed, r.cost.text, { caseless: true }));
    c.by = c.span ? "slice" : null;
  }
  // Then the readings that are word for word on the card.
  for (const c of clauses) {
    if (c.tag === "COST" || c.span) continue;
    // A reading the engine made up for a skill with no record of its own to read is not printed anywhere.
    if (c.path === "trigger" || c.path === "ops") continue;
    c.span = claim(findOnce(printed, c.reads, { caseless: true, words: true }));
    c.by = c.span ? "words" : null;
  }

  type Mark = { span: Span } & ({ kind: "tag" } | { kind: "clause"; clause: number } | { kind: "unread"; unread: number });
  const marks: Mark[] = [
    ...tagSpans(printed).map((span) => ({ span, kind: "tag" as const })),
    ...clauses.flatMap((c, i) => (c.span ? [{ span: c.span, kind: "clause" as const, clause: i }] : [])),
    ...unread.flatMap((u, i) => (u.span ? [{ span: u.span, kind: "unread" as const, unread: i }] : [])),
  ].sort((a, b) => a.span.start - b.span.start);

  const segments: Segment[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.span.start > at) segments.push({ kind: "plain", text: printed.slice(at, m.span.start) });
    const text = printed.slice(m.span.start, m.span.end);
    if (m.kind === "tag") segments.push({ kind: "tag", text });
    else if (m.kind === "clause") segments.push({ kind: "clause", text, clause: m.clause });
    else segments.push({ kind: "unread", text, unread: m.unread });
    at = m.span.end;
  }
  if (at < printed.length) segments.push({ kind: "plain", text: printed.slice(at) });

  return { printed, segments, clauses, unread, will: willSentence(r), blank: r.status === "open" && r.unread.length > 0 };
}

// ── the queue ───────────────────────────────────────────────────────────────

/** What orders a skill in the queue. */
export interface QueueKey {
  status: string;
  cardId: string;
  skillIndex: number;
  name: string;
  timesSeen: number;
}

/**
 * Open first (the engine plays those as blank), then the drafts a recent game
 * actually fired, in the order it fired them, then the rest — the ones that
 * have come up in games before the ones that never have.
 */
export function orderQueue<T extends QueueKey>(rows: T[], fired: readonly { cardId: string; skillIndex: number }[] = []): T[] {
  const firedAt = new Map(fired.map((f, i) => [`${f.cardId}\u0000${f.skillIndex}`, i]));
  const rank = (r: T) => (r.status === "open" ? 0 : firedAt.has(`${r.cardId}\u0000${r.skillIndex}`) ? 1 : 2);
  const fireOrder = (r: T) => firedAt.get(`${r.cardId}\u0000${r.skillIndex}`) ?? 0;
  return [...rows].sort((a, b) => rank(a) - rank(b) || fireOrder(a) - fireOrder(b) || b.timesSeen - a.timesSeen || a.name.localeCompare(b.name) || a.cardId.localeCompare(b.cardId) || a.skillIndex - b.skillIndex);
}

// ── the Wrong verdict ───────────────────────────────────────────────────────

/** The reason chips of the Wrong sheet. */
export const WRONG_REASONS = ["reads it differently", "wrong timing or duration", "misses a condition", "wrong target", "something else"] as const;
export type WrongReason = (typeof WRONG_REASONS)[number];

/** How every flag from the phone opens, so the queue and the workbench can both tell one from any other explanation. */
export const FLAG_PREFIX = "Wrong (phone review)";

export interface WrongVerdict {
  tag: ClauseTag | "UNREAD";
  /** The clause the verdict is about (`lang/path.ts`), or null for the skill as a whole. */
  path: RulePath | null;
  reason: WrongReason;
  note?: string | null;
}

/**
 * The words a Wrong verdict leaves in `card_rules.explanation`: the clause and
 * the reason first, then the note — and whatever the row said before, kept
 * underneath so a flag never erases an earlier explanation.
 */
export function flagExplanation(v: WrongVerdict, previous: string | null): string {
  const note = v.note?.trim().replace(/\s+/g, " ").slice(0, 500);
  const head = `${FLAG_PREFIX} · ${v.tag}${v.path ? ` ${v.path}` : ""} · ${v.reason}${note ? ` — ${note}` : ""}`;
  return previous?.trim() ? `${head}\n\n${previous}` : head;
}

/** A draft someone has already flagged from the phone waits for the computer, not in the queue again. */
export function isFlagged(explanation: string | null | undefined): boolean {
  return !!explanation?.startsWith(FLAG_PREFIX);
}

/**
 * Where "Teach it" and "Fix it in the builder" go. The block builder (#469)
 * owns `/arena/rules/build/[id]`; until it is on `main`, the workbench record
 * is the place a rule is fixed, and this one line is what switches.
 */
export function builderHref(ruleId: number): string {
  return `/arena/rules?rule=${ruleId}`;
}
