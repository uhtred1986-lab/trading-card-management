/**
 * Lane G of docs/pokemon/plan.md: her Pokémon decks. No network, no model call, no database beyond PGlite.
 *
 * Covers: the pasted deck-list parser (English and German sections, counts, set code and number, odd lines
 * reported, the energy symbols), the resolver (exact by name and number, the set-code tie-break, a guess
 * said out loud, a name only, a line nothing matches), the collapse of many format issues into one line,
 * the size text, the missing-copies computation, the data effect of "wish all missing" (the deck owner's
 * wishes, idempotent, one card), the German sentence of the one refusal (`buildConflicts` through
 * `builtRefusal`), the pasted-list import into a deck that carries its owner, and the deck list.
 *
 * The cards are recorded TCGdex responses (scripts/verify/fixtures/pokemon); the source is a stub.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { AccessDenied, type Viewer } from "../../src/lib/auth/index.ts";
import { getDeck } from "../../src/lib/decks/queries.ts";
import { PokemonInputError, assertPokemonDeck } from "../../src/lib/pokemon/collection.ts";
import { legality, type LegalityCard } from "../../src/lib/decks/legality.ts";
import { buildConflicts } from "../../src/lib/decks/reservations.ts";
import { builtRefusal, deckProgress, missingCopies, summariseIssues, wishesToAdd } from "../../src/lib/pokemon/deck-logic.ts";
import { createPokemonDeck, importPokemonDeckList, pokemonDeckList, wishMissing, wishedCopies, type DeckListSource } from "../../src/lib/pokemon/deck-data.ts";
import { nameVariants, parseDeckListPokemon, resolveDeckList, spellOutEnergy, type DeckListSearch } from "../../src/lib/pokemon/decklist.ts";
import { foldName } from "../../src/lib/pokemon/names.ts";
import { ensurePokemonCard } from "../../src/lib/pokemon/store.ts";
import { parseSearchQuery, recordFromTcgdex, type PokemonCardRecord, type TcgdexCard } from "../../src/lib/pokemon/tcgdex.ts";
import type { PokemonHit } from "../../src/lib/pokemon/types.ts";

const { cards, decks, deckCards, ownedCards, wantList, cardPrints } = schema;

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIX = path.resolve("scripts/verify/fixtures/pokemon");
const raw = (id: string, lang: "de" | "en") => JSON.parse(fs.readFileSync(path.join(FIX, `card-${id}.${lang}.json`), "utf8")) as TcgdexCard;
const record = (id: string): PokemonCardRecord => recordFromTcgdex(raw(id, "de"), raw(id, "en"));

const CHARMANDER = "sv03.5-004";
const CHARIZARD = "sv03.5-006";
const FIRE = "sve-002";
const ULTRA = "sv01-196";
const CATCHER = "sv05-157";
const ALL = [CHARMANDER, CHARIZARD, FIRE, ULTRA, CATCHER];

// ── 1. The parser ────────────────────────────────────────────────────────────

{
  const p = parseDeckListPokemon(`Pokémon: 7
4 Charizard ex OBF 125
3 Charmander MEW 4
Trainer: 4
4x Ultra Ball SVI 196/198
Energy: 12
12 Basic {R} Energy SVE 2

Total Cards: 60`);
  assert.deepEqual(p.declared, { POKEMON: 7, TRAINER: 4, ENERGY: 12 });
  assert.equal(p.declaredTotal, 60);
  assert.deepEqual(p.unreadable, []);
  assert.deepEqual(
    p.lines.map((l) => [l.count, l.name, l.setCode, l.number, l.section]),
    [
      [4, "Charizard ex", "OBF", 125, "POKEMON"],
      [3, "Charmander", "MEW", 4, "POKEMON"],
      [4, "Ultra Ball", "SVI", 196, "TRAINER"],
      [12, "Basic Fire Energy", "SVE", 2, "ENERGY"],
    ],
  );
  assert.equal(p.total, 23);
  assert.deepEqual(p.lines[3].raw, "12 Basic {R} Energy SVE 2", "the line is kept as pasted");
}
{
  // German section names, parentheses, a count with "x", a name only.
  const p = parseDeckListPokemon("Pokémon (13)\n4 Glurak-ex OBF 125\n2 x Glumanda\nTrainer: 4\n4 Superball SVI 196\nEnergie: 2\n2 Feuer-Energie SVE 2\nKarten gesamt: 8\n");
  assert.deepEqual(p.declared, { POKEMON: 13, TRAINER: 4, ENERGY: 2 });
  assert.equal(p.declaredTotal, 8);
  assert.deepEqual(
    p.lines.map((l) => [l.count, l.name, l.setCode, l.number, l.section]),
    [
      [4, "Glurak-ex", "OBF", 125, "POKEMON"],
      [2, "Glumanda", null, null, "POKEMON"],
      [4, "Superball", "SVI", 196, "TRAINER"],
      [2, "Feuer-Energie", "SVE", 2, "ENERGY"],
    ],
  );
  assert.deepEqual(parseDeckListPokemon("Energien: 3\n3 Feuer-Energie").lines[0].section, "ENERGY");
  assert.deepEqual(parseDeckListPokemon("## Trainer\n2 Boss's Orders PAL 172").lines[0].section, "TRAINER");
}
{
  // Odd lines are reported, never dropped; comments and blank lines are not odd.
  const p = parseDeckListPokemon("// my deck\n\nPokémon: 2\nthis is not a card\n0 Pikachu SVI 1\n1 Pikachu VMAX 20\n2 Professor's Research\n1 Pikachu PR-SV 56\nPikachu VMAX 20\n4 Boss's Orders PAL 172/193");
  assert.deepEqual(p.unreadable.map((u) => [u.at, u.raw]), [[4, "this is not a card"], [5, "0 Pikachu SVI 1"], [9, "Pikachu VMAX 20"]]);
  assert.deepEqual(
    p.lines.map((l) => [l.count, l.name, l.setCode, l.number]),
    [
      [1, "Pikachu VMAX", null, 20],
      [2, "Professor's Research", null, null],
      [1, "Pikachu", "PR-SV", 56],
      [4, "Boss's Orders", "PAL", 172],
    ],
    "a rule-box suffix is not a set code",
  );
  assert.deepEqual(parseDeckListPokemon("").lines, []);
  assert.deepEqual(parseDeckListPokemon("﻿4 Charmander MEW 4").lines.map((l) => l.name), ["Charmander"], "a byte-order mark is ignored");
  assert.equal(spellOutEnergy("Basic {R} Energy"), "Basic Fire Energy");
  assert.equal(spellOutEnergy("Basic {G} Energy"), "Basic Grass Energy");
  assert.deepEqual(nameVariants("Charizard ex"), ["Charizard ex", "Charizard-ex", "Charizard"]);
  assert.deepEqual(nameVariants("Basic Fire Energy"), ["Basic Fire Energy", "Fire Energy"]);
}

// ── 2. The resolver, against a stub of the card source ───────────────────────

const hitOf = (id: string): PokemonHit => record(id).hit;
const charizardPaf: PokemonHit = { ...hitOf(CHARIZARD), id: "PKM-sv04.5-006", tcgdexId: "sv04.5-006", setName: "Paldeas Schicksale" };
const HITS: PokemonHit[] = [hitOf(CHARMANDER), hitOf(CHARIZARD), charizardPaf, hitOf(FIRE), hitOf(ULTRA), hitOf(CATCHER)];
/** Set codes the stub's "set id for code" knows (TCGdex answers `sets?abbreviation.official=`). */
const SET_CODES: Record<string, string> = { MEW: "sv03.5", PAF: "sv04.5", SVE: "sve", SVI: "sv01", TEF: "sv05" };
const setIdForCode = async (code: string) => SET_CODES[code] ?? null;

