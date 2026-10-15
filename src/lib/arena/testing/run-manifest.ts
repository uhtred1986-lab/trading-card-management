/**
 * Allowlisted, versioned evidence imports for the SL testing portal.
 *
 * This intentionally contains no engine state, actions, prompts, snapshots,
 * trace bodies, paths, or open-ended metric bags. Emitters must project local
 * artifacts into this small contract before an authenticated import.
 */
export type RunSource = "scenario" | "decision_cases" | "policy_eval";
export type RunnerId = "arena-scenario" | "arena-policy-strategy" | "arena-policy-eval";
export type RunOutcome = "pass" | "fail" | "interrupted" | "error";
export type PolicyRngProvenance =
  | { mode: "seeded"; v: 1; seed: number; n: number }
  | { mode: "deterministic"; v: null; seed: null; n: null };

export interface ManifestFixture {
  key: string;
  sourceId: string;
  runtimeRevision: string;
  bundleSha256: string;
  rulesSha256: string | null;
  catalogSha256: string | null;
  programsSha256: string | null;
  p1DeckSha256: string | null;
  p2DeckSha256: string | null;
  p1RecipeId: string | null;
  p2RecipeId: string | null;
}

export interface ManifestPolicy {
  key: string;
  version: string;
  sha256: string;
}

export interface ManifestRunner {
  id: RunnerId;
  version: string;
  /** Git commit containing the runner source that was executed. */
  gitCommit: string;
  /** Null only when the emitter verified a clean worktree; otherwise the real dirty-tree digest. */
  dirtyTreeSha256: string | null;
}

interface ManifestBase {
  version: 1;
  requestId: string;
  runner: ManifestRunner;
  protocol: { id: string; revision: string };
  fixtures: ManifestFixture[];
  policies: ManifestPolicy[];
}

export interface ScenarioCaseResult {
  key: string;
  kind: "scenario_case";
  fixtureKey: string;
  sourceScenarioId: string;
  /** Explicit mapping to the portal catalog; null means intentionally unmapped. */
  portalScenarioId: string | null;
  seed: number | null;
  seat: "p1" | "p2" | null;
  outcome: RunOutcome;
  steps: number;
  differenceCount: number;
  browserAgreement: boolean | null;
  evidenceSha256: string;
}

export interface DecisionCaseResult {
  key: string;
  kind: "decision_case";
  fixtureKey: string;
  sourceScenarioId: string;
  /** Explicit mapping to the portal catalog; never inferred from the case name. */
  portalScenarioId: string | null;
  policyKey: string;
  seed: number;
  seat: "p1" | "p2";
  initialPolicyRng: { p1: PolicyRngProvenance; p2: PolicyRngProvenance };
  assertion: "acceptable_action";
  outcome: RunOutcome;
  horizonSteps: number;
  evidenceSha256: string;
}

export interface PolicyGameResult {
  key: string;
  kind: "policy_game";
  fixtureKey: string;
  candidatePolicyKey: string;
  baselinePolicyKey: string;
  seedIndex: number | null;
  seed: number;
  candidateSeat: "p1" | "p2";
  initialPolicyRng: { p1: PolicyRngProvenance; p2: PolicyRngProvenance };
  /** Result from the candidate policy's perspective. */
  outcome: "win" | "loss" | "draw" | "interrupted" | "limit" | "illegal";
  winner: "p1" | "p2" | null;
  moves: number;
  turn: number;
  damageDealt: number;
  damageTaken: number;
  guardTrips: number;
  stopKind: "illegal" | "interrupted" | "notAsked" | "limit" | "noSeat" | null;
  /** Millionths of USD actually reported by the runner; null means unknown/unreported. */
  reportedCostMicros: number | null;
  evidenceSha256: string;
}

export interface ScenarioManifest extends ManifestBase {
  source: "scenario";
  runner: ManifestRunner & { id: "arena-scenario" };
  results: ScenarioCaseResult[];
}

export interface DecisionManifest extends ManifestBase {
  source: "decision_cases";
  runner: ManifestRunner & { id: "arena-policy-strategy" };
  results: DecisionCaseResult[];
}

export interface PolicyEvalManifest extends ManifestBase {
  source: "policy_eval";
  runner: ManifestRunner & { id: "arena-policy-eval" };
  seedSet: "dev" | "holdout" | "custom";
  results: PolicyGameResult[];
}

