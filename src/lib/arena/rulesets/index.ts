/**
 * The rulesets: a game written as declarations rather than as code.
 *
 * `src/lib/arena/lang/` says how a declaration is *spelled*; this says what a
 * whole game's worth of them *is* — `loadRuleset` resolves the names between
 * them, `vocabularyOf` hands back the closed word lists the language is
 * checked against (#137 makes those constants a re-export of this), and
 * `expandMacros` lowers a program written in the ops the cards use to one
 * written in the primitives the interpreter knows.
 *
 * Client-safe, like `lang/`: no `fs`, no database, nothing read at request
 * time. `docs/arena-ruleset-spec.md` §3 says what each file declares.
 */
export { loadRuleset, vocabularyOf } from "./load";
export { expandMacros, opsIn, MacroError } from "./expand";
export { HOOK_POINTS, isHookPoint, type HookPoint } from "./hooks";
export { DBS_FILES, loadDbs } from "./dbs";
export type { ActionDef, AttributeDef, CostDef, Def, GameDef, GameDefinition, KeywordDef, Loaded, OpDef, PhaseDef, RulesetError, StepDef, TriggerDef, Vocabulary, WinDef, ZoneDef } from "./types";

import { loadDbs } from "./dbs";
import type { Loaded } from "./types";
import type { Game } from "../../catalog/games";

/**
 * A game's ruleset by id. Only `dbs` has files; Fusion World is the plan's
 * natural second and needs no code here when it arrives — a directory, a
 * regenerated `files.ts` and a row below.
 */
export function rulesetFor(game: Game): Loaded {
  if (game === "dbs") return loadDbs();
  return { ok: false, errors: [{ file: `${game}/`, line: 1, col: 1, clause: "DEFINE", message: `there is no ruleset for ${game} yet`, expected: ["dbs"], lineText: "" }] };
}
