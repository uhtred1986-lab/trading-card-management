/**
 * Arena rules engine — shared types.
 *
 * Pure data: no React, no database. A game is a `GameState` plus the list of
 * `GameEvent`s that produced it; `apply()` in `engine.ts` is the only thing
 * that changes a state. Section numbers in comments refer to the official
 * Rule Manual v4.00 (`docs/rules/rulemanual.txt`).
 */

import type { CardFilter } from "./filters";
import type { Op, ScriptFrame } from "./script";
import type { Payment } from "./state";

export type PlayerId = "p1" | "p2";
export const PLAYERS: PlayerId[] = ["p1", "p2"];
export const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

/** The five colours (1-8) plus the catalog's "Colorless" for tokens. */
export type Color = "Red" | "Blue" | "Green" | "Yellow" | "Black" | "White" | "Colorless";

export type CardType = "LEADER" | "BATTLE" | "EXTRA" | "UNISON" | "Z-LEADER" | "Z-BATTLE" | "Z-EXTRA" | "Z-UNISON" | "TOKEN";

/**
 * A card as the engine needs it — the catalog row, shaped. `energyCost` is a
 * number, `"X"` or null (leaders); `specifiedCost` is the coloured orbs, which
 * the catalog does not carry, so `defaultSpecifiedCost()` fills it by
 * convention (proposal §9.1) unless a compiled script overrides it.
 */
export interface CardDef {
  id: string;
  name: string;
  type: CardType;
  colors: Color[];
  energyCost: number | "X" | null;
  zEnergyCost: number | null;
  power: number | null;
  comboCost: number | null;
  comboPower: number | null;
  skill: string | null;
  characters: string[];
  traits: string[];
  /** Leader back side (awakened), or a Z-Leader's single face. */
  back?: { name: string; power: number | null; skill: string | null } | null;
  /** Coloured orbs of the energy cost; one orb per colour by default. */
  specifiedCost?: Partial<Record<Color, number>>;
}

/** One printed skill line, parsed by `cards.ts`. */
export interface Skill {
  /** Index within the card face's text, stable across games. */
  index: number;
  kind: SkillKind;
  /** All leading bracket tags, normalised ("Activate: Main", "Once per turn", "Blocker"). */
  tags: string[];
  keyword: KeywordSkill | null;
  /** Text before the effect colon: skill cost and/or condition. */
  cost: string;
  /** Text after the colon (or the whole text when there is no cost). */
  effect: string;
  oncePerTurn: boolean;
  limit: number | null;
  /** [Bond X] / [Sparking X] / [Burst X] validity or activation conditions. */
  bond: number | null;
  sparking: number | null;
  burst: number | null;
  /** [Spirit Boost X]: remove X markers from your Unison as the skill cost (22-43). */
  spiritBoost: number | null;
  /** Marker skill cost [+X]/[-X] on Unison cards (13-4). */
  markerCost: number | null;
  /** Energy orbs in the skill cost, e.g. {g}{g} → { Green: 2 }; `{u}` is blue. */
  energyCost: Partial<Record<Color, number>> & { any?: number };
  /**
   * Orbs printed "{r}/{u}": one orb each, payable with any *one* of the named
   * colours. Kept apart from `energyCost` so that every loop over that stays a
   * loop over numbers — and because "either red or blue" is not "any colour",
   * which is what it used to be folded into.
   */
  energyEither: Color[][];
  raw: string;
}

export type SkillKind =
  | "activate:main"
  | "activate:battle"
  | "activate:main/battle"
  | "auto"
  | "permanent"
  | "counter:play"
  | "counter:attack"
  | "counter:battle card attack"
  | "counter:counter"
  /** A keyword skill on its own line, e.g. "[Blocker]" or "[Critical]". */
  | "keyword";

/**
 * How a card names a *kind* of skill rather than one skill: "negate that
 * card's [Auto] skill for the turn" (9-1-5). A printed "[Counter]" means every
 * counter kind, so these are prefixes of `SkillKind`, matched as such.
 */
export type SkillKindPrefix = "auto" | "activate" | "counter" | "permanent";

