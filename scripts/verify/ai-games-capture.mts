/**
 * Records what the Dragon Ball Claude features send, for the game-neutral layer's equality test
 * (`ai-games.mts`, lane I of docs/pokemon/plan.md). It only uses the public entry points that exist
 * since before the layer (`summariseDeck`, `runWizard`, `reviewSet`, `suggestDeck`,
 * `suggestDeckFromCard`), so the SAME file ran on the base commit to record
 * `fixtures/ai-games/dragonball-requests.json`, and runs on the branch to compare.
 *
 * Everything is on PGlite and the recorded Anthropic transport (`ai-harness.ts`): the wire bodies
 * are what reaches the API, the `ai_runs` rows and created decks are what is stored. No network.
 */
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { asc, eq } from "drizzle-orm";
import * as schema from "../../src/db/schema.ts";
import type { Db } from "../../src/db/index.ts";
import { anthropicHarness } from "./ai-harness.ts";
import { registerProvider, resetProviders } from "../../src/lib/ai/providers/index.ts";

export async function pgliteDb(): Promise<Db> {
  const client = new PGlite();
  const dir = path.resolve("drizzle");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, file), "utf8").split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await client.exec(s);
    }
  }
  return drizzle(client, { schema }) as unknown as Db;
}

type GameKey = "dbs" | "fusion";
const SET: Record<GameKey, { code: string; line: string }> = { dbs: { code: "BT18", line: "masters" }, fusion: { code: "FB01", line: "fusion" } };

/** A small, fixed catalog for one game: two leaders, 40 red battle cards, two extras (and Z cards for dbs). */
async function seed(db: Db, game: GameKey) {
  const { code, line } = SET[game];
  await db.insert(schema.cardSets).values({ code, name: `${game} test set`, game, line, sortKey: 18 });
  const base = { setCode: code, game, rarity: "Common[C]", rarityCode: "C" };
  const row = (id: string, name: string, cardType: string, colors: string[], extra: Partial<typeof schema.cards.$inferInsert> = {}) => ({
    ...base,
    id,
    name,
    cardType,
    colors,
    searchText: `${id} ${name}`.toLowerCase(),
    ...extra,
  });
  const values: (typeof schema.cards.$inferInsert)[] = [
    row(`${code}-001`, "Test Leader", "LEADER", ["Red"], { power: 15000, skill: "[Leader] Your Battle cards gain +5000 power.<br>[Awakening] Draw 1 card.", traits: ["Saiyan"], backName: "Test Leader Awakened", backSkill: "[Auto] When this attacks, draw 1." }),
    row(`${code}-002`, "Red Blue Leader", "LEADER", ["Red", "Blue"], { power: 15000, skill: "[Leader] Draw 1 card at the start of your turn.", traits: ["Saiyan"] }),
    row(`${code}-003`, "Blue Leader", "LEADER", ["Blue"], { power: 15000, skill: "[Leader] Nothing.", traits: ["Android"] }),
  ];
  for (let n = 10; n < 50; n++) {
    values.push(
      row(`${code}-0${n}`, `Fighter ${n}`, "BATTLE", ["Red"], {
        energyCost: String(n % 6),
        power: 5000 + (n % 6) * 1000,
        skill: n % 3 === 0 ? `[Auto] When this attacks, draw ${n % 2 + 1} card. {Fighter ${n}} <Saiyan>` : "[Blitz]",
        traits: n % 2 ? ["Saiyan"] : ["Namekian"],
        rarityCode: n % 5 === 0 ? "R" : "C",
      }),
    );
  }
  values.push(row(`${code}-060`, "Colourless Tool", "EXTRA", ["Colorless"], { energyCost: "1", skill: "[Main] Draw 1 card." }));
  values.push(row(`${code}-061`, "Colourless Tool 2", "EXTRA", ["Colorless"], { energyCost: "2", skill: "[Main] Draw 2 cards." }));
  if (game === "dbs") {
    values.push(row(`${code}-070`, "Z Strike", "Z-BATTLE", [], { energyCost: "0", power: 3000, skill: "[Z] Something." }));
  }
  await db.insert(schema.cards).values(values);
  // A leader and a handful of battle cards owned, so "owned" scopes have rows.
  const owned = [`${code}-001`, `${code}-010`, `${code}-011`, `${code}-030`, `${code}-031`, `${code}-032`, `${code}-060`];
  await db.insert(schema.cardPrints).values(owned.map((id) => ({ id, cardId: id, suffix: "", label: "Standard", rarity: "C", isBase: true })));
  await db.insert(schema.ownedCards).values(owned.flatMap((id) => [{ printId: id, cardId: id }, { printId: id, cardId: id }]));
  return { code };
}

const pick = (code: string, ns: number[], quantity = 4) => ns.map((n) => ({ cardId: `${code}-0${n}`, quantity }));

