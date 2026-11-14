/**
 * Lane A of docs/pokemon/plan.md: the live Pokémon catalog. No network (TCGdex answers come from
 * real responses recorded under scripts/verify/fixtures/pokemon/, served through a stubbed
 * `fetch`) and no database beyond PGlite.
 *
 * Covers the id helpers, the pure mappers, the German + English search merge ("Glurak" and
 * "Charizard" find the same cards), the collector-number query, the typed source errors,
 * `ensurePokemonCard` and the data effects of the four Server Functions (lib/pokemon/collection.ts),
 * the nightly refresh, and the cache wiring.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import type { Viewer } from "../../src/lib/auth/index.ts";
import { AccessDenied } from "../../src/lib/auth/index.ts";
import { isPokemonCardId, pokemonCardId, pokemonDetails, pokemonImage, pokemonPrintId, tcgdexIdOf } from "../../src/lib/pokemon/types.ts";
import {
  PokemonSourceError,
  detailsFromTcgdex,
  getPokemonCard,
  hitFromTcgdex,
  listPokemonSets,
  mergeSearchHits,
  parseSearchQuery,
  pokemonCategoryOf,
  pokemonTypeOf,
  recordFromTcgdex,
  searchPokemon,
  setIdOf,
  variantsFromTcgdex,
  type TcgdexBrief,
  type TcgdexCard,
} from "../../src/lib/pokemon/tcgdex.ts";
import { ensurePokemonCard, refreshPokemonCards, sortKeyOf } from "../../src/lib/pokemon/store.ts";
import { PokemonInputError, addPokemonLots, addPokemonToDeck, ownedCountsFor, ownedLinesFor, setPokemonOwned, togglePokemonWish, wishedAmong } from "../../src/lib/pokemon/collection.ts";

// ── Fixtures and the stubbed source ──────────────────────────────────────────

const FIX = path.resolve("scripts/verify/fixtures/pokemon");
const fixture = <T,>(name: string): T => JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8")) as T;
const card = (id: string, lang: "de" | "en") => fixture<TcgdexCard>(`card-${id}.${lang}.json`);

interface Call {
  url: URL;
  lang: string;
  init: RequestInit | undefined;
}
const calls: Call[] = [];
/** Per test: make the source fail. */
let outage: null | "503" | "network" | "timeout" | "de-503" = null;
const realFetch = globalThis.fetch;

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.origin, "https://api.tcgdex.net", "only TCGdex is ever called");
  const [, v2, lang, kind, rest] = url.pathname.split("/");
  assert.equal(v2, "v2");
  calls.push({ url, lang, init });
  if (outage === "503") return respond({ error: "down" }, 503);
  if (outage === "de-503" && lang === "de") return respond({ error: "down" }, 503);
  if (outage === "network") throw new TypeError("fetch failed");
  if (outage === "timeout") throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
  const p = url.searchParams;
  const exists = (f: string) => fs.existsSync(path.join(FIX, f));
  if (kind === "cards" && rest) {
    const id = decodeURIComponent(rest);
    return exists(`card-${id}.${lang}.json`) ? respond(card(id, lang as "de" | "en")) : respond({ error: "not found" }, 404);
  }
  if (kind === "cards") {
    const name = p.get("name")?.toLowerCase();
    const set = p.get("set.id")?.replace("eq:", "");
    const file = p.get("localId") ? `list-${lang}-number-6-165.json` : name ? `list-${lang}-${name}${set ? `-${set}` : ""}.json` : null;
    return respond(file && exists(file) ? fixture(file) : []);
  }
  if (kind === "sets" && rest) return exists(`set-${decodeURIComponent(rest)}.${lang}.json`) ? respond(fixture(`set-${decodeURIComponent(rest)}.${lang}.json`)) : respond({ error: "not found" }, 404);
  if (kind === "sets") return respond(fixture(`sets-${lang}.json`));
  if (kind === "series" && !rest) return respond(fixture("series-de.json"));
  if (kind === "series") return exists(`series-${rest}.de.json`) ? respond(fixture(`series-${rest}.de.json`)) : respond({ id: rest, sets: [] });
  return respond({ error: "unexpected" }, 500);
}) as typeof fetch;

const mainCalls = () => calls.splice(0, calls.length);

// ── The id helpers (types.ts) ────────────────────────────────────────────────

assert.equal(pokemonCardId("sv03.5-006"), "PKM-sv03.5-006");
assert.equal(pokemonPrintId("sv03.5-006", "normal"), "PKM-sv03.5-006");
assert.equal(pokemonPrintId("sv03.5-006", "holo"), "PKM-sv03.5-006_holo");
assert.equal(tcgdexIdOf("PKM-sv03.5-006_holo"), "sv03.5-006");
assert.equal(tcgdexIdOf("PKM-sv03.5-006"), "sv03.5-006");
assert.equal(tcgdexIdOf("PKM-tk-hs-r-2"), "tk-hs-r-2", "a dash in the set id is not a variant");
assert.equal(tcgdexIdOf("BT18-020"), null);
assert.ok(isPokemonCardId("PKM-sv01-001") && !isPokemonCardId("BT18-020"));
assert.equal(pokemonImage("https://assets.tcgdex.net/de/sv/sv03.5/006", "high"), "https://assets.tcgdex.net/de/sv/sv03.5/006/high.webp");
assert.equal(setIdOf("sv03.5-006", "006"), "sv03.5");
assert.equal(setIdOf("tk-hs-r-2", "2"), "tk-hs-r");
assert.equal(setIdOf("P-A-001", "001"), "P-A");
assert.equal(sortKeyOf("2023-09-22"), 20230922);
assert.equal(sortKeyOf(null), 0);

