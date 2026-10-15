/** SL-only domain store; the page and every action perform requireSl. All I/O
 * uses the supplied Db, so PGlite exercises the production queries without Neon.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaTestingDecks, arenaTestingScenarios, arenaTestingMatches, decks } from "@/db/schema";
import { rows } from "@/db/rows";
import { resolveOutcome, type OutcomeState } from "../outcome";
import { TESTING_DECK_CATALOG, TESTING_SCENARIO_CATALOG } from "./catalog";
import { aggregateMatches, type StatsMatch } from "./stats";
import type { DeckProgressUpdate, MatchActor, MutationResult, ProgressStatus, ProgressUpdate, RecordTestingMatchInput, StatsFilter, TestingDashboard, TestingDeck, TestingMatch, TestingScenario } from "./types";

const STATUSES = ["planned", "in_progress", "blocked", "failed", "passed"];
const ACTORS = ["human", "local_ai", "opus", "other_ai"];
const OUTCOMES = ["win", "draw", "interrupted", "abandoned", "limit"];
const fail = (field: string): never => { throw new Error(`Invalid testing ${field}`); };
const text = (value: unknown, field: string, max = 5000, required = false): string => {
  if (typeof value !== "string" || value.length > max) return fail(field);
  const clean = value.trim();
  if (required && !clean) return fail(field);
  return clean;
};
const integer = (value: unknown, field: string, min = 0): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > 2147483647) return fail(field);
  return value;
};
const id = (value: unknown): string => {
  const clean = text(value, "id", 128, true);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(clean)) return fail("id");
  return clean;
};
const iso = (date: Date) => date.toISOString();
const actor = (value: unknown): MatchActor => {
  if (!value || typeof value !== "object") return fail("actor");
  const a = value as MatchActor;
  if (!ACTORS.includes(a.kind)) return fail("actor kind");
  if (a.kind === "opus" && (typeof a.model !== "string" || !/opus[-._]\d/i.test(a.model))) return fail("exact Opus model ID");
  if (a.kind === "human" && a.model !== null) return fail("human model");
  return { kind: a.kind, name: text(a.name, "actor name", 120, true), model: a.model === null ? null : text(a.model, "model", 200, true) };
};
export function validateTestingMatch(input: RecordTestingMatchInput): RecordTestingMatchInput {
  if (!input || typeof input !== "object") return fail("match");
  const requestId = text(input.requestId, "request ID", 36, true).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) return fail("request ID");
  if (!OUTCOMES.includes(input.outcome)) return fail("outcome");
  if (input.outcome === "win" ? input.winner !== "p1" && input.winner !== "p2" : input.winner !== null) return fail("winner");
  return { requestId, p1DeckId: id(input.p1DeckId), p2DeckId: id(input.p2DeckId), p1: actor(input.p1), p2: actor(input.p2),
    outcome: input.outcome, winner: input.winner, seed: input.seed === null ? null : integer(input.seed, "seed", -2147483648),
    rulesRevision: text(input.rulesRevision, "rules revision", 200), evidence: text(input.evidence, "evidence", 2000, input.outcome === "win" || input.outcome === "draw"),
    note: text(input.note, "note"), reportedCostMicros: input.reportedCostMicros === null ? null : integer(input.reportedCostMicros, "reported cost") };
}
function validateProgress(input: ProgressUpdate) {
  if (!input || typeof input !== "object" || !STATUSES.includes(input.status)) return fail("progress status");
  return { id: id(input.id), expectedVersion: integer(input.expectedVersion, "version"), status: input.status,
    note: text(input.note, "note"), evidence: text(input.evidence, "evidence", 2000, input.status === "passed") };
}
const deckView = (row: typeof arenaTestingDecks.$inferSelect): TestingDeck => ({
  release: "Unknown", leaderId: "", leaderName: "Unknown", mechanics: [], supportCardIds: [], notes: "Recipe is not in the current static catalog.",
  ...TESTING_DECK_CATALOG.find((d) => d.id === row.id), ...row, status: row.status as ProgressStatus, updatedAt: iso(row.updatedAt),
});
const scenarioView = (row: typeof arenaTestingScenarios.$inferSelect): TestingScenario => ({ ...row,
  group: row.group as TestingScenario["group"], status: row.status as ProgressStatus, updatedAt: iso(row.updatedAt),
});
const matchView = (row: typeof arenaTestingMatches.$inferSelect): TestingMatch => {
  const { fingerprint: _fingerprint, ...publicRow } = row; void _fingerprint;
  return { ...publicRow, outcome: row.outcome as TestingMatch["outcome"], winner: row.winner as TestingMatch["winner"], recordedAt: iso(row.recordedAt) };
};

/** Inserts only missing recipes/questions; never overwrites progress or marks a
 * generic proof as passing a recipe. Safe to race/repeat across processes.
 */
