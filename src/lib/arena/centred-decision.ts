import type { Action, Prompt } from "@/lib/arena/types";
import { isGhostAction } from "@/lib/arena/action-tone";

/**
 * Which engine prompts the board shows in the middle of the screen (owner, 19 Oct 2026: "active
 * decisions need to be visible in the middle of the screen"). The rule: whenever the game is
 * WAITING on the human for an answer it asked for, it is centred. The free Main phase is the one
 * exception, because the player chooses what to do at leisure and needs the whole board.
 *
 * Keyed on every `Prompt["kind"]`, so a new prompt kind is a type error here until it is decided.
 */
export const CENTRING: Record<Prompt["kind"], { centred: boolean; why: string }> = {
  chooseFirst: { centred: true, why: "who goes first: the game waits for the answer" },
  mulligan: { centred: true, why: "keep or redraw: the game waits for the answer" },
  charge: { centred: true, why: "which hand card to charge (or pass), listed as thumbnails" },
  main: { centred: false, why: "the free Main-phase menu: the board must stay usable" },
  combo: { centred: true, why: "which combo card to add, with the power result" },
  blocker: { centred: true, why: "block with a [Blocker] or let it through, with the clash summary" },
  counter: { centred: true, why: "play a Counter or let it through, with the clash summary" },
  orderPending: { centred: true, why: "the order simultaneous skills resolve in" },
  chooseCards: { centred: true, why: "choose up to N cards, listed as thumbnails" },
  chooseMode: { centred: true, why: "choose one of the printed options" },
  replaceMove: { centred: true, why: "which replacement applies, if any" },
  zEnergyFromCombo: { centred: true, why: "a yes/no style question about a combo's Z-Energy" },
  optionalCost: { centred: true, why: "a yes/no 'may pay' question" },
  payCost: { centred: true, why: "which energy pays (centred since #1062)" },
  offering: { centred: true, why: "a yes/no question about dropping a life card" },
  empowerCarry: { centred: true, why: "how many markers to carry over" },
  referee: { centred: false, why: "answered by the referee, never by a player's tap" },
  gameOver: { centred: false, why: "nothing is waiting" },
};

export interface CentreContext {
  /** The prompt's player is the viewer. */
  yours: boolean;
  /** A beat walk is playing: the decision has not been reached yet. */
  playing: boolean;
  over: boolean;
  /** A hidden-zone search sheet already shows this question as a modal list. */
  searchSheet: boolean;
  /** The viewer can actually act (not waiting on the server, not a spectator). */
  playable: boolean;
}

/** True when this prompt is drawn in the middle of the screen. Unknown kinds stay where they were. */
export function isCentredDecision(kind: string, ctx: CentreContext): boolean {
  const rule = (CENTRING as Record<string, { centred: boolean } | undefined>)[kind];
  if (!rule?.centred) return false;
  if (!ctx.yours || ctx.playing || ctx.over || !ctx.playable) return false;
  if (kind === "chooseCards" && ctx.searchSheet) return false;
  return true;
}

/**
 * The answer Escape gives: the legal "pass / don't / none" option, and only when the engine offers
 * one. A decision with no such option (a mode pick) is not escapable; Escape then only folds the
 * prompt away to look at the board.
 */
export function escapeAnswer(actions: readonly Action[]): Action | null {
  return actions.find((a) => isGhostAction(a) && a.type !== "endMain") ?? null;
}