// ── Query and vocabulary ─────────────────────────────────────────────────────

assert.deepEqual(parseSearchQuery("Glurak"), { name: "Glurak", number: null, size: null });
assert.deepEqual(parseSearchQuery("6"), { name: "", number: 6, size: null });
assert.deepEqual(parseSearchQuery("006"), { name: "", number: 6, size: null });
assert.deepEqual(parseSearchQuery("6/165"), { name: "", number: 6, size: 165 });
assert.deepEqual(parseSearchQuery(" #006 / 165 "), { name: "", number: 6, size: 165 });
assert.deepEqual(parseSearchQuery("Glurak 6/165"), { name: "Glurak", number: 6, size: 165 });
assert.deepEqual(parseSearchQuery("Porygon2"), { name: "Porygon2", number: null, size: null }, "digits inside a word stay in the name");
assert.deepEqual(parseSearchQuery(""), { name: "", number: null, size: null });
assert.equal(pokemonCategoryOf("Pokémon"), "POKEMON");
assert.equal(pokemonCategoryOf("energie"), "ENERGY");
assert.equal(pokemonCategoryOf("TRAINER"), "TRAINER");
assert.equal(pokemonCategoryOf("Deck"), null);
assert.deepEqual(pokemonTypeOf("feuer"), { en: "Fire", de: "Feuer" });
assert.deepEqual(pokemonTypeOf("Lightning"), { en: "Lightning", de: "Elektro" });
assert.equal(pokemonTypeOf("Sonne"), null);

// ── Mappers on recorded responses ────────────────────────────────────────────

const glurakDe = card("sv03.5-006", "de");
const glurakEn = card("sv03.5-006", "en");
const glurak = recordFromTcgdex(glurakDe, glurakEn);
assert.equal(glurak.tcgdexId, "sv03.5-006");
assert.equal(glurak.category, "POKEMON");
assert.equal(glurak.setId, "sv03.5");
assert.equal(glurak.rarity, "Doppelselten");
assert.equal(glurak.rarityEn, "Double rare");
assert.equal(glurak.imageHigh, "https://assets.tcgdex.net/de/sv/sv03.5/006/high.webp");
const d = glurak.details;
assert.equal(d.localId, "006");
assert.equal(d.setTotal, 165);
assert.deepEqual(d.names, { de: "Glurak-ex", en: "Charizard ex" });
assert.deepEqual(d.setNames, { de: "151", en: "151" });
assert.equal(d.stage, "Stage2", "the stage is the English, language-neutral one");
assert.equal(d.display.stage, "Rang 2", "the display string is German");
assert.deepEqual(d.display.types, ["Feuer"]);
assert.equal(d.hp, 330);
assert.equal(d.evolveFrom, "Charmeleon", "evolveFrom is English");
assert.equal(d.basicEnergy, false);
assert.equal(d.onePerDeck, null);
assert.equal(d.regulationMark, "G");
assert.deepEqual(d.legal, { standard: false, expanded: true });
assert.deepEqual(d.dexIds, [6]);
assert.equal(d.weakness, "Wasser ×2");
assert.equal(d.retreat, 2);
assert.equal(d.attacks.length, 2);
assert.equal(d.attacks[0].name, "Tapfere Flügel", "attacks read in German");
assert.deepEqual(d.attacks[1], { name: "Explosiver Wirbel", cost: ["Feuer", "Feuer", "Feuer", "Feuer"], damage: "330", effect: "Lege 3 Energien von diesem Pokémon auf deinen Ablagestapel." });
assert.deepEqual(detailsFromTcgdex(glurakDe, glurakEn), d, "detailsFromTcgdex(de, en) is what the record carries");
assert.match(glurak.skillText ?? "", /Tapfere Flügel 60\+/);

// A card TCGdex has in one language only still maps.
const glurakEnOnly = detailsFromTcgdex(null, glurakEn);
assert.deepEqual(glurakEnOnly.names, { en: "Charizard ex" });
assert.deepEqual(glurakEnOnly.display.types, ["Fire"]);

