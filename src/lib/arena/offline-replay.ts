import type { Action, GameEvent } from "./types";
import type { EngineId, EngineState } from "./engines";
import { engineFor } from "./engines";
import type { ReplayBundleRecord } from "./replay-core";
import { replayWith } from "./browser";

export interface OfflineReplayInput {
  bundle: ReplayBundleRecord;
  engine: EngineId;
  seed: number;
  actions: Action[];
  /**
   * The interpreter revision of the code doing this replay, passed explicitly by the caller
   * (CLI flag, worker message). `null` means unknown and refuses exact replay; nothing here
   * reads the environment.
   */
  interpreterRevision: string | null;
}

export interface OfflineReplayResult {
  state: EngineState;
  events: GameEvent[];
  legalActions: ReturnType<ReturnType<typeof engineFor>["legalActions"]>;
}

/**
 * Pure replay: this module performs no database, filesystem, environment or network reads.
 * It resolves the saved game's engine (either one) through `engineFor` and hands it to the
 * portable `replayWith` (#641); a browser calls `replayWith` with the rules engine directly,
 * without this module's legacy-engine import.
 */
export async function replayOffline(input: OfflineReplayInput): Promise<OfflineReplayResult> {
  return replayWith(engineFor(input.engine), input);
}