/** Stand-in for `searchPokemon`: names contain-match in both languages, the number is exact, `setId` limits it to one set. */
function stubSearch(): { search: DeckListSearch; asked: string[] } {
  const asked: string[] = [];
  const search: DeckListSearch = async ({ q, category, setId }) => {
    asked.push(`${q}@${setId ?? "*"}`);
    const parsed = parseSearchQuery(q);
    return HITS.filter((h) => {
      if (category && h.category && h.category !== category) return false;
      if (setId && !h.tcgdexId.startsWith(`${setId}-`)) return false;
      if (parsed.number !== null && Number(h.localId) !== parsed.number) return false;
      if (!parsed.name) return true;
      return [h.name, h.altName ?? ""].some((n) => foldName(n).includes(foldName(parsed.name)));
    });
  };
  return { search, asked };
}

{
  const text = [
    "Pokémon: 8",
    "4 Charizard ex MEW 6", // two prints have that name and number: the set code decides
    "2 Charizard ex PAF 6", // the same, the other print
    "1 Charizard ex ZZZ 6", // two prints and a code nobody knows: a guess, said out loud
    "3 Charmander", // a name only
    "2 Mewtwo ex XXX 99", // nothing matches
    "Trainer: 4",
    "4 Ultra Ball SVI 196",
    "Energy: 12",
    "12 Basic {R} Energy SVE 2",
    "garbage line",
  ].join("\n");
  const stub = stubSearch();
  const r = await resolveDeckList(parseDeckListPokemon(text), stub.search, setIdForCode);
  const byId = Object.fromEntries(r.cards.map((c) => [c.tcgdexId, c.count]));
  assert.deepEqual(byId, { [CHARIZARD]: 5, "sv04.5-006": 2, [CHARMANDER]: 3, [ULTRA]: 4, [FIRE]: 12 }, "the guessed line took the first print, which is the same card as line 1");
  assert.deepEqual(r.cards.map((c) => c.at), [[2, 4], [3], [5], [8], [10]], "lines per card");
  assert.deepEqual(r.unresolved.map((u) => [u.at, u.reason]), [[6, "notFound"], [11, "unreadable"]]);
  assert.deepEqual(r.guessed.map((g) => g.at), [4], "only the line the set code could not settle is a guess");
  assert.match(r.guessed[0].took, /Glurak-ex|Charizard/);
  assert.ok(stub.asked.includes("6@sv03.5") && stub.asked.includes("6@sv04.5"), "a set code asks that set for the number");
  assert.equal(stub.asked.filter((q) => q.endsWith("@sv01")).length, 1, "one search in the set for the Ultra Ball line");
  assert.ok(!stub.asked.includes("Ultra Ball 196@*"), "...and when the set settles it the name search is not needed");
}
{
  // The same list without a way to turn set codes into sets: it still resolves by name and number; the tie is a guess.
  const stub = stubSearch();
  const r = await resolveDeckList(parseDeckListPokemon("2 Charizard ex PAF 6\n4 Ultra Ball SVI 196"), stub.search);
  assert.deepEqual(r.cards.map((c) => [c.tcgdexId, c.count]), [[CHARIZARD, 2], [ULTRA, 4]]);
  assert.deepEqual(r.guessed.map((g) => g.at), [1]);
  assert.deepEqual(r.unresolved, []);
}
{
  // A set lookup that fails is no worse than no lookup; a set whose number holds another card falls back to the name, said as a guess.
  const r = await resolveDeckList(parseDeckListPokemon("3 Charmander MEW 6\n1 Ultra Ball SVI 196"), stubSearch().search, async () => {
    throw new Error("set lookup failed");
  });
  assert.deepEqual(r.cards.map((c) => [c.tcgdexId, c.count]), [[CHARMANDER, 3], [ULTRA, 1]]);
  assert.deepEqual(r.guessed.map((g) => g.at), [1], "number 6 holds no Charmander: the name alone settled it");
  const withSets = await resolveDeckList(parseDeckListPokemon("3 Charmander MEW 6"), stubSearch().search, setIdForCode);
  assert.deepEqual(withSets.cards.map((c) => c.tcgdexId), [CHARMANDER]);
  assert.deepEqual(withSets.guessed.map((g) => g.at), [1]);
}
{
  // A source that cannot be reached is an error for the caller, not forty "not found" lines.
  await assert.rejects(resolveDeckList(parseDeckListPokemon("4 Charmander MEW 4"), async () => { throw new Error("TCGdex is not reachable"); }), /not reachable/);
}

