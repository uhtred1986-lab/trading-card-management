/**
 * "In my words" (#473): the owner says what a clause means, Claude writes it
 * in the rules language, and the language — not Claude — decides whether it
 * is a rule.
 *
 * Pure. The model is a function handed in (`AskTeach`), so the loop below is
 * the same code whether it runs against Claude (`ai/teach.ts`) or against the
 * stub in `scripts/verify/teach.ts`. What the loop guarantees, whatever the
 * model says:
 *
 *   - a reply that is a rule is `parseRule` → `validateRule`d against the
 *     row's own skill tag; nothing else reaches the builder;
 *   - a rule that fails goes back to Claude **once**, with its `LangError` or
 *     its `Invalid`; a second failure is shown to the owner as it stands;
 *   - a reply that is a question carries 2–4 tap answers, and there are at
 *     most `MAX_QUESTIONS` of them — after that Claude is told it may not ask,
 *     and a question anyway ends the loop.
 *
 * Every turn is stateless: the panel holds the explanation and the answers so
 * far and sends them back each time, so the server keeps nothing between taps.
 */
import { z } from "zod";
import { parseRule, printRule, validateRule, type LangError, type Rule } from "../lang";
import { languageReference, type RefField } from "../lang/reference";
import type { RuleClause } from "../lang/path";
import { CLAUSE_WORD, readClause, readRuleWords } from "./common";

export const MAX_QUESTIONS = 3;
/** A question's tap answers: fewer than two is not a choice, more than four does not fit a phone. */
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;

/** What Claude answers, as structured output. One of the two halves is empty. */
export const TeachReplySchema = z.object({
  reply: z.enum(["rule", "question"]).describe("`rule` when the meaning is clear enough to write; `question` only when it is genuinely ambiguous"),
  rule: z.string().describe("The WHOLE rule in the rules language, WHEN … THEN, when `reply` is `rule`. Empty when asking."),
  meaning: z.string().max(300).describe("One sentence: what the clause does, in plain rules terms. Empty when asking."),
  question: z.string().max(200).describe("The one question that settles the ambiguity, when `reply` is `question`. Empty otherwise."),
  options: z.array(z.string().max(90)).describe("2 to 4 short tap answers to the question. Empty when writing a rule."),
});
export type TeachReply = z.infer<typeof TeachReplySchema>;

/** One question Claude asked and what the owner tapped. */
export interface TeachTurn {
  question: string;
  options: string[];
  answer: string;
}

/** Everything about the skill Claude is told, read off the row and its card. */
export interface TeachContext {
  ruleId: number;
  cardId: string;
  cardName: string;
  /** "BATTLE, Blue, cost 2, 10000 power" — the card's face, for a model that has not seen it. */
  cardLine: string;
  /** The skill line as printed. */
  printed: string;
  /** The row's skill tag ("auto", "activate:main"); the rule must keep it. */
  kind: string;
  /** Which block the owner is teaching. */
  clause: RuleClause;
  /** The words of that clause (`clauseText`). */
  clauseWords: string;
  /** What the compiler could not read, if anything. */
  unread: string[];
  /** The record as it stands. */
  current: Rule;
}

/** What one call to the model sees. `system` is stable across calls (and cached); `user` is this turn. */
export interface TeachPrompt {
  system: string;
  user: string;
}

export type AskTeach = (prompt: TeachPrompt) => Promise<TeachReply>;

/** The problem a rule text had: the parser's, or the validator's. */
export interface TeachProblem {
  message: string;
  /** Present when the text did not parse. */
  langError?: LangError;
}

export type TeachOutcome =
  | {
      kind: "rule";
      rule: Rule;
      /** `printRule(rule)` — what the builder's Text view will show. */
      text: string;
      /** The taught clause, read back. */
      clauseReads: string;
      /** The whole rule, read back. */
      reads: string;
      meaning: string;
      /** True when the first text failed and the second one passed. */
      retried: boolean;
    }
  | { kind: "question"; question: string; options: string[]; asked: number }
  | { kind: "error"; message: string; text?: string; problem?: TeachProblem };

