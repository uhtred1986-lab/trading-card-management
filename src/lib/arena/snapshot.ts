/**
 * One board, as any client renders it — the online entry point.
 *
 * Everything is in `snapshot-core.ts` (#641) and re-exported here unchanged;
 * this file only binds the core's engine seam to `engineFor`, the switch that
 * can read either engine's state. Every server path (`session.ts`, the API
 * routes, the tests' golden fixtures) imports this file, so their behaviour
 * is exactly what it was. The browser-safe entry, `browser.ts`, binds the same
 * core to the rules engine alone.
 */
import { engineFor } from "./engines";
import type { RejectedAction } from "./types";
import { buildSnapshotWith, rejectedForWith, type Snapshot, type SnapshotInput } from "./snapshot-core";

// Named, not `export *`: tsx's ESM loader cannot see names through a star
// re-export of a CommonJS-transpiled module (`verify-game-flow.mts`).
export {
  CONTRACT_VERSION,
  archivedSnapshotFor,
  buildSnapshotWith,
  buildUnconcealedSnapshotForProof,
  reconcileSnapshot,
  rejectedForWith,
  viewerFor,
  waitingFor,
  withSnapshotReading,
  type EngineResolver,
  type Snapshot,
  type SnapshotInput,
  type StoredSnapshot,
} from "./snapshot-core";

/**
 * Rejections are answers to "why can't I", which only the player being asked
 * can ask: they are computed for the viewer when the prompt is theirs, and
 * never for Claude, who cannot read them and whose turns would pay for them.
 */
export function rejectedFor(input: Parameters<typeof rejectedForWith>[1]): RejectedAction[] {
  return rejectedForWith(engineFor, input);
}

export function buildSnapshot(input: SnapshotInput): Snapshot {
  return buildSnapshotWith(engineFor, input);
}
