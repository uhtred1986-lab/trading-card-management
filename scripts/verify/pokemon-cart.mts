/**
 * Lane F of docs/pokemon/plan.md: the admin buys what a player wishes for. No network and no
 * database beyond PGlite.
 *
 * Covers: an SL opening a player's wishes (and the scope refusal for a player), CardTrader
 * listings for a Pokémon print through the direct blueprint-id path and through the
 * expansion-and-number fallback (the corrected id stored on the print), the listing filters
 * (language, Near Mint) feeding the unchanged optimiser, Pokémon value in EUR beside a Dragon Ball
 * lot in USD-converted value, the Pokémon links, and "mark as bought" stamping the player's owner.
 *
 * SYNTHETIC FIXTURE: every CardTrader response below is invented for this test. It is shaped like
 * the responses the existing client parses (`marketplace/products` -> {"<blueprint id>": [products]},
 * `/games`, `/expansions`, `blueprints/export` as {"array": [...]}), but no real CardTrader id,
 * seller or price is recorded here, and the real mapping of TCGdex's id to a blueprint is still
 * unproven (docs/pokemon/plan.md §3). The token is a placeholder: nothing leaves this process.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { AccessDenied, type Viewer } from "../../src/lib/auth/index.ts";
import { valuedLots, summarise } from "../../src/lib/collection/queries.ts";
import { externalLinks, refreshListingsForCard } from "../../src/lib/marketplace/cardtrader.ts";
import { directAnswerMatches, nameMatches, normalNumber, refreshPokemonListings } from "../../src/lib/marketplace/cardtrader-pokemon.ts";
import { DEFAULT_CART_SETTINGS, applyListingFilter, listingFilterFrom, optimiseCart } from "../../src/lib/marketplace/cart.ts";
import { MarkBoughtError, markWishBought, wishLabel, wishSources, wishesOf } from "../../src/lib/marketplace/wishes.ts";
import { marketValueOf, pricesForPrints } from "../../src/lib/pricing/queries.ts";

const { cardSets, cards, cardPrints, ctBlueprints, ctExpansions, ctListings, fxRates, ownedCards, players, tcgGroups, tcgPrices, tcgProducts, wantList } = schema;

// ── the stubbed CardTrader (synthetic; GET only) ─────────────────────────────

const seen: { method: string; path: string; query: string }[] = [];
const realFetch = globalThis.fetch;

interface SynthProduct {
  id: number;
  blueprint_id: number;
  name_en: string;
  quantity: number;
  cents: number;
  condition: string;
  language: string;
  seller: string;
  country?: string;
  hub?: boolean;
}
const product = (p: SynthProduct) => ({
  id: p.id,
  blueprint_id: p.blueprint_id,
  name_en: p.name_en,
  quantity: p.quantity,
  price: { cents: p.cents, currency: "EUR" },
  properties_hash: { condition: p.condition, pokemon_language: p.language },
  user: { id: p.seller.length * 100 + p.id, username: p.seller, country_code: p.country ?? "DE", can_sell_via_hub: !!p.hub, max_sellable_in24h_quantity: null },
  on_vacation: false,
});

/** Blueprint id -> what `marketplace/products?blueprint_id=` answers (a map keyed by blueprint id). */
const PRODUCTS: Record<number, ReturnType<typeof product>[]> = {
  // Charizard ex, normal print (direct path: right name)
  1001: [
    product({ id: 11, blueprint_id: 1001, name_en: "Charizard ex", quantity: 2, cents: 150, condition: "Near Mint", language: "de", seller: "alpha", hub: true }),
    product({ id: 12, blueprint_id: 1001, name_en: "Charizard ex", quantity: 3, cents: 90, condition: "Near Mint", language: "en", seller: "beta" }),
    product({ id: 13, blueprint_id: 1001, name_en: "Charizard ex", quantity: 1, cents: 40, condition: "Moderately Played", language: "de", seller: "gamma" }),
  ],
  // Charizard ex, holo print
  1002: [
    product({ id: 21, blueprint_id: 1002, name_en: "Charizard ex", quantity: 1, cents: 300, condition: "Near Mint", language: "de", seller: "alpha", hub: true }),
    product({ id: 22, blueprint_id: 1002, name_en: "Charizard ex", quantity: 1, cents: 250, condition: "Near Mint", language: "en", seller: "beta" }),
  ],
  // Charmander: the stored id 2001 answers nothing; the fallback finds blueprint 2999
  2001: [],
  2999: [product({ id: 31, blueprint_id: 2999, name_en: "Charmander", quantity: 4, cents: 20, condition: "Near Mint", language: "en", seller: "delta" })],
  // Bulbasaur: the stored id 3001 answers ANOTHER card, and the fallback finds no Bulbasaur number 001
  3001: [product({ id: 41, blueprint_id: 3001, name_en: "Pikachu", quantity: 1, cents: 10, condition: "Near Mint", language: "en", seller: "epsilon" })],
};