export type EvaluationManifest = ScenarioManifest | DecisionManifest | PolicyEvalManifest;
export type EvaluationManifestResult = ScenarioCaseResult | DecisionCaseResult | PolicyGameResult;

export type ManifestValidation =
  | { ok: true; value: EvaluationManifest }
  | { ok: false; reason: string };

const HEX_256 = /^[a-f0-9]{64}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUNNERS: readonly RunnerId[] = ["arena-scenario", "arena-policy-strategy", "arena-policy-eval"];
const OUTCOMES: readonly RunOutcome[] = ["pass", "fail", "interrupted", "error"];
const GAME_OUTCOMES = ["win", "loss", "draw", "interrupted", "limit", "illegal"] as const;
const STOP_KINDS = ["illegal", "interrupted", "notAsked", "limit", "noSeat"] as const;
const MAX_RESULTS = 5000;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function cleanString(value: unknown, max: number, pattern?: RegExp): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value && (!pattern || pattern.test(value));
}
function nullableString(value: unknown, max: number, pattern?: RegExp): value is string | null {
  return value === null || cleanString(value, max, pattern);
}
function integer(value: unknown, min = 0, max = 2_147_483_647): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
function hashOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string" && HEX_256.test(value);
}
function str(value: unknown, max: number): value is string {
  return cleanString(value, max);
}
function enumValue<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