/** Keyword skills of §22 with their parameters. */
export type KeywordSkill =
  | { name: "Awaken"; surge: boolean }
  | { name: "Wish" }
  | { name: "Field" }
  | { name: "Blocker" }
  | { name: "Critical" }
  | { name: "Strike"; x: 2 | 3 | 4 }
  | { name: "Attack"; x: 2 | 3 }
  | { name: "Revenge" }
  | { name: "Indestructible" }
  | { name: "Barrier" }
  | { name: "Deflect" }
  | { name: "Unique" }
  | { name: "Servant" }
  | { name: "Energy-Exhaust" }
  | { name: "Victory Strike" }
  | { name: "Warrior of Universe 7" }
  | { name: "Ultimate" }
  | { name: "Super Combo" }
  | { name: "Dragon Ball" }
  | { name: "Wormhole" }
  | { name: "Invoker" }
  | { name: "Heroic" }
  | { name: "Villainous" }
  | { name: "Offering" }
  | { name: "Evolve"; variant: "Evolve" | "EX-Evolve" | "Xeno-Evolve" }
  | { name: "Union"; variant: "Fusion" | "Potara" | "Absorb" }
  | { name: "Over Realm"; x: number; dark: boolean }
  | { name: "Swap"; x: number }
  | { name: "Arrival"; colors: Color[] }
  | { name: "Aegis"; colors: Color[] }
  | { name: "Alliance"; colors: Color[] }
  | { name: "Revive"; colors: Color[] }
  | { name: "Successor" }
  | { name: "Overlord" }
  | { name: "Rejuvenate" }
  | { name: "Spirit Boost"; x: number }
  | { name: "Empower"; color: Color | null; x: number }
  | { name: "Z-Awaken" }
  | { name: "Z-Stack"; x: number };

/** Every area of 3-1, per player. */
export type Area = "deck" | "hand" | "drop" | "leader" | "battle" | "combo" | "energy" | "life" | "warp" | "unison" | "zDeck" | "zEnergy" | "removed";
export const OPEN_AREAS: Area[] = ["drop", "leader", "battle", "combo", "energy", "warp", "unison", "zEnergy", "removed"];

export type Mode = "active" | "rest";

/** A physical card in the game. `id` is unique per game ("p1#17"); `cardId` is the catalog id. */
export interface CardInstance {
  id: string;
  cardId: string;
  owner: PlayerId;
  /** 1-10: Active/Rest. Meaningful in leader/battle/energy/unison. */
  mode: Mode;
  /** 1-10-2 Hidden Mode: face-down in the Battle/Unison Area, no information (23-5). */
  hidden: boolean;
  /** Leader flipped to its back side (Awaken / Wish). */
  flipped: boolean;
  /**
   * 3-9-2-1: a card in a closed area that a skill turned face up — most often
   * a Life card, and the Z-Deck for the ≪Boujack Brigade≫ cards. It stays
   * where it is and is still taken as damage in its turn, but both players can
   * see it and skills can count it ("if you have 4 or more face-up ≪Boujack
   * Brigade≫ cards in your Z-Deck"). Cleared when the card leaves the area
   * (3-1-4), so a card *placed* face up is marked after it arrives.
   */
  faceUp?: boolean;
  /** Unison markers (1-11). */
  markers: number;
  /** Cards placed under this one (23-2): Evolve/Union stacks, leader stacks. */
  under: string[];
  isToken: boolean;
  /** Turn number this card entered its current open area (for "played this turn" checks). */
  enteredTurn: number;
  /** [X Attack] activations left this turn (22-8). */
  extraAttacks: number;
  /** Skill indexes already resolved this turn under [Once per turn] / [Limit]. */
  usedThisTurn: number[];
  /** 13-4-2: once a marker skill resolves on a card, no marker skill on it can be used again this turn. */
  usedMarkerSkill: boolean;
  /** Skills negated by effects (index list) or all skills. */
  negated: number[] | "all";
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  deck: string[];
  hand: string[];
  drop: string[];
  warp: string[];
  life: string[];
  leader: string;
  battle: string[];
  combo: string[];
  energy: string[];
  unison: string | null;
  zDeck: string[];
  zEnergy: string[];
  removed: string[];
  /** 1-14 energy markers, each worth one energy of the leader's colour. */
  energyMarkers: number;
  mulliganed: boolean;
  /** [Over Realm]/[Dark Over Realm] activations this turn (22-15-7). */
  overRealmsThisTurn: number;
  /** [Z-Awaken] declared this turn (22-46-4). */
  zAwakenedThisTurn: boolean;
  /** Unison growth this turn (13-3-2). */
  grewUnisonThisTurn: boolean;
  /** Damage dealt to this player over the game, for the end screen. */
  damageTaken: number;
}

