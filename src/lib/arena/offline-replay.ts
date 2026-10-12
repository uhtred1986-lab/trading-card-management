import type { Action, GameEvent } from "./types";
import type { EngineId, EngineState } from "./engines";
import { engineFor } from "./engines";
import { pinnedContext, runtimeRevision, validateReplayBundle, type ReplayBundleRecord } from "./replay-bundle";

export interface OfflineReplayInput {
  bundle: ReplayBundleRecord;
  engine: EngineId;
  seed: number;
  actions: Action[];
  /** The interpreter revision of the code doing this replay. Required for exact reproduction. */
  interpreterRevision?: string | null;
}

export interface OfflineReplayResult {
  state: EngineState;
  events: GameEvent[];
  legalActions: ReturnType<ReturnType<typeof engineFor>["legalActions"]>;
}

/** Pure replay: this module performs no database, filesystem or network reads. */
export function replayOffline(input: OfflineReplayInput): OfflineReplayResult {
  const { bundle } = input;
  if (!validateReplayBundle(bundle)) throw new Error("replay bundle failed content hash validation");
  if (!bundle.decks?.p1 || !bundle.decks?.p2) throw new Error("replay bundle is missing its initial decks");
  const local = input.interpreterRevision === undefined ? runtimeRevision() : input.interpreterRevision;
  if (!bundle.runtimeRevision || !local || bundle.runtimeRevision !== local) {
    throw new Error("interpreter provenance is missing or does not match this replay runtime");
  }
  const ctx = pinnedContext(bundle);
  const engine = engineFor(input.engine);
  const created = engine.createGame(ctx, { seed: input.seed, ...bundle.decks });
  let state = created.state;
  const events = [...created.events];
  for (const action of input.actions) {
    const next = engine.apply(ctx, state, action);
    state = next.state;
    events.push(...next.events);
  }
  return { state, events, legalActions: engine.legalActions(ctx, state) };
}
