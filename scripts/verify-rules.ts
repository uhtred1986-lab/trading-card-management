/**
 * Pure-function checks — no database, no network. Run with `tsx`.
 */
import assert from "node:assert/strict";
import { baseNumber, normaliseRarity, printLabel, printSuffix, shapeCatalog } from "../src/lib/catalog/deckplanet";
import { gameOfNumber, gameOfSetCode, setCodeOfNumber, setLineFor, setNameFor } from "../src/lib/catalog/sets";
import { legality, parseDeckList, type DeckCardRow } from "../src/lib/decks/queries";
import { hasKeyword, leadingTags, parseDeckRules, rulesFor } from "../src/lib/decks/cardRules";
import { formatCents, parseEuroInput } from "../src/lib/money";
import { markerOf, matchProduct } from "../src/lib/pricing/tcgcsv";
import { greedyOptimise, type Listing } from "../src/lib/marketplace/optimizer";
import { parseBasicAuth, parseBasicUser } from "../src/lib/auth-header";
import { hashPassword, passwordProblem, usernameProblem, verifyPassword } from "../src/lib/auth/password";
import { normaliseSpeech, parseSpoken, spokenQuantity } from "../src/lib/scan/voice";
import { collectorNumbers } from "../src/lib/marketplace/cardtrader";
import { sanitiseDraft, type PoolCard } from "../src/lib/ai/deck-builder";
import { assessMatch, cleanBox, nameSimilarity, normaliseNumber } from "../src/lib/ai/scan-match";
import { parseViewMode, viewHref } from "../src/lib/view-mode";

// ── catalog shaping ────────────────────────────────────────────────────────
assert.equal(baseNumber("BT18-020_SPR"), "BT18-020");
assert.equal(baseNumber("T_CLO_01"), "T_CLO_01");
assert.equal(printSuffix("P-625_PR2"), "PR2");
assert.equal(printSuffix("T_CLO_01"), "");
assert.equal(printLabel("SPR"), "Special Rare");
assert.equal(printLabel(""), "Standard");
assert.equal(setCodeOfNumber("SD22-02"), "SD22");
assert.equal(setCodeOfNumber("T_CLO_01"), "TOKEN");
assert.equal(setLineFor("BT26", null), "masters");
assert.equal(setLineFor("BT25", null), "legacy");
assert.equal(setLineFor("SD30", "2025-01-01"), "masters");
assert.match(setNameFor("BT18"), /Dawn of the Z-Legends/);

// ── the two games are told apart by card-number prefix alone ───────────────
for (const [code, game] of [
  ["BT18", "dbs"],
  ["SD22", "dbs"],
  ["P", "dbs"],
  ["EX13", "dbs"],
  ["TOKEN", "dbs"],
  ["FB07", "fusion"],
  ["FS01", "fusion"],
  ["FP", "fusion"],
  ["SB01", "fusion"],
  ["ST01", "fusion"],
  // "E" is the Energy Marker set; "E01" must not be read as "E" + a number.
  ["E", "fusion"],
  ["E01", "fusion"],
] as const) {
  assert.equal(gameOfSetCode(code), game, `${code} belongs to ${game}`);
}
assert.equal(gameOfNumber("FB07-021"), "fusion");
assert.equal(gameOfNumber("BT18-020"), "dbs");
assert.equal(gameOfNumber("T_CLO_01"), "dbs");
// Every Fusion World set is one line, whatever its release date says.
assert.equal(setLineFor("FB01", "2024-02-23"), "fusion");
assert.equal(setLineFor("FS12", null), "fusion");
assert.match(setNameFor("FB07"), /Wish For Shenron \(FB07\)/);
assert.match(setNameFor("FS01"), /Starter Deck 01 – Son Goku/);
assert.equal(setNameFor("SB01"), "Manga Booster 01");
assert.equal(setCodeOfNumber("E-112"), "E");
assert.equal(setCodeOfNumber("FP-060"), "FP");

// Fusion World prints bare rarity codes; both games end up in "Name[CODE]" form
// so one rarity dropdown can serve them.
assert.equal(normaliseRarity("SR", "fusion"), "Super Rare[SR]");
assert.equal(normaliseRarity("SR★", "fusion"), "Super Rare Alt Art[SR★]");
assert.equal(normaliseRarity("Super Rare[SR]", "dbs"), "Super Rare[SR]", "the original game is left alone");
assert.equal(normaliseRarity(null, "fusion"), "Unknown");
assert.equal(normaliseRarity("ZZ", "fusion"), "ZZ", "an unknown code is passed through, not mangled");

