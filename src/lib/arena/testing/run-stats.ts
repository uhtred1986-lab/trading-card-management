import type { EvaluationManifest } from "./run-manifest";
import { TESTING_DECK_CATALOG } from "./catalog";

export interface RunScoreRow {
  key: string;
  label: string;
  games: number;
  appearances: number;
  wins: number;
  losses: number;
  draws: number;
  interrupted: number;
  limited: number;
  illegal: number;
  winRate: number | null;
}
export interface RunScores { games: number; policies: RunScoreRow[]; decks: RunScoreRow[] }

/** Descriptive scores for one complete imported run, never only its visible page.
 * Keep exact policy revisions and deck compositions apart. Missing deck hashes
 * stay fixture/seat-specific; a recipe label is not proof of identical lists.
 */
export function scoreImportedRun(manifest: EvaluationManifest): RunScores {
  if (manifest.source !== "policy_eval") return { games: 0, policies: [], decks: [] };
  const policies = new Map(manifest.policies.map(p => [p.key, p]));
  const fixtures = new Map(manifest.fixtures.map(f => [f.key, f]));
  const names = new Map(TESTING_DECK_CATALOG.map(deck => [deck.id, deck.name]));
  const policyRows = new Map<string, RunScoreRow>();
  const deckRows = new Map<string, RunScoreRow>();
  const seen = new Map<RunScoreRow, Set<string>>();
  function row(map: Map<string, RunScoreRow>, key: string, label: string) {
    let value = map.get(key);
    if (!value) {
      value = { key, label, games: 0, appearances: 0, wins: 0, losses: 0, draws: 0, interrupted: 0, limited: 0, illegal: 0, winRate: null };
      map.set(key, value);
      seen.set(value, new Set());
    }
    return value;
  }
  for (const result of manifest.results) {
    const fixture = fixtures.get(result.fixtureKey)!;
    for (const seat of ["p1", "p2"] as const) {
      const policy = policies.get(seat === result.candidateSeat ? result.candidatePolicyKey : result.baselinePolicyKey)!;
      const policyKey = JSON.stringify([policy.version, policy.sha256]);
      const hash = fixture[`${seat}DeckSha256`];
      const recipe = fixture[`${seat}RecipeId`];
      const name = recipe ? names.get(recipe) ?? recipe : null;
      const deckKey = hash ? `deck:${hash}` : JSON.stringify([fixture.key, seat]);
      const deckLabel = hash ? `${name ?? "Unmapped deck"} · ${hash.slice(0, 12)}` : `${name ?? fixture.sourceId} · ${seat} · composition unrecorded`;
      for (const score of [row(policyRows, policyKey, `${policy.version} · ${policy.sha256.slice(0, 12)}`), row(deckRows, deckKey, deckLabel)]) {
        score.appearances++;
        seen.get(score)!.add(result.key);
        score.games = seen.get(score)!.size;
        if (result.outcome === "win" || result.outcome === "loss") {
          if (result.winner === seat) score.wins++; else score.losses++;
        } else if (result.outcome === "draw") score.draws++;
        else if (result.outcome === "interrupted") score.interrupted++;
        else if (result.outcome === "limit") score.limited++;
        else score.illegal++;
        const decided = score.wins + score.losses;
        score.winRate = decided ? score.wins / decided : null;
      }
    }
  }
  const sorted = (map: Map<string, RunScoreRow>) => [...map.values()].sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
  return { games: manifest.results.length, policies: sorted(policyRows), decks: sorted(deckRows) };
}
