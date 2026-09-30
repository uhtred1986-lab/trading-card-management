/**
 * verify-db checks for `recordRun` (#380): the cache token fields of a usage
 * object land in `ai_runs`, and a usage object without them stores nulls.
 * Kept in its own file so verify-db.mts only gains one line.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import * as schema from "../src/db/schema.ts";
import type { Db } from "../src/db/index.ts";
import { recordRun } from "../src/lib/ai/client.ts";

export async function verifyAiRuns(db: Db): Promise<void> {
  const parsed = { ok: true };

  const cached = await recordRun(
    db,
    "deck_builder",
    { test: "cache fields" },
    { parsed_output: parsed, stop_reason: "end_turn", usage: { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 350 } },
  );
  const [row] = await db.select().from(schema.aiRuns).where(eq(schema.aiRuns.id, cached.id));
  assert.equal(row.kind, "deck_builder");
  assert.equal(row.inputTokens, 120);
  assert.equal(row.outputTokens, 40);
  assert.equal(row.cacheReadTokens, 9000, "recordRun stores cache_read_input_tokens");
  assert.equal(row.cacheCreationTokens, 350, "recordRun stores cache_creation_input_tokens");

  // The SDK types both fields as nullable, and older responses omit them.
  const plain = await recordRun(
    db,
    "arena_clarify",
    { test: "no cache fields" },
    { parsed_output: parsed, stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 6, cache_read_input_tokens: null } },
  );
  const [row2] = await db.select().from(schema.aiRuns).where(eq(schema.aiRuns.id, plain.id));
  assert.equal(row2.cacheReadTokens, null, "a null cache field is stored as null");
  assert.equal(row2.cacheCreationTokens, null, "an absent cache field is stored as null");

  await db.delete(schema.aiRuns).where(eq(schema.aiRuns.id, cached.id));
  await db.delete(schema.aiRuns).where(eq(schema.aiRuns.id, plain.id));
}
