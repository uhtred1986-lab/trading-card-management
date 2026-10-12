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
import type { EngineContext, LegalAction, PlayerId, RejectedAction } from "./types";
import { engineFor, FALLBACK_ENGINE, isVmState, type EngineId, type EngineState } from "./engines";
import { tappable, viewerOf, type BoardView, type CardArt, type Tappable } from "./view";
import { maskBeats, type Beats } from "./beats";
import type { ArenaMode, Spotlight } from "./games";
import { DEFAULT_GAME, type Game } from "@/lib/catalog/games";
import { NOT_YET_REASON_PREFIX, resolveOutcome, type PublicOutcome } from "./outcome";
import { rulesetFor, type GameDefinition } from "./rulesets";
import { withTokens } from "./vm/cards";
import { readingBoard } from "./vm/program";

/** Bumped only when a field is removed or its meaning changes. */
export const CONTRACT_VERSION = 2;

export interface Snapshot {
  contract: typeof CONTRACT_VERSION;
  game: {
    id: number;
    /** Authoritative row revision; unrelated to the animation beat sequence. */
    revision: number;
    mode: ArenaMode;
    /**
     * Which engine is playing this game (`engines.ts`) and which card game
     * the decks belong to. A client shows the engine as a badge and reads
     * nothing else off either: what the board is, `view` says.
     */
    engine: EngineId;
    game: Game;
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
    /**
     * True only for a legacy row read off its stored snapshot (issue #335)
     * rather than computed live. A client shows the banner this implies —
     * "archived, cannot be continued" — and nothing else: `legal` is already
     * empty and `waiting` already null, exactly as a finished game's are, so
     * no other field needs a client to treat it differently. Absent (never
     * `false`) on every live snapshot, so the field changes no existing
     * fixture.
     */
    archived?: true;
  };
  view: BoardView;
  /** The actor and exact engine prompt/phase that currently owns the decision. */
  decision?: { actor: PlayerId | null; window: string; phase: string; battleStep: string | null };
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
  over: PublicOutcome | null;
}

/** Reconcile server responses without allowing an older render or poll to roll a board back. */
export function reconcileSnapshot(current: Snapshot, incoming: Snapshot): Snapshot {
  return incoming.game.id !== current.game.id || incoming.game.revision > current.game.revision ? incoming : current;
}