const shaped = shapeCatalog([
  {
    id: 1,
    card_number: "BT18-020",
    card_name: "Omega Shenron",
    card_type: "BATTLE",
    card_color: "Red/Green",
    card_energy_cost: "-",
    card_power: "25000",
    card_rarity: "Super Rare[SR]",
    variants: [{ id: 2, card_number: "BT18-020_SPR", card_rarity: "Special Rare[SPR]", img_link: "BT18-020_SPR" }],
  },
  { id: 2, card_number: "BT18-020_SPR", card_name: "Omega Shenron", card_type: "BATTLE", card_rarity: "Special Rare[SPR]", variant_of: 1, variants: [] },
  { id: 3, card_number: "P-001", card_name: null, card_type: null, card_rarity: null },
] as never);
assert.equal(shaped.cards.length, 2, "variants collapse into one card");
const omega = shaped.cards.find((c) => c.id === "BT18-020")!;
assert.deepEqual(omega.colors, ["Red", "Green"]);
assert.equal(omega.energyCost, null, "'-' cost is null");
assert.equal(omega.power, 25000);
assert.equal(omega.rarityCode, "SR");
assert.deepEqual(
  shaped.prints.filter((p) => p.cardId === "BT18-020").map((p) => p.id).sort(),
  ["BT18-020", "BT18-020_SPR"],
);
const promo = shaped.cards.find((c) => c.id === "P-001")!;
assert.equal(promo.name, "P-001", "null name falls back to number");
assert.equal(promo.rarity, "Unknown");
assert.equal(shaped.prints.filter((p) => p.cardId === "P-001").length, 1, "a standard print is always created");
assert.ok(
  shaped.cards.every((c) => c.game === "dbs" && c.imageUrl?.startsWith("https://storage.googleapis.com/")),
  "the original game keeps its deckplanet art",
);

// The Fusion World payload is the same shape with three differences: bare
// rarity codes, a numeric energy cost, and no images in the bucket.
const fwShaped = shapeCatalog(
  [
    {
      id: 1,
      card_number: "FB07-021",
      card_name: "Vegeta : DA",
      card_type: "BATTLE",
      card_color: "Red",
      card_energy_cost: 5,
      card_power: "30000",
      card_rarity: "SR",
      card_traits: ["Saiyan", "Demon Realm"],
      limited_to: 4,
      variants: [{ id: 2, card_number: "FB07-021_PR", card_rarity: "SR★" }],
    },
    { id: 3, card_number: "E-112", card_name: "Energy Marker", card_type: "ENERGY MARKER", card_rarity: null },
  ] as never,
  "fusion",
);
assert.equal(fwShaped.game, "fusion");
assert.deepEqual(fwShaped.sets.sort(), ["E", "FB07"]);
const vegeta = fwShaped.cards.find((c) => c.id === "FB07-021")!;
assert.equal(vegeta.game, "fusion");
assert.equal(vegeta.energyCost, "5", "a numeric cost is read like a printed one");
assert.equal(vegeta.rarityCode, "SR");
assert.deepEqual(vegeta.traits, ["Saiyan", "Demon Realm"]);
assert.equal(vegeta.imageUrl, null, "Fusion World art comes from the price sync, not deckplanet");
assert.equal(fwShaped.cards.find((c) => c.id === "E-112")!.cardType, "ENERGY MARKER");
assert.deepEqual(
  fwShaped.prints.filter((p) => p.cardId === "FB07-021").map((p) => [p.id, p.rarity]).sort(),
  [
    ["FB07-021", "Super Rare[SR]"],
    ["FB07-021_PR", "Super Rare Alt Art[SR★]"],
  ],
);
assert.ok(fwShaped.prints.every((p) => p.imageUrl === null));

// ── price matching ─────────────────────────────────────────────────────────
const lookup = {
  printIds: new Map([
    ["BT18-020", "BT18-020"],
    ["BT18-020_SPR", "BT18-020_SPR"],
    ["BT6-060_PR", "BT6-060_PR"],
    ["BT6-060", "BT6-060"],
    ["FB07-021", "FB07-021"],
    ["FB07-021_PR", "FB07-021_PR"],
  ]),
  cardIds: new Set(["BT18-020", "BT6-060", "FB07-021"]),
};
assert.equal(markerOf("Omega Shenron (SPR)"), "spr");
assert.equal(markerOf("Plain name"), null);
assert.deepEqual(matchProduct("BT18-020", "Omega Shenron", lookup), { cardId: "BT18-020", printId: "BT18-020" });
assert.deepEqual(matchProduct("BT18-020", "Omega Shenron (SPR)", lookup), { cardId: "BT18-020", printId: "BT18-020_SPR" });
assert.deepEqual(matchProduct("BT6-060_PR", "Whatever", lookup), { cardId: "BT6-060", printId: "BT6-060_PR" });
// Fusion World products match the same way now that its cards are imported;
// TCGplayer's alt-art reprint groups mark the parallel print in the name.
assert.deepEqual(matchProduct("FB07-021", "Vegeta : DA", lookup), { cardId: "FB07-021", printId: "FB07-021" });
assert.deepEqual(matchProduct("FB07-021", "Vegeta : DA (Alternate Art)", lookup), { cardId: "FB07-021", printId: "FB07-021_PR" });
// A number that is in no catalog is still no match.
assert.deepEqual(matchProduct("FB01-001", "Fusion", lookup), { cardId: null, printId: null });
assert.deepEqual(matchProduct(null, "Booster box", lookup), { cardId: null, printId: null });

