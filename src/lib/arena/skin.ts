/**
 * Which skin paints the board (`docs/arena-skin-spec.md`).
 *
 * `anime`, the daylight sky, is the default (owner's decision, 6 Sep 2026);
 * `night` is the deep-space table the board was designed on and stays
 * maintained. A skin is one attribute on the board's root and one block of
 * CSS — nothing in the game, the engine or the contract knows it exists.
 */
export const ARENA_SKINS = ["night", "anime"] as const;
export type ArenaSkin = (typeof ARENA_SKINS)[number];

export const SKIN_COOKIE = "arenaSkin";

export const DEFAULT_SKIN: ArenaSkin = "anime";

/** A cookie or query value, or anything else, read as a skin. */
export function skinFrom(value: string | undefined | null): ArenaSkin {
  return value === "night" ? "night" : value === "anime" ? "anime" : DEFAULT_SKIN;
}
