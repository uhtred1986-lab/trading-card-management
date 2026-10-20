/**
 * The Rules queue by card (queue.ts, rules-store.ts `classifyQueueCard`/`viewOfQueue`): the URL
 * contract with the old `state=`/`seg=` links, the `?q=` value the card page reads, the grouping,
 * and what a card's tab, dots and reason come out as. Pure; part of `npm test`.
 */
import assert from "node:assert/strict";
import { cardHref, defaultGroup, defaultHealth, groupCards, neighbours, parseQueue, queueFromParam, queueHref, queueLink, queueParam } from "../../src/lib/arena/queue";
import { CLAUDE_FIX_REASON, classifyQueueCard, viewOfQueue, type HealthRow, type QueueCard } from "../../src/lib/arena/rules-store";
import { zeroCostRecord } from "../../src/lib/arena/vm/skill-payment";
import { unlimitedUsage } from "../../src/lib/arena/vm/usage";
import { noSparking } from "../../src/lib/arena/vm/validity";
import type { Op } from "../../src/lib/arena/vm/script";

// ── the old tabs mean a health ────────────────────────────────────────────
{
  assert.equal(parseQueue({ state: "open" }).health, "text-only", "open is text only");
  assert.equal(parseQueue({ state: "draft" }).health, "unchecked", "a draft is read, not checked");
  assert.equal(parseQueue({ state: "confirmed" }).health, "done");
  assert.equal(parseQueue({ state: "corrected" }).health, "done", "corrected is done too");
  assert.equal(parseQueue({ seg: "open", deck: "4" }).health, "text-only", "seg=open (the Play picker's old link) is text only");
  assert.equal(parseQueue({ state: "open", health: "incomplete" }).health, "incomplete", "health wins over the old name");
  assert.equal(parseQueue({ state: "nope" }).health, null, "an unknown tab is the default");
  assert.deepEqual(parseQueue({}).scope, { kind: "decks" }, "the default scope is my decks");
  assert.equal(parseQueue({ scope: "catalog" }).scope.kind, "catalog");
  // the legacy `state` field the guided review still reads
  assert.equal(parseQueue({ health: "unchecked" }).state, "draft");
  assert.equal(parseQueue({ health: "incomplete" }).state, null);

  const q = parseQueue({ deck: "3", health: "incomplete", group: "reason", q: "goku", set: "BT6", family: "wrong", page: "2" });
  assert.deepEqual(parseQueue(Object.fromEntries(new URL(`http://x${queueHref(q)}`).searchParams)), q, "a link reads back as the queue that built it");
  assert.equal(queueLink(q, { health: "done" }), "/arena/rules?deck=3&health=done&group=reason&q=goku&set=BT6&family=wrong", "a new tab drops the page");
  assert.equal(parseQueue({ family: "bogus" }).family, "", "an unknown reason family is dropped");

  assert.equal(defaultHealth({ "text-only": 0, incomplete: 0, unchecked: 4, done: 1 }), "unchecked");
  assert.equal(defaultGroup("incomplete"), "reason", "Incomplete groups by reason");
  assert.equal(defaultGroup("done"), "none");
}

// ── the ?q= contract with the card page ───────────────────────────────────
{
  const q = parseQueue({ deck: "3", health: "unchecked", q: "son goku & co", page: "4", rule: "9" });
  assert.equal(queueParam(q), "deck=3&health=unchecked&q=son+goku+%26+co", "the queue's own query string, without the page or a rule");
  const href = cardHref("BT6-010", q, 77);
  const url = new URL(`http://x${href}`);
  assert.equal(url.pathname, "/arena/rules/card/BT6-010");
  assert.equal(url.searchParams.get("skill"), "77");
  const back = queueFromParam(url.searchParams.get("q") ?? undefined);
  assert.deepEqual([back.scope, back.health, back.q, back.page], [{ kind: "deck", id: 3 }, "unchecked", "son goku & co", 0], "the card page gets the queue back");
  assert.equal(cardHref("BT6-010", parseQueue({})), "/arena/rules/card/BT6-010", "the default queue adds nothing");
  assert.deepEqual(neighbours(["A", "B", "C"], "B"), { prev: "A", next: "C", skip: "C", after: "C" }, "Next and Previous walk card ids too");
}