export async function ensureTestingCatalog(db: Db): Promise<void> {
  if (TESTING_DECK_CATALOG.length) await db.insert(arenaTestingDecks).values(TESTING_DECK_CATALOG.map(({ id, name, category, firstWave, description, source }) => ({ id, name, category, firstWave, description, source }))).onConflictDoNothing();
  if (TESTING_SCENARIO_CATALOG.length) await db.insert(arenaTestingScenarios).values(TESTING_SCENARIO_CATALOG).onConflictDoNothing();
}
export async function updateTestingDeck(db: Db, input: DeckProgressUpdate): Promise<MutationResult<TestingDeck>> {
  const p = validateProgress(input);
  const linkedDeckId = input.linkedDeckId === null ? null : integer(input.linkedDeckId, "linked deck", 1);
  if (linkedDeckId !== null) {
    const [linked] = await db.select({ game: decks.game }).from(decks).where(eq(decks.id, linkedDeckId));
    if (!linked || linked.game !== "dbs") return fail("linked Masters deck");
  }
  const [updated] = await db.update(arenaTestingDecks).set({ status: p.status, note: p.note, evidence: p.evidence, linkedDeckId,
    version: sql`${arenaTestingDecks.version} + 1`, updatedAt: new Date() }).where(and(eq(arenaTestingDecks.id, p.id), eq(arenaTestingDecks.version, p.expectedVersion))).returning();
  if (updated) return { ok: true, value: deckView(updated) };
  const [exists] = await db.select({ id: arenaTestingDecks.id }).from(arenaTestingDecks).where(eq(arenaTestingDecks.id, p.id));
  return { ok: false, reason: exists ? "conflict" : "not_found" };
}
export async function updateTestingScenario(db: Db, input: ProgressUpdate): Promise<MutationResult<TestingScenario>> {
  const p = validateProgress(input);
  const [updated] = await db.update(arenaTestingScenarios).set({ status: p.status, note: p.note, evidence: p.evidence,
    version: sql`${arenaTestingScenarios.version} + 1`, updatedAt: new Date() }).where(and(eq(arenaTestingScenarios.id, p.id), eq(arenaTestingScenarios.version, p.expectedVersion))).returning();
  if (updated) return { ok: true, value: scenarioView(updated) };
  const [exists] = await db.select({ id: arenaTestingScenarios.id }).from(arenaTestingScenarios).where(eq(arenaTestingScenarios.id, p.id));
  return { ok: false, reason: exists ? "conflict" : "not_found" };
}
export async function setDeckTesting(db: Db, deckId: number, isTesting: boolean): Promise<boolean> {
  integer(deckId, "deck", 1);
  if (typeof isTesting !== "boolean") return fail("deck testing flag");
  const updated = await db.update(decks).set({ isTesting, updatedAt: new Date() }).where(eq(decks.id, deckId)).returning({ id: decks.id });
  return updated.length > 0;
}
export async function recordTestingMatch(db: Db, input: RecordTestingMatchInput): Promise<
  { ok: true; value: TestingMatch; replayed: boolean } | { ok: false; reason: "idempotency_conflict" }
