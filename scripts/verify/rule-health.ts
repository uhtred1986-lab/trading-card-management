/**
 * `ruleHealth`, `cardHealth` and `cardHealthOf` (src/lib/arena/rules-store.ts): the one answer to "is
 * this skill done?" that the header counts, the progress page and the queue all read. Pure; part of
 * `npm test`. Every branch of the classifier has a case here.
 */
import assert from "node:assert/strict";
import { cardHealth, cardHealthOf, ruleHealth, type HealthRow, type RuleHealth } from "../../src/lib/arena/rules-store";
import { zeroCostRecord } from "../../src/lib/arena/vm/skill-payment";
import { unlimitedUsage } from "../../src/lib/arena/vm/usage";
import { noSparking } from "../../src/lib/arena/vm/validity";
import type { Op } from "../../src/lib/arena/vm/script";

const ATTACK = "[Auto] When this card attacks, draw 1 card.";
const draw = [{ op: "draw", n: 1 }] as unknown as Op[];

/** A clean, current draft: reads, has a current payment record, nothing to say against it. */
function row(o: Partial<HealthRow> = {}): HealthRow {
  return { kind: "auto", unread: [], ops: draw, cost: zeroCostRecord(), usage: unlimitedUsage(), validity: noSparking(), trigger: ["attacks"], printed: ATTACK, status: "draft", skillIndex: 0, source: "compiler", ...o } as HealthRow;
}
const health = (o: Partial<HealthRow>): RuleHealth => ruleHealth(row(o)).health;

// ── text-only ─────────────────────────────────────────────────────────────
{
  const open = ruleHealth(row({ status: "open", ops: [], unread: ["draw 1 card"] }));
  assert.equal(open.health, "text-only", "an open rule plays as blank");
  assert.match(open.reasons.join(" "), /does nothing/);
  assert.match(open.reasons.join(" "), /Not read: draw 1 card/, "and says which clause it could not read");

  const silent = "[Auto] When this card attacks, the moon turns blue.";
  assert.equal(health({ printed: silent, ops: [], unread: [], status: "draft" }), "text-only", "a draft that reads as nothing, saying nothing, is a silent blank");
  assert.equal(health({ printed: silent, ops: [], unread: [], status: "confirmed" }), "text-only", "…even once somebody approved it");
  assert.equal(health({ printed: silent, ops: [], unread: [], status: "corrected", source: "user" }), "done", "but 'this skill does nothing' is a person's answer (blankRule), not a silent blank");
  assert.equal(health({ printed: silent, ops: [], unread: ["the moon turns blue"], status: "draft" }), "incomplete", "a blank that says why is not silent: it is an unread clause");
}

// ── lines that read as nothing on purpose are not silent ──────────────────
{
  assert.equal(health({ kind: "keyword", printed: "[Blocker]", ops: [], trigger: [], status: "draft" }), "done", "a keyword line with no program is done, even as a draft");
  assert.equal(health({ kind: "keyword", printed: "[Blocker]", ops: [], trigger: [], status: "confirmed" }), "done");
  const reminder = "[Permanent] (Cards in your Drop Area are not hidden.)";
  assert.equal(health({ kind: "permanent", printed: reminder, ops: [], trigger: [], status: "draft" }), "done", "a bracketed reminder is not silent");
  const restriction = "[Permanent] You can include any number of this card in your deck.";
  assert.equal(health({ kind: "permanent", printed: restriction, ops: [], trigger: [], status: "draft" }), "done", "a deck-building restriction is not silent");
  assert.equal(health({ kind: "permanent", printed: restriction, ops: [], trigger: [], status: "confirmed", reviewFlag: "wrong" }), "incomplete", "…but a flag on it still counts");
}

// ── incomplete ────────────────────────────────────────────────────────────
{
  const flagged = ruleHealth(row({ status: "confirmed", reviewFlag: "Wrong (phone review) · DO ops[0] · wrong target\nsecond line" }));
  assert.equal(flagged.health, "incomplete", "a flagged rule is never done, however it was approved");
  assert.match(flagged.reasons[0], /^Marked wrong: Wrong \(phone review\) · DO ops\[0\] · wrong target$/, "the flag's first line, in the reasons");

  const diff = ruleHealth(row({ status: "confirmed", compilerDiff: { ops: [], unread: [], at: "2026-10-19" } }));
  assert.equal(diff.health, "incomplete", "a compiler reading that differs from the saved rule");
  assert.match(diff.reasons.join(" "), /reads this differently/);

  const unread = ruleHealth(row({ status: "confirmed", unread: ["a clause nobody could read"] }));
  assert.equal(unread.health, "incomplete", "an approved rule with an unread clause is partly read");
  assert.match(unread.reasons.join(" "), /Not read: a clause nobody could read/);

  // A combo wording with no stored qualification is an out-of-date record (#907), not a gap (see below).
  const combo = ruleHealth(row({ status: "confirmed", trigger: ["comboUsed"], ...{ combo: null } }));
  assert.equal(combo.needsRebuild, true, "a combo wording with no stored qualification (#907) needs a rebuild");
  assert.equal(combo.health, "done", "…and is not incomplete");
}