// Prices and the CardTrader blueprint, per variant.
assert.deepEqual(glurak.variants, [{ variant: "holo", label: "Holo", ctBlueprintId: 261069, cardmarketId: 733601, priceCents: 776, lowCents: 399 }]);
const hit = glurak.hit;
assert.equal(hit.id, "PKM-sv03.5-006");
assert.equal(hit.name, "Glurak-ex");
assert.equal(hit.altName, "Charizard ex");
assert.equal(hit.setName, "151");
assert.equal(hit.setTotal, 165);
assert.equal(hit.localId, "006");
assert.equal(hit.category, "POKEMON");
assert.deepEqual(hit.types, ["Feuer"]);
assert.equal(hit.image, "https://assets.tcgdex.net/de/sv/sv03.5/006");
assert.equal(hit.priceCents, 776);
assert.equal(hit.lowCents, 399);
assert.deepEqual(hit.variants, ["holo"]);
assert.deepEqual(hit.legal, { standard: false, expanded: true });
assert.equal(hitFromTcgdex(glurakDe, glurakEn, { lang: "en" }).name, "Charizard ex", "the language that matched is the name shown");

// Normal + reverse, priced at card level (no price per variant in the record), no CardTrader id.
const pineco = recordFromTcgdex(card("sv01-001", "de"), card("sv01-001", "en"));
assert.deepEqual(
  pineco.variants.map((v) => [v.variant, v.priceCents, v.lowCents, v.ctBlueprintId]),
  [
    ["normal", 4, 2, null],
    ["reverse", 17, 2, null],
  ],
  "the card-level block prices normal under trend and the reverse under trend-holo",
);
assert.equal(pineco.details.display.stage, "Basis");
assert.equal(pineco.details.stage, "Basic");

// Energy: a basic one is unlimited; a reverse print has its own product price.
const fire = recordFromTcgdex(card("sve-002", "de"), card("sve-002", "en"));
assert.equal(fire.category, "ENERGY");
assert.equal(fire.details.basicEnergy, true);
assert.equal(fire.hit.name, "Feuer-Energie");
assert.deepEqual(fire.variants.map((v) => [v.variant, v.priceCents]), [["normal", 3], ["reverse", 17]]);

// Trainer, ACE SPEC; Radiant; first edition.
const ultra = recordFromTcgdex(card("sv01-196", "de"), card("sv01-196", "en"));
assert.equal(ultra.category, "TRAINER");
assert.equal(ultra.details.stage, "Item");
assert.equal(ultra.details.onePerDeck, null);
assert.match(ultra.skillText ?? "", /Suche in deinem Deck|Pokémon/);
const prime = recordFromTcgdex(card("sv05-157", "de"), card("sv05-157", "en"));
assert.equal(prime.details.onePerDeck, "ace-spec");
assert.deepEqual(prime.details.legal, { standard: true, expanded: true });
assert.equal(prime.details.names.de, "Erstklassiger Fänger");
const radiant = recordFromTcgdex(card("swsh10.5-011", "de"), card("swsh10.5-011", "en"));
assert.equal(radiant.details.onePerDeck, "radiant");
assert.equal(radiant.details.abilities[0].name.length > 0, true);
const base = recordFromTcgdex(card("base1-4", "de"), card("base1-4", "en"));
assert.deepEqual(base.variants.map((v) => v.variant), ["holo", "firstEdition"]);
const [unlimited, firstEd] = base.variants;
assert.equal(unlimited.priceCents, 38583, "the unstamped holo is the plain print");
assert.equal(firstEd.priceCents, 348925, "the 1st-edition stamp is the first-edition print");
assert.equal(firstEd.cardmarketId, 660224);

// The mapper never invents: a bare record has nothing but what it says.
const bare = variantsFromTcgdex(null, { id: "x-1", name: "X" });
assert.deepEqual(bare, [{ variant: "normal", label: "Normal", ctBlueprintId: null, cardmarketId: null, priceCents: null, lowCents: null }]);

// ── The search merge ─────────────────────────────────────────────────────────

const sets = new Map((await (async () => (await listPokemonSets()).map((s) => [s.id, s] as const))()));
mainCalls();
{
  const de = fixture<TcgdexBrief[]>("list-de-pikachu.json");
  const en = fixture<TcgdexBrief[]>("list-en-pikachu.json");
  const merged = mergeSearchHits(de, en, { sets });
  assert.deepEqual(
    merged.map((h) => h.tcgdexId),
    ["basep-1", "2024sv-2", "basep-4", "2017sm-5", "cel25-5", "tk-ex-latio-6", "fut2020-1", "tk-hs-r-2", "2018sm-4"],
    "German order first, then the cards only English found, each id once",
  );
  const onTheBall = merged.find((h) => h.tcgdexId === "fut2020-1")!;
  assert.equal(onTheBall.name, "Pikachu on the Ball", "found in English only: the English name");
  assert.equal(merged[0].name, "Pikachu");
  assert.equal(merged[0].altName, null, "equal names are not shown twice");
  assert.equal(merged[0].setName, "Wizards Black Star Promos", "the set name comes from the cached set list");
  assert.equal(merged[0].image, "https://assets.tcgdex.net/en/base/basep/1", "no German picture: the English one");
  assert.equal(merged[0].priceCents, null, "a list entry carries no price");
  assert.deepEqual(merged[0].variants, []);
  assert.equal(merged[0].legal, null);
}