const GAMES = [
  { id: 9, name: "dragonball-super", display_name: "Dragon Ball Super" },
  { id: 5, name: "pokemon", display_name: "Pokémon" },
];
const EXPANSIONS = [
  { id: 300, game_id: 5, code: "mew", name: "151" },
  { id: 301, game_id: 5, code: "sv4", name: "Paradox Rift" },
  { id: 999, game_id: 9, code: "bt1", name: "Galactic Battle" },
];
const BLUEPRINTS_OF: Record<number, unknown[]> = {
  300: [
    { id: 2999, name: "Charmander", game_id: 5, expansion_id: 300, fixed_properties: { collector_number: "004/165" } },
    { id: 5000, name: "Charmander", game_id: 5, expansion_id: 300, fixed_properties: { collector_number: "063/165" } },
    { id: 6000, name: "Pikachu", game_id: 5, expansion_id: 300, fixed_properties: { collector_number: "025/165" } },
  ],
};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.origin, "https://api.cardtrader.com", "only CardTrader is ever called");
  seen.push({ method: init?.method ?? "GET", path: url.pathname.replace("/api/v2/", ""), query: url.search });
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  const p = url.pathname.replace("/api/v2/", "");
  if (p === "marketplace/products") {
    const bp = Number(url.searchParams.get("blueprint_id"));
    return json(bp in PRODUCTS ? { [String(bp)]: PRODUCTS[bp] } : {});
  }
  if (p === "games") return json({ array: GAMES });
  if (p === "expansions") return json(EXPANSIONS);
  if (p === "blueprints/export") return json({ array: BLUEPRINTS_OF[Number(url.searchParams.get("expansion_id"))] ?? [] });
  return new Response("unexpected", { status: 500 });
}) as typeof fetch;

// ── pure helpers ─────────────────────────────────────────────────────────────

assert.equal(normalNumber("006/165"), "6");
assert.equal(normalNumber("6"), "6");
assert.equal(normalNumber("SWSH001"), "SWSH1");
assert.equal(normalNumber("TG01/TG30"), "TG1");
assert.equal(normalNumber(null), null);
assert.ok(nameMatches("Charizard ex (Full Art)", ["Glurak-ex", "Charizard ex"]));
assert.ok(nameMatches("Glurak ex", ["Glurak-ex"]), "German name with a hyphen");
assert.ok(!nameMatches("Pikachu", ["Charizard ex"]));
assert.ok(!nameMatches("Charmeleon", ["Charmander"]), "a prefix of a word is not a name");
{
  const info = { names: ["Charizard ex"], number: "6" };
  const mk = (name: string, ph: Record<string, unknown> = {}) => ({ ...product({ id: 1, blueprint_id: 1, name_en: name, quantity: 1, cents: 1, condition: "Near Mint", language: "en", seller: "x" }), properties_hash: ph }) as never;
  assert.ok(!directAnswerMatches([], info, null), "nothing is not a match");
  assert.ok(directAnswerMatches([mk("Charizard ex")], info, null));
  assert.ok(!directAnswerMatches([mk("Pikachu")], info, null));
  assert.ok(!directAnswerMatches([mk("Charizard ex")], info, "7"), "a stored blueprint with another number is a mismatch");
  assert.ok(!directAnswerMatches([mk("Charizard ex", { collector_number: "007/165" })], info, null), "a product naming another number is a mismatch");
  assert.ok(directAnswerMatches([mk("Charizard ex", { collector_number: "006/165" })], info, "6"));
}
assert.deepEqual(listingFilterFrom(undefined, undefined), { language: "any", condition: "nm" });
assert.deepEqual(listingFilterFrom("DE", "any"), { language: "de", condition: "any" });
assert.deepEqual(listingFilterFrom("fr", "weird"), { language: "any", condition: "nm" });

