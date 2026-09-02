import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Catalog — imported, never hand-edited. Source: deckplanet (see
 *  src/lib/catalog/deckplanet.ts). Every card has one or more *prints*
 *  (standard, parallel "_PR", special rare "_SPR", …); ownership always
 *  references a print so foil/alt-art copies are tracked distinctly.
 * ──────────────────────────────────────────────────────────────────────────
 */

export const cardSets = pgTable("card_sets", {
  /** Card-number prefix: "BT1", "SD22", "P", "EX13", "TB1", "DB2", "EB1", "XD1", "TOKEN". */
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  /** "legacy" (2017–2024) or "masters" (current). */
  line: text("line").notNull(),
  releasedOn: date("released_on"),
  /** Chronological ordering key so set lists read newest-first without date gaps. */
  sortKey: integer("sort_key").notNull().default(0),
});

export const cards = pgTable(
  "cards",
  {
    /** Canonical card number with no print suffix: "BT18-020", "P-181", "T_CLO_01". */
    id: text("id").primaryKey(),
    setCode: text("set_code")
      .notNull()
      .references(() => cardSets.code),
    name: text("name").notNull(),
    /** LEADER, BATTLE, EXTRA, UNISON, Z-LEADER, Z-BATTLE, Z-EXTRA, Z-UNISON, TOKEN. */
    cardType: text("card_type").notNull(),
    colors: text("colors")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** As printed: "4", "X", or null for leaders / no cost. */
    energyCost: text("energy_cost"),
    zEnergyCost: text("z_energy_cost"),
    power: integer("power"),
    comboCost: integer("combo_cost"),
    comboPower: integer("combo_power"),
    /** Skill text with bracketed keywords, no HTML styling. Lines separated by <br>. */
    skill: text("skill"),
    characters: text("characters")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    traits: text("traits")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    eras: text("eras")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    keywords: text("keywords")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** As the source names it: "Super Rare[SR]". */
    rarity: text("rarity").notNull(),
    /** The bracket code alone: "SR". */
    rarityCode: text("rarity_code").notNull(),
    /** Deck-building copy limit (4 normally; 1 for restricted; 7 for Z-deck cards). */
    limitedTo: integer("limited_to"),
    isBanned: boolean("is_banned").notNull().default(false),
    isLimited: boolean("is_limited").notNull().default(false),
    hasErrata: boolean("has_errata").notNull().default(false),
    isHorizontal: boolean("is_horizontal").notNull().default(false),
    // Leader back side (awakened form).
    backName: text("back_name"),
    backSkill: text("back_skill"),
    backPower: integer("back_power"),
    /** Canonical image for the standard print (prints carry their own). */
    imageUrl: text("image_url"),
    deckplanetId: integer("deckplanet_id"),
    /** Lower-cased "number name characters" for ILIKE search. */
    searchText: text("search_text").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cards_set_idx").on(t.setCode),
    index("cards_name_idx").on(t.name),
    index("cards_type_idx").on(t.cardType),
  ],
);

export const cardPrints = pgTable(
  "card_prints",
  {
    /** Card number including print suffix: "BT18-020", "BT18-020_PR", "BT18-020_SPR". */
    id: text("id").primaryKey(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** "" for the standard print, else "PR", "SPR", "SPR2", "SLR", "GDR", "gold", … */
    suffix: text("suffix").notNull().default(""),
    /** Human label: "Standard", "Parallel", "Special Rare". */
    label: text("label").notNull(),
    rarity: text("rarity").notNull(),
    imageUrl: text("image_url"),
    isBase: boolean("is_base").notNull().default(false),
    deckplanetId: integer("deckplanet_id"),
  },
  (t) => [index("card_prints_card_idx").on(t.cardId)],
);

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Pricing — TCGplayer via tcgcsv.com (category 27). Products join to cards on
 *  the printed card number; prices are daily snapshots so the dashboard can
 *  show movers. All amounts are USD cents.
 * ──────────────────────────────────────────────────────────────────────────
 */

export const tcgGroups = pgTable("tcg_groups", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  abbreviation: text("abbreviation"),
  publishedOn: date("published_on"),
  modifiedOn: timestamp("modified_on", { withTimezone: true }),
});

