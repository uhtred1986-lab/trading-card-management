/**
 * The builder's "Teach it" tabs (#473), with no database and no Claude.
 *
 * "In my words": the loop in `teach/words.ts` runs against a stubbed model.
 * Every rule it hands back has been through `parseRule` → `validateRule`; one
 * bad rule goes back to the model once with its `LangError`; a question comes
 * back with 2–4 tap answers; and after three questions the model may not ask.
 *
 * "Like a card": `rankLike` over fixture rows puts the confirmed rules with
 * the record's own pattern first, and the copied clause takes this card's
 * number and colour, saying so.
 *
 * Part of `npm test`.
 */
import assert from "node:assert/strict";
import { parseRule, printRule, validateRule, type Rule } from "../../src/lib/arena/lang";
import { languageReference } from "../../src/lib/arena/lang/reference";
import { clauseShape } from "../../src/lib/arena/gaps";
import { clauseText, readClause, ruleOfRow } from "../../src/lib/arena/teach/common";
import { GRAMMAR, MAX_QUESTIONS, REFERENCE_BUDGET, languageForPrompt, teachInWords, teachSystem, type AskTeach, type TeachContext, type TeachPrompt, type TeachReply, type TeachTurn } from "../../src/lib/arena/teach/words";
import { findWording, fitClause, likePattern, rankLike, searchTerms, wordingPattern, type LikeRow } from "../../src/lib/arena/teach/like";

const rule = (src: string): Rule => {
  const p = parseRule(src);
  if (!p.ok) throw new Error(`fixture does not parse: ${p.error.message}\n${src}`);
  return p.value;
};

// ── the prompt carries the language ─────────────────────────────────────────

{
  const ref = languageReference();
  const system = teachSystem();
  for (const op of ref.ops.filter((o) => !o.offCard)) assert.ok(system.includes(`  ${op.name}(`), `the prompt names the statement ${op.name}`);
  for (const c of ref.conds) assert.ok(system.includes(`  ${c.kind}(`), `the prompt names the condition ${c.kind}`);
  for (const t of ref.triggers) assert.ok(system.includes(t.name), `the prompt names the moment ${t.name}`);
  assert.ok(languageForPrompt().length <= REFERENCE_BUDGET, "the reference fits its budget");
  // Trimmed, it drops detail rather than rows.
  const tight = languageForPrompt(1);
  for (const op of ref.ops.filter((o) => !o.offCard)) assert.ok(tight.includes(`  ${op.name}(`), `trimmed, the prompt still names ${op.name}`);
  assert.ok(tight.length < languageForPrompt().length, "a tighter budget gives a shorter reference");
  // Every worked example the prompt shows Claude is a rule the language accepts.
  const examples = GRAMMAR.split("Examples:")[1].trim().split(/\n\s*\n/);
  assert.ok(examples.length >= 3);
  for (const ex of examples) {
    const p = parseRule(ex);
    assert.ok(p.ok, `the prompt's example parses: ${ex}\n${p.ok ? "" : p.error.message}`);
    if (p.ok) assert.equal(validateRule(p.value, p.value.kind), null, `the prompt's example validates: ${ex}`);
  }
}

// ── "In my words", against a stub ───────────────────────────────────────────

const TIDECALLER = "[Auto] When this card attacks, if there are 3 or more blue cards in your drop area, draw 1 card.";
const ctx: TeachContext = {
  ruleId: 7,
  cardId: "BT21-044",
  cardName: "Tidecaller Oracle",
  cardLine: "BATTLE, Blue, cost 2, 10000 power",
  printed: TIDECALLER,
  kind: "auto",
  clause: "cond",
  clauseWords: "if there are 3 or more blue cards in your drop area",
  unread: ["if there are 3 or more blue cards in your drop area"],
  current: rule("WHEN [auto] attacks\nTHEN\n  draw(n: 1)"),
};
const SAID = "Count the blue cards in my drop area. If there are 3 or more, I draw.";
const GOOD = "WHEN [auto] attacks\nIF count((colors = [Blue]) IN you.drop) >= 3\nTHEN\n  draw(n: 1)";
const asRule = (text: string): TeachReply => ({ reply: "rule", rule: text, meaning: "draws when the drop holds 3 blue cards", question: "", options: [] });
const asQuestion = (question: string, options: string[]): TeachReply => ({ reply: "question", rule: "", meaning: "", question, options });