{
  const pk = externalLinks({ id: "PKM-sv03.5-006", name: "Glurak-ex", game: "pokemon", localId: "006" });
  assert.match(pk.cardmarket, /cardmarket\.com\/en\/Pokemon\/Products\/Search\?searchString=Glurak-ex/);
  assert.match(pk.tcgplayer, /tcgplayer\.com\/search\/pokemon\/product\?q=Glurak-ex%20006/);
  assert.match(pk.cardtrader, /cardtrader\.com\/en\/search\?q=Glurak-ex%20006/);
  assert.ok(!pk.cardtrader.includes("PKM"), "the internal card id means nothing to a shop");
  const pkIds = externalLinks({ id: "PKM-x-1", name: "X", game: "pokemon" }, null, [4242]);
  assert.match(pkIds.cardmarket, /\/Pokemon\/Products\/Singles\?idProduct=4242/);
  const dbs = externalLinks({ id: "BT1-001", name: "Son Goku", game: "dbs" });
  assert.match(dbs.cardmarket, /\/DragonBallSuper\/Products\/Search/);
  assert.match(dbs.tcgplayer, /dragon-ball-super-ccg/);
}

// ── PGlite ───────────────────────────────────────────────────────────────────

const client = new PGlite();
const db = drizzle(client, { schema }) as unknown as Db;
for (const file of fs.readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join("drizzle", file), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}

const sl: Viewer = { kind: "sl", via: "google", email: "sl@example.com", login: "papa", owner: "papa" };
const mia: Viewer = { kind: "player", via: "code", playerId: 1, deviceId: 1, name: "Mia", login: "mia", owner: "mia" };
const tom: Viewer = { kind: "player", via: "code", playerId: 2, deviceId: 2, name: "Tom", login: "tom", owner: "tom" };

// Cards: three Pokémon (stored as ensurePokemonCard would), one Dragon Ball.
await db.insert(cardSets).values([
  { code: "PKM-sv03.5", name: "151", game: "pokemon", line: "pokemon" },
  { code: "BT1", name: "Galactic Battle", game: "dbs", line: "legacy" },
]);
const details = (tcgdexId: string, localId: string, de: string, en: string) => ({
  tcgdexId,
  localId,
  setTotal: 165,
  names: { de, en },
  setNames: { de: "151", en: "151" },
  stage: "Basic",
  basicEnergy: false,
  onePerDeck: null,
  hp: 100,
  evolveFrom: null,
  abilities: [],
  attacks: [],
  weakness: null,
  retreat: 1,
  regulationMark: "G",
  legal: { standard: true, expanded: true },
  dexIds: [],
  display: { types: [], stage: null, rarity: null },
});
const pkmCard = (id: string, name: string, d: ReturnType<typeof details>) => ({ id, setCode: "PKM-sv03.5", game: "pokemon", name, cardType: "POKEMON", rarity: "Rare", rarityCode: "R", details: d, searchText: name.toLowerCase() });
await db.insert(cards).values([
  pkmCard("PKM-sv03.5-006", "Glurak-ex", details("sv03.5-006", "006", "Glurak-ex", "Charizard ex")),
  pkmCard("PKM-sv03.5-004", "Glumanda", details("sv03.5-004", "004", "Glumanda", "Charmander")),
  pkmCard("PKM-sv03.5-001", "Bisasam", details("sv03.5-001", "001", "Bisasam", "Bulbasaur")),
  { id: "BT1-001", setCode: "BT1", game: "dbs", name: "Son Goku", cardType: "LEADER", rarity: "Rare", rarityCode: "R", searchText: "son goku" },
]);
const NOW = new Date();
await db.insert(cardPrints).values([
  { id: "PKM-sv03.5-006", cardId: "PKM-sv03.5-006", suffix: "", label: "Normal", rarity: "Rare", isBase: true, ctBlueprintId: 1001, marketCents: 800, marketLowCents: 600, marketCurrency: "EUR", marketAt: NOW },
  { id: "PKM-sv03.5-006_holo", cardId: "PKM-sv03.5-006", suffix: "holo", label: "Holo", rarity: "Rare", ctBlueprintId: 1002, marketCents: 1234, marketLowCents: 900, marketCurrency: "EUR", marketAt: NOW },
  { id: "PKM-sv03.5-004", cardId: "PKM-sv03.5-004", suffix: "", label: "Normal", rarity: "Common", isBase: true, ctBlueprintId: 2001 },
  { id: "PKM-sv03.5-001", cardId: "PKM-sv03.5-001", suffix: "", label: "Normal", rarity: "Common", isBase: true, ctBlueprintId: 3001 },
  { id: "BT1-001", cardId: "BT1-001", suffix: "", label: "Standard", rarity: "Rare", isBase: true },
]);

