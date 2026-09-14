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
import { asksAQuestion, describeCond, describeScript, describeSelector } from "./script-schema";
import { resolveSelector, sideOf, type AltCost } from "./state";
import type { ScriptHost } from "./script-host";
import type { Area, Color, DelayScope, DelayTiming, ForbiddenAction, KeywordSkill, MoveReason, PlayerId, Prompt, ReplacementChoice, ReplacementResult, Skill, SkillKindPrefix, SkipWhat, Trigger } from "./types";

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

/**
 * The events a `replace` op may stand in front of (9-10). Closed on purpose:
 * every name here is a point the engine really does look for a replacement
 * before the event happens, so a rule naming one of them plays, and a wording
 * that needs any other moment stays unread rather than compiling into silence.
 */
/**
 * `"life"` (#272): a life card's own move to the hand or the Drop Area —
 * 8-4-6-1's damage, not a Battle Area departure at all. Narrowed by `to` on
 * the op (`hand`/`drop`), never by `by`/`bySide`, which name a Battle Area
 * departure's *cause* and mean nothing here: nobody's skill puts a card out
 * of the life area, damage does.
 */
export type ReplaceEvent = "leave" | "ko" | "play" | "life";

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
 *
 * `originalPower` (20-3-1) is the one deliberate exception: "the attacking
 * card's original power" means the printed number, ignoring every layer a
 * marker or a [Permanent] has since added — the opposite convention from
 * `energyCost`, and the reason it is a separate measure rather than a flag on
 * `power`.
 */
