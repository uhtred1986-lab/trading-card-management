/**
 * The words `wording.ts`, `narration.ts` and `effects.ts` turn into English,
 * and `lighting.ts` turns into a room colour (Stage 8, issue #159).
 *
 * The words are DBS's and they are *declared*, in
 * `rulesets/dbs/words.rules` (`DEFINE WORDS`, #135/#340): a zone's two forms,
 * a phase or beat, a mode, a colour that lights a room, and the phrases a
 * `Requirement` and a rule in force are said in (a verb, a timing window, how
 * long a rule holds). `wordsFromRuleset` reads them off the loaded definition
 * and checks them against what the definition declares, so a zone renamed or a
 * phrase deleted is a broken build rather than a wrong sentence. The sentence
 * *shapes* around the words — which branch a viewer takes, the "cannot ...
 * now" frame — are the interpreter's and stay in code.
 *
 * `dbsWords()` is what every caller gets by default, on either engine, since
 * the arena only ever plays `dbs` (`docs/arena-code-map.md`, "Two engines").
 * It is `wordsFromRuleset` over the generated `rulesets/dbs/files.ts`, worked
 * out by `npm run arena:rulesets` into `rulesets/dbs/board-words.ts` (#782), so
 * nothing is read or parsed at request time.
 * Android's Kotlin copy of these tables is unchanged: the strings are the
 * same ones.
 */
import type { Area } from "./types";
import { AREAS, COLORS } from "./vm/script-schema";
import type { GameDefinition } from "./rulesets";
import { DBS_BOARD_WORDS } from "./rulesets/dbs/board-words";
import { FUSION_BOARD_WORDS } from "./rulesets/fusion/board-words";
import type { Game } from "../catalog/games";

/** How long a rule holds, as `words.rules` declares it. `{them}` and `{source}` are filled by `effects.ts`'s `untilWords`. */
export interface UntilWord {
  /** The phrase; for a turn-relative duration, the one that names the other player. */
  text: string;
  /** The phrase that names the viewer, where it depends on whose turn ends it. */
  you?: string;
  /** `text` with no `{source}` to fill. */
  bare?: string;
}

/** Every table's vocabulary, gathered in one place. */
export interface BoardWords {
  /** A zone, said as the viewer's own — "your Battle Area" (`wording.ts`'s refusals). Only the areas the game declares have a word. */
  area: Partial<Record<Area, string>>;
  /** The same zone, said from the third person — "the Battle Area" (`narration.ts`'s beats). */
  narrationArea: Partial<Record<Area, string>>;
  /** A phase or step id (the beat stream's own, not always the declaration's — see `PHASE_DECLARATION` below), said as a sentence names it. */
  phase: Record<string, string>;
  /** Active/Rest Mode, the only two tokens `zones.rules` declares for `modes:`. */
  mode: Record<"active" | "rest", string>;
  /** The colours a leader can be, and so a room can be lit for (`lighting.ts`). Excludes White and Colorless, which light no room of their own (`colourOf`'s own fallback to Black). */
  leaderColours: readonly string[];
  /** The verb in "X cannot <verb> now", by action type (`wording.ts`). */
  verb: Record<string, string>;
  /** What a timing refusal tells the player to wait for, by window (`wording.ts`). */
  window: Record<string, string>;
  /** How long a rule in force holds, by duration (`effects.ts`). */
  until: Record<string, UntilWord>;
}

/**
 * Which declaration each phase word names, so `wordsFromRuleset` can check it
 * exists rather than trusting the word. The beat stream's own step ids are
 * not always the declaration's name (a `Beat`'s `phase` field carries either,
 * `beats.ts`), so this is the mapping between them — the legacy engine's
 * event log on the left, `game.rules`/`battle.rules`'s own declared name on
 * the right. `turn`/`span` (`SkipWhat`) name no phase at all and are not here.
 */
const PHASE_DECLARATION: Record<string, { kind: "phase" | "step"; name: string }> = {
  charge: { kind: "phase", name: "charge" },
  main: { kind: "phase", name: "main" },
  mainEnd: { kind: "phase", name: "mainEnd" },
  end: { kind: "phase", name: "end" },
  setup: { kind: "phase", name: "setup" },
  over: { kind: "phase", name: "over" },
  declared: { kind: "step", name: "battleDeclare" },
  offense: { kind: "step", name: "battleOffense" },
  defense: { kind: "step", name: "battleDefense" },
  damage: { kind: "step", name: "battleDamage" },
  battleEnd: { kind: "step", name: "battleEnd" },
};

/** The areas a game may leave undeclared (Fusion World has none of them); every other area is every game's, and a ruleset without one is broken. */
const SOME_GAMES_ONLY = new Set<string>(["warp", "unison", "zDeck", "zEnergy"]);

/** The two effect-language-only routes a program names and a board never shows a card sitting in. */
const NOT_ON_THE_BOARD = new Set<string>(["under", "play"]);

/** `verbPlayUnison` → `playUnison`: `words.rules`' name for a phrase carries a prefix, because a name is unique across every `of:`. */
const unprefixed = (prefix: string, name: string): string => `${name.charAt(prefix.length).toLowerCase()}${name.slice(prefix.length + 1)}`;

/**
 * The board's words, read off a loaded ruleset and checked against it. Throws
 * — the same choice `rulesets/words.ts`'s `words()` makes — since a definition
 * that has stopped agreeing with the tables is a broken build, not a state to
 * render around.
 */