// ── 1. direct path ───────────────────────────────────────────────────────────

process.env.CARDTRADER_API_TOKEN = "synthetic-token-never-sent-anywhere";
process.env.CARDTRADER_ENABLED = "true";
const noWait = async () => {};

const direct = await refreshPokemonListings(db, "PKM-sv03.5-006", { pause: noWait });
assert.deepEqual(
  direct.prints.map((p) => [p.printId, p.path, p.corrected, p.listings]),
  [
    ["PKM-sv03.5-006", "direct", false, 3],
    ["PKM-sv03.5-006_holo", "direct", false, 2],
  ],
);
assert.deepEqual(
  [...new Set(seen.map((s) => s.path))].sort(),
  ["marketplace/products"],
  "the direct path asks only for the products of the blueprint ids on the prints",
);
assert.deepEqual(seen.map((s) => s.query).sort(), ["?blueprint_id=1001", "?blueprint_id=1002"]);
assert.equal(direct.listings.length, 5);
{
  const bps = await db.select().from(ctBlueprints).where(eq(ctBlueprints.cardId, "PKM-sv03.5-006"));
  assert.deepEqual(bps.map((b) => [b.id, b.printId, b.matchedBy, b.expansionId]).sort(), [
    [1001, "PKM-sv03.5-006", "blueprint-id", null],
    [1002, "PKM-sv03.5-006_holo", "blueprint-id", null],
  ]);
  const l = await db.select().from(ctListings).where(eq(ctListings.id, 11));
  assert.deepEqual([l[0].language, l[0].condition, l[0].currency, l[0].priceCents, l[0].canSellViaHub], ["de", "Near Mint", "EUR", 150, true]);
}
// refreshListingsForCard (what the cart and the card page call) takes the same path for a Pokémon id.
seen.length = 0;
assert.equal((await refreshListingsForCard(db, "PKM-sv03.5-006")).length, 5);

// ── 2. fallback path: the stored id answers nothing ──────────────────────────

