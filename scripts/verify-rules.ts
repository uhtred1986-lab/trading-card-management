/**
 * Pure-function checks — no database, no network. Run with `tsx`.
 */
import assert from "node:assert/strict";
import { baseNumber, printLabel, printSuffix, shapeCatalog } from "../src/lib/catalog/deckplanet";
import { setCodeOfNumber, setLineFor, setNameFor } from "../src/lib/catalog/sets";
import { legality, parseDeckList, type DeckCardRow } from "../src/lib/decks/queries";
import { formatCents, parseEuroInput } from "../src/lib/money";
import { markerOf, matchProduct } from "../src/lib/pricing/tcgcsv";
import { greedyOptimise, type Listing } from "../src/lib/marketplace/optimizer";
import { parseBasicUser } from "../src/lib/auth";
import { normaliseSpeech, parseSpoken, spokenQuantity } from "../src/lib/scan/voice";
import { collectorNumbers } from "../src/lib/marketplace/cardtrader";
import { sanitiseDraft, type PoolCard } from "../src/lib/ai/deck-builder";
import { assessMatch, cleanBox, nameSimilarity, normaliseNumber } from "../src/lib/ai/scan-match";

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

// ── price matching ─────────────────────────────────────────────────────────
const lookup = {
  printIds: new Map([
    ["BT18-020", "BT18-020"],
    ["BT18-020_SPR", "BT18-020_SPR"],
    ["BT6-060_PR", "BT6-060_PR"],
    ["BT6-060", "BT6-060"],
  ]),
  cardIds: new Set(["BT18-020", "BT6-060"]),
};
assert.equal(markerOf("Omega Shenron (SPR)"), "spr");
assert.equal(markerOf("Plain name"), null);
assert.deepEqual(matchProduct("BT18-020", "Omega Shenron", lookup), { cardId: "BT18-020", printId: "BT18-020" });
assert.deepEqual(matchProduct("BT18-020", "Omega Shenron (SPR)", lookup), { cardId: "BT18-020", printId: "BT18-020_SPR" });
assert.deepEqual(matchProduct("BT6-060_PR", "Whatever", lookup), { cardId: "BT6-060", printId: "BT6-060_PR" });
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
assert.equal(legality([row("L", "leader", 1), ...fullMain, row("X", "main", 1)]).status, "illegal", "51 cards is illegal, 49 is incomplete");

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
assert.equal(normaliseSpeech("card number P one eighty one"), "p 1 81");

const opts = (s: string) => parseSpoken(s).options;
const has = (s: string, cardId: string, quantity: number) => opts(s).some((o) => o.cardId === cardId && o.quantity === quantity);

// The reading the catalog will accept has to be offered first.
assert.deepEqual(opts("BT eighteen zero twenty")[0], { cardId: "BT18-020", quantity: 1 });
assert.deepEqual(opts("bt 18 020 times 4")[0], { cardId: "BT18-020", quantity: 4 });
assert.deepEqual(opts("sd twenty two zero two")[0], { cardId: "SD22-02", quantity: 1 });
assert.deepEqual(opts("p one eighty one")[0], { cardId: "P-181", quantity: 1 });
// Spelled-out prefixes and digit-by-digit dictation still reach the same card.
assert.ok(has("b t one eight zero two zero", "BT18-020", 1), "letters spelled out, digits one by one");
// A trailing count is only *one* of the readings — the real card decides.
assert.ok(has("bt 18 020 4", "BT18-020", 4), "trailing number can be the quantity");
assert.ok(has("bt 18 020 4", "BT18-0204", 1), "…but the all-digits reading is offered first");
assert.ok(opts("bt 18 020 4").findIndex((o) => o.cardId === "BT18-0204") < opts("bt 18 020 4").findIndex((o) => o.cardId === "BT18-020" && o.quantity === 4));
// Words with no number in them fall through to the name search.
assert.deepEqual(opts("son goku"), []);
assert.equal(parseSpoken("son goku times 3").query, "son goku");
assert.equal(spokenQuantity("son goku times 3"), 3);
assert.equal(spokenQuantity("bt 18 020"), 1);

// ── Basic Auth username → lot owner ───────────────────────────────────────
assert.equal(parseBasicUser(`Basic ${Buffer.from("patvolny:Drag0nball!").toString("base64")}`), "patvolny");
assert.equal(parseBasicUser(`Basic ${Buffer.from("a:b:c").toString("base64")}`), "a", "only the part before the first colon");
assert.equal(parseBasicUser("Bearer xyz"), null);
assert.equal(parseBasicUser(null), null);

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

console.log("verify-rules: all checks passed");
