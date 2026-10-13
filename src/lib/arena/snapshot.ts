/**
 * One board, as any client renders it — the online entry point.
 *
 * Everything is in `snapshot-core.ts` and re-exported here unchanged. Every
 * server path (`session.ts`, the API routes, the tests' golden fixtures)
 * imports this file; the browser-safe entry, `browser.ts`, imports the core.
 */

// Named, not `export *`: tsx's ESM loader cannot see names through a star
// re-export of a CommonJS-transpiled module (`verify-game-flow.mts`).
export {
  CONTRACT_VERSION,
  buildSnapshot,
  buildUnconcealedSnapshotForProof,
  reconcileSnapshot,
  rejectedFor,
  viewerFor,
  waitingFor,
  withSnapshotReading,
  type Snapshot,
  type SnapshotInput,
} from "./snapshot-core";
