/**
 * `arena:diff -- --all`'s report — pure-function checks, no database, no
 * saved games. `scripts/arena-diff.mts` is the script under test;
 * `scripts/lib/arena-diff-report.ts` holds everything here that is pure
 * enough to test without a fake Neon.
 */
import assert from "node:assert/strict";
import { formatDiffReport, groupDiffOutcomes, type DiffOutcome } from "../lib/arena-diff-report";

const outcome = (over: Partial<DiffOutcome> & { id: number }): DiffOutcome => ({
  engine: "rules",
  actions: 10,
  divergence: null,
  same: true,
  deckChanged: false,
  ...over,
});

// ── every game replays clean ────────────────────────────────────────────────

{
  const grouped = groupDiffOutcomes([outcome({ id: 1 }), outcome({ id: 2 })]);
  assert.equal(grouped.same, 2);
  assert.deepEqual(grouped.causes, []);
  assert.deepEqual(grouped.deckChanged, []);
  assert.equal(grouped.stableTotal, 2);
  assert.equal(grouped.total, 2);
  assert.deepEqual(formatDiffReport(grouped), ["2 of 2 stable-deck games replay to the same state — 0 divergences"]);
}

// ── two games hit the same bug, one hits a different one — the same cause text clusters them,
//    and the bigger cluster is reported first regardless of game id order ──────────────────────

{
  const same = "refused: 22-14: no legal target";
  const rare = "threw: Cannot read properties of undefined (reading 'zones')";
  const grouped = groupDiffOutcomes([
    outcome({ id: 30, same: false, divergence: { at: 4, why: rare } }),
    outcome({ id: 10, same: false, divergence: { at: 2, why: same } }),
    outcome({ id: 5, same: true }),
    outcome({ id: 20, same: false, divergence: { at: 7, why: same } }),
  ]);
  assert.equal(grouped.same, 1);
  assert.equal(grouped.stableTotal, 4);
  assert.equal(grouped.causes.length, 2, "one cause per distinct 'why' text");
  assert.deepEqual(grouped.causes[0], { cause: same, ids: [10, 20] }, "the two-game cluster sorts first, and its ids are ascending regardless of input order");
  assert.deepEqual(grouped.causes[1], { cause: rare, ids: [30] });
  assert.deepEqual(
    formatDiffReport(grouped),
    [
      "1 of 4 stable-deck games replay to the same state — 2 distinct cause(s) of divergence:",
      `  2× ${same} — games 10, 20`,
      `  1× ${rare} — game 30`,
    ],
  );
}

// ── a tie in cluster size breaks on the cause text, so the order is deterministic ──────────────

{
  const grouped = groupDiffOutcomes([
    outcome({ id: 1, same: false, divergence: { at: 0, why: "z-cause" } }),
    outcome({ id: 2, same: false, divergence: { at: 0, why: "a-cause" } }),
  ]);
  assert.deepEqual(
    grouped.causes.map((c) => c.cause),
    ["a-cause", "z-cause"],
    "equal-sized clusters sort by cause text, not by which game reported first",
  );
}

// ── a deck edited since the game was played is set apart, never folded into a cause group,
//    whether or not it happens to replay to the same state anyway ─────────────────────────

{
  const grouped = groupDiffOutcomes([
    outcome({ id: 1, same: false, divergence: { at: 3, why: "refused: X" }, deckChanged: true }),
    outcome({ id: 2, same: true, deckChanged: true }),
    outcome({ id: 3, same: false, divergence: { at: 3, why: "refused: X" } }),
  ]);
  assert.equal(grouped.deckChanged.length, 2);
  assert.equal(grouped.same, 0, "the deck-changed game that happened to match is not counted toward the stable tally");
  assert.equal(grouped.stableTotal, 1, "only the one deck-unchanged game is 'stable'");
  assert.deepEqual(grouped.causes, [{ cause: "refused: X", ids: [3] }], "the deck-changed game sharing the same 'why' text is not folded into the cause group");
  const lines = formatDiffReport(grouped);
  assert.ok(lines.some((l) => l.includes("2 game(s) whose deck was edited")), "the deck-changed games are reported as their own section");
  assert.ok(lines.some((l) => l.includes("game 1: diverges at action 3/10: refused: X")));
  assert.ok(lines.some((l) => l.includes("game 2: replays to the same state anyway")));
}

console.log("diff-report: grouping clusters by cause, sorts deterministically, and keeps deck-changed games apart");