// ── a card from its rows ──────────────────────────────────────────────────
const ATTACK = "[Auto] When this card attacks, draw 1 card.";
const draw = [{ op: "draw", n: 1 }] as unknown as Op[];
let nextId = 1;
const row = (o: Partial<HealthRow> & { side?: string; pattern?: string | null } = {}) =>
  ({ id: nextId++, side: "front", pattern: "draw", kind: "auto", unread: [], ops: draw, cost: zeroCostRecord(), usage: unlimitedUsage(), validity: noSparking(), trigger: ["attacks"], printed: ATTACK, status: "draft", skillIndex: 0, source: "compiler", ...o }) as HealthRow & { id: number; side: string; pattern: string | null };
const card = (id: string, name = id, skill: string | null = ATTACK) => ({ id, name, setCode: id.split("-")[0], cardType: "BATTLE", colors: ["Red"], imageUrl: null, skill, backSkill: null });
const cls = (c: ReturnType<typeof card>, rows: ReturnType<typeof row>[]) => classifyQueueCard(c, rows)!;

{
  assert.equal(classifyQueueCard(card("X-1", "Vanilla", null), []), null, "a card that prints nothing has nothing to check");
  const unchecked = cls(card("A-1"), [row()]);
  assert.equal(unchecked.health, "unchecked");
  assert.deepEqual(unchecked.skills.map((s) => s.health), ["unchecked"], "one dot per printed skill");
  assert.match(unchecked.reasons[0], /nobody has checked/);
  assert.equal(unchecked.wording, "draw", "a draft groups under its pattern");

  // A Claude draft waiting for the owner leads the reason line, over an older audit flag.
  const waiting = cls(card("A-1b"), [row({ source: "claude", status: "draft", reviewFlag: "Wrong (phone review) · old note" })]);
  assert.equal(waiting.claudeFix, 1);
  assert.equal(waiting.reasons[0], CLAUDE_FIX_REASON, "the waiting fix comes before the stale flag text");
  assert.equal(unchecked.claudeFix, 0, "a compiler draft is nobody's fix");
  assert.equal(cls(card("A-1c"), [row({ source: "claude", status: "confirmed" })]).claudeFix, 0, "an approved Claude row waits for no one");

  const done = cls(card("A-2"), [row({ status: "confirmed" })]);
  assert.equal(done.health, "done");
  assert.deepEqual(done.reasons, [], "a done card has nothing to say");

  const missing = cls(card("A-3"), []);
  assert.equal(missing.health, "text-only", "a printed skill with no rule row is text only");
  assert.equal(missing.missing, 1);
  assert.equal(missing.ruleId, null);

  const open = cls(card("A-4"), [row({ status: "open", ops: [], unread: ["draw 1 card"], pattern: null })]);
  assert.equal(open.health, "text-only");
  assert.match(open.reasons.join(" "), /Not read/);
  assert.ok(open.mechanism, "an open row carries the mechanism it would need");

  const wrong = cls(card("A-5"), [row({ status: "confirmed", reviewFlag: "Wrong (phone review) · DO ops[0] · wrong target" })]);
  assert.equal([wrong.health, wrong.family].join("/"), "incomplete/wrong", "a phone-review flag is 'marked wrong'");
  assert.match(wrong.reasons[0], /^Marked wrong/);
  const review = cls(card("A-6"), [row({ status: "draft", reviewFlag: "claude.ai review: suspected misread" })]);
  assert.equal(review.family, "review", "any other flag is the claude.ai review's");
  const diff = cls(card("A-7"), [row({ status: "confirmed", compilerDiff: { ops: [], unread: [], at: "2026-10-19" } })]);
  assert.equal(diff.family, "diff");

  // A card takes its worst skill; its dots show each.
  const two = `${ATTACK}<br>[Auto] When this card is played, draw 2 cards.`;
  const mixed = cls(card("A-8", "Mixed", two), [row({ status: "confirmed" }), row({ skillIndex: 10, printed: "[Auto] When this card is played, draw 2 cards.", status: "draft" })]);
  assert.deepEqual(mixed.skills.map((s) => s.health), ["done", "unchecked"]);
  assert.equal(mixed.health, "unchecked", "the worst skill names the card");

  // The payment rebuild is a step, not a health: an old record changes no tab and is counted.
  const old = cls(card("A-9"), [row({ cost: null as never })]);
  assert.equal(old.rebuild.rows, 1, "a row with no payment record needs a rebuild");
  assert.equal(old.rebuild.compiler, 1, "…and the compiler may rewrite it, being its own draft");
  const approved = cls(card("B-1"), [row({ cost: null as never, status: "confirmed" })]);
  assert.deepEqual([approved.rebuild.compiler, approved.rebuild.protectedRows], [0, 1], "an approved row is protected: counted, never rewritten");
  const byClaude = cls(card("B-2"), [row({ cost: null as never, source: "claude" })]);
  assert.deepEqual([byClaude.rebuild.compiler, byClaude.rebuild.other], [0, 1], "a Claude draft is not the compiler's to rewrite");
}

