/**
 * #901: project duel results into the Testing & stats import contract (`docs/arena-evaluation-imports.md`,
 * `src/lib/arena/testing/run-manifest.ts`). Only pins, seeds, outcomes, counts and digests leave the
 * local evidence: no prompt, no answer text, no state, no path, no key. A policy game is evidence for
 * that exact run; it maps to no recipe or scenario, so it passes nothing automatically.
 *
 * The candidate is the Claude seat, the baseline the local policy. Typed outcomes collapse onto the
 * contract's six: a completed game is win/loss/draw from Claude's side; every limit (moves, decisions,
 * wall time, budget, tokens) is `limit`; an engine-refused free choice or an illegal answer the retries
 * did not repair is `illegal`; everything else (malformed, refusal, rate, provider, cancelled,
 * interrupted, no progress) is `interrupted`. The exact kind stays in the local evidence.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ManifestRunner, PolicyEvalManifest, PolicyGameResult } from "../../src/lib/arena/testing/run-manifest";
import type { ReplayBundleRecord } from "../../src/lib/arena/replay-core";
import { assertManifest, evidenceHash, fixturePin, policyPin } from "./policy-evaluation-manifest";
import { LIMITED, type DuelResult, type DuelSettings, type ProviderKind } from "./claude-duel";
import { PROMPT_VERSION } from "./claude-duel-prompt";
import { policyRng } from "../../src/lib/arena/policy/rng";

export function claudePolicyPin(providerKind: ProviderKind, settings: DuelSettings) {
  const slug = settings.model.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  return {
    key: `${providerKind === "fake" ? "fake-claude" : "claude-api"}-${slug}`.slice(0, 128),
    version: `duel-prompt-v${PROMPT_VERSION}-${providerKind}-${slug}`.slice(0, 160),
    sha256: evidenceHash({ providerKind, settings, prompt: readFileSync("scripts/lib/claude-duel-prompt.ts", "utf8"), runner: readFileSync("scripts/lib/claude-duel.ts", "utf8") }),
  };
}

export function duelOutcome(r: DuelResult): Pick<PolicyGameResult, "outcome" | "winner" | "stopKind"> {
  if (r.outcome === "completed") return { outcome: r.winner === "claude" ? "win" : r.winner === "local" ? "loss" : "draw", winner: r.winnerSeat, stopKind: null };
  if (LIMITED.includes(r.outcome)) return { outcome: "limit", winner: null, stopKind: "limit" };
  if (r.outcome === "illegal") return { outcome: "illegal", winner: null, stopKind: "illegal" };
  return { outcome: "interrupted", winner: null, stopKind: "interrupted" };
}

export function duelManifest(runner: ManifestRunner & { id: "arena-claude-duel" }, input: {
  providerKind: ProviderKind;
  settings: DuelSettings;
  protocol: Record<string, unknown>;
  games: { bundle: ReplayBundleRecord; result: DuelResult }[];
}): PolicyEvalManifest {
  const candidate = claudePolicyPin(input.providerKind, input.settings);
  const baseline = policyPin("local-policy");
  const fixtures: PolicyEvalManifest["fixtures"] = [];
  const keys = new Map<string, string>();
  const results: PolicyGameResult[] = input.games.map(({ bundle, result: r }, i) => {
    const signature = evidenceHash({ payload: bundle.payload, decks: bundle.decks });
    let fixtureKey = keys.get(signature);
    if (!fixtureKey) {
      fixtureKey = `duel-fixture-${keys.size + 1}`;
      keys.set(signature, fixtureKey);
      fixtures.push(fixturePin(fixtureKey, bundle, r.pins.interpreterRevision));
    }
    const local = { mode: "seeded" as const, ...policyRng(r.pins.policySeed * 2 + (r.pins.localSeat === "p1" ? 1 : 2)) };
    const claude = { mode: "deterministic" as const, v: null, seed: null, n: null };
    return {
      key: `duel-${i + 1}`, kind: "policy_game", fixtureKey,
      candidatePolicyKey: candidate.key, baselinePolicyKey: baseline.key,
      seedIndex: null, seed: r.pins.gameSeed, candidateSeat: r.pins.claudeSeat,
      initialPolicyRng: r.pins.claudeSeat === "p1" ? { p1: claude, p2: local } : { p1: local, p2: claude },
      ...duelOutcome(r),
      moves: r.moves, turn: r.turn, damageDealt: r.damage.toLocal, damageTaken: r.damage.toClaude, guardTrips: r.localGuards,
      // Billed only: a dry run's fake calls are explicitly free, a paid run reports what the provider bills.
      reportedCostMicros: r.billedMicros,
      evidenceSha256: evidenceHash({ pins: r.pins, decisions: r.decisions, outcome: r.outcome, trace: r.trace }),
    };
  });
  const manifest: PolicyEvalManifest = {
    version: 1, source: "policy_eval", requestId: randomUUID(), runner,
    protocol: { id: input.providerKind === "fake" ? "arena-claude-duel-dry-v1" : "arena-claude-duel-paid-v1", revision: evidenceHash(input.protocol) },
    seedSet: "custom", fixtures, policies: [candidate, baseline], results,
  };
  assertManifest(manifest);
  return manifest;
}