// ── 3. Size, issues ──────────────────────────────────────────────────────────

assert.deepEqual([deckProgress(47).text, deckProgress(47).pct, deckProgress(47).state], ["Noch 13 Karten bis 60", 78, "short"]);
assert.deepEqual([deckProgress(59).text, deckProgress(0).text], ["Noch 1 Karte bis 60", "Noch 60 Karten bis 60"]);
assert.deepEqual([deckProgress(60).text, deckProgress(60).state, deckProgress(60).pct], ["Genau 60 Karten", "exact", 100]);
assert.deepEqual([deckProgress(63).text, deckProgress(61).text, deckProgress(63).state], ["3 Karten zu viel", "1 Karte zu viel", "over"]);

/** A deck row for the real checker. */
const row = (n: number, quantity: number, over: Partial<LegalityCard> & { standard?: boolean } = {}): LegalityCard => ({
  cardId: `PKM-t-${n}`,
  zone: "main",
  quantity,
  name: over.name ?? `Karte ${n}`,
  cardType: over.cardType ?? "POKEMON",
  colors: [],
  limitedTo: null,
  isBanned: false,
  game: "pokemon",
  details: { names: { en: over.name ?? `Karte ${n}` }, stage: n === 1 ? "Basic" : "Stage1", basicEnergy: false, onePerDeck: null, legal: { standard: over.standard ?? true, expanded: true } },
  ...over,
});