// ── the language, as the prompt says it ─────────────────────────────────────

/**
 * The grammar of a rule. The one part of the prompt that is written out by
 * hand: the grammar has no table to generate it from (`docs/arena-rules-
 * language.md` §3 is where it lives, and that file is not deployed). Every
 * statement, condition, field and word below it comes off `languageReference()`.
 */
export const GRAMMAR = `A rule is four clauses, in this order. Only WHEN and THEN are required.

WHEN [kind] trigger | trigger      -- the skill's printed tag in brackets (READ-ONLY: keep it exactly), then the moments it answers to
COST item, item, …                 -- the price: {Red}{any}, {Red/Blue}, -1 marker, burst N, X, IF cond, DO { stmt … }
IF cond                            -- a condition the whole effect needs
THEN                               -- the steps, one per line, indented
  stmt(field: value, …)

A condition is name(field: value, …), or a comparison such as count(SEL) >= 3 or life(you) <= 4,
combined with AND, OR, NOT and parentheses.
A selector (SEL) is parts in any order: a number (how many), UP TO n, TOP n, a filter, IN side.zone,
flags (rest, active, otherThanSelf, …), [self] / [leader] / … for a special target, FROM $name for cards an earlier step bound.
A filter is either printed words in quotes ("blue card with an energy cost of 3 or less") or the exact field form
(colors = [Blue] AND costMax = 3). Prefer the field form: it cannot be misread.
A value that is a plain word is bare; anything with a space or hyphen is quoted. Lists are [a, b]. Bound cards are $name.
-- starts a comment; do not write one.

Examples:
WHEN [auto] played
THEN
  draw(n: 1)

WHEN [activate:main]
COST {Red}{any}, IF leaderColor(color: Red)
IF life(you) <= 4
THEN
  choose(sel: 1 "battle card with an energy cost of 3 or less" IN opponent.battle, as: "t")
  ko(target: $t)

WHEN [auto] attacks
IF count((colors = [Blue]) IN you.drop) >= 3
THEN
  draw(n: 1)`;

function fieldType(f: RefField): string {
  if (f.type === "enum") return (f.enumValues ?? []).join("|");
  if (f.type === "list") return f.listOf === "enum" ? `[${(f.enumValues ?? []).join("|")}]` : "[text]";
  return f.type;
}

function signature(name: string, fields: RefField[]): string {
  // `offCard` fields belong to keyword bodies; no card's rule writes them.
  const shown = fields.filter((f) => !f.offCard);
  return `${name}(${shown.map((f) => `${f.name}${f.required ? "" : "?"}: ${fieldType(f)}`).join(", ")})`;
}

/** Above this the reference drops its per-row docs first, then the sentences. A budget, not a target. */
export const REFERENCE_BUDGET = 30_000;

/**
 * The language reference as the prompt carries it: `languageReference()`
 * rendered as one line per statement and condition, then the selector, the
 * filter, the expressions, the price items and the WHEN moments. Statements no
 * printed card uses (a keyword body's own words, `OpSpec.offCard`) are left
 * out. Trimmed to `budget` characters by dropping detail, never rows: a row
 * left out is a statement Claude cannot know exists.
 */