// ── deck-building clauses are their own category (#1146) ──────────────────
{
  const openRow = (printed: string, over: Partial<HealthRow> = {}) =>
    row({ printed, kind: "permanent", status: "open", ops: [], trigger: [], pattern: null, unread: [printed.replace(/^\[[^\]]*\]\s*/, "").replace(/\.$/, "")], ...over });
  const deckCard = (id: string, printed: string) => card(id, id, printed);

  for (const [id, printed] of [
    ["BT18-003", "[Permanent] You can only include 1 copy of this card in your Z-Deck."],
    ["BT13-149", "[Permanent] You can include up to 7 copies of this card in your deck."],
    ["BT13-122", "[Permanent] You can only include up to 7 ≪Dark Dragon Ball≫ cards in your deck."],
    ["BT25-007", "[Permanent] You can include as many copies of this card in your Z-Deck as you like."],
    ["EX24-01", "[permanent] You can only include Z-Unisons in your Z-Deck."],
    ["BT31-116", "[Permanent] You can't include non-white Extra in your deck."],
  ] as const) {
    const q = cls(deckCard(id, printed), [openRow(printed)]);
    assert.equal(q.category, "deck-building", `${id} is Deck-building`);
    assert.notEqual(q.health, "text-only", `${id} is not Text only`);
    assert.deepEqual(q.skills.map((s) => s.category), ["deck-building"]);
    assert.ok(q.deckBuilding.length === 1 && q.deckBuilding[0].length > 0, `${id} says what it restricts`);
  }

  // The stored row does not matter: even a draft with a leftover unread clause is read from the printed line.
  const stale = cls(deckCard("BT18-003", "[Permanent] You can only include 1 copy of this card in your Z-Deck."), [openRow("[Permanent] You can only include 1 copy of this card in your Z-Deck.", { status: "draft", unread: ["x"] })]);
  assert.equal(stale.category, "deck-building");

  // A line that is not deck-building keeps its health; a mixed line's game half keeps its own.
  const text = "[Permanent] You can't include non-≪Villainous≫ cards in your deck, and treat ≪Villainous≫ cards in your hand as if they have no specified cost.";
  const mixed = cls(deckCard("P-434", text), [openRow(text)]);
  assert.equal(mixed.health, "text-only", "the game half is still unread");
  assert.equal(mixed.category, null, "a mixed line is not the deck-building category");
  assert.equal(mixed.deckBuilding.length, 1, "…but its clause is still said");
  const ordinary = cls(card("A-9"), [row({ status: "open", ops: [], unread: ["draw 1 card"] })]);
  assert.equal(ordinary.health, "text-only");
  assert.equal(ordinary.category, null);

  // A card with a deck-building clause and a skill still to do stays in that skill's health.
  const both = cls(card("B-1", "B-1", `${ATTACK}<br>[Permanent] You can only include 1 copy of this card in your Z-Deck.`), [row({ status: "draft" }), openRow("[Permanent] You can only include 1 copy of this card in your Z-Deck.", { skillIndex: 10 })]);
  assert.equal(both.health, "unchecked");
  assert.equal(both.category, null, "the card is waiting on its other skill");
  assert.deepEqual(both.skills.map((s) => s.category), [null, "deck-building"]);
}

