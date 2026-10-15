/** SL-only domain store; the page and every action perform requireSl. All I/O
 * uses the supplied Db, so PGlite exercises the production queries without Neon.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { arenaTestingDecks, arenaTestingScenarios, arenaTestingMatches, arenaTestingRuns, arenaTestingRunResults, decks } from "@/db/schema";
import { rows } from "@/db/rows";
import { resolveOutcome, type OutcomeState } from "../outcome";
import { TESTING_DECK_CATALOG, TESTING_SCENARIO_CATALOG } from "./catalog";
import { MAX_MANIFEST_BYTES, validateEvaluationManifest, type EvaluationManifest, type EvaluationManifestResult, type ImportedResultPreview, type ImportedRunDetail, type ImportedRunSummary } from "./run-manifest";
import { aggregateMatches, type StatsMatch } from "./stats";
import { scoreImportedRun } from "./run-stats";
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

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function resultProjection(runId: number, result: EvaluationManifestResult) {
  return {
    runId,
    resultKey: result.key,
    kind: result.kind,
    fixtureKey: result.fixtureKey,
    sourceScenarioId: "sourceScenarioId" in result ? result.sourceScenarioId : null,
    portalScenarioId: "portalScenarioId" in result ? result.portalScenarioId : null,
    outcome: result.outcome,
    seed: result.kind === "policy_game" ? result.seed : result.seed,
    seat: result.kind === "policy_game" ? result.candidateSeat : result.seat,
    payload: result,
  };
}

/** Append-only, idempotent import. Validates again at the persistence boundary. */
export async function importEvaluationRun(db: Db, input: unknown): Promise<
  { ok: true; runId: number; replayed: boolean } | { ok: false; reason: "invalid" | "idempotency_conflict"; detail?: string }
> {
  const checked = validateEvaluationManifest(input);
  if (!checked.ok) return { ok: false, reason: "invalid", detail: checked.reason };
  const manifest = checked.value;
  const recipeIds = manifest.fixtures.flatMap((fixture) => [fixture.p1RecipeId, fixture.p2RecipeId]).filter((id): id is string => id !== null);
  const scenarioIds = manifest.results.flatMap((result) => "portalScenarioId" in result && result.portalScenarioId ? [result.portalScenarioId] : []);
  if (recipeIds.some((id) => !TESTING_DECK_CATALOG.some((deck) => deck.id === id))) return { ok: false, reason: "invalid", detail: "Manifest references an unknown portal recipe ID." };
  if (scenarioIds.some((id) => !TESTING_SCENARIO_CATALOG.some((scenario) => scenario.id === id))) return { ok: false, reason: "invalid", detail: "Manifest references an unknown portal scenario ID." };
  await ensureTestingCatalog(db);
  const canonical = canonicalJson(manifest);
  if (Buffer.byteLength(canonical, "utf8") > MAX_MANIFEST_BYTES) return { ok: false, reason: "invalid", detail: "Manifest exceeds the 512 KiB import limit." };
  const fingerprint = createHash("sha256").update(canonical).digest("hex");
  return db.transaction(async (tx) => {
    if (recipeIds.length) {
      const rows = await tx.select({ id: arenaTestingDecks.id }).from(arenaTestingDecks).where(inArray(arenaTestingDecks.id, recipeIds));
      if (new Set(rows.map((row) => row.id)).size !== new Set(recipeIds).size) return { ok: false as const, reason: "invalid" as const, detail: "Manifest references a recipe missing from the portal catalog." };
    }
    if (scenarioIds.length) {
      const rows = await tx.select({ id: arenaTestingScenarios.id }).from(arenaTestingScenarios).where(inArray(arenaTestingScenarios.id, scenarioIds));
      if (new Set(rows.map((row) => row.id)).size !== new Set(scenarioIds).size) return { ok: false as const, reason: "invalid" as const, detail: "Manifest references a scenario missing from the portal catalog." };
    }
    const [inserted] = await tx.insert(arenaTestingRuns).values({
      requestId: manifest.requestId, fingerprint, source: manifest.source, runnerId: manifest.runner.id,
      runnerVersion: manifest.runner.version, gitCommit: manifest.runner.gitCommit,
      dirtyTreeSha256: manifest.runner.dirtyTreeSha256, protocolId: manifest.protocol.id,
      protocolRevision: manifest.protocol.revision, seedSet: manifest.source === "policy_eval" ? manifest.seedSet : null,
      resultCount: manifest.results.length, manifest,
    }).onConflictDoNothing({ target: arenaTestingRuns.requestId }).returning({ id: arenaTestingRuns.id });
    if (inserted) {
      await tx.insert(arenaTestingRunResults).values(manifest.results.map((result) => resultProjection(inserted.id, result)));
      return { ok: true as const, runId: inserted.id, replayed: false };
    }
    const [existing] = await tx.select({ id: arenaTestingRuns.id, fingerprint: arenaTestingRuns.fingerprint })
      .from(arenaTestingRuns).where(eq(arenaTestingRuns.requestId, manifest.requestId));
    if (!existing || existing.fingerprint !== fingerprint) return { ok: false as const, reason: "idempotency_conflict" as const };
    return { ok: true as const, runId: existing.id, replayed: true };
  });
}