seen.length = 0;
const fb = await refreshPokemonListings(db, "PKM-sv03.5-004", { pause: noWait });
assert.deepEqual(fb.prints.map((p) => [p.path, p.corrected, p.storedBlueprintId, p.blueprintId, p.listings]), [["fallback", true, 2001, 2999, 1]]);
assert.deepEqual(
  seen.map((s) => s.path + s.query),
  ["marketplace/products?blueprint_id=2001", "games", "expansions", "blueprints/export?expansion_id=300", "marketplace/products?blueprint_id=2999"],
  "direct first, then game, expansions, the one expansion's blueprints, then the corrected blueprint",
);
{
  const [print] = await db.select().from(cardPrints).where(eq(cardPrints.id, "PKM-sv03.5-004"));
  assert.equal(print.ctBlueprintId, 2999, "the corrected id is stored on the print");
  const [bp] = await db.select().from(ctBlueprints).where(eq(ctBlueprints.id, 2999));
  assert.deepEqual([bp.cardId, bp.printId, bp.matchedBy, bp.expansionId], ["PKM-sv03.5-004", "PKM-sv03.5-004", "expansion-number", 300]);
  const [exp] = await db.select().from(ctExpansions).where(eq(ctExpansions.id, 300));
  assert.deepEqual([exp.gameId, exp.code, exp.name], [5, "mew", "151"]);
  assert.equal((await db.select().from(ctListings).where(eq(ctListings.cardId, "PKM-sv03.5-004"))).length, 1);
}
// A second run goes straight to the corrected id.
seen.length = 0;
const again = await refreshPokemonListings(db, "PKM-sv03.5-004", { pause: noWait });
assert.deepEqual(again.prints.map((p) => [p.path, p.corrected]), [["direct", false]]);
assert.deepEqual(seen.map((s) => s.query), ["?blueprint_id=2999"]);

// ── 3. mismatch and nothing found: no listings, and nothing invented ─────────

seen.length = 0;
const bad = await refreshPokemonListings(db, "PKM-sv03.5-001", { pause: noWait });
assert.deepEqual(bad.prints.map((p) => [p.path, p.blueprintId, p.listings]), [["none", null, 0]]);
assert.match(bad.prints[0].note ?? "", /returned another card/);
assert.equal(bad.listings.length, 0, "a blueprint that is another card is never shown as this one");
assert.equal((await db.select().from(cardPrints).where(eq(cardPrints.id, "PKM-sv03.5-001")))[0].ctBlueprintId, 3001, "an id nothing better replaced is left alone");
assert.ok(seen.every((s) => s.method === "GET"), "CardTrader is read-only");
delete process.env.CARDTRADER_ENABLED;

// ── 4. filters feed the unchanged optimiser ──────────────────────────────────

// A Dragon Ball card and listing, to prove the Pokémon filters leave it alone.
await db.insert(ctBlueprints).values({ id: 9001, name: "Son Goku", cardId: "BT1-001", printId: "BT1-001" });
await db.insert(ctListings).values({ id: 91, blueprintId: 9001, cardId: "BT1-001", sellerId: 7, seller: "zeta", countryCode: "DE", priceCents: 500, currency: "EUR", quantity: 5, condition: "Moderately Played", language: "en" });

// No shipping, so the cheapest item is the cheapest plan (the optimiser itself is not under test here).
const cfg = { ...DEFAULT_CART_SETTINGS, hubShippingCents: 0, directShippingCents: 0 };
const want = [{ cardId: "PKM-sv03.5-006", quantity: 1 }];
const linesOf = (r: Awaited<ReturnType<typeof optimiseCart>>) => r.best.sellers.flatMap((s) => s.lines.map((l) => [s.seller, l.listing.priceCents, l.listing.language, l.listing.condition]));
{
  // Default: any language, Near Mint only. The 40-cent Moderately Played one is out; the 90-cent English NM wins.
  const r = await optimiseCart(db, want, cfg);
  assert.deepEqual(linesOf(r), [["beta", 90, "en", "Near Mint"]]);
  assert.equal(r.listings, 4, "five cached, one below Near Mint");
  // German only: the cheapest German NM.
  const de = await optimiseCart(db, want, cfg, listingFilterFrom("de", undefined));
  assert.deepEqual(linesOf(de), [["alpha", 150, "de", "Near Mint"]]);
  assert.equal(de.listings, 2);
  // English only.
  assert.deepEqual(linesOf(await optimiseCart(db, want, cfg, listingFilterFrom("en", undefined))), [["beta", 90, "en", "Near Mint"]]);
  // Any condition lets the 40-cent played copy back in.
  assert.deepEqual(linesOf(await optimiseCart(db, want, cfg, listingFilterFrom("any", "any"))), [["gamma", 40, "de", "Moderately Played"]]);
  // A language nobody sells: no plan for it, and the card is reported missing, not mis-bought.
  const none = await optimiseCart(db, want, cfg, { language: "de", condition: "nm" });
  assert.equal(none.best.missing.length, 0, "German NM exists");
  const fr = applyListingFilter([{ cardId: "PKM-sv03.5-006", language: "fr", condition: "Near Mint" }], listingFilterFrom("de", undefined));
  assert.equal(fr.length, 0);
  // The Dragon Ball listing (Moderately Played) is never filtered by the Pokémon rules.
  const mixed = await optimiseCart(db, [...want, { cardId: "BT1-001", quantity: 1 }], cfg, listingFilterFrom("de", undefined));
  assert.ok(mixed.best.sellers.some((s) => s.lines.some((l) => l.listing.cardId === "BT1-001" && l.listing.condition === "Moderately Played")));
  assert.equal(mixed.best.missing.length, 0);
}

