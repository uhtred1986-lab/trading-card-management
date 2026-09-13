/**
 * What a client animates, from the events a rules game logs.
 *
 * `beats.ts` is the legacy engine's translation of the same thing, and it is a
 * translation rather than a passthrough: several events have no picture and
 * collapse to nothing. This is that translation for the events *this* engine
 * emits — a phase beginning, a card moving, a draw, a mode change, an energy
 * marker, the game ending — and it deliberately covers no more than the engine
 * can produce. A beat for a battle or a skill would be a shape nothing here
 * can reach, and an empty case is how a reader tells the two apart.
 *
 * The one thing it must do exactly as `beats.ts` does is `art`: a beat carries
 * the face of the card it names **as it was at event time**, because a card
 * that has left the board cannot be looked up afterwards. Names are read
 * through the declared attributes (`./cards.ts`), so the catalog is reached
 * through the one adapter here too.
 *
 * Pure: no database, no images. `session.ts` fills in the image URLs, which is
 * what keeps this testable in `npm test`.
 */
import type { EngineContext, GameEvent } from "../engine";
import type { Beat, BeatArt, Beats, NumberedBeat } from "../beats";
import { rulesetFor } from "../rulesets";
import { attrsOf } from "./cards";
import type { VmState } from "./state";

/**
 * One batch of events, numbered from `after`.
 *
 * `after` is the seq the queue is already at, so beats keep climbing across
 * the several `apply()` calls one turn takes.
 */
export function vmToBeats(ctx: EngineContext, state: VmState, events: GameEvent[], after = 0): Beats {
  const list: NumberedBeat[] = [];
  const art: Record<string, BeatArt> = {};
  let n = after;
  const push = (b: Beat) => list.push({ ...b, n: ++n } as NumberedBeat);

  const loaded = rulesetFor(state.game);
  const game = loaded.ok ? loaded.definition : null;

  /** Remember a card as it is *now*, before it leaves the board for good. */
  const remember = (id: string) => {
    if (art[id]) return;
    const inst = state.cards[id];
    if (!inst) return;
    const def = ctx.defs[inst.cardId];
    const named = def && game ? attrsOf(def, game).attrs.name : undefined;
    art[id] = { cardId: inst.cardId, name: typeof named === "string" ? named : inst.cardId, imageUrl: null };
  };

  for (const e of events) {
    switch (e.type) {
      case "phase":
        push({ t: "phase", phase: e.phase, player: e.player, turn: e.turn });
        break;
      case "draw":
        remember(e.card);
        push({ t: "draw", player: e.player, card: e.card });
        break;
      case "move":
        remember(e.card);
        push({ t: "move", card: e.card, from: e.from, to: e.to, owner: e.owner });
        break;
      case "mode":
        push({ t: "mode", card: e.card, mode: e.mode });
        break;
      case "gameOver":
        push({ t: "over", winner: e.winner, reason: e.reason });
        break;
      // The events with no picture. `gameStart`, `action` and `energyMarker`
      // are the board's own state and are read off the view rather than
      // animated; a `note` is a line in the log. `beats.ts` drops the same
      // three for the same reason.
      case "gameStart":
      case "action":
      case "energyMarker":
      case "note":
        break;
      // Everything else is a shape this engine cannot produce yet — a battle,
      // a skill, an effect coming into force. Left to the issue that builds
      // the mechanism rather than answered with a beat drawn from nothing.
      default:
        break;
    }
  }
  return { seq: n, list, art };
}
