/**
 * `npm run import:starters` — create the preconstructed starter decks as
 * *virtual* decks, so you can see what a product contains without owning it.
 *
 * Only decks whose per-copy list is actually verifiable are in here. Bandai
 * publishes the distinct cards in each product but never how many of each, so
 * every quantity below comes from a community reproduction — and the research
 * that produced them is explicit that a list which does not sum to exactly 50
 * main-deck cards is a partial transcription and must not be imported. That
 * gate is enforced here rather than trusted: three lists that were handed over
 * as "fully confirmed" sum to 64, 42 and 51, and are therefore absent.
 *
 * Nothing is guessed. A card is resolved by printed number where the source
 * gives one, by the set's single Leader for a leader slot, and otherwise by an
 * exact name match against the catalog. If any one entry of a deck fails to
 * resolve, or the copies do not total 50, the **whole deck is skipped** and
 * the reason printed — a starter deck missing three cards is worse than no
 * starter deck, because it looks complete.
 *
 * Idempotent: a deck whose name already exists is left alone.
 *
 *   npx tsx scripts/import-starter-decks.mts            # dry run, changes nothing
 *   npx tsx scripts/import-starter-decks.mts --commit   # write the decks
 */
import nextEnv from "@next/env";
// Erased at build time, so it does not pull the module in before the env loads.
import type { Game } from "../src/lib/catalog/games.ts";

const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd());

const { db } = await import("../src/db/index.ts");
const { cards, deckCards, decks } = await import("../src/db/schema.ts");
const { and, eq, inArray, sql } = await import("drizzle-orm");
const { legality } = await import("../src/lib/decks/legality.ts");
const { deckRules } = await import("../src/lib/catalog/games.ts");

const COMMIT = process.argv.includes("--commit");
/** Print what every line resolved to — the check on a name-matched list. */
const VERBOSE = process.argv.includes("--verbose");

/** One line of a printed decklist. `number` wins over `name` when both exist. */
interface Entry {
  quantity: number;
  /** Printed card number, when the source gives one — always preferred. */
  number?: string;
  /** Card name as the source prints it, matched exactly against the catalog. */
  name?: string;
  /** The deck's Leader. Resolved as "the one LEADER card in this set". */
  leader?: true;
}

interface StarterDeck {
  name: string;
  game: Game;
  /** Catalog set code, used to resolve the leader and to break name ties. */
  setCode: string;
  /** Where the per-copy quantities come from, kept in the deck description. */
  source: string;
  entries: Entry[];
}

const n = (quantity: number, name: string): Entry => ({ quantity, name });
const id = (quantity: number, number: string): Entry => ({ quantity, number });

/*
 * ── Dragon Ball Super (Masters / legacy) ─────────────────────────────────
 *
 * Four of the twenty-three starter decks have a per-copy list that both is
 * reproduced from a single high-quality source and sums to 50. The rest are
 * either name-only ("5 exclusive types", no quantities) or transcriptions that
 * do not add up, and are deliberately not here.
 */