export const tcgProducts = pgTable(
  "tcg_products",
  {
    id: integer("id").primaryKey(),
    groupId: integer("group_id")
      .notNull()
      .references(() => tcgGroups.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The "Number" extended field, e.g. "BT1-086". Null for sealed product. */
    number: text("number"),
    rarity: text("rarity"),
    imageUrl: text("image_url"),
    url: text("url"),
    /** Parenthesised marker from the product name, lower-cased: "spr", "foil version", "silver foil"… */
    marker: text("marker"),
    /** Matched catalog card / print, if the number resolved. */
    cardId: text("card_id").references(() => cards.id, { onDelete: "set null" }),
    printId: text("print_id").references(() => cardPrints.id, { onDelete: "set null" }),
    modifiedOn: timestamp("modified_on", { withTimezone: true }),
  },
  (t) => [
    index("tcg_products_card_idx").on(t.cardId),
    index("tcg_products_print_idx").on(t.printId),
    index("tcg_products_number_idx").on(t.number),
  ],
);

export const tcgPrices = pgTable(
  "tcg_prices",
  {
    productId: integer("product_id")
      .notNull()
      .references(() => tcgProducts.id, { onDelete: "cascade" }),
    /** "Normal" or "Foil". */
    subType: text("sub_type").notNull(),
    capturedOn: date("captured_on").notNull(),
    marketCents: integer("market_cents"),
    lowCents: integer("low_cents"),
    midCents: integer("mid_cents"),
    highCents: integer("high_cents"),
    directLowCents: integer("direct_low_cents"),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.subType, t.capturedOn] }),
    index("tcg_prices_captured_idx").on(t.capturedOn),
  ],
);

/** Daily USD→EUR so USD market prices can be shown in the user's currency. */
export const fxRates = pgTable(
  "fx_rates",
  {
    base: text("base").notNull(),
    quote: text("quote").notNull(),
    rate: real("rate").notNull(),
    asOf: date("as_of").notNull(),
  },
  (t) => [primaryKey({ columns: [t.base, t.quote, t.asOf] })],
);

export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  /** "catalog" | "prices" | "fx". */
  source: text("source").notNull(),
  /** "running" | "ok" | "error". */
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  summary: jsonb("summary"),
  error: text("error"),
});

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Collection — one row per *lot*: a quantity of one print in one condition,
 *  bought together. The same card can have several lots.
 * ──────────────────────────────────────────────────────────────────────────
 */