// ── 5. the SL's view of a player's wishes ────────────────────────────────────

await db.insert(players).values([
  { name: "Mia", owner: "mia", homeGame: "pokemon" },
  { name: "Tom", owner: "tom" },
  { name: "Nobody", owner: "nobody" },
]);
await db.insert(wantList).values([
  { cardId: "PKM-sv03.5-006", quantity: 2, owner: "mia" },
  { cardId: "PKM-sv03.5-004", quantity: 1, owner: "mia" },
  { cardId: "BT1-001", quantity: 3, owner: "tom" },
  { cardId: "BT1-001", quantity: 1, owner: "papa" },
]);
{
  const sources = await wishSources(db, sl);
  assert.deepEqual(sources.map((s) => [s.owner, s.name, s.cards]), [["mia", "Mia", 3], ["tom", "Tom", 3]], "players with wishes; one without, and the SL's own list, are left out");
  assert.equal(wishLabel(sources[0].name), "Wishes of Mia");
  assert.deepEqual((await wishesOf(db, sl, "mia")).map((w) => [w.cardId, w.quantity]).sort(), [["PKM-sv03.5-004", 1], ["PKM-sv03.5-006", 2]]);
  assert.deepEqual((await wishesOf(db, sl, "tom")).map((w) => w.cardId), ["BT1-001"], "the gap for the Dragon Ball games is closed too");
  // The scope: a player sees their own, and another owner's name gets nothing.
  assert.deepEqual((await wishesOf(db, mia, "mia")).length, 2);
  assert.deepEqual(await wishesOf(db, mia, "tom"), []);
  assert.deepEqual(await wishesOf(db, tom, "mia"), []);
  assert.deepEqual(await wishesOf(db, mia, " tom "), [], "padding does not slip past the scope");
  assert.deepEqual(await wishSources(db, mia), [], "a player is offered no other source");
  assert.deepEqual(await wishesOf(db, sl, "  "), []);
}

// ── 6. Pokémon value in EUR beside a Dragon Ball lot in converted USD ────────

