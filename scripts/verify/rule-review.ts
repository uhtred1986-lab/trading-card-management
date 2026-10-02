/**
 * The phone review queue's text view (#472, `src/lib/arena/rule-review.ts`):
 * which printed words a clause is tied to, which it is not, and that a clause
 * without a span is listed rather than guessed. Fixture cards go through the
 * drafter's own `skillRecords`, so the records are the ones the compiler would
 * write today. Pure: no database, no network. Part of `npm test`.
 */
import assert from "node:assert/strict";
import { skillRecords } from "../../src/lib/arena/draft";
import type { CardDef } from "../../src/lib/arena/types";
import { FLAG_PREFIX, builderHref, findOnce, flagExplanation, isFlagged, orderQueue, reviewText, type ReviewRecord, type ReviewText } from "../../src/lib/arena/rule-review";
import type { Cond, CostRecord, Op } from "../../src/lib/arena/vm/script";
import { parsePath } from "../../src/lib/arena/lang/path";

/** One fixture card's first skill, as the drafter records it. */
function record(skill: string): ReviewRecord {
  const def = { id: "FX-001", name: "Fixture", cardType: "BATTLE", skill, back: null } as unknown as CardDef;
  const [r] = skillRecords(def);
  assert.ok(r, `the fixture compiles to a record: ${skill}`);
  return {
    tag: r.kind,
    printed: r.printed,
    trigger: r.trigger,
    cost: r.cost as CostRecord | null,
    cond: r.cond as Cond | null,
    ops: r.ops as Op[],
    unread: r.unread,
    status: r.unread.length ? "open" : "draft",
    pattern: r.pattern,
  };
}

/** The text view's invariants, on every fixture: the segments are the printed line, and every clause has a valid path. */
function check(t: ReviewText): ReviewText {
  assert.equal(t.segments.map((s) => s.text).join(""), t.printed, "the segments put back together are the printed line, nothing added or lost");
  for (const c of t.clauses) {
    parsePath(c.path);
    if (c.span) assert.equal(t.segments.filter((s) => s.kind === "clause" && t.clauses[s.clause] === c).length, 1, `a spanned clause is one segment: ${c.path}`);
  }
  for (const s of t.segments) if (s.kind === "tag") assert.match(s.text, /^\[[^\]]*\]$/);
  return t;
}
const spanned = (t: ReviewText, path: string) => {
  const c = t.clauses.find((x) => x.path === path);
  assert.ok(c, `a clause at ${path}`);
  return c.span ? t.printed.slice(c.span.start, c.span.end) : null;
};

// ── findOnce: exactly once, or not at all ──────────────────────────────────
assert.deepEqual(findOnce("draw 1 card.", "draw 1"), { start: 0, end: 6 });
assert.equal(findOnce("draw 1 card, then draw 1 card.", "draw 1"), null, "twice is two candidates: no span");
assert.equal(findOnce("redraw 1 card", "draw 1", { words: true }), null, "inside another word is not the word");
assert.deepEqual(findOnce("When this card is KO’d, draw 1.", "when this card is KO'd", { caseless: true }), { start: 0, end: 22 }, "case and curly apostrophes fold, indices hold");
assert.equal(findOnce("Draw 2 cards.", "draw 2"), null, "exact case unless asked");

// ── WHEN and DO in the card's own words ────────────────────────────────────
{
  const t = check(reviewText(record("[Auto] When this card attacks, draw 1 card.")));
  assert.equal(spanned(t, "trigger[0]"), "When this card attacks", "the WHEN reading is printed word for word: underlined");
  assert.equal(spanned(t, "ops[0]"), "draw 1", "so is the DO's");
  assert.deepEqual(t.clauses.map((c) => [c.tag, c.by]), [["WHEN", "words"], ["DO", "words"]]);
  assert.equal(t.segments[0].kind, "tag", "[Auto] is a tag, not a clause");
  assert.equal(t.will, "When this card attacks, draw 1.");
  assert.equal(t.blank, false);
}

// ── a reading in the engine's own words gets no span: it is listed ─────────
{
  const t = check(reviewText(record("[Auto] When you play this card, draw 1 card.")));
  assert.equal(spanned(t, "trigger[0]"), null, "'when this card is played' is not printed: the WHEN is listed, not guessed onto 'When you play this card'");
  assert.equal(t.clauses[0].reads, "when this card is played", "…with its reading");
  assert.equal(spanned(t, "ops[0]"), "draw 1");
}
{
  const t = check(reviewText(record("[Auto] When this card attacks, if you have 5 or more cards in your hand, this card gains +5000 power for the turn.")));
  assert.equal(spanned(t, "cond"), null, "the IF reads 'there are 5 or more cards in your hand': not on the card, so listed");
  assert.equal(spanned(t, "ops[0]"), null, "the DO's reading is the engine's shorthand: listed");
  assert.deepEqual(
    t.clauses.map((c) => c.tag),
    ["WHEN", "IF", "DO"],
  );
  assert.ok(t.segments.every((s) => s.kind !== "clause" || t.clauses[s.clause].tag === "WHEN"), "only the WHEN is underlined");
}

