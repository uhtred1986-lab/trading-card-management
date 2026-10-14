import type { CardArt } from "@/lib/arena/view";
import type { CardDef, DeckInput, PlayerId } from "@/lib/arena/types";

/** A deck's original catalog contents, with copies grouped and no match instance ids. */
export interface ArenaDecklist {
  name: string;
  cards: { cardId: string; name: string; count: number; imageUrl: string | null }[];
}

/** Project saved deck inputs into display metadata; this never reads the current game state. */
export function arenaDecklistsFromInputs(
  inputs: Partial<Record<PlayerId, DeckInput>> | null | undefined,
  defs: Readonly<Record<string, Pick<CardDef, "name"> | undefined>>,
  art: Readonly<Record<string, Pick<CardArt, "front"> | undefined>>,
  seats: readonly PlayerId[] = ["p1", "p2"],
): Partial<Record<PlayerId, ArenaDecklist>> {
  const result: Partial<Record<PlayerId, ArenaDecklist>> = {};
  for (const seat of seats) {
    const input = inputs?.[seat];
    if (!input) continue;

    const counts = new Map<string, number>();
    for (const cardId of [input.leader, ...input.main, ...(input.z ?? [])]) {
      counts.set(cardId, (counts.get(cardId) ?? 0) + 1);
    }
    const cards = [...counts.entries()]
      .map(([cardId, count]) => ({
        cardId,
        name: defs[cardId]?.name ?? cardId,
        count,
        imageUrl: art[cardId]?.front ?? null,
      }))
      // A stable display order avoids exposing the original draw/deck order.
      .sort((a, b) => a.name.localeCompare(b.name) || a.cardId.localeCompare(b.cardId));

    result[seat] = { name: input.name, cards };
  }
  return result;
}
