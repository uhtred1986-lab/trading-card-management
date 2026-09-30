/**
 * The match-review replay (issue #351): rebuild what an admin needs to look at
 * one turn of a saved game — the board as it stood when the turn began, and each
 * move of the turn with what was legal, what was chosen and why.
 *
 * Nothing here is new engine code. A game is its seed plus its actions, so this
 * does what `scripts/arena-diff.mts` does: `createGame`, then `apply` every
 * action in order, through the same `Engine` interface the saved-game layer
 * uses. Pure — the caller reads the rows and hands the decks' inputs in, so a
 * verify script can run it with no database.
 *
 * Only the wanted turn is worked out in detail (legal moves, refusals, beats);
 * the rest of the game is walked only to learn which turns exist.
 */
import type { Action, EngineContext, GameOptions, PlayerId } from "./engine";
import { engineFor, type EngineId, type EngineState } from "./engines";
import { narrate, type Narrator } from "./narration";
import type { NumberedBeat } from "./beats";
import type { BoardView, CardArt } from "./view";
import { sentence } from "./wording";

/** The columns of an `arena_decisions` row the review reads. */
export interface DecisionRow {
  turn: number;
  player: string;
  kind: string;
  decidedBy: string;
  how: string;
  model: string | null;
  chosenLabel: string | null;
  say: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number | null;
}

export interface ReviewDecision {
  decidedBy: "rule" | "claude" | "fallback";
  how: string;
  model: string | null;
  say: string | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number | null;
}

export interface ReviewBeat {
  /** 0-based position in the game's action log — what a flag stores as `beatIndex`. */
  index: number;
  /** `index + 1`, the number the list shows. */
  n: number;
  turn: number;
  player: PlayerId;
  who: string;
  /** The action's type: `play`, `attack`, `charge`, `endMain` … */
  kind: string;
  /** The move as the menu worded it ("Play Son Goku (3)"). */
  label: string;
  /** What the engine's beats say happened, in the board's own sentences. */
  story: string[];
  /** The catalog id of the card the move names, for the workbench link; null for a token or none. */
  cardId: string | null;
  cardName: string | null;
  /** Every legal move at that point, and which one was taken. */
  offered: string[];
  /** Null when the move was not on the list — a replay that drifted from the saved game. */
  chosenIndex: number | null;
  /** Moves the asked player might have reached for that were refused, each with the requirement that failed. */
  refused: { label: string; why: string[] }[];
  /** What the server recorded for this move, for a move it took; null for a human's. */
  decision: ReviewDecision | null;
}

export interface Review {
  /** Every turn the game reached, in order. */
  turns: number[];
  /** The turn the detail below is for; null when the game has no moves. */
  turn: number | null;
  /** The board as it stood before the turn's first move. */
  board: BoardView | null;
  beats: ReviewBeat[];
  /** Set when the replay stopped early — an action the engine refuses now. The moves before it are still shown. */
  drift: string | null;
}

function sameAction(a: Action, b: Action): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The instance the move is about, whatever the action calls it. */
function subjectOf(a: Action): string | null {
  const x = a as unknown as Record<string, unknown>;
  for (const k of ["card", "attacker"]) if (typeof x[k] === "string") return x[k] as string;
  return null;
}

/**
 * Replay `actions` from the seed and report on `turn` (the game's last turn when omitted).
 * `decisions` are the game's `arena_decisions`; a decision is matched to the move whose menu
 * label it chose, in order, so a human's moves — which record nothing — simply have none.
 */
export function replayForReview(input: {
  engine: EngineId;
  ctx: EngineContext;
  options: GameOptions;
  actions: Action[];
  decisions: DecisionRow[];
  images: Record<string, CardArt>;
  names: Record<PlayerId, string>;
  turn?: number;
}): Review {
  const engine = engineFor(input.engine);
  let { state } = engine.createGame(input.ctx, input.options);
  const turns: number[] = [];
  const pre: EngineState[] = [];
  let drift: string | null = null;
  // Pass 1: the states, and which turns exist. Cheap — no menus are built.
  for (let i = 0; i < input.actions.length; i++) {
    if (!turns.includes(state.turn)) turns.push(state.turn);
    try {
      const next = engine.apply(input.ctx, state, input.actions[i]).state;
      pre.push(state);
      state = next;
    } catch (err) {
      drift = `move ${i + 1} is refused on replay: ${err instanceof Error ? err.message : String(err)}`;
      break;
    }
  }
  if (!turns.includes(state.turn)) turns.push(state.turn);
  const turn = input.turn !== undefined && turns.includes(input.turn) ? input.turn : turns.length ? turns[turns.length - 1] : null;
  if (turn === null) return { turns, turn: null, board: null, beats: [], drift };

  const first = pre.findIndex((s) => s.turn === turn);
  const viewer: PlayerId = "p1";
  const board = engine.boardView(input.ctx, first >= 0 ? pre[first] : state, viewer, input.images);

  const pool = input.decisions.filter((d) => d.kind === "move" && d.turn === turn);
  const beats: ReviewBeat[] = [];
  for (let i = first; first >= 0 && i < pre.length; i++) {
    const before = pre[i];
    if (before.turn !== turn) break;
    const action = input.actions[i];
    const { state: after, events } = engine.apply(input.ctx, before, action);
    const legal = engine.legalActions(input.ctx, before);
    const at = legal.findIndex((l) => sameAction(l.action, action));
    const label = at >= 0 ? legal[at].label : action.type;
    const subject = subjectOf(action);
    const inst = subject ? before.cards[subject] : undefined;
    const cardId = inst && !inst.cardId.startsWith("TOKEN:") ? inst.cardId : null;
    const pickedAt = pool.findIndex((d) => d.player === action.player && d.chosenLabel === label);
    const picked = pickedAt >= 0 ? pool.splice(pickedAt, 1)[0] : null;
    const told = engine.toBeats(input.ctx, after, events, 0);
    const narrator: Narrator = { viewer, them: input.names.p2, art: told.art, ownerOf: (id) => after.cards[id]?.owner ?? null };
    const story = told.list.map((b: NumberedBeat) => narrate(b, narrator)).filter((s): s is string => !!s);
    const refused = engine
      .rejectedActions(input.ctx, before, legal)
      .slice(0, 6)
      .map((r) => ({ label: r.label, why: r.why.slice(0, 2).map((w) => sentence(w, { name: r.label, reaching: r.action.type })) }));
    beats.push({
      index: i,
      n: i + 1,
      turn,
      player: action.player,
      who: input.names[action.player],
      kind: action.type,
      label,
      story,
      cardId,
      cardName: cardId ? (input.ctx.defs[cardId]?.name ?? null) : null,
      offered: legal.map((l) => l.label),
      chosenIndex: at >= 0 ? at : null,
      refused,
      decision: picked
        ? {
            decidedBy: picked.decidedBy === "claude" || picked.decidedBy === "fallback" ? picked.decidedBy : "rule",
            how: picked.how,
            model: picked.model,
            say: picked.say,
            inputTokens: picked.inputTokens,
            outputTokens: picked.outputTokens,
            latencyMs: picked.latencyMs,
          }
        : null,
    });
  }
  return { turns, turn, board, beats, drift };
}
