/** Presentation preferences shared by the app and the board. Legacy keys remain valid. */
export const ARENA_SKINS = ["anime", "namek", "korin", "night", "instinct"] as const;
export type ArenaSkin = (typeof ARENA_SKINS)[number];
export const SKIN_COOKIE = "arenaSkin";
export const DEFAULT_SKIN: ArenaSkin = "anime";
export const SKIN_LABELS: Record<ArenaSkin, string> = { anime: "Anime Sky", namek: "Namek", korin: "Korin’s Tower", night: "Tournament of Power", instinct: "Ultra Instinct" };
export function skinFrom(value: string | undefined | null): ArenaSkin {
  return ARENA_SKINS.includes(value as ArenaSkin) ? value as ArenaSkin : DEFAULT_SKIN;
}
