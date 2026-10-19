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
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { catalogIds, draftCards, reviewOpenRule, reviewOpenRules, skillRecords } from "../src/lib/arena/draft.ts";
import { cardDefFrom } from "../src/lib/arena/load.ts";
import { reviewVersion } from "../src/lib/arena/rule-review-version.ts";
import { FLAG_PREFIX } from "../src/lib/arena/rule-review.ts";
import { recentFired, reviewQueue, reviewItemById, sameWordingIds, flagWrong, unflagWrong } from "../src/lib/arena/rule-review-store.ts";
import { confirmMatching, confirmReviewedRule, confirmRule, countRules, draftPatterns, loadRules, openPatterns, reasonGroups, reopenRule, ruleById, saveReviewedExplanation, setGroups, siblingsOf, statusCounts, undoConfirmed, worklist, worklistPage } from "../src/lib/arena/rules-store.ts";

export async function verifyRuleReviewDb(db: Db): Promise<void> {
  const card = (id: string, name: string, skill: string) => ({ id, setCode: "BT18", name, cardType: "BATTLE", rarity: "Common[C]", rarityCode: "C", searchText: `${id} ${name}`.toLowerCase(), skill });
  const KO = "[Auto] When you play this card, choose up to 1 of your opponent's Battle Cards with a cost of 3 or less and KO it.";
  await db.insert(schema.cards).values([
    card("BT18-780", "Open A", "[Auto] When this card attacks, you and your opponent shake hands on it."),
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
  const statusOf = async (id: number) => (await db.select({ s: schema.cardRules.status, v: schema.cardRules.version, e: schema.cardRules.explanation, f: schema.cardRules.reviewFlag }).from(schema.cardRules).where(eq(schema.cardRules.id, id)))[0];

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
  assert.equal(flagged.f, `${FLAG_PREFIX} · DO ops[1] · wrong target — only Battle Cards in rest mode`, "the clause and the reason first, then the note, in `review_flag`");
  assert.equal(flagged.e, null, "the explanation is left alone");
  assert.deepEqual([flagged.s, flagged.v], ["draft", v0], "the rule stays a draft, program and version untouched");
  const [note] = await db.select().from(schema.arenaFeedback).where(eq(schema.arenaFeedback.id, receipt.feedbackId));
  assert.deepEqual([note.kind, note.cardId, note.noteId, note.reportedBy, note.status], ["rule", "BT18-783", draftA, "owner", "open"], "and a note waits for the computer");
  assert.equal((await queue()).some((x) => x.id === draftA), false, "a flagged draft waits for the computer, not in the queue again");
  assert.deepEqual((await sameWordingIds(db, draftB))?.ids.sort(), [draftB, elsewhere].sort(), "nor is it confirmed in bulk behind the flag");


  const reports = await reviewQueue(db, { cardIds: deckIds, ruleIds: [draftA, draftB], flaggedOnly: true, decksOf, recent: { gameId: null, fired: [] } });
  assert.deepEqual(reports.map((r) => r.id), [draftA], "reported mismatches remain reachable in their scoped correction queue");
  assert.deepEqual((await reviewQueue(db, { cardIds: deckIds, ruleIds: [draftB], decksOf, recent: { gameId: null, fired: [] } })).map((r) => r.id), [draftB], "guided review honors exact rule filters");
  const protectedBatch = await confirmMatching(db, { cardIds: ["BT18-783", "BT18-784"] });
  assert.deepEqual(protectedBatch.rules.map((r) => r.id), [draftB], "workbench bulk approval excludes reported mismatches on the server");
  await undoConfirmed(db, protectedBatch);
  await unflagWrong(db, receipt);
  assert.equal((await statusOf(draftA)).f, null, "Undo puts the flag back as it was");
  const [closed] = await db.select().from(schema.arenaFeedback).where(eq(schema.arenaFeedback.id, receipt.feedbackId));
  assert.deepEqual([closed.status, closed.resolution], ["wontfix", "taken back on the phone"], "the note is closed, not deleted");
  assert.equal((await queue()).some((x) => x.id === draftA), true, "and the draft is back in the queue");

  // The explanation is never touched; an earlier flag survives a new one, and an Undo never erases words written since.
  await db.update(schema.cardRules).set({ explanation: "Claude: the earlier words", reviewFlag: "flagged in claude.ai review" }).where(eq(schema.cardRules.id, draftA));
  const again = await flagWrong(db, draftA, { tag: "WHEN", path: "trigger[0]", reason: "something else" });
  assert.ok((await statusOf(draftA)).f?.endsWith("\nflagged in claude.ai review"), "the earlier flag is kept under the new one");
  assert.equal((await statusOf(draftA)).e, "Claude: the earlier words", "the explanation stays as it was");
  assert.equal((await queue()).some((x) => x.id === draftA), false, "a flag from claude.ai review also keeps a draft out of the phone queue");
  await db.update(schema.cardRules).set({ reviewFlag: "fixed on the computer since" }).where(eq(schema.cardRules.id, draftA));
  assert.deepEqual(await unflagWrong(db, again!), { restored: false }, "a late Undo leaves words written since alone");
  assert.equal((await statusOf(draftA)).f, "fixed on the computer since");
  await db.update(schema.cardRules).set({ explanation: null, reviewFlag: null }).where(eq(schema.cardRules.id, draftA));
  // A flag the old way (prefix in the explanation) is still a flag until the migration has moved it.
  await db.update(schema.cardRules).set({ explanation: `${FLAG_PREFIX} · DO ops[0] · wrong target` }).where(eq(schema.cardRules.id, draftA));
  assert.equal((await queue()).some((x) => x.id === draftA), false, "the old prefix still hides the draft");
  await db.update(schema.cardRules).set({ explanation: null }).where(eq(schema.cardRules.id, draftA));

  // ── The data migration that moved the old explanation-prefix flags into review_flag ──
  {
    const migration = fs.readFileSync(path.resolve("drizzle/0061_review_flag_from_wrong.sql"), "utf8");
    const old = `${FLAG_PREFIX} · DO ops[1] · wrong target — only Battle Cards\n\nClaude: the earlier words`;
    await db.update(schema.cardRules).set({ explanation: old, reviewFlag: null }).where(eq(schema.cardRules.id, draftA));
    await db.update(schema.cardRules).set({ explanation: old, reviewFlag: "already flagged in claude.ai" }).where(eq(schema.cardRules.id, draftB));
    await db.update(schema.cardRules).set({ explanation: "Claude: no flag here", reviewFlag: null }).where(eq(schema.cardRules.id, elsewhere));
    await db.execute(sql.raw(migration));
    const got = async (id: number) => (await statusOf(id));
    assert.equal((await got(draftA)).f, `${FLAG_PREFIX} · DO ops[1] · wrong target — only Battle Cards`, "the old flag moved: its first line");
    assert.equal((await got(draftA)).e, old, "…and the explanation is never edited");
    assert.equal((await got(draftB)).f, "already flagged in claude.ai", "a row that already has a review_flag keeps it");
    assert.deepEqual([(await got(elsewhere)).f, (await got(elsewhere)).e], [null, "Claude: no flag here"], "an ordinary explanation is not a flag");
    assert.equal((await queue()).some((x) => x.id === draftA), false, "migrated, the draft is still out of the phone queue");
    await db.update(schema.cardRules).set({ explanation: null, reviewFlag: null }).where(inArray(schema.cardRules.id, [draftA, draftB, elsewhere]));
  }

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

  await verifyMarkerReminders(db);

  await db.delete(schema.arenaFeedback).where(and(eq(schema.arenaFeedback.kind, "rule"), inArray(schema.arenaFeedback.cardId, all)));
  await db.delete(schema.cardRules).where(inArray(schema.cardRules.cardId, all));
  await db.delete(schema.cards).where(inArray(schema.cards.id, all));
}

/** Legacy accessory records survive intact but cannot masquerade as playable skills. */
async function verifyMarkerReminders(db: Db): Promise<void> {
  const reminder = "At the start of the game, the player who goes second places one Energy Marker in their Energy Area. Removing one Energy Marker from the game is equivalent to switching one card from your energy, with the same color as your Leader, to Rest Mode.";
  const markers = ["BT18-790", "BT18-791", "BT18-792", "BT18-793", "BT18-794", "BT18-795"];
  const battleId = "BT18-796";
  const all = [...markers, battleId];
  await db.insert(schema.cards).values(all.map((id) => ({
    id, setCode: "BT18", name: id === battleId ? "Marker-making Battle Card" : "Energy Marker",
    // Normalization agrees between the SQL queue guard and pure skill drafting.
    cardType: id === battleId ? "BATTLE" : id === markers[1] ? " energy marker " : "ENERGY MARKER",
    rarity: "Common[C]", rarityCode: "C", searchText: id.toLowerCase(),
    skill: id === battleId ? "[Auto] When you play this card, place 1 energy marker in your energy area." : reminder,
  })));
  await draftCards(db, [battleId]);
  const [real] = await loadRules(db, [battleId]);
  assert.equal(real.status, "draft", "ordinary Battle skills mentioning markers are still compiled");
  assert.deepEqual(real.ops, [{ op: "energyMarker", n: 1 }], "the existing shared marker operation is used");
  assert.ok(real.pattern);

  await db.insert(schema.cardRules).values([
    { cardId: markers[0], status: "open", source: "compiler", unread: [reminder] },
    { cardId: markers[1], status: "draft", source: "compiler", unread: [] },
    { cardId: markers[2], status: "corrected", source: "user", unread: [], explanation: "Owner's historical interpretation" },
    { cardId: markers[3], status: "confirmed", source: "user", unread: [] },
    { cardId: markers[4], status: "draft", source: "claude", unread: [] },
    // markers[5] deliberately has no row: future drafting must not create one.
  ].map((r) => ({ ...r, side: "front", skillIndex: 0, printed: reminder, kind: "Auto", pattern: real.pattern,
    ops: [{ op: "energyMarker", n: 1 }], reads: "Historical reminder reading", version: 7 })));
  const rawMarkers = () => db.select().from(schema.cardRules).where(inArray(schema.cardRules.cardId, markers)).orderBy(schema.cardRules.id);
  const before = await rawMarkers();
  const baselineCounts = await countRules(db);
  const visible = { open: 0, draft: 1, confirmed: 0, corrected: 0 };
  assert.deepEqual(await countRules(db, all), visible, "legacy accessories do not inflate any skill status");
  assert.deepEqual(await statusCounts(db, { cardIds: all }), visible, "workbench segment counts agree");
  assert.deepEqual((await worklist(db, all)).map((r) => r.id), [real.id]);
  const page = await worklistPage(db, { cardIds: all }, { limit: 20, offset: 0 });
  assert.equal(page.total, 1);
  assert.deepEqual(page.rows.map((r) => r.id), [real.id], "pagination counts only playable skills");
  assert.deepEqual(await openPatterns(db, { cardIds: all }), [], "marker reminders form no open wording group");
  const groups = await draftPatterns(db, 60, { cardIds: all });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].rules, 1, "marker drafts do not join real skill wording groups");
  assert.deepEqual(await reasonGroups(db, { cardIds: all }), [], "markers form no unread or Claude-draft reason group");
  assert.deepEqual((await setGroups(db, { cardIds: all })).map((g) => g.rules), [1]);
  assert.deepEqual(await siblingsOf(db, real), { count: 0, ids: [] }, "legacy patterns are not review siblings");
  assert.deepEqual((await sameWordingIds(db, real.id))?.ids, [real.id]);
  assert.deepEqual((await reviewQueue(db, { cardIds: all, decksOf: new Map(), recent: { gameId: null, fired: [] } })).map((r) => r.id), [real.id]);
  const ids = await catalogIds(db, "BT18");
  assert.ok(ids.includes(battleId) && markers.every((id) => !ids.includes(id)), "catalog drafting selects playable entries only");
  for (const marker of await db.select().from(schema.cards).where(inArray(schema.cards.id, markers))) {
    assert.deepEqual(skillRecords(cardDefFrom(marker)), [], "pure drafting also refuses accessory reminders");
  }
  for (const marker of before) {
    assert.equal(await ruleById(db, marker.id), null, "stale workbench links cannot review a reminder");
    assert.equal(await reviewItemById(db, marker.id, { decks: [], firedIn: null }), null, "stale guided links cannot review a reminder");
    assert.equal(await sameWordingIds(db, marker.id), null);
    await confirmRule(db, marker.id);
    await assert.rejects(confirmReviewedRule(db, marker.id, reviewVersion(marker)), /changed/);
    await assert.rejects(saveReviewedExplanation(db, marker.id, reviewVersion(marker), { kind: "Auto", trigger: [], cost: null, cond: null, ops: [{ op: "energyMarker", n: 1 }] }, "approve stale proposal"), /changed/);
    assert.equal(await flagWrong(db, marker.id, { tag: "DO", path: "ops[0]", reason: "something else" }), null);
    assert.deepEqual(await reviewOpenRule(db, marker.id), { drafted: false, why: "no such rule" }, "no paid request for legacy reminder IDs");
  }
  assert.deepEqual(await reviewOpenRules(db, markers), { asked: 0, drafted: 0, failed: 0, stillOpen: 0 }, "sync review does not send reminder text to Claude");
  assert.deepEqual((await confirmMatching(db, { cardIds: all })).rules.map((r) => r.id), [real.id], "bulk approval ignores even complete legacy marker drafts");
  await draftCards(db, all);
  await draftCards(db, all, { onlyOpen: true });
  assert.deepEqual(await rawMarkers(), before, "drafting and every approval path preserve all marker row fields, timestamps and programs");
  assert.deepEqual(await loadRules(db, markers), before, "low-level historical records remain accessible");
  assert.equal((await db.select().from(schema.cards).where(inArray(schema.cards.id, markers))).length, markers.length, "collectible catalog entries remain intact");
  assert.deepEqual(await countRules(db), { ...baselineCounts, draft: baselineCounts.draft - 1, confirmed: baselineCounts.confirmed + 1 }, "global counters also omit accessories after approving the real skill");

  await db.delete(schema.cardRules).where(inArray(schema.cardRules.cardId, all));
  await db.delete(schema.cards).where(inArray(schema.cards.id, all));
}