export type Phase = "setup" | "charge" | "main" | "mainEnd" | "end" | "over";
export type BattleStep = "declared" | "offense" | "defense" | "damage" | "battleEnd";

export interface Battle {
  attacker: string;
  guard: string;
  /** Original target before any [Blocker]. */
  target: string;
  step: BattleStep;
  negated: boolean;
  /** Blocker was already offered for this attack. */
  blockerOffered: boolean;
  /** [Revenge] pending KO of the attacker at battle end. */
  revenge: boolean;
  /** [X Attack]: reactivate the attacker at battle end. */
  reactivate: boolean;
}

/**
 * Things a card can forbid (20-14). 0-2-5 settles every conflict between a
 * prohibition and an instruction: the prohibition wins, so these are checked
 * last and nothing overrules them.
 */
export type ForbiddenAction =
  | "attack"
  | "beAttacked"
  | "block"
  | "play"
  | "activateSkill"
  | "activateCounter"
  | "combo"
  | "beKOd"
  | "beKOdBySkill"
  | "beChosen"
  | "switchToActive"
  | "placeEnergy"
  /** "Can't be removed from a Battle Area by your opponent's skills" (20-14): a move by a skill, not by a battle. */
  | "beMovedBySkill"
  /** "This card's skills can't be negated in any area" (9-1-5). */
  | "beNegated";

export interface Prohibition {
  what: ForbiddenAction;
  /** Whose action is forbidden. Absent means either player's. */
  player?: PlayerId;
  /** Which cards it is about. Absent means any card. */
  filter?: CardFilter;
  /** Cards with this exact name — "you can't play copies of this card". */
  name?: string;
  /**
   * Whether the ban is on a skill doing it or on the player doing it plainly:
   * "this card can't be played by skills from any area" is `true`, "…can't be
   * played from any area except by skills" is `false`, and a bare prohibition
   * leaves it absent and covers both.
   */
  bySkill?: boolean;
}

/**
 * The other direction: a rule that *lifts* one of the game's own restrictions
 * for one card. Only one of them exists, and it is printed on 48 clauses —
 * "This card can attack Battle Cards in Active Mode" (8-1-1, where an attack
 * may otherwise only be declared against a Leader, a Unison, or a **rested**
 * Battle Card).
 *
 * A permission read too widely lets an illegal attack happen, so `filter` is
 * not optional in practice: "can attack Battle Cards **without [Barrier]** in
 * Active Mode" says which active cards, and a clause whose description the
 * parser cannot read fails rather than permitting everything.
 */
export interface Permission {
  what: "attackActive";
  /** Which active cards may be attacked. Absent means any of them. */
  filter?: CardFilter;
}

/**
 * How long something in force lasts, as a client is told it: a continuous
 * effect's duration, or "permanent" for a [Permanent] skill, which holds for
 * as long as its card is where the skill is valid (9-5-1) rather than for any
 * length of time.
 */
export type EffectUntil = ContinuousEffect["until"] | "permanent";