{
  // Eleven cards that rotated out of Standard: one line, the rows carry the flags.
  const rows = [row(1, 2), ...Array.from({ length: 10 }, (_, i) => row(i + 2, 2, { standard: false })), row(20, 2, { standard: false })];
  const l = legality(rows, "pokemon", "standard");
  assert.equal(l.issues.filter((i) => /nicht mehr erlaubt/.test(i.message)).length, 11, "the checker says it once per card");
  const s = summariseIssues(l.issues);
  assert.deepEqual(s.lines.map((x) => x.text), ["11 Karten sind im Standard-Format nicht mehr erlaubt (unten markiert)"], "size line left to the bar, format lines collapsed");
  assert.equal(s.more, 0);
  assert.equal(Object.values(l.flags).filter((f) => /Standard-Format nicht mehr erlaubt/.test(f.label)).length, 11, "and each of the 11 rows is flagged");
  // Expanded names the format it is in.
  const e = legality([row(1, 2, { standard: true }), row(2, 2, { details: { names: { en: "x" }, stage: "Basic", basicEnergy: false, onePerDeck: null, legal: { standard: false, expanded: false } } }), row(3, 2, { details: { names: { en: "y" }, stage: "Basic", basicEnergy: false, onePerDeck: null, legal: { standard: false, expanded: false } } })], "pokemon", "expanded");
  assert.deepEqual(summariseIssues(e.issues).lines[0].text, "2 Karten sind im Erweitert-Format nicht mehr erlaubt (unten markiert)");
}
{
  // One card keeps its own sentence; the unknown-legality line only counts.
  const one = legality([row(1, 4), row(2, 4, { standard: false, name: "Glutexo" })], "pokemon", "standard");
  assert.ok(summariseIssues(one.issues).lines.some((x) => x.text === "Glutexo ist im Standard-Format nicht mehr erlaubt"));
  const noData = legality([row(1, 2, { details: { names: { en: "a" }, stage: "Basic", basicEnergy: false } }), row(2, 2, { details: { names: { en: "b" }, stage: "Basic", basicEnergy: false } })], "pokemon", "standard");
  const u = summariseIssues(noData.issues).lines.find((x) => x.severity === "warning");
  assert.equal(u?.text, "Für 2 Karten ist die Legalität im Standard-Format unbekannt (unten markiert)");
}
{
  // At most four, the worst first, then "und n weitere" counted.
  const synthetic = [
    { severity: "warning" as const, message: "Eine Warnung" },
    { severity: "incomplete" as const, message: "Du brauchst mindestens ein Basis-Pokémon" },
    { severity: "illegal" as const, message: "Höchstens 4 Karten mit dem Namen A (du hast 5)", cardId: "a" },
    { severity: "illegal" as const, message: "Höchstens 4 Karten mit dem Namen B (du hast 5)", cardId: "b" },
    { severity: "illegal" as const, message: "Höchstens 1 ACE-SPEC-Karte pro Deck (du hast 2)", cardId: "c" },
    { severity: "illegal" as const, message: "Höchstens 1 Strahlendes Pokémon pro Deck (du hast 2)", cardId: "d" },
    { severity: "incomplete" as const, message: "Noch 13 Karten bis 60" },
  ];
  const s = summariseIssues(synthetic);
  assert.equal(s.lines.length, 4);
  assert.deepEqual(s.lines.map((x) => x.severity), ["illegal", "illegal", "illegal", "illegal"]);
  assert.equal(s.more, 2, "the basic-Pokémon line and the warning are the rest; the size line never counts");
  assert.equal(summariseIssues(synthetic, 6).more, 0);
  assert.deepEqual(summariseIssues([]), { lines: [], more: 0 });
  assert.deepEqual(summariseIssues([{ severity: "illegal", message: "3 Karten zu viel (höchstens 60)" }]), { lines: [], more: 0 });
}

