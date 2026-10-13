/**
 * The state-interface seam: a side's named area, read off the state without
 * the caller reaching into `sides[p].zones` for itself.
 *
 * `scripts/verify/harness.ts` re-exports these, so the test suites, the probe
 * (`#161`) and the opponent (`#162`) read the same seam. Before #118 it also
 * bridged the legacy `GameState.players[p][area]` layout; the rules engine's
 * `VmState.sides[p].zones[area]` is the only one left.
 */
import type { CardDef } from "./types";
import type { PlayerId } from "./types";
import type { EngineState } from "./engines";

export type ZoneArea = "deck" | "hand" | "energy" | "battle" | "drop" | "warp" | "life" | "combo" | "zDeck" | "zEnergy" | "removed";

/** A side's named area — `state.sides[p].zones[area]`. */
export function zoneOf(s: EngineState, p: PlayerId, area: ZoneArea): string[] {
  return (s.sides[p].zones[area] ??= []);
}

/** The one card in the Leader Area — a single-entry zone (8-1-1's own `zones.leader?.[0]` reading). */
export function leaderOf(s: EngineState, p: PlayerId): string {
  return s.sides[p].zones.leader![0];
}

/** The Unison in play, or none. */
export function unisonOf(s: EngineState, p: PlayerId): string | null {
  return s.sides[p].zones.unison?.[0] ?? null;
}

/** 1-14 energy markers — `state.sides[p].attrs.energyMarkers`, a declared `of: player` attribute. */
export function energyMarkersOf(s: EngineState, p: PlayerId): number {
  return Number(s.sides[p].attrs.energyMarkers ?? 0);
}

/** A player's name (`state.sides[p].name`). */
export function nameOf(s: EngineState, p: PlayerId): string {
  return s.sides[p].name;
}

/** A card's catalog definition — the printed values (`energyCost`, `colors`, …), read off `ctx.defs` by the instance's `cardId`. Not for a token: those never sit in a hand or a deck, which is the only place this is used. */
export function catalogDefOf(ctx: { defs: Record<string, CardDef> }, s: EngineState, id: string): CardDef {
  return ctx.defs[s.cards[id].cardId];
}
