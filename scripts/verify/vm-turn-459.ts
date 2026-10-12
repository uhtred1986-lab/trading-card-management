import type { Action, GameEvent, PlayerId } from "../../src/lib/arena/types";
import { SEED_7_OPENING } from "./vm-opening-459";

/**
 * A complete trace for the two seed-7, no-battle games in vm.ts §§11 and 16.
 * This is the compact written-out procedure of the manual's setup (6-2-1),
 * turn (7-2 through 7-5), and deck-out (0-1-3-2), using fixed card instances
 * from vm-opening-459.ts. It expands to 145 actions and 544/615 events.
 *
 * The public event contract contributes the exact move/draw/action/phase
 * fields. `gameOver.reason` is normalized because one engine phrases the
 * manual's same loss in different words. Nothing here calls either engine.
 */
export function expectedTurnTrace(charge: boolean): { actions: Action[]; events: GameEvent[]; p1Energy: string[] } {
  const actions: Action[] = [];
  const events: GameEvent[] = [{ type: "gameStart", first: "p1", seed: 7 }];
  const hands = { p1: [...SEED_7_OPENING.p1.hand, ...SEED_7_OPENING.p1.deck], p2: [...SEED_7_OPENING.p2.hand, ...SEED_7_OPENING.p2.deck] };
  const decks = { p1: SEED_7_OPENING.p1.deck, p2: SEED_7_OPENING.p2.deck };
  const charged = { p1: 0, p2: 0 };

  const action = (a: Action): void => { actions.push(a); events.push({ type: "action", action: a }); };
  const draw = (player: PlayerId, card: string): void => {
    events.push({ type: "move", card, from: "deck", to: "hand", owner: player });
    events.push({ type: "draw", player, card });
  };

  action({ type: "chooseFirst", player: "p1", first: "p1" });
  for (const player of ["p1", "p2"] as const) for (const card of SEED_7_OPENING[player].hand) draw(player, card);
  action({ type: "mulligan", player: "p1", redraw: false });
  action({ type: "mulligan", player: "p2", redraw: false });
  // Life is placed on top from the deck; the last card moved becomes its top.
  for (const player of ["p1", "p2"] as const) for (const card of [...SEED_7_OPENING[player].life].reverse()) {
    events.push({ type: "move", card, from: "deck", to: "life", owner: player });
  }
  events.push({ type: "energyMarker", player: "p2", delta: 1 });

  for (let turn = 1; turn <= 72; turn++) {
    const player: PlayerId = turn % 2 ? "p1" : "p2";
    events.push({ type: "phase", phase: "charge", player, turn });
    if (turn > 1) draw(player, decks[player][Math.floor((turn - 2) / 2)]);
    if (turn === 72) {
      events.push({ type: "gameOver", winner: "p1", reason: "…" });
      break;
    }
    const card = charge ? hands[player][charged[player]++] : null;
    action({ type: "charge", player, card });
    if (card) events.push({ type: "move", card, from: "hand", to: "energy", owner: player, reveal: true });
    events.push({ type: "phase", phase: "main", player, turn });
    action({ type: "endMain", player });
    events.push({ type: "phase", phase: "end", player, turn });
  }
  return { actions, events, p1Energy: charge ? hands.p1.slice(0, charged.p1) : [] };
}