export const ownedCards = pgTable(
  "owned_cards",
  {
    id: serial("id").primaryKey(),
    printId: text("print_id")
      .notNull()
      .references(() => cardPrints.id, { onDelete: "restrict" }),
    /** Denormalised from the print so reservation sums never need a join. */
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    /** NM | LP | MP | HP | DMG */
    condition: text("condition").notNull().default("NM"),
    /** normal | foil */
    finish: text("finish").notNull().default("normal"),
    language: text("language").notNull().default("EN"),
    acquiredOn: date("acquired_on"),
    /** Per copy, in `currency` minor units. */
    pricePaidCents: integer("price_paid_cents"),
    currency: text("currency").notNull().default("EUR"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("owned_cards_card_idx").on(t.cardId), index("owned_cards_print_idx").on(t.printId)],
);

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Decks — virtual decks are unconstrained; a deck flagged built reserves its
 *  copies against the collection. Reservations are *computed* (sum of built
 *  decks' deck_cards per card vs. sum of owned_cards.quantity), never stored,
 *  so they can't drift. See src/lib/decks/reservations.ts.
 * ──────────────────────────────────────────────────────────────────────────
 */

export const decks = pgTable("decks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  /** Free-form notes about the current meta, fed to the AI wizard. */
  metaNotes: text("meta_notes"),
  isBuilt: boolean("is_built").notNull().default(false),
  builtAt: timestamp("built_at", { withTimezone: true }),
  aiSummary: text("ai_summary"),
  aiSummaryAt: timestamp("ai_summary_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const deckCards = pgTable(
  "deck_cards",
  {
    deckId: integer("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** leader | main | z | side */
    zone: text("zone").notNull().default("main"),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.deckId, t.cardId, t.zone] }),
    index("deck_cards_card_idx").on(t.cardId),
  ],
);

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  CardTrader — EU marketplace (read-only). Blueprints are CardTrader's
 *  catalog entries, cross-walked to our cards via TCGplayer ids; listings are
 *  cached per on-demand lookup with a timestamp.
 * ──────────────────────────────────────────────────────────────────────────
 */

export const ctExpansions = pgTable("ct_expansions", {
  id: integer("id").primaryKey(),
  gameId: integer("game_id").notNull(),
  code: text("code"),
  name: text("name").notNull(),
});

export const ctBlueprints = pgTable(
  "ct_blueprints",
  {
    id: integer("id").primaryKey(),
    expansionId: integer("expansion_id").references(() => ctExpansions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    version: text("version"),
    imageUrl: text("image_url"),
    tcgPlayerId: integer("tcg_player_id"),
    cardMarketIds: jsonb("card_market_ids"),
    /** Collector number etc. as CardTrader reports it. */
    fixedProperties: jsonb("fixed_properties"),
    cardId: text("card_id").references(() => cards.id, { onDelete: "set null" }),
    printId: text("print_id").references(() => cardPrints.id, { onDelete: "set null" }),
    /** "tcgplayer" | "number" | null — how the crosswalk was made. */
    matchedBy: text("matched_by"),
  },
  (t) => [index("ct_blueprints_card_idx").on(t.cardId), index("ct_blueprints_tcg_idx").on(t.tcgPlayerId)],
);

export const ctListings = pgTable(
  "ct_listings",
  {
    id: integer("id").primaryKey(),
    blueprintId: integer("blueprint_id")
      .notNull()
      .references(() => ctBlueprints.id, { onDelete: "cascade" }),
    cardId: text("card_id").references(() => cards.id, { onDelete: "cascade" }),
    sellerId: integer("seller_id").notNull(),
    seller: text("seller").notNull(),
    countryCode: text("country_code"),
    canSellViaHub: boolean("can_sell_via_hub").notNull().default(false),
    onVacation: boolean("on_vacation").notNull().default(false),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull(),
    quantity: integer("quantity").notNull(),
    condition: text("condition"),
    language: text("language"),
    foil: boolean("foil").notNull().default(false),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ct_listings_card_idx").on(t.cardId), index("ct_listings_blueprint_idx").on(t.blueprintId)],
);

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Scan batches — a scan started on the phone can be finished on the PC.
 *  Photos are kept (downscaled, exactly what Claude saw) only while the batch
 *  is open; completing or discarding it deletes them.
 * ──────────────────────────────────────────────────────────────────────────
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const scanBatches = pgTable("scan_batches", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** single | batch — default for photos added to this batch. */
  mode: text("mode").notNull().default("single"),
  /** open | done */
  status: text("status").notNull().default("open"),
  addedCount: integer("added_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const scanPhotos = pgTable(
  "scan_photos",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => scanBatches.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    /** Downscaled JPEG; null once the batch is finished. */
    data: bytea("data"),
    width: integer("width").notNull().default(0),
    height: integer("height").notNull().default(0),
    /** reading | done | error */
    status: text("status").notNull().default("reading"),
    error: text("error"),
    found: integer("found"),
    unreadable: integer("unreadable"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scan_photos_batch_idx").on(t.batchId)],
);

export const scanItems = pgTable(
  "scan_items",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id")
      .notNull()
      .references(() => scanBatches.id, { onDelete: "cascade" }),
    photoId: integer("photo_id")
      .notNull()
      .references(() => scanPhotos.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull().default(0),
    /** The ScanDetection as returned by identifyCards. */
    detection: jsonb("detection").notNull(),
    /** The ScanCandidate the user (or the scanner) settled on. */
    chosen: jsonb("chosen"),
    manual: boolean("manual").notNull().default(false),
    printId: text("print_id").references(() => cardPrints.id, { onDelete: "set null" }),
    quantity: integer("quantity").notNull().default(1),
    condition: text("condition").notNull().default("NM"),
    finish: text("finish").notNull().default("normal"),
    include: boolean("include").notNull().default(true),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scan_items_batch_idx").on(t.batchId), index("scan_items_photo_idx").on(t.photoId)],
);

/** Every Claude call, kept so results can be re-shown without re-paying for them. */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: serial("id").primaryKey(),
    /** deck_summary | deck_wizard | set_review | scan_identify | cart_explain */
    kind: text("kind").notNull(),
    deckId: integer("deck_id").references(() => decks.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    input: jsonb("input"),
    output: jsonb("output"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_runs_deck_idx").on(t.deckId)],
);

/** Key/value app settings (default currency, preferences, …). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