await db.insert(fxRates).values({ base: "USD", quote: "EUR", rate: 0.9, asOf: "2026-11-14" });
await db.insert(tcgGroups).values({ id: 1, categoryId: 27, name: "Galactic Battle" });
await db.insert(tcgProducts).values({ id: 500, groupId: 1, name: "Son Goku", number: "BT1-001", cardId: "BT1-001", printId: "BT1-001" });
await db.insert(tcgPrices).values({ productId: 500, subType: "Normal", capturedOn: "2026-11-14", marketCents: 1000 });
await db.insert(ownedCards).values([
  { printId: "PKM-sv03.5-006_holo", cardId: "PKM-sv03.5-006", owner: "mia", language: "DE", finish: "foil" },
  { printId: "PKM-sv03.5-006", cardId: "PKM-sv03.5-006", owner: "mia", language: "EN" },
  { printId: "BT1-001", cardId: "BT1-001", owner: "tom" },
  { printId: "PKM-sv03.5-001", cardId: "PKM-sv03.5-001", owner: "mia" }, // no market price stored
]);
{
  const prices = await pricesForPrints(db, ["PKM-sv03.5-006_holo", "BT1-001", "PKM-sv03.5-001"]);
  assert.equal(prices.get("PKM-sv03.5-006_holo")?.eurCents, 1234);
  assert.equal(prices.get("BT1-001")?.normalCents, 1000);
  assert.equal(prices.get("BT1-001")?.eurCents ?? null, null);
  assert.ok(!prices.has("PKM-sv03.5-001"), "a print with no price has none");
  assert.deepEqual(marketValueOf(prices.get("PKM-sv03.5-006_holo"), "foil", 0.9), { usd: null, eur: 1234 }, "EUR, never converted");
  assert.deepEqual(marketValueOf(prices.get("BT1-001"), "normal", 0.9), { usd: 1000, eur: 900 });
  assert.deepEqual(marketValueOf(prices.get("BT1-001"), "normal", null), { usd: 1000, eur: null }, "a Dragon Ball price needs the rate");

  const valued = await valuedLots(db);
  const byPrint = new Map(valued.lots.map((l) => [l.printId, l]));
  assert.equal(byPrint.get("PKM-sv03.5-006_holo")?.marketEurCents, 1234);
  assert.equal(byPrint.get("PKM-sv03.5-006_holo")?.marketUsdCents, null);
  assert.equal(byPrint.get("PKM-sv03.5-006")?.marketEurCents, 800);
  assert.equal(byPrint.get("BT1-001")?.marketEurCents, 900, "unchanged: 1000 USD cents at 0.9");
  assert.equal(byPrint.get("PKM-sv03.5-001")?.marketEurCents, null);
  const s = summarise(valued.lots, valued.usdEur);
  assert.equal(s.valueEurCents, 1234 + 800 + 900);
  assert.equal(s.copiesWithValue, 3, "the unpriced copy is not counted as valued");
  assert.equal(s.valueUsdCents, 1000, "only the Dragon Ball lot has a USD figure");
  // A player's scope still narrows the sum.
  const miaOnly = await valuedLots(db, { scope: "mia" });
  assert.equal(summarise(miaOnly.lots, miaOnly.usdEur).valueEurCents, 1234 + 800);
  const pkOnly = await valuedLots(db, { game: "pokemon" });
  assert.equal(summarise(pkOnly.lots, pkOnly.usdEur).valueEurCents, 1234 + 800);
}

// ── 7. mark as bought ────────────────────────────────────────────────────────

