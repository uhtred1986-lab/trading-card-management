/**
 * The effect language and its interpreter.
 *
 * A card's skill text is turned into a small program of `Op`s — by the
 * deterministic compiler in `compile.ts`, or, when that fails, by Claude at
 * runtime (the referee, which answers in this same language). The interpreter
 * executes a program step by step inside the engine's flow, so an effect that
 * needs a choice can stop, ask, and resume.
 *
 * Nothing here reads card text. Section numbers refer to the Rule Manual.
 */
import { skillsOf } from "./cards";
import type { CardFilter } from "./filters";
import { describeCond, describeScript } from "./script-schema";
import {
  addEffect,
  amount,
  condHolds,
  resolveRef,
  resolveSelector,
  sideOf,
  areaOf,
  cardNow,
  cardsInPlay,
  replacementChoicesFor,
  skillsOfInstance,
  def,
  draw as drawCards,
  face,
  forbids,
  has,
  move,
  note,
  placeUnder,
  schedule,
  setMode,
  tokenCardId,
  type AltCost,
  type GameContext,
} from "./state";
import { koCard, masterOf, pendTriggers } from "./triggers";
import type { Area, Color, DelayScope, DelayTiming, FlowStep, ForbiddenAction, GameEvent, GameState, KeywordSkill, MoveReason, PlayerId, ReplacementChoice, ReplacementResult, Skill, SkillKindPrefix, Trigger } from "./types";

// ── the language ───────────────────────────────────────────────────────────

/** Areas a selector can read. "under" is the cards beneath the source card (23-2). */
export type ScriptArea = "hand" | "deck" | "drop" | "life" | "battle" | "combo" | "energy" | "unison" | "leader" | "warp" | "zDeck" | "zEnergy" | "under" | "play" | "removed";

export type Side = "you" | "opponent" | "both";

/**
 * `afterNextCharge` outlives `nextTurn` by one step: "the chosen card will not
 * switch to Active Mode during your next Charge Phase" (7-2-7) has to still be
 * there when the Active Step runs, and `nextTurn` ends just before it.
 */
export type Duration = "battle" | "turn" | "opponentTurn" | "nextTurn" | "afterNextCharge" | "game";

/**
 * Cards the source skill can point at without choosing: itself, the battle
 * roles, the trigger's subject, `resolving` — the card whose play a
 * [Counter: Play] is answering ("if the Battle Card being played has an energy
 * cost of 7 or less") — and `onTop`, the card this one is under.
 *
 * `onTop` is the other half of the `under` area (23-2). A stack is one card
 * with a pile beneath it, so the card "on top of this card" is the single card
 * whose pile holds this one, whichever area the stack stands in
 * (23-2-2-2) — and it is a *different* card from the one asking (23-2-2-3),
 * which is the whole point: fourteen [Permanent]s printed on the buried card
 * grant a keyword or power to the card above, and until 9 Sep 2026 every one
 * of them read as *this card* and granted it to itself.
 */
export type SpecialTarget = "self" | "attacker" | "guard" | "subject" | "leader" | "opponentLeader" | "resolving" | "onTop";

export interface Selector {
  side?: Side;
  area?: ScriptArea;
  /**
   * More than one area, for the wordings that name two: "your opponent's
   * Battle Cards or Unisons". One area is the common case and stays in
   * `area`; this is read instead of it when present.
   */
  areas?: ScriptArea[];
  filter?: CardFilter;
  special?: SpecialTarget;
  /** Only cards in this mode (1-10). */
  mode?: "active" | "rest";
  /**
   * Only Hidden Mode cards, or (`false`) only Revealed Mode ones (23-5). A
   * face-down card has none of its front-side information (23-5-2), so this
   * is the one measure a Hidden Mode selector can carry — the compiler never
   * pairs it with `filter`, and `resolveSelector` does not try to check one
   * against a card it cannot read.
   */
  hidden?: boolean;
  /** Draw the candidates from a bound variable instead of an area. */
  fromVar?: string;
  /**
   * For `area: "under"`, whose pile that is: "from under your <Kefla> Battle
   * Card", "from under your Leader Card". Absent means this card's own pile.
   */
  underHost?: Selector;
  /** How many to take. `upTo` allows zero (5-2-4). */
  count?: number;
  upTo?: boolean;
  /**
   * "The top card of your deck": the first `take` cards of the area in its own
   * order, not a choice among them. `count` never means this — a count is
   * always a choice (5-2) — so the two must not be confused.
   */
  take?: number;
  /** With `take`, count from the far end: "the bottom card of your deck". */
  fromEnd?: boolean;
  /** Card text may say "ignoring [Barrier]", which lifts 22-16 for this choice. */
  ignoreBarrier?: boolean;
  /**
   * "Choose all Battle Cards **other than this card**", "play up to 1 ≪Demon
   * Clan≫ card among them **other than copies of this card**". Refusing to
   * *resolve* to this card is only half of it: read as nothing, the phrase
   * still offered this card among the candidates, so "they get -15000 power"
   * hit the card printing it. `"copies"` excludes every card of the same
   * name, which is what that longer wording says.
   */
  notSelf?: "card" | "copies";
}

/**
 * One number a card can say about another: the measures an amount may read off
 * a card rather than off the board. The printed energy cost is the one the card
 * costs *now* (20-21-2), not the one on the face, because every other reading
 * of a cost in this engine is the reduced one and two answers to "its energy
 * cost" would be a bug waiting for a [Permanent] to find.
 */
export type AmountAttr = "power" | "comboPower" | "energyCost" | "comboCost";

/**
 * A number an effect needs — an *expression*, since 12 Sep 2026 (20-5).
 *
 * `count` is read off the board — "for each of your ≪Saiyan≫ cards" — and
 * `times` multiplies it, because cards say "+5000 power for each" far more
 * often than they say "1 for each". `times` is now on every shape that reads a
 * number out of the game, so "X × 1000" and "its energy cost × 1000" need no
 * second spelling.
 *
 * Every shape that was here before 20-5 is still spelled exactly as it was:
 * stored `card_rules.ops` rows carry these keys, so nothing here may be
 * renamed and nothing may change meaning. The new shapes are additions.
 */
export type Amount =
  | number
  | { var: string }
  | { count: Selector; times?: number }
  /** The total power of the cards bound to a name — "the cards switched to Rest Mode by this skill" ([Alliance], 22-32). The special case of `sumOf` that predates it, kept because rows spell it this way. */
  | { sumPower: { var: string } }
  /** "Draw cards until you have 4 cards in your hand": however many that takes, never fewer than none. */
  | { handUpTo: number }
  /** "For each marker on this card, +5000 power" — the markers on the selected cards, added up, the same board fact the `markers` condition asks about. */
  | { markers: Selector; times?: number }
  /**
   * X: the number chosen when the skill was paid for (20-5). Read off the
   * script frame, which the activation puts it on; a program that says `X`
   * with nothing to bind it fails `validateProgram` rather than resolving as
   * zero, because "draw X cards" for free is the one wrong answer.
   */
  | { x: true; times?: number }
  /** "For each card in your life area" — the life cards of one side, or both. */
  | { life: Side; times?: number }
  /** "Power equal to that card's energy cost × 1000" — one card's own measure, times a printed number. */
  | { attr: Ref; name: AmountAttr; times?: number }
  /** "Power equal to the total combo power of the cards discarded by this skill" — the same measure over every selected card, added up. */
  | { sumOf: Selector; attr: AmountAttr; times?: number }
  /** "That many plus 1". The right-hand side is a printed number: no card adds two board readings together, and allowing it would make the printed form ambiguous. */
  | { plus: [Amount, number] };

/**
 * `minus` is "the rest": the cards bound to `var` that a later choice did not
 * take — "look at the top 3 cards of your deck, add 1 of them to your hand and
 * place the rest at the bottom of your deck".
 */
export type Ref = { var: string; minus?: string } | { sel: Selector };

