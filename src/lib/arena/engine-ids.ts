/**
 * Engine ids, their descriptions and the default/fallback choice (#641) —
 * the part of `engines.ts` that names engines without loading either one.
 * `engines.ts` re-exports every name here and keeps the switch (`engineFor`),
 * which is what imports the legacy engine; code that must stay outside that
 * graph (`snapshot-core.ts`, the browser-safe `browser.ts`) imports this.
 */
export const ENGINE_IDS = ["legacy", "rules"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

/**
 * The engine a new game is made on when nothing says otherwise (#166,
 * 20 Sep 2026).
 *
 * `rules` since the flip: the configuration-driven engine is what a new game
 * gets unless the form, the API body or the `arena.engine` setting names the
 * other one. The setting stays exactly as it was — Settings → Arena engine
 * puts a new game back on `legacy` without a deploy — and no saved game moves,
 * because a game keeps the engine it was made on.
 *
 * A mode the rules engine is not built for does **not** make this a refusal:
 * `games.ts`'s `engineForMode` resolves the default down to `FALLBACK_ENGINE`
 * for that mode and says why. Since #458 there is no such mode — a 1 v 1, the
 * last, is played on the rules engine too.
 */
export const DEFAULT_ENGINE: EngineId = "rules";

/**
 * The engine a mode falls back to when the preferred one is not built for it.
 *
 * `legacy` plays every mode — that is the whole of why it is the fallback, and
 * why `games.ts`'s `modeRefusal` never has to ask about it.
 */
export const FALLBACK_ENGINE: EngineId = "legacy";

export interface EngineInfo {
  id: EngineId;
  /** Two or three words, for the form and the badge. */
  label: string;
  /** One sentence under the label. */
  note: string;
  /** False while the engine cannot play a game yet; the form shows it greyed. */
  available: boolean;
}

export const ENGINE_INFO: Record<EngineId, EngineInfo> = {
  legacy: {
    id: "legacy",
    label: "Legacy engine",
    note: "The engine the arena played on until 20 Sep 2026, and still the oracle every rules-engine game is measured against. Rules are code; card text is read by the compiler and the rules workbench. It plays every mode.",
    available: true,
  },
  rules: {
    id: "rules",
    label: "Rules engine",
    // The default since #166 (20 Sep 2026). What it still cannot do is
    // `NotYet`, and a game that reaches one ends rather than continuing on the
    // legacy engine (`vm/flow.ts`'s `stepProgram`, #149) — the note says so up
    // front rather than a player learning it mid-game. A 1 v 1 is made on it
    // too since #458, which read its hidden-hand masking off its own state.
    note: "The default: the game and every card written in one rules language. A game that reaches something not yet built ends there — no continuing on the legacy engine.",
    available: true,
  },
};

export function isEngineId(v: unknown): v is EngineId {
  return typeof v === "string" && (ENGINE_IDS as readonly string[]).includes(v);
}

/**
 * An engine id from anywhere (a column, a form field), never undefined.
 *
 * The fallback is `FALLBACK_ENGINE` rather than `DEFAULT_ENGINE` and the two
 * stopped being the same thing at #166: a value that cannot be read is a
 * *stored* one — a row from before the column, a hand-edited row — and every
 * such state is legacy-shaped. Reading one with the new default's eyes would
 * hand a `GameState` to the rules engine. What a *new* game gets when nobody
 * chose is a different question, asked by `defaultEngine`/`engineForMode` at
 * the creation paths, which pass their own fallback here.
 */
export function engineOr(v: unknown, fallback: EngineId = FALLBACK_ENGINE): EngineId {
  return isEngineId(v) ? v : fallback;
}

/** The engines a new game may be created on right now. */
export const AVAILABLE_ENGINES: EngineId[] = ENGINE_IDS.filter((id) => ENGINE_INFO[id].available);

