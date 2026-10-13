/**
 * Engine ids and the description of the one engine (#641, #118).
 *
 * There is one engine: the rules engine (`./vm/`, `docs/arena-ruleset-spec.md`).
 * The hand-written legacy engine was deleted by #118 (owner, 13 Oct 2026) and
 * with it the choice between engines. The id stays a type, and
 * `arena_games.engine` stays a column that every new row writes as `rules`,
 * because a second game is a second *definition* on the same interface
 * (`engines.ts`'s `Engine`), and because dropping the column would be a
 * destructive migration for no gain. Nothing reads the column any more: a
 * saved game is recognised by the shape of its state (`isVmState`).
 */
export const ENGINE_IDS = ["rules"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

/** The engine every game is made on. */
export const DEFAULT_ENGINE: EngineId = "rules";

export interface EngineInfo {
  id: EngineId;
  /** Two or three words, for the badge. */
  label: string;
  /** One sentence under the label. */
  note: string;
}

export const ENGINE_INFO: Record<EngineId, EngineInfo> = {
  rules: {
    id: "rules",
    label: "Rules engine",
    // A game that reaches something not yet built ends there (`vm/flow.ts`'s
    // `stepProgram`, #149); the note says so up front rather than a player
    // learning it mid-game.
    note: "The game and every card written in one rules language. A game that reaches something not yet built ends there.",
  },
};
