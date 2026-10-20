/** One real DB workflow; fake model + GitHub boundary, no paid calls or network. */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/index.ts";
import { cards, cardRules, arenaFeedback } from "../src/db/schema.ts";
import { requestRuleExplanation, approveRuleExplanation, retryExplanationIssue, type ExplanationServices } from "../src/lib/arena/rule-explanation-store.ts";
import { explainDecision, type ExplanationAnswer } from "../src/lib/arena/rule-explanation.ts";
import { reviewVersion } from "../src/lib/arena/rule-review-version.ts";
import { saveRule, reopenRule, confirmReviewedRule, loadRules, rulesFromRows } from "../src/lib/arena/rules-store.ts";
import { reviewItemById, reopenReviewedRule } from "../src/lib/arena/rule-review-store.ts";
import { feedbackIssueEligible, syncFeedbackItem, syncAllFeedbackItems } from "../lib/github.ts";
import type { Rule } from "../src/lib/arena/lang/ast.ts";
import { ruleReading } from "../src/lib/arena/rule-reading.ts";
import { RULES } from "../src/lib/arena/vm/index.ts";
import type { Action, CardDef, EngineContext } from "../src/lib/arena/types.ts";
import { typedRecords } from "./verify/records.ts";

export async function verifyRuleExplanationDb(db: Db) {
  await db.insert(cards).values({ id: "BT18-EXPLAIN836", setCode: "BT18", name: "Explanation fixture", cardType: "BATTLE", rarity: "Common[C]", rarityCode: "C", searchText: "explanation fixture", skill: "[Activate: Main] {R}{1}: If your life is 4 or less, draw 2 cards." });
  const first = await saveRule(db, { cardId: "BT18-EXPLAIN836", side: "front", skillIndex: 0, kind: "activate:main", printed: "[Activate: Main] {R}{1}: If your life is 4 or less, draw 2 cards.",
    source: "compiler", status: "draft", trigger: [], ...typedRecords(), cost: null, cond: null, ops: [{ op: "draw", n: 1 }] });
  const get = async () => (await db.select().from(cardRules).where(eq(cardRules.id, first.id)))[0];
  const rule: Rule = { kind: "activate:main", trigger: [],
    cost: { version: 1, readable: true, text: "", orbs: { Red: 1, any: 1 }, either: [], marker: null, burst: null, spiritBoost: null, condition: null, program: null },
    cond: { kind: "life", side: "you", atMost: 4 }, ops: [{ op: "draw", n: 2 }] };
  const answer: ExplanationAnswer = { confident: true, question: "", missingCapability: "", meaning: "In your Main Phase pay one red and one other energy; at life 4 or less draw two.", ruleJson: JSON.stringify(rule) };
  const words = ruleReading({ ...rule, cost: { ...rule.cost!, text: "discard one card", x: { min: 1, max: 3 } } });
  assert.match(words[1][1], /1 Red energy.*1 energy/);
  assert.match(words[1][1], /X energy.*1 minimum.*3 maximum/, "variable payment bounds are visible, never presented as free");
  assert.ok(words[1][1].includes("discard one card"), "native energy does not conceal an unresolved residual action cost");
  assert.match(ruleReading({ ...rule, kind: "permanent" })[0][1], /Continuously/);
  assert.match(ruleReading({ ...rule, kind: "auto" })[0][1], /not been read/);
  assert.equal(explainDecision({ ...answer, ruleJson: JSON.stringify({ ...rule, ops: [] }) }, rule.kind, first.printed).kind, "invalid", "empty AI fallback cannot approve a blank skill");
  assert.equal(explainDecision({ ...answer, ruleJson: JSON.stringify({ ...rule, cost: null }) }, rule.kind, first.printed).kind, "question", "a free-price proposal cannot override the engine's native R+1 fee");
  const residualText = "discard 1 card from your hand";
  const withResidual = `[Activate: Main] {R}{1}, ${residualText}: Draw 2 cards.`;
  const residualRule = { ...rule, cost: { ...rule.cost!, text: residualText } };
  assert.equal(explainDecision({ ...answer, ruleJson: JSON.stringify(residualRule) }, rule.kind, withResidual).kind, "question", "orbs do not account for an unpaid residual discard price");
  assert.equal(explainDecision({ ...answer, ruleJson: JSON.stringify({ ...residualRule, cost: { ...residualRule.cost, program: [{ op: "discard", n: 1 }] } }) }, rule.kind, withResidual).kind, "supported", "known action-price instructions can bridge unread wording without compiler success");
  assert.equal(explainDecision({ ...answer, ruleJson: JSON.stringify({ ...residualRule, cost: { ...residualRule.cost, program: [{ op: "draw", n: 1 }] } }) }, rule.kind, withResidual).kind, "unsupported", "ordinary effect operations are not automatically chargeable prices");
  let generateCalls = 0;
  let syncCalls = 0;
  let raw: unknown = answer;
  let failSync = true;
  const services: ExplanationServices = {
    generate: async () => { generateCalls++; return raw; },
    sync: async () => { syncCalls++; if (failSync) throw new Error("Integration unavailable"); return { url: "https://github.com/example/test/issues/836" }; },
  };
  const request = async (text = "Pay the printed red and other energy, then draw two only at life four or less.") => requestRuleExplanation(db, first.id, reviewVersion(await get()), text, "owner", services);
  const untouched = await get();
  const draft = await request();
  assert.equal(draft.decision.kind, "supported", "real colored+generic price and IF pass full-rule checks");
  assert.deepEqual(await get(), untouched, "requesting a draft changes no executable rule fields");
  assert.equal(syncCalls, 0, "supported candidates create no coding issue");
  const feedback = (await db.select().from(arenaFeedback).where(eq(arenaFeedback.id, draft.proposalId!)))[0];
  assert.equal(feedback.kind, "rule-proposal");
  assert.equal(feedbackIssueEligible(feedback), false);
  await assert.rejects(() => syncFeedbackItem(feedback), /cannot be synced/, "even direct generic issue sync refuses supported candidates before network");
  // Empty eligible batches should never ask GitHub just to discover there is nothing to send.
  assert.equal((await syncAllFeedbackItems([feedback])).total, 0);
  const resumed = await reviewItemById(db, first.id, { decks: [], firedIn: null });
  assert.equal(resumed?.pendingExplanation?.result.token, draft.token, "reload recovers exact private candidate without another model call");
  await assert.rejects(() => approveRuleExplanation(db, first.id, draft.proposalId!, "tampered"), /changed/);
  await approveRuleExplanation(db, first.id, draft.proposalId!, draft.token!);
  const approved = await get();
  assert.equal(approved.status, "confirmed");
  assert.deepEqual({ kind: approved.kind, trigger: approved.trigger, cost: approved.cost, cond: approved.cond, ops: approved.ops }, rule, "approval stores WHEN, COST, IF and THEN together");
  // Real stored-row -> VM boundary: the displayed native R+1 cost is actually paid,
  // and the complete stored IF/THEN draws two. No compiler stands in for the row.
  const filler: CardDef = { id: "EXPLAIN-FILL", name: "Red energy", type: "BATTLE", colors: ["Red"], energyCost: 1, zEnergyCost: null, power: 10000, comboCost: 0, comboPower: 5000, skill: null, characters: [], traits: [] };
  const leader: CardDef = { ...filler, id: "EXPLAIN-LEADER", name: "Leader", type: "LEADER", energyCost: null, comboCost: null, comboPower: null };
  const defs = { [filler.id]: filler, [leader.id]: leader, [approved.cardId]: { ...filler, id: approved.cardId, name: "Reviewed skill", skill: approved.printed } };
  const ctx: EngineContext = { defs, scripts: rulesFromRows(await loadRules(db, [approved.cardId]), defs) };
  const deck = Array.from({ length: 50 }, () => filler.id);
  let game = RULES.createGame(ctx, { seed: 836, p1: { name: "Owner", leader: leader.id, main: deck }, p2: { name: "Other", leader: leader.id, main: deck } }).state;
  const setup: Action[] = [{ type: "chooseFirst", player: game.chooser, first: "p1" }, { type: "mulligan", player: "p1", redraw: false }, { type: "mulligan", player: "p2", redraw: false },
    { type: "charge", player: "p1", card: null }, { type: "endMain", player: "p1" }, { type: "charge", player: "p2", card: null }, { type: "endMain", player: "p2" }, { type: "charge", player: "p1", card: null }];
  for (const action of setup) game = RULES.apply(ctx, game, action).state;
  const host = game.sides.p1.zones.deck.shift()!;
  game.cards[host].cardId = approved.cardId; game.cards[host].mode = "active"; game.sides.p1.zones.battle.push(host);
  const energy = [game.sides.p1.zones.deck.shift()!, game.sides.p1.zones.deck.shift()!];
  for (const id of energy) { game.cards[id].mode = "active"; game.sides.p1.zones.energy.push(id); }
  game.sides.p1.zones.hand.push(...game.sides.p1.zones.life.splice(4));
  game.cards[energy[1]].mode = "rest";
  assert.ok(!RULES.legalActions(ctx, game).some((entry) => entry.action.type === "activate" && entry.action.card === host), "one active energy cannot pay the displayed two-energy fee");
  game.cards[energy[1]].mode = "active";
  const activation = RULES.legalActions(ctx, game).find((entry) => entry.action.type === "activate" && entry.action.card === host);
  assert.ok(activation, "the confirmed record offers its native-priced activation");
  const handBefore = game.sides.p1.zones.hand.length;
  game = RULES.apply(ctx, game, activation.action).state;
  assert.equal(game.winner, null, "paying the approved price and drawing does not finish the game");
  assert.equal(game.outcome ?? null, null);
  assert.deepEqual(energy.map((id) => game.cards[id].mode), ["rest", "rest"], "the actual VM charges red plus generic energy");
  assert.equal(game.sides.p1.zones.hand.length, handBefore + 2, "the approved conditional effect draws exactly two cards");
  await assert.rejects(() => approveRuleExplanation(db, first.id, draft.proposalId!, draft.token!), /already approved/);
  const callsBeforeProtected = generateCalls;
  await assert.rejects(() => request(), /Reopen/);
  assert.equal(generateCalls, callsBeforeProtected, "protected rules refuse before a model call");
  await assert.rejects(() => saveRule(db, { cardId: approved.cardId, side: "front", skillIndex: 0, source: "claude", status: "draft", ops: [{ op: "draw", n: 99 }] }), /cannot be overwritten/);
  assert.deepEqual(await get(), approved, "legacy Claude writers cannot overwrite approved semantics");
  const reopened = await reopenReviewedRule(db, first.id, { decks: ["Review deck"], firedIn: 836 });
  assert.equal(reopened.status, "draft");
  assert.notEqual(reopened.reviewVersion, reviewVersion(approved), "Undo returns a fresh exact approval version");
  assert.deepEqual(reopened.ops, rule.ops, "Undo approval preserves the newly approved interpretation");
  assert.deepEqual(reopened.cost, rule.cost);
  assert.deepEqual(reopened.cond, rule.cond);
  assert.deepEqual(reopened.decks, ["Review deck"]);
  assert.equal(reopened.firedIn, 836);
  assert.equal(reopened.pendingExplanation, undefined, "The approved proposal is not offered again");
  await confirmReviewedRule(db, first.id, reopened.reviewVersion!);
  assert.equal((await get()).status, "confirmed", "The refreshed interpretation can be approved again after Undo");
  await saveRule(db, { cardId: approved.cardId, side: "front", skillIndex: 0, ...rule, source: "user", status: "corrected" });
  const corrected = await get();
  await assert.rejects(() => request(), /Reopen/);
  await assert.rejects(() => saveRule(db, { cardId: approved.cardId, side: "front", skillIndex: 0, source: "claude", status: "draft", ops: [{ op: "draw", n: 99 }] }), /cannot be overwritten/);
  assert.deepEqual(await get(), corrected, "owner corrections are protected too");
  assert.equal(generateCalls, callsBeforeProtected);

  await reopenRule(db, first.id);
  const beforeQuestions = await get();
  raw = { ...answer, confident: false, question: "Before or after paying the cost?" };
  assert.equal((await request()).decision.kind, "question");
  raw = { ...answer, ruleJson: JSON.stringify({ ...rule, inventedTopLevelKey: true }) };
  assert.equal((await request()).decision.kind, "invalid");
  raw = { ...answer, ruleJson: JSON.stringify({ ...rule, ops: [{ op: "draw", n: 2, inventedField: "ignored?" }] }) };
  assert.equal((await request()).decision.kind, "invalid", "closed engine operation schema rejects stray keys");
  assert.deepEqual(await get(), beforeQuestions, "uncertain/invalid output leaves the existing usable draft intact");
  const unknown = explainDecision({ ...answer, ruleJson: JSON.stringify({ ...rule, ops: [{ op: "play", target: { sel: { special: "self" } } }] }) }, rule.kind, first.printed);
  assert.equal(unknown.kind, "question", "context-dependent runtime support is not certified or called a missing engine mechanic");
  const unsupported = explainDecision({ ...answer, ruleJson: JSON.stringify({ ...rule, kind: "permanent" }) }, "permanent", "[Permanent] Draw two.");
  assert.equal(unsupported.kind, "unsupported", "actual runtime static support rejects structurally valid permanent draw");

  raw = { ...answer, missingCapability: "Synthetic missing runtime mechanic", ruleJson: "WHEN main; COST energy; IF life; THEN synthetic mechanic" };
  const coding = await request("Explain the synthetic mechanic for this exact skill.");
  assert.equal(coding.decision.kind, "unsupported");
  assert.equal(coding.issueUrl, null);
  assert.match(coding.issueError!, /Feedback is saved.*sync failed/);
  await assert.rejects(() => approveRuleExplanation(db, first.id, coding.proposalId!, coding.token!), /Only a complete supported/);
  assert.deepEqual(await get(), beforeQuestions, "coding feedback never activates or overwrites the rule");
  const pending = await reviewItemById(db, first.id, { decks: [], firedIn: null });
  assert.equal(pending?.pendingExplanation?.result.proposalId, coding.proposalId, "failed sync receipt and explanation survive reload");
  failSync = false;
  const linked = await retryExplanationIssue(db, coding.proposalId!, services);
  assert.equal(linked.issueUrl, "https://github.com/example/test/issues/836");
  const again = await request("Explain the synthetic mechanic for this exact skill.");
  assert.equal(again.proposalId, coding.proposalId);
  await retryExplanationIssue(db, coding.proposalId!, services);
  assert.equal(syncCalls, 2, "failed sync then one successful sync; receipt prevents duplicate issue creation on retry/repeated request");

  raw = answer;
  const stale = await request("Draft before another writer changes the rule.");
  await saveRule(db, { cardId: approved.cardId, side: "front", skillIndex: 0, source: "user", status: "draft", ops: [{ op: "draw", n: 3 }] });
  const changed = await get();
  await assert.rejects(() => approveRuleExplanation(db, first.id, stale.proposalId!, stale.token!), /changed/);
  await assert.rejects(() => confirmReviewedRule(db, first.id, reviewVersion(beforeQuestions)), /changed/);
  assert.deepEqual(await get(), changed, "both proposal and ordinary review approval reject stale displayed semantics");
  await requestRuleExplanation(db, first.id, reviewVersion(changed), "This request races another editor.", "owner", {
    ...services, generate: async () => { await saveRule(db, { cardId: changed.cardId, side: "front", skillIndex: 0, source: "user", status: "draft", ops: [{ op: "draw", n: 4 }] }); return answer; },
  }).then(() => assert.fail("a model response cannot overwrite a newer edit"), (error) => assert.match(error.message, /changed/));
  await confirmReviewedRule(db, first.id, reviewVersion(await get()));
  assert.equal((await get()).status, "confirmed", "ordinary existing-reading approval remains available with exact-version guard");
  console.log("rule explanation #836: complete proposal/explicit approval, uncertainty, coding dedup/retry, protected records and stale versions");
}