// ── unknown is a hint, not a gap ──────────────────────────────────────────
{
  const play = ruleHealth(row({ status: "confirmed", ops: [{ op: "play" }] as unknown as Op[] }));
  assert.equal(play.health, "done", "a play op depends on the board; that is not a gap");
  assert.deepEqual(play.hints.map((h) => /Try it in play/.test(h)), [true], "…it is a hint to try it in play");
  assert.equal(ruleHealth(row()).hints.length, 0);
  assert.equal(ruleHealth(row({ ops: [{ op: "play" }] as unknown as Op[] })).health, "unchecked", "an unchecked draft with a play op stays unchecked");
}

// ── unchecked and done ────────────────────────────────────────────────────
{
  const draft = ruleHealth(row());
  assert.equal(draft.health, "unchecked", "a clean compiler draft nobody has approved");
  assert.match(draft.reasons.join(" "), /nobody has checked/);
  assert.equal(health({ status: "confirmed" }), "done");
  assert.equal(health({ status: "corrected", source: "user" }), "done");
  assert.deepEqual(ruleHealth(row({ status: "confirmed" })).reasons, []);
}

// ── the payment rebuild is reported beside the health, never as one ───────
{
  for (const cost of [null, { text: "old shape" }, { ...zeroCostRecord(), readable: false }]) {
    const r = ruleHealth(row({ status: "confirmed", cost: cost as never }));
    assert.equal(r.needsRebuild, true, `payment record ${JSON.stringify(cost)} needs a rebuild`);
    assert.equal(r.health, "done", "…and is not a health: an approved rule with an old record is still done");
  }
  assert.equal(ruleHealth(row({ cost: null })).health, "unchecked", "a draft with an old record is still unchecked");
  assert.equal(ruleHealth(row({ status: "open", ops: [], unread: ["x"], cost: null })).needsRebuild, true, "an open rule can need it too");
  assert.equal(ruleHealth(row()).needsRebuild, false, "a current record does not");
  assert.equal(ruleHealth(row({ status: "confirmed", cost: null, reviewFlag: "wrong" })).health, "incomplete", "other gaps still count when the record is old");
}

// ── out-of-date typed records (validity, usage, combo, payment, material) ─
{
  const noUsage = ruleHealth(row({ status: "confirmed", usage: undefined }));
  assert.equal(noUsage.needsRebuild, true, "a row with no skill usage record needs a rebuild");
  assert.equal(noUsage.health, "done", "…and is not incomplete: a rebuild writes the record");
  assert.equal(ruleHealth(row({ usage: undefined })).health, "unchecked", "a draft with no usage record is still unchecked");
  const noValidity = ruleHealth(row({ status: "confirmed", validity: undefined }));
  assert.equal(noValidity.needsRebuild, true, "a row with no Sparking validity record needs a rebuild");
  assert.equal(noValidity.health, "done", "…and is not incomplete");
  const realGap = ruleHealth(row({ status: "confirmed", unread: ["a clause nobody could read"], usage: undefined }));
  assert.equal(realGap.health, "incomplete", "a real unread clause still makes the rule incomplete");
  assert.equal(realGap.needsRebuild, true, "…and the missing usage record is reported beside it");
  assert.equal(ruleHealth(row()).needsRebuild, false, "a current row with every record needs no rebuild");
}

// ── a card takes its worst skill ──────────────────────────────────────────
assert.equal(cardHealth([]), "done", "nothing to check");
assert.equal(cardHealth(["done", "done"]), "done");
assert.equal(cardHealth(["done", "unchecked"]), "unchecked");
assert.equal(cardHealth(["unchecked", "incomplete", "done"]), "incomplete");
assert.equal(cardHealth(["done", "incomplete", "text-only", "unchecked"]), "text-only");

// ── a printed skill with no current row is text-only (as rulesFromRows decides) ─
{
  const card = { skill: ATTACK, backSkill: null };
  const mine = { ...row({ status: "confirmed" }), side: "front" };
  const ok = cardHealthOf(card, [mine]);
  assert.deepEqual([ok.health, ok.missing, ok.skills], ["done", 0, ["done"]]);
  assert.deepEqual(cardHealthOf(card, []).health, "text-only", "no row at all");
  const stale = cardHealthOf(card, [{ ...mine, printed: "[Auto] When this card attacks, draw 2 cards." }]);
  assert.deepEqual([stale.health, stale.missing], ["text-only", 1], "a row whose stored line is no longer the printed line is stale");
  const reused = cardHealthOf(card, [{ ...mine, skillIndex: 10 }]);
  assert.deepEqual([reused.health, reused.missing], ["text-only", 1], "a row under another index does not answer for this skill");
  const back = cardHealthOf({ skill: ATTACK, backSkill: ATTACK }, [mine]);
  assert.deepEqual([back.health, back.missing], ["text-only", 1], "the awakened side is checked on its own");
  const both = cardHealthOf({ skill: ATTACK, backSkill: ATTACK }, [mine, { ...row({ status: "draft" }), side: "back" }]);
  assert.deepEqual([both.health, both.skills], ["unchecked", ["done", "unchecked"]], "both faces count; the worst one wins");
  assert.equal(cardHealthOf({ skill: "[Blocker]", backSkill: null }, []).health, "done", "a keyword-only card needs no row");
  assert.equal(cardHealthOf({ skill: null, backSkill: null }, []).health, "done", "a card with no text has nothing to check");
}

console.log("rule health OK");