/** Small history projection only; immutable result details stay in the database. */
export async function listImportedEvaluationRuns(db: Db, limit = 40): Promise<ImportedRunSummary[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return fail("run history limit");
  const runs = await db.select({
    id: arenaTestingRuns.id, requestId: arenaTestingRuns.requestId, source: arenaTestingRuns.source,
    runnerId: arenaTestingRuns.runnerId, runnerVersion: arenaTestingRuns.runnerVersion,
    gitCommit: arenaTestingRuns.gitCommit, dirtyTreeSha256: arenaTestingRuns.dirtyTreeSha256,
    protocolId: arenaTestingRuns.protocolId, protocolRevision: arenaTestingRuns.protocolRevision,
    seedSet: arenaTestingRuns.seedSet, resultCount: arenaTestingRuns.resultCount,
    fixtureCount: sql<number>`jsonb_array_length(${arenaTestingRuns.manifest}->'fixtures')::int`,
    unpinnedFixtures: sql<number>`(select count(*) from jsonb_array_elements(${arenaTestingRuns.manifest}->'fixtures') as fixture where fixture->'runtimeRevision' = 'null'::jsonb)::int`,
    policyGames: sql<number>`(select count(*) from jsonb_array_elements(${arenaTestingRuns.manifest}->'results') as item where item->>'kind' = 'policy_game')::int`,
    pricedPolicyGames: sql<number>`(select count(*) from jsonb_array_elements(${arenaTestingRuns.manifest}->'results') as item where item->>'kind' = 'policy_game' and item->'reportedCostMicros' <> 'null'::jsonb)::int`,
    reportedCostMicros: sql<number>`coalesce((select sum((item->>'reportedCostMicros')::bigint) from jsonb_array_elements(${arenaTestingRuns.manifest}->'results') as item where item->>'kind' = 'policy_game' and item->'reportedCostMicros' <> 'null'::jsonb),0)::double precision`,
    recordedAt: arenaTestingRuns.recordedAt,
  }).from(arenaTestingRuns).orderBy(desc(arenaTestingRuns.recordedAt), desc(arenaTestingRuns.id)).limit(limit);
  if (!runs.length) return [];
  const runIds = runs.map((run) => run.id);
  const rankedResults = db.select({
    id: arenaTestingRunResults.id, runId: arenaTestingRunResults.runId, resultKey: arenaTestingRunResults.resultKey,
    kind: arenaTestingRunResults.kind, fixtureKey: arenaTestingRunResults.fixtureKey,
    sourceScenarioId: arenaTestingRunResults.sourceScenarioId, portalScenarioId: arenaTestingRunResults.portalScenarioId,
    outcome: arenaTestingRunResults.outcome, seed: arenaTestingRunResults.seed, seat: arenaTestingRunResults.seat,
    payload: arenaTestingRunResults.payload,
    rowNumber: sql<number>`row_number() over (partition by ${arenaTestingRunResults.runId} order by ${arenaTestingRunResults.id} desc)`.as("row_number"),
  }).from(arenaTestingRunResults).where(inArray(arenaTestingRunResults.runId, runIds)).as("ranked_arena_run_results");
  const [outcomes, mappings, previewsRaw] = await Promise.all([
    db.select({ runId: arenaTestingRunResults.runId, outcome: arenaTestingRunResults.outcome, count: sql<number>`count(*)::int` })
      .from(arenaTestingRunResults).where(inArray(arenaTestingRunResults.runId, runIds))
      .groupBy(arenaTestingRunResults.runId, arenaTestingRunResults.outcome),
    db.select({ runId: arenaTestingRunResults.runId, count: sql<number>`count(*)::int` })
      .from(arenaTestingRunResults).where(and(inArray(arenaTestingRunResults.runId, runIds), sql`${arenaTestingRunResults.portalScenarioId} is not null`))
      .groupBy(arenaTestingRunResults.runId),
    db.select({ runId: rankedResults.runId, resultKey: rankedResults.resultKey,
      kind: rankedResults.kind, fixtureKey: rankedResults.fixtureKey,
      sourceScenarioId: rankedResults.sourceScenarioId, portalScenarioId: rankedResults.portalScenarioId,
      outcome: rankedResults.outcome, seed: rankedResults.seed, seat: rankedResults.seat,
      payload: rankedResults.payload }).from(rankedResults).where(lte(rankedResults.rowNumber, 5)).orderBy(desc(rankedResults.id)),
  ]);
  const outcomeMap = new Map<number, { outcome: string; count: number }[]>();
  for (const row of outcomes) outcomeMap.set(row.runId, [...(outcomeMap.get(row.runId) ?? []), { outcome: row.outcome, count: row.count }]);
  const mappingMap = new Map(mappings.map((row) => [row.runId, row.count]));
  const previewMap = new Map<number, ImportedResultPreview[]>();
  for (const row of previewsRaw) {
    const previous = previewMap.get(row.runId) ?? [];
    if (previous.length >= 5) continue;
    const payload = row.payload;
    previewMap.set(row.runId, [...previous, {
      key: row.resultKey, kind: row.kind as ImportedResultPreview["kind"], fixtureKey: row.fixtureKey,
      sourceScenarioId: row.sourceScenarioId, portalScenarioId: row.portalScenarioId, outcome: row.outcome,
      seed: row.seed, seat: row.seat as ImportedResultPreview["seat"],
      policyKey: payload.kind === "decision_case" ? payload.policyKey : payload.kind === "policy_game" ? payload.candidatePolicyKey : null,
      baselinePolicyKey: payload.kind === "policy_game" ? payload.baselinePolicyKey : null,
      steps: payload.kind === "scenario_case" ? payload.steps : payload.kind === "decision_case" ? payload.horizonSteps : null,
      differenceCount: payload.kind === "scenario_case" ? payload.differenceCount : null,
    }]);
  }
  return runs.map((run) => ({
    ...run,
    source: run.source as ImportedRunSummary["source"],
    runnerId: run.runnerId as ImportedRunSummary["runnerId"],
    seedSet: run.seedSet as ImportedRunSummary["seedSet"],
    recordedAt: iso(run.recordedAt),
    outcomes: outcomeMap.get(run.id) ?? [],
    mappedScenarioResults: mappingMap.get(run.id) ?? 0,
    resultPreviews: previewMap.get(run.id) ?? [],
  }));
}

