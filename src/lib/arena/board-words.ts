/**
 * The zone, mode and colour vocabulary `wording.ts`, `narration.ts` and
 * `effects.ts` turn into English, and `lighting.ts` turns into a room colour
 * (Stage 8, issue #159).
 *
 * The words are DBS's; the sentence *shapes* around them are the
 * interpreter's and stay in code (`docs/arena-next-session-prompt.md`'s own
 * framing). `DBS_WORDS` is that vocabulary, written once here instead of once
 * per table as it was before this module existed, and is what every caller
 * gets by default — legacy and rules alike, since the arena only ever plays
 * `dbs` on either engine today (`docs/arena-code-map.md`, "Two engines").
 *
 * There is no `words.rules` yet: `DEFINE WORDS` is not one of the eleven
 * declaration kinds (`docs/arena-ruleset-spec.md` §3, blocked on #131), and
 * neither `zones.rules` nor `attributes.rules` carries a short display label
 * for a zone or a colour — only prose in `text:`. `wordsFromRuleset` reads
 * everything the declarations really do say today (which zones and modes
 * exist, that a mode word is one of exactly two tokens) and fails loudly if
 * `DBS_WORDS` and the loaded ruleset disagree about any of it, so a zone
 * renamed or removed in `zones.rules` is caught here rather than drifting
 * silently. The phrases themselves stay hand-written until #131 gives a
 * declaration somewhere to hold them — named as a gap rather than guessed
 * around, the same as `engine/script-schema.ts`'s own `COLORS` export says of
 * itself ("the day a game declares its own colours, this export goes back to
 * being private").
 */
import type { Area } from "./engine/types";
import { COLORS } from "./engine/script-schema";
import { LEADER_COLOURS } from "./lighting";
import type { GameDefinition } from "./rulesets";

/** Every table's DBS vocabulary, gathered in one place. */
export interface BoardWords {
  /** A zone, said as the viewer's own — "your Battle Area" (`wording.ts`'s refusals). */
  area: Record<Area, string>;
  /** The same zone, said from the third person — "the Battle Area" (`narration.ts`'s beats). */
  narrationArea: Record<Area, string>;
  /** A phase or step id (the beat stream's own, not always the declaration's — see `PHASE_DECLARATION` below), said as a sentence names it. */
  phase: Record<string, string>;
  /** Active/Rest Mode, the only two tokens `zones.rules` declares for `modes:`. */
  mode: Record<"active" | "rest", string>;
  /** The colours a leader can be, and so a room can be lit for (`lighting.ts`). Excludes White and Colorless, which light no room of their own (`colourOf`'s own fallback to Black). */
  leaderColours: readonly string[];
}

/** `narration.ts`'s "the X" forms, so `wordsFromRuleset` can validate the same set the possessive forms below use. */
const NARRATION_AREA: Record<Area, string> = {
  deck: "the deck",
  hand: "hand",
  drop: "the Drop",
  leader: "the Leader Area",
  battle: "the Battle Area",
  combo: "the Combo Area",
  energy: "the Energy Area",
  life: "life",
  warp: "the Warp",
  unison: "the Unison Area",
  zDeck: "the Z-Deck",
  zEnergy: "Z-Energy",
  removed: "out of the game",
};

const WORDING_AREA: Record<Area, string> = {
  deck: "your deck",
  hand: "your hand",
  drop: "your Drop Area",
  leader: "the Leader Area",
  battle: "your Battle Area",
  combo: "your Combo Area",
  energy: "your Energy Area",
  life: "your Life Area",
  warp: "your Warp",
  unison: "the Unison Area",
  zDeck: "your Z-Deck",
  zEnergy: "your Z-Energy Area",
  removed: "out of the game",
};

const PHASE: Record<string, string> = {
  charge: "Charge Phase",
  main: "Main Phase",
  mainEnd: "Main Phase ends",
  end: "End Phase",
  declared: "Attack declared",
  offense: "Offense Step",
  defense: "Defense Step",
  damage: "Damage Step",
  battleEnd: "The battle ends",
  setup: "Setting up",
  over: "The game is over",
};

/**
 * Which declaration each `PHASE` key names, so `wordsFromRuleset` can check it
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

/** The vocabulary every caller gets by default — DBS, on either engine. */
export const DBS_WORDS: BoardWords = {
  area: WORDING_AREA,
  narrationArea: NARRATION_AREA,
  phase: PHASE,
  mode: { active: "Active Mode", rest: "Rest Mode" },
  leaderColours: LEADER_COLOURS,
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * `DBS_WORDS`, checked against a loaded ruleset rather than trusted on its
 * own. Throws — the same choice `rulesets/words.ts`'s `words()` makes — since
 * a definition that has stopped agreeing with this table is a broken build,
 * not a state to render around.
 */
export function wordsFromRuleset(def: GameDefinition): BoardWords {
  const zoneNames = Object.keys(def.zones);
  for (const area of Object.keys(WORDING_AREA) as Area[]) {
    if (!zoneNames.includes(area)) throw new Error(`board-words: zones.rules no longer declares "${area}", which wording.ts/narration.ts still name`);
  }
  for (const [key, target] of Object.entries(PHASE_DECLARATION)) {
    const table = target.kind === "phase" ? def.phases : def.steps;
    if (!(target.name in table)) throw new Error(`board-words: ${target.kind} "${target.name}" (for narration's "${key}") is no longer declared in game.rules/battle.rules`);
  }
  // The only place a mode word is genuinely derived rather than checked: every
  // zone that declares `modes:` declares exactly these two tokens today, and
  // "Active"/"Rest" capitalised plus "Mode" is the whole of `DBS_WORDS.mode`.
  const modeZone = Object.values(def.zones).find((z) => z.modes && z.modes.length > 0);
  const modes = modeZone?.modes ?? [];
  if (modes.length !== 2 || !modes.includes("active") || !modes.includes("rest")) {
    throw new Error(`board-words: expected exactly ["active","rest"] on a zone's modes:, found ${JSON.stringify(modes)}`);
  }
  const mode = { active: `${capitalize("active")} Mode`, rest: `${capitalize("rest")} Mode` };
  if (def.attributes.colors?.value !== "colors") throw new Error(`board-words: attributes.rules no longer declares "colors" as a colours-valued attribute`);
  for (const colour of LEADER_COLOURS) {
    if (!(COLORS as readonly string[]).includes(colour)) throw new Error(`board-words: "${colour}" is no longer one of engine/script-schema.ts's COLORS`);
  }
  return { area: WORDING_AREA, narrationArea: NARRATION_AREA, phase: PHASE, mode, leaderColours: LEADER_COLOURS };
}
