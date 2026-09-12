/**
 * What a game's definition *is*, once the declarations have been read.
 *
 * `parseDefinitions` (`lang/parse.ts`) turns a `.rules` file into a list of
 * `Definition` nodes — text made into a tree, with no name checked against any
 * other. This module names the next thing along: the whole ruleset, with every
 * declaration filed under its kind, its defaults applied, and every
 * cross-reference resolved (a phase names its steps, an action names its
 * costs, a trigger names a zone, a keyword names a hook point). `load.ts`
 * builds one; Stage 4's `vm/` interprets one.
 *
 * Client-safe: types and one word list, no `fs`, no database. The `.rules`
 * files reach the loader as strings (`dbs/files.ts`), so nothing here reads a
 * file at request time.
 */
import type { Game } from "../../catalog/games";
import type { Definition, LangError } from "../lang";

/** The node of one kind, as the grammar defines it. A `Def` is the AST node with the schema's defaults filled in — the loader applies them, because the printer drops none (#131). */
export type Def<K extends Definition["define"]> = Extract<Definition, { define: K }>;

export type GameDef = Def<"GAME">;
export type AttributeDef = Def<"ATTRIBUTE">;
export type ZoneDef = Def<"ZONE">;
export type PhaseDef = Def<"PHASE">;
export type StepDef = Def<"STEP">;
export type ActionDef = Def<"ACTION">;
export type TriggerDef = Def<"TRIGGER">;
export type KeywordDef = Def<"KEYWORD">;
export type CostDef = Def<"COST">;
export type WinDef = Def<"WIN">;
export type OpDef = Def<"OP">;

/**
 * One game, as its files declare it.
 *
 * Every record is keyed by the declared name, which is unique per kind — that
 * is the loader's first check. `game` is `null` only while a ruleset has no
 * `DEFINE GAME` yet: the DBS files are #133–#135, and a loader that refused an
 * empty set could not be tested before its content existed.
 *
 * `definitions` is every declaration in the order it was read, so a whole
 * ruleset round-trips through `printDefinitions` the way a rule does through
 * `printRule`, and `sources` says which file each came from, which is what
 * makes an error point at a place a person can open.
 */
export interface GameDefinition {
  id: Game;
  game: GameDef | null;
  attributes: Record<string, AttributeDef>;
  zones: Record<string, ZoneDef>;
  phases: Record<string, PhaseDef>;
  steps: Record<string, StepDef>;
  actions: Record<string, ActionDef>;
  triggers: Record<string, TriggerDef>;
  keywords: Record<string, KeywordDef>;
  costs: Record<string, CostDef>;
  wins: Record<string, WinDef>;
  ops: Record<string, OpDef>;
  definitions: Definition[];
  /** `"zone:battle"` → `"zones.rules"`, the key shape `words` uses too. */
  sources: Record<string, string>;
}

/**
 * The closed word lists the language is checked against — today hand-written
 * constants in `engine/script-schema.ts` and `gaps.ts`, tomorrow (#137) a
 * re-export of this. The names are the ones those constants use, so the swap
 * is a re-export and not a rename.
 *
 * Four of the eight have no `DEFINE` kind that could declare them yet:
 * `durations` and `sides` are the effect language's own words, `skillKinds`
 * comes off a card's printed tag, and `promptKinds` awaits the owner's
 * decision on `DEFINE PROMPT` (#131's closing question). Those are filled from
 * the engine's lists and from what the declarations happen to name; the other
 * four are the definition's, and are empty until the game's files declare them.
 */
export interface Vocabulary {
  areas: string[];
  durations: string[];
  sides: string[];
  keywordNames: string[];
  triggers: string[];
  skillKinds: string[];
  promptKinds: string[];
  /** `"zone:battle"` → the declaration's `text:`, the sentence the board would say. */
  words: Record<string, string>;
}

/** A loader failure, in the parser's own shape plus the file it is in. Assignable to `LangError`, so an editor that can show a parse error can show one of these. */
export interface RulesetError extends LangError {
  file: string;
}

export type Loaded = { ok: true; definition: GameDefinition; vocabulary: Vocabulary } | { ok: false; errors: RulesetError[] };