// "Glurak" and "Charizard" find the same cards.
{
  const viaGerman = await searchPokemon({ q: "Glurak", setId: "sv03.5" });
  const viaEnglish = await searchPokemon({ q: "Charizard", setId: "sv03.5" });
  assert.deepEqual(viaGerman.map((h) => h.id), ["PKM-sv03.5-006", "PKM-sv03.5-183", "PKM-sv03.5-199"]);
  assert.deepEqual(viaEnglish.map((h) => h.id), viaGerman.map((h) => h.id), "both names find the same three cards");
  assert.equal(viaGerman[0].name, "Glurak-ex");
  assert.equal(viaEnglish[0].name, "Charizard ex");
  assert.equal(viaGerman[0].setName, "151");
  assert.equal(viaGerman[0].setTotal, 165);
  const asked = mainCalls();
  const cardAsks = asked.filter((c) => c.url.pathname.endsWith("/cards"));
  assert.deepEqual(cardAsks.map((c) => c.lang).sort(), ["de", "de", "en", "en"], "each search asks both languages");
  for (const c of cardAsks) {
    assert.equal(c.url.searchParams.get("set.id"), "eq:sv03.5");
    assert.equal(c.url.searchParams.get("pagination:itemsPerPage"), "40");
    assert.equal(c.url.searchParams.get("pagination:page"), "1");
    assert.deepEqual(c.init?.next, { revalidate: 86400 }, "every outbound read is cached about a day");
  }
}

// Filters become the source's own, in each language.
{
  await searchPokemon({ q: "Glurak", type: "Fire", category: "pokemon" });
  const asked = mainCalls().filter((c) => c.url.pathname.endsWith("/cards"));
  const de = asked.find((c) => c.lang === "de")!.url.searchParams;
  const en = asked.find((c) => c.lang === "en")!.url.searchParams;
  assert.equal(de.get("types"), "eq:Feuer");
  assert.equal(en.get("types"), "eq:Fire");
  assert.equal(de.get("category"), "eq:Pokémon");
  assert.equal(en.get("category"), "eq:Pokemon");
  const filtered = await searchPokemon({ q: "Glurak", setId: "sv03.5", type: "Feuer", category: "POKEMON" });
  assert.equal(filtered[0].category, "POKEMON");
  assert.deepEqual(filtered[0].types, ["Feuer"], "a type filter tells the hit one of its types");
  mainCalls();
}
assert.deepEqual(await searchPokemon({}), [], "nothing to ask answers nothing");
assert.deepEqual(await searchPokemon({ q: "Glurak", type: "Sonne" }), [], "an unknown type finds nothing");
assert.equal(mainCalls().length, 0, "...without a request");

// A collector number filters by localId and the set's official size.
{
  const withSize = await searchPokemon({ q: "6/165" });
  const asked = mainCalls().filter((c) => c.url.pathname.endsWith("/cards"));
  for (const c of asked) {
    assert.equal(c.url.searchParams.get("localId"), "006");
    assert.equal(c.url.searchParams.get("set.cardCount.official"), "eq:165");
    assert.equal(c.url.searchParams.get("name"), null, "a number alone asks for no name");
  }
  assert.deepEqual(withSize.map((h) => h.tcgdexId), ["sv03.5-006", "ecard1-6"], "the source's contains-match is cut down to exactly number 6");
  assert.equal(withSize[0].name, "Glurak-ex");
  assert.equal(withSize[1].setName, "Expedition", "the set name comes from the set list");
  const noSize = await searchPokemon({ q: "006" });
  assert.deepEqual(noSize.map((h) => h.tcgdexId), ["sv03.5-006", "ecard1-6"]);
  assert.equal(mainCalls().filter((c) => c.url.pathname.endsWith("/cards"))[0].url.searchParams.get("set.cardCount.official"), null);
}

// The set list: newest first as the source orders it, with logos from the series pages.
{
  const list = await listPokemonSets();
  const asked = mainCalls();
  assert.ok(asked.some((c) => c.url.pathname === "/v2/de/sets" && c.url.searchParams.get("sort:field") === "releaseDate" && c.url.searchParams.get("sort:order") === "DESC"), "sorted by release date, newest first, by the source");
  const mew = list.find((s) => s.id === "sv03.5")!;
  assert.equal(mew.name, "151");
  assert.equal(mew.official, 165);
  assert.equal(mew.logo, "https://assets.tcgdex.net/de/sv/sv03.5/logo");
  assert.equal(list.find((s) => s.id === "cel25")?.logo, "https://assets.tcgdex.net/de/swsh/cel25/logo", "a set that carries its own logo keeps it");
  assert.equal(list.find((s) => s.id === "base1")?.logo ?? null, null, "an old set with no logo has none");
  assert.equal(list.find((s) => s.id === "base1")?.names.en, "Base Set");
}

// ── Source failures are typed ────────────────────────────────────────────────

