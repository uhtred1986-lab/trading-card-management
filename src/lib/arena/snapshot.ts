/**
 * One board, as any client renders it.
 *
 * Both the web board and the Android app are given exactly this and may do
 * nothing else with it: `view` is what the board looks like from one side,
 * `legal` is every move the engine will accept, and `beats` is what happened
 * since you last acted. A client that works out a legality, a power figure or
 * what a card does has broken the contract — see `docs/arena-client-contract.md`.
 *
 * This half is pure: no database, no Anthropic SDK, no network. That is what
 * lets `npm test` build snapshots and compare them against golden fixtures.
 * `session.ts` is the half that reaches the database.
 */
import type { EngineContext, GameState, LegalAction, PlayerId } from "./engine";
import { boardView, tappable, viewerOf, type BoardView, type CardArt, type Tappable } from "./view";
import type { Beats } from "./beats";
import type { ArenaMode, Spotlight } from "./games";

/** Bumped only when a field is removed or its meaning changes. */
export const CONTRACT_VERSION = 1;

export interface Snapshot {
  contract: typeof CONTRACT_VERSION;
  game: {
    id: number;
    mode: ArenaMode;
    status: string;
    turn: number;
    p1Name: string;
    p2Name: string;
  };
  view: BoardView;
  legal: LegalAction[];
  taps: Tappable;
  beats: Beats | null;
  spotlight: (Spotlight & { imageUrl: string | null }) | null;
  log: string[];
  /** Who the game is waiting on. Null once it is over or abandoned. */
  waiting: "you" | "opponent" | "referee" | null;
  spend: { calls: number; input: number; output: number; cached: number; micros: number };
  over: { winner: PlayerId | null; reason: string } | null;
}

export interface SnapshotInput {
  id: number;
  mode: ArenaMode;
  status: string;
  p1Name: string;
  p2Name: string;
  ctx: EngineContext;
  state: GameState;
  legal: LegalAction[];
  log: string[];
  beats: Beats | null;
  spotlight: Spotlight | null;
  spend: Snapshot["spend"];
  /** Claude's side, or null in a hot-seat game. */
  ai: PlayerId | null;
  /** Card art from the catalog, keyed by catalog id. Empty is fine. */
  images: Record<string, CardArt>;
}

/**
 * Which side the board is drawn from. In a game against Claude the human is
 * always the first player, so the board stays on their side even while Claude
 * is deciding; hot-seat follows whoever is being asked.
 */
export function viewerFor(input: Pick<SnapshotInput, "ai" | "state">): PlayerId {
  return input.ai ? "p1" : viewerOf(input.state);
}

/** Who the game is waiting on, which is what tells a client to sit still. */
export function waitingFor(input: Pick<SnapshotInput, "ai" | "state" | "status">): Snapshot["waiting"] {
  if (input.status !== "playing") return null;
  const prompt = input.state.prompt;
  if (prompt.kind === "referee") return "referee";
  if (input.ai && "player" in prompt && prompt.player === input.ai) return "opponent";
  return "you";
}

export function buildSnapshot(input: SnapshotInput): Snapshot {
  const viewer = viewerFor(input);
  return {
    contract: CONTRACT_VERSION,
    game: {
      id: input.id,
      mode: input.mode,
      status: input.status,
      turn: input.state.turn,
      p1Name: input.p1Name,
      p2Name: input.p2Name,
    },
    view: boardView(input.ctx, input.state, viewer, input.images),
    legal: input.legal,
    taps: tappable(input.legal),
    beats: withArt(input.beats, input.images),
    spotlight: input.spotlight ? { ...input.spotlight, imageUrl: input.images[input.spotlight.cardId]?.front ?? null } : null,
    log: input.log,
    waiting: waitingFor(input),
    spend: input.spend,
    over: input.state.phase === "over" ? { winner: input.state.winner, reason: input.state.overReason ?? "" } : null,
  };
}

/**
 * Beats are produced by a pure function that has never seen the catalog, so
 * the faces they carry arrive without art. A card a beat names may well have
 * left the board by now, which is the whole reason a beat carries its own face
 * instead of a client looking one up.
 */
function withArt(beats: Beats | null, images: Record<string, CardArt>): Beats | null {
  if (!beats) return null;
  const art: Beats["art"] = {};
  for (const [id, a] of Object.entries(beats.art)) {
    art[id] = { ...a, imageUrl: images[a.cardId]?.front ?? null };
  }
  return { ...beats, art };
}
