/**
 * Pure-function checks — no database, no network. Run with `tsx`.
 */
import assert from "node:assert/strict";
import { baseNumber, normaliseRarity, printLabel, printSuffix, shapeCatalog } from "../src/lib/catalog/deckplanet";
import { applyMastersLeaderImages, applyOfficialImages, mastersImageUrl, mastersLeaderCandidates, officialBackImageName, officialImageName, officialImageUrl, parseImageNames, parseSeriesIds } from "../src/lib/catalog/bandai";
import { correctSkillText } from "../src/lib/catalog/errata";
import { gameOfNumber, gameOfSetCode, setCodeOfNumber, setLineFor, setNameFor } from "../src/lib/catalog/sets";
import { legality, parseDeckList, type DeckCardRow } from "../src/lib/decks/queries";
import { hasKeyword, leadingTags, matchesCardFilter, parseDeckBuilding, parseDeckRules, rulesFor, type DeckBuildingRule, type DeckCardFacts, type DeckCardFilter } from "../src/lib/decks/cardRules";
import { formatCents, parseEuroInput } from "../src/lib/money";
import { markerOf, matchProduct } from "../src/lib/pricing/tcgcsv";
import { greedyOptimise, type Listing } from "../src/lib/marketplace/optimizer";
import { parseBasicAuth, parseBasicUser } from "../src/lib/auth-header";
import { hashPassword, passwordProblem, usernameProblem, verifyPassword } from "../src/lib/auth/password";
import { normaliseSpeech, parseSpoken, spokenQuantity } from "../src/lib/scan/voice";
import { collectorNumbers } from "../src/lib/marketplace/cardtrader";
import { sanitiseDraft, type PoolCard } from "../src/lib/ai/deck-builder";
import { assessMatch, cleanBox, nameSimilarity, needsOpusFallback, normaliseNumber } from "../src/lib/ai/scan-match";
import { parseViewMode, viewHref } from "../src/lib/view-mode";
import { needsInstall } from "./session-start-check.mjs";
import { shouldSkipBuild, isDocsOnlyChange, changedFiles } from "./vercel-ignore-build.mjs";
import { shouldMigrate } from "./vercel-build.mjs";
import { parseSpecifiedCost, printSpecifiedCost, specifiedCostWords, staleSpecifiedCosts } from "../src/lib/arena/specified-cost";
import { cardDefFrom } from "../src/lib/arena/load";
import { groupPreview, type DeckPreviewCard } from "../src/lib/arena/deck-preview";
import { defaultHealth, legacyQueueUrl, neighbours, parseQueue, queueHref, queueLink, reasonOf } from "../src/lib/arena/queue";
import { parseSkills, specifiedCostOf, specifiedCostUnknown } from "../src/lib/arena/text/cards";
import { describeTrigger, triggersOf } from "../src/lib/arena/gaps";
import { compileSkill } from "../src/lib/arena/compile";
import { cardImage, cardImageSizeFor } from "../src/lib/catalog/card-image";
import { deepEqual, parseRule, printRule, unreadFilterWords } from "../src/lib/arena/lang";
import { parseFilter } from "../src/lib/arena/text/filters";

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

// ── typos in the source's card text ────────────────────────────────────────
// A keyword run up against the word before it, which BT31 prints repeatedly.
assert.equal(correctSkillText("BT31-141", "Play 2 Cell Jr. Tokens and they gain[Blocker] for the turn."), "Play 2 Cell Jr. Tokens and they gain [Blocker] for the turn.");
assert.equal(correctSkillText("BT31-135", "You can activate this card's[Counter] skill"), "You can activate this card's [Counter] skill");
// `[/em]` and `[/li]` are markup and legitimately follow a letter: leave them.
assert.equal(correctSkillText("FB09-072", "An energy marker placed under a card[/em])"), "An energy marker placed under a card[/em])");
assert.equal(correctSkillText("P-749", "Switch that card to Rest Mode[/li] [li] Negate"), "Switch that card to Rest Mode[/li] [li] Negate");
// A per-card correction, and the same text left alone on a different card.
assert.equal(correctSkillText("BT31-094", "[auto] Whe this card attacks, draw 1 card."), "[auto] When this card attacks, draw 1 card.");
assert.equal(correctSkillText("BT1-001", "[auto] Whe this card attacks, draw 1 card."), "[auto] Whe this card attacks, draw 1 card.");
// Correcting twice is correcting once — the sync may reshape a row it already wrote.
const onceFixed = correctSkillText("BT31-150", "when your opponent's card is plyed, they can't play it")!;
assert.equal(onceFixed, "when your opponent's card is played, they can't play it");
assert.equal(correctSkillText("BT31-150", onceFixed), onceFixed);
assert.equal(correctSkillText("BT31-150", null), null);

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
  shaped.prints
    .filter((p) => p.cardId === "BT18-020")
    .map((p) => p.id)
    .sort(),
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
assert.equal(vegeta.imageUrl, null, "Fusion World art comes from Bandai (below) or the price sync, not deckplanet");
assert.equal(fwShaped.cards.find((c) => c.id === "E-112")!.cardType, "ENERGY MARKER");
assert.deepEqual(
  fwShaped.prints
    .filter((p) => p.cardId === "FB07-021")
    .map((p) => [p.id, p.rarity])
    .sort(),
  [
    ["FB07-021", "Super Rare[SR]"],
    ["FB07-021_PR", "Super Rare Alt Art[SR★]"],
  ],
);
assert.ok(fwShaped.prints.every((p) => p.imageUrl === null));

// ── Fusion World art from Bandai's card list ───────────────────────────────
// The crawl gives the exact set of image names; only names in it become URLs.
const names = new Set(["FB07-021", "FB07-021_p1", "FB01-001_f", "FB01-001_b", "FB01-001_f_p1", "E-112"]);
assert.equal(officialImageName("FB07-021", "", names), "FB07-021");
assert.equal(officialImageName("FB07-021", "PR", names), "FB07-021_p1", "deckplanet's _PR is Bandai's _p1");
assert.equal(officialImageName("FB07-021", "PR2", names), null, "a print Bandai does not show gets no URL");
assert.equal(officialImageName("FB01-001", "", names), "FB01-001_f", "leaders carry _f for the front");
assert.equal(officialImageName("FB01-001", "PR", names), "FB01-001_f_p1", "a leader's alt print is _f_p1");
assert.equal(officialImageName("FB01-001", "SPR", names), null, "an unknown suffix is never guessed");
assert.equal(officialBackImageName("FB01-001", names), "FB01-001_b");
assert.equal(officialBackImageName("FB07-021", names), null);
assert.equal(officialImageUrl("FB01-001_f"), "https://www.dbs-cardgame.com/fw/images/cards/card/en/FB01-001_f.webp");
assert.deepEqual(parseSeriesIds('<li><a data-val="" class="">ALL</a></li><li><a data-val="583011">FB11</a></li><li><a data-val="583001">FB01</a></li><li><a data-val="583011">dup</a></li>'), [
  "583011",
  "583001",
]);
assert.deepEqual(parseImageNames('<img data-src="../../images/cards/card/en/FB11-001_f.webp"><img src="../../images/cards/card/en/FB11-002_p1.webp">'), ["FB11-001_f", "FB11-002_p1"]);
{
  const applied = applyOfficialImages(fwShaped, names);
  assert.deepEqual(applied, { prints: 3, cards: 2, backs: 0 });
  const byId = new Map(fwShaped.prints.map((p) => [p.id, p.imageUrl]));
  assert.equal(byId.get("FB07-021"), officialImageUrl("FB07-021"));
  assert.equal(byId.get("FB07-021_PR"), officialImageUrl("FB07-021_p1"));
  assert.equal(fwShaped.cards.find((c) => c.id === "FB07-021")!.imageUrl, officialImageUrl("FB07-021"), "the card shows its base print");
  assert.equal(fwShaped.cards.find((c) => c.id === "E-112")!.imageUrl, officialImageUrl("E-112"));
  assert.deepEqual(applyOfficialImages(shaped, names), { prints: 0, cards: 0, backs: 0 }, "the original game is never touched");
  assert.ok(shaped.cards.every((c) => c.imageUrl?.startsWith("https://storage.googleapis.com/")));
}

