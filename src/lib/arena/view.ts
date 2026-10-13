/**
 * The board as the browser needs it: plain, serialisable data.
 *
 * The engine's state is keyed by instance id and says nothing about images or
 * what a player may tap. This turns one state plus the legal moves into a view
 * for one side of the table, hiding what that player may not see (3-1-3).
 */
import { type ActionCost, type PlayerId, type Requirement, type SkillKind } from "./types";
import { type EffectView } from "./effects";

// The viewer-side helpers live in `view-core.ts`; every existing caller keeps importing them from here.
export { abilityViews, revealedTo, tappable, viewerOf } from "./view-core";

export interface CardView {
  id: string;
  cardId: string;
  name: string;
  power: number | null;
  colors: string[];
  imageUrl: string | null;
  mode: "active" | "rest";
  hidden: boolean;
  flipped: boolean;
  markers: number;
  underCount: number;
  isToken: boolean;
  cost: string | null;
  comboCost: number | null;
  comboPower: number | null;
  keywords: string[];
  /** The printed text, and the engine's own reading of it (proposal §6). */
  text: string | null;
  reading: string;
  /**
   * True when a skill of this card has to be put to the referee when it
   * resolves. Never for a [Permanent]: those never resolve and the referee is
   * never asked about one — an unreadable [Permanent] is in `permanents`.
   */
  referee: boolean;
  /**
   * The printed power, when the number shown is not it: a continuous effect
   * or someone's [Permanent] has changed it. Absent when `power` is the face
   * value, so a client can draw the difference and nothing else.
   */
  basePower?: number;
  /**
   * Every rule in force on this card right now — turn-long effects and the
   * static effects of [Permanent] skills, its own included — so the sheet can
   * say "+5000 power until the end of the turn, from Kaio-ken". Absent when
   * there are none.
   */
  effects?: EffectView[];
  /**
   * This card's own [Permanent] skills and whether each is doing anything at
   * this moment: `on` (emitting a standing effect), `off` (its condition does
   * not hold, or nothing to apply it to), `inert` (compiles, but the static
   * layer has no kind for what it says — it does nothing, and the compile
   * figures cannot show that), `unread` (the compiler cannot read it).
   */
  permanents?: PermanentView[];
  /** Per-line identity and current engine evidence, for clients that show an ability panel. */
  abilities?: AbilityView[];
}

export interface AbilityView {
  /** Stable within this game: card instance id plus the engine's skill index. */
  skillIndex: number;
  kind: SkillKind;
  category: "manual" | "automatic" | "passive" | "counter" | "keyword";
  text: string;
  tags: string[];
  zone: string;
  owner: PlayerId;
  controller: PlayerId;
  origin: "printed" | "copied";
  timing?: string;
  limit?: { max: number; used: number; remaining: number };
  availability: "offered" | "refused" | "notEvaluated";
  notEvaluatedReason?: "notDecisionActor" | "unsupported" | "unidentifiedAction";
  why?: Requirement[];
  /** Cost data is an exact engine offer; absent amounts are never represented as free. */
  costPreview: { state: "known"; offers: { label: string; cost: ActionCost }[] } | { state: "incomplete" } | { state: "notApplicable" };
  /** True only when this visible Auto line is currently queued to resolve. */
  pending?: boolean;
  /** Existing engine reading for standing effects, when this line is a Permanent. */
  permanentState?: PermanentView["state"];
}

/** One [Permanent] skill of a card and its state now (review §3.5). */
export interface PermanentView {
  /** Index of the skill in the card's text, the same `skillIndex` the engine uses. */
  index: number;
  /** The printed line, without its tag. */
  text: string;
  state: "on" | "off" | "inert" | "unread";
  /** The engine's reading of the line, when it has one. */
  reading: string;
}