async function rejects(fn: () => Promise<unknown>, kind: string): Promise<PokemonSourceError> {
  try {
    await fn();
  } catch (e) {
    assert.ok(e instanceof PokemonSourceError, `a PokemonSourceError, got ${e}`);
    assert.equal(e.kind, kind);
    return e;
  }
  assert.fail(`expected a PokemonSourceError (${kind})`);
}
outage = "503";
const down = await rejects(() => searchPokemon({ q: "Glurak" }), "unavailable");
assert.equal(down.status, 503);
await rejects(() => getPokemonCard("sv03.5-006"), "unavailable");
outage = "network";
await rejects(() => searchPokemon({ q: "Glurak" }), "unavailable");
outage = "timeout";
await rejects(() => listPokemonSets(), "timeout");
outage = "de-503";
{
  const oneLanguage = await searchPokemon({ q: "Charizard", setId: "sv03.5" });
  assert.equal(oneLanguage.length, 3, "one language down: the other still answers");
}
outage = null;
await rejects(() => getPokemonCard("nope-1"), "not_found");
mainCalls();

// ── ensurePokemonCard on PGlite ──────────────────────────────────────────────

const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
for (const file of fs.readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join("drizzle", file), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}
const { cardSets, cards, cardPrints, ownedCards, wantList, deckCards, decks } = schema;

const ensured = await ensurePokemonCard(db, "sv03.5-006");
assert.equal(ensured.cardId, "PKM-sv03.5-006");
assert.deepEqual(ensured.prints.map((p) => [p.id, p.variant, p.isBase]), [["PKM-sv03.5-006_holo", "holo", true]]);
{
  const [set] = await db.select().from(cardSets).where(eq(cardSets.code, "PKM-sv03.5"));
  assert.deepEqual([set.game, set.line, set.name, set.releasedOn, set.sortKey], ["pokemon", "pokemon", "151", "2023-09-22", 20230922]);
  const [c] = await db.select().from(cards).where(eq(cards.id, "PKM-sv03.5-006"));
  assert.equal(c.game, "pokemon");
  assert.equal(c.setCode, "PKM-sv03.5");
  assert.equal(c.name, "Glurak-ex", "cards.name prefers German");
  assert.equal(c.cardType, "POKEMON");
  assert.deepEqual(c.colors, ["Feuer"]);
  assert.equal(c.power, 330);
  assert.match(c.skill ?? "", /Explosiver Wirbel/);
  assert.equal(c.rarity, "Doppelselten");
  assert.equal(c.rarityCode, "Double rare");
  assert.equal(c.imageUrl, "https://assets.tcgdex.net/de/sv/sv03.5/006/high.webp");
  assert.ok(c.searchText.includes("glurak-ex") && c.searchText.includes("charizard ex") && c.searchText.includes("006/165"), "search text has both names and the number");
  const details = pokemonDetails(c.details);
  assert.equal(details.tcgdexId, "sv03.5-006");
  assert.deepEqual(details.names, { de: "Glurak-ex", en: "Charizard ex" });
  const [p] = await db.select().from(cardPrints).where(eq(cardPrints.cardId, "PKM-sv03.5-006"));
  assert.deepEqual([p.id, p.suffix, p.label, p.isBase, p.ctBlueprintId, p.marketCents, p.marketLowCents, p.marketCurrency], ["PKM-sv03.5-006_holo", "holo", "Holo", true, 261069, 776, 399, "EUR"]);
  assert.ok(p.marketAt instanceof Date);
}
// Again: one row each, nothing lost when the source has less to say.
const bareRecord = { ...glurak, imageHigh: null, skillText: null, variants: glurak.variants.map((v) => ({ ...v, ctBlueprintId: null, priceCents: null, lowCents: null })), details: { ...glurak.details, hp: null } };
await ensurePokemonCard(db, "sv03.5-006", { record: bareRecord, set: null });
{
  const [c] = await db.select().from(cards).where(eq(cards.id, "PKM-sv03.5-006"));
  assert.equal(c.imageUrl, "https://assets.tcgdex.net/de/sv/sv03.5/006/high.webp", "a re-ensure never erases the picture");
  assert.match(c.skill ?? "", /Explosiver Wirbel/, "...nor the text");
  assert.equal(c.power, 330, "...nor the HP column (power)");
  const [p] = await db.select().from(cardPrints).where(eq(cardPrints.cardId, "PKM-sv03.5-006"));
  assert.deepEqual([p.ctBlueprintId, p.marketCents, p.marketLowCents], [261069, 776, 399], "...nor the blueprint or the price");
  const [set] = await db.select().from(cardSets).where(eq(cardSets.code, "PKM-sv03.5"));
  assert.equal(set.releasedOn, "2023-09-22", "...nor the set's release date");
  assert.equal((await db.select().from(cards).where(eq(cards.game, "pokemon"))).length, 1);
  assert.equal((await db.select().from(cardPrints)).length, 1);
}
const two = await ensurePokemonCard(db, "sv01-001");
assert.deepEqual(two.prints.map((p) => [p.id, p.variant, p.isBase]), [["PKM-sv01-001", "normal", true], ["PKM-sv01-001_reverse", "reverse", false]]);
{
  const prints = await db.select().from(cardPrints).where(eq(cardPrints.cardId, "PKM-sv01-001")).orderBy(cardPrints.id);
  assert.deepEqual(prints.map((p) => [p.suffix, p.label, p.marketCents]), [["", "Normal", 4], ["reverse", "Reverse Holo", 17]]);
}
assert.equal((await db.select().from(cards).where(eq(cards.game, "dbs"))).length, 0, "no Dragon Ball row is ever touched");