// ── The original game's leaders from Bandai's card list ───────────────────
// deckplanet's bucket has no art from BT19 on, and TCGplayer's photo of a
// leader is its awakened side, so Bandai's card list supplies both faces.
{
  const dp = shapeCatalog([
    { id: 10, card_number: "BT24-055", card_name: "Son Goku", card_back_name: "SS Son Goku, Beginning of a Legend", card_type: "LEADER", card_rarity: "Uncommon[UC]", img_link: "BT24-055", variants: [{ id: 13, card_number: "BT24-055_PR", img_link: "BT24-055_PR" }] },
    { id: 11, card_number: "BT1-001", card_name: "Son Goku", card_back_name: "Kaio-Ken Son Goku", card_type: "LEADER", card_rarity: "Uncommon[UC]", img_link: "BT1-001", variants: [] },
    { id: 12, card_number: "BT24-010", card_name: "Vegeta", card_type: "BATTLE", card_rarity: "Common[C]", img_link: "BT24-010", variants: [] },
  ] as never);
  const card = (id: string) => dp.cards.find((c) => c.id === id)!;
  const print = (id: string) => dp.prints.find((p) => p.id === id)!;
  assert.equal(card("BT24-055").backImageUrl, "https://storage.googleapis.com/deckplanet_card_images/BT24-055_b.png", "the shaper guesses deckplanet's back");
  // What verifyFrontImages/verifyBackImages leave when deckplanet 404s: both
  // faces of the BT24 leader, its prints, and the BT24 battle card's front.
  card("BT24-055").imageUrl = null;
  card("BT24-055").backImageUrl = null;
  print("BT24-055").imageUrl = null;
  print("BT24-055_PR").imageUrl = null;
  card("BT24-010").imageUrl = null;
  print("BT24-010").imageUrl = null;

  assert.equal(mastersImageUrl("BT24-055_b"), "https://www.dbs-cardgame.com/images/cardlist/cardimg/BT24-055_b.png");
  assert.deepEqual(mastersLeaderCandidates(dp), [mastersImageUrl("BT24-055"), mastersImageUrl("BT24-055_b")], "only a leader's missing faces are looked up");
  assert.deepEqual(mastersLeaderCandidates(fwShaped), [], "Fusion World has its own Bandai source");

  // Only what the HEAD check confirmed is laid on: here, the front alone.
  assert.deepEqual(applyMastersLeaderImages(dp, new Set([mastersImageUrl("BT24-055")])), { fronts: 1, backs: 0 });
  assert.equal(card("BT24-055").imageUrl, mastersImageUrl("BT24-055"));
  assert.equal(print("BT24-055").imageUrl, mastersImageUrl("BT24-055"), "the base print shows the same front");
  assert.equal(print("BT24-055_PR").imageUrl, null, "an alternate print's name is never guessed");
  assert.equal(card("BT24-055").backImageUrl, null, "a back that did not resolve stays empty for the backfills");
  assert.equal(card("BT24-010").imageUrl, null, "a one-sided card is left to the TCGplayer photo");
  assert.equal(card("BT1-001").imageUrl, "https://storage.googleapis.com/deckplanet_card_images/BT1-001.png", "deckplanet's art is kept where it exists");

  assert.deepEqual(applyMastersLeaderImages(dp, new Set([mastersImageUrl("BT24-055_b")])), { fronts: 0, backs: 1 });
  assert.equal(card("BT24-055").backImageUrl, mastersImageUrl("BT24-055_b"));
  assert.deepEqual(mastersLeaderCandidates(dp), [], "nothing is left to look up");
}

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
  backSkill: null,
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
assert.match(legality([row("L", "leader", 1), ...fullMain, ...extra(11)]).issues.find((i) => i.severity === "illegal")!.message, /61 cards — 1 over the 60-card maximum/);
assert.equal(legality([row("L", "leader", 1), ...fullMain.slice(0, 5)]).status, "incomplete", "under 50 is still incomplete");
// 6-1-4: the Z-Deck holds up to 10.
const zed = (n: number) => Array.from({ length: Math.ceil(n / 4) }, (_, i) => row(`ZZ${i}`, "z", Math.min(4, n - i * 4), { cardType: "Z-BATTLE" }));
assert.equal(legality([row("L", "leader", 1), ...fullMain, ...zed(10)]).status, "legal", "a 10-card Z-Deck is legal");
assert.match(legality([row("L", "leader", 1), ...fullMain, ...zed(11)]).issues.find((i) => i.severity === "illegal")!.message, /Z-Deck has 11 cards; the maximum is 10/);

// A Z-deck card's own limit wins over the default of 4.
assert.equal(legality([row("Z1", "z", 7, { cardType: "Z-BATTLE", limitedTo: 7 })]).flags["z:Z1"], undefined);
assert.equal(legality([row("Z1", "z", 9, { cardType: "Z-BATTLE", limitedTo: 7 })]).flags["z:Z1"]?.label, "9 copies, limit 7");
// 6-1-3/6-1-4 and 14-1-3: Z-Cards are not main-deck cards, and Z-Leaders
// belong in the Z-Deck rather than being mistaken for ordinary Leaders.
const zInMain = legality([row("L", "leader", 1), ...fullMain, row("ZM", "main", 1, { cardType: "Z-BATTLE" })]);
assert.equal(zInMain.flags["main:ZM"]?.label, "Z-Cards belong in the Z-Deck");
const nonZInZ = legality([row("B1", "z", 1, { cardType: "BATTLE" })]);
assert.equal(nonZInZ.flags["z:B1"]?.label, "only Z- cards go in the Z-Deck");
const zLeaderInZ = legality([row("L", "leader", 1), ...fullMain, row("ZL", "z", 1, { cardType: "Z-LEADER" })]);
assert.equal(zLeaderInZ.flags["z:ZL"], undefined, "Z-LEADER is a Z-Card, not an ordinary Leader slot card");
const zLeaderInLeader = legality([row("ZL", "leader", 1, { cardType: "Z-LEADER" })]);
assert.equal(zLeaderInLeader.flags["leader:ZL"]?.label, "not a Leader card");

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
const fw = (cardId: string, zone: DeckCardRow["zone"], quantity: number, extra: Partial<DeckCardRow> = {}) => row(cardId, zone, quantity, { game: "fusion", ...extra });
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
assert.ok(
  fwZ.issues.some((i) => /no Z-Deck/.test(i.message)),
  "the reason names the missing zone",
);

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
const DB_TEXT = "[Dragon Ball] (You can include as many copies of cards with [Dragon Ball] in your deck as you like, as long as the total number doesn't exceed 7.) [Activate: Main] Draw 1 card.";
const SC_TEXT = "[Super Combo] (You can only include up to 4 cards with [Super Combo] in your deck.) [Auto] Something.";
const ULT_TEXT = "[Ultimate] [Auto] Something.";
assert.deepEqual(parseDeckRules(DB_TEXT), [{ keyword: "Dragon Ball", max: 7, unlimitedCopies: true }]);
assert.deepEqual(parseDeckRules(SC_TEXT), [{ keyword: "Super Combo", max: 4, unlimitedCopies: false }]);
const fusionUltimate = legality([fw("FL", "leader", 1), fw("FU", "main", 1, { skill: ULT_TEXT }), ...fwMain], "fusion");
assert.equal(fusionUltimate.keywordRules.some((r) => r.keyword === "Ultimate"), false, "Masters Ultimate limit is not applied to Fusion World");
// The reminder text is printed in lower case on some cards.
assert.deepEqual(parseDeckRules("[super combo] (You can only include up to 4 cards with [super combo] in your deck"), [{ keyword: "Super Combo", max: 4, unlimitedCopies: false }]);
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
assert.ok(
  eightBalls.issues.some((i) => /8 \[Dragon Ball\] cards/.test(i.message)),
  JSON.stringify(eightBalls.issues),
);
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
const combos = legality([row("L", "leader", 1), row("SC1", "main", 3, { skill: SC_TEXT }), row("SC2", "main", 3, { skill: SC_TEXT }), ...fill(44)]);
assert.equal(combos.status, "illegal");
assert.ok(combos.issues.some((i) => /6 \[Super Combo\] cards/.test(i.message)));
assert.equal(legality([row("L", "leader", 1), row("SC1", "main", 4, { skill: SC_TEXT }), ...fill(46)]).status, "legal");
// 22-14-2: [Ultimate] has a pooled one-card limit even across different IDs.
// Mentioning the keyword in another card's effect does not make that card carry it.
assert.equal(hasKeyword({ skill: "[Auto] Choose 1 [Ultimate] card from your deck." }, "Ultimate"), false);
assert.deepEqual(rulesFor([{ skill: "[Auto] Choose 1 [Ultimate] card from your deck." }]), []);
assert.equal(legality([row("L", "leader", 1), row("U1", "main", 1, { skill: ULT_TEXT }), ...fullMain]).status, "legal", "one Ultimate is legal");
const ultimates = legality([
  row("L", "leader", 1),
  row("U1", "main", 1, { skill: ULT_TEXT }),
  row("U2", "main", 1, { skill: ULT_TEXT }),
  row("REF", "main", 1, { skill: "[Auto] Choose 1 [Ultimate] card from your deck." }),
  ...fill(47),
]);
assert.equal(ultimates.status, "illegal");
assert.ok(ultimates.issues.some((i) => /2 \[Ultimate\] cards.*at most 1/.test(i.message)));
assert.deepEqual(ultimates.keywordRules.find((r) => r.keyword === "Ultimate"), { keyword: "Ultimate", max: 1, used: 2, unlimitedCopies: false });