// ── money ──────────────────────────────────────────────────────────────────
assert.equal(parseEuroInput("1,50"), 150);
assert.equal(parseEuroInput("1.50"), 150);
assert.equal(parseEuroInput("€ 12"), 1200);
assert.equal(parseEuroInput("1.234,56"), 123456);
assert.equal(parseEuroInput(""), null);
assert.match(formatCents(150, "EUR"), /1,50/);
assert.match(formatCents(150, "USD"), /\$1\.50/);

// ── deck lists & legality ──────────────────────────────────────────────────
const parsed = parseDeckList("# Leader\n1 BT18-001\n# Main deck\n4x BT18-020 Omega Shenron\nBT18-021\n# Z-Deck\n2 BT22-116_SPR\njunk line");
assert.deepEqual(parsed, [
  { cardId: "BT18-001", quantity: 1, zone: "leader" },
  { cardId: "BT18-020", quantity: 4, zone: "main" },
  { cardId: "BT18-021", quantity: 1, zone: "main" },
  { cardId: "BT22-116", quantity: 2, zone: "z" },
]);

const row = (cardId: string, zone: DeckCardRow["zone"], quantity: number, extra: Partial<DeckCardRow> = {}): DeckCardRow => ({
  cardId,
  zone,
  quantity,
  name: cardId,
  cardType: zone === "leader" ? "LEADER" : "BATTLE",
  colors: ["Red"],
  energyCost: "3",
  power: 10000,
  rarityCode: "C",
  imageUrl: null,
  backImageUrl: null,
  backName: null,
  limitedTo: 4,
  isBanned: false,
  skill: null,
  characters: [],
  traits: [],
  game: "dbs",
  alloc: { owned: 0, reserved: 0, available: 0 },
  ...extra,
});
const fullMain = [...Array.from({ length: 12 }, (_, i) => row(`M${i}`, "main", 4)), row("M99", "main", 2)];
const legal = legality([row("L", "leader", 1), ...fullMain]);
assert.equal(legal.mainCount, 50);
assert.equal(legal.status, "legal");
assert.deepEqual(legal.issues, []);

// Incomplete: nothing is broken, it just isn't finished — never "illegal".
const wip = legality([row("M1", "main", 4)]);
assert.equal(wip.status, "incomplete");
assert.ok(wip.issues.every((i) => i.severity === "incomplete"));
assert.ok(wip.issues.some((i) => /No leader/.test(i.message)));
assert.ok(wip.issues.some((i) => /46 to go/.test(i.message)));

// Illegal: rules actively broken. All of it is still saveable — only flagged.
const illegal = legality([row("L", "leader", 1), row("L2", "leader", 1), row("M1", "main", 5), row("B", "main", 1, { isBanned: true })]);
assert.equal(illegal.status, "illegal");
assert.ok(illegal.issues.some((i) => i.severity === "illegal" && /2 leaders/.test(i.message)));
assert.ok(illegal.issues.some((i) => /5 copies, limit 4/.test(i.message)));
assert.ok(illegal.issues.some((i) => /banned card/.test(i.message)));
assert.equal(illegal.flags["main:M1"]?.label, "5 copies, limit 4");
assert.equal(illegal.flags["main:B"]?.severity, "illegal");
// 6-1-3 (Masters): the main deck is 50 to 60 cards, so 51 is legal and 61 is not.
const extra = (n: number, tag = "X") => Array.from({ length: Math.ceil(n / 4) }, (_, i) => row(`${tag}${i}`, "main", Math.min(4, n - i * 4)));
assert.equal(legality([row("L", "leader", 1), ...fullMain, ...extra(1)]).status, "legal", "51 cards is legal");
assert.equal(legality([row("L", "leader", 1), ...fullMain, ...extra(10)]).status, "legal", "60 cards is legal");
assert.match(
  legality([row("L", "leader", 1), ...fullMain, ...extra(11)]).issues.find((i) => i.severity === "illegal")!.message,
  /61 cards — 1 over the 60-card maximum/,
);
assert.equal(legality([row("L", "leader", 1), ...fullMain.slice(0, 5)]).status, "incomplete", "under 50 is still incomplete");
// 6-1-4: the Z-Deck holds up to 10.
const zed = (n: number) => Array.from({ length: Math.ceil(n / 4) }, (_, i) => row(`ZZ${i}`, "z", Math.min(4, n - i * 4), { cardType: "Z-BATTLE" }));
assert.equal(legality([row("L", "leader", 1), ...fullMain, ...zed(10)]).status, "legal", "a 10-card Z-Deck is legal");
assert.match(
  legality([row("L", "leader", 1), ...fullMain, ...zed(11)]).issues.find((i) => i.severity === "illegal")!.message,
  /Z-Deck has 11 cards; the maximum is 10/,
);

