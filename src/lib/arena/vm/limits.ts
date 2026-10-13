/**
 * How many more times a skill line may be used this turn: 22-11's
 * [Once per turn] and 22-44's [Limit X], the two ceilings a printed line can
 * carry (#741).
 *
 * They are counted differently, as the manual counts them:
 *
 *   *22-11-3* "The 'once per turn' limitation is set individually for each
 *   skill. If there are multiple cards with the same 'once per turn' skill,
 *   they can each be activated once per turn." — counted on the copy
 *   (`VmCard.usedThisTurn`), as before #741.
 *
 *   *22-44-3* "A skill with [Limit X] can only be activated and resolved by its
 *   master X times during the same turn, across all copies of the same skill on
 *   cards with the same card number." — counted on the master
 *   (`VmSide.limitUses`), keyed by the card number and the line, so every copy
 *   shares one count and a copy that left play and came back is still held to
 *   it. 22-44-4: an [Auto] made pending several times resolves X times and the
 *   rest fail.
 *
 * Both counts end with the turn (`vm/flow.ts`'s `endTurn`).
 */
import type { PlayerId, Skill } from "../types";
import type { VmState } from "./state";

/**
 * 22-44-3 / 22-44-3-1: the identity of "the same skill on cards with the same
 * card number" — the catalog id (the card number; prints share it), the face
 * the line is printed on (a Leader's back is other text), and the line.
 */
export function limitKey(state: VmState, card: string, sk: Pick<Skill, "index">): string {
  const inst = state.cards[card];
  return `${inst?.cardId ?? card}${inst?.flipped ? "/back" : ""}#${sk.index}`;
}

/** How many times this master has used this [Limit X] line this turn, across every copy. */
export function limitUsed(state: VmState, master: PlayerId, card: string, sk: Pick<Skill, "index">): number {
  return state.sides[master]?.limitUses?.[limitKey(state, card, sk)] ?? 0;
}

/**
 * How many more times this line may be used this turn by this master, or null
 * for a line with no ceiling. [Once per turn] wins when a line prints both,
 * as the legacy `usesLeft` reads it.
 */
export function usesLeft(state: VmState, master: PlayerId, card: string, sk: Skill): number | null {
  if (sk.oncePerTurn) return (state.cards[card]?.usedThisTurn ?? []).includes(sk.index) ? 0 : 1;
  if (sk.limit == null) return null;
  return Math.max(0, sk.limit - limitUsed(state, master, card, sk));
}

/**
 * The line was activated (22-11-2, 22-44-3): spend one use. The copy keeps its
 * own record either way — what the board shows as used on it — and a [Limit X]
 * line is also counted on its master, across copies.
 */
export function spendUse(state: VmState, master: PlayerId, card: string, sk: Skill): void {
  if (!sk.oncePerTurn && sk.limit == null) return;
  state.cards[card]?.usedThisTurn.push(sk.index);
  if (sk.oncePerTurn) return;
  const side = state.sides[master];
  if (!side) return;
  const key = limitKey(state, card, sk);
  (side.limitUses ??= {})[key] = (side.limitUses[key] ?? 0) + 1;
}

/**
 * The uses the board shows on one card (`AbilityView.used`): the copy's own
 * [Once per turn] record, and for a [Limit X] line the shared count of its
 * master — public, since every activation is announced (9-6-2).
 */
export function usedForView(state: VmState, master: PlayerId, card: string, skills: Skill[]): number[] {
  const limited = new Set(skills.filter((sk) => !sk.oncePerTurn && sk.limit != null).map((sk) => sk.index));
  const out = (state.cards[card]?.usedThisTurn ?? []).filter((index) => !limited.has(index));
  for (const sk of skills) {
    if (!limited.has(sk.index)) continue;
    for (let n = limitUsed(state, master, card, sk); n > 0; n--) out.push(sk.index);
  }
  return out;
}
