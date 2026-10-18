import type { BoardView } from "@/lib/arena/view";

/** The longest a name is let to run in a turn pill or banner before it is cut with an ellipsis. */
export const SHORT_NAME_MAX = 18;

/**
 * Who the computer opponent is called on the board. The engine names a seat
 * after its deck ("Yellow Jiren Rest-Lock Beatdown (Claude draft)"), which is
 * a label for a list, not a name to put in "…'S TURN". Against the computer the
 * leader's character is the short name ("Jiren, Full Power" -> "Jiren"), or
 * "Opponent" when there is no leader to take it from. A human opponent
 * (1 v 1, hot-seat) keeps whatever they are called.
 */
export function shortOpponentName(leaderName: string | null | undefined): string {
  const first = (leaderName ?? "").split(/[,(:]| [-–—] /)[0]?.trim() ?? "";
  if (!first) return "Opponent";
  return first.length > SHORT_NAME_MAX ? `${first.slice(0, SHORT_NAME_MAX - 1).trimEnd()}…` : first;
}

/** The board's view with the computer's seat renamed; the deck name moves to `deckName` for tooltips and subtitles. */
export function withShortOpponent(view: BoardView, mode: string): BoardView {
  if (mode === "versus" || mode === "hotseat") return view;
  return { ...view, them: { ...view.them, deckName: view.them.name, name: shortOpponentName(view.them.leader?.name) } };
}