export interface SnapshotInput {
  id: number;
  /** Missing only in hand-built historical fixtures. */
  revision?: number;
  mode: ArenaMode;
  /**
   * Left off by tests built by hand, which are all on the legacy engine and
   * the original game — so what fills it in is `FALLBACK_ENGINE`, not
   * `DEFAULT_ENGINE`. The two diverged at #166 and an input with no engine
   * still means a legacy-shaped state, which is also what keeps the contract
   * fixtures still saying `legacy` after the flip.
   */
  engine?: EngineId;
  game?: Game;
  status: string;
  p1Name: string;
  p2Name: string;
  ctx: EngineContext;
  state: EngineState;
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
export function rejectedFor(input: Pick<SnapshotInput, "ai" | "state" | "ctx" | "legal" | "viewer" | "engine"> & { status?: string }): RejectedAction[] {
  if (input.status !== undefined && input.status !== "playing") return [];
  const prompt = input.state.prompt;
  if (!("player" in prompt) || !prompt.player) return [];
  if (prompt.player !== viewerFor(input) || prompt.player === input.ai) return [];
  return engineFor(input.engine ?? FALLBACK_ENGINE).rejectedActions(input.ctx, input.state, input.legal);
}

/**
 * The moves this board may list. A 1 v 1 seat (`viewer` named) sees none of
 * the other seat's: their labels name the cards in that player's hand ("Play
 * Son Goku"), which is exactly what 3-3-3 keeps from the opponent, and the
 * server refuses a move from the wrong seat anyway (#458). Everyone else keeps
 * the whole list, as before.
 */
function legalFor(input: Pick<SnapshotInput, "state" | "status" | "legal" | "viewer">): LegalAction[] {
  if (input.status !== "playing") return [];
  if (!input.viewer) return input.legal;
  const prompt = input.state.prompt;
  const asked = "player" in prompt ? prompt.player : null;
  return asked && asked !== input.viewer ? [] : input.legal;
}

/**
 * Share only viewer-independent standing rules while one immutable board is
 * being read. The scope ends with this synchronous callback: a later request,
 * revision, reload or different rules context always reads its own state.
 * The rules engine wraps contexts with `withTokens` at every entry point, so
 * this must use the same wrapper and the exact pinned definition when present.
 */
export function withSnapshotReading<T>(input: Pick<SnapshotInput, "engine" | "ctx" | "state">, read: () => T): T {
  if ((input.engine ?? FALLBACK_ENGINE) !== "rules" || !isVmState(input.state)) return read();
  const pinned = (input.ctx as EngineContext & { rulesetDefinition?: GameDefinition }).rulesetDefinition;
  const loaded = pinned?.id === input.state.game ? null : rulesetFor(input.state.game);
  const definition = pinned?.id === input.state.game ? pinned : loaded?.ok ? loaded.definition : null;
  if (!definition) return read(); // Let the engine report a missing/broken ruleset as before.
  return readingBoard(withTokens(input.ctx), definition, input.state, read);
}

export function buildSnapshot(input: SnapshotInput): Snapshot {
  return withSnapshotReading(input, () => buildSnapshotInRead(input));
}

function buildSnapshotInRead(input: SnapshotInput): Snapshot {
  const viewer = viewerFor(input);
  const rejected = rejectedFor(input);
  const legal = legalFor(input);
  const outcome = resolveOutcome(input.state as EngineState & { outcome?: import("./outcome").StoredOutcome | null }, input.status);
  const engine = engineFor(input.engine ?? FALLBACK_ENGINE);
  const abilityAvailability = engine.abilityAvailability(input.ctx, input.state, viewer, legal, rejected);
  const boardView = engine.boardView(input.ctx, input.state, viewer, input.images, abilityAvailability);
  if (outcome) boardView.over = { winner: outcome.winner, reason: outcome.reason };
  return {
    contract: CONTRACT_VERSION,
    game: {
      id: input.id,
      revision: input.revision ?? 0,
      mode: input.mode,
      engine: input.engine ?? FALLBACK_ENGINE,
      game: input.game ?? DEFAULT_GAME,
      status: input.status,
      turn: input.state.turn,
      p1Name: input.p1Name,
      p2Name: input.p2Name,
      you: viewer,
      ...(input.p1User !== undefined ? { p1User: input.p1User } : {}),
      ...(input.p2User !== undefined ? { p2User: input.p2User } : {}),
    },
    view: boardView,
    decision: { actor: boardView.prompt.player, window: boardView.prompt.kind, phase: boardView.phase, battleStep: boardView.battle?.step ?? null },
    legal,
    taps: tappable(legal, rejected),
    ...(rejected.length ? { rejected } : {}),
    // Masked before the art goes on: a beat naming a card this viewer may not
    // see must not carry its name or its face. See `maskBeats`.
    beats: withArt(publicBeats(maskBeats(input.state, input.beats, viewer, input.ctx), outcome), input.images),
    spotlight: input.spotlight ? { ...input.spotlight, imageUrl: input.images[input.spotlight.cardId]?.front ?? null } : null,
    log: publicLog(input.log, outcome),
    waiting: waitingFor(input),
    spend: input.spend,
    over: outcome,
  };
}

/**
 * What a legacy row keeps forever once it is archived (issue #335, `games.ts`'s
 * `loadArchivedGame`) — the last `Snapshot`(s) `buildSnapshot` produced for it,
 * computed once while `engine/` still exists and never recomputed after.
 *
 * `versus` is the one mode with a real hidden-hand boundary between two
 * logins (§3.3 of the client contract), and archiving must not flatten it
 * into a single board that leaks one seat's hand to the other — so it keeps
 * one masked `Snapshot` per seat. Every other mode has no second viewer to
 * protect against (hot-seat is one device; against Claude the human is
 * always `p1`), so `shared` is the only key a non-`versus` row ever sets.
 */
export interface StoredSnapshot {
  shared?: Snapshot;
  p1?: Snapshot;
  p2?: Snapshot;
}

const ARCHIVED_TAPS: Tappable = { byCard: {}, bare: [], attackTargets: {} };

/**
 * The archived reading of a stored snapshot, for the seat asking (`null`
 * outside `versus`) — never recomputed from `state`, since an archived row
 * is read after `engine/` may already be gone. `legal`/`taps`/`waiting` are
 * overridden here rather than trusted from storage, so a row archived
 * mid-game (still `"playing"`) reads exactly like a finished one: nothing to
 * tap, nothing to wait on. Everything else — `view`, `log`, `beats`,
 * `spotlight`, `spend`, `over` — is the frozen board as it last stood.
 *
 * Null when the seat asking has no stored board at all (a `versus` row
 * archived before both seats' snapshots existed), which the caller treats
 * the same as "no such game".
 */
export function archivedSnapshotFor(store: StoredSnapshot, seat: PlayerId | null, revision?: number): Snapshot | null {
  const picked = seat ? store[seat] : store.shared;
  if (!picked) return null;
  const rest: Snapshot = { ...picked };
  delete rest.rejected;
  const storedKind = picked.over && isOutcomeKind((picked.over as PublicOutcome).kind) ? (picked.over as PublicOutcome).kind : null;
  const storedOutcome: PublicOutcome | null = picked.over && storedKind
    ? {
        kind: storedKind,
        winner: picked.over.winner,
        reason: picked.over.reason,
        ...((picked.over as PublicOutcome).concededBy ? { concededBy: (picked.over as PublicOutcome).concededBy } : {}),
      }
    : null;
  const over = picked.over
    ? resolveOutcome({ winner: picked.over.winner, overReason: picked.over.reason, outcome: storedOutcome }, picked.game.status) ?? picked.over
    : picked.game.status === "abandoned"
      ? resolveOutcome({ winner: picked.view.over?.winner, overReason: picked.view.over?.reason }, "abandoned")
      : picked.over;
  const view = { ...picked.view, over: over ? { winner: over.winner, reason: over.reason } : null };
  return {
    ...rest,
    contract: CONTRACT_VERSION,
    game: { ...picked.game, revision: revision ?? picked.game.revision ?? 0, archived: true },
    view,
    decision: { actor: null, window: "archived", phase: picked.view.phase, battleStep: null },
    over,
    beats: publicBeats(picked.beats, over),
    log: publicLog(picked.log, over),
    legal: [],
    taps: ARCHIVED_TAPS,
    waiting: null,
  };
}

function publicLog(lines: string[], outcome: PublicOutcome | null): string[] {
  if (outcome?.kind !== "interrupted") return lines;
  return lines.map((line) => line.includes(NOT_YET_REASON_PREFIX)
    || line.includes("and no rule this engine can read says what happens")
    || line.includes("charging an action price or an X price is #149's")
    ? outcome.reason
    : line);
}

function isOutcomeKind(value: unknown): value is PublicOutcome["kind"] {
  return value === "win" || value === "draw" || value === "concession" || value === "abandoned" || value === "interrupted";
}

function publicBeats(beats: Beats | null, outcome: PublicOutcome | null): Beats | null {
  if (!beats || outcome?.kind !== "interrupted") return beats;
  return {
    ...beats,
    list: beats.list.map((beat) => beat.t === "over" ? { ...beat, winner: null, reason: outcome.reason } : beat),
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