export interface SideView {
  player: PlayerId;
  name: string;
  leader: CardView | null;
  unison: CardView | null;
  battle: CardView[];
  combo: CardView[];
  energy: CardView[];
  /** Effective public energy colours, distinct from CardView's printed colours. */
  energyColors?: { card: string; colors: string[]; paymentColors: string[] }[];
  /** Null when the hand is the opponent's: only its size is public (3-3-3). */
  hand: CardView[] | null;
  handCount: number;
  life: number;
  /**
   * 3-9-2-1: the life cards a skill turned face up, and the same in the
   * Z-Deck. Both players may see these, on either side of the table, so they
   * are the one part of a closed area this view names.
   */
  lifeFaceUp: CardView[];
  zDeckFaceUp: CardView[];
  deck: number;
  drop: number;
  warp: number;
  zDeck: number;
  zEnergy: number;
  energyMarkers: number;
  activeEnergy: number;
  dropTop: CardView | null;
  /** Viewer-readable cards for zone inspection. Counts also include unreadable cards.
   * Z-Deck follows the existing owner/face-up visibility policy; Hidden Mode is excluded. */
  inspectableZones?: { drop: CardView[]; warp: CardView[]; zEnergy: CardView[]; zDeck: CardView[] };
  /**
   * Cards the current prompt names that live in no drawn zone — the deck, the
   * Drop below its top card, the Warp, face-down life, the Z-Deck, under
   * another card. Absent unless the prompt names them, and only ever built for
   * the player being asked: a search of your deck reveals those cards to you
   * and to nobody else. This is what makes a search renderable at all.
   */
  choices?: CardView[];
  /**
   * Rules in force on this *player* rather than on a card — "can't attack
   * with Battle Cards until the start of your next turn", "can't place cards
   * in the Energy Area" — which no card on the board could carry. Absent when
   * there are none.
   */
  rules?: EffectView[];
}

export interface BoardView {
  you: SideView;
  them: SideView;
  turn: number;
  phase: string;
  turnPlayer: PlayerId;
  battle: BattleView | null;
  prompt: PromptView;
  over: { winner: PlayerId | null; reason: string } | null;
}

/**
 * The open battle: who is in it, where it has got to, and the two figures.
 *
 * `counters` and `contributions` are what let a battle staging say *what*
 * decided a fight rather than only that one happened
 * (`docs/arena-battle-staging-spec.md` §3.1). Both come from the engine — a
 * client that works either of them out for itself has broken the contract.
 */
export interface BattleView {
  attacker: string;
  guard: string;
  step: string;
  attackPower: number;
  guardPower: number;
  /** Conditional public projection, not a resolved result. Older engines omit it. */
  stakes?: {
    hit: boolean;
    tied: boolean;
    target: "leader" | "unison" | "battle";
    lifeDamage: number;
    strikeDamage: number;
    markerLoss: number;
    critical: boolean;
    victoryStrike: boolean;
    potentialLethal: boolean;
    koPrevented: boolean;
    assumption: string;
  };
  /**
   * The counter cards played into this battle, in play order. They are in the
   * Drop by now, which is exactly why the board cannot find them for itself.
   * Absent when none have been played, and on games saved before the battle
   * kept the record.
   */
  counters?: { card: CardView; by: PlayerId; after: number }[];
  /**
   * Card instance id → the power that card is putting into the fight now, so a
   * change in a total can be attributed to the card that caused it.
   *
   * The attacker, the guard and every combo card carry their own figure, and
   * those add up exactly: the attacker plus its side's combo is `attackPower`.
   * A counter's figure is the part of the *guard's* number that came from it —
   * a counter moves a power rather than standing beside it — so it is a
   * breakdown of a figure already counted, never an extra term.
   */
  contributions?: Record<string, number>;
}

/** The one-line question the prompt bar asks, and what the engine knows about it beyond the words. */
export interface PromptView {
  kind: string;
  player: PlayerId | null;
  question: string;
  hint: string | null;
  /** How many cards a `chooseCards` prompt takes; `min` of 0 is what a "Choose none" button needs. */
  min?: number;
  max?: number;
  /**
   * Where this prompt sits in a skill's resolution chain, from the engine's
   * flow rather than a client counting taps. `count` is 0 when the chain
   * cannot say how long it is; a client then shows "step 2" without a total.
   */
  step?: { index: number; count: number; label: string };
  /** What is being paid for, unflattened, from a `payCost` or `optionalCost` prompt. */
  cost?: string;
  /** The current engine window's decline, not a prediction of later responses. */
  passConsequence?: string;
  /** Exact energy cards rested by each offered payment; only the actor sees these. */
  payments?: { option: number; energyRest: string[]; markers: number }[];
}

/** Everything the current prompt will accept, indexed by the card it points at. */
export interface Tappable {
  /** Card instance id → the actions that name it. */
  byCard: Record<string, number[]>;
  /** Actions that name no card: pass, end turn, don't block. */
  bare: number[];
  /** For an attack, the targets each attacker may hit. */
  attackTargets: Record<string, Record<string, number>>;
  /**
   * Why a card the player might tap has no action: the rejections indexed the
   * same way, so a tap on a dead card has an answer. Present only when there
   * are any — they are computed for the asked player and never for Claude.
   */
  whyByCard?: Record<string, Requirement[]>;
}

/**
 * Card art from the catalog, keyed by card number. A leader has two faces, so
 * both are carried: a leader that has awakened must show its back, which is a
 * different image and often a different name (1-9-1).
 */
export interface CardArt {
  front: string | null;
  back: string | null;
}