/** A model that answers from a script, and remembers what it was asked. */
function stub(replies: TeachReply[]): AskTeach & { prompts: TeachPrompt[] } {
  const prompts: TeachPrompt[] = [];
  const ask = (async (p: TeachPrompt) => {
    prompts.push(p);
    const r = replies.shift();
    if (!r) throw new Error("the stub ran out of replies");
    return r;
  }) as AskTeach & { prompts: TeachPrompt[] };
  ask.prompts = prompts;
  return ask;
}

const wordsDone = (async () => {
  // A rule: parsed, validated, read back; the prompt carries the card, the clause and the words.
  {
    const ask = stub([asRule(GOOD)]);
    const out = await teachInWords(ctx, SAID, [], ask);
    assert.equal(out.kind, "rule");
    assert(out.kind === "rule");
    assert.equal(validateRule(out.rule, "auto"), null, "the rule handed to onRule passes validateRule");
    assert.equal(out.rule.cond?.kind, "count");
    assert.deepEqual(out.rule.cond && "atLeast" in out.rule.cond ? out.rule.cond.atLeast : null, 3);
    assert.equal(out.text, printRule(out.rule));
    assert.match(out.clauseReads, /^if /);
    assert.equal(out.retried, false);
    assert.equal(ask.prompts.length, 1);
    const user = ask.prompts[0].user;
    for (const s of [TIDECALLER, ctx.clauseWords, SAID, "[auto]", "THE OWNER IS TEACHING THE IF CLAUSE", "WHEN [auto] attacks"]) assert.ok(user.includes(s), `the prompt carries ${JSON.stringify(s)}`);
    assert.ok(ask.prompts[0].system.length < 40_000, "the system prompt is a sensible size");
  }

  // One bad reply is retried with its LangError, and the second one stands.
  {
    const ask = stub([asRule("WHEN [auto] attacks\nIF count((colors = [Blue]) IN you.drop) >= 3\nTHEN\n  drawz(n: 1)"), asRule(GOOD)]);
    const out = await teachInWords(ctx, SAID, [], ask);
    assert.equal(out.kind, "rule");
    assert.equal(out.kind === "rule" && out.retried, true);
    assert.equal(ask.prompts.length, 2, "one retry");
    assert.ok(ask.prompts[1].user.includes("YOUR LAST RULE WAS REFUSED"), "the retry says the rule was refused");
    assert.ok(ask.prompts[1].user.includes('the engine has no step called "drawz"'), "the retry carries the LangError's message");
    assert.ok(ask.prompts[1].user.includes("line 4, column 3"), "…and where it stopped");
    assert.equal(ask.prompts[1].system, ask.prompts[0].system, "the system prompt is the same bytes, so it stays cached");
  }

  // A rule that parses but names the wrong tag is refused by validateRule, and retried.
  {
    const ask = stub([asRule(GOOD.replace("[auto] attacks", "[activate:main]")), asRule(GOOD)]);
    const out = await teachInWords(ctx, SAID, [], ask);
    assert.equal(out.kind, "rule");
    assert.ok(ask.prompts[1].user.includes("The checker said: kind:"), "the validator's complaint goes back");
  }

  // Two bad replies: no third call, and the error is shown with its LangError.
  {
    const ask = stub([asRule("WHEN [auto] attacks\nTHEN\n  drawz(1)"), asRule("THEN draw(1)")]);
    const out = await teachInWords(ctx, SAID, [], ask);
    assert.equal(out.kind, "error");
    assert.equal(ask.prompts.length, 2, "retried once, not twice");
    assert.ok(out.kind === "error" && out.problem?.langError, "the owner is shown the LangError");
  }

  // A question: one question, 2–4 tap answers, trimmed and de-duplicated.
  {
    const ask = stub([asQuestion("Does a card that is blue and another colour count as blue?", ["Yes, it counts", "No, only mono-blue", " Yes, it counts ", "Only on my turn", "Never", "Sometimes"])]);
    const out = await teachInWords(ctx, SAID, [], ask);
    assert.equal(out.kind, "question");
    assert(out.kind === "question");
    assert.ok(out.options.length >= 2 && out.options.length <= 4, "2–4 tap answers");
    assert.deepEqual(out.options, ["Yes, it counts", "No, only mono-blue", "Only on my turn", "Never"]);
    assert.equal(out.asked, 1);
    assert.ok(ask.prompts[0].user.includes("3 questions left"));
  }

  // A question with nothing to tap is a fault, put back once like a bad rule.
  {
    const ask = stub([asQuestion("Which?", []), asRule(GOOD)]);
    const out = await teachInWords(ctx, SAID, [], ask);
    assert.equal(out.kind, "rule");
    assert.ok(ask.prompts[1].user.includes("tap answers"));
  }

  // The loop: the panel answers each question with its first option. After
  // three, the model is told it may not ask, and a fourth question ends it.
  {
    const turns: TeachTurn[] = [];
    const replies = [asQuestion("Blue and red counts as blue?", ["Yes", "No"]), asQuestion("Face-down cards too?", ["Yes", "No"]), asQuestion("Tokens too?", ["Yes", "No"]), asQuestion("And another?", ["Yes", "No"])];
    let last;
    for (let round = 0; round < 10; round++) {
      const ask = stub([replies.shift()!]);
      last = await teachInWords(ctx, SAID, turns, ask);
      if (last.kind !== "question") {
        assert.ok(ask.prompts[0].user.includes("You may not ask anything more"), "the fourth call forbids a question");
        break;
      }
      assert.ok(turns.length < MAX_QUESTIONS, "never more than three questions are put to the owner");
      turns.push({ question: last.question, options: last.options, answer: last.options[0] });
    }
    assert.equal(turns.length, MAX_QUESTIONS, "three questions were asked and answered");
    assert.equal(last?.kind, "error", "a fourth question stops the loop");
  }

  // The answers go back each turn; with three given, a rule still comes through.
  {
    const turns: TeachTurn[] = [1, 2, 3].map((i) => ({ question: `Q${i}?`, options: ["Yes", "No"], answer: "Yes" }));
    const ask = stub([asRule(GOOD)]);
    const out = await teachInWords(ctx, SAID, turns, ask);
    assert.equal(out.kind, "rule");
    for (const t of turns) assert.ok(ask.prompts[0].user.includes(`Q: ${t.question}`) && ask.prompts[0].user.includes(`A: ${t.answer}`));
  }

  // Nothing said: no call at all.
  {
    const ask = stub([]);
    const out = await teachInWords(ctx, "   ", [], ask);
    assert.equal(out.kind, "error");
    assert.equal(ask.prompts.length, 0);
  }
})();