const MASTERS: StarterDeck[] = [
  {
    name: "[Starter] The Extreme Evolution",
    game: "dbs",
    setCode: "SD2",
    source: "poggers.com reproduction of SD02; main deck sums to 50.",
    entries: [
      { quantity: 1, leader: true },
      n(4, "Unbreakable Super Saiyan Son Goku"),
      n(4, "Pint-sized Warrior Son Goku"),
      n(4, "Shocking Future Son Goku"),
      n(4, "Quick Rush Trunks"),
      n(4, "Handy Giru"),
      n(4, "Hidden Power Uub"),
      n(4, "Bodyguard Ledgic"),
      n(4, "Unending Awakening"),
      n(4, "Grand Tour Spaceship"),
      n(2, "Broken Limits Super Saiyan 3 Son Goku"),
      n(2, "Rushing Warrior Pan"),
      n(2, "Chain Attack Trunks"),
      n(2, "Pan"),
      n(2, "Power-absorbing Luud"),
      n(2, "Dr. Myuu Under Baby's Control"),
      n(2, "Hidden Ability, General Rilldo"),
    ],
  },
  {
    name: "[Starter] The Crimson Saiyan",
    game: "dbs",
    setCode: "SD5",
    source: "poggers.com reproduction of SD05; main deck sums to 50.",
    entries: [
      { quantity: 1, leader: true },
      n(4, "SSB Son Goku, at the Apex"),
      n(4, "Indomitable Dynasty SS Son Goku"),
      n(4, "Dependable Dynasty Son Goku"),
      n(4, "Dynasty Deferred Son Goku"),
      n(4, "Intrepid Dynasty Son Gohan"),
      n(4, "Prodigal Dynasty Son Goten"),
      n(4, "Plucky Dynasty Pan"),
      n(4, "Dynasty's Solace Chi-Chi"),
      n(4, "Adoptive Father Son Gohan"),
      n(4, "Instant Transmission"),
      n(2, "Power Charge Bardock"),
      n(2, "Reborn Might SS4 Son Goku"),
      n(2, "Ultimate Potential SS2 Son Gohan"),
      n(2, "Unbroken Dynasty Son Goku"),
      n(2, "10x Kamehameha"),
    ],
  },
  {
    name: "[Starter] Clan Collusion",
    game: "dbs",
    setCode: "SD13",
    source: "poggers.com reproduction of SD13; main deck sums to 50.",
    entries: [
      { quantity: 1, leader: true },
      n(4, "Avenging Frieza"),
      n(4, "Yamcha, the Cunning"),
      n(4, "Frieza, Cosmic Horror"),
      n(4, "Frieza, Terrifying Transformation"),
      n(4, "Dodoria the Cold-Blooded"),
      n(4, "Zarbon the Gorgeous"),
      n(4, "Frieza's Call"),
      n(4, "Shocking Death Ball"),
      n(4, "One-Star Ball, Parasitic Darkness"),
      n(3, "Frieza the Power Monger"),
      id(2, "SD13-02"), // Frieza: Xeno, Darkness Overflowing (Unison)
      n(2, "Ginyu, Frieza's Greatest Soldier"),
      n(2, "Zarbon, Frieza's Right-Hand Man"),
      n(2, "Dodoria, Frieza's Devoted Servant"),
      n(2, "Burter, Fastest in the Universe"),
      n(1, "Cold Bloodlust"),
    ],
  },
  {
    // The only Masters list given entirely as card numbers, and the only one
    // sourced from Bandai's own "Pieces" table rather than a fan transcription.
    name: "[Starter] Pride of the Saiyans",
    game: "dbs",
    setCode: "SD15",
    source: "athenagames.com reproduction of Bandai's official SD15 Pieces table; main deck sums to 50.",
    entries: [
      { quantity: 1, leader: true },
      id(2, "SD15-02"),
      id(2, "SD15-03"),
      id(2, "SD15-04"),
      id(2, "SD15-05"),
      id(2, "BT1-014"),
      id(2, "BT1-027"),
      id(2, "BT3-027"),
      id(2, "BT4-012"),
      id(2, "BT5-023"),
      id(2, "BT6-010"),
      id(2, "BT6-011"),
      id(2, "BT6-025"),
      id(2, "BT6-026"),
      id(2, "BT9-031"),
      id(2, "BT10-008"),
      id(2, "BT11-008"),
      id(2, "BT11-011"),
      id(2, "BT14-006"),
      id(4, "BT14-010"),
      id(2, "TB1-023"),
      id(2, "TB1-055"),
      id(2, "DB1-019"),
      id(2, "DB2-004"),
      id(2, "DB3-001"),
    ],
  },
];

/*
 * ── Fusion World ─────────────────────────────────────────────────────────
 *
 * The four launch starter decks. Every one is given as printed card numbers
 * rather than names, which is why they resolve exactly; each sums to 51
 * (50 + Leader). Fusion World has no Z-Deck, so everything but the Leader is
 * main deck.
 */
