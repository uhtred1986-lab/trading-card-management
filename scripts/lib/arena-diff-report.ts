/**
 * Pure grouping/formatting logic for `arena:diff -- --all` (`scripts/arena-diff.mts`), split
 * out so `scripts/verify/diff-report.ts` can exercise it on synthetic outcomes with no database
 * and no saved games. Replaying a game and comparing its final state stay in the script itself
 * (`replay()`, `firstDiff()`); this module only turns the per-game outcomes the script already
 * computed into the report a person reads: divergences clustered by cause, deck-edited games
 * listed apart from the rest (docs/arena-tooling.md §4).
 */
import type { EngineId } from "../../src/lib/arena/engines";

/** One game's replay outcome, exactly what `arena-diff.mts`'s own `replay()` returns. */
export interface DiffOutcome {
  id: number;
  engine: EngineId;
  actions: number;
  /**
   * Null when the replay reached the end and matched the row. Otherwise the
   * action index and why — the first differing prompt or refused action, or,
   * when every action replayed without complaint, the first field (by sorted
   * key) at which the final state disagrees with the row.
   */
  divergence: { at: number; why: string } | null;
  same: boolean;
  /**
   * A deck edited since the game was played changes the shuffle (§3 of
   * `docs/arena-backlog/s9-01-replay-all.md`) — any divergence here says
   * nothing about the engine, so these are reported apart from the rest
   * rather than mixed into the cause groups below.
   */
  deckChanged: boolean;
}

export interface CauseGroup {
  /**
   * The shared "why" text every game in the group diverged on. Two games
   * hitting the same underlying bug report the identical first differing
   * prompt or refused action, so grouping by the literal text is how the
   * report tells "one bug, N games" from "N distinct bugs" without guessing
   * at what the bug actually is.
   */
  cause: string;
  /** Game ids sharing this cause, ascending. */
  ids: number[];
}

export interface GroupedDiffReport {
  /** Games whose deck was edited since they were played — never mixed into `causes`. */
  deckChanged: DiffOutcome[];
  /** Count of deck-unchanged games that replayed to the same state as the row. */
  same: number;
  /** Deck-unchanged games that diverged, clustered by cause — largest group first. */
  causes: CauseGroup[];
  /** Deck-unchanged games considered (`same` plus every id across `causes`). */
  stableTotal: number;
  /** All games considered, deck-changed included — the `--all` row count. */
  total: number;
}

/**
 * Groups `--all`'s per-game replay outcomes into the shape the report reads:
 * deck-edited games set aside first, then every genuine divergence among the
 * rest bucketed by its "why" text, largest bucket first and ties broken by
 * the cause text so the output is deterministic.
 */
export function groupDiffOutcomes(outcomes: DiffOutcome[]): GroupedDiffReport {
  const deckChanged = outcomes.filter((o) => o.deckChanged);
  const stable = outcomes.filter((o) => !o.deckChanged);
  const same = stable.filter((o) => o.same).length;

  const byCause = new Map<string, number[]>();
  for (const o of stable) {
    if (o.same || !o.divergence) continue;
    const ids = byCause.get(o.divergence.why) ?? [];
    ids.push(o.id);
    byCause.set(o.divergence.why, ids);
  }
  const causes = [...byCause.entries()]
    .map(([cause, ids]) => ({ cause, ids: [...ids].sort((a, b) => a - b) }))
    .sort((a, b) => b.ids.length - a.ids.length || a.cause.localeCompare(b.cause));

  return { deckChanged, same, causes, stableTotal: stable.length, total: outcomes.length };
}

/**
 * Renders a `GroupedDiffReport` the way `arena:diff -- --all` prints it — a
 * pure function so the exact wording is covered by a synthetic-input case
 * (`scripts/verify/diff-report.ts`) rather than only ever read off a real run.
 */
export function formatDiffReport(report: GroupedDiffReport): string[] {
  const lines: string[] = [];
  if (report.causes.length === 0) {
    lines.push(`${report.same} of ${report.stableTotal} stable-deck games replay to the same state — 0 divergences`);
  } else {
    lines.push(`${report.same} of ${report.stableTotal} stable-deck games replay to the same state — ${report.causes.length} distinct cause(s) of divergence:`);
    for (const group of report.causes) {
      lines.push(`  ${group.ids.length}× ${group.cause} — game${group.ids.length > 1 ? "s" : ""} ${group.ids.join(", ")}`);
    }
  }
  if (report.deckChanged.length) {
    lines.push(`${report.deckChanged.length} game(s) whose deck was edited since it was played — shuffle differs, not counted as an engine divergence:`);
    for (const o of report.deckChanged) {
      lines.push(`  game ${o.id}: ${o.same ? "replays to the same state anyway" : `diverges at action ${o.divergence?.at ?? "?"}/${o.actions}: ${o.divergence?.why ?? "differs"}`}`);
    }
  }
  return lines;
}
