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
  uniqueIndex,
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
    /** Awakened side of a leader; null for single-sided cards. */
    backImageUrl: text("back_image_url"),
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

/**
 * Where cards physically live — "Binder 1 page 4", "Trade box", "Deck shelf".
 * Maintained in settings and attached to individual copies, so a card can be
 * found again without turning the shelf out.
 */
export const storageLocations = pgTable("storage_locations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  note: text("note"),
  /** Hidden from the pickers without deleting it, so old assignments survive. */
  isArchived: boolean("is_archived").notNull().default(false),
  sortKey: integer("sort_key").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("storage_locations_name_unique").on(t.name)]);

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Collection — **one row per physical card**. There is deliberately no
 *  quantity column: adding "2 copies" writes two rows, so each copy carries
 *  its own finish, condition and price and can be assigned individually.
 *  See src/lib/collection/lots.ts.
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
    /** Basic Auth username that added the lot; null when the app runs open (local dev). */
    owner: text("owner"),
    /** Where this particular card is kept. */
    locationId: integer("location_id").references(() => storageLocations.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("owned_cards_card_idx").on(t.cardId), index("owned_cards_print_idx").on(t.printId), index("owned_cards_owner_idx").on(t.owner)],
);

/*
 * ──────────────────────────────────────────────────────────────────────────
 *  Decks — virtual decks are unconstrained; a deck flagged built reserves its
 *  copies against the collection. Reservations are *computed* (sum of built
 *  decks' deck_cards per card vs. the number of owned_cards rows), never stored,
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
  /** Where the built deck physically sits — the same list the copies use. */
  locationId: integer("location_id").references(() => storageLocations.id, { onDelete: "set null" }),
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
    /** Leader back side as CardTrader hosts it — used when deckplanet has none. */
    backImageUrl: text("back_image_url"),
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
  /** Deck the confirmed cards are also added to, if one was chosen. */
  deckId: integer("deck_id").references(() => decks.id, { onDelete: "set null" }),
  /** Who the scanned cards belong to; chosen on the phone, honoured on the PC. */
  owner: text("owner"),
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

/**
 * Swap suggestions from the improvement wizard, kept so a deck doesn't have to
 * be re-analysed every time it is opened. One row per proposed replacement;
 * a card can have several, and the deck page lets you page through them.
 * They expire after a week — the meta and your collection both move on.
 */
export const deckSwaps = pgTable(
  "deck_swaps",
  {
    id: serial("id").primaryKey(),
    deckId: integer("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    outCardId: text("out_card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    inCardId: text("in_card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    outQuantity: integer("out_quantity").notNull().default(1),
    inQuantity: integer("in_quantity").notNull().default(1),
    rationale: text("rationale").notNull(),
    /** high | medium | low */
    priority: text("priority").notNull().default("medium"),
    /** open | applied | dismissed */
    status: text("status").notNull().default("open"),
    /** What you asked for when this run was made, shown alongside the advice. */
    context: text("context"),
    runId: integer("run_id").references(() => aiRuns.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("deck_swaps_deck_idx").on(t.deckId),
    index("deck_swaps_out_idx").on(t.deckId, t.outCardId),
    // Re-running the wizard refreshes a repeated suggestion instead of duplicating it.
    uniqueIndex("deck_swaps_unique").on(t.deckId, t.outCardId, t.inCardId),
  ],
);

/** Cards to buy — fed by the swap suggestions and read by the cart optimiser. */
export const wantList = pgTable(
  "want_list",
  {
    id: serial("id").primaryKey(),
    cardId: text("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull().default(1),
    note: text("note"),
    /** The deck the want came from, if any. */
    deckId: integer("deck_id").references(() => decks.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("want_list_card_unique").on(t.cardId)],
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

/**
 * Logins. The app has no session system: `src/proxy.ts` checks HTTP Basic Auth
 * against these rows (and against the BASIC_AUTH_* env pair, which always works
 * so a bad row can't lock everyone out). `owner` is what gets stamped on cards
 * this person adds, so two logins can share one owner or one login can add on
 * someone else's behalf.
 */
export const appUsers = pgTable("app_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  /** scrypt$<salt hex>$<key hex> — see src/lib/auth/password.ts. */
  passwordHash: text("password_hash").notNull(),
  owner: text("owner").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Key/value app settings (default currency, preferences, …). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
