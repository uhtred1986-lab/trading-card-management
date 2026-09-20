/**
 * The state-interface seam: a side's named area, read off whichever shape
 * wrote the state, without either caller knowing which engine dealt it.
 *
 * `#152`/`#158` built this pattern in `scripts/verify/harness.ts` (`zoneOf`,
 * `leaderOf`, `unisonOf`, `energyMarkersOf`) so `battles.ts`/`workflow.ts`/
 * `keywords.ts` could run for real on both engines; `harness.ts` re-exports
 * these rather than keeping its own copy, so the test suites and the probe
 * (`#161`) and the opponent (`#162`) read the same seam. The two engines were
 * never going to store a board the same way —
 * `GameState.players[p][area]` against `VmState.sides[p].zones[area]`, a
 * scalar Leader/Unison against a single-entry zone — so this is the one
 * place that difference is bridged, rather than each caller reaching into
 * `players`/`sides` for itself.
 */
import type { CardDef } from "./engine";
import type { PlayerId } from "./engine/types";
import type { EngineState } from "./engines";
import { isVmState } from "./vm/state";

export type ZoneArea = "deck" | "hand" | "energy" | "battle" | "drop" | "warp" | "life" | "combo" | "zDeck" | "zEnergy" | "removed";

/** A side's named area — `state.players[p][area]` on the legacy engine, `state.sides[p].zones[area]` on the rules engine. */
export function zoneOf(s: EngineState, p: PlayerId, area: ZoneArea): string[] {
  return isVmState(s) ? (s.sides[p].zones[area] ??= []) : s.players[p][area];
}

/** The one card in the Leader Area — a scalar field on the legacy engine, a single-entry zone on the rules engine (8-1-1's own `zones.leader?.[0]` reading). */
export function leaderOf(s: EngineState, p: PlayerId): string {
  return isVmState(s) ? s.sides[p].zones.leader![0] : s.players[p].leader;
}

/** The Unison in play, or none — the same scalar/zone difference `leaderOf` bridges. */
export function unisonOf(s: EngineState, p: PlayerId): string | null {
  return isVmState(s) ? (s.sides[p].zones.unison?.[0] ?? null) : s.players[p].unison;
}

/** 1-14 energy markers — `state.sides[p].attrs.energyMarkers` (a declared `of: player` attribute) on the rules engine, `state.players[p].energyMarkers` on the legacy one. */
export function energyMarkersOf(s: EngineState, p: PlayerId): number {
  return isVmState(s) ? Number(s.sides[p].attrs.energyMarkers ?? 0) : s.players[p].energyMarkers;
}

/** A player's name, from whichever side it sits on (`state.sides[p].name` / `state.players[p].name`) — issue #162's own need, one seat name read by either engine. */
export function nameOf(s: EngineState, p: PlayerId): string {
  return isVmState(s) ? s.sides[p].name : s.players[p].name;
}

/** A card's catalog definition — the printed values (`energyCost`, `colors`, …), read off `ctx.defs` by the instance's `cardId`, the one field both engines' card records carry under the same name. Not for a token: those never sit in a hand or a deck, which is the only place this is used. */
export function catalogDefOf(ctx: { defs: Record<string, CardDef> }, s: EngineState, id: string): CardDef {
  return ctx.defs[s.cards[id].cardId];
}