> {
  const clean = validateTestingMatch(input);
  if (!TESTING_DECK_CATALOG.some((d) => d.id === clean.p1DeckId) || !TESTING_DECK_CATALOG.some((d) => d.id === clean.p2DeckId)) return fail("catalog deck");
  await ensureTestingCatalog(db);
  const fingerprint = createHash("sha256").update(JSON.stringify(clean)).digest("hex");
  const [inserted] = await db.insert(arenaTestingMatches).values({ ...clean, fingerprint }).onConflictDoNothing({ target: arenaTestingMatches.requestId }).returning();
  if (inserted) return { ok: true, value: matchView(inserted), replayed: false };
  const [existing] = await db.select().from(arenaTestingMatches).where(eq(arenaTestingMatches.requestId, clean.requestId));
  if (!existing || existing.fingerprint !== fingerprint) return { ok: false, reason: "idempotency_conflict" };
  return { ok: true, value: matchView(existing), replayed: true };
}

interface ServerRow {
  id: number; p1DeckId: number | null; p2DeckId: number | null; p1Name: string; p2Name: string;
  p1User: string | null; p2User: string | null; mode: string; status: string;
  winner: "p1" | "p2" | null; reason: string | null; outcomeState: OutcomeState; reportedCostMicros: number;
  p1Models: string[]; p2Models: string[]; p1MissingModel: boolean; p2MissingModel: boolean;
}
/** Pull tiny outcome/model projections, never full engine states/prompts/logs.
 * Model identity comes from actual Claude decision evidence, not game mode.
 */
export async function serverTestingStats(db: Db, filter: StatsFilter = {}) {
  const data = rows<ServerRow>(await db.execute(sql`
    select g.id, g.p1_deck_id as "p1DeckId", g.p2_deck_id as "p2DeckId", g.p1_name as "p1Name", g.p2_name as "p2Name",
      g.p1_user as "p1User", g.p2_user as "p2User", g.mode, g.status, g.winner, g.reason, g.ai_cost_micros as "reportedCostMicros",
      jsonb_build_object('winner',g.state->'winner','overReason',g.state->'overReason','outcome',(g.state->'outcome')-'privateContext') as "outcomeState",
      coalesce(m.p1_models,'{}'::text[]) as "p1Models", coalesce(m.p2_models,'{}'::text[]) as "p2Models",
      coalesce(m.p1_missing,false) as "p1MissingModel", coalesce(m.p2_missing,false) as "p2MissingModel"
    from arena_games g left join (
      select game_id,
        array_agg(distinct model order by model) filter(where player='p1' and model is not null and decided_by='claude') as p1_models,
        array_agg(distinct model order by model) filter(where player='p2' and model is not null and decided_by='claude') as p2_models,
        bool_or(player='p1' and decided_by='claude' and (model is null or trim(model)='')) as p1_missing,
        bool_or(player='p2' and decided_by='claude' and (model is null or trim(model)='')) as p2_missing
      from arena_decisions where kind='move' group by game_id
    ) m on m.game_id=g.id`));
  const actorFor = (r: ServerRow, seat: "p1" | "p2"): MatchActor => {
    const models = r[`${seat}Models`].filter((m) => m.trim());
    const missing = r[`${seat}MissingModel`];
    const aiSeat = models.length || missing || seat === "p2" && ["sparring", "tournament"].includes(r.mode);
    if (!aiSeat) return { kind: "human", name: r[`${seat}User`] ?? `${seat} human`, model: null };
    if (models.length === 1 && !missing) return { kind: /opus[-._]\d/i.test(models[0]) ? "opus" : "other_ai", name: "Server AI", model: models[0] };
    return { kind: "other_ai", name: "Server AI", model: models.length ? `mixed: ${models.join(" + ")}${missing ? " + unknown" : ""}` : "unknown" };
  };
  return aggregateMatches(data.map((r): StatsMatch => {
    const state = { ...r.outcomeState, winner: r.outcomeState.winner ?? r.winner, overReason: r.outcomeState.overReason ?? r.reason };
    const resolved = resolveOutcome(state, r.status);
    const over = r.status === "over" || r.status === "abandoned" || resolved?.kind === "interrupted";
    const proposed = !over ? "playing" : !resolved ? "interrupted" : resolved.kind === "concession" ? "win" : resolved.kind;
    // Historical/corrupt rows cannot create two losses or manufacture a draw.
    const outcome = proposed === "win" && resolved?.winner !== "p1" && resolved?.winner !== "p2" ? "interrupted" : proposed;
    return { id: `server:${r.id}`, p1DeckId: `actual:${r.p1DeckId ?? `deleted:${r.id}:p1`}`, p2DeckId: `actual:${r.p2DeckId ?? `deleted:${r.id}:p2`}`,
      p1DeckName: r.p1Name, p2DeckName: r.p2Name, p1: actorFor(r, "p1"), p2: actorFor(r, "p2"), outcome,
      winner: outcome === "win" ? resolved?.winner ?? null : null, reportedCostMicros: r.reportedCostMicros };
  }), filter);
}