const FUSION: StarterDeck[] = [
  {
    name: "[Starter] Son Goku",
    game: "fusion",
    setCode: "FS01",
    source: "alcasthq.com FS01 decklist; sums to 51 (50 + Leader).",
    entries: [
      { quantity: 1, leader: true },
      id(4, "FS01-02"), id(4, "FS01-03"), id(2, "FS01-04"), id(4, "FS01-05"),
      id(4, "FS01-06"), id(4, "FS01-07"), id(2, "FS01-08"), id(2, "FS01-09"),
      id(4, "FS01-10"), id(4, "FS01-11"), id(2, "FS01-12"), id(4, "FS01-13"),
      id(4, "FS01-14"), id(2, "FS01-15"), id(4, "FS01-16"),
    ],
  },
  {
    name: "[Starter] Vegeta",
    game: "fusion",
    setCode: "FS02",
    source: "alcasthq.com FS02 decklist; sums to 51 (50 + Leader).",
    entries: [
      { quantity: 1, leader: true },
      id(4, "FS02-02"), id(2, "FS02-03"), id(4, "FS02-04"), id(4, "FS02-05"),
      id(4, "FS02-06"), id(2, "FS02-07"), id(4, "FS02-08"), id(4, "FS02-09"),
      id(2, "FS02-10"), id(4, "FS02-11"), id(4, "FS02-12"), id(2, "FS02-13"),
      id(4, "FS02-14"), id(2, "FS02-15"), id(4, "FS02-16"),
    ],
  },
  {
    name: "[Starter] Broly",
    game: "fusion",
    setCode: "FS03",
    source: "alcasthq.com FS03 decklist; sums to 51 (50 + Leader).",
    entries: [
      { quantity: 1, leader: true },
      id(4, "FS03-02"), id(4, "FS03-03"), id(2, "FS03-04"), id(4, "FS03-05"),
      id(4, "FS03-06"), id(2, "FS03-07"), id(4, "FS03-08"), id(4, "FS03-09"),
      id(2, "FS03-10"), id(2, "FS03-11"), id(4, "FS03-12"), id(4, "FS03-13"),
      id(4, "FS03-14"), id(2, "FS03-15"), id(4, "FS03-16"),
    ],
  },
  {
    name: "[Starter] Frieza",
    game: "fusion",
    setCode: "FS04",
    source: "alcasthq.com FS04 decklist, cross-checked against tcgviert.com; sums to 51 (50 + Leader).",
    entries: [
      { quantity: 1, leader: true },
      id(4, "FS04-02"), id(2, "FS04-03"), id(2, "FS04-04"), id(2, "FS04-05"),
      id(4, "FS04-06"), id(4, "FS04-07"), id(4, "FS04-08"), id(4, "FS04-09"),
      id(4, "FS04-10"), id(4, "FS04-11"), id(2, "FS04-12"), id(4, "FS04-13"),
      id(4, "FS04-14"), id(4, "FS04-15"), id(2, "FS04-16"),
    ],
  },
];

const ALL = [...MASTERS, ...FUSION];

// ── resolution ─────────────────────────────────────────────────────────────