// The cache tag: the writer expires `catalog`.
assert.match(fs.readFileSync("src/lib/pokemon/store.ts", "utf8"), /expireTagsFromAction\("catalog"\)/, "ensurePokemonCard expires the catalog tag");
assert.match(fs.readFileSync("src/app/api/sync/prices/route.ts", "utf8"), /refreshPokemonCards\(db[^)]*\)\.catch/, "the price cron refreshes Pokémon cards without failing on it");

// ── The data effects of the Server Functions ─────────────────────────────────

const mia: Viewer = { kind: "player", via: "code", playerId: 1, deviceId: 1, name: "Mia", login: "mia", owner: "mia" };
const tom: Viewer = { kind: "player", via: "code", playerId: 2, deviceId: 2, name: "Tom", login: "tom", owner: "tom" };
const sl: Viewer = { kind: "sl", via: "google", email: "sl@example.com", login: "papa", owner: "papa" };
const open: Viewer = { kind: "sl", via: "open", email: null, login: null, owner: null };

const [miaDeck] = await db.insert(decks).values({ name: "Feuer", game: "pokemon", owner: "mia", format: "standard" }).returning({ id: decks.id });
const [tomDeck] = await db.insert(decks).values({ name: "Wasser", game: "pokemon", owner: "tom" }).returning({ id: decks.id });
const [dbsDeck] = await db.insert(decks).values({ name: "Goku", game: "dbs", owner: "mia" }).returning({ id: decks.id });

const lotsOf = async (owner: string | null, printId: string, language?: string) =>
  db
    .select()
    .from(ownedCards)
    .where(and(eq(ownedCards.printId, printId), owner === null ? isNull(ownedCards.owner) : eq(ownedCards.owner, owner), language ? eq(ownedCards.language, language) : undefined, isNull(ownedCards.archivedAt)))
    .orderBy(ownedCards.id);

// addPokemonLotAction: ensure + lots stamped with the owner + "also add to deck".
{
  const r = await addPokemonLots(db, mia, { tcgdexId: "sv01-001", variant: "reverse", language: "DE", quantity: 2, deckId: miaDeck.id });
  assert.deepEqual([r.cardId, r.printId, r.added, r.deckAdded], ["PKM-sv01-001", "PKM-sv01-001_reverse", 2, 2]);
  const lots = await lotsOf("mia", "PKM-sv01-001_reverse");
  assert.equal(lots.length, 2);
  assert.ok(lots.every((l) => l.owner === "mia" && l.language === "DE" && l.finish === "foil" && l.condition === "NM" && l.cardId === "PKM-sv01-001"), "every lot is stamped with its owner, language and card");
  const line = await db.select().from(deckCards).where(eq(deckCards.deckId, miaDeck.id));
  assert.deepEqual(line.map((l) => [l.cardId, l.zone, l.quantity]), [["PKM-sv01-001", "main", 2]]);

  // A card not stored yet is written on the way.
  const fresh = await addPokemonLots(db, mia, { tcgdexId: "sv05-157", variant: "holo", language: "EN", quantity: 1 });
  assert.equal(fresh.deckAdded, 0);
  assert.equal((await db.select().from(cards).where(eq(cards.id, "PKM-sv05-157"))).length, 1);

  await assert.rejects(() => addPokemonLots(db, mia, { tcgdexId: "sv01-001", variant: "normal", language: "DE", quantity: 1, deckId: tomDeck.id }), AccessDenied, "a player cannot add to another player's deck");
  await assert.rejects(() => addPokemonLots(db, mia, { tcgdexId: "sv01-001", variant: "normal", language: "DE", quantity: 1, deckId: dbsDeck.id }), PokemonInputError, "a Dragon Ball deck takes no Pokémon card");
  await assert.rejects(() => addPokemonLots(db, mia, { tcgdexId: "sv01-001", variant: "holo", language: "DE", quantity: 1 }), /gibt es nicht als holo/, "a variant the card is not printed in");
  await assert.rejects(() => addPokemonLots(db, mia, { tcgdexId: "sv01-001", variant: "normal", language: "FR" as "DE", quantity: 1 }), PokemonInputError);
  assert.equal((await lotsOf("mia", "PKM-sv01-001")).length, 0, "refused calls wrote nothing");
  const viaSl = await addPokemonLots(db, sl, { tcgdexId: "sv01-001", variant: "normal", language: "EN", quantity: 1, deckId: tomDeck.id });
  assert.equal(viaSl.deckAdded, 1, "an SL may add to any deck");
  assert.equal((await lotsOf("papa", "PKM-sv01-001")).length, 1, "...and their own copies carry their own owner name");
  await addPokemonLots(db, open, { tcgdexId: "sv01-001", variant: "normal", language: "EN", quantity: 1 });
  assert.equal((await lotsOf(null, "PKM-sv01-001")).length, 1, "the app running open stamps no owner");
}

