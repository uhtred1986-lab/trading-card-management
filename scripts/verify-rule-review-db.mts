/**
 * verify-db checks for the phone's rule review queue (#472): a deck with three
 * open and two draft skills, worked through with every verdict. Each verdict
 * is checked by the write its action makes — Reads right is
 * `confirmRuleAction`'s `confirmRule`, its Undo `reopenRuleAction`'s
 * `reopenRule`, Confirm all is `confirmAllAction`'s `confirmMatching` with the
 * pattern and the ids `confirmSameWordingAction` sends, its Undo
 * `undoConfirmAction`'s `undoConfirmed`, and Wrong is `flagWrongAction`'s
 * `flagWrong` — on PGlite, the way the actions run them on Neon. Kept in its
 * own file so verify-db.mts only gains one line.
 */
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { draftCards, reviewOpenRule } from "../src/lib/arena/draft.ts";
import { FLAG_PREFIX } from "../src/lib/arena/rule-review.ts";
import { recentFired, reviewQueue, sameWordingIds, flagWrong, unflagWrong } from "../src/lib/arena/rule-review-store.ts";
import { confirmMatching, confirmRule, countRules, reopenRule, undoConfirmed } from "../src/lib/arena/rules-store.ts";

export async function verifyRuleReviewDb(db: Db): Promise<void> {
  const card = (id: string, name: string, skill: string) => ({ id, setCode: "BT18", name, cardType: "BATTLE", rarity: "Common[C]", rarityCode: "C", searchText: `${id} ${name}`.toLowerCase(), skill });
  const KO = "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with a cost of 3 or less and KO it.";
  await db.insert(schema.cards).values([
    card("BT18-780", "Open A", "[Auto] When this card attacks, you and your opponent compliment each other."),
    card("BT18-781", "Open B", "[Auto] When you play this card, you and your opponent shake hands warmly."),
    card("BT18-782", "Open C", "[Main] Choose 1 of your opponent's Battle Cards with a cost of 4 or less and switch its position."),
    card("BT18-783", "Draft A", KO),
    card("BT18-784", "Draft B", KO),
    // The same wording outside the deck: "Confirm all" reaches the whole catalog, as the workbench's does.
    card("BT18-785", "Draft elsewhere", KO),
  ]);
  const deckIds = ["BT18-780", "BT18-781", "BT18-782", "BT18-783", "BT18-784"];
  const all = [...deckIds, "BT18-785"];
  await draftCards(db, all);
  assert.deepEqual(await countRules(db, deckIds), { open: 3, draft: 2, confirmed: 0, corrected: 0 }, "the fixture deck: three open skills, two drafts");

  const rules = await db.select().from(schema.cardRules).where(inArray(schema.cardRules.cardId, all));
  const idOf = (cardId: string) => rules.find((r) => r.cardId === cardId)!.id;
  const [draftA, draftB, elsewhere] = [idOf("BT18-783"), idOf("BT18-784"), idOf("BT18-785")];
  const statusOf = async (id: number) => (await db.select({ s: schema.cardRules.status, v: schema.cardRules.version, e: schema.cardRules.explanation }).from(schema.cardRules).where(eq(schema.cardRules.id, id)))[0];

  // ── the queue ─────────────────────────────────────────────────────────────
  assert.deepEqual(await recentFired(db, 999_999), { gameId: null, fired: [] }, "a deck no game played has fired nothing");
  const decksOf = new Map(deckIds.map((id) => [id, ["Review Deck"]]));
  const queue = () => reviewQueue(db, { cardIds: deckIds, decksOf, recent: { gameId: 77, fired: [{ cardId: "BT18-784", skillIndex: 0 }] } });
  const q0 = await queue();
  assert.deepEqual(
    q0.map((x) => x.cardId),
    ["BT18-780", "BT18-781", "BT18-782", "BT18-784", "BT18-783"],
    "open first, then the draft the recent game fired, then the rest",
  );
  assert.equal(q0[3].firedIn, 77, "the fired draft says which game");
  assert.equal(q0[4].firedIn, null);
  assert.deepEqual(q0[4].decks, ["Review Deck"]);
  assert.equal(q0[4].sameWording, 2, "two more drafts read the same way: the deck's other one and the one elsewhere");
  assert.equal(q0[0].sameWording, 0, "an open row offers no Confirm all");
  assert.ok(q0[0].unread.length > 0 && q0[0].printed.includes(q0[0].unread[0]), "an open row carries the clause it could not read");

  // ── Skip writes nothing ───────────────────────────────────────────────────
  const before = await countRules(db, all);
  assert.deepEqual(await countRules(db, all), before, "Skip is the phone's alone: no write to undo");

  // ── Reads right, and its Undo ─────────────────────────────────────────────
  await confirmRule(db, draftB);
  assert.equal((await statusOf(draftB)).s, "confirmed", "Reads right confirms the rule");
  assert.equal((await queue()).some((x) => x.id === draftB), false, "…and it leaves the queue");
  await reopenRule(db, draftB);
  assert.equal((await statusOf(draftB)).s, "draft", "Undo puts it back to draft");

  // ── Wrong, and its Undo ───────────────────────────────────────────────────
  const v0 = (await statusOf(draftA)).v;
  const receipt = await flagWrong(db, draftA, { tag: "DO", path: "ops[1]", reason: "wrong target", note: "only Battle Cards in rest mode" }, "owner");
  assert.ok(receipt);
  const flagged = await statusOf(draftA);
  assert.equal(flagged.e, `${FLAG_PREFIX} · DO ops[1] · wrong target — only Battle Cards in rest mode`, "the clause and the reason first, then the note, in `explanation`");
  assert.deepEqual([flagged.s, flagged.v], ["draft", v0], "the rule stays a draft, program and version untouched");
  const [note] = await db.select().from(schema.arenaFeedback).where(eq(schema.arenaFeedback.id, receipt.feedbackId));
  assert.deepEqual([note.kind, note.cardId, note.noteId, note.reportedBy, note.status], ["rule", "BT18-783", draftA, "owner", "open"], "and a note waits for the computer");
  assert.equal((await queue()).some((x) => x.id === draftA), false, "a flagged draft waits for the computer, not in the queue again");
  assert.deepEqual((await sameWordingIds(db, draftB))?.ids.sort(), [draftB, elsewhere].sort(), "nor is it confirmed in bulk behind the flag");

  await unflagWrong(db, receipt);
  assert.equal((await statusOf(draftA)).e, null, "Undo puts the explanation back as it was");
  const [closed] = await db.select().from(schema.arenaFeedback).where(eq(schema.arenaFeedback.id, receipt.feedbackId));
  assert.deepEqual([closed.status, closed.resolution], ["wontfix", "taken back on the phone"], "the note is closed, not deleted");
  assert.equal((await queue()).some((x) => x.id === draftA), true, "and the draft is back in the queue");

  // An earlier explanation survives a flag, and an Undo never erases words written since.
  await db.update(schema.cardRules).set({ explanation: "Claude: the earlier words" }).where(eq(schema.cardRules.id, draftA));
  const again = await flagWrong(db, draftA, { tag: "WHEN", path: "trigger[0]", reason: "something else" });
  assert.ok((await statusOf(draftA)).e?.endsWith("\n\nClaude: the earlier words"), "the earlier explanation is kept under the flag");
  await db.update(schema.cardRules).set({ explanation: "fixed on the computer since" }).where(eq(schema.cardRules.id, draftA));
  assert.deepEqual(await unflagWrong(db, again!), { restored: false }, "a late Undo leaves words written since alone");
  assert.equal((await statusOf(draftA)).e, "fixed on the computer since");
  await db.update(schema.cardRules).set({ explanation: null }).where(eq(schema.cardRules.id, draftA));

  // ── Confirm all N+1, and its Undo ─────────────────────────────────────────
  const elsewhereFlag = await flagWrong(db, elsewhere, { tag: "DO", path: "ops[0]", reason: "reads it differently" });
  const same = await sameWordingIds(db, draftA);
  assert.ok(same && same.pattern === rules.find((r) => r.id === draftA)!.pattern);
  assert.deepEqual(same.ids.sort(), [draftA, draftB].sort(), "Confirm all aims at itself and the unflagged drafts of its pattern");
  const batch = await confirmMatching(db, { pattern: same.pattern, ruleIds: same.ids });
  assert.deepEqual(batch.rules.map((r) => r.id).sort(), [draftA, draftB].sort(), "both confirmed in one press");
  assert.equal((await statusOf(elsewhere)).s, "draft", "the flagged one is not");
  assert.equal(await sameWordingIds(db, draftA), null, "a confirmed rule offers no Confirm all");
  assert.deepEqual(await undoConfirmed(db, batch), { reverted: 2, kept: 0 }, "Undo takes the batch back");
  assert.deepEqual([(await statusOf(draftA)).s, (await statusOf(draftB)).s], ["draft", "draft"]);
  await unflagWrong(db, elsewhereFlag!);

  // ── Ask Claude: refused before any network for anything but an open row ──
  assert.deepEqual(await reviewOpenRule(db, draftA), { drafted: false, why: "only an open skill is drafted by Claude here" });
  assert.deepEqual(await reviewOpenRule(db, 999_999), { drafted: false, why: "no such rule" });
  assert.equal((await statusOf(draftA)).s, "draft", "a refusal writes nothing");

  // The whole sitting leaves the catalog as it found it.
  assert.deepEqual(await countRules(db, all), before);

  await db.delete(schema.arenaFeedback).where(and(eq(schema.arenaFeedback.kind, "rule"), inArray(schema.arenaFeedback.cardId, all)));
  await db.delete(schema.cardRules).where(inArray(schema.cardRules.cardId, all));
  await db.delete(schema.cards).where(inArray(schema.cards.id, all));
}