export type AmountAttr = "power" | "comboPower" | "energyCost" | "comboCost" | "originalPower";

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
  | { kind: "isTurnPlayer"; who?: "you" | "opponent" }
  /**
   * Which question is on the table. Not a card's word — no printed text says
   * it — but the one a `DEFINE ACTION`'s `REFUSE` needs to tell two windows of
   * the same move apart: 7-2-11 gives the turn player one charge, and "you
   * have already had your charge this turn" is, on both engines, the fact that
   * the question being asked is no longer the charge's (`whyNotCharge`).
   */
  | { kind: "asking"; prompt: Prompt["kind"] }
  /**
   * 20-14: is a rule in force stopping this? Not a card's word either — no
   * printed skill asks it — but the one a `DEFINE ACTION`'s `REFUSE` needs to
   * gate a move on a prohibition, and it is the very predicate `forbids()` is
   * on both engines. `what` is the action; the card and the player it is asked
   * about are the candidate and the actor, which the declaration cannot name.
   */
  | { kind: "forbidden"; what: ForbiddenAction; bySkill?: boolean }
  /**
   * A `DEFINE ATTRIBUTE of: player` fact, read (13-3, 7-2-11, issue #269):
   * "you have not already grown a Unison this turn" and "you have already had
   * your charge this turn" are both this, over a different declared name.
   * Boolean only, so far — nothing has needed a counter read back yet.
   */
  | { kind: "playerAttr"; name: string; side?: "you" | "opponent" }
  /**
   * Do these two selectors each resolve to a card of the same printed
   * identity (`cardId`)? False with nothing, or more than one, on either
   * side — this reads a *specific* pair, never "any of these matches any of
   * those" (that is `every`). 13-3's growUnison needs "a copy of the Unison
   * Card" — the filter grammar has no way to name another card's identity
   * dynamically (`FILTER_FIELDS` is fixed wordings only), so this reads two
   * selectors instead of stretching a filter to do it.
   */
  | { kind: "sameCard"; a: Selector; b: Selector };

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
   * 20-9: gaining control of a card is moving it into your own area and
   * becoming its master (20-9-1), which is why this is one move and not a flag
   * — in this engine the area a card is in *is* who masters it (0-3-4-1).
   * `to` is whose Battle Area it goes to, read from the skill's master, and
   * defaults to "you". The card keeps its mode, its markers and every
   * continuous effect on it (20-9-2), and keeps the turn it entered play, so
   * changing hands never makes it newly played.
   *
   * `until` is a loan: the effect it registers carries the way home, and
   * expiring it walks the card back. Left out, control does not end — the
   * card is the new master's until it leaves the Battle Area, and a KO still
   * sends it to its **owner's** Drop Area (5-12-1).
   */
  | { op: "control"; target: Ref; to?: Side; until?: Duration }
  /**
   * 20-13: a phase or a step is not performed. `side` is whose, read from the
   * skill's master, and `when` says which occurrence — "this" the one in the
   * turn the skill resolved on, "next" the first in a later turn, which is
   * what a card printed on your own turn means by "your next Charge Phase".
   *
   * A flag rather than a move through the flow: the phase has to be refused
   * where it would *begin*, because 20-13-2..4 turn off its trigger moments,
   * its actions and its checkpoints together, and a program running now cannot
   * reach forward to a step that has not been queued yet.
   */
  | { op: "skip"; what: SkipWhat; side?: Side; when?: "this" | "next" }
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
   * `by: "skill"` narrows it to departures a skill caused, and
   * `bySide: "opponent"` to the ones the opponent's skill caused.
   */
  | { op: "replaceLeave"; to: ScriptArea; by?: "skill" | "ko" | "skillOrKo"; bySide?: "opponent"; mode?: "active" | "rest"; optional?: boolean; target?: Ref }
  /**
   * 9-10: an event that is about to happen happens differently, or not at all.
   * The primitive `replaceLeave` and `resolvingPlay` are macros over
   * (`docs/arena-ruleset-spec.md` §2.2) — where those two can only say *where
   * the card itself goes*, this one puts a whole program in the event's place,
   * which is what "place all the cards under this card in the Drop Area
   * instead" (BT3-051) says and what no redirect can.
   *
   * `event` is the moment being replaced, and the list is closed to the three
   * the engine can actually intercept — the glossary's "What a replacement
   * effect can replace" is the readable half of it:
   *   - `"leave"`  the card would leave the Battle Area (9-10-1). `by` narrows
   *                it to a departure a skill caused, or a skill or a KO.
   *   - `"ko"`     the card would be KO'd, and nothing else about it changes.
   *   - `"play"`   the play being resolved (9-6), for a [Counter: Play].
   *
   * `with` is what happens instead. Two shapes are read: a single `moveTo` of
   * the card itself is a **redirect** (it goes there instead, the form
   * `replaceLeave` prints), and anything else is a **substitute** — the move
   * does not happen at all, the card stays, and the program runs in its place.
   * A substitute reads the card whose event it is as `subject`.
   *
   * It may ask a question, but only where somebody can hear it: the two
   * suspendable call sites (`stepScript`'s `moveTo` and `ko` loops) run the
   * program as a frame on the flow, so it can stop and wait. `move()` is
   * synchronous at the other 46, and `replacementFor` leaves an asking
   * substitute unapplied there rather than half-running it — see #107 and
   * `docs/arena-move-replacement-scope.md` §1.4.
   *
   * `bySide: "opponent"` narrows a `"leave"`/`"ko"` moment to a departure the
   * *opponent's* skill caused, which is what 19 cards print and what only a
   * caller that knows whose skill it is can answer.
   */
  | { op: "replace"; event: ReplaceEvent; by?: "skill" | "skillOrKo"; bySide?: "opponent"; to?: "hand" | "drop"; optional?: boolean; with: Op[]; target?: Ref }
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
   * 20-19: a card that may be rested to pay an energy cost although it is not
   * in the Energy Area — "[Permanent] You can use this card to pay energy
   * costs even when it's in your Battle Area" (BT3-039).
   *
   * Nothing moves: the card stays where it stands and is switched to Rest Mode
   * exactly as an energy card is, which is what separates this from an action
   * price that places a card in the Drop (4-3-3). Stored and read the way
   * `altCost` is — the printed form is [Permanent] and `collectStatics` reads
   * it, `until` is only for a card granting it to others for a span — and it
   * is the *unscoped* permission only: a card that may be used as energy for
   * some payments and not others says so in words this does not carry, so the
   * compiler refuses those rather than offering a wider permission than the
   * card prints.
   */
  | {
      op: "payWith";
      /** What each eligible card counts as: one energy of its own colours, or one orb of the colour named. */
      as?: "energy" | Color;
      /** Omit for "this card". */
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
  /**
   * "Choose one— ・A ・B" (20-2): the master picks one printed option, or
   * `chooser` does when the choice is not theirs to make — the same field
   * `may` reads, since `may` is this op with the second option empty
   * (`docs/arena-ruleset-spec.md` §2.3).
   */
  | { op: "chooseMode"; modes: { label: string; ops: Op[] }[]; reason?: string; chooser?: Side }
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
  | { op: "note"; text: string }
  /**
   * Set a `DEFINE ATTRIBUTE of: player` fact (issue #269) — `grewUnison` after
   * 13-3's growth resolves. `value` defaults to `true`, since every use so far
   * is a program marking something done rather than undoing it; a `reset:` on
   * the declaration is what clears it again, at the turn boundary the
   * declaration names, not this op running in reverse.
   */
  | { op: "setPlayerAttr"; name: string; value?: boolean; side?: Side };

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
/**
 * A card the price may be paid with instead of energy (20-19).
 *
 * "You can use this card to pay energy costs even when it's in your Battle
 * Area" (BT3-039): the card is rested exactly as an energy card is, and while
 * it is eligible it stands in the payment for one energy — of its own colours
 * (`"energy"`), or of the one colour the card names (`{ orb }`). Nothing here
 * moves the card: it stays where it is, which is what separates this from an
 * action price that places a card in the Drop (4-3-3, `CostRecord.program`).
 */
export interface PayWith {
  /** Which cards may stand in. Resolved against the board when the price is planned. */
  sel: Selector;
  /**
   * What each one counts as: one energy of its own colours (`"energy"`), or
   * one orb of the colour named. A colour is written flat rather than as
   * `{ orb }` so the `payWith` **op** can carry the same value in an ordinary
   * `enum` field — the two halves of this feature say one thing, and the
   * printed grammar is `AS energy` / `AS {Red}` either way.
   */
  as: "energy" | Color;
}

export interface SkillPrice {
  condition: Cond | null;
  ops: Op[] | null;
  /**
   * The price charges X energy, chosen on activation (20-5). Present means the
   * skill is offered once per payable value of X and the effect may say `X`;
   * absent means it may not.
   */
  x?: XCost;
  /**
   * Cards this price may be paid with instead of energy (20-19), off the
   * record's `payWith`. Absent means the price is energy and nothing else.
   */
  payWith?: PayWith[];
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
  /** "You can use this card as energy" — cards this price may be paid with instead of energy (20-19). */
  payWith?: PayWith[];
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
  // 20-19: the alternative payers are named before the conditions, because
  // they are part of what the price *is* — "pay 2 energy or use this card as
  // energy" — rather than something it also requires.
  for (const pw of cost.payWith ?? []) parts.push(`or use ${describeSelector(pw.sel)}${pw.as === "energy" ? "" : ` as {${pw.as}}`} as energy`);
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
  /**
   * This frame *is* a replacement's substitute, running in the place of the
   * departure of the card named here (#107). What it moves is moving for real
   * — a substitute cannot replace its own replacement — which is the same
   * thing `state.ts`'s `applyingReplacement` says for the synchronous half,
   * said on the frame instead because this one survives a suspension.
   */
  replacing?: string;
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

export function replacementPrompt(card: string, to: Area, choices: ReplacementChoice[], allowNone: boolean): { reason: string; options: string[] } {
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
    reason: `${card}: choose what happens instead of going to ${area(to)}`,
    // A substitute has no destination of its own — the card stays where it is
    // and its program happens in the departure's place — so the option is the
    // program in words rather than an area.
    options: [
      ...choices.map((c) => (c.to ? `To ${area(c.to)}${c.mode === "rest" ? " in Rest Mode" : ""}` : `Instead: ${describeScript(c.ops ?? [])}`)),
      ...(allowNone ? [`Keep going to ${area(to)}`] : []),
    ],
  };
}

function pickedReplacement(loop: NonNullable<ScriptFrame["moveLoop"]>, index: number | null): ReplacementResult | null | undefined {
  if (!loop.choices?.length) return undefined;
  if (index == null || index < 0 || index >= loop.choices.length) return null;
  const picked = loop.choices[index];
  return picked ? routeOf(picked) : null;
}

/** One applicable replacement as `move()` takes it: a destination, or a program to run in the departure's place. */
export function routeOf(c: ReplacementChoice): ReplacementResult {
  return { ...(c.to ? { to: c.to } : {}), mode: c.mode, ...(c.ops ? { ops: c.ops, source: c.source, master: c.master } : {}) };
}

/**
 * Does this route's program have to be run by the caller rather than by
 * `move()` (#107)? Only when it stops to ask: `move()` is synchronous and a
 * question inside it would be lost, but a frame on the flow can wait. A
 * question-free substitute keeps running inline, exactly where it always did,
 * so nothing a rule already played changes.
 */
function defers(r: ReplacementResult | null | undefined): boolean {
  return !!r?.ops?.length && asksAQuestion(r.ops);
}

/** The substitute as a program of its own: the card whose departure it replaced is its `subject` (9-10-1-1). */
function substituteFrame(h: ScriptHost, id: string, r: ReplacementResult): ScriptFrame {
  return { ops: r.ops ?? [], ip: 0, vars: {}, card: r.source ?? id, master: r.master ?? h.masterOf(id), subject: id, replacing: id };
}

/**
 * Run a program until it finishes or needs a decision. Returns "wait" with a
 * prompt set and the frame pushed back onto the flow; "done" when the program
 * ended or a sub-flow (playing a card) took over.
 */
export function stepScript(h: ScriptHost, frame: ScriptFrame): "done" | "wait" {
  const master = frame.master;

  for (let guard = 0; guard < 200; guard++) {
    if (frame.ip >= frame.ops.length) {
      // A skill's price is its own program, run before the effect (4-3-3), but
      // the effect may point back at what the price chose: "Choose 1 {Tree of
      // Might} … and place this card under the chosen card: **Add a marker to
      // the chosen card**." Handing the names on is what makes that one skill
      // rather than two.
      if (frame.saveVarsAs) {
        h.saveVars(frame.saveVarsAs, { ...frame.vars });
        // 20-5: and the X a `bindX` choose bound, for the prices that are a
        // choice rather than an energy payment ("discard any number of cards:
        // … X cards"). Under a key of its own rather than folded into the
        // names, so the shape a game saved mid-price reads back is unchanged
        // — the counter window between a price and its effect is exactly
        // where such a game is stored.
        if (frame.x !== undefined) h.saveX(savedXKey(frame.saveVarsAs), frame.x);
      }
      return "done";
    }
    const op = frame.ops[frame.ip];

    switch (op.op) {
      case "note":
        h.note(op.text);
        break;

      case "draw":
        for (const p of sideOf(master, op.side)) {
          const before = h.zone(p, "hand").length;
          h.draw(p, h.amount(frame, op.n));
          // "If you did not draw a card with this skill" (20-16).
          if (p === master && h.zone(p, "hand").length > before) (frame.did ??= {}).draw = true;
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
        const n = h.amount(frame, op.n);
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
          const n = h.amount(frame, op.n);
          const taken: string[] = [];
          for (let i = 0; i < n; i++) {
            const life = h.zone(p, "life")[0];
            if (!life) break;
            h.move(life, "hand", p, { reason: "damage" });
            taken.push(life);
          }
          if (taken.length) {
            h.addDamageTaken(p, taken.length);
            h.log({ type: "damage", player: p, amount: taken.length, critical: false, cards: taken });
            h.pend("dealtDamage", frame.card);
            // 21-3: "when you take damage from an opponent's non-keyword
            // skill" and its mirror. Only the `damage` op reaches here —
            // battle damage takes a different path — so the "from a skill"
            // half of those wordings is the moment itself. The cards that add
            // "from a skill on one of your Battle Cards" are answered by the
            // area the source sits in.
            const src = frame.card && h.areaOf(frame.card);
            const fromBoard = src === "battle" || src === "unison" || src === "leader";
            if (fromBoard) {
              for (const w of h.cardsInPlay(p)) h.pend("youTookDamage", w, frame.card);
              for (const w of h.cardsInPlay(p === "p1" ? "p2" : "p1")) h.pend("opponentTookDamage", w, frame.card);
            }
            // 3-9: the life cards themselves left the Life Area.
            for (const w of h.cardsInPlay(p)) h.pend("lifeLeft", w, taken[0]);
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
          const n = h.amount(frame, op.n);
          for (let i = 0; i < n && h.zone(p, "deck").length; i++) {
            const id = h.zone(p, "deck")[0];
            h.move(id, "drop", p, { reason: "effect", reveal: true });
            milled.push(id);
          }
        }
        if (op.as) frame.vars[op.as] = milled;
        break;
      }

      case "addLife":
        for (const p of sideOf(master, op.side)) {
          const n = h.amount(frame, op.n);
          for (let i = 0; i < n && h.zone(p, "deck").length; i++) h.move(h.zone(p, "deck")[0], "life", p, { reason: "effect" });
        }
        break;

      case "lifeDownTo":
        // Losing life this way is not damage (1-13-2), so nothing triggers on it.
        for (const p of sideOf(master, op.side)) {
          while (h.zone(p, "life").length > op.n) h.move(h.zone(p, "life")[0], "hand", p, { reason: "effect" });
        }
        break;

      case "shuffle":
        // 5-11: the engine reshuffles at the next draw; record it so the log reads right.
        for (const p of sideOf(master, op.side)) h.log({ type: "note", text: `${h.playerName(p)} shuffles their deck` });
        h.shuffleDecks(sideOf(master, op.side));
        break;

      case "energyMarker":
        for (const p of sideOf(master, op.side)) {
          const n = h.amount(frame, op.n);
          h.changeEnergyMarkers(p, n);
        }
        break;

      case "setPlayerAttr":
        for (const p of sideOf(master, op.side)) h.setPlayerAttr(p, op.name, op.value ?? true);
        break;

      case "look": {
        // 20-11: looking is not revealing — only the player looking sees them,
        // which is why the cards are bound to a name rather than moved.
        const p = sideOf(master, op.side)[0];
        // "Look at your opponent's hand": a whole area rather than an end of
        // the deck, so the count says nothing.
        if (op.area && op.area !== "deck") {
          frame.vars[op.as] = h.resolveSelector(frame, { side: op.side, area: op.area });
          break;
        }
        const n = h.amount(frame, op.n);
        const deck = h.zone(p, "deck");
        frame.vars[op.as] = op.from === "bottom" ? deck.slice(Math.max(0, deck.length - n)) : deck.slice(0, n);
        break;
      }

      case "reveal": {
        // 20-11-2: revealing shows the cards to both players and leaves them
        // where they are. The log is how the other player gets to see them.
        const shown = h.resolveSelector(frame, op.sel);
        frame.vars[op.as] = shown;
        if (shown.length) h.note(`revealed ${shown.map((id) => h.nameOf(id)).join(", ")}`);
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
        const cands = h.resolveSelector(frame, op.sel).filter((id) => !sofar.includes(id));

        const answer = h.lastChoice();
        if (answer && frame.awaiting === op.as) {
          const picked = [...sofar, ...answer.filter((id) => cands.includes(id))];
          h.clearLastChoice();
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
        h.resume(frame);
        const asked = left === 1 ? "" : ` (${left} more)`;
        h.ask({
          kind: "chooseCards",
          // 20-7: whoever the card says chooses, chooses.
          player: op.chooser ? sideOf(master, op.chooser)[0] : master,
          choice: {
            reason: (op.reason ?? `${h.nameOf(frame.card)}: choose ${op.sel.upTo ? `up to ${want}` : want}`) + asked,
            candidates: cands,
            // One card per answer, so the menu is one action per card.
            min: op.sel.upTo ? 0 : 1,
            max: 1,
            continuation: op.as,
          },
        });
        return "wait";
      }

      case "ko":
        frame.moveLoop ??= { kind: "ko", ids: h.resolveRef(frame, op.target), index: 0, reason: "ko" };
        while (frame.moveLoop && frame.moveLoop.kind === "ko" && frame.moveLoop.index < frame.moveLoop.ids.length) {
          const id = frame.moveLoop.ids[frame.moveLoop.index];
          // 22-12: [Indestructible] cannot be KO'd by an opponent's skill.
          if (h.hasKeyword(id, "Indestructible") && h.masterOf(id) !== master) {
            frame.moveLoop.index++;
            continue;
          }
          // 20-14: the same thing spelled out on the card rather than keyworded.
          if (h.forbids("beKOdBySkill", { player: master, card: id })) {
            frame.moveLoop.index++;
            continue;
          }
          if (h.areaOf(id) === "battle") {
            let replaced: ReplacementResult | null | undefined;
            if (frame.awaiting === "replaceMove") {
              replaced = pickedReplacement(frame.moveLoop, h.lastMode());
              h.clearLastMode();
              frame.awaiting = undefined;
            } else {
              const choices = h.replacementsFor(id, "ko", { actor: master, inSubstitute: !!frame.replacing });
              const allowNone = choices.length > 0 && choices.every((c) => c.optional);
              if (choices.length > 1 || allowNone) {
                frame.awaiting = "replaceMove";
                frame.moveLoop.beforeDrop = h.zone(h.ownerOf(id), "drop").length;
                frame.moveLoop.choices = choices;
                frame.moveLoop.allowNone = allowNone;
                h.resume(frame);
                const prompt = replacementPrompt(h.nameOf(id), "drop", choices, allowNone);
                h.ask({ kind: "replaceMove", player: h.masterOf(id), card: id, reason: prompt.reason, options: prompt.options });
                return "wait";
              }
              // §1.3 of the scoping document: the two suspendable sites decide
              // the replacement themselves and `move()` never looks one up on
              // their behalf, so `null` where there is none.
              replaced = choices.length ? routeOf(choices[0]) : null;
            }
            const before = frame.moveLoop.beforeDrop ?? h.zone(h.ownerOf(id), "drop").length;
            frame.moveLoop.beforeDrop = undefined;
            const deferred = defers(replaced);
            h.ko(id, frame.card, replaced === undefined ? {} : { replaced: deferred ? { ...replaced!, deferred: true } : replaced });
            // "If you KO'd a card" (20-16): only a KO that happened counts.
            if (h.zone(h.ownerOf(id), "drop").length > before) (frame.did ??= {}).ko = true;
            if (deferred) {
              frame.moveLoop.index++;
              h.interrupt(substituteFrame(h, id, replaced!), frame);
              return "done";
            }
          }
          frame.moveLoop.index++;
        }
        frame.moveLoop = undefined;
        break;

      case "moveTo": {
        // 23-2: under a card is not an area of its own, so it is its own move.
        const host = op.to === "under" ? (op.under ? h.resolveRef(frame, op.under)[0] : frame.card) : null;
        frame.moveLoop ??= {
          kind: "moveTo",
          ids: h.resolveRef(frame, op.target),
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
          if (h.areaOf(id) === "leader") {
            frame.moveLoop.index++;
            continue;
          }
          // 20-14: "can't be removed from a Battle Area by your opponent's
          // skills". The rule is about the opponent's skills, so a card its
          // own master moves is unaffected.
          if (h.masterOf(id) !== master && h.areaOf(id) === "battle" && h.forbids("beMovedBySkill", { card: id })) {
            frame.moveLoop.index++;
            continue;
          }
          if (op.to === "under") {
            if (host) h.placeUnder(id, host);
            frame.moveLoop.index++;
            continue;
          }
          const owner = op.owner ? sideOf(master, op.owner)[0] : op.to === "battle" || op.to === "unison" ? master : h.ownerOf(id);
          const dest = op.to === "play" ? "battle" : op.to;
          let replaced: ReplacementResult | null | undefined;
          const leftBattle = frame.moveLoop.leftBattle ?? (h.areaOf(id) === "battle");
          if (frame.awaiting === "replaceMove") {
            replaced = pickedReplacement(frame.moveLoop, h.lastMode());
            h.clearLastMode();
            frame.awaiting = undefined;
          } else {
            const choices = h.replacementsFor(id, "effect", { actor: master, inSubstitute: !!frame.replacing });
            const allowNone = choices.length > 0 && choices.every((c) => c.optional);
            if (choices.length > 1 || allowNone) {
              frame.awaiting = "replaceMove";
              frame.moveLoop.owner = owner;
              frame.moveLoop.to = dest;
              frame.moveLoop.leftBattle = leftBattle;
              frame.moveLoop.choices = choices;
              frame.moveLoop.allowNone = allowNone;
              h.resume(frame);
              const prompt = replacementPrompt(h.nameOf(id), dest, choices, allowNone);
              h.ask({ kind: "replaceMove", player: h.masterOf(id), card: id, reason: prompt.reason, options: prompt.options });
              return "wait";
            }
            replaced = choices.length ? routeOf(choices[0]) : null;
          }
          const deferred = defers(replaced);
          h.move(id, dest, owner, { position: op.position, reveal: op.reveal, reason: "effect", ...(replaced === undefined ? {} : { replaced: deferred ? { ...replaced!, deferred: true } : replaced }) });
          // #107: the departure is already replaced — the card stayed — and
          // the program that stood in for it runs as a frame of its own, so a
          // question inside it is asked rather than lost. Nothing below is
          // about a card that did not move.
          if (deferred) {
            frame.moveLoop.leftBattle = undefined;
            frame.moveLoop.index++;
            h.interrupt(substituteFrame(h, id, replaced!), frame);
            return "done";
          }
          // 3-1: "when this card is removed from a Battle Area by a skill",
          // and the commoner narrowing to the *opponent's* skills. A card that
          // went nowhere — a replacement sent it back — was not removed.
          if (leftBattle && h.areaOf(id) !== "battle") {
            h.pend("removedFromBattle", id);
            if (h.masterOf(id) !== master) h.pend("removedByOpponent", id);
            // The narrower wording, which names where it ended up as well —
            // and the one that names no cause, which covers this too.
            if (h.areaOf(id) === "drop") {
              h.pend("droppedFromBattle", id);
              h.pend("leftBattleToDrop", id);
            }
          }
          if (op.mode) h.setMode(id, op.mode);
          // 5-5: a card a skill *places* in a Battle Area was not played, so
          // "when this card is played" does not fire — 30 cards say only
          // "when this card is placed in a Battle Area".
          if (dest === "battle") h.pend("placed", id);
          // 17-3: "when this card is added to your Z-Energy".
          if (dest === "zEnergy") h.pend("addedToZEnergy", id);
          // "Add it to your life face up" (3-9-2-1): how the card arrives, set
          // after the move because 3-1-4 clears the flag on the way.
          if (op.faceUp) h.setFaceUp(id, true);
          if (dest === "hand" && owner === master) (frame.did ??= {}).addToHand = true;
          frame.moveLoop.leftBattle = undefined;
          frame.moveLoop.index++;
        }
        frame.moveLoop = undefined;
        break;
      }

      case "switchMode":
        for (const id of h.resolveRef(frame, op.target)) {
          const was = h.modeOf(id);
          h.setMode(id, op.mode);
          // "When this card is switched to Rest Mode by one of your skills"
          // (1-10): the card and the skill both have to be yours, which is what
          // "your" says — an opponent resting it is not this moment.
          if (op.mode === "rest" && was === "active" && h.modeOf(id) === "rest") {
            const area = h.areaOf(id);
            if (h.masterOf(id) === master) h.pend("restedBySkill", id, frame.card);
            // The other end of it: your skill resting one of *theirs*, watched
            // by your cards in play. The printed wording names their Battle
            // Cards and energy, so that is where it is pended and nowhere else.
            else if (area === "battle" || area === "energy") {
              for (const w of h.cardsInPlay(master)) h.pend("restedTheirsBySkill", w, id);
            }
          }
        }
        break;

      // 20-9: control, as one move. Out of scope on purpose (#126): a Leader
      // or a Unison Card, which the manual gives no route to take and whose
      // areas hold one card each — the note says so rather than the card
      // silently staying put.
      case "control": {
        const to = sideOf(master, op.to ?? "you")[0];
        for (const id of h.resolveRef(frame, op.target)) {
          const at = h.areaOf(id);
          if (at !== "battle") {
            h.note(`${h.nameOf(id)} can't be taken control of — ${at === "leader" || at === "unison" ? "control of a Leader or a Unison Card is not a thing this engine does" : "only a card in a Battle Area can change hands"}`);
            continue;
          }
          const from = h.masterOf(id);
          if (from === to) continue;
          // 20-9-2: the card keeps its mode, its markers and the continuous
          // effects on it, so the move carries rather than resets (3-1-4-1
          // names gaining control as one of the two carrying moves). The turn
          // it entered play is kept over the top of that, because `move` sets
          // it for any arrival in play and a card changing hands is not a card
          // newly played.
          const entered = h.enteredTurnOf(id);
          h.move(id, "battle", to, { carry: true, reason: "effect" });
          h.setEnteredTurn(id, entered);
          if (op.until) h.addEffect({ master, source: frame.card, target: id, kind: "control", value: 0, until: op.until, control: { from } });
        }
        break;
      }

      // 20-13. Nothing happens now: the entry is spent where the step would
      // begin, which is the only place the whole of 20-13 can be applied at
      // once. "span" (BT21-104, #278) is three of those entries under one
      // name rather than a mechanism of its own — the rest of this turn,
      // the opponent's whole next turn, and this player's own next Charge
      // Phase, landing at that Main Phase exactly as an ordinary "next"
      // Charge skip already does.
      case "skip":
        for (const p of sideOf(master, op.side ?? "you")) {
          if (op.what === "span") {
            h.addSkip(p, "end", "this");
            h.addSkip(sideOf(p, "opponent")[0], "turn", "next");
            h.addSkip(p, "charge", "next");
          } else h.addSkip(p, op.what, op.when ?? "next");
        }
        break;

      case "hidden":
        // 23-5-1: only a Battle Card in a Battle Area can be face down.
        for (const id of h.resolveRef(frame, op.target)) {
          if (h.areaOf(id) !== "battle" || h.isHidden(id) === op.hidden) continue;
          h.setHidden(id, op.hidden);
          h.note(`${op.hidden ? "a Battle Card" : h.nameOf(id)} is switched to ${op.hidden ? "Hidden" : "Revealed"} Mode`);
        }
        break;

      case "flip":
        for (const id of h.resolveRef(frame, op.target)) {
          if (h.isFlipped(id) || !h.hasBack(id) || h.areaOf(id) !== "leader") continue;
          h.flip(id);
        }
        break;

      case "faceUp": {
        const up = op.faceUp ?? true;
        for (const id of h.resolveRef(frame, op.target)) {
          if (h.isFaceUp(id) === up) continue;
          h.setFaceUp(id, up);
          // 3-9-2-1: a face-up card is open to both players, so naming it leaks nothing.
          h.note(`${h.nameOf(id)} is turned face ${up ? "up" : "down"}`);
          if (!up) continue;
          // "When **this card** in your life is flipped face up" is the card
          // itself; "when **a** card in your life is flipped face up" is watched
          // by everything that player has in play. One moment, two wordings.
          const before = h.pendingCount();
          h.pend("flippedFaceUp", id, frame.card);
          for (const w of h.cardsInPlay(h.masterOf(id))) if (w !== id) h.pend("flippedFaceUp", w, id);
          h.dropPendsOfOtherColours(before, frame.card);
        }
        break;
      }

      case "comboFrom": {
        // 5-7-2: a combo card needs a battle to join, on the side of the
        // player whose skill this is.
        const b = h.battle();
        if (!b || (h.masterOf(b.attacker) !== master && h.masterOf(b.guard) !== master)) break;
        for (const id of h.resolveRef(frame, op.target)) {
          if (h.areaOf(id) === "combo") continue;
          h.move(id, "combo", master, { reason: "combo", reveal: true });
          if (op.negated) h.negateAll(id);
          // 5-7-2: a combo a skill makes is a combo. Both sides watch it, the
          // same as one the player declared.
          for (const w of h.cardsInPlay(master)) h.pend("youCombo", w, id);
          for (const w of h.cardsInPlay(master === "p1" ? "p2" : "p1")) h.pend("opponentCombos", w, id);
        }
        break;
      }

      case "redirectAttack": {
        // 8-1: a battle in progress; the new target has to be a Leader or a
        // Battle Card of the defending player that is not already the attacker.
        const b = h.battle();
        if (!b) break;
        const defender = h.masterOf(b.guard);
        const id = h.resolveRef(frame, op.target).find((x) => x !== b.attacker && x !== b.guard && h.masterOf(x) === defender && (h.areaOf(x) === "battle" || h.areaOf(x) === "leader"));
        if (!id) break;
        h.setGuard(id, frame.card);
        h.pend("attacked", id);
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
        const n = h.amount(frame, op.amount ?? 0);
        for (const id of h.resolveRef(frame, op.target ?? { sel: { special: "self" } }))
          h.addEffect({ master: frame.master, source: frame.card, target: id, kind: op.attr, value: n, until: op.until });
        break;
      }

      case "power":
      case "comboPower": {
        const n = h.amount(frame, op.amount);
        for (const id of h.resolveRef(frame, op.target))
          h.addEffect({ master: frame.master, source: frame.card, target: id, kind: op.op === "power" ? "power" : "comboPower", value: n, until: op.until });
        break;
      }

      case "grant":
        for (const id of h.resolveRef(frame, op.target)) h.addEffect({ master: frame.master, source: frame.card, target: id, kind: "keyword", value: op.keyword, until: op.until });
        break;

      case "copySkills": {
        // "Choose up to 1 keyword skill on a card under this card" is a choice
        // among the *skills* of every card the phrase finds, not among the
        // cards — so every source is opened and its skills laid out together.
        const offered: { card: string; side: "front" | "back"; skill: Skill }[] = [];
        for (const src of h.resolveRef(frame, op.from)) {
          if (!h.exists(src)) continue;
          const sd = h.defOf(src);
          const side = h.isFlipped(src) && sd.back ? "back" : "front";
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
        else if (h.lastMode() != null && frame.awaiting === "copySkills") {
          const at = h.lastMode()!;
          h.clearLastMode();
          frame.awaiting = undefined;
          // Every card printing this says "choose **up to** 1", so the last
          // option declines; a single skill is still asked about, because the
          // choice is the player's and not the count's.
          picked = offered[at] ? [offered[at]] : [];
        } else {
          const several = new Set(offered.map((o) => o.card)).size > 1;
          frame.awaiting = "copySkills";
          h.resume(frame);
          h.ask({
            kind: "chooseMode",
            player: master,
            reason: `${h.nameOf(frame.card)}: choose a skill to gain`,
            options: [...offered.map((o) => (several ? `${h.nameOf(o.card)}: ${skillOption(o.skill)}` : skillOption(o.skill))), "None"],
          });
          return "wait";
        }
        if (!picked.length) break;
        const targets = h.resolveRef(frame, op.target ?? { sel: { special: "self" } });
        for (const id of targets)
          for (const src of new Set(picked.map((x) => x.card))) {
            const mine = picked.filter((x) => x.card === src);
            // A pure keyword line is a granted keyword and nothing more
            // (20-18-1); everything else is carried as a copy the target
            // enumerates alongside its own skills.
            const typed = mine.filter((x) => !(x.skill.kind === "keyword" && x.skill.keyword));
            for (const x of mine)
              if (!typed.includes(x)) h.addEffect({ master: frame.master, source: frame.card, target: id, kind: "keyword", value: x.skill.keyword!, until: op.until });
            if (typed.length)
              h.addEffect({
                master: frame.master,
                source: frame.card,
                target: id,
                kind: "copiedSkills",
                value: 0,
                copied: { cardId: h.catalogIdOf(src), side: typed[0].side, skills: typed.map((x) => x.skill.index), from: src, name: h.defOf(src).name },
                until: op.until,
              });
          }
        break;
      }

      case "negateSkills":
        // 9-1-5: for a duration it is a continuous effect that ends with the
        // turn or the battle; "for the game" marks the card until it leaves play.
        for (const id of h.resolveRef(frame, op.target)) {
          // 9-1-5: "This card's skills can't be negated in any area" beats the
          // instruction, like every other prohibition (0-2-5).
          if (h.forbids("beNegated", { card: id })) continue;
          if (op.until === "game") h.negateAll(id);
          else h.addEffect({ master: frame.master, source: frame.card, target: id, kind: "negateSkills", value: 0, until: op.until });
        }
        break;

      case "negateSkillsOfKind":
        // 9-1-5: one kind of skill, not the card. Kept as an effect for the
        // duration the card printed — "in all areas" compiles to the game,
        // and shortening that to a turn here was a silent change of rule.
        for (const id of h.resolveRef(frame, op.target)) {
          if (h.forbids("beNegated", { card: id })) continue;
          h.addEffect({ master: frame.master, source: frame.card, target: id, kind: "negateSkillKind", value: op.kind, until: op.until });
        }
        break;

      case "forbid": {
        // "both" and an absent side alike mean the rule is about neither
        // player in particular, so it holds for both.
        const players = op.side && op.side !== "both" ? sideOf(master, op.side) : [];
        if (op.target) {
          // On a card, the side says *whose* action is forbidden — "can't be
          // KO'd by your opponent's skills" is a rule about the opponent.
          for (const id of h.resolveRef(frame, op.target))
            h.addEffect({
              master: frame.master,
              source: frame.card,
              target: id,
              kind: "forbid",
              value: 0,
              until: op.until,
              forbid: { what: op.what, ...(op.uses != null ? { uses: h.amount(frame, op.uses) } : {}), ...(op.unless ? { unless: op.unless, master: frame.master } : {}), player: players[0] },
            });
          break;
        }
        h.addEffect({
          master: frame.master,
          source: frame.card,
          target: "",
          kind: "forbid",
          value: 0,
          until: op.until,
          forbid: {
            what: op.what,
            ...(op.uses != null ? { uses: h.amount(frame, op.uses) } : {}),
            ...(op.unless ? { unless: op.unless, master: frame.master } : {}),
            player: players[0],
            filter: op.filter,
            name: op.sameNameAsSelf ? h.nameOf(frame.card) : undefined,
          },
        });
        break;
      }

      // 9-1-4: stored the same way `forbid` is, so a duration expires it the
      // same way; enforced in `resolveSelector` (state.ts), beside [Barrier]
      // and `forbid: "beChosen"`.
      case "immune": {
        const players = op.from && op.from !== "both" ? sideOf(master, op.from) : [];
        const targets = op.target ? h.resolveRef(frame, op.target) : [frame.card];
        for (const id of targets)
          h.addEffect({ master: frame.master, source: frame.card, target: id, kind: "immune", value: 0, until: op.until, immune: { from: players[0], fromFilter: op.fromFilter } });
        break;
      }

      // 8-1-1 lifted for one card — the opposite of `forbid`, and stored the
      // same way so that a duration expires it the same way.
      case "permit":
        for (const id of h.resolveRef(frame, op.target)) {
          h.addEffect({ master: frame.master, source: frame.card, target: id, kind: "permit", value: 0, until: op.until, permit: { what: op.what, filter: op.filter } });
        }
        break;

      case "addMarker":
      case "removeMarker": {
        const n = h.amount(frame, op.n) * (op.op === "addMarker" ? 1 : -1);
        for (const id of h.resolveRef(frame, op.target)) {
          h.changeMarkers(id, n);
          if (n < 0) h.pend("markerRemoved", id);
        }
        break;
      }

      case "token": {
        const n = h.amount(frame, op.n);
        const p = sideOf(master, op.side)[0];
        for (let i = 0; i < n; i++) {
          const id = h.createToken(p, op.name, op.power, op.comboCost, op.comboPower, op.colors);
          h.pend("played", id);
        }
        break;
      }

      case "costReduction": {
        // On a [Permanent] this never runs: `collectStatics` reads the op and
        // emits a standing effect. Reaching it here means an [Auto] or an
        // [Activate] said the same thing with a duration on it — XD1-05's
        // "…by 1 for the duration of the turn" — and a skill that resolves has
        // to put it in force itself, or it resolves to nothing at all.
        const by = h.amount(frame, op.amount);
        if (!by) break;
        // "specified" carries its own value shape — see `collectStatics` and
        // `playCost` (state.ts) — because the colours it relaxes, not a flat
        // number, are what a reader needs to apply it.
        if (op.what === "specified") {
          if (!op.colors?.length) break;
          const sign: 1 | -1 = by < 0 ? -1 : 1;
          for (const id of h.resolveRef(frame, op.target)) {
            h.addEffect({ master: frame.master, source: frame.card, target: id, kind: "specifiedCost", value: { colors: op.colors, sign }, until: op.until ?? "turn" });
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
        for (const id of h.resolveRef(frame, op.target)) {
          h.addEffect({
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

      // 9-10. A replacement of a departure is a standing offer that `move()`
      // reads when the moment comes, so like `replaceLeave` above it is
      // collected by `collectStatics` and does nothing here. A replacement of
      // the play being resolved has a moment of its own — now — and is the one
      // implementation `resolvingPlay` below is the macro over.
      case "replace":
        if (op.event === "play") h.replaceResolvingPlay(op.with);
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
        for (const id of h.resolveRef(frame, op.target ?? { sel: { special: "self" } }))
          h.addEffect({ master: frame.master, source: frame.card, target: id, kind: "altCost", value: 0, until: op.until, altCost: value });
        break;
      }

      // 20-19, and the same shape as `altCost` above for the same reason: the
      // printed form is a [Permanent] that never resolves and `collectStatics`
      // reads it there. Reaching this case means a card granted the permission
      // for a span, so it is applied to whatever the selector names now.
      case "payWith": {
        if (!op.until) break;
        for (const id of h.resolveRef(frame, op.target ?? { sel: { special: "self" } }))
          h.addEffect({ master: frame.master, source: frame.card, target: id, kind: "payer", value: 0, until: op.until, payAs: op.as ?? "energy" });
        break;
      }

      case "resolvingPlay": {
        if (!op.instead) {
          // The play still happens and only its manner changes, which is not a
          // replacement at all (9-6): `resolvePlay` reads these as the card
          // enters. Only the `instead` branch below is the macro over `replace`
          // that `OP_CLASS` calls it.
          const card = h.resolvingCard();
          if (!card) break;
          if (op.mode === "rest") h.setPlayRest(card);
          if (op.negated) h.setPlayNegated(card);
          break;
        }
        h.replaceResolvingPlay([{ op: "moveTo", target: { sel: { special: "resolving" } }, to: op.instead, ...(op.position ? { position: op.position } : {}) }]);
        break;
      }

      case "negateAttack":
        {
          const b = h.battle();
          if (b) {
            h.negateAttack();
            // "If you negated a Leader Card's attack with this skill" (20-16).
            const did = (frame.did ??= {});
            did.negateAttack = true;
            if (h.areaOf(b.attacker) === "leader") did.negateLeaderAttack = true;
          }
        }
        break;

      case "negateOwnSkill": {
        // 9-1-5: the skill switches itself off for the rest of the game.
        // `negated` is a list of skill indexes on the instance, so this is the
        // same mechanism another card's negation uses — and it is cleared when
        // the card leaves play, because that is a different card (3-1-4).
        if (!h.exists(frame.card) || frame.skillIndex == null) break;
        const off = h.negatedSkills(frame.card);
        if (off === "all" || off.includes(frame.skillIndex)) break;
        if (op.until === "turn" || op.until === "battle") {
          // "Negate this skill for the turn / for the battle": it comes back,
          // so an effect with a duration rather than a mark on the instance.
          h.addEffect({ master: frame.master, source: frame.card, target: frame.card, kind: "negateSkill", value: frame.skillIndex, until: op.until });
          h.note(`${h.nameOf(frame.card)}: that skill will not happen again this ${op.until}`);
          break;
        }
        h.negateSkillIndex(frame.card, frame.skillIndex);
        h.note(`${h.nameOf(frame.card)}: that skill will not happen again`);
        break;
      }

      case "negateCounter": {
        // The counter being answered is the first one still waiting in the
        // flow: this effect is running inside the window opened over it.
        const countered = h.negateCounterInFlight();
        if (countered) h.note(`${h.nameOf(countered)} is countered`);
        break;
      }

      case "play": {
        // 5-5-3: played by a skill, so no energy cost is paid — but a card
        // that may not be played may not be played by a skill either (20-14).
        // 20-14: a skill doing the playing, which is the half fifteen cards ban.
        const targets = h.resolveRef(frame, op.target).filter((id) => !h.forbids("play", { player: master, card: id, bySkill: true }));
        if (!targets.length) break;
        const onto = op.onto ? h.resolveRef(frame, op.onto)[0] : undefined;
        (frame.did ??= {}).play = true;
        frame.ip++;
        h.playThen(targets, { player: master, mode: op.mode, onto, negated: op.negated }, frame);
        return "done";
      }

      case "delay":
        // The variables are copied, not shared: a later `choose` in this same
        // program must not change what the delayed part points at.
        h.schedule({
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
        const branch = h.condHolds(frame, op.cond) ? op.then : (op.else ?? []);
        // Splice the branch in place of the `if`, keeping one frame.
        frame.ops = [...frame.ops.slice(0, frame.ip), ...branch, ...frame.ops.slice(frame.ip + 1)];
        continue;
      }

      case "may": {
        // Asked and answered: splice the ops in, or step over them. Either way
        // the answer is remembered, so "if you do" and "if you don't" can read
        // it (20-16).
        if (h.lastMode() != null && frame.awaiting === "may") {
          const yes = h.lastMode() === 0;
          h.clearLastMode();
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
        h.resume(frame);
        h.ask({
          kind: "chooseMode",
          // 20-16: whoever the card says may do it, decides. The skill is
          // still yours — only the answer is theirs.
          player: op.chooser ? sideOf(master, op.chooser)[0] : master,
          reason: op.reason ?? `${h.nameOf(frame.card)}: optional`,
          options: [op.reason ?? "Do it", "Don't"],
        });
        return "wait";
      }

      case "chooseMode": {
        // 20-2: the option is chosen as the skill resolves, and only then does
        // the rest of the program exist — so it is spliced in like an `if`.
        if (h.lastMode() != null && frame.awaiting === "mode") {
          const index = h.lastMode()!;
          const picked = op.modes[index] ?? op.modes[0];
          h.clearLastMode();
          frame.awaiting = undefined;
          // "You may …" (20-16) is this op with a second, empty option — that
          // shape is what `may` lowers to (#273) — and the answer is bound
          // either way, so "if you do" / "if you don't" reads it downstream
          // the same as the native `may` op does.
          if (op.modes.length === 2 && !op.modes[1].ops.length) (frame.did ??= {}).may = index === 0;
          frame.ops = [...frame.ops.slice(0, frame.ip), ...(picked?.ops ?? []), ...frame.ops.slice(frame.ip + 1)];
          continue;
        }
        // A single declared option is not a choice. Two are, even when one of
        // them is empty — "you may" is exactly that shape, and dropping the
        // empty one here would mean it was never actually offered (#273).
        if (op.modes.length <= 1) {
          frame.ops = [...frame.ops.slice(0, frame.ip), ...(op.modes[0]?.ops ?? []), ...frame.ops.slice(frame.ip + 1)];
          continue;
        }
        frame.awaiting = "mode";
        h.resume(frame);
        h.ask({
          kind: "chooseMode",
          player: op.chooser ? sideOf(master, op.chooser)[0] : master,
          reason: op.reason ?? `${h.nameOf(frame.card)}: choose one`,
          options: op.modes.map((mode) => mode.label),
        });
        return "wait";
      }
    }
    frame.ip++;
  }
  h.note("effect did not finish: too many steps");
  return "done";
}

export * from "./script-schema";
// Named as well as starred, for the same reason `engine/compile.ts` names its
// entry points: through an import cycle an `export *` name is not instantiated,
// and `arena:readings` died on `does not provide an export named
// "describeScript"`.
export { describeScript, describeCond, describeFilter } from "./script-schema";
