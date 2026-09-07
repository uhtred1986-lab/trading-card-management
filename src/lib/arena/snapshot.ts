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
import { rejectedActions, type EngineContext, type GameState, type LegalAction, type PlayerId, type RejectedAction } from "./engine";
import { boardView, tappable, viewerOf, type BoardView, type CardArt, type Tappable } from "./view";
import { maskBeats, type Beats } from "./beats";
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
    /**
     * Which side this board was drawn for. `view.you` is this player, so a
     * client never has to work out which chair it is sitting in — and the two
     * devices in a 1 v 1 get different values for the same game.
     */
    you: PlayerId;
    /** The login in each seat, for the names on the board. Null outside a 1 v 1. */
    p1User?: string | null;
    p2User?: string | null;
  };
  view: BoardView;
  legal: LegalAction[];
  taps: Tappable;
  /**
   * The moves the asked player might reach for that are not in `legal`, each
   * with its reasons (`docs/arena-workflow-spec.md`). Only computed when the
   * viewer is the player being asked — never for Claude's side — and absent
   * when there is nothing to say.
   */
  rejected?: RejectedAction[];
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
  /** Claude's side, or null when both sides are people. */
  ai: PlayerId | null;
  /**
   * Whose eyes this board is for, when the caller knows. A 1 v 1 passes the
   * asking player's seat; everything else leaves it off and keeps the derived
   * behaviour below.
   */
  viewer?: PlayerId | null;
  /** The login in each seat, copied onto the snapshot. */
  p1User?: string | null;
  p2User?: string | null;
  /** Card art from the catalog, keyed by catalog id. Empty is fine. */
  images: Record<string, CardArt>;
}

/**
 * Which side the board is drawn from.
 *
 * A caller who knows whose board this is says so — that is the 1 v 1 case,
 * where the same game is drawn twice and each device must stay in its own
 * chair. Nobody else does, and the two old rules stand: against Claude the
 * human is always the first player, so the board stays on their side even
 * while Claude is deciding, and hot-seat follows whoever is being asked, which
 * is what swings one device between the two hands.
 */
export function viewerFor(input: Pick<SnapshotInput, "ai" | "state" | "viewer">): PlayerId {
  if (input.viewer) return input.viewer;
  return input.ai ? "p1" : viewerOf(input.state);
}

/**
 * Who the game is waiting on, which is what tells a client to sit still.
 *
 * Read against the viewer rather than against Claude, so "opponent" now covers
 * a person as well. That is what makes the board's long-poll work for a 1 v 1
 * without touching it: it already watches while `waiting` is "opponent".
 *
 * Unchanged for everything else. Against Claude the viewer is p1 and the
 * prompt is p2, so it still reads "opponent"; in hot-seat the viewer *is* the
 * asked player, so it still reads "you" and the one device keeps both chairs.
 */
export function waitingFor(input: Pick<SnapshotInput, "ai" | "state" | "status" | "viewer">): Snapshot["waiting"] {
  if (input.status !== "playing") return null;
  const prompt = input.state.prompt;
  if (prompt.kind === "referee") return "referee";
  if (!("player" in prompt) || !prompt.player) return "you";
  return prompt.player === viewerFor(input) ? "you" : "opponent";
}

/**
 * Rejections are answers to "why can't I", which only the player being asked
 * can ask: they are computed for the viewer when the prompt is theirs, and
 * never for Claude, who cannot read them and whose turns would pay for them.
 */
export function rejectedFor(input: Pick<SnapshotInput, "ai" | "state" | "ctx" | "legal" | "viewer">): RejectedAction[] {
  const prompt = input.state.prompt;
  if (!("player" in prompt) || !prompt.player) return [];
  if (prompt.player !== viewerFor(input) || prompt.player === input.ai) return [];
  return rejectedActions(input.ctx, input.state, input.legal);
}

export function buildSnapshot(input: SnapshotInput): Snapshot {
  const viewer = viewerFor(input);
  const rejected = rejectedFor(input);
  return {
    contract: CONTRACT_VERSION,
    game: {
      id: input.id,
      mode: input.mode,
      status: input.status,
      turn: input.state.turn,
      p1Name: input.p1Name,
      p2Name: input.p2Name,
      you: viewer,
      ...(input.p1User !== undefined ? { p1User: input.p1User } : {}),
      ...(input.p2User !== undefined ? { p2User: input.p2User } : {}),
    },
    view: boardView(input.ctx, input.state, viewer, input.images),
    legal: input.legal,
    taps: tappable(input.legal, rejected),
    ...(rejected.length ? { rejected } : {}),
    // Masked before the art goes on: a beat naming a card this viewer may not
    // see must not carry its name or its face. See `maskBeats`.
    beats: withArt(maskBeats(input.state, input.beats, viewer), input.images),
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
