import type { Action, GameEvent } from "./types";
import type { EngineState } from "./engines";
import type { ReplayBundleRecord } from "./replay-core";
import { RULES_ENGINE, replayWith, type PinnedReplayResult } from "./browser";

export interface OfflineReplayInput {
  bundle: ReplayBundleRecord;
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
  legalActions: PinnedReplayResult["legalActions"];
}

/**
 * Pure replay: this module performs no database, filesystem, environment or network reads.
 * It hands the saved game to the portable `replayWith` (#641) on the rules engine, the only
 * engine since #118.
 */
export async function replayOffline(input: OfflineReplayInput): Promise<OfflineReplayResult> {
  return replayWith(RULES_ENGINE, input);
}