/** A continuous effect (9-9) with a duration. */
export interface ContinuousEffect {
  id: number;
  /** The card it is about; empty for a rule that is about a player, not a card. */
  target: string;
  /**
   * `negateSkill`: one skill of the card, by index in `value` (9-1-5, "negate
   * this skill for the turn"). `negateSkillKind`: every skill of one kind,
   * named by a `SkillKindPrefix` in `value` ("negate that card's [Auto] skill
   * for the turn").
   */
  kind: "power" | "comboPower" | "keyword" | "negateSkills" | "negateSkill" | "negateSkillKind" | "forbid" | "permit" | "cost" | "comboCost";
  value: number | KeywordSkill | SkillKindPrefix;
  /** Set when `kind` is "forbid". */
  forbid?: Prohibition;
  /** Set when `kind` is "permit". */
  permit?: Permission;
  /** "nextTurn" runs through the opponent's whole turn and ends as yours begins. */
  until: "battle" | "turn" | "opponentTurn" | "nextTurn" | "afterNextCharge" | "game";
  /**
   * The card whose skill made it, so a client can say "+5000 power from
   * Kaio-ken" and a refusal can name what forbids it. Absent on effects the
   * engine's own rules create and on games saved before the field existed.
   */
  source?: string;
  /** The turn player when the effect was created, so "for the turn" ends at the right End Phase. */
  ownerTurn: PlayerId;
  /**
   * Whose skill made it. The two turn-relative durations are written from the
   * controller's point of view — "until the end of **your opponent's** turn" —
   * so they are read against this, not against `ownerTurn`, which is only
   * whose turn it happened to be at the time.
   */
  master: PlayerId;
  createdTurn: number;
}

/**
 * Timings a delayed effect can be scheduled for (1-7-2-1-1). Each one is a
 * point the flow already passes through, so nothing new has to be invented to
 * fire them: the drain happens inside that step.
 */
export type DelayTiming = "turnStart" | "mainStart" | "turnEnd" | "turnCleanup" | "battleEnd";

/**
 * Which turn the timing has to come round on. "thisTurn" is the common case —
 * "at the end of the turn" means the turn the skill resolved on, and if that
 * moment has passed the effect never happens.
 */
export type DelayScope = "thisTurn" | "nextTurn" | "yourNextTurn" | "opponentNextTurn";

/**
 * An effect written down now and carried out later (1-7-2-1-1, 1-7-2-2-1).
 *
 * It keeps the variables the program had bound when it was scheduled, so
 * "choose a card; at the end of the turn, KO it" still knows which card — and
 * it keeps `master`, because the delayed part is still that player's effect
 * however many turns later it fires.
 */
export interface DelayedEffect {
  id: number;
  at: DelayTiming;
  scope: DelayScope;
  ops: Op[];
  card: string;
  master: PlayerId;
  vars: Record<string, string[]>;
  subject?: string;
  createdTurn: number;
  /** What to call it in the log and on the board ("at the end of the turn"). */
  label: string;
}

/** An [Auto] skill whose trigger fired, waiting for a checkpoint (0-3-7, 9-6). */
export interface PendingAuto {
  card: string;
  skillIndex: number;
  master: PlayerId;
  /** What fired it, for scripts that need it ("when this card attacks" → the attack). */
  trigger: Trigger;
  /** Trigger context: the card that moved / was KO'd / attacked, when relevant. */
  subject?: string;
}