// setPokemonOwnedAction: an exact count.
{
  const id = "PKM-sv01-001";
  await addPokemonLots(db, tom, { tcgdexId: "sv01-001", variant: "normal", language: "DE", quantity: 3 });
  assert.deepEqual(await setPokemonOwned(db, mia, { tcgdexId: "sv01-001", variant: "normal", language: "DE", quantity: 4 }), { quantity: 4, added: 4, removed: 0 });
  assert.equal((await lotsOf("mia", id, "DE")).length, 4);
  assert.deepEqual(await setPokemonOwned(db, mia, { tcgdexId: "sv01-001", variant: "normal", language: "DE", quantity: 4 }), { quantity: 4, added: 0, removed: 0 });
  const before = await lotsOf("mia", id, "DE");
  assert.deepEqual(await setPokemonOwned(db, mia, { tcgdexId: "sv01-001", variant: "normal", language: "DE", quantity: 1 }), { quantity: 1, added: 0, removed: 3 });
  const kept = await lotsOf("mia", id, "DE");
  assert.deepEqual(kept.map((l) => l.id), [before[0].id], "the oldest copy stays");
  const archived = await db.select().from(ownedCards).where(and(eq(ownedCards.printId, id), eq(ownedCards.owner, "mia")));
  assert.equal(archived.filter((l) => l.archivedAt).length, 3, "removed copies are archived, never deleted");
  assert.equal((await lotsOf("tom", id, "DE")).length, 3, "another player's copies are not touched");
  await setPokemonOwned(db, mia, { tcgdexId: "sv01-001", variant: "normal", language: "EN", quantity: 2 });
  assert.equal((await lotsOf("mia", id, "EN")).length, 2, "a language is its own count");
  assert.equal((await lotsOf("mia", id, "DE")).length, 1);
  assert.deepEqual(await setPokemonOwned(db, mia, { tcgdexId: "sv01-001", variant: "normal", language: "EN", quantity: 0 }), { quantity: 0, added: 0, removed: 2 });
  assert.deepEqual(await setPokemonOwned(db, mia, { tcgdexId: "sv01-001", variant: "normal", language: "EN", quantity: 500 }), { quantity: 99, added: 99, removed: 0 }, "no more than 99 copies of a card in one go");
  await setPokemonOwned(db, mia, { tcgdexId: "sv01-001", variant: "normal", language: "EN", quantity: 0 });
  assert.equal(await setPokemonOwned(db, mia, { tcgdexId: "nope-1", variant: "normal", language: "DE", quantity: 0 }).then((r) => r.quantity), 0, "removing what was never stored needs no source");
}

// The viewer's own counts, wishes and lines.
{
  const counts = await ownedCountsFor(db, mia, ["PKM-sv01-001", "PKM-sv05-157", "PKM-sv03.5-006"]);
  assert.deepEqual(counts, { "PKM-sv01-001": 3, "PKM-sv05-157": 1 }, "active copies of every print and language, none for a card she does not hold");
  assert.deepEqual(await ownedCountsFor(db, tom, ["PKM-sv01-001"]), { "PKM-sv01-001": 3 });
  assert.deepEqual(await ownedCountsFor(db, sl, ["PKM-sv01-001"]), { "PKM-sv01-001": 1 }, "an SL counts only their own, never a player's");
  assert.deepEqual(await ownedCountsFor(db, open, ["PKM-sv01-001"]), { "PKM-sv01-001": 1 });
  assert.deepEqual(await ownedCountsFor(db, mia, []), {});
  assert.deepEqual(await ownedLinesFor(db, mia, "PKM-sv01-001"), [
    { printId: "PKM-sv01-001", variant: "normal", language: "DE", quantity: 1 },
    { printId: "PKM-sv01-001_reverse", variant: "reverse", language: "DE", quantity: 2 },
  ]);
}

// togglePokemonWishAction.
{
  assert.deepEqual(await togglePokemonWish(db, mia, "sv03.5-006"), { wished: true });
  assert.equal((await db.select().from(cards).where(eq(cards.id, "PKM-sv03.5-006"))).length, 1);
  const wants = await db.select().from(wantList).where(eq(wantList.cardId, "PKM-sv03.5-006"));
  assert.deepEqual(wants.map((w) => [w.owner, w.quantity, w.deckId]), [["mia", 1, null]]);
  assert.deepEqual(await wishedAmong(db, mia, ["PKM-sv03.5-006", "PKM-sv01-001"]), ["PKM-sv03.5-006"]);
  assert.deepEqual(await wishedAmong(db, tom, ["PKM-sv03.5-006"]), [], "a wish is the viewer's own");
  assert.deepEqual(await wishedAmong(db, sl, ["PKM-sv03.5-006"]), [], "...an SL does not see a player's as theirs");
  assert.deepEqual(await togglePokemonWish(db, tom, "sv03.5-006"), { wished: true });
  assert.deepEqual(await togglePokemonWish(db, mia, "sv03.5-006"), { wished: false });
  assert.deepEqual((await db.select().from(wantList).where(eq(wantList.cardId, "PKM-sv03.5-006"))).map((w) => w.owner), ["tom"], "only her own wish went");
  assert.deepEqual(await togglePokemonWish(db, open, "sv03.5-006"), { wished: true });
  assert.deepEqual(await togglePokemonWish(db, open, "sv03.5-006"), { wished: false });
  await assert.rejects(() => togglePokemonWish(db, mia, "../x"), PokemonInputError);
}