export async function captureDragonBallRequests(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const game of ["dbs", "fusion"] as const) {
    const db = await pgliteDb();
    const { code } = await seed(db, game);
    const entry: Record<string, unknown> = {};
    const deckIds: number[] = [];
    const [deck] = await db
      .insert(schema.decks)
      .values({ name: `${game} deck`, game, metaNotes: "Lots of blockers around." })
      .returning({ id: schema.decks.id });
    deckIds.push(deck.id);
    await db.insert(schema.deckCards).values([
      { deckId: deck.id, cardId: `${code}-001`, zone: "leader", quantity: 1 },
      ...[10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21].map((n) => ({ deckId: deck.id, cardId: `${code}-0${n}`, zone: "main", quantity: 4 })),
      { deckId: deck.id, cardId: `${code}-060`, zone: "main", quantity: 2 },
    ]);

    const run = async (label: string, answers: Parameters<ReturnType<typeof anthropicHarness>["make"]>[0], fn: () => Promise<unknown>) => {
      const h = anthropicHarness().make(answers);
      registerProvider(h.provider);
      try {
        const result = await fn();
        entry[label] = { wire: h.wire(), result };
      } finally {
        resetProviders();
      }
    };

    const { summariseDeck, runWizard, reviewSet } = await import("../../src/lib/ai/deck.ts");
    const { suggestDeck } = await import("../../src/lib/ai/deck-builder.ts");
    const { suggestDeckFromCard } = await import("../../src/lib/ai/deck-from-card.ts");

    await run(
      "summary",
      [{ json: { archetype: "Red Saiyan", gamePlan: "Hit hard.", strengths: ["Fast"], weaknesses: ["Fragile"], goodAgainst: [], badAgainst: [], keyCards: [{ cardId: `${code}-010`, why: "Core" }], legalityNotes: [] } }],
      async () => {
        const r = await summariseDeck(db, deck.id);
        return { summary: r.summary };
      },
    );
    await run(
      "wizard",
      [{ json: { assessment: "Needs draw.", swaps: [{ outCardId: `${code}-021`, outQuantity: 2, inCardId: `${code}-030`, inQuantity: 2, rationale: "More draw.", priority: "high" }] } }],
      async () => {
        const r = await runWizard(db, deck.id, "any", "Make it faster");
        return { assessment: r.assessment, swaps: r.swaps };
      },
    );
    await run(
      "wizardOwned",
      [{ json: { assessment: "Fine.", swaps: [] } }],
      async () => {
        const r = await runWizard(db, deck.id, "owned", null);
        return { assessment: r.assessment, swaps: r.swaps };
      },
    );
    await run(
      "setReview",
      [{ json: { overview: "A set.", standouts: [{ cardId: `${code}-010`, why: "Good", rating: 4 }], archetypes: [], sleepers: [] } }],
      async () => {
        const r = await reviewSet(db, code);
        return { review: r.review };
      },
    );
    const draft = {
      name: "Red Test",
      strategy: "Beat down.",
      main: [...pick(code, [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]), { cardId: `${code}-060`, quantity: 2 }],
      zDeck: game === "dbs" ? [{ cardId: `${code}-070`, quantity: 2 }] : [],
      purchases: [{ cardId: `${code}-020`, quantity: 4, why: "Engine" }],
    };
    await run("builder", [{ json: draft }], async () => {
      const r = await suggestDeck(db, `${code}-001`, null);
      deckIds.push(r.deckId);
      return { draft: r.draft, sanitised: r.sanitised };
    });
    await run("fromCard", [{ json: { ...draft, leaderId: `${code}-002`, name: "Seeded" } }], async () => {
      const r = await suggestDeckFromCard(db, `${code}-030`, null);
      deckIds.push(r.deckId);
      return { leaderId: r.leaderId, leaderName: r.leaderName, mainCount: r.mainCount, toBuy: r.toBuy, draft: r.draft };
    });

    // What was stored: runs (without ids and times) and the decks the builders created.
    const runs = await db.select().from(schema.aiRuns).orderBy(asc(schema.aiRuns.id));
    entry.aiRuns = runs.map((r) => ({ kind: r.kind, model: r.model, provider: r.provider, billed: r.billed, input: r.input, output: r.output, deckIndex: r.deckId === null ? null : deckIds.indexOf(r.deckId) }));
    const created = [];
    for (const id of deckIds.slice(1)) {
      const d = (await db.select().from(schema.decks).where(eq(schema.decks.id, id)))[0];
      const cs = await db.select().from(schema.deckCards).where(eq(schema.deckCards.deckId, id)).orderBy(asc(schema.deckCards.zone), asc(schema.deckCards.cardId));
      created.push({ name: d.name, game: d.game, description: d.description, owner: d.owner, aiSummary: d.aiSummary, cards: cs.map((c) => [c.zone, c.cardId, c.quantity]) });
    }
    entry.createdDecks = created;
    const d0 = (await db.select().from(schema.decks).where(eq(schema.decks.id, deck.id)))[0];
    entry.analysedDeck = { aiSummary: d0.aiSummary };
    out[game] = entry;
  }
  return JSON.parse(JSON.stringify(out)) as Record<string, unknown>;
}

if (process.argv[1]?.endsWith("ai-games-capture.mts") && process.argv[2] === "--record") {
  const target = process.argv[3];
  if (!target) throw new Error("usage: ai-games-capture.mts --record <file>");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(await captureDragonBallRequests(), null, 2)}\n`);
  console.log(`recorded ${target}`);
  process.exit(0);
}