const IMPORTED_OUTCOMES = ["pass", "fail", "interrupted", "error", "win", "loss", "draw", "limit", "illegal"] as const;
const IMPORTED_PAGE_SIZE = 25;

/** Bounded full-case review. Result payloads contain only validated manifest fields. */
export async function getImportedEvaluationRunDetail(db: Db, runId: number, options: { page?: number; fixtureKey?: string; outcome?: string } = {}): Promise<ImportedRunDetail | null> {
  if (!Number.isSafeInteger(runId) || runId < 1) return null;
  const [run] = await db.select({ id: arenaTestingRuns.id, requestId: arenaTestingRuns.requestId,
    source: arenaTestingRuns.source, seedSet: arenaTestingRuns.seedSet,
    resultCount: arenaTestingRuns.resultCount, recordedAt: arenaTestingRuns.recordedAt,
    manifest: arenaTestingRuns.manifest }).from(arenaTestingRuns).where(eq(arenaTestingRuns.id, runId));
  if (!run) return null;
  const manifest = run.manifest as EvaluationManifest;
  const fixtureFilter = options.fixtureKey ?? "";
  const outcomeFilter = options.outcome ?? "";
  if (fixtureFilter && !manifest.fixtures.some((fixture) => fixture.key === fixtureFilter)) return null;
  if (outcomeFilter && !(IMPORTED_OUTCOMES as readonly string[]).includes(outcomeFilter)) return null;
  const filters = [eq(arenaTestingRunResults.runId, runId)];
  if (fixtureFilter) filters.push(eq(arenaTestingRunResults.fixtureKey, fixtureFilter));
  if (outcomeFilter) filters.push(eq(arenaTestingRunResults.outcome, outcomeFilter));
  const predicate = and(...filters)!;
  const [totalRows, grouped] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(arenaTestingRunResults).where(predicate),
    db.select({ fixtureKey: arenaTestingRunResults.fixtureKey, kind: arenaTestingRunResults.kind,
      outcome: arenaTestingRunResults.outcome, count: sql<number>`count(*)::int` })
      .from(arenaTestingRunResults).where(eq(arenaTestingRunResults.runId, runId))
      .groupBy(arenaTestingRunResults.fixtureKey, arenaTestingRunResults.kind, arenaTestingRunResults.outcome),
  ]);
  const total = totalRows[0]?.count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / IMPORTED_PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number.isInteger(options.page) ? options.page! : 1));
  const pageRows = await db.select({ payload: arenaTestingRunResults.payload }).from(arenaTestingRunResults)
    .where(predicate).orderBy(arenaTestingRunResults.resultKey).limit(IMPORTED_PAGE_SIZE).offset((page - 1) * IMPORTED_PAGE_SIZE);
  return {
    id: run.id, requestId: run.requestId, source: run.source as ImportedRunDetail["source"],
    runner: manifest.runner, protocol: manifest.protocol, seedSet: run.seedSet as ImportedRunDetail["seedSet"],
    fixtures: manifest.fixtures, policies: manifest.policies, resultCount: run.resultCount, totalMatches: total, recordedAt: iso(run.recordedAt),
    fixtureTotals: grouped.map((row) => ({ fixtureKey: row.fixtureKey, kind: row.kind as ImportedRunDetail["fixtureTotals"][number]["kind"], outcome: row.outcome, count: row.count })),
    results: pageRows.map((row) => row.payload), scores: scoreImportedRun(manifest), page, pageSize: IMPORTED_PAGE_SIZE, pageCount, fixtureFilter, outcomeFilter,
  };
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