export function languageForPrompt(budget = REFERENCE_BUDGET): string {
  const ref = languageReference();
  const render = (detail: 0 | 1 | 2) => {
    const tail = (sentence: string, doc?: string) => (detail === 0 ? "" : ` — ${sentence}${detail === 2 && doc ? ` (${doc.replace(/\s+/g, " ").slice(0, 160)})` : ""}`);
    const v = ref.literals;
    return [
      "THE RULES LANGUAGE",
      GRAMMAR,
      "",
      "STATEMENTS (after THEN). A field marked ? may be left out. The first required field may be written without its name.",
      ...ref.ops.filter((o) => !o.offCard).map((o) => `  ${signature(o.name, o.fields)}${tail(o.sentence, o.doc)}`),
      "",
      "CONDITIONS (after IF, in a COST's IF, in if(cond: …)).",
      ...ref.conds.map((c) => `  ${signature(c.kind, c.fields)}${tail(c.sentence, c.doc)}`),
      "",
      "SELECTOR FLAGS: " + ref.selectorFlags.map((f) => (detail === 0 ? f.word : `${f.word} (${f.doc.split(" — ")[0]})`)).join("; "),
      "",
      "FILTER FIELDS, for (field = value AND …):",
      ...ref.filterFields.map((f) => `  ${f.field}: ${f.type}${detail === 0 ? "" : ` — e.g. "${f.printed}"`}`),
      "",
      "EXPRESSIONS (where an amount goes): " + ref.expressions.map((e) => e.maxExample ?? e.example).join(", ") + `, a number, $name, and + n / - n. Attributes: ${ref.exprAttrs.join(", ")}.`,
      "",
      "PRICE ITEMS (COST): " + ref.costItems.map((c) => (detail === 0 ? c.syntax : `${c.syntax} — ${c.doc}`)).join("; "),
      "",
      "WHEN MOMENTS: " + ref.triggers.map((t) => (detail === 0 ? t.name : `${t.name} (${t.words})`)).join("; "),
      "",
      "WORDS:",
      ...v.map((l) => `  ${l.written} — ${l.is}`),
    ].join("\n");
  };
  for (const detail of [2, 1, 0] as const) {
    const text = render(detail);
    if (text.length <= budget || detail === 0) return text;
  }
  return render(0);
}

const SYSTEM_INTRO = `You turn a card game player's plain-words explanation of one card skill into a rule in a small rules language that a game engine runs. The game is the Dragon Ball Super Card Game (Masters).

You answer with exactly one of two things:
- reply "rule": the WHOLE rule for this skill in the rules language below, WHEN … THEN. Keep every clause the record already reads correctly; write the clause the owner is teaching from their explanation. Trust the owner over your own reading of the card where they differ, and say so in "meaning".
- reply "question": only when the explanation and the card together are genuinely ambiguous in a way that changes the rule (for example: does a card that is blue and another colour count as blue?). Ask ONE short question with 2 to 4 short tap answers. Never ask what the card or the language already answers.

Use only statements, conditions, fields and words that appear in the reference. Write the skill's tag in WHEN exactly as given.`;

/** The stable half of the prompt: the same bytes on every call, so it is cached. */
export function teachSystem(): string {
  return `${SYSTEM_INTRO}\n\n${languageForPrompt()}`;
}

/** This turn: the card, the clause, the record as it stands, the owner's words, the answers so far, and — on the retry — what was wrong. */
export function teachUser(ctx: TeachContext, said: string, turns: TeachTurn[], opts: { mayAsk: boolean; failed?: { text: string; problem: TeachProblem } }): string {
  const lines = [
    `CARD: ${ctx.cardName} (${ctx.cardId}), ${ctx.cardLine}.`,
    `THE SKILL AS PRINTED: ${ctx.printed.replace(/\s+/g, " ")}`,
    `ITS TAG (keep it): [${ctx.kind}]`,
    "",
    `THE OWNER IS TEACHING THE ${CLAUSE_WORD[ctx.clause]} CLAUSE, about these words: "${ctx.clauseWords}"`,
    ctx.unread.length ? `The engine could not read: ${ctx.unread.map((u) => `"${u}"`).join("; ")}` : "The engine read every word, but the owner says it reads this part wrongly.",
    "",
    "THE RECORD AS IT STANDS:",
    printRule(ctx.current),
    `(reads: ${readRuleWords(ctx.current)})`,
    "",
    "THE OWNER EXPLAINS IT LIKE THIS:",
    said.trim(),
  ];
  if (turns.length) {
    lines.push("", "YOU ASKED, AND THE OWNER ANSWERED:");
    for (const t of turns) lines.push(`Q: ${t.question}`, `A: ${t.answer}`);
  }
  if (opts.failed) {
    const e = opts.failed.problem.langError;
    lines.push(
      "",
      "YOUR LAST RULE WAS REFUSED. It was:",
      opts.failed.text,
      e ? `The parser stopped at line ${e.line}, column ${e.col} (${e.clause}): ${e.message}. The line: ${e.lineText.trim()}${e.expected.length ? ` — it expected one of: ${e.expected.slice(0, 24).join(", ")}${e.expected.length > 24 ? ", …" : ""}` : ""}` : `The checker said: ${opts.failed.problem.message}`,
      "Write the rule again, fixed.",
    );
  }
  lines.push("", opts.mayAsk ? `Give the rule, or one question if it is genuinely ambiguous (${MAX_QUESTIONS - turns.length} question${MAX_QUESTIONS - turns.length === 1 ? "" : "s"} left).` : "You may not ask anything more. Give the rule.");
  return lines.join("\n");
}

