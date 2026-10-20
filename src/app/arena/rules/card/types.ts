import type { Rule } from "@/lib/arena/lang";
import type { FlagNotice } from "@/lib/arena/rule-card";
import type { ReviewItem } from "@/lib/arena/rule-review-store";
import type { RuleHealth, RuleStatus } from "@/lib/arena/rules-store";

/** One printed skill of a card, as the Card rules page draws its panel. Plain data: it crosses from the server page to the client. */
export interface SkillView {
  /** 1-based, in printed order (front side first, then the awakened side). */
  n: number;
  side: "front" | "back";
  skillIndex: number;
  /** The printed line. */
  printed: string;
  /** The `card_rules` row, or null when the card prints this skill and no current record answers it. */
  ruleId: number | null;
  /** "Auto", "Activate: Main"… */
  kindLabel: string;
  health: RuleHealth;
  /** "deck-building" when the whole line is a deck-building clause: the panel labels it so instead of by health (#1146). */
  category: "deck-building" | null;
  /** The deck-building clauses the line carries, in words (a mixed line's too). */
  deckBuilding: string[];
  reasons: string[];
  hints: string[];
  needsRebuild: boolean;
  status: RuleStatus | null;
  source: "compiler" | "claude" | "user" | null;
  version: number;
  /** ISO time of the row's last write. */
  changedAt: string | null;
  /** "The engine reads": the row's own reading. */
  reads: string;
  /** The combo qualification as chips ("opponent’s turn", …), empty when the skill has none. */
  comboChips: string[];
  unread: string[];
  flag: FlagNotice | null;
  /** What the compiler now reads and the stored rule does not; the choice is the owner's. */
  compilerDiff: { reads: string; unread: string[]; at: string } | null;
  /** The rule as the builder takes it. */
  rule: Rule | null;
  /** The row as the Wrong sheet, the exact-version guard and a pending Claude draft need it. */
  item: ReviewItem | null;
  timesSeen: number;
  /** The builder's opening focus (`lang/path.ts`), when the skill has an unread clause. */
  focus: string | null;
}

export interface HistoryLine {
  when: string;
  what: string;
  /** "Skill 2", or empty for the card. */
  skill: string;
}

export interface CardView {
  id: string;
  name: string;
  setCode: string;
  type: string;
  colors: string[];
  imageUrl: string | null;
  cost: string | null;
  power: number | null;
  comboPower: number | null;
  traits: string[];
  decks: { id: number; name: string }[];
  seenIn: number;
  health: RuleHealth;
  /** One line, in plain words, on why the card has this health. */
  why: string;
  /** Any skill is missing its record or has an obsolete payment record: *Rebuild card* is offered. */
  canRebuild: boolean;
  /** An X-cost card's specified cost; null for any other card. */
  specifiedCost: { entered: string | null; words: string | null; unknown: boolean } | null;
}