export type Cond =
  | { kind: "count"; sel: Selector; atLeast?: number; atMost?: number }
  | { kind: "life"; side: Side; atLeast?: number; atMost?: number }
  /** "When your life is less than or equal to your opponent's life" — the two counts against each other. */
  | { kind: "lifeVsOpponent"; atMost?: boolean; atLeast?: boolean }
  | { kind: "leaderColor"; color: Color }
  /** "If your Leader is a <Baby> card" — colour, character name and traits alike. */
  | { kind: "leaderMatches"; filter: CardFilter; side?: Side; back?: boolean }
  /** "If this card has 3 or more markers on it" (13-2): the markers on the selected cards, added up. */
  | { kind: "markers"; sel: Selector; atLeast?: number; atMost?: number }
  /**
   * "If this card is in a battle" (8-1): any of the selected cards is the
   * attacker or the guard. `role` narrows it to one end of the battle — "if
   * one of your yellow Battle Cards **is being attacked**" (BT4-085) is about
   * the guard card, and a card of yours doing the attacking is not that.
   */
  | { kind: "inBattle"; sel: Selector; not?: boolean; role?: "attacker" | "guard" }
  /**
   * "If this card participated in a battle …" (BT3-103): the past tense of
   * `inBattle`, and a different question. A card is only an attack or guard
   * card until the battle ends (8-1-2-2), and this is asked at the end of one
   * — by which time `s.battle` says nothing — so it reads the card's own
   * memory, which lasts the turn. Whose turn it was is asked separately.
   */
  | { kind: "battled"; sel: Selector }
  /**
   * "If **all** of your opponent's energy is in Rest Mode" (XD1-01): every card
   * `sel` finds is also one that `matching` finds. Two selectors rather than a
   * filter, because what the sentence asks about is as often the *mode* of a
   * card as anything in its text, and mode lives on the selector.
   *
   * With nothing to find it is **false**, not vacuously true: 0-2-4-1 does not
   * count a state as reached when there is no object to reach it, and the other
   * reading fires the skill on an opening turn where the opponent has no
   * energy at all.
   */
  | { kind: "every"; sel: Selector; matching: Selector }
  /** "When your life is at 4 or less, or you have 5 or more energy" — one of several; "all" is every one of them. */
  | { kind: "any"; conds: Cond[] }
  | { kind: "all"; conds: Cond[] }
  /** "If your opponent's Leader Card's back is facing up" — the Leader has awakened (22-2). */
  | { kind: "leaderFlipped"; side?: Side; flipped?: boolean }
  /** "If this card's power is 30000 or more" — any of the selected cards, as it stands now. */
  | { kind: "power"; sel: Selector; atLeast?: number; atMost?: number }
  /** "If you added a card to your hand", "if you played a card" — whether an earlier step of this same skill did that. */
  | { kind: "did"; what: "addToHand" | "play" | "negateAttack" | "negateLeaderAttack" | "ko" | "draw" | "may" }
  /** "If you don't" (20-16): the opposite of a condition. */
  | { kind: "not"; cond: Cond }
  /**
   * "If you do so" (20-16): whether an earlier choice of this same skill was
   * answered. `atLeast` is how many it had to take — a price of 2 cards is not
   * paid by giving one, and an “up to” choice is the only way to decline, so
   * the two readings have to be told apart. Defaults to 1.
   */
  | { kind: "chose"; var: string; atLeast?: number }
  /** "If that card is a Battle Card": what a reveal or a look turned up (20-11). */
  | { kind: "varMatches"; var: string; filter: CardFilter }
  /** Whose turn it is (7-1). "opponent" is "during your opponent's turn". */
  | { kind: "isTurnPlayer"; who?: "you" | "opponent" };

/**
 * The attributes `modifyAttr` may change: the two numbers a continuous effect
 * carries, and the four lists a card *also counts as* (20-1). Mode, markers,
 * face-up and the rest are attributes too, but they are the spellings' own
 * ops until Stage 3 declares the attribute list (`docs/arena-ruleset-spec.md`
 * §2.5); adding one here without a case below would be a field that lies.
 */
export type CardAttr = "power" | "comboPower" | "colors" | "characters" | "traits" | "names";