export async function getTestingDashboard(db: Db, filter: StatsFilter = {}): Promise<TestingDashboard> {
  if (filter.actorKind && !ACTORS.includes(filter.actorKind)) return fail("actor filter");
  if (filter.model !== undefined) text(filter.model, "model filter", 1000, true);
  if (filter.deckId !== undefined) text(filter.deckId, "deck filter", 200, true);
  const [deckRows, scenarioRows, matchRows, statRows, actualDecks, serverStats] = await Promise.all([
    db.select().from(arenaTestingDecks).orderBy(arenaTestingDecks.id),
    db.select().from(arenaTestingScenarios).orderBy(arenaTestingScenarios.id),
    db.select().from(arenaTestingMatches).orderBy(desc(arenaTestingMatches.recordedAt), desc(arenaTestingMatches.id)).limit(100),
    db.select({ id: arenaTestingMatches.id, p1DeckId: arenaTestingMatches.p1DeckId, p2DeckId: arenaTestingMatches.p2DeckId,
      p1: arenaTestingMatches.p1, p2: arenaTestingMatches.p2, outcome: arenaTestingMatches.outcome, winner: arenaTestingMatches.winner,
      reportedCostMicros: arenaTestingMatches.reportedCostMicros }).from(arenaTestingMatches),
    db.select({ id: decks.id, name: decks.name, isTesting: decks.isTesting, game: decks.game }).from(decks).orderBy(decks.name),
    serverTestingStats(db, filter),
  ]);
  const names = new Map(deckRows.map((d) => [d.id, d.name]));
  const matches = matchRows.map(matchView);
  const recordedFilter = { ...filter, ...(filter.deckId?.startsWith("recipe:") ? { deckId: filter.deckId.slice(7) } : {}) };
  const recordedStats = aggregateMatches(statRows.map((m): StatsMatch => ({ ...m, id: `recorded:${m.id}`,
    outcome: m.outcome as StatsMatch["outcome"], winner: m.winner as StatsMatch["winner"], p1DeckName: names.get(m.p1DeckId)!, p2DeckName: names.get(m.p2DeckId)! })), recordedFilter);
  return { decks: deckRows.map(deckView), scenarios: scenarioRows.map(scenarioView), actualDecks,
    recentMatches: matches.slice(0, 100), recordedStats, serverStats,
    sources: { recorded: "Explicit SL-recorded test matches; recipe names do not prove deck qualification.",
      server: "Existing server arena history; AI models come from recorded move decisions. Mixed/unknown models remain explicit.",
      local: "Device-only offline/local results are not synchronized to server statistics. Record evidence manually if needed." } };
}
