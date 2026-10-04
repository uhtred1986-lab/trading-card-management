/**
 * #513 on PGlite: the deck features call the model through `generateJson`, and
 * what reaches the Anthropic API — read off a recorded transport — is the
 * request each one sent before (models per #381, max_tokens, thinking, effort,
 * structured output, the cached pool block with the default 5-minute TTL),
 * and each `ai_runs` row keeps its kind, model and deck. No network.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { anthropicHarness, type Wire } from "./verify/ai-harness.ts";

type Block = { type: string; text: string; cache_control?: { type: string; ttl?: string } };

function shape(w: Wire, model: string, maxTokens: number, effort: string, label: string): void {
  const b = w.body;
  assert.equal(b.model, model, `${label}: model`);
  assert.equal(b.max_tokens, maxTokens, `${label}: max_tokens`);
  assert.deepEqual(b.thinking, { type: "adaptive" }, `${label}: adaptive thinking`);
  const out = b.output_config as { effort?: string; format?: { type?: string } };
  assert.equal(out.effort, effort, `${label}: effort`);
  assert.equal(out.format?.type, "json_schema", `${label}: structured output`);
  const msgs = b.messages as { role: string; content: unknown }[];
  assert.equal(msgs.length, 1, `${label}: one user message`);
  assert.equal(typeof msgs[0].content, "string", `${label}: the user turn is the plain string it was`);
}

export async function verifyAiFeaturesDb(db: Db): Promise<void> {
  const { summariseDeck, runWizard, reviewSet } = await import("../src/lib/ai/deck.ts");
  // The registry the feature code routes through, loaded the way it loads it.
  const { registerProvider, resetProviders } = await import("../src/lib/ai/providers/index.ts");
  const [deck] = await db.insert(schema.decks).values({ name: "AI features" }).returning({ id: schema.decks.id });
  await db.insert(schema.deckCards).values([
    { deckId: deck.id, cardId: "BT18-020", zone: "main", quantity: 4 },
    { deckId: deck.id, cardId: "BT18-021", zone: "main", quantity: 2 },
  ]);
  const ids: number[] = [];
  try {
    // Deck summary: Sonnet (#381), medium effort, one uncached system prompt sent as a string.
    {
      const run = anthropicHarness().make([{ json: { archetype: "Midrange", gamePlan: "Trade.", strengths: [], weaknesses: [], goodAgainst: [], badAgainst: [], keyCards: [], legalityNotes: [] } }]);
      registerProvider(run.provider);
      const out = await summariseDeck(db, deck.id);
      ids.push(out.runId);
      const [w] = run.wire();
      shape(w, "claude-sonnet-5-5", 8000, "medium", "deck summary");
      assert.equal(typeof w.body.system, "string", "deck summary: system is one plain string, as before");
      resetProviders();
    }
    // Wizard: Opus, high effort, system prompt then the candidate pool with the default cache TTL.
    {
      const run = anthropicHarness().make([{ json: { assessment: "Fine.", swaps: [] } }]);
      registerProvider(run.provider);
      const out = await runWizard(db, deck.id, "any");
      ids.push(out.runId);
      const [w] = run.wire();
      shape(w, "claude-opus-5", 12000, "high", "wizard");
      const sys = w.body.system as Block[];
      assert.equal(sys.length, 2, "wizard: two system blocks");
      assert.equal(sys[0].cache_control, undefined, "wizard: the rules block is not cached");
      assert.deepEqual(sys[1].cache_control, { type: "ephemeral" }, "wizard: the pool block keeps the default 5-minute cache, no ttl");
      resetProviders();
    }
    // Set review: Opus, high effort, the game's system prompt as a string.
    {
      const run = anthropicHarness().make([{ json: { overview: "A set.", standouts: [], archetypes: [], sleepers: [] } }]);
      registerProvider(run.provider);
      const out = await reviewSet(db, "BT18");
      ids.push(out.runId);
      const [w] = run.wire();
      shape(w, "claude-opus-5", 12000, "high", "set review");
      assert.equal(typeof w.body.system, "string", "set review: system is one plain string, as before");
      resetProviders();
    }
    const rows = await db.select().from(schema.aiRuns).where(eq(schema.aiRuns.kind, "deck_summary"));
    assert.equal(rows.at(-1)?.deckId, deck.id, "deck_summary keeps its deck_id");
    assert.equal(rows.at(-1)?.model, "claude-sonnet-5-5", "deck_summary records the Sonnet model");
    const wiz = await db.select().from(schema.aiRuns).where(eq(schema.aiRuns.kind, "deck_wizard"));
    assert.equal(wiz.at(-1)?.deckId, deck.id, "deck_wizard keeps its deck_id");
    assert.equal(wiz.at(-1)?.model, "claude-opus-5", "deck_wizard records the Opus model");
  } finally {
    resetProviders();
    for (const id of ids) await db.delete(schema.aiRuns).where(eq(schema.aiRuns.id, id));
    await db.delete(schema.decks).where(eq(schema.decks.id, deck.id));
  }
  console.log("verify-db: deck summary, wizard and set review send their recorded request shapes (#513)");
}