export function wordsFromRuleset(def: GameDefinition): BoardWords {
  const all = Object.entries(def.words);
  const of = (kind: string) => all.filter(([, w]) => w.of === kind);

  // Zones: both forms, for every area a board can show a card in.
  const area: Partial<Record<Area, string>> = {};
  const narrationArea: Partial<Record<Area, string>> = {};
  const zoneNames = Object.keys(def.zones);
  for (const name of AREAS) {
    if (NOT_ON_THE_BOARD.has(name)) continue;
    // A game that does not declare an area (Fusion World has no Warp, Unison, Z-Deck or Z-Energy) gets
    // no word for it; the board reads "no word" as "this game has no such area".
    if (!zoneNames.includes(name)) {
      if (!SOME_GAMES_ONLY.has(name)) throw new Error(`board-words: zones.rules no longer declares "${name}", which wording.ts/narration.ts still name`);
      if (def.words[name]?.of === "zone") throw new Error(`board-words: words.rules has a DEFINE WORDS ${name} (of: zone) for an area zones.rules does not declare`);
      continue;
    }
    const w = def.words[name];
    if (w?.of !== "zone" || !w.you) throw new Error(`board-words: words.rules has no DEFINE WORDS ${name} (of: zone, with you:)`);
    area[name as Area] = w.you;
    narrationArea[name as Area] = w.text;
  }

  // Phases and beats, each checked against the declaration it names.
  for (const [key, target] of Object.entries(PHASE_DECLARATION)) {
    const table = target.kind === "phase" ? def.phases : def.steps;
    if (!(target.name in table)) throw new Error(`board-words: ${target.kind} "${target.name}" (for narration's "${key}") is no longer declared in game.rules/battle.rules`);
    if (def.words[key]?.of !== "phase") throw new Error(`board-words: words.rules has no DEFINE WORDS ${key} (of: phase)`);
  }
  const phase: Record<string, string> = {};
  for (const [name, w] of of("phase")) phase[name] = w.text;

  // Modes: exactly the two tokens `zones.rules` declares for `modes:`.
  const modeZone = Object.values(def.zones).find((z) => z.modes && z.modes.length > 0);
  const modes = modeZone?.modes ?? [];
  if (modes.length !== 2 || !modes.includes("active") || !modes.includes("rest")) {
    throw new Error(`board-words: expected exactly ["active","rest"] on a zone's modes:, found ${JSON.stringify(modes)}`);
  }
  const modeWord = (m: "active" | "rest"): string => {
    const w = def.words[m];
    if (w?.of !== "mode") throw new Error(`board-words: words.rules has no DEFINE WORDS ${m} (of: mode)`);
    return w.text;
  };
  const mode = { active: modeWord("active"), rest: modeWord("rest") };

  // Colours: the ones `room: true` marks light a room, in declaration order.
  if (def.attributes.colors?.value !== "colors") throw new Error(`board-words: attributes.rules no longer declares "colors" as a colours-valued attribute`);
  const leaderColours: string[] = [];
  for (const [name, w] of of("color")) {
    if (!(COLORS as readonly string[]).includes(name)) throw new Error(`board-words: "${name}" is no longer one of vm/script-schema.ts's COLORS`);
    if (w.room) leaderColours.push(w.text);
  }
  if (leaderColours.length === 0) throw new Error(`board-words: words.rules marks no colour room: true, so no leader would light a room`);

  // The phrases a Requirement and a rule in force are said in.
  const verb: Record<string, string> = {};
  for (const [name, w] of of("verb")) verb[unprefixed("verb", name)] = w.text;
  const window: Record<string, string> = {};
  for (const [name, w] of of("window")) window[unprefixed("window", name)] = w.text;
  const until: Record<string, UntilWord> = {};
  for (const [name, w] of of("until")) {
    until[unprefixed("until", name)] = { text: w.text, ...(w.you !== undefined ? { you: w.you } : {}), ...(w.bare !== undefined ? { bare: w.bare } : {}) };
  }

  return { area, narrationArea, phase, mode, leaderColours, verb, window, until };
}

/**
 * The vocabulary every caller gets by default — DBS, on either engine: `wordsFromRuleset` over the loaded
 * `words.rules`, computed when the ruleset is generated (`npm run arena:rulesets` writes
 * `rulesets/dbs/board-words.ts`) rather than here. Computing it here parsed every `.rules` file on the
 * browser's main thread the first time a board drew a room colour or a sentence (#782: about 25 ms of
 * the longest task of a match start on a desktop). `scripts/verify/board-words.ts` fails `npm test`
 * when the generated table and the ruleset disagree, so a renamed zone or a deleted phrase is still a
 * broken build.
 */
export function dbsWords(): BoardWords {
  return DBS_BOARD_WORDS;
}

/**
 * The vocabulary of one card game's board, from the generated table of its ruleset. An area the game does not
 * declare has no word in it (`area[a] === undefined`), and the board reads that as "this game has no such area":
 * it draws no frame, label or counter for it (F1-06).
 */
export function wordsFor(game: Game): BoardWords {
  return game === "fusion" ? FUSION_BOARD_WORDS : DBS_BOARD_WORDS;
}

/** Whether `game` has the area at all — the test every stage component asks before it draws a slot for one. */
export function hasArea(words: BoardWords, area: Area): boolean {
  return words.area[area] !== undefined;
}