export type Op =
  | { op: "draw"; n: Amount; side?: Side }
  /** Cards leave a hand, chosen by its owner (20-7); `to: "warp"` for "sends 1 card from their hand to their Warp". */
  | { op: "discard"; n: Amount; side?: Side; to?: "warp" }
  | { op: "damage"; n: Amount; side?: Side }
  /**
   * `as` names the cards that went to the Drop, so a later clause can ask
   * about them: "place up to 1 card from the top of your deck in the Drop
   * Area. **If that card is red**, this card gains +5000 power" (BT2-001).
   * They land face up, so this is a card both players have seen — the same
   * footing as a `reveal`, which is why "that card" reads the two alike.
   */
  | { op: "mill"; n: Amount; side?: Side; as?: string }
  | { op: "addLife"; n: Amount; side?: Side }
  /** "Add cards from your life to your hand until you have N life" (21-3-2 wording, without damage). */
  | { op: "lifeDownTo"; n: number; side?: Side }
  | { op: "shuffle"; side?: Side }
  | { op: "energyMarker"; n: Amount; side?: Side }
  /**
   * `chooser` is who answers, when that is not the player whose skill this is:
   * "your opponent sends 1 Battle Card from their Drop Area to their Warp"
   * (20-7) is their choice to make, not yours.
   */
  /** `bindX` binds X to *how many* were chosen, for the cards whose price is a choice and whose effect then counts it ("discard any number of cards: … X cards", 20-5). */
  | { op: "choose"; sel: Selector; as: string; reason?: string; chooser?: Side; bindX?: true }
  /** `from` is the top of the deck unless the card says the bottom. */
  /** `area` is the deck unless it says otherwise — "look at your opponent's hand" (20-11). */
  | { op: "look"; n: Amount; as: string; side?: Side; from?: "top" | "bottom"; area?: ScriptArea }
  /**
   * "Reveal the top card of your opponent's deck" (20-11-2): both players see
   * it, so the name is logged, and the cards stay where they are — bound to
   * `as` for the clauses that act on what was seen.
   */
  | { op: "reveal"; sel: Selector; as: string }
  | { op: "ko"; target: Ref }
  /** `to: "under"` puts the card under `under`, or under the source card (23-2). */
  /**
   * `owner` overrides whose area the card lands in — "place it in your
   * opponent's energy in Rest Mode" (3-8) puts a card the opponent owns into
   * the *other* player's energy. Left out, a card goes to its own owner's
   * area, which is what nearly every move means.
   */
  | { op: "moveTo"; target: Ref; to: ScriptArea; position?: "top" | "bottom"; mode?: "active" | "rest"; reveal?: boolean; under?: Ref; owner?: Side; faceUp?: boolean }
  /**
   * `onto` plays the card on top of another, which is how [Union-Absorb]
   * resolves (22-13-6-3) and how the "play … on top of this card" wordings
   * read. Without it the card is played beside the host instead of onto it.
   */
  /** `negated` is "played … with its skills negated" (9-1-5), for the turn or for as long as it is in play. */
  | { op: "play"; target: Ref; mode?: "active" | "rest"; onto?: Ref; negated?: "turn" | "game" }
  | { op: "switchMode"; target: Ref; mode: "active" | "rest" }
  /**
   * The primitive under `power`, `comboPower` and `gains`
   * (`docs/arena-ruleset-spec.md` §2.3): one attribute of one card, by a
   * delta (`amount`, for the two numbers) or by the values it also counts as
   * (`values`, for the four lists), for a duration or — printed as a
   * [Permanent] — for as long as the rule holds.
   *
   * The three short spellings below are kept and are still what the compiler
   * writes, so no stored record changes and no card's reading moves; Stage 3
   * re-declares them over this row as macros (#137). A list attribute is read
   * wherever the card is, like the `gains` it stands for, so it is collected
   * by the static layer (`collectStatics`, state.ts) rather than applied when
   * a skill resolves.
   */
  | { op: "modifyAttr"; target?: Ref; attr: CardAttr; amount?: Amount; values?: string[]; until?: Duration }
  | { op: "power"; target: Ref; amount: Amount; until: Duration }
  | { op: "comboPower"; target: Ref; amount: Amount; until: Duration }
  | { op: "grant"; target: Ref; keyword: KeywordSkill; until: Duration }
  /**
   * 20-18: one card takes on another's printed skills — "choose up to 1
   * keyword skill on a card placed under this card, and this card gains that
   * skill until the end of your opponent's next turn" (BT20-028), "gain all of
   * the chosen card's skills for the duration of the turn" (BT3-049).
   *
   * `from` is the card copied. Which of its skills is said in one of three
   * ways: `which: "all"` for every one of them, `skill` for a single source
   * index, or neither — the wording nearly every card prints — to let the
   * master pick one as the skill resolves. `only: "keyword"` narrows both the
   * pick and the copy to keyword skills, which is what "choose up to 1
   * **keyword** skill" says.
   *
   * What is copied is the printed face as it stands now, snapshotted onto the
   * effect: 9-9 fixes what a continuous effect grants when it is created, so
   * the copy survives the source being flipped, silenced, or leaving play.
   * A card that prints the skill it gives in full and in quotes (16 of them,
   * BT18-008 the clearest) is the same mechanism with the program written on
   * the granting card instead of snapshotted off another one, and belongs here
   * as an inline program rather than on `grant` as a text field — `grant`
   * makes a keyword effect, and a quoted [Auto] is not a keyword. Not built.
   *
   * A copied *pure* keyword skill is granted as a keyword — 20-18-1 writes a
   * keyword given by a skill exactly as it writes any other, and the engine
   * already plays a granted keyword — so only typed lines become a copy the
   * target has to enumerate.
   */
  | { op: "copySkills"; target?: Ref; from: Ref; which?: "all"; skill?: number; only?: "keyword"; until: Duration }
  | { op: "negateSkills"; target: Ref; until: Duration }
  /**
   * "Negate that card's [Auto] skill for the turn" (9-1-5): one kind of skill
   * rather than all of them. The printed tag is a prefix of `SkillKind`, so a
   * bare "[Counter]" covers every counter kind.
   */
  | { op: "negateSkillsOfKind"; target: Ref; kind: SkillKindPrefix; until: Duration }
  /** 23-5: "switch it to Hidden Mode" / "switch it to Revealed Mode" — Battle Cards in the Battle Area only. */
  | { op: "hidden"; target: Ref; hidden: boolean }
  /** "Switch the target of the attack to it" — the card becomes the guard, as a [Blocker] would (22-4-2). */
  | { op: "redirectAttack"; target: Ref }
  /**
   * "Use up to 1 card with 5000 combo power from your Drop in a combo (with
   * its skills negated)" — into your Combo Area during a battle, for no combo
   * cost (5-7); it leaves with the other combo cards at the end of the battle.
   */
  | { op: "comboFrom"; target: Ref; negated?: boolean }
  /** "You may flip this card over" — a Leader awakens by a skill other than its [Awaken] (22-2-4). */
  | { op: "flip"; target: Ref }
  /**
   * "Flip up to 1 card in your life face up" (3-9-2-1). The Life Area is
   * secret; a card turned face up in it is treated as being in an open area,
   * which is what lets "face-up ≪Boujack Brigade≫ cards" find it.
   */
  | { op: "faceUp"; target: Ref; faceUp?: boolean }
  | { op: "addMarker"; target: Ref; n: Amount }
  | { op: "removeMarker"; target: Ref; n: Amount }
  | { op: "token"; name: string; power: number; comboCost: number | null; comboPower: number | null; colors: Color[]; n: Amount; side?: Side }
  /**
   * A [Permanent] cost reducer, applied while the card sits where the skill
   * says (9-1-3-3). `what` says which cost: the energy cost by default, the
   * combo cost (5-7-3), a skill/evolve cost paid as orbs, the Z-Energy cost
   * (5-4) a Z-Card pays out of the Z-Energy Area rather than the hand, or the
   * **specified** (coloured) part of an X-cost card's price — owner's ruling
   * on BT19-039, 9 Sep 2026,
   * validated against 13-2-1-3/20-21-2: this relaxes only which colours the
   * card demands ("2 blue" down to "1 blue"), never the total, so `playCost`
   * keeps it apart from an ordinary reduction rather than folding it into the
   * same number. `colors` then carries the orbs it relaxes — printed as
   * `{u}`/`{y}{y}`/… and never a bare count, since a specified-cost change
   * with no colour would say nothing.
   */
  /**
   * 20-21. On a [Permanent] this is a standing effect and `collectStatics`
   * emits it; `until` is then the "game" every [Permanent] op carries and is
   * not read. On any other skill the same sentence is a *timed* change —
   * "reduce the combo cost of blue and yellow ≪Universe 6≫ cards in your hand
   * by 1 **for the duration of the turn**" (XD1-05) — and the interpreter puts
   * it in force for that long.
   */
  | {
      op: "costReduction";
      target: Ref;
      amount: Amount;
      what?: "energy" | "skill" | "evolve" | "combo" | "zEnergy" | "specified";
      colors?: (Color | "any")[];
      skillKind?: SkillKindPrefix;
      until?: Duration;
    }
  /**
   * Take a keyword skill away from a card (9-1-5). Unlike `negateSkills`, which
   * silences everything, this names one — "negate this card's
   * [Energy-Exhaust] skill in all areas".
   */
  | { op: "negateKeyword"; keyword: KeywordSkill["name"]; target?: Ref }
  /**
   * 20-1: the card counts as having these too, wherever it is — "this card
   * gains ≪Saiyan≫ in all areas", "this card is also treated as red". It is
   * read by every rule that looks at what a card *is*, not by the ones that
   * look at what it does.
   */
  | { op: "gains"; traits?: string[]; characters?: string[]; colors?: Color[]; names?: string[]; target?: Ref }
  /**
   * 9-10: where this card goes instead, when it would leave the Battle Area.
   * `by: "skill"` narrows it to departures a skill caused.
   */
  | { op: "replaceLeave"; to: ScriptArea; by?: "skill" | "ko" | "skillOrKo"; mode?: "active" | "rest"; optional?: boolean; target?: Ref }
  /**
   * Another way to pay for a card's own [Counter] skill (5-3): for nothing, by
   * adding cards from your life to your hand, by a reduced energy price
   * (`orbs`), or by an action price (`ops`). Read from the hand, like a cost
   * reducer, because that is where the skill says it applies.
   *
   * Printed on the card itself this is `[Permanent]`-only and about that card
   * (no `target`, no `until` — see `collectStatics`). A card can also grant it
   * to *other* cards for a stated span — "Until the start of your next turn,
   * you can activate mono-blue cards with [Counter] skills from your hand by
   * …" (BT11-033) — which is what `target` and `until` are for: read off a
   * live `Ref` and expiring like any other continuous effect, rather than
   * defaulting to the source card and holding forever.
   */
  | {
      op: "altCost";
      pay: "none" | "life" | "program" | "energy";
      n?: number;
      for?: "counter" | "play";
      /** The price to run, for `pay: "program"` — an action the card asks for instead of the energy cost (5-3). */
      ops?: Op[];
      /** The reduced energy price, one entry per orb, for `pay: "energy"` — "by paying {1}" is `["any"]` (BT18-088). */
      orbs?: (Color | "any")[];
      /** Omit for "this card"; a filter offers the alternative to other cards it names. */
      target?: Ref;
      /** Omit only for the permanent, self-only form printed as [Permanent]. */
      until?: Duration;
    }
  /**
   * What a [Counter: Play] does to the card it is answering (9-6). `instead`
   * stops the play outright and sends the card there rather than into play;
   * `mode` and `negated` let the play happen but change how the card arrives.
   */
  | { op: "resolvingPlay"; instead?: ScriptArea; position?: "top" | "bottom"; mode?: "rest"; negated?: boolean }
  | { op: "negateAttack" }
  /**
   * 9-7: negate the counter this one is answering. The counter being answered
   * is the step waiting under this one in the flow, so there is nothing to
   * name — "the [Counter]" is always that one.
   */
  | { op: "negateCounter" }
  /**
   * 9-1-5: this skill switches itself off for the rest of the game. Cards use
   * it for effects meant to happen once — the skill is still printed, and
   * still negatable by anything else, it simply never triggers again.
   */
  | { op: "negateOwnSkill"; until?: "turn" | "battle" }
  /**
   * Forbid an action (20-14). Name a `target` for a rule about particular
   * cards, or a `side` for one about a player ("your opponent can't attack
   * with Battle Cards"), optionally narrowed by a filter. `uses` allows that
   * many uses before the prohibition applies; `unless` is the escape condition.
   */
  | { op: "forbid"; what: ForbiddenAction; until: Duration; target?: Ref; side?: Side; filter?: CardFilter; sameNameAsSelf?: boolean; bySkill?: boolean; uses?: Amount; unless?: Cond }
  /**
   * 9-1-4: a card no skill may touch — stronger than `forbid: "beChosen"`,
   * which only stops a skill from *choosing* it. `from`/`fromFilter` say
   * *whose* skills are blocked, mirroring `forbid`'s `side`/`filter` pair but
   * aimed at the source of the effect rather than the actor; both absent
   * means every skill. Omit `target` for this card.
   */
  | { op: "immune"; until: Duration; target?: Ref; from?: Side; fromFilter?: CardFilter }
  /**
   * The opposite of `forbid`: a rule of the game lifted for one card.
   * "This card can attack Battle Cards in Active Mode" (8-1-1). `filter`
   * says which active cards, and a description the parser cannot read must
   * fail the clause rather than permit every one of them.
   */
  | { op: "permit"; what: "attackActive"; until: Duration; target: Ref; filter?: CardFilter }
  | { op: "if"; cond: Cond; then: Op[]; else?: Op[] }
  /** "Choose one— ・A ・B" (20-2): the master picks one printed option. */
  | { op: "chooseMode"; modes: { label: string; ops: Op[] }[]; reason?: string }
  /**
   * "You may draw 1 card" (20-16): the master decides whether the rest of this
   * clause happens. Taking it silently is not the rule — and "if you don't"
   * has nothing to be the opposite of when the choice was never offered.
   */
  /**
   * `chooser` is who decides, when that is not the player whose skill this is:
   * "your opponent **may** choose 1 of their Battle Cards and KO it" is their
   * offer to decline (20-16), and "if they don't" reads the answer.
   */
  | { op: "may"; ops: Op[]; reason?: string; chooser?: Side }
  /**
   * Write an effect down now and carry it out later (1-7-2-1-1): "at the end
   * of the turn, KO it". The inner program keeps this frame's variables, so it
   * still knows which card "it" was.
   */
  | { op: "delay"; at: DelayTiming; scope?: DelayScope; ops: Op[]; label?: string }
  | { op: "note"; text: string };

/**
 * The price before the colon, as the record holds it (4-3-3). Both halves are
 * read together and never as alternatives: "If your Leader is red, and you
 * place 1 card from your hand in the Drop Area:" is a condition *and* an
 * action. Either may be null; both null on a skill whose price is more than
 * orbs means the compiler could not read the price, and the engine says so
 * rather than resolving an effect it did not charge for.
 *
 * The same shape as `CostRecord.condition` / `CostRecord.program` on the
 * `card_rules` row. It lives here so the store can hand a price to the engine
 * without either of them importing the compiler.
 */
export interface SkillPrice {
  condition: Cond | null;
  ops: Op[] | null;
  /**
   * The price charges X energy, chosen on activation (20-5). Present means the
   * skill is offered once per payable value of X and the effect may say `X`;
   * absent means it may not.
   */
  x?: XCost;
}

/**
 * What "X" a price may be paid at. `min` defaults to 0 — "{X}" with nothing
 * said is payable at nothing, and the cards that need at least one say so —
 * and `max` is unbounded, so the engine offers every value the energy allows.
 */
export interface XCost {
  min?: number;
  max?: number;
}

/**
 * The skill cost as the record shows it, all read without a game state.
 *
 * The same shape as `card_rules.cost`. It lives beside `SkillPrice` — the two
 * halves the engine actually charges — because the rules language prints and
 * parses a whole record, price included, and must not reach the drafter (which
 * reaches the database) to know what a price looks like.
 */
export interface CostRecord {
  text: string;
  orbs: Record<string, number>;
  either: string[][];
  marker: number | null;
  burst: number | null;
  spiritBoost: number | null;
  /** "If your Leader is red" — a condition the price states. */
  condition: Cond | null;
  /** "Switch this card to Rest Mode" — an action the price charges. */
  program: Op[] | null;
  /** "{X}" — the price charges X energy, chosen when the skill is activated, and the effect may then say `X` (20-5). */
  x?: XCost;
}