// ── Deck-building clauses (#1146) ─────────────────────────────────────────
// Every wording the issue quotes, read from the text and never from a card id.
{
  const only = (text: string) => {
    const r = parseDeckBuilding(text);
    assert.deepEqual(r.unread, [], `${text} reads whole`);
    assert.equal(r.rest, "", `${text} is nothing but a deck-building clause`);
    return r.rules;
  };
  const one = (text: string) => {
    const rules = only(text);
    assert.equal(rules.length, 1, text);
    return rules[0];
  };
  const x = (text: string) => one(text) as Extract<DeckBuildingRule, { kind: "exclude" }>;

  // Leader restrictions.
  assert.deepEqual(x("[Permanent] You can't include non-white Extra in your deck.").filters, [{ notColors: ["White"], types: ["EXTRA"] }]); // BT31-116
  assert.deepEqual(x("[Permanent] You can't include non-≪Saiyan≫ Battle Cards in your deck.").filters, [{ notTraits: ["Saiyan"], types: ["BATTLE"] }]); // SD9-01
  const xd1 = x("[Permanent] You can't include non-≪Universe 6≫ Battle Cards in your deck, except for <Vegeta> cards."); // XD1-01
  assert.deepEqual(xd1.filters, [{ notTraits: ["Universe 6"], types: ["BATTLE"] }]);
  assert.deepEqual(xd1.except, { characters: ["Vegeta"] });
  assert.deepEqual(x("[Permanent] You can't include black Battle Cards in your deck.").filters, [{ colors: ["Black"], types: ["BATTLE"] }]); // BT18-030
  assert.deepEqual(x("[Permanent] You can't include ≪Saiyan≫ cards in your deck.").filters, [{ traits: ["Saiyan"] }]); // SD13-01
  assert.deepEqual(x("[Permanent] You can't include Battle Cards with energy costs of 3 or less in your deck.").filters, [{ cost: { max: 3 }, types: ["BATTLE"] }]); // BT6-002
  assert.deepEqual(x("[Permanent] You can't include cards with energy costs of 5 or more in your deck.").filters, [{ cost: { min: 5 } }]); // P-086
  assert.deepEqual(x("[Permanent] You can't include Extra Cards with energy costs of 2 or more in your deck.").filters, [{ cost: { min: 2 }, types: ["EXTRA"] }]); // BT13-001
  assert.deepEqual(x("[Permanent] You can't include cards with energy costs of 6 or more, or multicolor cards in your deck.").filters, [{ cost: { min: 6 } }, { multicolor: true }]); // P-269, SD21-01
  assert.deepEqual(x("[Permanent] You can't include cards that don't have ≪Universe≫ as part of their special traits in your deck.").filters, [{ notTraitParts: ["Universe"] }]);
  // Live printed texts (public catalog strings).
  assert.deepEqual(x("[Permanent] You can't include cards in your deck that don't have ≪Universe≫ as part of their special trait.").filters, [{ notTraitParts: ["Universe"] }]); // EX03-25
  assert.equal(parseDeckBuilding("[Permanent] You can't include cards in your deck that don't have ≪Universe≫ as part of their special trait.").rest, "", "the relative clause is part of the description");
  assert.deepEqual(x("[Permanent] You cannot include non-≪Universe 7≫ cards in your deck.").filters, [{ notTraits: ["Universe 7"] }]); // TB1-050
  assert.deepEqual(x("[Permanent] You can't include non-≪World Tournament≫ Battle Cards or multicolor cards in your deck.").filters, [{ notTraits: ["World Tournament"], types: ["BATTLE"] }, { multicolor: true }]); // P-269
  const bt6027 = parseDeckBuilding("[Permanent] You can't include Extra Cards with energy costs of 4 or more in your deck, and this card can't attack."); // BT6-027
  assert.deepEqual(bt6027.rules.map((r) => (r as Extract<DeckBuildingRule, { kind: "exclude" }>).filters), [[{ cost: { min: 4 }, types: ["EXTRA"] }]]);
  assert.equal(bt6027.rest, "this card can't attack", "the game half is not swallowed");
  // An exclude or only that would match every card is never emitted.
  for (const text of ["[Permanent] You can't include cards in your deck.", "[Permanent] You can't include cards in your deck that look odd.", "[Permanent] You can only include cards in your Z-Deck."]) {
    const r = parseDeckBuilding(text);
    assert.deepEqual(r.rules, [], text);
    assert.equal(r.unread.length, 1, `${text} is unread`);
  }
  assert.deepEqual(x("[Permanent] You cannot include cards with energy costs of 6 or more in your deck.").filters, [{ cost: { min: 6 } }]); // TB1-050, TB2-065
  assert.equal(x("[Permanent] You can't include non-white Extra in your deck.").words, "can't include non-white Extra Cards");

  // Copy limits of the card itself.
  for (const [text, max, zone] of [
    ["[Permanent] You can include as many copies of this card in your deck as you like.", null, "main"], // BT2-107 …
    ["[Permanent] You can include up to 7 copies of this card in your deck.", 7, "main"], // BT13-149
    ["[Permanent] You can only include 1 copy of this card in your Z-Deck.", 1, "z"], // BT18-003, BT25-104
    ["[Permanent] You can include as many copies of this card in your Z-Deck as you like.", null, "z"], // BT25-007
  ] as const) {
    const c = one(text) as Extract<DeckBuildingRule, { kind: "copies" }>;
    assert.deepEqual([c.kind, c.max, c.zone], ["copies", max, zone], text);
  }

  // "Only", and pooled limits.
  const z = one("[permanent] You can only include Z-Unisons in your Z-Deck.") as Extract<DeckBuildingRule, { kind: "only" }>; // EX24-01
  assert.deepEqual([z.kind, z.zone, z.filter], ["only", "z", { types: ["Z-UNISON"] }]);
  const dd = one("[Permanent] You can only include up to 7 ≪Dark Dragon Ball≫ cards in your deck.") as Extract<DeckBuildingRule, { kind: "pool" }>; // BT13-122
  assert.deepEqual([dd.kind, dd.max, dd.filter], ["pool", 7, { traits: ["Dark Dragon Ball"] }]);

  // Mixed lines: the deck-building clause goes, the game half stays.
  const bt18 = parseDeckBuilding("[Permanent] Your deck can only include up to 6 [Dragon Ball] cards, and can't include non-red Battle Cards."); // BT18-002
  assert.deepEqual(bt18.rules.map((r) => r.kind), ["pool", "exclude"]);
  assert.deepEqual((bt18.rules[0] as Extract<DeckBuildingRule, { kind: "pool" }>).filter, { keyword: "Dragon Ball" });
  assert.equal(bt18.rest, "");
  const villain = parseDeckBuilding("[Permanent] You can't include non-≪Villainous≫ cards in your deck, and treat ≪Villainous≫ cards in your hand as if they have no specified cost."); // P-434's shape
  assert.deepEqual(villain.rules.map((r) => r.kind), ["exclude"]);
  assert.equal(villain.rest, "treat ≪Villainous≫ cards in your hand as if they have no specified cost");
  const gameFirst = parseDeckBuilding("[Permanent] Treat ≪Agent of Destruction≫ cards in your hand as if they have no specified cost, and you can't include non-≪Universe 7≫ cards in your deck."); // BT16-002 / BT6-027's other order
  assert.deepEqual(gameFirst.rules.map((r) => r.kind), ["exclude"]);
  assert.equal(gameFirst.rest, "Treat ≪Agent of Destruction≫ cards in your hand as if they have no specified cost");
  const twoSentences = parseDeckBuilding("[Permanent] You can't include black Battle Cards in your deck. [Auto] When this card attacks, draw 1 card.");
  assert.deepEqual(twoSentences.rules.map((r) => r.kind), ["exclude"]);
  assert.match(twoSentences.rest, /draw 1 card/);

  // Not deck-building: they say "deck" or "include" about the game, not the deck's contents.
  for (const text of [
    "[Permanent] If you have any non-red cards in areas other than your deck, hand, or Drop Area, you can't play this card.", // BT7-125 to -129
    "[Auto] When this card in your deck and hand is placed in your Drop, draw 1 card.", // EX13-03/04
    "[Permanent] This card in your deck or hand can't be chosen by your opponent's skills.",
    "[Auto] When you play this card, choose 1 card that includes {Frieza} in its card name from your deck and add it to your hand.",
  ]) {
    const r = parseDeckBuilding(text);
    assert.deepEqual(r.rules, [], text);
    assert.deepEqual(r.unread, [], text);
    assert.ok(r.rest.length > 0, `${text} stays game text`);
  }

  // A clause it cannot read is reported, kept in the text, never guessed.
  const odd = parseDeckBuilding("[Permanent] You can't include cards with a strange name in your deck.");
  assert.deepEqual(odd.rules, []);
  assert.equal(odd.unread.length, 1);
  assert.ok(odd.rest.includes("strange name"));

  // The keyword limits keep their own reader.
  assert.deepEqual(parseDeckBuilding(DB_TEXT).rules.map((r) => r.kind), ["keyword"]);
  assert.equal(parseDeckBuilding(DB_TEXT).rest, "");

  // Matching reads colours, traits, characters, costs and multicolour.
  const m = (card: Partial<DeckCardFacts>, f: DeckCardFilter) => matchesCardFilter({ cardType: "BATTLE", colors: ["Red"], ...card }, f);
  assert.equal(m({ cardType: "EXTRA", colors: ["Red"] }, { types: ["EXTRA"], notColors: ["White"] }), true);
  assert.equal(m({ cardType: "EXTRA", colors: ["White"] }, { types: ["EXTRA"], notColors: ["White"] }), false);
  assert.equal(m({ colors: ["Red", "Blue"] }, { multicolor: true }), true);
  assert.equal(m({ colors: ["Red", "Colorless"] }, { multicolor: true }), false, "colourless is not a colour");
  assert.equal(m({ energyCost: "X" }, { cost: { min: 5 } }), false, "an X cost is no number");
  assert.equal(m({ energyCost: "5" }, { cost: { min: 5 } }), true);
  assert.equal(m({ traits: ["≪Saiyan≫"] }, { traits: ["Saiyan"] }), true, "brackets and case do not matter");
}