// ── the row helpers ──────────────────────────────────────────────────────────

assert.equal(clauseText({ unread: ["if there are 3 or more blue cards in your drop area,"], printed: TIDECALLER }), "if there are 3 or more blue cards in your drop area");
assert.equal(clauseText({ unread: [], printed: "[Auto] [Once per turn] When this card attacks, draw 1 card." }), "When this card attacks, draw 1 card");
assert.deepEqual(ruleOfRow({ kind: "auto", trigger: null, cost: null, cond: null, ops: null }), { kind: "auto", trigger: [], cost: null, cond: null, ops: [] });

// ── "Like a card" ────────────────────────────────────────────────────────────

const words = "if there are 3 or more blue cards in your drop area";
assert.equal(likePattern(words), "%if there are % or more % cards in your drop area%");
assert.equal(likePattern("50% of <Son Goku>_x"), "%\\% of %\\_x%");
assert.deepEqual(searchTerms("Drop  area 3 a"), ["%drop%", "%area%"]);
assert.equal(wordingPattern(words).slots.length, 2);
{
  const printed = "[Auto] When this card attacks, if there are 5 or more red cards in your drop area, KO this card.";
  const found = findWording(printed, words);
  assert.ok(found);
  assert.equal(printed.slice(...found.span), "if there are 5 or more red cards in your drop area");
  assert.deepEqual(found.theirs, ["5", "red"]);
}

