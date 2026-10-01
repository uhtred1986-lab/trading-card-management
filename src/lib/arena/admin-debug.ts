/**
 * What the admin drawer shows that a player's snapshot does not carry (issue
 * #350). Built on the server, and only for an admin: the opponent's hidden hand
 * must never be in the payload of a player's page, so it is not in `Snapshot`.
 *
 * Pure — the game page fetches the decision rows and hands them in.
 */
import { engineFor, type EngineId, type EngineState } from "./engines";
import type { EngineContext, PlayerId } from "./types";
import type { CardArt } from "./view";
import type { FlagLine } from "./review-store";

/** One decision the server took, as the drawer lists it (a slice of `arena_decisions`). */
export interface DecisionLine {
  seq: number;
  turn: number;
  player: string;
  promptKind: string;
  decidedBy: "rule" | "claude" | "fallback";
  chosenLabel: string | null;
  how: string;
  say: string | null;
  /** What was legal: the numbered menu Claude was given. */
  menu: string[] | null;
  chosenIndex: number | null;
}

export interface AdminDebug {
  seed: number | null;
  /** The opponent's hand by name: hidden information, labelled so in the drawer. */
  theirHand: string[] | null;
  decisions: DecisionLine[];
  /** The turns of this game an admin has flagged (#351). */
  flags: FlagLine[];
}

type DecisionRowLike = {
  seq: number;
  turn: number;
  player: string;
  promptKind: string;
  decidedBy: string;
  chosenLabel: string | null;
  how: string;
  say: string | null;
  menu: unknown;
  chosenIndex: number | null;
};

export function decisionLines(rows: DecisionRowLike[]): DecisionLine[] {
  return rows.map((r) => ({
    seq: r.seq,
    turn: r.turn,
    player: r.player,
    promptKind: r.promptKind,
    decidedBy: r.decidedBy === "claude" || r.decidedBy === "fallback" ? r.decidedBy : "rule",
    chosenLabel: r.chosenLabel,
    how: r.how,
    say: r.say,
    menu: Array.isArray(r.menu) ? (r.menu as unknown[]).map(String) : null,
    chosenIndex: r.chosenIndex,
  }));
}

export function adminDebugOf(input: { engine: EngineId; ctx: EngineContext; state: EngineState; viewer: PlayerId; images: Record<string, CardArt>; decisions: DecisionRowLike[]; flags?: FlagLine[] }): AdminDebug {
  const other: PlayerId = input.viewer === "p1" ? "p2" : "p1";
  // The opponent's own board view: the one place their hand is face-up.
  const theirs = engineFor(input.engine).boardView(input.ctx, input.state, other, input.images);
  return {
    seed: typeof (input.state as { seed?: unknown }).seed === "number" ? (input.state as { seed: number }).seed : null,
    theirHand: theirs.you.hand ? theirs.you.hand.map((c) => c.name) : null,
    decisions: decisionLines(input.decisions),
    flags: input.flags ?? [],
  };
}
