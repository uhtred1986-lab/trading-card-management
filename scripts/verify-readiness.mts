/**
 * verify-db checks for rule readiness (#357): the one query's counts, and the
 * server-side block — `startGame` and `openMatch` refuse a deck with an open
 * rule, `joinMatch` refuses a joiner's. Kept in its own file so verify-db.mts
 * only gains one line.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { deckCardSets, deckCardStates, readiness } from "../src/lib/arena/readiness.ts";
import { startGame } from "../src/lib/arena/games.ts";
import { joinMatch, openMatch } from "../src/lib/arena/matches.ts";
import { loadRules, rulesFromRows, runtimeSupportOfRow } from "../src/lib/arena/rules-store.ts";
import { defsForCards } from "../src/lib/arena/load.ts";

export async function verifyReadiness(db: Db): Promise<void> {
  const card = (id: string, name: string, cardType = "BATTLE", skill: string | null = null, backSkill: string | null = null) => ({ id, setCode: "BT18", name, cardType, skill, backName: backSkill ? `${name} Awakened` : null, backSkill, rarity: "Common[C]", rarityCode: "C", searchText: `${id} ${name}`.toLowerCase() });
  await db.insert(schema.cards).values([
    card("BT18-900", "Ready Leader", "LEADER", "[Auto] When this card is played, draw 1 card.", "[Auto] When this card attacks, draw 1 card."),
    card("BT18-901", "Confirmed Card", "BATTLE", "[Auto] When this card is played, draw 1 card.<br>[Auto] When this card attacks, draw 1 card."),
    card("BT18-902", "Draft Card", "BATTLE", "[Auto] When this card is played, draw 1 card.<br>[Auto] When this card attacks, draw 1 card."),
    card("BT18-903", "Vanilla Card"),
    card("BT18-904", "Open Card", "BATTLE", "[Auto] When this card is played, draw 1 card.<br>[Auto] When this card attacks, draw 1 card.<br>[Auto] If your Leader is yellow, draw 2 cards."),
    card("BT18-905", "Corrected Card", "BATTLE", "[Auto] When this card is played, draw 1 card."),
    card("BT18-906", "Locked Leader", "LEADER", "[Auto] When this card is played, draw 1 card.", "[Auto] When this card attacks, draw 1 card."),
    card("BT18-907", "Confirmed Unread", "BATTLE", "[Auto] When this card is played, draw 1 card."),
    card("BT18-908", "Native Keyword", "BATTLE", "[Blocker]"),
    card("BT18-909", "Changed Text", "BATTLE", "[Auto] When this card is played, draw 2 cards."),
    card("BT18-910", "Legacy All-Area Gain", "BATTLE", "[Permanent] This card gains ≪Saiyan≫ in all areas."),
    card("BT18-911", "Current All-Area Gain", "BATTLE", "[Permanent] This card gains ≪Saiyan≫ in all areas."),
    card("BT18-912", "Scoped Identity Gain", "BATTLE", "[Permanent] This card gains ≪Saiyan≫."),
  ]);
  const front = "[Auto] When this card is played, draw 1 card.";
  const attack = "[Auto] When this card attacks, draw 1 card.";
  const rule = (cardId: string, status: string, skillIndex = 0, printed = front, extra: Record<string, unknown> = {}) => ({ cardId, side: "front", skillIndex, printed, kind: "auto", status, source: "compiler", trigger: printed.includes("attacks") ? ["attacks"] : ["played"], ...extra });
  await db.insert(schema.cardRules).values([
    rule("BT18-900", "confirmed"),
    { ...rule("BT18-900", "confirmed", 0, front), side: "back", printed: attack },
    rule("BT18-901", "confirmed", 0, front),
    rule("BT18-901", "confirmed", 10, attack),
    rule("BT18-902", "draft"),
    rule("BT18-902", "confirmed", 10, attack),
    rule("BT18-905", "corrected"),
    rule("BT18-904", "open"),
    rule("BT18-904", "confirmed", 10, attack),
    rule("BT18-906", "confirmed"),
    rule("BT18-907", "confirmed", 0, front, { unread: ["a clause the compiler did not read"] }),
    // A stale orphan row cannot turn an actually textless card into a rule card.
    rule("BT18-903", "open"),
    // A stale open row for a different printed line is incomplete coverage, not current open work.
    rule("BT18-909", "open", 0, front),
    {
      ...rule("BT18-910", "confirmed", 0, "[Permanent] This card gains ≪Saiyan≫ in all areas."),
      kind: "permanent", trigger: [], ops: [{ op: "modifyAttr", target: { sel: { special: "self" } }, attr: "traits", values: ["Saiyan"] }],
    },
    {
      ...rule("BT18-911", "confirmed", 0, "[Permanent] This card gains ≪Saiyan≫ in all areas."),
      kind: "permanent", trigger: [], ops: [{ op: "modifyAttr", target: { sel: { special: "self" } }, attr: "traits", values: ["Saiyan"], allAreas: true }],
    },
    {
      ...rule("BT18-912", "confirmed", 0, "[Permanent] This card gains ≪Saiyan≫."),
      kind: "permanent", trigger: [], ops: [{ op: "modifyAttr", target: { sel: { special: "self" } }, attr: "traits", values: ["Saiyan"] }],
    },
  ]);
  const mk = async (name: string, leader: string, mains: string[]) => {
    const [d] = await db.insert(schema.decks).values({ name, game: "dbs" }).returning({ id: schema.decks.id });
    await db.insert(schema.deckCards).values([
      { deckId: d.id, cardId: leader, zone: "leader", quantity: 1 },
      ...mains.map((cardId, i) => ({ deckId: d.id, cardId, zone: i === mains.length - 1 && mains.length > 3 ? "z" : "main", quantity: 4 })),
    ]);
    return d.id;
  };
  const ok = await mk("Ready Deck", "BT18-900", ["BT18-901", "BT18-902", "BT18-903", "BT18-905"]);
  const locked = await mk("Locked Deck", "BT18-906", ["BT18-901", "BT18-904"]);
  const practice = await mk("Incomplete Practice", "BT18-906", ["BT18-901", "BT18-908", "BT18-909"]);
  const legacyScope = await mk("Legacy Identity Scope", "BT18-900", ["BT18-910", "BT18-911", "BT18-912"]);

  const r = await readiness(db, [ok, locked]);
  assert.deepEqual(
    { ...r.get(ok)!, openCards: [] },
    {
      deckId: ok, total: 5, open: 0, draft: 1, corrected: 1, confirmed: 2, incomplete: 0, native: 0, plain: 1,
      unsupportedSkills: 0, unknownSkills: 0, confirmedSupportedSkills: 5, confirmedUnsupportedSkills: 0, confirmedUnknownSkills: 0, openCards: [],
    },
    "front and back skills reconcile by printed side/index; a draft remains practice and a truly textless card is plain even with an orphan row",
  );
  assert.equal(r.get(locked)!.open, 1, "the worst of open + confirmed rows is open");
  assert.equal(r.get(locked)!.total, 3, "leader counted");
  assert.equal(r.get(locked)!.incomplete, 1, "the leader's missing back skill is incomplete despite its confirmed front");
  assert.deepEqual(r.get(locked)!.openCards, [{ id: "BT18-904", name: "Open Card" }]);
  const lockedOpenCard = (await deckCardStates(db, locked)).find((c) => c.cardId === "BT18-904")!;
  assert.equal(lockedOpenCard.state, "open", "a current open row dominates a different missing skill on the same card");
  assert.equal(lockedOpenCard.missingSkills, 1, "the sheet still exposes the missing skill alongside the open block");
  const practiceReadiness = (await readiness(db, [practice])).get(practice)!;
  assert.equal(practiceReadiness.open, 0, "stale open rows do not keep a deck blocked after their printed line changes");
  assert.equal(practiceReadiness.incomplete, 2, "a missing back skill and a stale printed line both remain incomplete");
  assert.equal(practiceReadiness.native, 1, "a pure native keyword is not a textless card");
  assert.equal(practiceReadiness.unknownSkills, 1, "native keyword support is not silently reported as verified");
  assert.equal(practiceReadiness.confirmedSupportedSkills, 3, "supported confirmed skills remain separate from native skill support");
  assert.equal(practiceReadiness.incomplete + practiceReadiness.native, 3);
  assert.equal(practiceReadiness.total, 4);
  assert.equal((await deckCardStates(db, practice)).find((c) => c.cardId === "BT18-908")?.state, "native");
  assert.ok((await startGame(db, practice, ok, "hotseat")) > 0, "incomplete and native records remain practice, not a new hard lock");

  const defs = await defsForCards(db, ["BT18-900", "BT18-906", "BT18-907", "BT18-909"]);
  const programs = rulesFromRows(await loadRules(db, Object.keys(defs)), defs);
  assert.equal(programs["BT18-900"].complete, true, "both current leader sides have matching rule rows");
  assert.equal(programs["BT18-906#back"].complete, false, "a missing back-side program is incomplete on its own script face");
  assert.equal(programs["BT18-909"].complete, false, "a stale printed line cannot supply the current script");
  assert.ok(programs["BT18-907"].bySkill[0].unsupported.length > 0, "a confirmed row with unread text retains its unsupported state in the loaded program");
  assert.equal((await readiness(db, [])).size, 0);
  const scopeReadiness = (await readiness(db, [legacyScope])).get(legacyScope)!;
  assert.equal(scopeReadiness.confirmed, 4, "all three identity rows remain review-confirmed");
  assert.equal(scopeReadiness.confirmedSupportedSkills, 4, "the leader sides and current explicit and unqualified in-play identity rows remain supported");
  assert.equal(scopeReadiness.confirmedUnsupportedSkills, 1, "a confirmed legacy all-area row without its compiled marker is not advertised as supported");
  assert.equal(scopeReadiness.unsupportedSkills, 1);
  const scopeDefs = await defsForCards(db, ["BT18-910", "BT18-911", "BT18-912"]);
  const scopePrograms = rulesFromRows(await loadRules(db, Object.keys(scopeDefs)), scopeDefs);
  assert.ok(scopePrograms["BT18-910"].bySkill[0].unsupported.some((reason) => reason.includes("missing its source-validity marker")), "an old all-area program is blocked when loaded");
  assert.equal(scopePrograms["BT18-911"].complete, true, "a current all-area marker keeps the record executable");
  assert.equal(scopePrograms["BT18-912"].complete, true, "an unqualified in-play identity gain does not require the all-area marker");
  assert.equal((await deckCardSets(db, [ok, locked])).get(locked)!.size, 3);

  // The "See the cards" sheet (#368): one row per card and zone, the same worst state as the counts.
  const sheet = await deckCardStates(db, ok);
  const stateOf = (id: string) => sheet.find((c) => c.cardId === id)?.state;
  assert.deepEqual(
    ["BT18-900", "BT18-901", "BT18-902", "BT18-903", "BT18-905"].map(stateOf),
    ["confirmed", "confirmed", "draft", "plain", "corrected"],
    "back-side confirmed skill is included; a draft + confirmed card is a draft, textless card is plain",
  );
  assert.equal(sheet.length, 5);
  assert.equal(sheet.find((c) => c.cardId === "BT18-900")!.zone, "leader");
  assert.equal(sheet.find((c) => c.cardId === "BT18-905")!.zone, "z");
  assert.equal(sheet.find((c) => c.cardId === "BT18-901")!.quantity, 4);
  const counts = { open: 0, incomplete: 0, draft: 0, corrected: 0, confirmed: 0, native: 0, plain: 0 };
  for (const c of await deckCardStates(db, locked)) counts[c.state]++;
  const rl = r.get(locked)!;
  assert.deepEqual(counts, { open: rl.open, incomplete: rl.incomplete, draft: rl.draft, corrected: rl.corrected, confirmed: rl.confirmed, native: rl.native, plain: rl.plain }, "the sheet's states add up to the strip's counts");
  const unreadDeck = await mk("Unread Deck", "BT18-900", ["BT18-907"]);
  const unreadReadiness = await readiness(db, [unreadDeck]);
  const unread = unreadReadiness.values().next().value!;
  assert.equal(unread.confirmed, 2, "review status remains confirmed when another row has unread text");
  assert.equal(unread.confirmedSupportedSkills, 2, "the leader's two supported sides remain separately supported");
  assert.equal(unread.confirmedUnsupportedSkills, 1, "confirmed unread skill is explicitly unsupported");

  const actionPrice = [{ op: "draw", n: 1 }];
  assert.deepEqual(
    runtimeSupportOfRow({ kind: "activate:main", unread: [], ops: [], cost: { program: actionPrice }, trigger: [] } as never),
    { unsupported: [], unknown: [] },
    "a printed Activate action price is supported and must not be rejected by the Auto limitation",
  );
  assert.deepEqual(
    runtimeSupportOfRow({ kind: "auto", unread: [], ops: [], cost: { program: actionPrice }, trigger: ["played"] } as never).unsupported.length,
    1,
    "an Auto action price the flow cannot resolve is not reported supported",
  );
  assert.ok(
    runtimeSupportOfRow({ kind: "auto", unread: [], ops: [], cost: null, trigger: [] } as never).unsupported.some((reason) => reason.includes("WHEN trigger")),
    "an Auto with no readable WHEN is not reported supported",
  );
  assert.ok(
    runtimeSupportOfRow({ kind: "auto", unread: [], ops: [], cost: null, trigger: ["flippedFaceUp"] } as never).unsupported.some((reason) => reason.includes("does not emit flippedFaceUp")),
    "a readable Auto WHEN whose event is not emitted stays unsupported",
  );
  assert.ok(
    runtimeSupportOfRow({ kind: "counter:counter", unread: [], ops: [], cost: null, trigger: [] } as never).unsupported.some((reason) => reason.includes("does not open a Counter: Counter")),
    "a Counter: Counter row stays unsupported even though Counter records need no Auto WHEN trigger",
  );
  assert.deepEqual(
    runtimeSupportOfRow({ kind: "counter:play", unread: [], ops: [], cost: null, trigger: [] } as never),
    { unsupported: [], unknown: [] },
    "a Counter row with no Auto WHEN is not falsely rejected",
  );
  assert.deepEqual(
    runtimeSupportOfRow({ kind: "permanent", printed: "[Permanent] This card gains ≪Saiyan≫.", unread: [], ops: [{ op: "gains", traits: ["Saiyan"] }], cost: null, trigger: [] } as never),
    { unsupported: [], unknown: [] },
    "a Permanent identity gain implemented by the rules VM is runtime-supported",
  );
  assert.ok(
    runtimeSupportOfRow({ kind: "permanent", printed: "[Permanent] This card gains ≪Saiyan≫ in all areas.", unread: [], ops: [{ op: "modifyAttr", target: { sel: { special: "self" } }, attr: "traits", values: ["Saiyan"] }], cost: null, trigger: [] } as never).unsupported.some((reason) => reason.includes("missing its source-validity marker")),
    "a confirmed-style legacy all-area row is not reported supported when its compiled op lost the qualifier",
  );
  assert.deepEqual(
    runtimeSupportOfRow({ kind: "permanent", printed: "[Permanent] This card gains ≪Saiyan≫ in all areas.", unread: [], ops: [{ op: "modifyAttr", target: { sel: { special: "self" } }, attr: "traits", values: ["Saiyan"], allAreas: true }], cost: null, trigger: [] } as never),
    { unsupported: [], unknown: [] },
    "a current all-area identity row keeps its source-validity marker",
  );
  assert.deepEqual(
    runtimeSupportOfRow({ kind: "permanent", unread: [], ops: [{ op: "negateKeyword", keyword: "Blocker" }], cost: null, trigger: [] } as never),
    { unsupported: [], unknown: [] },
    "a Permanent keyword negation implemented by the rules VM is runtime-supported",
  );
  await db.update(schema.decks).set({ owner: "alice" }).where(eq(schema.decks.id, locked));
  assert.equal((await deckCardStates(db, locked, "bob")).length, 0, "another login's deck is hidden");
  assert.equal((await deckCardStates(db, locked, "alice")).length, 3);
  assert.equal((await deckCardStates(db, locked, undefined)).length, 3, "an SL (no scope) sees every deck");
  assert.equal((await deckCardStates(db, locked, null)).length, 0, "the no-owner scope sees only decks with no owner");
  await db.update(schema.decks).set({ owner: null }).where(eq(schema.decks.id, locked));

  // The block, on every path that starts a game.
  await assert.rejects(startGame(db, locked, ok, "hotseat"), /"Locked Deck" has 1 card with no rule yet/, "the first deck is refused, named, with its count");
  await assert.rejects(startGame(db, ok, locked, "hotseat"), /"Locked Deck" has 1 card/, "so is the second");
  assert.ok((await startGame(db, ok, ok, "hotseat")) > 0, "a deck with only drafts plays");
  await assert.rejects(openMatch(db, "alice", locked, true), /"Locked Deck" has 1 card/, "a host's locked deck is refused at the invitation");
  const matchId = await openMatch(db, "alice", ok, true);
  await assert.rejects(joinMatch(db, matchId, "bob", locked), /"Locked Deck" has 1 card/, "a joiner's locked deck is refused at join");
  const [m] = await db.select().from(schema.arenaMatches).where(eq(schema.arenaMatches.id, matchId));
  assert.equal(m.status, "open", "a refused join puts the match back");

  // Drafting the open rule lifts the block.
  await db.update(schema.cardRules).set({ status: "draft" }).where(eq(schema.cardRules.cardId, "BT18-904"));
  assert.equal((await readiness(db, [locked])).get(locked)!.open, 0);
  assert.ok((await startGame(db, locked, ok, "hotseat")) > 0, "drafted, the deck plays again");

  await db.delete(schema.arenaGames);
  await db.delete(schema.arenaMatches);
  await db.delete(schema.decks).where(eq(schema.decks.id, ok));
  await db.delete(schema.decks).where(eq(schema.decks.id, locked));
  await db.delete(schema.decks).where(eq(schema.decks.id, practice));
  await db.delete(schema.decks).where(eq(schema.decks.id, unreadDeck));
  await db.delete(schema.decks).where(eq(schema.decks.id, legacyScope));
}