function validFixture(value: unknown): value is ManifestFixture {
  if (!record(value) || !exactKeys(value, ["key", "sourceId", "runtimeRevision", "bundleSha256", "rulesSha256", "catalogSha256", "programsSha256", "p1DeckSha256", "p2DeckSha256", "p1RecipeId", "p2RecipeId"])) return false;
  return cleanString(value.key, 128, SLUG) && str(value.sourceId, 160) && str(value.runtimeRevision, 200)
    && HEX_256.test(String(value.bundleSha256)) && hashOrNull(value.rulesSha256) && hashOrNull(value.catalogSha256)
    && hashOrNull(value.programsSha256) && hashOrNull(value.p1DeckSha256) && hashOrNull(value.p2DeckSha256)
    && nullableString(value.p1RecipeId, 128, SLUG) && nullableString(value.p2RecipeId, 128, SLUG);
}
function validPolicy(value: unknown): value is ManifestPolicy {
  return record(value) && exactKeys(value, ["key", "version", "sha256"]) && cleanString(value.key, 128, SLUG)
    && str(value.version, 160) && typeof value.sha256 === "string" && HEX_256.test(value.sha256);
}
function validRunner(value: unknown): value is ManifestRunner {
  return record(value) && exactKeys(value, ["id", "version", "gitCommit", "dirtyTreeSha256"])
    && enumValue(value.id, RUNNERS) && str(value.version, 160)
    && cleanString(value.gitCommit, 40, /^[a-f0-9]{7,40}$/i) && hashOrNull(value.dirtyTreeSha256);
}
function validProtocol(value: unknown): value is { id: string; revision: string } {
  return record(value) && exactKeys(value, ["id", "revision"]) && cleanString(value.id, 128, SLUG) && str(value.revision, 200);
}
function validRng(value: unknown): value is PolicyRngProvenance {
  if (!record(value) || !exactKeys(value, ["mode", "v", "seed", "n"])) return false;
  if (value.mode === "deterministic") return value.v === null && value.seed === null && value.n === null;
  return value.mode === "seeded" && value.v === 1 && integer(value.seed, 0, 0xffff_ffff) && integer(value.n);
}
function validRngPair(value: unknown): value is { p1: PolicyRngProvenance; p2: PolicyRngProvenance } {
  return record(value) && exactKeys(value, ["p1", "p2"]) && validRng(value.p1) && validRng(value.p2);
}
function validEvidenceHash(value: unknown): value is string {
  return typeof value === "string" && HEX_256.test(value);
}
function validScenarioResult(value: unknown): value is ScenarioCaseResult {
  return record(value) && exactKeys(value, ["key", "kind", "fixtureKey", "sourceScenarioId", "portalScenarioId", "seed", "seat", "outcome", "steps", "differenceCount", "browserAgreement", "evidenceSha256"])
    && cleanString(value.key, 160, SLUG) && value.kind === "scenario_case" && cleanString(value.fixtureKey, 128, SLUG)
    && cleanString(value.sourceScenarioId, 160, SLUG) && nullableString(value.portalScenarioId, 128, SLUG)
    && (value.seed === null || integer(value.seed, -2_147_483_648))
    && (value.seat === null || value.seat === "p1" || value.seat === "p2") && enumValue(value.outcome, OUTCOMES)
    && integer(value.steps, 0, 1_000_000) && integer(value.differenceCount, 0, 1_000_000)
    && (value.browserAgreement === null || typeof value.browserAgreement === "boolean") && validEvidenceHash(value.evidenceSha256);
}
function validDecisionResult(value: unknown): value is DecisionCaseResult {
  return record(value) && exactKeys(value, ["key", "kind", "fixtureKey", "sourceScenarioId", "portalScenarioId", "policyKey", "seed", "seat", "initialPolicyRng", "assertion", "outcome", "horizonSteps", "evidenceSha256"])
    && cleanString(value.key, 160, SLUG) && value.kind === "decision_case" && cleanString(value.fixtureKey, 128, SLUG)
    && cleanString(value.sourceScenarioId, 160, SLUG) && nullableString(value.portalScenarioId, 128, SLUG)
    && cleanString(value.policyKey, 128, SLUG) && integer(value.seed, -2_147_483_648)
    && (value.seat === "p1" || value.seat === "p2") && validRngPair(value.initialPolicyRng)
    && value.assertion === "acceptable_action" && enumValue(value.outcome, OUTCOMES)
    && integer(value.horizonSteps, 0, 1_000_000) && validEvidenceHash(value.evidenceSha256);
}
function validPolicyGameResult(value: unknown): value is PolicyGameResult {
  if (!record(value) || !exactKeys(value, ["key", "kind", "fixtureKey", "candidatePolicyKey", "baselinePolicyKey", "seedIndex", "seed", "candidateSeat", "initialPolicyRng", "outcome", "winner", "moves", "turn", "damageDealt", "damageTaken", "guardTrips", "stopKind", "reportedCostMicros", "evidenceSha256"])) return false;
  if (!cleanString(value.key, 160, SLUG) || value.kind !== "policy_game" || !cleanString(value.fixtureKey, 128, SLUG)
    || !cleanString(value.candidatePolicyKey, 128, SLUG) || !cleanString(value.baselinePolicyKey, 128, SLUG)
    || !(value.seedIndex === null || integer(value.seedIndex)) || !integer(value.seed, -2_147_483_648)
    || (value.candidateSeat !== "p1" && value.candidateSeat !== "p2") || !validRngPair(value.initialPolicyRng)
    || !enumValue(value.outcome, GAME_OUTCOMES) || !(value.winner === null || value.winner === "p1" || value.winner === "p2")
    || !integer(value.moves, 0, 1_000_000) || !integer(value.turn, 0, 1_000_000)
    || !integer(value.damageDealt, 0, 1_000_000) || !integer(value.damageTaken, 0, 1_000_000)
    || !integer(value.guardTrips, 0, 1_000_000) || !(value.stopKind === null || enumValue(value.stopKind, STOP_KINDS))
    || !(value.reportedCostMicros === null || integer(value.reportedCostMicros)) || !validEvidenceHash(value.evidenceSha256)) return false;
  if ((value.outcome === "win" && value.winner !== value.candidateSeat)
    || (value.outcome === "loss" && value.winner === value.candidateSeat)
    || ((value.outcome === "draw" || value.outcome === "interrupted" || value.outcome === "limit" || value.outcome === "illegal") && value.winner !== null)) return false;
  return true;
}