// ── a cost is a slice of the printed line ──────────────────────────────────
{
  const t = check(reviewText(record("[Activate:Main] [Once per turn] You may place 1 card from your hand in your Drop Area : Draw 2 cards.")));
  const cost = t.clauses.find((c) => c.tag === "COST");
  assert.equal(cost?.by, "slice");
  assert.equal(spanned(t, "cost"), "You may place 1 card from your hand in your Drop Area");
  assert.equal(spanned(t, "ops[0]"), "Draw 2", "a reading matches the card in any case");
  assert.equal(spanned(t, "trigger"), null, "an [Activate] names no moment of its own to underline");
}

// ── an unread clause: red dashed, and the skill plays as blank ─────────────
{
  const t = check(reviewText(record("[Auto] When this card attacks, you and your opponent compliment each other, then draw 1 card.")));
  assert.deepEqual(t.unread.map((u) => [u.text, !!u.span]), [["you and your opponent compliment each other", true]], "the unread clause is the compiler's own slice of the line");
  assert.equal(t.segments.filter((s) => s.kind === "unread").length, 1);
  assert.equal(t.blank, true);
  assert.match(t.will, /^Nothing yet/, "an open skill does nothing in a game");
}
{
  const t = check(reviewText(record("[Auto] [Energy-cost 1] When this card attacks, you may pay the cost. If you do, draw 1 card.")));
  assert.ok(t.unread.length >= 2 && t.unread.every((u) => u.span), "every unread slice is found on the line");
  assert.ok(!t.clauses.some((c) => c.path === "ops"), "an open row with nothing read has no made-up DO");
}

// ── nothing is guessed: twice, missing, or overlapping is listed ───────────
{
  const draw: Op = { op: "draw", n: 1 };
  const twice = check(reviewText({ tag: "auto", printed: "[Auto] When this card attacks, draw 1 card, then draw 1 card.", trigger: ["attacks"], cost: null, cond: null, ops: [draw, draw], unread: [], status: "draft", pattern: "draw→draw" }));
  assert.deepEqual([spanned(twice, "ops[0]"), spanned(twice, "ops[1]")], [null, null], "a reading printed twice could be either: both listed");
  assert.equal(spanned(twice, "trigger[0]"), "When this card attacks");

  const missing = check(reviewText({ tag: "auto", printed: "[Auto] When this card attacks, draw 1 card.", trigger: ["attacks"], cost: null, cond: null, ops: [], unread: ["a clause the line no longer says"], status: "open", pattern: null }));
  assert.deepEqual(missing.unread.map((u) => u.span), [null], "an unread clause not on the line is listed, not placed");
  assert.equal(missing.segments.some((s) => s.kind === "unread"), false);

  const overlap = check(reviewText({ tag: "auto", printed: "[Auto] When this card attacks, draw 1 card.", trigger: ["attacks"], cost: null, cond: null, ops: [draw], unread: ["When this card attacks, draw 1 card"], status: "open", pattern: null }));
  assert.equal(spanned(overlap, "trigger[0]"), null, "a reading inside a span already placed is not placed again");
  assert.equal(spanned(overlap, "ops[0]"), null);
}

// ── a keyword line is played by its keyword ────────────────────────────────
{
  const t = check(reviewText({ tag: "auto", printed: "[Barrier]", trigger: [], cost: null, cond: null, ops: [], unread: [], status: "draft", pattern: "keyword:Barrier" }));
  assert.match(t.clauses.find((c) => c.tag === "DO")?.reads ?? "", /played by the engine's .*Barrier/);
}

// ── the queue's order ──────────────────────────────────────────────────────
{
  const row = (cardId: string, status: string, timesSeen = 0) => ({ cardId, skillIndex: 0, status, name: cardId, timesSeen });
  const ordered = orderQueue([row("D-1", "draft"), row("D-2", "draft", 3), row("O-1", "open"), row("F-2", "draft"), row("F-1", "draft")], [
    { cardId: "F-1", skillIndex: 0 },
    { cardId: "F-2", skillIndex: 0 },
  ]);
  assert.deepEqual(
    ordered.map((r) => r.cardId),
    ["O-1", "F-1", "F-2", "D-2", "D-1"],
    "open first, then what a recent game fired (in firing order), then the rest, those met in games before",
  );
}

// ── the Wrong verdict's words ──────────────────────────────────────────────
{
  const once = flagExplanation({ tag: "DO", path: "ops[1]", reason: "wrong timing or duration", note: "  lasts for the battle,\n not the turn " }, null);
  assert.equal(once, `${FLAG_PREFIX} · DO ops[1] · wrong timing or duration — lasts for the battle, not the turn`, "the clause and the reason first, then the note");
  assert.equal(isFlagged(once), true);
  const kept = flagExplanation({ tag: "WHEN", path: "trigger[0]", reason: "something else" }, "Claude: the owner's earlier words");
  assert.ok(kept.endsWith("\n\nClaude: the owner's earlier words"), "an earlier explanation is kept under the flag");
  assert.equal(isFlagged("Claude: something"), false);
  assert.equal(isFlagged(null), false);
}

assert.equal(builderHref(42), "/arena/rules/build/42", "Teach it and Fix it open the block builder (#469)");

console.log("rule review: span logic, queue order and the Wrong verdict hold");