// A Z-deck card's own limit wins over the default of 4.
assert.equal(legality([row("Z1", "z", 7, { cardType: "Z-BATTLE", limitedTo: 7 })]).flags["z:Z1"], undefined);
assert.equal(legality([row("Z1", "z", 9, { cardType: "Z-BATTLE", limitedTo: 7 })]).flags["z:Z1"]?.label, "9 copies, limit 7");

// Off-colour is a warning: it is shown, but does not by itself make a deck illegal.
const offColour = legality([row("L", "leader", 1), row("B1", "main", 4, { colors: ["Blue"] })]);
assert.equal(offColour.flags["main:B1"]?.severity, "warning");
assert.ok(offColour.issues.some((i) => /off-colour for a Red leader/.test(i.message)));
assert.equal(offColour.status, "incomplete", "an off-colour card is a warning, not an illegal deck");
// Sideboard cards are a scratch zone — no copy limit, no colour rule.
assert.deepEqual(legality([row("L", "leader", 1), ...fullMain, row("S", "side", 9, { colors: ["Blue"] })]).issues, []);

// ── Fusion World deck rules ────────────────────────────────────────────────
// Same shape of deck, three rules that differ: no Z-Deck, colour is a hard
// rule, and a card from the other game can never be played.
const fw = (cardId: string, zone: DeckCardRow["zone"], quantity: number, extra: Partial<DeckCardRow> = {}) =>
  row(cardId, zone, quantity, { game: "fusion", ...extra });
const fwMain = [...Array.from({ length: 12 }, (_, i) => fw(`F${i}`, "main", 4)), fw("F99", "main", 2)];
const fwLegal = legality([fw("FL", "leader", 1), ...fwMain], "fusion");
assert.equal(fwLegal.mainCount, 50);
assert.equal(fwLegal.status, "legal");
assert.deepEqual(fwLegal.issues, []);

// 50–60 is the range here too. Spread over several numbers, or the 4-copy
// limit would be what fails rather than the deck size.
const fwExtra = (n: number) => Array.from({ length: Math.ceil(n / 4) }, (_, i) => fw(`FX${i}`, "main", Math.min(4, n - i * 4)));
assert.equal(legality([fw("FL", "leader", 1), ...fwMain, ...fwExtra(10)], "fusion").status, "legal", "60 cards is legal");
assert.equal(legality([fw("FL", "leader", 1), ...fwMain, ...fwExtra(11)], "fusion").status, "illegal", "61 cards is not");

// Off-colour is illegal in Fusion World, where the original game only warns.
const fwOffColour = legality([fw("FL", "leader", 1), ...fwMain.slice(1), fw("B1", "main", 4, { colors: ["Blue"] })], "fusion");
assert.equal(fwOffColour.flags["main:B1"]?.severity, "illegal");
assert.equal(fwOffColour.status, "illegal", "the leader's colours are enforced, not suggested");

// There is no Z-Deck to put anything in.
const fwZ = legality([fw("FL", "leader", 1), ...fwMain, fw("Z1", "z", 1, { cardType: "BATTLE" })], "fusion");
assert.equal(fwZ.status, "illegal");
assert.ok(fwZ.issues.some((i) => /no Z-Deck/.test(i.message)), "the reason names the missing zone");

// Energy Markers are game pieces, not deck cards.
const fwMarker = legality([fw("FL", "leader", 1), ...fwMain.slice(1), fw("E-112", "main", 4, { cardType: "ENERGY MARKER" })], "fusion");
assert.equal(fwMarker.flags["main:E-112"]?.severity, "illegal");
assert.match(fwMarker.flags["main:E-112"]!.label, /not deck cards/);

