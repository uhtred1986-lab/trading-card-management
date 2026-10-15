/** SL-only testing portal contract. Page/actions authorize; stores validate data. */
export type ProgressStatus = "planned" | "in_progress" | "blocked" | "failed" | "passed";
export type ScenarioGroup = "family" | "strategy" | "white_cell_rule" | "white_cell_strategy";
export interface TestingDeckSeed {
  id: string; name: string; category: string; firstWave: boolean; description: string; source: string;
  release: string; leaderId: string; leaderName: string; mechanics: string[]; supportCardIds: string[]; notes: string;
}
export interface TestingScenarioSeed { id: string; name: string; group: ScenarioGroup; description: string; source: string }
export interface ProgressFields { status: ProgressStatus; note: string; evidence: string; version: number; updatedAt: string }
export interface TestingDeck extends TestingDeckSeed, ProgressFields { linkedDeckId: number | null }
export interface TestingScenario extends TestingScenarioSeed, ProgressFields {}
export interface ProgressUpdate { id: string; expectedVersion: number; status: ProgressStatus; note: string; evidence: string }
export interface DeckProgressUpdate extends ProgressUpdate { linkedDeckId: number | null }
export type MutationResult<T> = { ok: true; value: T } | { ok: false; reason: "conflict" | "not_found" };
export type ActorKind = "human" | "local_ai" | "opus" | "other_ai";
export interface MatchActor { kind: ActorKind; name: string; model: string | null }
export type MatchOutcome = "win" | "draw" | "interrupted" | "abandoned" | "limit";
export interface RecordTestingMatchInput {
  requestId: string;
  p1DeckId: string; p2DeckId: string;
  p1: MatchActor; p2: MatchActor;
  outcome: MatchOutcome; winner: "p1" | "p2" | null;
  seed: number | null; rulesRevision: string; evidence: string; note: string;
  /** Millionths of USD, reported manually; never estimated from actor labels. */
  reportedCostMicros: number | null;
}
export interface TestingMatch extends RecordTestingMatchInput { id: number; recordedAt: string }
export interface StatsFilter { actorKind?: ActorKind; model?: string; deckId?: string }
export interface StatRow {
  key: string; label: string; games: number; wins: number; losses: number; draws: number;
  completed: number; interrupted: number; abandoned: number; limit: number; playing: number;
  /** Seat rows count appearances; uniqueGames discloses exact mirrors. */
  appearances: number; uniqueGames: number;
  /** W/(W+L); null when no decisive games. Draws/unfinished excluded. */
  winRate: number | null; decided: number;
}
export interface MatchStats {
  matches: StatRow; byActor: StatRow[]; byDeck: StatRow[]; byMatchup: StatRow[]; denominator: string;
  cost: { knownCostMicros: number; pricedMatches: number; totalMatches: number; label: string };
}
export interface TestingDashboard {
  decks: TestingDeck[]; scenarios: TestingScenario[]; recentMatches: TestingMatch[];
  recordedStats: MatchStats; serverStats: MatchStats;
  actualDecks: { id: number; name: string; isTesting: boolean; game: string }[];
  sources: { recorded: string; server: string; local: string };
}
