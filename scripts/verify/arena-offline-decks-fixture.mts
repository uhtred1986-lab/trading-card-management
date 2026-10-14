/**
 * #793's live-data fixture, on PGlite (no Neon, no network): every migration, the committed
 * snapshot's cards as a catalog sync would have stored them, the owner's specified costs (migration
 * 0049 put them in the live database), and `card_rules` written by the drafter and confirmed — the
 * records a player's deck is read from. Shared by `arena-offline-decks-793.mts` (`npm test`) and
 * `scripts/arena-offline-decks-browser.mts`.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { DECKS, loadSnapshot, resolveDeck, type DeckSpec } from "../arena-deck-audit.mts";
import { OWNER_SPECIFIED_COSTS } from "../build-arena-offline-pack.mts";
import { draftCards } from "../../src/lib/arena/draft.ts";

export interface LiveFixture {
  client: PGlite;
  db: Db;
  snapshot: ReturnType<typeof loadSnapshot>;
  owner: Record<string, string>;
  specA: DeckSpec;
  specB: DeckSpec;
  addDeck(owner: string | null, name: string, spec: DeckSpec, game?: string): Promise<number>;
}

export async function liveFixture(): Promise<LiveFixture> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  for (const file of fs.readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of fs.readFileSync(path.join("drizzle", file), "utf8").split("--> statement-breakpoint")) if (stmt.trim()) await client.exec(stmt);
  }
  const snapshot = loadSnapshot();
  const sets = [...new Set(snapshot.cards.map((c) => c.setCode))];
  await db.insert(schema.cardSets).values(sets.map((code, i) => ({ code, name: code, line: "masters", sortKey: i, game: "dbs" }))).onConflictDoNothing();
  await db.insert(schema.cards).values(snapshot.cards.map((c) => ({ ...c }) as typeof schema.cards.$inferInsert)).onConflictDoNothing();
  for (const [id, cost] of Object.entries(OWNER_SPECIFIED_COSTS)) await db.update(schema.cards).set({ specifiedCost: cost }).where(eq(schema.cards.id, id));
  // Rule records, the drafter's way (the only module that compiles; the pack never does). Drafts the
  // compiler read fully are what a person would confirm; confirm them, as the review queue does.
  await draftCards(db, snapshot.cards.map((c) => c.id));
  await db.update(schema.cardRules).set({ status: "confirmed" }).where(eq(schema.cardRules.status, "draft"));
  async function addDeck(owner: string | null, name: string, spec: DeckSpec, game = "dbs"): Promise<number> {
    const [d] = await db.insert(schema.decks).values({ name, owner, game }).returning({ id: schema.decks.id });
    const { rows } = resolveDeck(spec, snapshot.cards);
    await db.insert(schema.deckCards).values(rows.map((r) => ({ deckId: d.id, cardId: r.card.id, zone: r.zone, quantity: r.quantity })));
    return d.id;
  }
  return { client, db, snapshot, owner: OWNER_SPECIFIED_COSTS, specA: DECKS.find((d) => d.key === "A")!, specB: DECKS.find((d) => d.key === "B")!, addDeck };
}