// A card from the other game is flagged, never silently dropped.
const mixed = legality([fw("FL", "leader", 1), ...fwMain.slice(1), row("BT18-020", "main", 4)], "fusion");
assert.equal(mixed.flags["main:BT18-020"]?.severity, "illegal");
assert.match(mixed.flags["main:BT18-020"]!.label, /Super card in a Fusion World deck/);
// …and the same the other way round.
const mixedBack = legality([row("L", "leader", 1), ...fullMain.slice(1), fw("FB07-021", "main", 4)]);
assert.match(mixedBack.flags["main:FB07-021"]!.label, /Fusion World card in a Super deck/);
// A mismatched card is reported once, as the wrong game — not also as off-colour.
assert.equal(mixed.issues.filter((i) => i.cardId === "BT18-020").length, 1);


// ── Deck-building rules printed on the cards themselves ───────────────────
const DB_TEXT =
  "[Dragon Ball] (You can include as many copies of cards with [Dragon Ball] in your deck as you like, as long as the total number doesn't exceed 7.) [Activate: Main] Draw 1 card.";
const SC_TEXT = "[Super Combo] (You can only include up to 4 cards with [Super Combo] in your deck.) [Auto] Something.";
assert.deepEqual(parseDeckRules(DB_TEXT), [{ keyword: "Dragon Ball", max: 7, unlimitedCopies: true }]);
assert.deepEqual(parseDeckRules(SC_TEXT), [{ keyword: "Super Combo", max: 4, unlimitedCopies: false }]);
// The reminder text is printed in lower case on some cards.
assert.deepEqual(parseDeckRules("[super combo] (You can only include up to 4 cards with [super combo] in your deck"), [
  { keyword: "Super Combo", max: 4, unlimitedCopies: false },
]);
// Carrying a keyword means printing it as a leading tag. Merely naming one in
// a sentence does not — Bulma (BT5-107) fetches Dragon Balls but is not one,
// and the SD7 Shenron leader counts them in the Drop without carrying it.
assert.deepEqual(leadingTags(DB_TEXT), ["Dragon Ball"]);
assert.deepEqual(leadingTags("[Activate: Main][Once per turn] Choose up to 1 [Dragon Ball] card from your deck."), ["Activate: Main", "Once per turn"]);
assert.deepEqual(leadingTags("[Permanent] This card can't attack.[br][Wish] When there are 7 [Dragon Ball] cards in your Drop:"), ["Permanent", "Wish"]);
assert.deepEqual(rulesFor([{ skill: "Choose up to 1 [Dragon Ball] card from your deck." }]), []);
assert.equal(hasKeyword({ skill: "[Activate: Main] Add 1 [Dragon Ball] card to your hand." }, "Dragon Ball"), false);

/** n main-deck cards spread over legal 4-copy rows. */
const fill = (n: number) => Array.from({ length: Math.ceil(n / 4) }, (_, i) => row(`F${i}`, "main", Math.min(4, n - i * 4)));
const ball = (n: number) => row("BALL", "main", n, { skill: DB_TEXT });
// Six copies of one Dragon Ball is legal — the ordinary 4-copy cap is waived.
const sixBalls = legality([row("L", "leader", 1), ball(6), ...fill(44)]);
assert.equal(sixBalls.status, "legal", JSON.stringify(sixBalls.issues));
assert.deepEqual(sixBalls.keywordRules, [{ keyword: "Dragon Ball", max: 7, used: 6, unlimitedCopies: true }]);
// Eight breaks the pooled limit.
const eightBalls = legality([row("L", "leader", 1), ball(8), ...fill(42)]);
assert.equal(eightBalls.status, "illegal");
assert.ok(eightBalls.issues.some((i) => /8 \[Dragon Ball\] cards/.test(i.message)), JSON.stringify(eightBalls.issues));
// The rule applies even when the card carries the keyword without restating it.
const quiet = legality([row("L", "leader", 1), row("BALL", "main", 8, { skill: "[Dragon Ball][Activate: Main] Draw 1 card." }), ...fill(42)]);
assert.equal(quiet.status, "illegal");
// A leader that only counts Dragon Balls is not itself one.
const searcher = legality([
  row("L", "leader", 1, { skill: "[Wish] When there are 7 [Dragon Ball] cards in your Drop: draw." }),
  ball(6),
  row("BULMA", "main", 4, { skill: "[Activate: Main] Choose up to 1 [Dragon Ball] card from your deck." }),
  ...fill(40),
]);
assert.equal(searcher.status, "legal", JSON.stringify(searcher.issues));
assert.deepEqual(searcher.keywordRules, [{ keyword: "Dragon Ball", max: 7, used: 6, unlimitedCopies: true }]);
// [Super Combo] is a pooled 4 across *different* cards.
const combos = legality([
  row("L", "leader", 1),
  row("SC1", "main", 3, { skill: SC_TEXT }),
  row("SC2", "main", 3, { skill: SC_TEXT }),
  ...fill(44),
]);
assert.equal(combos.status, "illegal");
assert.ok(combos.issues.some((i) => /6 \[Super Combo\] cards/.test(i.message)));
assert.equal(legality([row("L", "leader", 1), row("SC1", "main", 4, { skill: SC_TEXT }), ...fill(46)]).status, "legal");

