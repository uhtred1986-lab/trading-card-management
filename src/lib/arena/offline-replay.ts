import type { Action, GameEvent } from "./types";
import type { EngineId, EngineState } from "./engines";
import { engineFor } from "./engines";
import { assertInterpreterRevision, pinnedContext, validateReplayBundle, type ReplayBundleRecord } from "./replay-core";

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

/** Pure replay: this module performs no database, filesystem, environment or network reads. */
export async function replayOffline(input: OfflineReplayInput): Promise<OfflineReplayResult> {
  const { bundle } = input;
  if (!(await validateReplayBundle(bundle))) throw new Error("replay bundle failed content hash validation");
  if (!bundle.decks?.p1 || !bundle.decks?.p2) throw new Error("replay bundle is missing its initial decks");
  assertInterpreterRevision(bundle, input.interpreterRevision ?? null);
  const ctx = await pinnedContext(bundle);
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