// ── 4. Missing copies, as a pure function ────────────────────────────────────

{
  const m = missingCopies([
    { cardId: "a", quantity: 4, owned: 1 },
    { cardId: "b", quantity: 3, owned: 3 },
    { cardId: "c", quantity: 2, owned: 5 },
    { cardId: "d", quantity: 1, owned: 0 },
    { cardId: "a", quantity: 1, owned: 1 }, // the same card on a second row counts once, together
  ]);
  assert.deepEqual(m.lines.map((l) => [l.cardId, l.needed, l.owned, l.missing]), [["a", 5, 1, 4], ["d", 1, 0, 1]]);
  assert.equal(m.total, 5);
  assert.deepEqual(wishesToAdd(m.lines, { a: 1 }), [{ cardId: "a", add: 3 }, { cardId: "d", add: 1 }], "a wish that covers part of it grows to cover all, never shrinks");
  assert.deepEqual(wishesToAdd(m.lines, { a: 4, d: 7 }), []);
}

// ── 5. PGlite: the data effects ──────────────────────────────────────────────

const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
for (const file of fs.readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join("drizzle", file), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}
const mia: Viewer = { kind: "player", via: "code", playerId: 1, deviceId: 1, name: "Mia", login: "mia", owner: "Mia", homeGame: "pokemon" };
const papa: Viewer = { kind: "sl", via: "google", email: "papa@example.com", login: null, owner: "Papa" };