export type Trigger =
  | "leaderPlaced"
  | "played"
  | "attacks"
  | "attacked"
  | "koed"
  /** This card KO'd another — by battle or by its own skill ("When this card KOs an opponent's Battle Card"). */
  | "kos"
  /**
   * A card of yours being KO'd, watched by the rest of your board, and the
   * same from the other side (21-14). `koed` is the KO'd card's own skill.
   */
  | "yourCardKoed"
  | "opponentCardKoed"
  | "dealtDamage"
  | "chargeStart"
  | "mainStart"
  | "mainEnd"
  | "turnEnd"
  /**
   * 7-1: the same two moments from the other side of the table. "Your turn"
   * on a card is its controller's turn, never the turn player's, so each
   * wording is its own trigger and each is pended for one side only.
   */
  | "opponentTurnEnd"
  | "opponentTurnStart"
  | "battleEnd"
  | "comboed"
  /**
   * Something the *other* player did, watched by every card you have in play:
   * "when your opponent plays a Battle Card", "when your opponent attacks with
   * a Battle Card". The card they played or attacked with is the `subject`, so
   * "that card" and "it" point at it.
   */
  | "opponentPlayed"
  /** Your own side of it: "when your blue ≪God≫ card is played", "when you play a red ≪Android≫ card". */
  | "youPlayed"
  | "opponentAttacks"
  | "opponentCombos"
  /**
   * "When you use a card in a combo", "when you combo" (5-7): your own side of
   * the same moment, watched by your cards in play. `comboed` is the combo
   * card's own skill and fires when it leaves the Combo Area (8-5-8).
   */
  | "youCombo"
  /**
   * "When this card is removed from a Battle Area by a skill" (3-1): a move an
   * effect caused, which the cards themselves distinguish from a KO — they
   * write "or KO'd" when they mean both, and that half is `koed`.
   * `removedByOpponent` is the narrower wording, and by far the commoner one.
   */
  | "removedFromBattle"
  | "removedByOpponent"
  /**
   * The narrower wording: a skill put this card out of a Battle Area **and**
   * it ended in a Drop Area. Not the same as `removedFromBattle`, which is
   * any destination, so a card bounced to the hand is that and not this.
   */
  | "droppedFromBattle"
  /** The same sentence with no cause named, which is every cause: a skill and a battle KO alike. */
  | "leftBattleToDrop"
  /** "When your Leader Card is attacked" printed on a Battle Card (8-1). */
  | "yourLeaderAttacked"
  /** "When you take damage from an opponent's non-keyword skill" and its mirror (21-3). */
  | "youTookDamage"
  | "opponentTookDamage"
  /** "When your life moves to another area", "when your life is placed in your Drop" (3-9). */
  | "lifeLeft"
  /** "When a card evolves into this card" (22-5): this card entered play by [Evolve], not by an ordinary play. */
  | "evolvedInto"
  /** "When your opponent activates a [Counter] skill" (4-3): watched by your cards in play. */
  | "opponentCounter"
  /** "At the start of your opponent's Main Phase" (7-3): the *other* player's cards watch it. */
  | "opponentMainStart"
  /** "When this card activates [Blocker]" (22-4): the block itself, not the attack. */
  | "blockerUsed"
  /** "When this card is switched to Rest Mode by an [Alliance] skill" (22-32-3): the cards rested as the cost. */
  | "restedByAlliance"
  /** "When this card is switched to Rest Mode by one of your skills" (1-10). */
  | "restedBySkill"
  /** The other end of it: your skill resting one of theirs (1-10). */
  | "restedTheirsBySkill"
  /**
   * A keyword skill being used, watched by that player's cards in play:
   * "when you activate a [Union] skill" (22-13), "…an [Overlord] skill"
   * (22-40), "when you play a Battle Card using [Over Realm]" (22-15).
   * The card that did it is the `subject`.
   */
  | "unionActivated"
  | "overlordActivated"
  | "overRealmPlayed"
  /** "When this card is added to your Z-Energy" (17-3). */
  | "addedToZEnergy"
  /**
   * A card *placed* in a Battle Area rather than played (5-5): by a skill, by
   * [Over Realm], by an Evolve. "When this card is played" does not cover it,
   * and 30 cards say only the second.
   */
  | "placed"
  | "energyToDrop"
  | "unisonToDrop"
  | "markerRemoved"
  /**
   * "When you remove a marker from this card using a [Spirit Boost] skill"
   * (22-43-3): the *cost* being paid, watched by the Unison it came off and by
   * that player's cards in play. An attack taking markers off is `markerRemoved`
   * and not this.
   */
  | "spiritBoostPaid"
  /** "When a card in your life is flipped face up" (3-9-2-1). */
  | "flippedFaceUp"
  | "offenseStart"
  | "defenseStart"
  | "damageStart";

/** What the engine is waiting for. Exactly one player is asked at a time. */
export type Prompt =
  | { kind: "chooseFirst"; player: PlayerId }
  | { kind: "mulligan"; player: PlayerId }
  | { kind: "charge"; player: PlayerId }
  | { kind: "main"; player: PlayerId }
  | { kind: "combo"; player: PlayerId; side: "offense" | "defense" }
  | { kind: "blocker"; player: PlayerId; candidates: string[] }
  | { kind: "counter"; player: PlayerId; window: CounterWindow; candidates: string[] }
  | { kind: "orderPending"; player: PlayerId; candidates: number[] }
  | { kind: "chooseCards"; player: PlayerId; choice: CardChoice }
  /** "Choose one— ・A ・B" (20-2): which printed option is taken. */
  | { kind: "chooseMode"; player: PlayerId; reason: string; options: string[] }
  | { kind: "zEnergyFromCombo"; player: PlayerId; candidates: string[] }
  /**
   * An [Auto] skill whose cost the master may decline to pay (9-6-4). Costs
   * that are really conditions ("if your Leader is red") are not asked about —
   * 9-6-4-1-1 says those cannot be declined.
   */
  | { kind: "optionalCost"; player: PlayerId; card: string; skillIndex: number; describe: string }
  /**
   * Which energy to rest. Only asked when the choice can matter: when the
   * colours left active afterwards would differ (3-8-2).
   */
  | { kind: "payCost"; player: PlayerId; action: Action; options: Payment[]; describe: string }
  | { kind: "offering"; player: PlayerId; card: string }
  /** A skill the compiler could not read; Claude answers with a program in the effect language. */
  | { kind: "referee"; player: PlayerId; request: RefereeRequest }
  | { kind: "gameOver" };

