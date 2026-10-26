/**
 * The browser-safe rules entry point (#641, plan O1-03): create a game on a
 * pinned replay bundle, apply moves, read the legal moves and project a
 * viewer-safe snapshot — with nothing but the rules engine (`./vm`), the
 * portable replay core (`replay-core.ts`) and the engine-neutral snapshot core
 * (`snapshot-core.ts`). It runs unchanged in Node and in a browser (module)
 * worker.
 *
 * Boundary, checked by `scripts/verify/arena-browser-boundary.mts` over the
 * whole transitive value-import graph: no database, Drizzle, auth, AI,
 * cache, CardTrader or `@/app` module, no Node builtin or package, no
 * `process.env`. Nothing here performs I/O: the bundle and the interpreter
 * revision are handed in by the caller (a worker message, a CLI flag).
 *
 * Only the rules engine plays here (it is the only engine, #118).
 */
import type { Action, EngineContext, GameEvent, LegalAction, PlayerId } from "./types";
import type { Engine, EngineState } from "./engines";
import type { CardArt } from "./view";
import type { ArenaMode } from "./games";
import { RULES } from "./vm";
import type { VmState } from "./vm/state";
import { appendBeats } from "./beats-core";
import type { Beats } from "./beats";
import { buildSnapshot, buildUnconcealedSnapshotForProof, type Snapshot } from "./snapshot-core";
import { assertInterpreterRevision, pinnedContext, validateReplayBundle, type PinnedContext, type ReplayBundleRecord } from "./replay-core";

/** The rules engine, typed as the switch's `Engine` (what `engines.ts` does for the server). */
export const RULES_ENGINE: Engine = RULES;

/** A pinned rules-engine match: everything needed to continue it, and nothing server-side. */
export interface PinnedMatch {
  ctx: PinnedContext;
  state: VmState;
  /** The animation queue, as `games.ts` keeps it online (bounded by `BEAT_CAP`). */
  beats: Beats | null;
  /** The bundle's card art, for the projected board. */
  art: Record<string, CardArt>;
  names: { p1: string; p2: string };
}

export interface CreatePinnedMatchInput {
  bundle: ReplayBundleRecord;
  seed: number;
  /**
   * The interpreter revision of the code running this match, passed by the
   * caller. It must equal the bundle's: a pinned match is only the bundle's
   * game when the interpreter is the one the bundle was recorded against.
   */
  interpreterRevision: string | null;
}

/** Validate the bundle's content hashes and provenance, and build its pinned context. */
export async function openPinnedBundle(bundle: ReplayBundleRecord, interpreterRevision: string | null): Promise<PinnedContext> {
  if (!(await validateReplayBundle(bundle))) throw new Error("replay bundle failed content hash validation");
  if (!bundle.decks?.p1 || !bundle.decks?.p2) throw new Error("replay bundle is missing its initial decks");
  assertInterpreterRevision(bundle, interpreterRevision ?? null);
  return pinnedContext(bundle);
}

/** Create a game on a pinned bundle and run it to its first question. */
export async function createPinnedMatch(input: CreatePinnedMatchInput): Promise<{ match: PinnedMatch; events: GameEvent[] }> {
  const ctx = await openPinnedBundle(input.bundle, input.interpreterRevision);
  const made = RULES_ENGINE.createGame(ctx, { seed: input.seed, ...(input.bundle.payload.game ? { game: input.bundle.payload.game } : {}), ...input.bundle.decks });
  const state = made.state;
  const match: PinnedMatch = {
    ctx,
    state,
    beats: appendBeats(null, RULES_ENGINE.toBeats(ctx, state, made.events, 0)),
    art: structuredClone(input.bundle.payload.art),
    names: { p1: input.bundle.decks.p1.name, p2: input.bundle.decks.p2.name },
  };
  return { match, events: made.events };
}

/** Every move the rules engine will accept now. */
export function legalMoves(match: PinnedMatch): LegalAction[] {
  return RULES_ENGINE.legalActions(match.ctx, match.state);
}

/**
 * Apply one move. The engine refuses an illegal one (`IllegalAction`); the
 * match passed in is never mutated, so a refused move leaves it as it was.
 */
export function applyMove(match: PinnedMatch, action: Action): { match: PinnedMatch; events: GameEvent[] } {
  const next = RULES_ENGINE.apply(match.ctx, match.state, action);
  const state = next.state;
  const beats = appendBeats(match.beats, RULES_ENGINE.toBeats(match.ctx, state, next.events, match.beats?.seq ?? 0));
  return { match: { ...match, state, beats }, events: next.events };
}

/**
 * One side's board, masked for that viewer exactly as the server's
 * `buildSnapshot` masks it: the same core, bound to the rules engine.
 * `viewer` names the seat, so the other seat's moves and hidden cards are
 * never in the result, and a hidden card is named only by its position
 * (`conceal.ts`). `unconcealedForProof` keeps the raw instance ids, for a
 * proof's negative control only (`arena-policy-contract.mts`).
 */
export function projectSnapshot(match: PinnedMatch, viewer: PlayerId, options: { id?: number; revision?: number; mode?: ArenaMode; unconcealedForProof?: true } = {}): Snapshot {
  const over = match.state.phase === "over";
  return (options.unconcealedForProof ? buildUnconcealedSnapshotForProof : buildSnapshot)({
    id: options.id ?? 0,
    revision: options.revision ?? 0,
    mode: options.mode ?? "versus",
    game: match.state.game,
    status: over ? "over" : "playing",
    p1Name: match.names.p1,
    p2Name: match.names.p2,
    ctx: match.ctx,
    state: match.state,
    legal: over ? [] : legalMoves(match),
    log: [],
    beats: match.beats,
    spotlight: null,
    spend: { calls: 0, input: 0, output: 0, cached: 0, micros: 0 },
    ai: null,
    viewer,
    images: match.art,
  });
}

/** What `replayWith` returns: the final state, every event in order, and the moves open at the end. */
export interface PinnedReplayResult {
  state: EngineState;
  events: GameEvent[];
  legalActions: LegalAction[];
}

/**
 * Replay a pinned bundle's game on the engine the caller supplies. This is the
 * injectable seam: `offline-replay.ts` and a browser both pass `RULES_ENGINE`.
 */
export async function replayWith(engine: Engine, input: { bundle: ReplayBundleRecord; seed: number; actions: Action[]; interpreterRevision: string | null }): Promise<PinnedReplayResult> {
  const ctx: EngineContext = await openPinnedBundle(input.bundle, input.interpreterRevision);
  const created = engine.createGame(ctx, { seed: input.seed, ...(input.bundle.payload.game ? { game: input.bundle.payload.game } : {}), ...input.bundle.decks });
  let state = created.state;
  const events = [...created.events];
  for (const action of input.actions) {
    const next = engine.apply(ctx, state, action);
    state = next.state;
    events.push(...next.events);
  }
  return { state, events, legalActions: engine.legalActions(ctx, state) };
}