for (const id of ALL) await ensurePokemonCard(db, id, { record: record(id), set: null, expire: false });
const cid = (tcgdex: string) => `PKM-${tcgdex}`;
const nameOf = async (id: string) => (await db.select({ name: cards.name }).from(cards).where(eq(cards.id, id)))[0].name;
async function giveLots(owner: string | null, tcgdex: string, n: number) {
  const [print] = await db.select({ id: cardPrints.id }).from(cardPrints).where(eq(cardPrints.cardId, cid(tcgdex))).orderBy(cardPrints.id).limit(1);
  await db.insert(ownedCards).values(Array.from({ length: n }, () => ({ printId: print.id, cardId: cid(tcgdex), owner, condition: "NM", finish: "normal", language: "DE" })));
}
const printsOf = await db.select({ id: cardPrints.id, cardId: cardPrints.cardId }).from(cardPrints);
assert.ok(printsOf.some((p) => p.id === "PKM-sv03.5-004"), "fixture prints exist");

// createPokemonDeck stamps the owner and falls back to Standard.
const made = await createPokemonDeck(db, mia, { name: "  Feuerdrachen  ", format: "expanded" });
const [deckRow] = await db.select().from(decks).where(eq(decks.id, made.id));
assert.deepEqual([deckRow.name, deckRow.game, deckRow.format, deckRow.owner, deckRow.isBuilt], ["Feuerdrachen", "pokemon", "expanded", "Mia", false]);
const bad = await createPokemonDeck(db, papa, { name: "", format: "wild" });
const [badRow] = await db.select().from(decks).where(eq(decks.id, bad.id));
assert.deepEqual([badRow.name, badRow.format, badRow.owner], ["Neues Deck", "standard", "Papa"], "empty name and an unknown format fall back; an SL's deck carries the SL's owner");

// The deck: 4 Charmander (she has 1), 2 Charizard (has 2), 1 Prime Catcher (has none), 8 Fire Energy (has 3).
async function put(deckId: number, tcgdex: string, quantity: number) {
  await db.insert(deckCards).values({ deckId, cardId: cid(tcgdex), zone: "main", quantity });
}
await put(made.id, CHARMANDER, 4);
await put(made.id, CHARIZARD, 2);
await put(made.id, CATCHER, 1);
await put(made.id, FIRE, 8);
await giveLots("Mia", CHARMANDER, 1);
await giveLots("Mia", CHARIZARD, 2);
await giveLots("Mia", FIRE, 3);
await giveLots("Lena", CATCHER, 5); // someone else's copies are not hers
await giveLots("Lena", CHARMANDER, 4);

{
  // Wish all missing: Charmander 3, Prime Catcher 1, Fire Energy 5, for the deck's owner.
  const r = await wishMissing(db, made.id);
  assert.deepEqual(r, { missing: 9, added: 9, cards: 3 });
  const w = await db.select().from(wantList);
  assert.deepEqual(
    w.map((x) => [x.cardId, x.quantity, x.owner, x.deckId]).sort(),
    [[cid(CATCHER), 1, "Mia", made.id], [cid(CHARMANDER), 3, "Mia", made.id], [cid(FIRE), 5, "Mia", made.id]].sort(),
    "wishes belong to the deck's owner, never to whoever pressed the button",
  );
  // A second tap adds nothing.
  assert.deepEqual(await wishMissing(db, made.id), { missing: 9, added: 0, cards: 0 });
  assert.equal((await db.select().from(wantList)).length, 3);
  // She finds one Charmander: the wish for it stays, nothing shrinks; one card at a time works.
  await giveLots("Mia", CHARMANDER, 1);
  assert.deepEqual(await wishMissing(db, made.id, cid(CHARMANDER)), { missing: 2, added: 0, cards: 0 });
  // Raise the deck: only the difference is wished.
  await db.update(deckCards).set({ quantity: 6 }).where(eq(deckCards.cardId, cid(CHARMANDER)));
  assert.deepEqual(await wishMissing(db, made.id, cid(CHARMANDER)), { missing: 4, added: 1, cards: 1 }, "the wish grows from 3 to 4");
  assert.deepEqual(await wishedCopies(db, "Mia", [cid(CHARMANDER), cid(ULTRA)]), { [cid(CHARMANDER)]: 4 });
  // An SL's own wishes are untouched; a deck with nothing missing wishes for nothing.
  await put(bad.id, CHARIZARD, 1);
  await giveLots("Papa", CHARIZARD, 1);
  assert.deepEqual(await wishMissing(db, bad.id), { missing: 0, added: 0, cards: 0 });
  assert.deepEqual(await wishMissing(db, 99999), { missing: 0, added: 0, cards: 0 }, "no such deck");
  await db.delete(wantList);
}