export interface RefereeRequest {
  card: string;
  cardId: string;
  cardName: string;
  skillIndex: number;
  /** The printed skill line, verbatim. */
  text: string;
  /** The clauses the compiler could not read. */
  unsupported: string[];
  master: PlayerId;
  trigger?: Trigger;
}

export type CounterWindow = "play" | "attack" | "battleCardAttack" | "counter" | "skill";

/** A target choice an effect needs (5-2). */
export interface CardChoice {
  /** Why we're asking, shown in the prompt bar. */
  reason: string;
  candidates: string[];
  min: number;
  max: number;
  /** Continuation id the engine resolves when the choice comes back. */
  continuation: string;
  /**
   * 22-30-3: the cards picked must between them cover every one of these
   * colours. Covering is a *condition of activating* [Aegis], not something a
   * player can get wrong, so the engine narrows what it offers as the picks
   * come in rather than letting a wrong pair be chosen and eat the cost.
   */
  cover?: Color[];
}

/** Everything a player can do, as sent to `apply()`. */
export type Action =
  | { type: "chooseFirst"; player: PlayerId; first: PlayerId }
  | { type: "mulligan"; player: PlayerId; redraw: boolean }
  | { type: "charge"; player: PlayerId; card: string | null }
  /** `x` is the value the master picks for an X cost (1-2-2-2-1). */
  | { type: "play"; player: PlayerId; card: string; x?: number; pay?: string[]; alt?: boolean }
  | { type: "playUnison"; player: PlayerId; card: string; x: number; pay?: string[] }
  | { type: "playZ"; player: PlayerId; card: string; x?: number; pay?: string[] }
  | { type: "growUnison"; player: PlayerId; card: string }
  /** `alt`: pay the printed alternative instead of the energy cost ([Invoker], 22-37). */
  | { type: "activate"; player: PlayerId; card: string; skill: number; pay?: string[]; alt?: boolean }
  | { type: "attack"; player: PlayerId; attacker: string; target: string }
  | { type: "endMain"; player: PlayerId }
  | { type: "combo"; player: PlayerId; card: string; pay?: string[] }
  | { type: "pass"; player: PlayerId }
  | { type: "block"; player: PlayerId; card: string | null }
  /** `alt` pays the other cost the card prints instead of its energy cost (5-3). */
  | { type: "counter"; player: PlayerId; card: string | null; skill?: number; pay?: string[]; alt?: boolean }
  | { type: "orderPending"; player: PlayerId; index: number }
  | { type: "optionalCost"; player: PlayerId; pay: boolean }
  | { type: "payCost"; player: PlayerId; option: number }
  | { type: "choose"; player: PlayerId; cards: string[] }
  | { type: "chooseMode"; player: PlayerId; index: number }
  | { type: "zEnergyFromCombo"; player: PlayerId; card: string | null }
  | { type: "offering"; player: PlayerId; dropLife: boolean }
  /** The referee's answer: a program in the effect language, or an empty one for "nothing happens". */
  | { type: "refereeRuling"; player: PlayerId; ops: Op[] }
  | { type: "concede"; player: PlayerId };