// ── the view: narrowing, order, grouping ──────────────────────────────────
{
  const mk = (id: string, name: string, health: QueueCard["health"], extra: Partial<QueueCard> = {}): QueueCard => ({
    cardId: id, name, setCode: id.split("-")[0], cardType: "BATTLE", colors: [], imageUrl: null, health, skills: [{ health, ruleId: 1, family: null, category: null }], category: null, deckBuilding: [],
    reasons: [], family: null, ruleId: 1, source: "compiler", wording: null, mechanism: null, missing: 0, rebuild: { rows: 0, compiler: 0, protectedRows: 0, other: 0 }, claudeFix: 0, ...extra,
  });
  const cs = [
    mk("BT1-1", "Beta", "incomplete", { family: "combo", reasons: ["combo"] }),
    mk("BT1-2", "Alpha", "incomplete", { family: "wrong", reasons: ["Marked wrong"] }),
    mk("BT2-1", "Gamma", "incomplete", { family: "wrong", reasons: ["Marked wrong"] }),
    mk("BT2-2", "Delta", "unchecked", { wording: "draw", reasons: ["Read by the compiler"] }),
    mk("BT3-1", "Eps", "unchecked", { wording: "draw", reasons: ["Read by the compiler"] }),
    mk("BT3-2", "Zeta", "done"),
  ];
  const decks: Record<string, number> = { "BT2-1": 3, "BT1-1": 1 };
  const weight = (id: string) => decks[id] ?? 0;
  assert.deepEqual(viewOfQueue(cs, { health: "incomplete", weight }).map((c) => c.name), ["Gamma", "Beta", "Alpha"], "more decks first, then by name");
  assert.deepEqual(viewOfQueue(cs, { health: "incomplete", family: "wrong" }).map((c) => c.name), ["Alpha", "Gamma"], "a family narrows the tab");
  assert.deepEqual(viewOfQueue(cs, { health: "unchecked", pattern: "draw" }).length, 2, "a wording narrows it");

  const byReason = groupCards(viewOfQueue(cs, { health: "incomplete", weight }), "reason", "incomplete");
  assert.deepEqual(byReason.map((g) => [g.title, g.cards.length]), [["You marked it Wrong", 2], ["Combo qualification missing", 1]], "Incomplete groups by family, in the family order, empty ones left out");
  assert.deepEqual(byReason[0].patch, { family: "wrong", group: "none" }, "a group links to the list narrowed to it");
  const byWording = groupCards(viewOfQueue(cs, { health: "unchecked" }), "wording", "unchecked");
  assert.deepEqual(byWording.map((g) => [g.title, g.cards.length]), [["draw", 2]]);
  assert.deepEqual(groupCards(cs, "set", "incomplete").map((g) => g.title), ["BT1", "BT2", "BT3"], "sets in order");
  const plain = groupCards(viewOfQueue(cs, { health: "unchecked" }), "reason", "unchecked");
  assert.deepEqual(plain.map((g) => g.title), ["Read by the compiler"], "outside Incomplete, by the first reason in words");
}

console.log("rules-queue: ok");
