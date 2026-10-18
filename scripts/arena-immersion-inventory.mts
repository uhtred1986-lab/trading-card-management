/**
 * `npm run arena:immersion-inventory` (#852): which characters and forms do the owner's real decks
 * actually use, and which of those does src/lib/arena/immersion/characters.json already cover?
 *
 * READ-ONLY. Selects owner-scoped game=dbs decks (built AND virtual, is_testing=false), their cards
 * and both Leader faces, merges duplicate forms keeping every card id, audits the repository's
 * AI-training fixtures for legacy unflagged decks (listing the uncertain ones, never excluding by
 * name alone, never touching a deck), and writes sanitized JSON + CSV: no deck names, descriptions,
 * owners or deck ids. Counts here are the current decks' needs, not catalog-wide coverage.
 *
 *   npm run arena:immersion-inventory                    # writes docs/arena-backlog/evidence/immersion/inventory/
 *   npm run arena:immersion-inventory -- --owner NAME    # needed only when decks belong to several owners
 *   npm run arena:immersion-inventory -- --out-dir DIR
 *
 * Needs DATABASE_URL for THIS app (docs/agent-brief.md, "When the owner asks for live data").
 */
import nextEnv from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inArray } from "drizzle-orm";
import characters from "../src/lib/arena/immersion/characters.json" with { type: "json" };
import { TESTING_DECK_CATALOG } from "../src/lib/arena/testing/catalog.ts";
import { firstWaveRecipes } from "./lib/arena-firstwave-recipes.mts";
import {
  buildInventory, inventoryCsv, listSignature,
  type CardRow, type DeckCardRow, type DeckRow, type MappingRow, type TrainingFixture,
} from "./lib/immersion-inventory.mts";

nextEnv.loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const outDir = flag("--out-dir") ?? "docs/arena-backlog/evidence/immersion/inventory";
const owner = flag("--owner");

/** Everything in the repository that is known to be an AI-training / planned-testing recipe. */
export function repoTrainingFixtures(): TrainingFixture[] {
  const fixtures: TrainingFixture[] = TESTING_DECK_CATALOG.map((d) => ({ name: d.name, source: "testing/catalog.ts", leaderId: d.leaderId }));
  for (const r of firstWaveRecipes()) {
    const rows = [
      { cardId: r.leader, zone: "leader", quantity: 1 },
      ...r.main.map((x) => ({ ...x, zone: "main" })),
      ...r.z.map((x) => ({ ...x, zone: "z" })),
    ];
    fixtures.push({ name: r.name, source: "arena-firstwave-recipes", leaderId: r.leader, signature: listSignature(rows) });
  }
  return fixtures;
}

const { db } = await import("../src/db/index.ts");
const { cards, deckCards, decks } = await import("../src/db/schema.ts");

const deckRows: DeckRow[] = (await db
  .select({ id: decks.id, game: decks.game, isBuilt: decks.isBuilt, isTesting: decks.isTesting, owner: decks.owner, name: decks.name, description: decks.description })
  .from(decks)) as DeckRow[];
const dbsIds = deckRows.filter((d) => d.game === "dbs").map((d) => d.id);
const deckCardRows: DeckCardRow[] = dbsIds.length
  ? ((await db.select().from(deckCards).where(inArray(deckCards.deckId, dbsIds))) as DeckCardRow[])
  : [];
const cardIds = [...new Set(deckCardRows.map((r) => r.cardId))];
const cardRows: CardRow[] = [];
for (let i = 0; i < cardIds.length; i += 500) {
  cardRows.push(...((await db
    .select({ id: cards.id, name: cards.name, cardType: cards.cardType, characters: cards.characters, backName: cards.backName })
    .from(cards)
    .where(inArray(cards.id, cardIds.slice(i, i + 500)))) as CardRow[]));
}

const inventory = buildInventory({
  decks: deckRows, deckCards: deckCardRows, cards: cardRows, fixtures: repoTrainingFixtures(),
  mappings: characters.mappings as MappingRow[], owner, now: new Date(),
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
writeFileSync(join(outDir, "inventory.csv"), inventoryCsv(inventory));
console.log(JSON.stringify({ generatedAt: inventory.generatedAt, snapshotHash: inventory.snapshotHash, counts: inventory.counts, coverage: inventory.coverage, review: inventory.review.length, wrote: outDir }, null, 2));
process.exit(0);