const pattern = clauseShape(words);
const row = (id: number, cardId: string, status: string, printed: string, src: string, pat: string | null): LikeRow => ({ id, cardId, name: `Card ${cardId}`, printed, pattern: pat, status, source: status === "draft" ? "compiler" : "user", rule: rule(src) });
const target = { id: 1, pattern, clauseWords: words, rule: ctx.current };
const pool: LikeRow[] = [
  row(10, "BT1-010", "draft", "[Auto] When this card attacks, if there are 4 or more blue cards in your drop area, draw 1 card.", "WHEN [auto] attacks\nIF count((colors = [Blue]) IN you.drop) >= 4\nTHEN\n  draw(n: 1)", pattern),
  row(11, "BT2-011", "confirmed", "[Auto] When this card attacks, if there are 5 or more blue cards in your drop area, draw 1 card.", "WHEN [auto] attacks\nIF count((colors = [Blue]) IN you.drop) >= 5\nTHEN\n  draw(n: 1)", pattern),
  row(12, "BT3-012", "corrected", "[Auto] When this card is played, if there are 4 or more red cards in your drop area, draw 2 cards.", "WHEN [auto] played\nIF count((colors = [Red]) IN you.drop) >= 4\nTHEN\n  draw(n: 2)", "if:count[draw]"),
  row(13, "BT4-013", "open", "[Auto] When this card attacks, if there are 6 or more blue cards in your drop area, draw 1 card.", "WHEN [auto] attacks\nTHEN", pattern),
  row(1, "BT21-044", "open", TIDECALLER, "WHEN [auto] attacks\nTHEN\n  draw(n: 1)", pattern),
  row(14, "BT5-014", "confirmed", "[Activate:Main] Draw 1 card from your drop area.", "WHEN [activate:main]\nTHEN\n  draw(n: 1)", "draw"),
];
{
  const list = rankLike(target, pool, "cond", { query: "drop area" });
  assert.deepEqual(
    list.map((m) => m.id),
    [11, 10, 12, 14],
    "the record's own pattern first, confirmed before draft; then the text matches; open rows and the record itself left out",
  );
  const [first, second, third, fourth] = list;
  assert.equal(first.label, "confirmed");
  assert.equal(second.label, "draft · not checked");
  assert.ok(first.samePattern && second.samePattern && !third.samePattern);
  assert.equal(first.printed.slice(...first.highlight!), "if there are 5 or more blue cards in your drop area", "the matching phrase is highlighted");

  // Copying the confirmed rule's IF changes 5 to this card's 3, and says so.
  assert.ok(first.rule, "the clause can be copied");
  assert.equal(validateRule(first.rule!, "auto"), null, "the copied rule passes validateRule");
  assert.equal(first.rule!.cond?.kind === "count" && first.rule!.cond.atLeast, 3, "the differing number is changed to match this card");
  assert.deepEqual(first.notes, ["uses 3 here, not 5"]);
  assert.deepEqual(first.rule!.ops, ctx.current.ops, "only the taught clause is copied; THEN is this record's");
  assert.equal(first.rule!.kind, "auto");
  assert.equal(first.reads, readClause(first.rule!, "cond"));

  // A different colour and number: both fitted, both said.
  assert.equal(third.rule!.cond?.kind === "count" && third.rule!.cond.atLeast, 3);
  assert.deepEqual(third.rule!.cond?.kind === "count" && third.rule!.cond.sel.filter?.colors, ["Blue"], "the colour is changed to this card's");
  assert.deepEqual(third.notes, ["uses 3 here, not 4", "blue here, not red"]);
  assert.deepEqual(third.rule!.trigger, ["attacks"], "the WHEN stays this record's");

  // A search-box match whose wording does not line up: the search word is highlighted, and its missing IF is said.
  assert.equal(fourth.printed.slice(...fourth.highlight!), "drop area");
  assert.equal(fourth.rule, null);
  assert.match(fourth.problem ?? "", /no IF to copy/);
}
{
  // A number the copied clause holds more often than the wording says is not guessed at.
  const fitted = fitClause({ a: 2, b: 2 }, wordingPattern("draw 1 card").slots, ["2"]);
  assert.deepEqual(fitted.clause, { a: 2, b: 2 });
  assert.match(fitted.notes[0], /^check the 2/);
  // A name, in its brackets.
  const named = fitClause({ filter: { characters: ["Vegeta"] } }, wordingPattern("a <Son Goku> card").slots, ["<Vegeta>"]);
  assert.deepEqual(named.clause, { filter: { characters: ["Son Goku"] } });
  assert.deepEqual(named.notes, ["<Son Goku> here, not <Vegeta>"]);
}

wordsDone.then(
  () => console.log("verify/teach: ok"),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
