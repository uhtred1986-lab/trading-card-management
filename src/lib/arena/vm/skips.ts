/**
 * 20-13: a phase or a step that is not performed.
 *
 * Two readings of one rule, the legacy engine's own pair (`engine/state.ts`'s
 * `takeSkip`/`stepSkippedByPermanent`, #278), ported rather than re-derived:
 *
 *   - a **skip entry**, written once by a skill's `skip` op (`vm/host.ts`'s
 *     `addSkip`) and spent by the occurrence it names — one entry, one
 *     occurrence, so two skills skip two;
 *   - a **standing** skip, a [Permanent] whose own condition holds right now
 *     ("when this card is in a battle, you skip your Offense Step"), read live
 *     at the step and never spent (`vm/effects.ts`'s `skip` static).
 *
 * Where each is asked is the flow's business: a phase by its declared `skip:`
 * word (`vm/flow.ts`'s `enterPhase`), a whole turn as its first phase is
 * entered, and the battle's two steps by `vm/battle.ts`'s native step work.
 *
 * Pure and client-safe: no database, no network, no `fs`.
 */
import type { EngineContext } from "../engine";
import type { PlayerId, SkipWhat } from "../engine/types";
import type { GameDefinition } from "../rulesets";
import { staticsNow } from "./program";
import type { VmState } from "./state";

/** Add one entry (20-13). The list is made on demand, so a game saved without it still works. */
export function addSkip(state: VmState, p: PlayerId, what: SkipWhat, when: "this" | "next"): void {
  (state.sides[p].skips ??= []).push({ what, when, turn: state.turn });
}

/**
 * Is this phase or step of `p`'s not to be performed — and if so, spend the
 * entry that says so. "This" is the occurrence in the turn the entry was made
 * on; "next" is the first one in a later turn.
 */
export function takeSkip(state: VmState, p: PlayerId, what: SkipWhat): boolean {
  const list = state.sides[p].skips;
  if (!list?.length) return false;
  const i = list.findIndex((e) => e.what === what && (e.when === "this" ? e.turn === state.turn : state.turn > e.turn));
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

/** An unspent "this" entry is over when its turn is: called as the turn passes, beside `expireDelayed`. */
export function expireSkips(state: VmState): void {
  for (const side of Object.values(state.sides)) {
    if (side.skips?.length) side.skips = side.skips.filter((e) => !(e.when === "this" && e.turn < state.turn));
  }
}

/** The [Permanent] half (#278): is this step of `p`'s standingly skipped by a rule in force right now? */
export function stepSkippedByPermanent(ctx: EngineContext, game: GameDefinition, state: VmState, p: PlayerId, what: SkipWhat): boolean {
  return staticsNow(ctx, game, state).some((e) => {
    if (e.kind !== "skip") return false;
    const v = e.value as { what: SkipWhat; player: PlayerId };
    return v.what === what && v.player === p;
  });
}