// ── CardTrader collector numbers ──────────────────────────────────────────
const bp = (n: string | null) => ({ id: 1, name: "x", game_id: 9, expansion_id: 1, fixed_properties: n == null ? {} : { collector_number: n } });
assert.deepEqual(collectorNumbers(bp("BT14-113"), "bt14"), ["BT14-113"]);
assert.deepEqual(collectorNumbers(bp("049"), "bt3"), ["BT3-049", "BT3-49"]);
assert.deepEqual(collectorNumbers(bp("003"), "sd3"), ["SD3-003", "SD3-03"]);
assert.deepEqual(collectorNumbers(bp("094"), "tb01"), ["TB01-094", "TB01-94", "TB1-094", "TB1-94"]);
assert.deepEqual(collectorNumbers(bp("16"), "ex01"), ["EX01-16", "EX1-16"]);
assert.deepEqual(collectorNumbers(bp(null), "bt3"), []);
// ── Claude deck drafts are sanitised, never trusted ───────────────────────
const poolCard = (id: string, owned: number, extra: Partial<PoolCard> = {}): PoolCard => ({
  id,
  name: id,
  cardType: "BATTLE",
  colors: ["Yellow"],
  energyCost: "3",
  power: 10000,
  skill: null,
  traits: [],
  rarityCode: "C",
  limitedTo: 4,
  owned,
  ...extra,
});
const pool = new Map([
  ["BT31-059", poolCard("BT31-059", 3)],
  ["BT31-060", poolCard("BT31-060", 0)],
  ["BT31-061", poolCard("BT31-061", 4, { limitedTo: 1 })],
  ["BT31-090", poolCard("BT31-090", 0, { cardType: "Z-BATTLE" })],
]);
const draft = sanitiseDraft(
  {
    name: "x",
    strategy: "y",
    main: [
      { cardId: "bt31-059_spr", quantity: 4 }, // case + print suffix normalised
      { cardId: "BT31-060", quantity: 2 },
      { cardId: "BT31-061", quantity: 4 }, // limited to 1
      { cardId: "BT31-090", quantity: 2 }, // Z card in main → dropped
      { cardId: "BT99-999", quantity: 4 }, // not in pool → dropped
    ],
    zDeck: [{ cardId: "BT31-090", quantity: 2 }],
    purchases: [],
  },
  pool,
);
assert.deepEqual(draft.main, [
  { cardId: "BT31-059", quantity: 4, owned: 3, needToBuy: 1 },
  { cardId: "BT31-060", quantity: 2, owned: 0, needToBuy: 2 },
  { cardId: "BT31-061", quantity: 1, owned: 4, needToBuy: 0 },
]);
assert.deepEqual(draft.z, [{ cardId: "BT31-090", quantity: 2, owned: 0, needToBuy: 2 }]);
assert.deepEqual(draft.dropped, ["BT31-090", "BT99-999"]);
assert.equal(draft.mainCount, 7);