{
  // The one refusal: a deck that would need more copies than she owns cannot be built, and the sentence names them.
  const conflicts = await buildConflicts(db, made.id);
  assert.deepEqual(
    conflicts.map((c) => [c.cardId, c.short]).sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    [[cid(CATCHER), 1], [cid(CHARMANDER), 4], [cid(FIRE), 5]].sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
    "needs minus her own copies; Lena's copies do not count",
  );
  const names = Object.fromEntries(conflicts.map((c) => [c.cardId, c.name]));
  const sentence = builtRefusal(conflicts);
  assert.ok(sentence.startsWith("Das Deck kann noch nicht als gebaut gelten. Dir fehlen: "));
  assert.ok(sentence.endsWith("."));
  for (const c of conflicts) assert.ok(sentence.includes(`${c.short} × ${c.name}`), `names ${c.name} with how many are short`);
  assert.ok(!sentence.includes("anderen gebauten Deck"), "nothing is reserved elsewhere yet");
  assert.equal(names[cid(CHARMANDER)], await nameOf(cid(CHARMANDER)));

  // Another built deck of hers holds her Charmander: the sentence says that too.
  const other = await createPokemonDeck(db, mia, { name: "Anderes" });
  await put(other.id, CHARMANDER, 1);
  await db.update(decks).set({ isBuilt: true }).where(eq(decks.id, other.id));
  const again = await buildConflicts(db, made.id);
  assert.ok(again.some((c) => c.cardId === cid(CHARMANDER) && c.reservedElsewhere === 1 && c.short === 5));
  assert.match(builtRefusal(again), /Manche Karten stecken schon in einem anderen gebauten Deck\.$/);
  // A long list is cut after five cards.
  const many = Array.from({ length: 7 }, (_, i) => ({ name: `K${i}`, short: 1, reservedElsewhere: 0 }));
  assert.equal(builtRefusal(many), "Das Deck kann noch nicht als gebaut gelten. Dir fehlen: 1 × K0, 1 × K1, 1 × K2, 1 × K3, 1 × K4 und 2 weitere Karten.");
  assert.equal(builtRefusal([]), "", "nothing short: nothing to refuse");

  // With the copies in hand it can be built; unmarking is the plain update and is never refused.
  await giveLots("Mia", CHARMANDER, 6);
  await giveLots("Mia", CATCHER, 1);
  await giveLots("Mia", FIRE, 5);
  assert.deepEqual(await buildConflicts(db, made.id), []);
  await db.delete(decks).where(eq(decks.id, other.id));
}

{
  // The deck list: cover = the most played Pokémon, status from the checker, built first.
  await db.update(decks).set({ isBuilt: true }).where(eq(decks.id, made.id));
  const mine = await pokemonDeckList(db, "Mia");
  assert.deepEqual(mine.map((d) => d.id), [made.id], "a player sees her own decks only");
  assert.deepEqual([mine[0].count, mine[0].format, mine[0].isBuilt, mine[0].status], [17, "expanded", true, "illegal"]);
  assert.equal(mine[0].cover?.image, "https://assets.tcgdex.net/de/sv/sv03.5/004/low.webp", "the most played Pokémon: 4 Charmander");
  const all = await pokemonDeckList(db, undefined);
  assert.deepEqual(all.map((d) => [d.id, d.owner]), [[made.id, "Mia"], [bad.id, "Papa"]], "an SL sees every deck, built first");
  assert.equal((await pokemonDeckList(db, "Nobody")).length, 0);
}