// addPokemonToDeckAction.
{
  assert.deepEqual(await addPokemonToDeck(db, mia, { deckId: miaDeck.id, tcgdexId: "sv03.5-006", quantity: 3 }), { cardId: "PKM-sv03.5-006", added: 3 });
  await addPokemonToDeck(db, mia, { deckId: miaDeck.id, tcgdexId: "sv03.5-006", quantity: 1 });
  const line = await db.select().from(deckCards).where(and(eq(deckCards.deckId, miaDeck.id), eq(deckCards.cardId, "PKM-sv03.5-006")));
  assert.deepEqual(line.map((l) => [l.zone, l.quantity]), [["main", 4]], "adds to the line, as everywhere in the app");
  await assert.rejects(() => addPokemonToDeck(db, tom, { deckId: miaDeck.id, tcgdexId: "sv03.5-006", quantity: 1 }), AccessDenied);
  await assert.rejects(() => addPokemonToDeck(db, mia, { deckId: 9999, tcgdexId: "sv03.5-006", quantity: 1 }), PokemonInputError);
  await addPokemonToDeck(db, sl, { deckId: miaDeck.id, tcgdexId: "sv05-157", quantity: 1 });
}

// ── The nightly refresh ──────────────────────────────────────────────────────

{
  // Stored: sv01-001 and sv05-157 (copies), sv03.5-006 (in a deck), and one nobody refers to.
  await ensurePokemonCard(db, "swsh10.5-011");
  assert.equal((await db.select().from(cards).where(eq(cards.id, "PKM-swsh10.5-011"))).length, 1);
  mainCalls();
  const summary = await refreshPokemonCards(db, { concurrency: 2 });
  assert.equal(summary.cards, 3, "only cards something refers to are read");
  assert.deepEqual([summary.refreshed, summary.failed, summary.skipped], [3, 0, 0]);
  const refreshAsks = mainCalls().filter((c) => c.url.pathname.includes("/cards/"));
  assert.deepEqual(new Set(refreshAsks.map((c) => c.lang)), new Set(["en"]), "the refresh reads the English record only");
  assert.ok(refreshAsks.every((c) => c.init?.cache === "no-store"), "...fresh, past the day cache");
  assert.ok(!refreshAsks.some((c) => c.url.pathname.endsWith("swsh10.5-011")), "the unreferenced card is skipped");
  assert.equal(summary.legalityChanged, 0);

  // A rotation and a new price arrive; one card fails; the rest go through.
  const rotate = async (id: string) => {
    if (id === "sv05-157") throw new PokemonSourceError("down", "unavailable", 503);
    const rec = recordFromTcgdex(null, card(id as "sv01-001", "en"));
    return { ...rec, details: { ...rec.details, legal: { standard: false, expanded: true }, regulationMark: "Z" }, variants: rec.variants.map((v) => ({ ...v, priceCents: 999, lowCents: 111 })) };
  };
  const second = await refreshPokemonCards(db, { fetchCard: rotate });
  assert.deepEqual([second.cards, second.refreshed, second.failed, second.legalityChanged], [3, 2, 1, 2]);
  assert.match(second.errors[0], /PKM-sv05-157: down/);
  const [pineco] = await db.select().from(cards).where(eq(cards.id, "PKM-sv01-001"));
  const dt = pokemonDetails(pineco.details);
  assert.deepEqual([dt.legal, dt.regulationMark], [{ standard: false, expanded: true }, "Z"]);
  assert.deepEqual(dt.names, { de: "Tannza", en: "Pineco" }, "the rest of the details stay as they were");
  const prints = await db.select().from(cardPrints).where(eq(cardPrints.cardId, "PKM-sv01-001")).orderBy(cardPrints.id);
  assert.deepEqual(prints.map((p) => [p.marketCents, p.marketLowCents, p.marketCurrency]), [[999, 111, "EUR"], [999, 111, "EUR"]]);
  const [prime] = await db.select().from(cards).where(eq(cards.id, "PKM-sv05-157"));
  assert.equal(pokemonDetails(prime.details).regulationMark, "H", "a failed card keeps what it had");

  // A time budget of nothing reads nothing and says so.
  const none = await refreshPokemonCards(db, { budgetMs: -1, fetchCard: rotate });
  assert.deepEqual([none.refreshed, none.skipped], [0, 3]);
}

globalThis.fetch = realFetch;
await client.close();
console.log("pokemon-tcgdex: ok");