// ── scan matching ─────────────────────────────────────────────────────────
assert.equal(normaliseNumber("bt18 020"), "BT18-020");
assert.equal(normaliseNumber("BT18–020"), "BT18-020", "en dash");
assert.equal(normaliseNumber("BT18-020 SPR"), "BT18-020_SPR");
assert.equal(normaliseNumber("P-181"), "P-181");
assert.equal(normaliseNumber("BT1O-O2O"), "BT10-020", "O read as 0 after the prefix");
assert.equal(normaliseNumber(null), null);
// Fusion World numbers off a photo: two-digit starter decks, a bare-prefix
// promo, and the Energy Marker sets.
assert.equal(normaliseNumber("fb07 021"), "FB07-021");
assert.equal(normaliseNumber("FS01-01"), "FS01-01");
assert.equal(normaliseNumber("FP 060"), "FP-060");
assert.equal(normaliseNumber("ST01-014"), "ST01-014");
assert.equal(normaliseNumber("E01-03"), "E01-03");
assert.equal(normaliseNumber("E 112"), "E-112");
// A set code that ends in digits is still read as one, dash or no dash.
assert.equal(normaliseNumber("E0103"), "E01-03");
// The bare-prefix rule must not steal digits from a set that numbers itself.
assert.equal(normaliseNumber("XD101"), "XD1-01");
assert.equal(normaliseNumber("P181"), "P-181", "'P1-81' is not a set");
assert.equal(nameSimilarity("Son Goku, Hope of Universe 7", "Son Goku Hope of Universe 7"), 1);
assert.equal(nameSimilarity("Son Goku", "Vegeta"), 0);
const seen = { name: "Omega Shenron", confidence: 0.9 };
assert.deepEqual(assessMatch(seen, { name: "Omega Shenron" }, true), { matchedBy: "number", confidence: 0.9, nameSimilarity: 1 });
assert.equal(assessMatch(seen, { name: "Vegeta, Prince of Pride" }, true).matchedBy, "number-name-differs");
assert.equal(assessMatch(seen, { name: "Vegeta, Prince of Pride" }, true).confidence, 0.45, "number matched but name disagrees: halved");
assert.equal(assessMatch(seen, { name: "Omega Shenron" }, false).matchedBy, "name");
assert.equal(assessMatch(seen, { name: "Omega Shenron" }, false).confidence, 0.54, "name-only match is capped");
assert.equal(assessMatch(seen, { name: "Omega Shenron, Ultimate Shadow Dragon Form" }, false).confidence, 0.36, "weak name match is capped harder");
assert.deepEqual(assessMatch(seen, null, false), { matchedBy: null, confidence: 0, nameSimilarity: 0 });
assert.deepEqual(cleanBox({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 }), { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
assert.deepEqual(cleanBox({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }), { x: 0.9, y: 0.9, w: 0.1, h: 0.1 }, "clamped to the image");
assert.equal(cleanBox({ x: 0.5, y: 0.5, w: 0.001, h: 0.5 }), null, "degenerate boxes are dropped");
assert.equal(cleanBox(null), null);

// ── spoken card numbers ───────────────────────────────────────────────────
assert.equal(normaliseSpeech("BT eighteen dash zero twenty"), "bt 18 0 20");
assert.equal(normaliseSpeech("twenty two"), "22", "tens + ones combine");
// "card" survives normalisation — it separates a count from its finish
// ("1 card foiled") — and is dropped later, once the finishes are read off.
assert.equal(normaliseSpeech("card number P one eighty one"), "card p 1 81");
assert.deepEqual(parseSpoken("card number P one eighty one").options[0], { cardId: "P-181", foil: 0, normal: 1 });

const opts = (s: string) => parseSpoken(s).options;
const has = (s: string, cardId: string, normal: number, foil = 0) => opts(s).some((o) => o.cardId === cardId && o.normal === normal && o.foil === foil);

// The reading the catalog will accept has to be offered first.
assert.deepEqual(opts("BT eighteen zero twenty")[0], { cardId: "BT18-020", foil: 0, normal: 1 });
assert.deepEqual(opts("bt 18 020 times 4")[0], { cardId: "BT18-020", foil: 0, normal: 4 });
assert.deepEqual(opts("sd twenty two zero two")[0], { cardId: "SD22-02", foil: 0, normal: 1 });
assert.deepEqual(opts("p one eighty one")[0], { cardId: "P-181", foil: 0, normal: 1 });
// Spelled-out prefixes and digit-by-digit dictation still reach the same card.
assert.ok(has("b t one eight zero two zero", "BT18-020", 1), "letters spelled out, digits one by one");
// A trailing count is only *one* of the readings — the real card decides.
assert.ok(has("bt 18 020 4", "BT18-020", 4), "trailing number can be the quantity");
assert.ok(has("bt 18 020 4", "BT18-0204", 1), "…but the all-digits reading is offered first");
assert.ok(opts("bt 18 020 4").findIndex((o) => o.cardId === "BT18-0204") < opts("bt 18 020 4").findIndex((o) => o.cardId === "BT18-020" && o.normal === 4));

// Finish counts spoken after the number — and their digits are not card digits.
assert.deepEqual(opts("bt 18 020 one card foiled three cards non foil")[0], { cardId: "BT18-020", foil: 1, normal: 3 });
assert.deepEqual(opts("bt 18 020 three cards non-foil one card foiled")[0], { cardId: "BT18-020", foil: 1, normal: 3 }, "either order");
assert.deepEqual(opts("bt 18 020 2 foils")[0], { cardId: "BT18-020", foil: 2, normal: 0 });
assert.deepEqual(opts("bt 18 020 foil")[0], { cardId: "BT18-020", foil: 1, normal: 0 }, "bare 'foil' means one");
assert.deepEqual(opts("bt 18 020 non foil")[0], { cardId: "BT18-020", foil: 0, normal: 1 }, "'non foil' is not read as a foil");
assert.deepEqual(opts("sd twenty two zero two 1 foiled")[0], { cardId: "SD22-02", foil: 1, normal: 0 });
// "…twenty one card foiled": the "one" starts the count, so the card is -020.
assert.deepEqual(opts("bt eighteen zero twenty one card foiled three cards non foil")[0], { cardId: "BT18-020", foil: 1, normal: 3 });
// …but a plural really is twenty-one of them.
assert.deepEqual(opts("bt 18 020 twenty one cards non foil")[0], { cardId: "BT18-020", foil: 0, normal: 21 });

// Words with no number in them fall through to the name search.
assert.deepEqual(opts("son goku"), []);
assert.equal(parseSpoken("son goku times 3").query, "son goku");
assert.deepEqual(spokenQuantity("son goku times 3"), { foil: 0, normal: 3 });
assert.deepEqual(spokenQuantity("son goku 2 foils"), { foil: 2, normal: 0 });
assert.deepEqual(spokenQuantity("bt 18 020"), { foil: 0, normal: 1 });

// ── Basic Auth username → lot owner ───────────────────────────────────────
assert.equal(parseBasicUser(`Basic ${Buffer.from("patvolny:Drag0nball!").toString("base64")}`), "patvolny");
assert.equal(parseBasicUser(`Basic ${Buffer.from("a:b:c").toString("base64")}`), "a", "only the part before the first colon");
assert.equal(parseBasicUser("Bearer xyz"), null);
assert.equal(parseBasicUser(null), null);
// A password may itself contain colons; only the first one separates.
assert.deepEqual(parseBasicAuth(`Basic ${Buffer.from("anna:p:a:ss").toString("base64")}`), { username: "anna", password: "p:a:ss" });
assert.equal(parseBasicAuth("Basic not-base64!!"), null);

// ── stored passwords ──────────────────────────────────────────────────────
const stored = hashPassword("correct horse battery");
assert.match(stored, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/, "salt and key are stored, never the password");
assert.ok(verifyPassword("correct horse battery", stored));
assert.ok(!verifyPassword("Correct horse battery", stored), "case matters");
assert.ok(!verifyPassword("", stored));
assert.notEqual(hashPassword("same"), hashPassword("same"), "a fresh salt every time");
assert.ok(!verifyPassword("anything", "not-a-hash"), "a malformed hash never authenticates");
assert.equal(passwordProblem("short"), "Use at least 8 characters.");
assert.equal(passwordProblem("long enough"), null);
assert.equal(usernameProblem("a"), "2–32 characters: letters, digits, dot, dash or underscore.");
assert.equal(usernameProblem("anna.k"), null);
assert.ok(usernameProblem("has space"), "spaces are rejected");

// ── cart optimiser ─────────────────────────────────────────────────────────
const L = (seller: string, card: string, price: number, qty = 4, shipping = 300): Listing => ({
  id: `${seller}-${card}`,
  seller,
  cardId: card,
  priceCents: price,
  quantity: qty,
  shippingCents: shipping,
  country: "DE",
});
// One seller has everything cheaply once shipping is counted.
const plan = greedyOptimise(
  [{ cardId: "A", quantity: 2 }, { cardId: "B", quantity: 1 }],
  [L("s1", "A", 100), L("s1", "B", 100), L("s2", "A", 50, 4, 400), L("s3", "B", 10, 1, 500)],
);
assert.equal(plan.missing.length, 0);
assert.equal(plan.sellers.length, 1, "shipping makes the single seller cheaper");
assert.equal(plan.sellers[0].seller, "s1");
assert.equal(plan.totalCents, 300 + 300); // 2×100 + 1×100 + one shipping fee
// Stock limits are respected and shortfalls reported.
const short = greedyOptimise([{ cardId: "A", quantity: 3 }], [L("s1", "A", 100, 2)]);
assert.equal(short.missing[0]?.cardId, "A");
assert.equal(short.missing[0]?.quantity, 1);

// ── image ⇄ list view toggle ───────────────────────────────────────────────
assert.equal(parseViewMode("list"), "list");
assert.equal(parseViewMode("grid"), "grid");
assert.equal(parseViewMode(undefined), "grid", "grid is the default everywhere");
assert.equal(parseViewMode("gallery"), "grid", "an unknown value is not an error");
assert.equal(parseViewMode(undefined, "list"), "list");
// Filters survive the switch; the default view drops out of the URL.
assert.equal(viewHref("/collection", { q: "goku", set: "BT18" }, "list"), "/collection?q=goku&set=BT18&view=list");
assert.equal(viewHref("/collection", { q: "goku", view: "list" }, "grid"), "/collection?q=goku");
assert.equal(viewHref("/cards", { q: undefined, set: "" }, "grid"), "/cards");

console.log("verify-rules: all checks passed");