// ── Deck legality against deck-building clauses ───────────────────────────
{
  const leader = (id: string, skill: string, over: Partial<DeckCardRow> = {}) => row(id, "leader", 1, { name: id, skill, ...over });
  const deck = (l: DeckCardRow, ...rest: DeckCardRow[]) => legality([l, ...fill(40), ...rest], "dbs");

  // BT31-116: no non-white Extra.
  const cell = leader("BT31-116", "[Permanent] You can't include non-white Extra in your deck.", { colors: ["White"] });
  const redExtra = deck(cell, row("X-RED", "main", 4, { cardType: "EXTRA", colors: ["Red"] }));
  assert.equal(redExtra.status, "illegal");
  assert.equal(redExtra.flags["main:X-RED"]?.severity, "illegal");
  assert.match(redExtra.flags["main:X-RED"].label, /Leader's rule: can't include non-white Extra Cards/);
  assert.ok(redExtra.issues.some((i) => /BT31-116\) can't include non-white Extra Cards: X-RED \(X-RED\)/.test(i.message)), "names the Leader's rule and the offending card: " + JSON.stringify(redExtra.issues));
  const whiteExtra = deck(cell, row("X-WHITE", "main", 4, { cardType: "EXTRA", colors: ["White"] }));
  assert.equal(whiteExtra.flags["main:X-WHITE"], undefined);
  assert.ok(!whiteExtra.issues.some((i) => /BT31-116/.test(i.message)));
  assert.equal(deck(cell, row("B-RED", "main", 4, { cardType: "BATTLE", colors: ["Red"] })).flags["main:B-RED"]?.severity !== "illegal", true, "a Battle Card is not an Extra");

  // The Leader's awakened side counts too.
  const backed = leader("BACK-1", "[Permanent] This card can't attack.", { backSkill: "[Permanent] You can't include black Battle Cards in your deck." });
  assert.equal(deck(backed, row("BLK", "main", 4, { colors: ["Black"] })).flags["main:BLK"]?.severity, "illegal");

  // XD1-01: non-Universe-6 Battle Cards, except <Vegeta>.
  const xd1 = leader("XD1-01", "[Permanent] You can't include non-≪Universe 6≫ Battle Cards in your deck, except for <Vegeta> cards.");
  const u7 = row("U7", "main", 4, { traits: ["Universe 7"], characters: ["Son Goku"] });
  const u7Vegeta = row("U7V", "main", 4, { traits: ["Universe 7"], characters: ["Vegeta"] });
  const u6 = row("U6", "main", 4, { traits: ["Universe 6"], characters: ["Hit"] });
  const xd = deck(xd1, u7, u7Vegeta, u6);
  // EX03-25: a trait that contains ≪Universe≫ is enough.
  const ex03 = leader("EX03-25", "[Permanent] You can't include cards in your deck that don't have ≪Universe≫ as part of their special trait.");
  const uni = deck(ex03, row("UN7", "main", 4, { traits: ["Universe 7"] }), row("UN11", "main", 4, { traits: ["Universe 11"] }), row("SAI", "main", 4, { traits: ["Saiyan"] }));
  assert.equal(uni.flags["main:UN7"], undefined);
  assert.equal(uni.flags["main:UN11"], undefined);
  assert.equal(uni.flags["main:SAI"]?.severity, "illegal", "a non-Universe card is flagged");
  assert.ok(!uni.issues.some((i) => /EX03-25/.test(i.message) && /UN7|UN11/.test(i.message)));
  assert.equal(xd.flags["main:U7"]?.severity, "illegal");
  assert.equal(xd.flags["main:U7V"], undefined, "a non-Universe-6 <Vegeta> is accepted");
  assert.equal(xd.flags["main:U6"], undefined);

  // Cost and multicolour clauses.
  const cheap = leader("BT6-002", "[Permanent] You can't include Battle Cards with energy costs of 3 or less in your deck.");
  assert.equal(deck(cheap, row("C3", "main", 4, { energyCost: "3" })).flags["main:C3"]?.severity, "illegal");
  assert.equal(deck(cheap, row("C4", "main", 4, { energyCost: "4" })).flags["main:C4"], undefined);
  const mono = leader("P-269", "[Permanent] You can't include cards with energy costs of 6 or more, or multicolor cards in your deck.");
  assert.equal(deck(mono, row("MC", "main", 4, { colors: ["Red", "Blue"] })).flags["main:MC"]?.severity, "illegal");

  // Fusion World is untouched.
  const fwLeader = { ...leader("FL", "[Permanent] You can't include non-white Extra in your deck."), game: "fusion" as const };
  const fwCard = { ...row("FX", "main", 4, { cardType: "EXTRA", colors: ["Red"] }), game: "fusion" as const };
  assert.ok(!legality([fwLeader, fwCard], "fusion").issues.some((i) => /can't include/.test(i.message)));

  // Copy limits printed on the cards.
  const free = (id: string) => row(id, "main", 9, { skill: "[Permanent] You can include as many copies of this card in your deck as you like." });
  assert.equal(deck(leader("L", ""), free("BT2-107")).flags["main:BT2-107"], undefined, "9 copies of BT2-107 are fine");
  assert.equal(deck(leader("L", ""), row("PLAIN", "main", 9)).flags["main:PLAIN"]?.label, "9 copies, limit 4", "9 copies of a normal card are flagged");
  const seven = (n: number) => deck(leader("L", ""), row("BT13-149", "main", n, { skill: "[Permanent] You can include up to 7 copies of this card in your deck." })).flags["main:BT13-149"];
  assert.equal(seven(7), undefined);
  assert.equal(seven(8)?.severity, "illegal");
  const zOne = (n: number) => legality([leader("L", ""), ...fill(50), row("BT18-003", "z", n, { cardType: "Z-BATTLE", skill: "[Permanent] You can only include 1 copy of this card in your Z-Deck." })], "dbs");
  assert.equal(zOne(1).flags["z:BT18-003"], undefined);
  assert.equal(zOne(2).flags["z:BT18-003"]?.severity, "illegal", "2 copies of BT18-003 in the Z-Deck are flagged");
  assert.equal(zOne(2).status, "illegal");

  // Only Z-Unisons in the Z-Deck.
  const ex24 = leader("EX24-01", "[permanent] You can only include Z-Unisons in your Z-Deck.");
  const zDeck = legality([ex24, ...fill(50), row("ZU", "z", 2, { cardType: "Z-UNISON" }), row("ZB", "z", 2, { cardType: "Z-BATTLE" })], "dbs");
  assert.equal(zDeck.flags["z:ZB"]?.severity, "illegal");
  assert.equal(zDeck.flags["z:ZU"], undefined);

  // Pooled limits: up to 7 ≪Dark Dragon Ball≫ cards, up to 6 [Dragon Ball] cards.
  const ddb = leader("BT13-122", "[Permanent] You can only include up to 7 ≪Dark Dragon Ball≫ cards in your deck.");
  const dark = (id: string, n: number) => row(id, "main", n, { traits: ["Dark Dragon Ball"] });
  assert.equal(deck(ddb, dark("DD1", 4), dark("DD2", 4)).flags["main:DD2"]?.severity, "illegal", "8 Dark Dragon Balls");
  assert.equal(deck(ddb, dark("DD1", 4), dark("DD2", 3)).flags["main:DD2"], undefined, "7 are fine");
  const one6 = leader("BT18-002", "[Permanent] Your deck can only include up to 6 [Dragon Ball] cards, and can't include non-red Battle Cards.");
  assert.equal(legality([one6, ball(7), ...fill(43)], "dbs").flags["main:BALL"]?.severity, "illegal", "7 Dragon Balls break the Leader's 6");
  assert.equal(legality([one6, ball(6), ...fill(44)], "dbs").status, "legal");
  assert.equal(legality([one6, ball(6), ...fill(40), row("BLUE", "main", 4, { colors: ["Blue"] })], "dbs").flags["main:BLUE"]?.severity, "illegal", "non-red Battle Cards");
}

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
// Sonnet → Opus fallback rule (#381)
{
  const ok = { number: "BT18-020", confidence: 0.95 };
  assert.equal(needsOpusFallback({ cards: [ok, ok], unreadable: 0 }, "batch"), false, "all clear: stay on Sonnet");
  assert.equal(needsOpusFallback({ cards: [ok, { number: "BT18-021", confidence: 0.79 }], unreadable: 0 }, "batch"), true, "below REVIEW_THRESHOLD");
  assert.equal(needsOpusFallback({ cards: [{ number: "BT18-021", confidence: 0.8 }], unreadable: 0 }, "single"), false, "at the threshold is fine");
  assert.equal(needsOpusFallback({ cards: [{ number: null, confidence: 0.95 }], unreadable: 0 }, "single"), true, "no number");
  assert.equal(needsOpusFallback({ cards: [{ number: "  ", confidence: 0.95 }], unreadable: 0 }, "single"), true, "blank number");
  assert.equal(needsOpusFallback({ cards: [ok], unreadable: 1 }, "batch"), true, "model counted an unreadable card");
  assert.equal(needsOpusFallback({ cards: [], unreadable: 0 }, "single"), true, "single photo, nothing listed");
  assert.equal(needsOpusFallback({ cards: [], unreadable: 0 }, "batch"), false, "empty batch photo is plausible");
  assert.equal(needsOpusFallback({ cards: [{ number: "P-181", confidence: Number.NaN }], unreadable: 0 }, "single"), true, "NaN confidence");
}
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
  [
    { cardId: "A", quantity: 2 },
    { cardId: "B", quantity: 1 },
  ],
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

// ── SessionStart hook: install decision ─────────────────────────────────────
assert.equal(needsInstall(null, 100), true, "missing node_modules always needs an install");
assert.equal(needsInstall(50, 100), true, "a lockfile newer than node_modules needs a reinstall");
assert.equal(needsInstall(100, 50), false, "node_modules newer than the lockfile is current");

// ── Vercel: previews of agent branches are skipped, migrations are production's ──
assert.equal(shouldSkipBuild({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "feat/1-x" }), false, "production always builds");
assert.equal(shouldSkipBuild({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feat/1-x" }), true, "an agent branch's preview is skipped");
assert.equal(shouldSkipBuild({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "claude/issue-9" }), true);
assert.equal(shouldSkipBuild({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "patricks-experiment" }), false, "a hand-pushed branch still previews");
assert.equal(shouldSkipBuild({ VERCEL_ENV: "preview" }), false, "no branch name: build rather than guess");
const prod = { VERCEL_ENV: "production", VERCEL_GIT_PREVIOUS_SHA: "a", VERCEL_GIT_COMMIT_SHA: "b" };
assert.equal(shouldSkipBuild(prod, () => ["docs/agent-brief.md", ".github/workflows/checks.yml", ".claude/settings.json", "CLAUDE.md"]), true, "a docs-only change skips the production deploy");
assert.equal(shouldSkipBuild(prod, () => ["docs/x.md", "src/app/page.tsx"]), false, "a mixed change builds");
assert.equal(shouldSkipBuild(prod, () => ["src/lib/a.ts"]), false, "src/** builds");
assert.equal(shouldSkipBuild(prod, () => ["drizzle/0042_x.sql"]), false, "drizzle/** builds");
assert.equal(shouldSkipBuild(prod, () => ["package.json"]), false, "package.json builds");
assert.equal(shouldSkipBuild(prod, () => ["docs/x.md", "src/docs/y.md"]), false, "a nested docs dir is not docs/");
assert.equal(shouldSkipBuild(prod, () => ["sub/README.md"]), false, "only root-level *.md counts");
assert.equal(shouldSkipBuild(prod, () => null), false, "an unknown change list builds");
assert.equal(shouldSkipBuild(prod, () => []), false, "an empty change list builds");
assert.equal(shouldSkipBuild(prod, () => { throw new Error("git failed"); }), false, "a git failure builds");
assert.equal(isDocsOnlyChange(["README.md", "docs/a/b.md"]), true);
assert.equal(changedFiles({ VERCEL_GIT_COMMIT_SHA: "b" }), null, "no previous SHA: unknown");
assert.equal(changedFiles({ VERCEL_GIT_PREVIOUS_SHA: "a" }), null, "no commit SHA: unknown");
assert.equal(changedFiles(prod, () => { throw new Error("bad object"); }), null, "an unknown previous SHA (shallow clone) is unknown");
assert.equal(shouldSkipBuild({ VERCEL_ENV: "production" }), false, "production with no SHAs builds");
assert.equal(shouldSkipBuild({ VERCEL_ENV: "production", VERCEL_GIT_PREVIOUS_SHA: "0".repeat(40), VERCEL_GIT_COMMIT_SHA: "1".repeat(40) }), false, "production with SHAs git does not know builds");
assert.equal(shouldMigrate({ VERCEL_ENV: "production" }), true);
assert.equal(shouldMigrate({ VERCEL_ENV: "preview" }), false, "a preview never migrates the shared database");

console.log("verify-rules: all checks passed");

// ── the hand-entered specified cost (issue #255) ──────────────────────────
// The column speaks the language's orb notation and nothing else: a typo is
// "not entered" rather than a wrong price, and unknown stays unknown.
assert.deepEqual(parseSpecifiedCost("{u}{u}"), { Blue: 2 });
assert.deepEqual(parseSpecifiedCost(" {r} {u} "), { Red: 1, Blue: 1 }, "whitespace between orbs is tolerated");
assert.deepEqual(parseSpecifiedCost("{U}{K}"), { Blue: 1, Black: 1 }, "case is not a difference");
assert.equal(parseSpecifiedCost(""), null);
assert.equal(parseSpecifiedCost(null), null);
assert.equal(parseSpecifiedCost("2 blue"), null, "words are not orbs");
assert.equal(parseSpecifiedCost("{2}"), null, "a bare number is a total, which the cost circle already states");
assert.equal(parseSpecifiedCost("{u}{u} x"), null, "anything beside the orbs refuses the whole entry");
assert.equal(printSpecifiedCost({ Blue: 2 }), "{u}{u}");
assert.equal(printSpecifiedCost({ Blue: 1, Red: 1 }), "{r}{u}", "printed in a fixed colour order, so two entries compare as strings");
assert.equal(printSpecifiedCost(parseSpecifiedCost("{u} {r}")!), "{r}{u}");
assert.equal(specifiedCostWords({ Blue: 2 }), "2 blue");
assert.equal(specifiedCostWords({ Red: 1, Blue: 1 }), "1 red, 1 blue");
assert.equal(specifiedCostWords({}), "no colour");

// The bridge: a database row carries the column and the def carries the orbs;
// a row shaped off the feed carries nothing and stays unknown — which is what
// `specifiedCostOf` refuses to guess for an X cost and `specifiedCostUnknown`
// reports.
{
  const row = (specifiedCost: string | null | undefined) => ({ id: "BT19-039", name: "Goten", cardType: "UNISON", colors: ["Blue"], energyCost: "X", zEnergyCost: null, power: null, comboCost: null, comboPower: null, skill: "[Permanent] reduce the specified cost of this card in your hand by {u}.", characters: [], traits: [], backName: null, backPower: null, backSkill: null, specifiedCost });
  const entered = cardDefFrom(row("{u}{u}"));
  assert.deepEqual(entered.specifiedCost, { Blue: 2 });
  assert.deepEqual(specifiedCostOf(entered), { Blue: 2 }, "the engine reads the entry as the card's requirement");
  assert.equal(specifiedCostUnknown(entered), false);
  for (const d of [cardDefFrom(row(null)), cardDefFrom(row(undefined)), cardDefFrom(row("two blue"))]) {
    assert.equal(d.specifiedCost, undefined, "nothing entered, or nothing readable, is not a baseline");
    assert.equal(specifiedCostUnknown(d), true);
    assert.deepEqual(specifiedCostOf(d), {}, "…and the engine demands no colour rather than guessing one");
  }
}

// The self-check an entry can have: not against the feed, which says nothing,
// but against the card it was entered for.
{
  const ok = { id: "BT19-039", energyCost: "X", skill: "[Permanent] … reduce the specified cost of this card in your hand by {u}.", specifiedCost: "{u}{u}" };
  assert.deepEqual(staleSpecifiedCosts([ok, { ...ok, id: "BT19-040", specifiedCost: null }]), [], "a good entry and an unknown are both quiet");
  const fixed = staleSpecifiedCosts([{ ...ok, id: "BT1-001", energyCost: "3" }]);
  assert.equal(fixed.length, 1);
  assert.match(fixed[0], /BT1-001: .*rather than X/);
  const silent = staleSpecifiedCosts([{ ...ok, id: "BT2-002", skill: "[Auto] Draw 1 card." }]);
  assert.match(silent[0], /BT2-002: .*no longer prints a specified-cost clause/);
  const typo = staleSpecifiedCosts([{ ...ok, id: "BT3-003", specifiedCost: "2 blue" }]);
  assert.match(typo[0], /BT3-003: .*not orb notation/);
}

// The Rules Workbench's one queue (#360): what a link builds is what the page
// reads back, and the two retired URLs mean their equivalent queue.
{
  const fresh = parseQueue({});
  assert.deepEqual([fresh.scope.kind, fresh.health, fresh.group], ["decks", null, null], "the default is my decks, a tab chosen from the counts, the tab's own grouping");
  assert.equal(queueHref(fresh), "/arena/rules", "and the default is the bare URL");
  const q = parseQueue({ deck: "12", health: "unchecked", group: "wording", q: " krillin ", set: "BT19" });
  assert.equal(queueHref(q), "/arena/rules?deck=12&health=unchecked&group=wording&q=krillin&set=BT19");
  assert.deepEqual(parseQueue(Object.fromEntries(new URL(`http://x${queueHref(q)}`).searchParams)), q, "a link reads back as the queue that built it");
  assert.equal(parseQueue({ game: "7", deck: "12" }).scope.kind, "game", "a game's scope wins: it is what ah-04 links to");
  const fromPlay = parseQueue({ deck: "4", seg: "open", q: "BT19-061" });
  assert.deepEqual([fromPlay.scope, fromPlay.health, fromPlay.q], [{ kind: "deck", id: 4 }, "text-only", "BT19-061"], "the Play picker's old link (?deck=&seg=open&q=) lands on that deck's text-only card");
  assert.equal(parseQueue({ state: "bogus", group: "bogus" }).group, null, "an unknown tab or grouping is the default, not an error");
  assert.equal(queueLink({ ...q, page: 3, rule: 9 }, { health: "text-only" }), "/arena/rules?deck=12&health=text-only&group=wording&q=krillin&set=BT19", "changing the view drops the page and the selection");
  assert.match(queueLink({ ...q, page: 3 }, { rule: 9 }), /page=3&rule=9$/, "selecting a rule keeps the page");
  assert.equal(defaultHealth({ "text-only": 2, incomplete: 0, unchecked: 9, done: 0 }), "text-only");
  assert.equal(defaultHealth({ "text-only": 0, incomplete: 3, unchecked: 9, done: 0 }), "incomplete", "Incomplete when it has cards, else the first non-empty of Text only and Incomplete");

  assert.equal(legacyQueueUrl("all", { set: "BT19" }), "/arena/rules?scope=catalog&set=BT19", "/all?set=BT19 is the catalog, narrowed to the set");
  assert.equal(legacyQueueUrl("all", { seg: "draft", source: "claude", pattern: "draw", q: "x", page: "2", rule: "5" }), "/arena/rules?scope=catalog&health=unchecked&source=claude&pattern=draw&q=x&page=2&rule=5");
  assert.equal(legacyQueueUrl("all", { seg: "all" }), "/arena/rules?scope=catalog", "seg=all was every state: now the default tab");
  assert.equal(legacyQueueUrl("patterns", {}), "/arena/rules?scope=catalog&health=unchecked&group=wording", "the drafts half");
  assert.equal(legacyQueueUrl("patterns", { half: "open" }), "/arena/rules?scope=catalog&health=text-only&group=wording", "/patterns?half=open is text only grouped by wording");

  const row = { status: "draft", source: "compiler", unread: [] as string[] };
  assert.equal(reasonOf(row), null, "a plain draft has nothing to flag");
  assert.equal(reasonOf({ ...row, source: "claude" }), "Claude drafted");
  assert.equal(reasonOf({ ...row, costUnknown: true }), "specified cost unknown");
  assert.equal(reasonOf({ ...row, status: "confirmed", hasDiff: true }), "compiler reads it differently", "a disagreement is flagged whatever the state");
  assert.match(reasonOf({ ...row, status: "open", unread: ["your opponent skips their next Charge Phase"] }) ?? "", /^(unread: .+|phrasing only)$/);

  // "See the cards" (#368): grouping by zone and card type, open cards first.
  const pc = (cardId: string, zone: string, cardType: string, state: DeckPreviewCard["state"], name = cardId): DeckPreviewCard => ({ cardId, name, zone, quantity: 4, cardType, colors: [], energyCost: null, imageUrl: null, state });
  const groups = groupPreview([
    pc("z1", "z", "Z-BATTLE", "confirmed"),
    pc("b-conf", "main", "BATTLE", "confirmed", "Aaa"),
    pc("b-plain", "main", "BATTLE", "plain", "Bbb"),
    pc("b-open", "main", "BATTLE", "open", "Zzz"),
    pc("b-draft", "main", "UNISON", "draft", "Ccc"),
    pc("e1", "main", "EXTRA", "corrected"),
    pc("l1", "leader", "LEADER", "confirmed"),
  ]);
  assert.deepEqual(groups.map((g) => g.label), ["Leader", "Battle", "Extra", "Z-Deck"], "zones in display order, empty ones left out");
  assert.deepEqual(groups[1].cards.map((c) => c.cardId), ["b-open", "b-draft", "b-conf", "b-plain"], "open first, then draft, corrected, confirmed, plain");
  assert.equal(groups[1].copies, 16, "copies, not distinct cards");

  // Skip and Confirm follow the queue's own order (#361).
  assert.deepEqual(neighbours([4, 7, 9], 7), { prev: 4, next: 9, skip: 9, after: 9 }, "the middle: next is next");
  assert.deepEqual(neighbours([4, 7, 9], 9), { prev: 7, next: null, skip: 4, after: 7 }, "the end: Skip wraps, Confirm falls back to the one before");
  assert.deepEqual(neighbours([4, 7, 9], 4), { prev: null, next: 7, skip: 7, after: 7 }, "the start has no previous");
  assert.deepEqual(neighbours([4, 7, 9], 99), { prev: null, next: 4, skip: 4, after: 4 }, "a rule opened by id starts at the top of the queue");
  assert.deepEqual(neighbours([4], 4), { prev: null, next: null, skip: null, after: null }, "a queue of one has nowhere to go");
  assert.deepEqual(neighbours([], null), { prev: null, next: null, skip: null, after: null });
}

// ── small card art (issue #384) ────────────────────────────────────────────
{
  const big = "https://tcgplayer-cdn.tcgplayer.com/product/123456_in_1000x1000.jpg";
  assert.equal(cardImage(big, "thumb"), "https://tcgplayer-cdn.tcgplayer.com/product/123456_200w.jpg");
  assert.equal(cardImage(big, "medium"), "https://tcgplayer-cdn.tcgplayer.com/product/123456_400w.jpg");
  assert.equal(cardImage(big, "full"), big);
  const small = "https://tcgplayer-cdn.tcgplayer.com/product/123456_200w.jpg";
  assert.equal(cardImage(small, "medium"), "https://tcgplayer-cdn.tcgplayer.com/product/123456_400w.jpg", "any TCGplayer size maps to any other");
  assert.equal(cardImage(small, "full"), big);
  for (const u of [
    "https://storage.googleapis.com/deckplanet_card_images/BT18-020.png",
    "https://www.dbs-cardgame.com/fw/images/cards/card/en/FB01-001.webp",
    "https://www.cardtrader.com/uploads/blueprints/image/1/x.jpg",
    "https://example.com/product/123456_in_1000x1000.jpg",
  ]) assert.equal(cardImage(u, "thumb"), u, `unchanged: ${u}`);
  assert.equal(cardImage(null, "thumb"), null);
  assert.equal(cardImage(undefined, "thumb"), undefined);
  assert.equal(cardImageSizeFor(56), "thumb");
  assert.equal(cardImageSizeFor(128), "medium");
}

// ── "when this card is played using [Over Realm]" is its own moment (2 Oct 2026) ──
// Read as `played` — its opening words — these skills fired on an ordinary
// play as well (P-067, EX02-05, BT3-110 …). Both printed wordings, and the dark
// variant, are `playedUsingOverRealm` and nothing else; the plain wording and
// the watcher on other cards are untouched.
{
  const whenOf = (text: string) => triggersOf(parseSkills(text).find((sk) => sk.kind === "auto")!);
  assert.deepEqual(whenOf("[Auto] When you play this card using [Over Realm], draw 1 card."), ["playedUsingOverRealm"]);
  assert.deepEqual(whenOf("[Auto] When this card is played using [Over Realm], activate this skill. Draw 2 cards."), ["playedUsingOverRealm"]);
  assert.deepEqual(whenOf("[Auto] When this card is played using [Dark Over Realm], draw 1 card."), ["playedUsingOverRealm"]);
  assert.deepEqual(whenOf("[Over Realm 4]{2}\n[Auto] When you play this card using [Over Realm], KO up to 1 of your opponent's Battle Cards."), ["playedUsingOverRealm"]);
  assert.deepEqual(whenOf("[Auto] When you play this card, draw 1 card."), ["played"], "the plain wording is still `played`");
  assert.deepEqual(whenOf("[Auto] When this card is played, draw 1 card."), ["played"]);
  assert.deepEqual(whenOf("[Auto] When you play a Battle Card using [Over Realm], draw 1 card."), ["overRealmPlayed"], "the watcher on other cards is unchanged");
  assert.equal(describeTrigger(["playedUsingOverRealm"]), "when this card is played using [Over Realm]");
}
// ── "…during the turn you played it with [Over Realm]" is a condition (P-048) ──
// The attack is the moment; the rest of the trigger sentence asks the card's
// memory of the [Over Realm] play (`playedUsing`). Dropped with the trigger,
// it fired on every attack of every turn.
{
  const sk = parseSkills("[Auto] When this card attacks during the turn you played it with [Over Realm], draw 1 card.").find((x) => x.kind === "auto")!;
  assert.deepEqual(triggersOf(sk), ["attacks"]);
  // #1071: a compiled program also carries the typed `kind`, `usage` and `validity` v1 records.
  assert.deepEqual(compileSkill(sk), { ops: [{ op: "if", cond: { kind: "playedUsing", sel: { special: "self" }, what: "Over Realm" }, then: [{ op: "draw", n: 1 }] }], unsupported: [], kind: "auto", usage: { version: 1, oncePerTurn: false, limit: null }, validity: { version: 1, sparking: null } });
  const passive = parseSkills("[Auto] When this card attacks during the turn this card was played using [Dark Over Realm], draw 1 card.").find((x) => x.kind === "auto")!;
  assert.deepEqual(compileSkill(passive).ops[0], { op: "if", cond: { kind: "playedUsing", sel: { special: "self" }, what: "Over Realm" }, then: [{ op: "draw", n: 1 }] });
  const plain = parseSkills("[Auto] When this card attacks, draw 1 card.").find((x) => x.kind === "auto")!;
  assert.deepEqual(compileSkill(plain).ops, [{ op: "draw", n: 1 }], "an attack trigger without it is unconditional");
}
// ── a quoted filter is read whole or refused ───────────────────────────────
// `parseFilter` passes over words it has no pattern for, so a rule that said
// "card with 5000 combo power" was stored as a filter on *any* card — there
// was no combo-power measure then (#486 has since added one), and nothing
// said so. The text view refuses what
// it cannot read (docs/arena-fixing-a-card.md), so the parser names the words
// and points at the printed form or the predicate form.
{
  const chooseFrom = (filter: string) => parseRule(`WHEN [auto] played\nTHEN\n  choose(sel: UP TO 3 ${filter} IN you.drop, as: "c0")\n  moveTo(target: $c0, to: under, under: [self])`);
  const refused = (filter: string, words: string[]) => {
    const r = chooseFrom(JSON.stringify(filter));
    assert.equal(r.ok, false, `refused: ${filter}`);
    if (r.ok) return;
    for (const w of words) assert.ok(r.error.message.includes(JSON.stringify(w)), `the refusal of ${JSON.stringify(filter)} names ${JSON.stringify(w)}: ${r.error.message}`);
    assert.match(r.error.message, /field by field/, "and points at the predicate form");
    assert.equal(r.error.line, 3, "on the line that says it");
  };
  refused("card with a glittering frame", ["glittering", "frame"]);
  refused("other Field Extra", ["other", "field"]);
  refused("a card of the named colours", ["named", "colour"]);
  refused("Battle Card in your Drop Area", ["drop", "area"]);
  refused("card with [Not A Keyword]", ["[not a keyword]"]);
  // A thousands comma used to be a mis-read: the "N power or less" pattern took
  // the "000" after the comma and stored power 0 or less (the accounting
  // refused it). The power patterns now read `[\d,]+`, so it reads whole.
  for (const [words, field] of [
    ["battle cards with 25,000 power or less", { powerMax: 25000 }],
    ["Battle Cards with 15,000 power or more", { powerMin: 15000 }],
    ["yellow card with an energy cost of 3 and 10,000 power", { powerMin: 10000, powerMax: 10000 }],
  ] as const) {
    const r = chooseFrom(JSON.stringify(words));
    assert.ok(r.ok, `reads whole: ${words}${r.ok ? "" : ` — ${r.error.message}`}`);
    const f = parseFilter(words);
    for (const [k, v] of Object.entries(field)) assert.equal(f[k as keyof typeof f], v, `${words}: ${k}`);
  }
  assert.deepEqual(unreadFilterWords("card with a glittering frame", parseFilter("card with a glittering frame")), ["glittering", "frame"]);
  // Combo power was the first example of a dropped word here; #486 made it a
  // measure (comboPowerMin/Max), so it now reads whole — see the list below.
  assert.deepEqual(unreadFilterWords("card with 5000 combo power", parseFilter("card with 5000 combo power")), []);
  // "Skill-less" was dropped the same way until 3 Oct 2026; now a measure,
  // and the predicate form names it too.
  assert.deepEqual(unreadFilterWords("skill-less Battle Card", parseFilter("skill-less Battle Card")), []);
  {
    const pred = chooseFrom("(skillLess = true AND type = BATTLE)");
    const said = chooseFrom('"skill-less Battle Card"');
    assert.ok(pred.ok, `the predicate form reads skillLess${pred.ok ? "" : ` — ${pred.error.message}`}`);
    if (pred.ok && said.ok) assert.deepEqual(pred.value, said.value, "skillLess: the predicate form and the words are one filter");
  }

  // Every wording `parseFilter` does read still parses, in the card's own
  // words as well as the reading's — plurals, hyphens, either word order.
  for (const words of [
    "red card",
    "card with 5000 combo power",
    "blue ≪Saiyan≫ card with an energy cost of 3 or less",
    "Battle Cards with 25000 or less power",
    "non-black Battle Cards",
    "card other than <Grand Supreme Kai>",
    "Earthling Tokens",
    "Multicolored card",
    "face-up ≪Boujack Brigade≫ cards",
    "Extra Card with [Field]",
    "yellow <Son Goku> card with an energy cost of 3 and 5000 power",
    "Battle Card with power less than or equal to this card's power",
    "Battle Card with power no more than this card's power",
    "red Extra Card with an energy cost of 1 and no keyword skills",
    // 1-5-9, 9-1-4: bare "skill-less" is a measure of its own since 3 Oct 2026.
    "red skill-less Battle Cards",
    "yellow originally skill-less Battle Card",
  ]) {
    const r = chooseFrom(JSON.stringify(words));
    assert.ok(r.ok, `reads whole: ${words}${r.ok ? "" : ` — ${r.error.message}`}`);
    if (r.ok) assert.deepEqual(unreadFilterWords(words, parseFilter(words)), []);
  }

  // The predicate form says the same as the words, and a filter printed in
  // words always reads back: `printFilter` only uses words that round-trip.
  const pred = chooseFrom("(colors = [Blue] AND traits = [Saiyan] AND costMax = 3)");
  const said = chooseFrom('"blue ≪Saiyan≫ card with an energy cost of 3 or less"');
  assert.ok(pred.ok && said.ok);
  if (pred.ok && said.ok) assert.deepEqual(pred.value, said.value, "the predicate form and the printed form are one filter");
  if (said.ok) {
    const again = parseRule(printRule(said.value));
    assert.ok(again.ok && deepEqual(again.value, said.value), "the printed rule reads back");
  }
}