/** Append-only log; the UI animates from these and a replay folds them. */
export type GameEvent =
  | { type: "gameStart"; first: PlayerId; seed: number }
  | { type: "action"; action: Action }
  | { type: "phase"; phase: Phase; player: PlayerId; turn: number }
  | { type: "move"; card: string; from: Area; to: Area; owner: PlayerId; index?: number; reveal?: boolean }
  | { type: "draw"; player: PlayerId; card: string }
  | { type: "mode"; card: string; mode: Mode }
  | { type: "flip"; card: string; flipped: boolean }
  | { type: "hidden"; card: string; hidden: boolean }
  | { type: "markers"; card: string; delta: number; total: number }
  | { type: "energyMarker"; player: PlayerId; delta: number }
  | { type: "attack"; attacker: string; target: string }
  | { type: "guardChanged"; guard: string; by: string }
  | { type: "battleStep"; step: BattleStep }
  | { type: "powerCompare"; attacker: string; guard: string; attackPower: number; guardPower: number; hit: boolean }
  | { type: "damage"; player: PlayerId; amount: number; critical: boolean; cards: string[] }
  | { type: "ko"; card: string; by?: string }
  | { type: "attackNegated" }
  | { type: "skill"; card: string; skill: number; master: PlayerId; text: string }
  | { type: "effect"; effect: ContinuousEffect }
  /** A continuous effect reaching the end of its duration (9-9): the other end of `effect`. */
  | { type: "effectEnded"; effect: ContinuousEffect }
  /** An effect written down for later; `label` is the timing in plain words. */
  | { type: "delayed"; card: string; label: string }
  | { type: "token"; card: string; owner: PlayerId }
  | { type: "stack"; top: string; under: string[] }
  | { type: "note"; text: string }
  | { type: "gameOver"; winner: PlayerId | null; reason: string };

export interface GameState {
  seed: number;
  /** RNG state advances with every shuffle so replays are exact. */
  rngState: number;
  turn: number;
  turnPlayer: PlayerId;
  firstPlayer: PlayerId;
  phase: Phase;
  battle: Battle | null;
  players: Record<PlayerId, PlayerState>;
  cards: Record<string, CardInstance>;
  effects: ContinuousEffect[];
  nextEffectId: number;
  /** Effects waiting for a later timing (1-7-2-1-1); drained by `fireDelayed`. */
  delayed: DelayedEffect[];
  nextDelayedId: number;
  pending: PendingAuto[];
  prompt: Prompt;
  /** Counter timing bookkeeping: the action waiting behind the window. */
  counterStack: CounterFrame[];
  winner: PlayerId | null;
  overReason: string | null;
  /** The card that is in the middle of being played/activated, for [Counter: Play]. */
  resolving: { card: string; skill?: number; player: PlayerId } | null;
  /** Opaque continuation data for multi-step effects (choices). */
  continuations: Record<string, unknown>;
  /** Steps still to run before the next decision is needed. */
  flow: FlowStep[];
  /** Answer to the current chooseCards prompt, consumed by the next step. */
  lastChoice: string[] | null;
  /** Answer to the current chooseMode prompt, consumed by the next step. */
  lastMode: number | null;
}

export interface CounterFrame {
  window: CounterWindow;
  /** Who may counter (the non-acting player). */
  responder: PlayerId;
  /** What to do after the window closes without a negation. */
  then: string;
  negated: boolean;
}

/**
 * The engine's program counter. Every step is data so a game can be stored
 * mid-prompt and resumed: `run()` executes steps from the front until one
 * needs a player's decision, the action handler then pushes the steps that
 * follow. Sub-flows are spliced in at the front.
 */
