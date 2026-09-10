import type { CardDef, Op } from "./engine";
import type { SkillPrice } from "./engine/script";

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
}

export type ProbeFamily = "play" | "attack" | "combo" | "activateMain" | "activateBattle" | "counter" | "permanent" | "keyword" | "moment" | "none";
export type ProbeVariant = "default" | "noTarget" | "negated" | "opponentTurn" | "inHand";

export interface ProbeScenario {
  /** "play" or "play:noTarget" — stable, so a stored probe can be re-run. */
  key: string;
  family: ProbeFamily;
  variant: ProbeVariant;
  /** The board in one line, as the select shows it. */
  title: string;
}

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
}