{
  // A deck that is not hers answers not found (the page) and is refused (the Server Functions' check).
  const lena: Viewer = { kind: "player", via: "code", playerId: 2, deviceId: 2, name: "Lena", login: "lena", owner: "Lena", homeGame: "pokemon" };
  assert.equal(await getDeck(db, made.id, "Lena"), null, "another player's deck: not found");
  assert.equal((await getDeck(db, made.id, "Mia"))?.cards.length, 4);
  assert.equal((await getDeck(db, made.id, undefined))?.id, made.id, "an SL sees it");
  await assert.rejects(assertPokemonDeck(db, lena, made.id), AccessDenied);
  await assertPokemonDeck(db, papa, made.id);
  await assertPokemonDeck(db, mia, made.id);
  const [dbsDeck] = await db.insert(decks).values({ name: "Dragon Ball", game: "dbs", owner: "Mia" }).returning({ id: decks.id });
  await assert.rejects(assertPokemonDeck(db, mia, dbsDeck.id), PokemonInputError, "a Dragon Ball deck is not a Pokémon deck");
  await db.delete(decks).where(eq(decks.id, dbsDeck.id));
}

// ── 6. Pasting a deck list ───────────────────────────────────────────────────

{
  const stub = stubSearch();
  const loads: string[] = [];
  const source: DeckListSource = {
    search: stub.search,
    setIdForCode,
    load: async (id) => {
      loads.push(id);
      return { record: record(id), set: null };
    },
  };
  const text = "Pokémon: 7\n4 Charizard ex MEW 6\n3 Charmander MEW 4\nTrainer: 4\n4 Ultra Ball SVI 196\nEnergy: 8\n8 Basic {R} Energy SVE 2\n2 Mewtwo ex XXX 99\nnonsense";
  const before = (await db.select().from(decks)).length;
  const r = await importPokemonDeckList(db, mia, { text, name: "Eingefügt", format: "expanded" }, source);
  assert.ok(r.deckId);
  assert.deepEqual([r.added, r.asked], [19, 21], "19 copies found of the 21 the text asked for (the 2 Mewtwo are not found)");
  assert.deepEqual(r.resolution.unresolved.map((u) => [u.raw, u.reason]), [["2 Mewtwo ex XXX 99", "notFound"], ["nonsense", "unreadable"]], "lines that could not be resolved are listed, not dropped");
  assert.deepEqual(r.resolution.guessed, []);
  assert.deepEqual(new Set(loads), new Set([CHARIZARD, CHARMANDER, ULTRA, FIRE]), "each found card is read once");
  assert.equal((await db.select().from(decks)).length, before + 1);
  const [d] = await db.select().from(decks).where(eq(decks.id, r.deckId!));
  assert.deepEqual([d.name, d.game, d.format, d.owner], ["Eingefügt", "pokemon", "expanded", "Mia"], "the new deck carries her owner");
  const lines = await db.select().from(deckCards).where(eq(deckCards.deckId, r.deckId!));
  assert.deepEqual(lines.map((l) => [l.cardId, l.zone, l.quantity]).sort(), [[cid(CHARIZARD), "main", 4], [cid(CHARMANDER), "main", 3], [cid(FIRE), "main", 8], [cid(ULTRA), "main", 4]].sort());

  // Nothing found: no deck is made.
  const none = await importPokemonDeckList(db, mia, { text: "2 Mewtwo ex XXX 99\nnonsense", name: "Leer" }, source);
  assert.deepEqual([none.deckId, none.added, none.resolution.unresolved.length], [null, 0, 2]);
  assert.equal((await db.select().from(decks)).length, before + 1, "no empty deck from a list nobody could read");
}

console.log("pokemon-decks: ok");
