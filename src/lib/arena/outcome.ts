import type { PlayerId } from "./types";

/** Kept stable so archived states and existing engine-stuck decision rows remain readable. */
export const NOT_YET_REASON_PREFIX = "this engine cannot finish this game";

export type OutcomeKind = "win" | "draw" | "concession" | "abandoned" | "interrupted";

/** Safe to send to either player. Interruption details stay only in VmState. */
export interface PublicOutcome {
  kind: OutcomeKind;
  winner: PlayerId | null;
  reason: string;
  concededBy?: PlayerId;
}

export interface StoredOutcome extends PublicOutcome {
  /** Private referee/debug context. Never project this property to a client. */
  privateContext?: {
    sourceCard?: string;
    skillIndex?: number;
    trigger?: string;
    issue?: string;
    detail?: string;
  };
}

export interface OutcomeState {
  winner?: PlayerId | null;
  overReason?: string | null;
  outcome?: StoredOutcome | null;
}

export function interruptedOutcome(context?: StoredOutcome["privateContext"]): StoredOutcome {
  return {
    kind: "interrupted",
    winner: null,
    reason: "This game was interrupted before a result was reached.",
    ...(context ? { privateContext: context } : {}),
  };
}

/** Resolve current typed outcomes and old snapshots. Status wins over stale winner fields. */
export function resolveOutcome(state: OutcomeState, status?: string): PublicOutcome | null {
  if (status === "abandoned") {
    return { kind: "abandoned", winner: null, reason: "This game was abandoned." };
  }
  if (state.outcome) {
    const publicOutcome = { ...state.outcome };
    delete publicOutcome.privateContext;
    return publicOutcome;
  }
  const reason = state.overReason ?? "";
  if (reason.startsWith(NOT_YET_REASON_PREFIX)) return interruptedOutcome();
  if (!reason && state.winner == null) return null;
  // Old rows recorded concessions as "<name> conceded". Keep this as a
  // compatibility fallback; new states store concededBy explicitly.
  if (reason.endsWith(" conceded")) return { kind: "concession", winner: state.winner ?? null, reason };
  return state.winner == null
    ? { kind: "draw", winner: null, reason }
    : { kind: "win", winner: state.winner, reason };
}
