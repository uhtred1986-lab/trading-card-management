import type { CardDef } from "./types";
import type { Op } from "./vm/script";
import type { SkillPrice } from "./vm/script";
import type { RulePath } from "./lang/path";

/** The rule under test, as the row holds it. */
export interface ProbeRule {
  /** The card as the engine sees it — its printed text included, since the engine reads kinds and triggers off it. */
  def: CardDef;
  side: "front" | "back";
  skillIndex: number;
  /** The row's `kind`: "auto" | "activate:main" | "permanent" | … */
  kind: string;
  /** The row's `trigger` names, from `triggersOf`. */
  trigger: string[];
  /** The program the engine would run — the hoisted condition already wrapped back around it. */
  ops: Op[];
  /** An open row: no program, played as blank, and the log says so. */
  open: boolean;
  unread: string[];
  /** The price before the colon, off the row's `cost`. */
  price: SkillPrice;
  /**
   * Whether `ops` is the row's hoisted IF wrapped back around its steps
   * (`programOf`), so a traced probe can call the IF `cond` and its steps
   * `ops[i]` (#470). Left out, a program of one `if` with no `else` is read
   * as hoisted.
   */
  hoisted?: boolean;
}

export type ProbeFamily = "play" | "attack" | "combo" | "activateMain" | "activateBattle" | "copy" | "counter" | "permanent" | "keyword" | "moment" | "none";
/**
 * `reduced` is the board a [Permanent] that relaxes its *own* specified cost
 * from hand is measured on (issue #255): the card in hand, its condition met,
 * and one energy of each colour it still demands once the rule has relaxed
 * it — so "the play is legal on a board with one blue energy" is what the
 * probe reports for BT19-039, and a refusal names the colour it is short of.
 */
export type ProbeVariant = "default" | "noTarget" | "negated" | "opponentTurn" | "inHand" | "reduced";

export interface ProbeScenario {
  /** "play" or "play:noTarget" — stable, so a stored probe can be re-run. */
  key: string;
  family: ProbeFamily;
  variant: ProbeVariant;
  /** The board in one line, as the select shows it. */
  title: string;
  /**
   * The numbers the rule's condition reads, set on this board (#470): how
   * many matching cards are in the counted zone, a life total, whose turn it
   * is — keyed by the path of the condition each one answers
   * (`probe-edges.ts`). Absent on the trigger's own boards, which stage
   * nothing for the condition.
   */
  knobs?: BoardKnobs;
}

/** A `count` or `life` condition's number, or `isTurnPlayer`'s side. */
export type KnobValue = number | "you" | "opponent";
export type BoardKnobs = Record<RulePath, KnobValue>;

export type ProbeOutcome = "fired" | "blank" | "didNotFire" | "notOffered" | "inForce" | "noScenario" | "error";

export interface ProbeRun {
  scenario: ProbeScenario;
  /** What was staged, in words. */
  input: string[];
  /** The rule's own beats: the trigger, each choice, each step. */
  applied: string[];
  /** What changed on the board. */
  result: string[];
  /** What the run took for granted, and where the engine knowingly approximates. */
  assumptions: string[];
  /** Every question the engine asked, and the answer the probe gave. */
  prompts: { ask: string; chose: string }[];
  /** The whole narrated log. */
  log: string[];
  outcome: ProbeOutcome;
  /** Stable over outcome + applied + result: what `arena:reprobe` compares. */
  digest: string;
  /** What a traced run (`probe(…, { trace: true })`) knows about which block did what. Never part of `digest`. */
  trace?: ProbeTrace;
}

/**
 * Which block of the rule made each beat (#470, `probe-trace.ts`). Paths are
 * `RulePath`s into the rule as the language holds it.
 */
export interface ProbeTrace {
  /**
   * One per line of `applied`: the op or condition that made it; `cond` (or
   * `trigger`, with no IF) for the skill's own announcement; null for a beat
   * the rule did not make — the move under test, the battle around it.
   */
  appliedPaths: (RulePath | null)[];
  /** The steps that finished, in the order they did. */
  reached: RulePath[];
  /** Whether the rule's IF held on this board; null when it has none. */
  held: boolean | null;
  /** The engine's own remarks while the rule was tried (`note` events), markers taken out. */
  notes: string[];
  /** What the rule's own steps changed — `result`, less the game going on around it (the opponent's draw when the turn is run to its end). */
  result: string[];
}
