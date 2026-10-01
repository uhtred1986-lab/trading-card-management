/**
 * Claude's table talk, kept from naming what its opponent cannot see (#463).
 *
 * The prompt already tells Claude to keep its hand, life and deck to itself
 * (`opponent.ts`, `MoveSchema.say`); this is the check behind the instruction,
 * because a model asked for "one short sentence, in character" will sooner or
 * later announce the card it is holding back. A line that names one of the
 * speaker's hidden cards is dropped whole — rewording it would put words in
 * Claude's mouth.
 *
 * A name is only a secret while no copy of it is public: a card with the same
 * name on the board, in an Energy Area or in a Drop is something the table
 * can already see, and talking about it gives nothing away.
 *
 * Pure: read off the state alone, on either engine (`revealedTo`), so it is
 * covered by `npm test` without a model.
 */
import type { EngineContext, PlayerId } from "../types";
import type { EngineState } from "../engines";
import { revealedTo } from "../view";

const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

/** Names too short to match safely inside an ordinary sentence. */
const MIN_NAME = 4;

/** The names of `speaker`'s cards the other player cannot see, less any name that is public anyway. */
export function secretNames(ctx: EngineContext, s: EngineState, speaker: PlayerId): string[] {
  const seen = revealedTo(s, other(speaker));
  const nameOf = (id: string) => ctx.defs[s.cards[id]?.cardId ?? ""]?.name ?? null;
  const open = new Set<string>();
  const hidden = new Set<string>();
  for (const id of Object.keys(s.cards)) {
    const name = nameOf(id);
    if (!name) continue;
    if (seen.has(id)) open.add(name.toLowerCase());
    else if (s.cards[id].owner === speaker) hidden.add(name.toLowerCase());
  }
  return [...hidden].filter((x) => !open.has(x) && x.length >= MIN_NAME);
}

/** The line as said, or null when it names one of `speaker`'s hidden cards. */
export function tableTalk(ctx: EngineContext, s: EngineState, speaker: PlayerId, said: string | null | undefined): string | null {
  const line = said?.trim();
  if (!line) return null;
  const lower = line.toLowerCase();
  return secretNames(ctx, s, speaker).some((x) => lower.includes(x)) ? null : line;
}
