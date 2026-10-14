/**
 * #759 (21-9): a Unison Card in a Unison Area with zero or fewer markers is
 * placed in its owner's Drop Area. 21-9-1 makes it **interruptive** rule
 * processing (21-1-2-1): resolved the moment a marker leaves, even while
 * another action is being carried out — so, like 21-11's [Unique] choice
 * (`vm/unique.ts`), it runs before the runner's next look and after every
 * instruction of a running program, and never waits for a checkpoint.
 * Simultaneous ones are all processed together (21-1-2-1-1), seat order.
 *
 * This module only finds them; the caller moves each with its own mover
 * (`vm/flow.ts`'s `moved`, `vm/host.ts`'s `moveTo`), so a 9-10 replacement
 * and the "placed in your Drop Area from your Unison Area" Autos answer the
 * move exactly as for any other.
 */
import type { PlayerId } from "../types";
import type { VmState } from "./state";

const UNISON = "unison";

/** Every Unison Card with zero or fewer markers, as `[card, owner]`. Empty on a board with none (the common case). */
export function emptyUnisons(state: VmState): [string, PlayerId][] {
  if (state.game !== "dbs") return [];
  const found: [string, PlayerId][] = [];
  for (const side of Object.keys(state.sides) as PlayerId[]) {
    for (const id of state.sides[side]?.zones[UNISON] ?? []) {
      const card = state.cards[id];
      if (card && !card.hidden && (card.markers ?? 0) <= 0) found.push([id, card.owner]);
    }
  }
  return found;
}