/** A rule text through the language: parsed, then checked against the row's own tag. */
export function checkRuleText(text: string, kind: string): { ok: true; rule: Rule } | { ok: false; problem: TeachProblem } {
  const parsed = parseRule(text);
  if (!parsed.ok) return { ok: false, problem: { message: parsed.error.message, langError: parsed.error } };
  const bad = validateRule(parsed.value, kind);
  if (bad) return { ok: false, problem: { message: `${bad.field}: ${bad.message}` } };
  return { ok: true, rule: parsed.value };
}

function cleanOptions(options: string[]): string[] {
  return [...new Set(options.map((o) => o.trim()).filter(Boolean))].slice(0, MAX_OPTIONS);
}

/**
 * One step of the conversation: ask, check, retry once, and say what came of
 * it. `turns` are the questions already answered; at `MAX_QUESTIONS` Claude is
 * told it may not ask, and a question anyway ends the loop.
 */
export async function teachInWords(ctx: TeachContext, said: string, turns: TeachTurn[], ask: AskTeach): Promise<TeachOutcome> {
  if (!said.trim()) return { kind: "error", message: "Say what it means first." };
  const mayAsk = turns.length < MAX_QUESTIONS;
  const system = teachSystem();
  let failed: { text: string; problem: TeachProblem } | undefined;

  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await ask({ system, user: teachUser(ctx, said, turns, { mayAsk, failed }) });
    if (reply.reply === "question") {
      if (!mayAsk) return { kind: "error", message: `Claude still had a question after ${MAX_QUESTIONS} answers (“${reply.question}”). Spell this one out in Blocks.` };
      const options = cleanOptions(reply.options);
      if (!reply.question.trim() || options.length < MIN_OPTIONS) {
        // A question with nothing to tap is not one the phone can answer; it
        // is put to Claude again as a fault, like a rule that did not parse.
        failed = { text: `(a question: ${reply.question || "empty"})`, problem: { message: `a question needs ${MIN_OPTIONS} to ${MAX_OPTIONS} tap answers` } };
        continue;
      }
      return { kind: "question", question: reply.question.trim(), options, asked: turns.length + 1 };
    }
    const text = reply.rule.trim();
    const checked = checkRuleText(text, ctx.kind);
    if (checked.ok) {
      const rule = checked.rule;
      return { kind: "rule", rule, text: printRule(rule), clauseReads: readClause(rule, ctx.clause), reads: readRuleWords(rule), meaning: reply.meaning, retried: attempt > 0 };
    }
    if (attempt === 1) return { kind: "error", message: `Claude's rule did not pass twice: ${checked.problem.message}`, text, problem: checked.problem };
    failed = { text, problem: checked.problem };
  }
  return { kind: "error", message: `Claude's answer did not pass twice: ${failed?.problem.message ?? "no rule came back"}`, text: failed?.text, problem: failed?.problem };
}