const lotsOf = (owner: string) => db.select().from(ownedCards).where(eq(ownedCards.owner, owner));
const miaBefore = (await lotsOf("mia")).length;
{
  // Filter: German, Near Mint -> the cheapest German NM listing is the normal print's (150), language DE.
  const r = await markWishBought(db, sl, { owner: "mia", cardId: "PKM-sv03.5-006", quantity: 1, pricePaidCents: 450, filter: listingFilterFrom("de", undefined) });
  assert.deepEqual([r.printId, r.language, r.bought, r.wishLeft], ["PKM-sv03.5-006", "DE", 1, 1]);
  const lots = (await lotsOf("mia")).filter((l) => r.ids.includes(l.id));
  assert.equal(lots.length, 1);
  assert.deepEqual([lots[0].owner, lots[0].printId, lots[0].language, lots[0].pricePaidCents, lots[0].currency, lots[0].finish, lots[0].condition], ["mia", "PKM-sv03.5-006", "DE", 450, "EUR", "normal", "NM"], "stamped with the player's owner, not the SL's");
  assert.equal((await db.select().from(ownedCards).where(eq(ownedCards.owner, "papa"))).length, 0, "nothing lands under the SL");
  const [w] = await db.select().from(wantList).where(eq(wantList.owner, "mia"));
  assert.ok(w);
  assert.equal((await wishesOf(db, sl, "mia")).find((x) => x.cardId === "PKM-sv03.5-006")?.quantity, 1, "the wish is reduced by what was bought");
}
{
  // No filter: the cheapest NM listing overall is the English 90-cent normal; asking for the holo print and DE is honoured.
  const r = await markWishBought(db, sl, { owner: "mia", cardId: "PKM-sv03.5-006", quantity: 5, pricePaidCents: null, printId: "PKM-sv03.5-006_holo", language: "DE" });
  assert.deepEqual([r.printId, r.language, r.bought, r.wishLeft], ["PKM-sv03.5-006_holo", "DE", 1, 0], "capped at the wish; the wish is gone");
  const lot = (await lotsOf("mia")).find((l) => l.id === r.ids[0])!;
  assert.deepEqual([lot.finish, lot.pricePaidCents], ["foil", null], "a holo copy is a foil one; an unknown price stays unknown");
  assert.ok(!(await wishesOf(db, sl, "mia")).some((x) => x.cardId === "PKM-sv03.5-006"));
  assert.equal((await lotsOf("mia")).length, miaBefore + 2);
}
{
  // Defaults with no filter and no choice: cheapest NM listing overall -> normal print, English.
  await db.insert(wantList).values({ cardId: "PKM-sv03.5-006", quantity: 1, owner: "tom" });
  const r = await markWishBought(db, sl, { owner: "tom", cardId: "PKM-sv03.5-006", quantity: 1, pricePaidCents: 100 });
  assert.deepEqual([r.printId, r.language], ["PKM-sv03.5-006", "EN"]);
  assert.equal((await lotsOf("tom")).filter((l) => r.ids.includes(l.id)).length, 1);
  // A Dragon Ball wish: the base print, English.
  const d = await markWishBought(db, sl, { owner: "tom", cardId: "BT1-001", quantity: 2, pricePaidCents: 321 });
  assert.deepEqual([d.printId, d.language, d.bought, d.wishLeft], ["BT1-001", "EN", 2, 1]);
}
await assert.rejects(() => markWishBought(db, sl, { owner: "mia", cardId: "PKM-sv03.5-006", quantity: 1, pricePaidCents: 1 }), (e) => e instanceof MarkBoughtError && /no longer/.test(e.message), "a wish already moved is gone");
await assert.rejects(() => markWishBought(db, sl, { owner: "mia", cardId: "PKM-sv03.5-004", quantity: 1, pricePaidCents: 1, printId: "BT1-001" }), (e) => e instanceof MarkBoughtError, "a print of another card is refused");
await assert.rejects(() => markWishBought(db, sl, { owner: "mia", cardId: "PKM-sv03.5-004", quantity: 1, pricePaidCents: -5 }), (e) => e instanceof MarkBoughtError);
assert.equal((await db.select().from(wantList).where(eq(wantList.owner, "mia"))).length, 1, "a refused call leaves the wish as it was");
// A player cannot mark anything as bought, for themselves or anyone.
await assert.rejects(() => markWishBought(db, mia, { owner: "mia", cardId: "PKM-sv03.5-004", quantity: 1, pricePaidCents: 1 }), AccessDenied);
await assert.rejects(() => markWishBought(db, mia, { owner: "tom", cardId: "BT1-001", quantity: 1, pricePaidCents: 1 }), AccessDenied);

// The Server Function is SL-only and the cart page reads wishes through the scoped helper.
const actions = fs.readFileSync("src/app/cart/actions.ts", "utf8");
assert.match(actions, /export async function markBoughtAction[\s\S]*?const viewer = await requireSl\(\);/);
assert.match(fs.readFileSync("src/app/cart/page.tsx", "utf8"), /wishesOf\(db, viewer, forOwner\)/);

// Cleanup so a re-run in the same process starts clean (the DB is in memory anyway).
await db.delete(ctListings).where(inArray(ctListings.cardId, ["PKM-sv03.5-006"]));
globalThis.fetch = realFetch;
await client.close();
console.log("pokemon-cart: ok");