export type FlowStep =
  | { op: "checkpoint" }
  | { op: "auto.resolve"; pending: PendingAuto }
  | { op: "setup.afterFirst" }
  | { op: "setup.mulligan"; player: PlayerId }
  | { op: "setup.finish" }
  | { op: "turn.start" }
  | { op: "turn.activeAll" }
  | { op: "turn.draw" }
  | { op: "turn.promptCharge" }
  | { op: "turn.mainStart" }
  | { op: "turn.promptMain" }
  | { op: "turn.mainEnd" }
  | { op: "turn.endPhase" }
  | { op: "turn.cleanup" }
  | { op: "turn.next" }
  | { op: "counter"; window: CounterWindow; responder: PlayerId }
  /**
   * A counter that has been paid for and is waiting to resolve (9-7-3). It
   * sits under the window that offers the answer to it, so a counter played in
   * response resolves first — and can mark this one negated on its way past.
   */
  | { op: "counter.resolve"; card: string; skill: number; player: PlayerId; negated?: boolean }
  | { op: "play.resolve"; card: string; player: PlayerId; markers?: number; mode?: "active" | "rest"; onto?: string; negated?: "turn" | "game" }
  | { op: "script.step"; frame: ScriptFrame }
  | { op: "flipLeader"; card: string }
  | { op: "skill.resolve"; card: string; skill: number; player: PlayerId; trigger?: Trigger }
  | { op: "extra.finish"; card: string }
  | { op: "battle.afterDeclare" }
  | { op: "battle.blocker" }
  | { op: "battle.offense" }
  | { op: "battle.promptCombo"; side: "offense" | "defense" }
  | { op: "battle.defense" }
  | { op: "battle.damage" }
  | { op: "battle.end" }
  | { op: "battle.zEnergy"; player: PlayerId }
  | { op: "battle.cleanup" }
  | { op: "prompt"; prompt: Prompt }
  | { op: "zstack.place"; card: string; player: PlayerId }
  | { op: "choose.apply"; what: "zstack" | "evolve" | "union" | "swap" | "successor" | "aegis" | "aegisEnergy" | "revive" | "alliance"; card: string; player: PlayerId };

/**
 * Why a move the player might expect is not on the menu
 * (`docs/arena-workflow-spec.md` §3.1).
 *
 * A closed vocabulary rather than a sentence: the client renders the words,
 * so the wording lives in one place, a phone and a watch can phrase it
 * differently, and a translation is a translation rather than a fork. `other`
 * is the pressure valve, and every use of it is a sentence no client can style
 * or count — a growing number of them is the signal to add a kind.
 */
export type Requirement =
  /** Costs `need` energy; `have` counts active energy plus energy markers. */
  | { kind: "energy"; need: number; have: number }
  /** The cost asks for `need` orbs of this colour and only `have` are active. */
  | { kind: "energyColour"; colour: string; need: number; have: number }
  /**
   * The card is in the wrong mode — resting, so it cannot attack or combo.
   * `locked` when a rule keeps it from standing up at the next Charge Phase,
   * so the client does not promise a remedy the rules will not deliver.
   */
  | { kind: "mode"; card: string; mode: Mode; locked?: boolean }
  /** Not now: `window` is when it *would* be allowed ("main", "battle", "defense", "nextTurn"). */
  | { kind: "timing"; window: string }
  /**
   * Already done this turn: a charge, Unison growth, a [Once per turn] skill.
   * `limit` is the printed [Limit X] when that is the rule rather than
   * [Once per turn] (22-44), so the client can name the right tag.
   */
  | { kind: "oncePerTurn"; what: string; limit?: number }
  /** The card is not where the move needs it to be; `area` is where it would have to be. */
  | { kind: "zone"; card: string; area: Area }
  /** The move wants a different kind of card — "a Battle Card". */
  | { kind: "cardType"; card: string; needs: string }
  /** Nothing legal to point at. */
  | { kind: "target"; reason: string }
  /**
   * A skill in play forbids it (`forbids()`); `by` names the card when a card
   * is the source. `until` is how long the rule holds — an effect's duration,
   * or "permanent" while the source card's [Permanent] skill is valid.
   */
  | { kind: "forbidden"; by: string | null; until?: EffectUntil }
  /** The compiler cannot read the card's text, so the engine cannot offer it. */
  | { kind: "unread"; card: string }
  /** A printed condition of the skill that does not hold yet — "When your life is at 4 or less". */
  | { kind: "condition"; text: string }
  | { kind: "other"; detail: string };

/** A move the player was reaching for, and every reason it is not on the menu. */
export interface RejectedAction {
  /** The action the player was reaching for, in the same shape as a legal one. */
  action: Action;
  /** What the label would have been, so a client can show the move it cannot make. */
  label: string;
  /** Every requirement that failed, most decisive first. Never empty. */
  why: Requirement[];
}

/** Output of `apply`. */
export interface Applied {
  state: GameState;
  events: GameEvent[];
}

/** Human-readable card face, used by the UI and by Claude's view builder. */
export interface CardFace {
  name: string;
  power: number | null;
  skill: string | null;
}