/**
 * The price in words, for the record's COST row. It sits here rather than on
 * the page that used to own it because the workbench now edits the price in
 * the rules language, and the chip beside the text has to be redrawn in the
 * browser as it is typed — which means the sentence has to be reachable
 * without importing anything that touches the database.
 */
export function costSentence(cost: CostRecord | null): string | null {
  if (!cost) return null;
  const parts: string[] = [];
  for (const [c, n] of Object.entries(cost.orbs)) parts.push(`${n} ${c === "any" ? "energy" : `${c} energy`}`);
  for (const either of cost.either) parts.push(`1 ${either.join(" or ")} energy`);
  if (cost.marker != null) parts.push(cost.marker >= 0 ? `add ${cost.marker} marker${cost.marker === 1 ? "" : "s"}` : `remove ${-cost.marker} marker${cost.marker === -1 ? "" : "s"}`);
  if (cost.burst != null) parts.push(`Burst ${cost.burst}`);
  if (cost.spiritBoost != null) parts.push(`Spirit Boost ${cost.spiritBoost}`);
  if (cost.condition) parts.push(`if ${describeCond(cost.condition)}`);
  if (cost.program) parts.push(describeScript(cost.program));
  else if (cost.text && !cost.condition) parts.push(cost.text);
  return parts.join(" · ") || null;
}

export interface Script {
  ops: Op[];
  /** Clauses the compiler could not read; non-empty means the referee handles the skill. */
  unsupported: string[];
  /**
   * The moments this skill answers to, off the record (`card_rules.trigger`).
   *
   * The precedent is the price of 8 Sep 2026: the engine plays from rows, so a
   * WHEN edited on the workbench has to be the WHEN the engine matches —
   * otherwise the edit is a label on a card and nothing more. `undefined` means
   * *no record*, and `pendTriggers` falls back to reading the printed text, so
   * a card nobody drafted still fires where the drafter would have put it.
   * An empty array is a record that says this skill answers to nothing.
   */
  trigger?: Trigger[];
  /**
   * The price the record carries. Absent means *no record*, which is not the
   * same as a skill with no price: since 8 Sep 2026 the engine reads the price
   * rather than compiling it, so a skill nobody drafted has an unknown price
   * rather than a free one.
   */
  price?: SkillPrice;
}

/** The programs of one card face, by skill index. What `card_rules` holds for a card and what `ctx.scripts` carries into a game. */
export interface CardScripts {
  /** Keyed by skill index; only skills with text appear. */
  bySkill: Record<number, Script>;
  /** True when every skill either has a program or is a pure keyword skill. */
  complete: boolean;
  unsupported: string[];
}

/** What the engine has for a card nobody drafted: nothing, and it says so. */
export const NO_RULES: CardScripts = Object.freeze({ bySkill: {}, complete: false, unsupported: [] }) as CardScripts;

/** Where a price leaves the X it bound, beside where it leaves its names. */
export const savedXKey = (saveVarsAs: string) => `${saveVarsAs}:x`;

/** One running program. Stored in the flow, so a game can be saved mid-effect. */
export interface ScriptFrame {
  ops: Op[];
  ip: number;
  vars: Record<string, string[]>;
  card: string;
  master: PlayerId;
  trigger?: Trigger;
  subject?: string;
  /** Which skill of the card this is, so a skill can switch itself off (9-1-5). */
  skillIndex?: number;
  /** Set while a `choose` is waiting for an answer. */
  awaiting?: string;
  /**
   * X, as this activation paid it (20-5). Put here by the activation that
   * charged an X price, or by a `choose` carrying `bindX`. Absent is *not*
   * zero: an `{x:true}` amount read with nothing bound throws, and
   * `validateProgram` refuses such a program before it is ever stored.
   */
  x?: number;
  /**
   * Where to leave this program's variables when it finishes, so a later one
   * can start from them. Used by a skill's price, whose effect may refer to
   * what the price chose (4-3-3).
   */
  saveVarsAs?: string;
  /** What this program has done so far, for "if you added a card to your hand" (20-16). */
  did?: { addToHand?: boolean; play?: boolean; negateAttack?: boolean; negateLeaderAttack?: boolean; ko?: boolean; draw?: boolean; may?: boolean };
  /** A `moveTo`/`ko` loop suspended for a replacement choice. */
  moveLoop?: {
    kind: "moveTo" | "ko";
    ids: string[];
    index: number;
    to?: Area;
    owner?: PlayerId;
    reason?: MoveReason;
    position?: "top" | "bottom";
    reveal?: boolean;
    mode?: "active" | "rest";
    faceUp?: boolean;
    leftBattle?: boolean;
    beforeDrop?: number;
    choices?: ReplacementChoice[];
    allowNone?: boolean;
  };
}

/** How each timing reads in the log when the card text does not say it better. */
export const DELAY_LABELS: Record<DelayTiming, string> = {
  turnStart: "at the start of the turn",
  mainStart: "at the start of the Main Phase",
  turnEnd: "at the end of the turn",
  turnCleanup: "as the turn ends",
  battleEnd: "at the end of the battle",
};

// ── the interpreter ────────────────────────────────────────────────────────

export { resolveSelector };

/**
 * One skill as a line of a menu, for `copySkills`' "which one?" (20-18). A
 * keyword skill is named by its keyword; anything else is its printed line,
 * which is the only thing that tells two [Auto]s of one card apart.
 */
function skillOption(sk: Skill): string {
  if (sk.kind === "keyword" && sk.keyword) return `[${sk.tags[0] ?? sk.keyword.name}]`;
  const text = sk.raw.replace(/\s+/g, " ").trim();
  return text.length > 90 ? `${text.slice(0, 88)}\u2026` : text;
}

function replacementPrompt(card: string, to: Area, choices: ReplacementChoice[], allowNone: boolean): { reason: string; options: string[] } {
  const area = (x: Area) =>
    ({
      drop: "the Drop",
      warp: "the Warp",
      hand: "the hand",
      energy: "the Energy Area",
      life: "life",
      removed: "out of the game",
      deck: "the deck",
      zEnergy: "Z-Energy",
      zDeck: "the Z-Deck",
      battle: "the Battle Area",
      unison: "the Unison Area",
      leader: "the Leader Area",
      combo: "the Combo Area",
    })[x] ?? x;
  return {
    reason: `${card}: choose where it goes instead of ${area(to)}`,
    options: [...choices.map((c) => `To ${area(c.to)}${c.mode === "rest" ? " in Rest Mode" : ""}`), ...(allowNone ? [`Keep going to ${area(to)}`] : [])],
  };
}

function pickedReplacement(loop: NonNullable<ScriptFrame["moveLoop"]>, index: number | null): ReplacementResult | null | undefined {
  if (!loop.choices?.length) return undefined;
  if (index == null || index < 0 || index >= loop.choices.length) return null;
  const picked = loop.choices[index];
  return picked ? { to: picked.to, mode: picked.mode } : null;
}

/**
 * Every card that flips a life card face up says *which* skills count: "when
 * a card in your life is flipped face up **by one of your red card skills**".
 * The trigger text is read without state (`triggers.ts`), so the colour is
 * checked here, where the card that did it is known, and the entries pended
 * since `before` that name a colour the source has not got are dropped again.
 */
function dropWrongColour(ctx: GameContext, s: GameState, before: number, source: string | undefined): void {
  const colors = source && s.cards[source] ? cardNow(ctx, s, source).colors : [];
  s.pending = s.pending.filter((e, i) => {
    if (i < before) return true;
    const sk = skillsOfInstance(ctx, s, e.card).find((x) => x.index === e.skillIndex);
    const m = /flipped face up by (?:one of )?your (red|blue|green|yellow|black|white) card skills?/i.exec(sk ? sk.cost + " " + sk.effect : "");
    if (!m) return true;
    const want = (m[1][0].toUpperCase() + m[1].slice(1)) as Color;
    return colors.includes(want);
  });
}

/**
 * Run a program until it finishes or needs a decision. Returns "wait" with a
 * prompt set and the frame pushed back onto the flow; "done" when the program
 * ended or a sub-flow (playing a card) took over.
 */