/** Parse and validate a decoded JSON value. Unknown fields fail closed. */
export function validateEvaluationManifest(value: unknown): ManifestValidation {
  try {
    if (!record(value)) return { ok: false, reason: "Manifest must be a JSON object." };
    const source = value.source;
    const common = ["version", "source", "requestId", "runner", "protocol", "fixtures", "policies", "results"];
    if (source === "policy_eval") common.splice(3, 0, "seedSet");
    if (!exactKeys(value, common)) return { ok: false, reason: "Manifest has missing or unknown fields." };
    if (value.version !== 1 || !UUID.test(String(value.requestId))) return { ok: false, reason: "Unsupported manifest version or invalid request ID." };
    if (!validRunner(value.runner) || !validProtocol(value.protocol)) return { ok: false, reason: "Runner, source revision, or frozen protocol is invalid." };
    if (!Array.isArray(value.fixtures) || value.fixtures.length < 1 || value.fixtures.length > 100 || !value.fixtures.every(validFixture)) return { ok: false, reason: "Fixture pins are invalid or exceed the limit." };
    if (!Array.isArray(value.policies) || value.policies.length > 64 || !value.policies.every(validPolicy)) return { ok: false, reason: "Policy pins are invalid or exceed the limit." };
    if (!Array.isArray(value.results) || value.results.length < 1 || value.results.length > MAX_RESULTS) return { ok: false, reason: "Results are empty or exceed the limit." };
    const fixtureKeys = value.fixtures.map((fixture) => fixture.key);
    const policyKeys = value.policies.map((policy) => policy.key);
    if (new Set(fixtureKeys).size !== fixtureKeys.length || new Set(policyKeys).size !== policyKeys.length) return { ok: false, reason: "Fixture and policy keys must be unique." };
    const resultKeys: string[] = [];

    if (source === "scenario") {
      if (value.runner.id !== "arena-scenario" || value.seedSet !== undefined || value.policies.length !== 0 || !value.results.every(validScenarioResult)) return { ok: false, reason: "Scenario manifest does not match its runner contract." };
      const results = value.results as ScenarioCaseResult[];
      resultKeys.push(...results.map((result) => result.key));
      if (!results.every((result) => fixtureKeys.includes(result.fixtureKey))) return { ok: false, reason: "Scenario result references an unknown fixture." };
      return uniqueResults(value, resultKeys, { ok: true, value: value as unknown as ScenarioManifest });
    }
    if (source === "decision_cases") {
      if (value.runner.id !== "arena-policy-strategy" || value.seedSet !== undefined || !value.policies.every(validPolicy) || !value.results.every(validDecisionResult)) return { ok: false, reason: "Decision-case manifest does not match its runner contract." };
      const results = value.results as DecisionCaseResult[];
      resultKeys.push(...results.map((result) => result.key));
      if (!results.every((result) => fixtureKeys.includes(result.fixtureKey) && policyKeys.includes(result.policyKey))) return { ok: false, reason: "Decision result references an unknown fixture or policy." };
      return uniqueResults(value, resultKeys, { ok: true, value: value as unknown as DecisionManifest });
    }
    if (source === "policy_eval") {
      if (value.runner.id !== "arena-policy-eval" || !enumValue(value.seedSet, ["dev", "holdout", "custom"] as const) || !value.results.every(validPolicyGameResult)) return { ok: false, reason: "Policy evaluation manifest does not match its runner contract." };
      const results = value.results as PolicyGameResult[];
      resultKeys.push(...results.map((result) => result.key));
      if (!results.every((result) => fixtureKeys.includes(result.fixtureKey) && policyKeys.includes(result.candidatePolicyKey) && policyKeys.includes(result.baselinePolicyKey))) return { ok: false, reason: "Game result references an unknown fixture or policy." };
      return uniqueResults(value, resultKeys, { ok: true, value: value as unknown as PolicyEvalManifest });
    }
    return { ok: false, reason: "Unknown manifest source." };
  } catch {
    return { ok: false, reason: "Manifest could not be validated." };
  }
}

function uniqueResults(value: Record<string, unknown>, keys: string[], success: ManifestValidation): ManifestValidation {
  return new Set(keys).size === keys.length ? success : { ok: false, reason: "Result keys must be unique within a run." };
}

/** The portal accepts a small manifest, never the underlying replay artifact. */
export function parseEvaluationManifestJson(text: string): ManifestValidation {
  if (new TextEncoder().encode(text).byteLength > MAX_MANIFEST_BYTES) return { ok: false, reason: "Manifest exceeds the 2 MiB import limit." };
  try {
    return validateEvaluationManifest(JSON.parse(text) as unknown);
  } catch {
    return { ok: false, reason: "Manifest is not valid JSON." };
  }
}