/** Names are compared on a normal form: case, punctuation and spacing vary. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9']+/g, " ")
    .trim();
}

type CardRow = {
  id: string;
  name: string;
  setCode: string;
  cardType: string;
  game: string;
  colors: string[];
  limitedTo: number | null;
  isBanned: boolean;
  skill: string | null;
};

const CARD_COLUMNS = {
  id: cards.id,
  name: cards.name,
  setCode: cards.setCode,
  cardType: cards.cardType,
  game: cards.game,
  colors: cards.colors,
  limitedTo: cards.limitedTo,
  isBanned: cards.isBanned,
  skill: cards.skill,
};

interface Resolved {
  cardId: string;
  quantity: number;
  zone: "leader" | "main";
}

async function resolveDeck(deck: StarterDeck): Promise<{ rows: Resolved[]; problems: string[]; catalog: Map<string, CardRow> }> {
  const problems: string[] = [];
  const rows: Resolved[] = [];

  const inSet = (await db
    .select(CARD_COLUMNS)
    .from(cards)
    .where(eq(cards.setCode, deck.setCode))) as CardRow[];

  const names = deck.entries.filter((e) => e.name).map((e) => norm(e.name!));
  const byName = new Map<string, CardRow[]>();
  if (names.length) {
    // One query for every name in the deck, matched on the same normal form
    // the transcription is compared with.
    const found = (await db
      .select(CARD_COLUMNS)
      .from(cards)
      .where(and(eq(cards.game, deck.game), inArray(sql`lower(regexp_replace(${cards.name}, '[^A-Za-z0-9'']+', ' ', 'g'))`, names.map((x) => x))))) as CardRow[];
    for (const c of found) {
      const k = norm(c.name);
      byName.set(k, [...(byName.get(k) ?? []), c]);
    }
  }

  const catalog = new Map<string, CardRow>();
  for (const e of deck.entries) {
    let hit: CardRow | undefined;

    if (e.leader) {
      const leaders = inSet.filter((c) => c.cardType === "LEADER");
      if (leaders.length !== 1) {
        problems.push(`leader: set ${deck.setCode} has ${leaders.length} LEADER cards, expected exactly 1`);
        continue;
      }
      hit = leaders[0];
    } else if (e.number) {
      hit = (await db
        .select(CARD_COLUMNS)
        .from(cards)
        .where(eq(cards.id, e.number)))[0] as CardRow | undefined;
      if (!hit) problems.push(`${e.number}: no such card in the catalog`);
    } else if (e.name) {
      const matches = byName.get(norm(e.name)) ?? [];
      if (matches.length === 0) {
        problems.push(`"${e.name}": no card of that name in ${deck.game}`);
      } else if (matches.length === 1) {
        hit = matches[0];
      } else {
        // Several cards share the name. The deck's own set breaks the tie;
        // anything else is a guess, so it is reported instead.
        const own = matches.filter((c) => c.setCode === deck.setCode);
        if (own.length === 1) hit = own[0];
        else problems.push(`"${e.name}": ambiguous — ${matches.map((c) => `${c.id} (${c.setCode})`).join(", ")}`);
      }
    }

    if (!hit) continue;
    if (hit.game !== deck.game) {
      problems.push(`${hit.id} ${hit.name}: belongs to ${hit.game}, not ${deck.game}`);
      continue;
    }
    catalog.set(hit.id, hit);
    rows.push({ cardId: hit.id, quantity: e.quantity, zone: hit.cardType === "LEADER" ? "leader" : "main" });
  }

  return { rows, problems, catalog };
}

// ── run ────────────────────────────────────────────────────────────────────

let created = 0;
let skipped = 0;

for (const deck of ALL) {
  const existing = await db.query.decks.findFirst({ where: eq(decks.name, deck.name), columns: { id: true } });
  if (existing) {
    console.log(`— ${deck.name}: already exists (deck ${existing.id}), left alone`);
    skipped++;
    continue;
  }

  const { rows, problems, catalog } = await resolveDeck(deck);
  const main = rows.filter((r) => r.zone === "main").reduce((t, r) => t + r.quantity, 0);
  const leaders = rows.filter((r) => r.zone === "leader").reduce((t, r) => t + r.quantity, 0);
  const rules = deckRules(deck.game);

  if (main !== rules.main) problems.push(`main deck totals ${main}, expected exactly ${rules.main}`);
  if (leaders !== 1) problems.push(`${leaders} leader(s), expected exactly 1`);

  if (problems.length) {
    console.log(`✗ ${deck.name}: NOT imported`);
    for (const p of problems) console.log(`    ${p}`);
    skipped++;
    continue;
  }

  /*
   * Run the app's own rules over the resolved deck and *report* what they say.
   * This does not block: a preconstructed deck is a historical artefact, and
   * several contain cards that were banned years after the product shipped.
   * Refusing to import those would lose the truth about what was in the box —
   * the deck page flags them anyway, which is exactly the right place.
   */
  const check = legality(
    rows.map((r) => {
      const c = catalog.get(r.cardId)!;
      return { cardId: r.cardId, zone: r.zone, quantity: r.quantity, name: c.name, cardType: c.cardType, colors: c.colors, limitedTo: c.limitedTo, isBanned: c.isBanned, skill: c.skill, game: deck.game };
    }),
    deck.game,
  );

  console.log(`✓ ${deck.name} — ${main} main + leader ${rows.find((r) => r.zone === "leader")!.cardId} (${check.status})`);
  for (const i of check.issues.filter((x) => x.severity !== "incomplete")) console.log(`    note: ${i.message}`);
  if (VERBOSE) {
    for (const r of rows) {
      const c = catalog.get(r.cardId)!;
      console.log(`    ${String(r.quantity).padStart(2)}× ${r.cardId.padEnd(10)} ${c.name}${r.zone === "leader" ? "  (Leader)" : ""}`);
    }
  }
  if (!COMMIT) continue;

  const description = `Preconstructed ${deck.setCode} starter deck, imported as a virtual deck.\nQuantities: ${deck.source}`;
  const [row] = await db.insert(decks).values({ name: deck.name, game: deck.game, description }).returning({ id: decks.id });
  await db.insert(deckCards).values(rows.map((r) => ({ deckId: row.id, cardId: r.cardId, zone: r.zone, quantity: r.quantity })));
  created++;
}

console.log(
  COMMIT
    ? `\nDone: ${created} deck(s) created, ${skipped} skipped.`
    : `\nDry run — nothing written. ${skipped} skipped. Re-run with --commit to create the rest.`,
);
process.exit(0);