export function stepScript(ctx: GameContext, s: GameState, ev: GameEvent[], frame: ScriptFrame): "done" | "wait" {
  const master = frame.master;

  for (let guard = 0; guard < 200; guard++) {
    if (frame.ip >= frame.ops.length) {
      // A skill's price is its own program, run before the effect (4-3-3), but
      // the effect may point back at what the price chose: "Choose 1 {Tree of
      // Might} … and place this card under the chosen card: **Add a marker to
      // the chosen card**." Handing the names on is what makes that one skill
      // rather than two.
      if (frame.saveVarsAs) {
        s.continuations[frame.saveVarsAs] = { ...frame.vars };
        // 20-5: and the X a `bindX` choose bound, for the prices that are a
        // choice rather than an energy payment ("discard any number of cards:
        // … X cards"). Under a key of its own rather than folded into the
        // names, so the shape a game saved mid-price reads back is unchanged
        // — the counter window between a price and its effect is exactly
        // where such a game is stored.
        if (frame.x !== undefined) s.continuations[savedXKey(frame.saveVarsAs)] = frame.x;
      }
      return "done";
    }
    const op = frame.ops[frame.ip];

    switch (op.op) {
      case "note":
        note(ev, op.text);
        break;

      case "draw":
        for (const p of sideOf(master, op.side)) {
          const before = s.players[p].hand.length;
          drawCards(ctx, s, ev, p, amount(ctx, s, frame, op.n));
          // "If you did not draw a card with this skill" (20-16).
          if (p === master && s.players[p].hand.length > before) (frame.did ??= {}).draw = true;
        }
        break;

      case "discard": {
        // 20-7: the *owner* of the hand chooses which cards leave it. The
        // comment here has said so from the beginning while the code took
        // whatever was last in hand, which is not a choice at all — and for
        // the opponent's hand it was not even the right player's.
        //
        // Rather than teach this op to prompt, it is rewritten into the ops
        // that already know how: a `choose` the owner answers, then the move.
        // `chooseMode` splices its option in the same way.
        const n = amount(ctx, s, frame, op.n);
        const spliced: Op[] = [];
        for (const p of sideOf(master, op.side)) {
          const who: Side = p === master ? "you" : "opponent";
          const v = `discarded${frame.ip}${p}`;
          spliced.push(
            { op: "choose", sel: { side: who, area: "hand", count: n }, as: v, chooser: who, reason: `discard ${n} card${n === 1 ? "" : "s"}` },
            { op: "moveTo", target: { var: v }, to: op.to ?? "drop", reveal: true },
          );
        }
        frame.ops = [...frame.ops.slice(0, frame.ip), ...spliced, ...frame.ops.slice(frame.ip + 1)];
        continue;
      }

      case "damage": {
        // 5-10 / 21-3: life cards go to the hand; damage from an effect is never Critical.
        for (const p of sideOf(master, op.side ?? "opponent")) {
          const n = amount(ctx, s, frame, op.n);
          const taken: string[] = [];
          for (let i = 0; i < n; i++) {
            const life = s.players[p].life[0];
            if (!life) break;
            move(ctx, s, ev, life, "hand", p, { reason: "damage" });
            taken.push(life);
          }
          if (taken.length) {
            s.players[p].damageTaken += taken.length;
            ev.push({ type: "damage", player: p, amount: taken.length, critical: false, cards: taken });
            pendTriggers(ctx, s, "dealtDamage", frame.card);
            // 21-3: "when you take damage from an opponent's non-keyword
            // skill" and its mirror. Only the `damage` op reaches here —
            // battle damage takes a different path — so the "from a skill"
            // half of those wordings is the moment itself. The cards that add
            // "from a skill on one of your Battle Cards" are answered by the
            // area the source sits in.
            const src = frame.card && areaOf(s, frame.card);
            const fromBoard = src === "battle" || src === "unison" || src === "leader";
            if (fromBoard) {
              for (const w of cardsInPlay(s, p)) pendTriggers(ctx, s, "youTookDamage", w, frame.card);
              for (const w of cardsInPlay(s, p === "p1" ? "p2" : "p1")) pendTriggers(ctx, s, "opponentTookDamage", w, frame.card);
            }
            // 3-9: the life cards themselves left the Life Area.
            for (const w of cardsInPlay(s, p)) pendTriggers(ctx, s, "lifeLeft", w, taken[0]);
          }
        }
        break;
      }

      case "mill": {
        // What actually went, which is fewer than asked for on an empty deck.
        // The name is bound either way: a clause asking about a card that was
        // never there has to come out false, not match whatever was bound
        // before it.
        const milled: string[] = [];
        for (const p of sideOf(master, op.side)) {
          const n = amount(ctx, s, frame, op.n);
          for (let i = 0; i < n && s.players[p].deck.length; i++) {
            const id = s.players[p].deck[0];
            move(ctx, s, ev, id, "drop", p, { reason: "effect", reveal: true });
            milled.push(id);
          }
        }
        if (op.as) frame.vars[op.as] = milled;
        break;
      }

      case "addLife":
        for (const p of sideOf(master, op.side)) {
          const n = amount(ctx, s, frame, op.n);
          for (let i = 0; i < n && s.players[p].deck.length; i++) move(ctx, s, ev, s.players[p].deck[0], "life", p, { reason: "effect" });
        }
        break;

      case "lifeDownTo":
        // Losing life this way is not damage (1-13-2), so nothing triggers on it.
        for (const p of sideOf(master, op.side)) {
          while (s.players[p].life.length > op.n) move(ctx, s, ev, s.players[p].life[0], "hand", p, { reason: "effect" });
        }
        break;

      case "shuffle":
        // 5-11: the engine reshuffles at the next draw; record it so the log reads right.
        for (const p of sideOf(master, op.side)) ev.push({ type: "note", text: `${s.players[p].name} shuffles their deck` });
        shuffleDeck(s, sideOf(master, op.side));
        break;

      case "energyMarker":
        for (const p of sideOf(master, op.side)) {
          const n = amount(ctx, s, frame, op.n);
          s.players[p].energyMarkers = Math.max(0, s.players[p].energyMarkers + n);
          ev.push({ type: "energyMarker", player: p, delta: n });
        }
        break;

      case "look": {
        // 20-11: looking is not revealing — only the player looking sees them,
        // which is why the cards are bound to a name rather than moved.
        const p = sideOf(master, op.side)[0];
        // "Look at your opponent's hand": a whole area rather than an end of
        // the deck, so the count says nothing.
        if (op.area && op.area !== "deck") {
          frame.vars[op.as] = resolveSelector(ctx, s, frame, { side: op.side, area: op.area });
          break;
        }
        const n = amount(ctx, s, frame, op.n);
        const deck = s.players[p].deck;
        frame.vars[op.as] = op.from === "bottom" ? deck.slice(Math.max(0, deck.length - n)) : deck.slice(0, n);
        break;
      }

      case "reveal": {
        // 20-11-2: revealing shows the cards to both players and leaves them
        // where they are. The log is how the other player gets to see them.
        const shown = resolveSelector(ctx, s, frame, op.sel);
        frame.vars[op.as] = shown;
        if (shown.length) note(ev, `revealed ${shown.map((id) => face(ctx, s, id).name).join(", ")}`);
        break;
      }

      case "choose": {
        const want = op.sel.count ?? 1;
        /** Cards taken out of a pool ("choose 1 among them") leave the pool. */
        const take = (picked: string[]) => {
          frame.vars[op.as] = picked;
          // 20-5: "discard any number of cards: … X cards". X is how many were
          // taken, bound the moment the choice settles, so every later step of
          // this program reads the same number.
          if (op.bindX) frame.x = picked.length;
          if (op.sel.fromVar) frame.vars[op.sel.fromVar] = (frame.vars[op.sel.fromVar] ?? []).filter((id) => !picked.includes(id));
        };
        // Cards picked so far, while a multi-card choice is part-answered.
        const sofar = frame.awaiting === op.as ? (frame.vars[op.as] ?? []) : [];
        const cands = resolveSelector(ctx, s, frame, op.sel).filter((id) => !sofar.includes(id));

        if (s.lastChoice && frame.awaiting === op.as) {
          const picked = [...sofar, ...s.lastChoice.filter((id) => cands.includes(id))];
          s.lastChoice = null;
          // A choice is made one card at a time (the board asks by tapping),
          // so a "choose 2" comes back here for the second card. Declining a
          // card ends an "up to" choice early, as 5-2-4 allows.
          const done = picked.length >= want || picked.length === sofar.length || picked.length >= sofar.length + cands.length;
          frame.vars[op.as] = picked;
          if (done) {
            frame.awaiting = undefined;
            take(picked);
            break;
          }
          continue;
        }

        // 5-2-5: take as many as possible when fewer are available than asked for.
        const left = want - sofar.length;
        if (cands.length === 0) {
          frame.awaiting = undefined;
          take(sofar);
          break;
        }
        // Only ask when the answer can differ: a forced pick is taken silently.
        if (!op.sel.upTo && cands.length <= left) {
          frame.awaiting = undefined;
          take([...sofar, ...cands]);
          break;
        }
        frame.awaiting = op.as;
        frame.vars[op.as] = sofar;
        s.flow.unshift({ op: "script.step", frame });
        const asked = left === 1 ? "" : ` (${left} more)`;
        s.prompt = {
          kind: "chooseCards",
          // 20-7: whoever the card says chooses, chooses.
          player: op.chooser ? sideOf(master, op.chooser)[0] : master,
          choice: {
            reason: (op.reason ?? `${face(ctx, s, frame.card).name}: choose ${op.sel.upTo ? `up to ${want}` : want}`) + asked,
            candidates: cands,
            // One card per answer, so the menu is one action per card.
            min: op.sel.upTo ? 0 : 1,
            max: 1,
            continuation: op.as,
          },
        };
        return "wait";
      }

      case "ko":
        frame.moveLoop ??= { kind: "ko", ids: resolveRef(ctx, s, frame, op.target), index: 0, reason: "ko" };
        while (frame.moveLoop && frame.moveLoop.kind === "ko" && frame.moveLoop.index < frame.moveLoop.ids.length) {
          const id = frame.moveLoop.ids[frame.moveLoop.index];
          // 22-12: [Indestructible] cannot be KO'd by an opponent's skill.
          if (has(ctx, s, id, "Indestructible") && s.cards[id].owner !== master) {
            frame.moveLoop.index++;
            continue;
          }
          // 20-14: the same thing spelled out on the card rather than keyworded.
          if (forbids(ctx, s, "beKOdBySkill", { player: master, card: id })) {
            frame.moveLoop.index++;
            continue;
          }
          if (areaOf(s, id) === "battle") {
            let replaced: ReplacementResult | null | undefined;
            if (frame.awaiting === "replaceMove") {
              replaced = pickedReplacement(frame.moveLoop, s.lastMode);
              s.lastMode = null;
              frame.awaiting = undefined;
            } else {
              const choices = replacementChoicesFor(ctx, s, id, "ko");
              const allowNone = choices.length > 0 && choices.every((c) => c.optional);
              if (choices.length > 1 || allowNone) {
                frame.awaiting = "replaceMove";
                frame.moveLoop.beforeDrop = s.players[s.cards[id].owner].drop.length;
                frame.moveLoop.choices = choices;
                frame.moveLoop.allowNone = allowNone;
                s.flow.unshift({ op: "script.step", frame });
                const prompt = replacementPrompt(face(ctx, s, id).name, "drop", choices, allowNone);
                s.prompt = { kind: "replaceMove", player: masterOf(s, id), card: id, reason: prompt.reason, options: prompt.options };
                return "wait";
              }
              if (choices.length === 1) replaced = { to: choices[0].to, mode: choices[0].mode };
            }
            const before = frame.moveLoop.beforeDrop ?? s.players[s.cards[id].owner].drop.length;
            frame.moveLoop.beforeDrop = undefined;
            koCard(ctx, s, ev, id, frame.card, replaced === undefined ? {} : { replaced });
            // "If you KO'd a card" (20-16): only a KO that happened counts.
            if (s.players[s.cards[id].owner].drop.length > before) (frame.did ??= {}).ko = true;
          }
          frame.moveLoop.index++;
        }
        frame.moveLoop = undefined;
        break;

      case "moveTo": {
        // 23-2: under a card is not an area of its own, so it is its own move.
        const host = op.to === "under" ? (op.under ? resolveRef(ctx, s, frame, op.under)[0] : frame.card) : null;
        frame.moveLoop ??= {
          kind: "moveTo",
          ids: resolveRef(ctx, s, frame, op.target),
          index: 0,
          to: op.to === "play" ? "battle" : (op.to as Area),
          position: op.position,
          reveal: op.reveal,
          mode: op.mode,
          faceUp: op.faceUp,
          reason: "effect",
        };
        while (frame.moveLoop && frame.moveLoop.kind === "moveTo" && frame.moveLoop.index < frame.moveLoop.ids.length) {
          const id = frame.moveLoop.ids[frame.moveLoop.index];
          // 3-1-2: a Leader Card stays in the Leader Area. Skills may change
          // its power or negate it, but nothing puts it anywhere else — and
          // an empty Leader Area is a state the rest of the engine cannot read.
          if (areaOf(s, id) === "leader") {
            frame.moveLoop.index++;
            continue;
          }
          // 20-14: "can't be removed from a Battle Area by your opponent's
          // skills". The rule is about the opponent's skills, so a card its
          // own master moves is unaffected.
          if (s.cards[id].owner !== master && areaOf(s, id) === "battle" && forbids(ctx, s, "beMovedBySkill", { card: id })) {
            frame.moveLoop.index++;
            continue;
          }
          if (op.to === "under") {
            if (host) placeUnder(ctx, s, ev, id, host);
            frame.moveLoop.index++;
            continue;
          }
          const owner = op.owner ? sideOf(master, op.owner)[0] : op.to === "battle" || op.to === "unison" ? master : s.cards[id].owner;
          const dest = op.to === "play" ? "battle" : op.to;
          let replaced: ReplacementResult | null | undefined;
          const leftBattle = frame.moveLoop.leftBattle ?? (areaOf(s, id) === "battle");
          if (frame.awaiting === "replaceMove") {
            replaced = pickedReplacement(frame.moveLoop, s.lastMode);
            s.lastMode = null;
            frame.awaiting = undefined;
          } else {
            const choices = replacementChoicesFor(ctx, s, id, "effect");
            const allowNone = choices.length > 0 && choices.every((c) => c.optional);
            if (choices.length > 1 || allowNone) {
              frame.awaiting = "replaceMove";
              frame.moveLoop.owner = owner;
              frame.moveLoop.to = dest;
              frame.moveLoop.leftBattle = leftBattle;
              frame.moveLoop.choices = choices;
              frame.moveLoop.allowNone = allowNone;
              s.flow.unshift({ op: "script.step", frame });
              const prompt = replacementPrompt(face(ctx, s, id).name, dest, choices, allowNone);
              s.prompt = { kind: "replaceMove", player: masterOf(s, id), card: id, reason: prompt.reason, options: prompt.options };
              return "wait";
            }
            if (choices.length === 1) replaced = { to: choices[0].to, mode: choices[0].mode };
          }
          move(ctx, s, ev, id, dest, owner, { position: op.position, reveal: op.reveal, reason: "effect", ...(replaced === undefined ? {} : { replaced }) });
          // 3-1: "when this card is removed from a Battle Area by a skill",
          // and the commoner narrowing to the *opponent's* skills. A card that
          // went nowhere — a replacement sent it back — was not removed.
          if (leftBattle && areaOf(s, id) !== "battle") {
            pendTriggers(ctx, s, "removedFromBattle", id);
            if (masterOf(s, id) !== master) pendTriggers(ctx, s, "removedByOpponent", id);
            // The narrower wording, which names where it ended up as well —
            // and the one that names no cause, which covers this too.
            if (areaOf(s, id) === "drop") {
              pendTriggers(ctx, s, "droppedFromBattle", id);
              pendTriggers(ctx, s, "leftBattleToDrop", id);
            }
          }
          if (op.mode) setMode(s, ev, id, op.mode, ctx);
          // 5-5: a card a skill *places* in a Battle Area was not played, so
          // "when this card is played" does not fire — 30 cards say only
          // "when this card is placed in a Battle Area".
          if (dest === "battle") pendTriggers(ctx, s, "placed", id);
          // 17-3: "when this card is added to your Z-Energy".
          if (dest === "zEnergy") pendTriggers(ctx, s, "addedToZEnergy", id);
          // "Add it to your life face up" (3-9-2-1): how the card arrives, set
          // after the move because 3-1-4 clears the flag on the way.
          if (op.faceUp) s.cards[id].faceUp = true;
          if (dest === "hand" && owner === master) (frame.did ??= {}).addToHand = true;
          frame.moveLoop.leftBattle = undefined;
          frame.moveLoop.index++;
        }
        frame.moveLoop = undefined;
        break;
      }

      case "switchMode":
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          const was = s.cards[id].mode;
          setMode(s, ev, id, op.mode, ctx);
          // "When this card is switched to Rest Mode by one of your skills"
          // (1-10): the card and the skill both have to be yours, which is what
          // "your" says — an opponent resting it is not this moment.
          if (op.mode === "rest" && was === "active" && s.cards[id].mode === "rest") {
            const area = areaOf(s, id);
            if (masterOf(s, id) === master) pendTriggers(ctx, s, "restedBySkill", id, frame.card);
            // The other end of it: your skill resting one of *theirs*, watched
            // by your cards in play. The printed wording names their Battle
            // Cards and energy, so that is where it is pended and nowhere else.
            else if (area === "battle" || area === "energy") {
              for (const w of cardsInPlay(s, master)) pendTriggers(ctx, s, "restedTheirsBySkill", w, id);
            }
          }
        }
        break;

      case "hidden":
        // 23-5-1: only a Battle Card in a Battle Area can be face down.
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          if (areaOf(s, id) !== "battle" || s.cards[id].hidden === op.hidden) continue;
          s.cards[id].hidden = op.hidden;
          note(ev, `${op.hidden ? "a Battle Card" : face(ctx, s, id).name} is switched to ${op.hidden ? "Hidden" : "Revealed"} Mode`);
        }
        break;

      case "flip":
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          const inst = s.cards[id];
          if (inst.flipped || !ctx.defs[inst.cardId]?.back || areaOf(s, id) !== "leader") continue;
          inst.flipped = true;
          ev.push({ type: "flip", card: id, flipped: true });
        }
        break;

      case "faceUp": {
        const up = op.faceUp ?? true;
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          if (!!s.cards[id].faceUp === up) continue;
          s.cards[id].faceUp = up;
          // 3-9-2-1: a face-up card is open to both players, so naming it leaks nothing.
          note(ev, `${face(ctx, s, id).name} is turned face ${up ? "up" : "down"}`);
          if (!up) continue;
          // "When **this card** in your life is flipped face up" is the card
          // itself; "when **a** card in your life is flipped face up" is watched
          // by everything that player has in play. One moment, two wordings.
          const before = s.pending.length;
          pendTriggers(ctx, s, "flippedFaceUp", id, frame.card);
          for (const w of cardsInPlay(s, s.cards[id].owner)) if (w !== id) pendTriggers(ctx, s, "flippedFaceUp", w, id);
          dropWrongColour(ctx, s, before, frame.card);
        }
        break;
      }

      case "comboFrom": {
        // 5-7-2: a combo card needs a battle to join, on the side of the
        // player whose skill this is.
        const b = s.battle;
        if (!b || (masterOf(s, b.attacker) !== master && masterOf(s, b.guard) !== master)) break;
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          if (areaOf(s, id) === "combo") continue;
          move(ctx, s, ev, id, "combo", master, { reason: "combo", reveal: true });
          if (op.negated) s.cards[id].negated = "all";
          // 5-7-2: a combo a skill makes is a combo. Both sides watch it, the
          // same as one the player declared.
          for (const w of cardsInPlay(s, master)) pendTriggers(ctx, s, "youCombo", w, id);
          for (const w of cardsInPlay(s, master === "p1" ? "p2" : "p1")) pendTriggers(ctx, s, "opponentCombos", w, id);
        }
        break;
      }

      case "redirectAttack": {
        // 8-1: a battle in progress; the new target has to be a Leader or a
        // Battle Card of the defending player that is not already the attacker.
        const b = s.battle;
        if (!b) break;
        const defender = masterOf(s, b.guard);
        const id = resolveRef(ctx, s, frame, op.target).find((x) => x !== b.attacker && x !== b.guard && masterOf(s, x) === defender && (areaOf(s, x) === "battle" || areaOf(s, x) === "leader"));
        if (!id) break;
        b.guard = id;
        ev.push({ type: "guardChanged", guard: id, by: frame.card });
        pendTriggers(ctx, s, "attacked", id);
        break;
      }

      // The primitive the two cases below are spellings of
      // (`docs/arena-ruleset-spec.md` §2.3). It makes the same continuous
      // effects, so a rule written either way plays identically; the list
      // attributes are what a card *counts as*, which is read wherever the
      // card is and never applied here — the same reason `gains` falls
      // through to the "continuous by nature" case further down.
      case "modifyAttr": {
        if (op.attr !== "power" && op.attr !== "comboPower") break;
        if (!op.until) break;
        const n = amount(ctx, s, frame, op.amount ?? 0);
        for (const id of resolveRef(ctx, s, frame, op.target ?? { sel: { special: "self" } }))
          addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind: op.attr, value: n, until: op.until });
        break;
      }

      case "power":
      case "comboPower": {
        const n = amount(ctx, s, frame, op.amount);
        for (const id of resolveRef(ctx, s, frame, op.target))
          addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind: op.op === "power" ? "power" : "comboPower", value: n, until: op.until });
        break;
      }

      case "grant":
        for (const id of resolveRef(ctx, s, frame, op.target)) addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind: "keyword", value: op.keyword, until: op.until });
        break;

      case "copySkills": {
        // "Choose up to 1 keyword skill on a card under this card" is a choice
        // among the *skills* of every card the phrase finds, not among the
        // cards — so every source is opened and its skills laid out together.
        const offered: { card: string; side: "front" | "back"; skill: Skill }[] = [];
        for (const src of resolveRef(ctx, s, frame, op.from)) {
          if (!s.cards[src]) continue;
          const sd = def(ctx, s, src);
          const side = s.cards[src].flipped && sd.back ? "back" : "front";
          // The printed face, as 20-18 reads it: what the source says, not
          // what anything has since done to it.
          for (const sk of skillsOf(sd, side)) {
            if (op.only === "keyword" && !sk.keyword) continue;
            if (op.skill != null && sk.index !== op.skill) continue;
            offered.push({ card: src, side, skill: sk });
          }
        }
        if (!offered.length) break;
        let picked: typeof offered;
        if (op.which === "all" || op.skill != null) picked = offered;
        else if (s.lastMode != null && frame.awaiting === "copySkills") {
          const at = s.lastMode;
          s.lastMode = null;
          frame.awaiting = undefined;
          // Every card printing this says "choose **up to** 1", so the last
          // option declines; a single skill is still asked about, because the
          // choice is the player's and not the count's.
          picked = offered[at] ? [offered[at]] : [];
        } else {
          const several = new Set(offered.map((o) => o.card)).size > 1;
          frame.awaiting = "copySkills";
          s.flow.unshift({ op: "script.step", frame });
          s.prompt = {
            kind: "chooseMode",
            player: master,
            reason: `${face(ctx, s, frame.card).name}: choose a skill to gain`,
            options: [...offered.map((o) => (several ? `${face(ctx, s, o.card).name}: ${skillOption(o.skill)}` : skillOption(o.skill))), "None"],
          };
          return "wait";
        }
        if (!picked.length) break;
        const targets = resolveRef(ctx, s, frame, op.target ?? { sel: { special: "self" } });
        for (const id of targets)
          for (const src of new Set(picked.map((x) => x.card))) {
            const mine = picked.filter((x) => x.card === src);
            // A pure keyword line is a granted keyword and nothing more
            // (20-18-1); everything else is carried as a copy the target
            // enumerates alongside its own skills.
            const typed = mine.filter((x) => !(x.skill.kind === "keyword" && x.skill.keyword));
            for (const x of mine)
              if (!typed.includes(x)) addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind: "keyword", value: x.skill.keyword!, until: op.until });
            if (typed.length)
              addEffect(s, ev, {
                master: frame.master,
                source: frame.card,
                target: id,
                kind: "copiedSkills",
                value: 0,
                copied: { cardId: s.cards[src].cardId, side: typed[0].side, skills: typed.map((x) => x.skill.index), from: src, name: def(ctx, s, src).name },
                until: op.until,
              });
          }
        break;
      }

      case "negateSkills":
        // 9-1-5: for a duration it is a continuous effect that ends with the
        // turn or the battle; "for the game" marks the card until it leaves play.
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          // 9-1-5: "This card's skills can't be negated in any area" beats the
          // instruction, like every other prohibition (0-2-5).
          if (forbids(ctx, s, "beNegated", { card: id })) continue;
          if (op.until === "game") s.cards[id].negated = "all";
          else addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind: "negateSkills", value: 0, until: op.until });
        }
        break;

      case "negateSkillsOfKind":
        // 9-1-5: one kind of skill, not the card. Kept as an effect for the
        // duration the card printed — "in all areas" compiles to the game,
        // and shortening that to a turn here was a silent change of rule.
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          if (forbids(ctx, s, "beNegated", { card: id })) continue;
          addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind: "negateSkillKind", value: op.kind, until: op.until });
        }
        break;

      case "forbid": {
        // "both" and an absent side alike mean the rule is about neither
        // player in particular, so it holds for both.
        const players = op.side && op.side !== "both" ? sideOf(master, op.side) : [];
        if (op.target) {
          // On a card, the side says *whose* action is forbidden — "can't be
          // KO'd by your opponent's skills" is a rule about the opponent.
          for (const id of resolveRef(ctx, s, frame, op.target))
            addEffect(s, ev, {
              master: frame.master,
              source: frame.card,
              target: id,
              kind: "forbid",
              value: 0,
              until: op.until,
              forbid: { what: op.what, ...(op.uses != null ? { uses: amount(ctx, s, frame, op.uses) } : {}), ...(op.unless ? { unless: op.unless, master: frame.master } : {}), player: players[0] },
            });
          break;
        }
        addEffect(s, ev, {
          master: frame.master,
          source: frame.card,
          target: "",
          kind: "forbid",
          value: 0,
          until: op.until,
          forbid: {
            what: op.what,
            ...(op.uses != null ? { uses: amount(ctx, s, frame, op.uses) } : {}),
            ...(op.unless ? { unless: op.unless, master: frame.master } : {}),
            player: players[0],
            filter: op.filter,
            name: op.sameNameAsSelf ? face(ctx, s, frame.card).name : undefined,
          },
        });
        break;
      }

      // 9-1-4: stored the same way `forbid` is, so a duration expires it the
      // same way; enforced in `resolveSelector` (state.ts), beside [Barrier]
      // and `forbid: "beChosen"`.
      case "immune": {
        const players = op.from && op.from !== "both" ? sideOf(master, op.from) : [];
        const targets = op.target ? resolveRef(ctx, s, frame, op.target) : [frame.card];
        for (const id of targets)
          addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind: "immune", value: 0, until: op.until, immune: { from: players[0], fromFilter: op.fromFilter } });
        break;
      }

      // 8-1-1 lifted for one card — the opposite of `forbid`, and stored the
      // same way so that a duration expires it the same way.
      case "permit":
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind: "permit", value: 0, until: op.until, permit: { what: op.what, filter: op.filter } });
        }
        break;

      case "addMarker":
      case "removeMarker": {
        const n = amount(ctx, s, frame, op.n) * (op.op === "addMarker" ? 1 : -1);
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          s.cards[id].markers = Math.max(0, s.cards[id].markers + n);
          ev.push({ type: "markers", card: id, delta: n, total: s.cards[id].markers });
          if (n < 0) pendTriggers(ctx, s, "markerRemoved", id);
        }
        break;
      }

      case "token": {
        const n = amount(ctx, s, frame, op.n);
        const p = sideOf(master, op.side)[0];
        for (let i = 0; i < n; i++) {
          const id = `${p}#token${Object.keys(s.cards).length}`;
          s.cards[id] = {
            id,
            cardId: tokenCardId(op.name, op.power, op.comboCost, op.comboPower, op.colors),
            owner: p,
            mode: "active",
            hidden: false,
            flipped: false,
            markers: 0,
            under: [],
            isToken: true,
            enteredTurn: s.turn,
            extraAttacks: 0,
            usedThisTurn: [],
            usedMarkerSkill: false,
            battledThisTurn: false,
            negated: [],
          };
          s.players[p].battle.push(id);
          ev.push({ type: "token", card: id, owner: p });
          pendTriggers(ctx, s, "played", id);
        }
        break;
      }

      case "costReduction": {
        // On a [Permanent] this never runs: `collectStatics` reads the op and
        // emits a standing effect. Reaching it here means an [Auto] or an
        // [Activate] said the same thing with a duration on it — XD1-05's
        // "…by 1 for the duration of the turn" — and a skill that resolves has
        // to put it in force itself, or it resolves to nothing at all.
        const by = amount(ctx, s, frame, op.amount);
        if (!by) break;
        // "specified" carries its own value shape — see `collectStatics` and
        // `playCost` (state.ts) — because the colours it relaxes, not a flat
        // number, are what a reader needs to apply it.
        if (op.what === "specified") {
          if (!op.colors?.length) break;
          const sign: 1 | -1 = by < 0 ? -1 : 1;
          for (const id of resolveRef(ctx, s, frame, op.target)) {
            addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind: "specifiedCost", value: { colors: op.colors, sign }, until: op.until ?? "turn" });
          }
          break;
        }
        const kind =
          op.what === "combo"
            ? "comboCost"
            : op.what === "zEnergy"
              ? "zEnergy"
              : op.what === "skill"
                ? "skillCost"
                : op.what === "evolve"
                  ? "evolveCost"
                  : "cost";
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          addEffect(s, ev, {
            master: frame.master,
            source: frame.card,
            target: id,
            kind,
            value: by,
            until: op.until ?? "turn",
            ...(op.skillKind ? { skillKind: op.skillKind } : {}),
            ...(op.colors?.length ? { colors: op.colors } : {}),
          });
        }
        break;
      }

      case "negateKeyword":
      case "gains":
      case "replaceLeave":
        // Continuous by nature: read by `playCost` and by the counter window,
        // not applied here.
        break;

      // The card's own offer about itself (no `until`) is [Permanent]-only
      // and never reaches `exec` at all — `collectStatics` reads it instead,
      // because a [Permanent] never resolves. Reaching this case means the
      // card is granting the alternative to *other* cards for a span
      // (BT11-033), so it is applied the way any other timed continuous
      // effect is, on the cards the selector names right now.
      case "altCost": {
        if (!op.until) break;
        const value: AltCost = { pay: op.pay, n: op.n ?? 1, for: op.for ?? "counter", ...(op.ops ? { ops: op.ops } : {}), ...(op.orbs ? { orbs: op.orbs } : {}) };
        for (const id of resolveRef(ctx, s, frame, op.target ?? { sel: { special: "self" } }))
          addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind: "altCost", value: 0, until: op.until, altCost: value });
        break;
      }

      case "resolvingPlay": {
        const card = s.resolving?.card;
        if (!card) break;
        if (!op.instead) {
          // The play still happens; `resolvePlay` reads these as the card enters.
          if (op.mode === "rest") s.continuations.playRest = card;
          if (op.negated) s.continuations.playNegated = card;
          break;
        }
        // 9-6: the play is negated. The card never reaches the Battle Area, so
        // the step that would have put it there is dropped and the card goes
        // where the skill says from wherever it was being played from. The
        // energy stays paid — negating a play does not undo the cost.
        s.flow = s.flow.filter((f) => !(f.op === "play.resolve" && f.card === card));
        const owner = s.cards[card].owner;
        note(ev, `${face(ctx, s, card).name} is not played`);
        // "Under" is not an area a card can simply be put in (23-2), and no
        // card says so here; the Drop is the printed default.
        const dest = op.instead === "play" ? "battle" : op.instead === "under" ? "drop" : op.instead;
        move(ctx, s, ev, card, dest, owner, { reason: "effect", position: op.position, reveal: true });
        s.resolving = null;
        break;
      }

      case "negateAttack":
        if (s.battle) {
          s.battle.negated = true;
          ev.push({ type: "attackNegated" });
          // "If you negated a Leader Card's attack with this skill" (20-16).
          const did = (frame.did ??= {});
          did.negateAttack = true;
          if (areaOf(s, s.battle.attacker) === "leader") did.negateLeaderAttack = true;
        }
        break;

      case "negateOwnSkill": {
        // 9-1-5: the skill switches itself off for the rest of the game.
        // `negated` is a list of skill indexes on the instance, so this is the
        // same mechanism another card's negation uses — and it is cleared when
        // the card leaves play, because that is a different card (3-1-4).
        const inst = s.cards[frame.card];
        if (!inst || frame.skillIndex == null || inst.negated === "all" || inst.negated.includes(frame.skillIndex)) break;
        if (op.until === "turn" || op.until === "battle") {
          // "Negate this skill for the turn / for the battle": it comes back,
          // so an effect with a duration rather than a mark on the instance.
          addEffect(s, ev, { master: frame.master, source: frame.card, target: frame.card, kind: "negateSkill", value: frame.skillIndex, until: op.until });
          note(ev, `${face(ctx, s, frame.card).name}: that skill will not happen again this ${op.until}`);
          break;
        }
        inst.negated.push(frame.skillIndex);
        note(ev, `${face(ctx, s, frame.card).name}: that skill will not happen again`);
        break;
      }

      case "negateCounter": {
        // The counter being answered is the first one still waiting in the
        // flow: this effect is running inside the window opened over it.
        const target = s.flow.find((f) => f.op === "counter.resolve");
        if (target && target.op === "counter.resolve") {
          target.negated = true;
          note(ev, `${face(ctx, s, target.card).name} is countered`);
        }
        break;
      }

      case "play": {
        // 5-5-3: played by a skill, so no energy cost is paid — but a card
        // that may not be played may not be played by a skill either (20-14).
        // 20-14: a skill doing the playing, which is the half fifteen cards ban.
        const targets = resolveRef(ctx, s, frame, op.target).filter((id) => !forbids(ctx, s, "play", { player: master, card: id, bySkill: true }));
        if (!targets.length) break;
        const onto = op.onto ? resolveRef(ctx, s, frame, op.onto)[0] : undefined;
        const steps: FlowStep[] = [];
        for (const id of targets) steps.push({ op: "play.resolve", card: id, player: master, mode: op.mode, onto, negated: op.negated });
        (frame.did ??= {}).play = true;
        frame.ip++;
        steps.push({ op: "script.step", frame });
        s.flow.unshift(...steps);
        return "done";
      }

      case "delay":
        // The variables are copied, not shared: a later `choose` in this same
        // program must not change what the delayed part points at.
        schedule(s, ev, {
          at: op.at,
          scope: op.scope ?? "thisTurn",
          ops: op.ops,
          card: frame.card,
          master,
          vars: { ...frame.vars },
          subject: frame.subject,
          label: op.label ?? DELAY_LABELS[op.at],
        });
        break;

      case "if": {
        const branch = condHolds(ctx, s, frame, op.cond) ? op.then : (op.else ?? []);
        // Splice the branch in place of the `if`, keeping one frame.
        frame.ops = [...frame.ops.slice(0, frame.ip), ...branch, ...frame.ops.slice(frame.ip + 1)];
        continue;
      }

      case "may": {
        // Asked and answered: splice the ops in, or step over them. Either way
        // the answer is remembered, so "if you do" and "if you don't" can read
        // it (20-16).
        if (s.lastMode != null && frame.awaiting === "may") {
          const yes = s.lastMode === 0;
          s.lastMode = null;
          frame.awaiting = undefined;
          (frame.did ??= {}).may = yes;
          if (!yes) {
            frame.ip++;
            continue;
          }
          frame.ops = [...frame.ops.slice(0, frame.ip), ...op.ops, ...frame.ops.slice(frame.ip + 1)];
          continue;
        }
        // Nothing to offer is not a decision.
        if (!op.ops.length) {
          frame.ip++;
          continue;
        }
        frame.awaiting = "may";
        s.flow.unshift({ op: "script.step", frame });
        s.prompt = {
          kind: "chooseMode",
          // 20-16: whoever the card says may do it, decides. The skill is
          // still yours — only the answer is theirs.
          player: op.chooser ? sideOf(master, op.chooser)[0] : master,
          reason: op.reason ?? `${face(ctx, s, frame.card).name}: optional`,
          options: [op.reason ?? "Do it", "Don't"],
        };
        return "wait";
      }

      case "chooseMode": {
        // 20-2: the option is chosen as the skill resolves, and only then does
        // the rest of the program exist — so it is spliced in like an `if`.
        if (s.lastMode != null && frame.awaiting === "mode") {
          const picked = op.modes[s.lastMode] ?? op.modes[0];
          s.lastMode = null;
          frame.awaiting = undefined;
          frame.ops = [...frame.ops.slice(0, frame.ip), ...(picked?.ops ?? []), ...frame.ops.slice(frame.ip + 1)];
          continue;
        }
        // A single option is not a choice, and an empty one is not asked about.
        const usable = op.modes.filter((mode) => mode.ops.length);
        if (usable.length <= 1) {
          frame.ops = [...frame.ops.slice(0, frame.ip), ...(usable[0]?.ops ?? []), ...frame.ops.slice(frame.ip + 1)];
          continue;
        }
        frame.awaiting = "mode";
        s.flow.unshift({ op: "script.step", frame });
        s.prompt = { kind: "chooseMode", player: master, reason: op.reason ?? `${face(ctx, s, frame.card).name}: choose one`, options: op.modes.map((mode) => mode.label) };
        return "wait";
      }
    }
    frame.ip++;
  }
  note(ev, "effect did not finish: too many steps");
  return "done";
}

function shuffleDeck(s: GameState, players: PlayerId[]): void {
  // Uses the game's RNG so a replay reproduces the order exactly.
  for (const p of players) {
    const deck = s.players[p].deck;
    let state = s.rngState;
    for (let i = deck.length - 1; i > 0; i--) {
      const t = (state + 0x6d2b79f5) | 0;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
      state = t;
      const j = Math.floor((((r ^ (r >>> 14)) >>> 0) / 4294967296) * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    s.rngState = state;
  }
}


export * from "./script-schema";
// Named as well as starred, for the same reason `engine/compile.ts` names its
// entry points: through an import cycle an `export *` name is not instantiated,
// and `arena:readings` died on `does not provide an export named
// "describeScript"`.
export { describeScript, describeCond, describeFilter } from "./script-schema";
