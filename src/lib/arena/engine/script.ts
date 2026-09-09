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
import type { CardFilter } from "./filters";
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
import type { Area, Color, DelayScope, DelayTiming, FlowStep, ForbiddenAction, GameEvent, GameState, KeywordSkill, MoveReason, PlayerId, ReplacementChoice, ReplacementResult, SkillKindPrefix, Trigger } from "./types";

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
 * A number an effect needs. `count` is read off the board — "for each of your
 * ≪Saiyan≫ cards" — and `times` multiplies it, because cards say "+5000 power
 * for each" far more often than they say "1 for each".
 */
export type Amount =
  | number
  | { var: string }
  | { count: Selector; times?: number }
  /** The total power of the cards bound to a name — "the cards switched to Rest Mode by this skill" ([Alliance], 22-32). */
  | { sumPower: { var: string } }
  /** "Draw cards until you have 4 cards in your hand": however many that takes, never fewer than none. */
  | { handUpTo: number }
  /** "For each marker on this card, +5000 power" — the markers on the selected cards, added up, the same board fact the `markers` condition asks about. */
  | { markers: Selector; times?: number };

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
  | { op: "choose"; sel: Selector; as: string; reason?: string; chooser?: Side }
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
  | { op: "power"; target: Ref; amount: Amount; until: Duration }
  | { op: "comboPower"; target: Ref; amount: Amount; until: Duration }
  | { op: "grant"; target: Ref; keyword: KeywordSkill; until: Duration }
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
   * combo cost (5-7-3), the Z-Energy cost (5-4) a Z-Card pays out of the
   * Z-Energy Area rather than the hand, or the **specified** (coloured) part
   * of an X-cost card's price — owner's ruling on BT19-039, 9 Sep 2026,
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
  | { op: "costReduction"; target: Ref; amount: Amount; what?: "energy" | "combo" | "zEnergy" | "specified"; colors?: (Color | "any")[]; until?: Duration }
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
   * with Battle Cards"), optionally narrowed by a filter.
   */
  | { op: "forbid"; what: ForbiddenAction; until: Duration; target?: Ref; side?: Side; filter?: CardFilter; sameNameAsSelf?: boolean; bySkill?: boolean }
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
      if (frame.saveVarsAs) s.continuations[frame.saveVarsAs] = { ...frame.vars };
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
              const allowNone = choices.every((c) => c.optional);
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
            const allowNone = choices.every((c) => c.optional);
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
            addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind: "forbid", value: 0, until: op.until, forbid: { what: op.what, player: players[0] } });
          break;
        }
        addEffect(s, ev, {
          master: frame.master,
          source: frame.card,
          target: "",
          kind: "forbid",
          value: 0,
          until: op.until,
          forbid: { what: op.what, player: players[0], filter: op.filter, name: op.sameNameAsSelf ? face(ctx, s, frame.card).name : undefined },
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
        const kind = op.what === "combo" ? "comboCost" : op.what === "zEnergy" ? "zEnergy" : "cost";
        for (const id of resolveRef(ctx, s, frame, op.target)) {
          addEffect(s, ev, { master: frame.master, source: frame.card, target: id, kind, value: by, until: op.until ?? "turn" });
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

// ── the schema: one row per op, read by everything that is not the interpreter ──

/**
 * What each field of each op is. `validateProgram`, `describeScript`, the
 * referee's prompt and the workbench's editor all read this table, so adding
 * an op is one interpreter case above and one row here — nowhere else.
 *
 * `{ enum }` lists the values a field may take; `{ list }` is an array of
 * strings or of one enum. `keyword` is a `KeywordSkill` object, `filter` a
 * `CardFilter`, `modes` the `chooseMode` options.
 */
export type FieldType =
  | "amount"
  | "ref"
  | "selector"
  | "side"
  | "area"
  | "duration"
  | "cond"
  | "conds"
  | "ops"
  | "string"
  | "number"
  | "boolean"
  | "keyword"
  | "filter"
  | "modes"
  | { enum: readonly string[] }
  | { list: "string" | { enum: readonly string[] } };

export interface OpField {
  name: string;
  type: FieldType;
  required?: boolean;
  /** What the interpreter assumes when the field is left out. */
  default?: unknown;
  /** `null` is a value here ("no combo cost"), not an omission. */
  nullable?: boolean;
}

/**
 * `sentence` is the op in words. A string is a template: `{field}` renders
 * the field, `{field:hint}` hands the describer a hint (a noun for an amount,
 * "A|B" for a side, boolean or two-valued enum, a fallback for a string,
 * filter or list of ops), and `{field? text with {field}}` renders only when
 * the field is set. Four ops whose prose turns on how their fields combine
 * carry a function instead. `doc` is the one line the referee is told.
 */
export interface OpSpec {
  fields: OpField[];
  sentence: string | ((op: Op, r: RenderOptions) => string);
  doc?: string;
}

export interface RenderOptions {
  /** A [Permanent] holds while its card is where the skill is valid (9-5-1), so no duration is said. */
  permanent?: boolean;
}

const COLORS = ["Red", "Blue", "Green", "Yellow", "Black", "White", "Colorless"] as const satisfies readonly Color[];
export const SIDES = ["you", "opponent", "both"] as const satisfies readonly Side[];
export const SPECIAL_TARGETS = ["self", "attacker", "guard", "subject", "leader", "opponentLeader", "resolving", "onTop"] as const satisfies readonly SpecialTarget[];
export const AREAS = ["hand", "deck", "drop", "life", "battle", "combo", "energy", "unison", "leader", "warp", "zDeck", "zEnergy", "under", "play", "removed"] as const satisfies readonly ScriptArea[];
export const DURATIONS = ["battle", "turn", "opponentTurn", "nextTurn", "afterNextCharge", "game"] as const satisfies readonly Duration[];
const DELAY_TIMINGS = ["turnStart", "mainStart", "turnEnd", "turnCleanup", "battleEnd"] as const satisfies readonly DelayTiming[];
const DELAY_SCOPES = ["thisTurn", "nextTurn", "yourNextTurn", "opponentNextTurn"] as const satisfies readonly DelayScope[];
const SKILL_KIND_PREFIXES = ["auto", "activate", "counter", "permanent"] as const satisfies readonly SkillKindPrefix[];
export const KEYWORD_NAMES = [
  "Awaken", "Wish", "Field", "Blocker", "Critical", "Strike", "Attack", "Revenge", "Indestructible", "Barrier", "Deflect", "Unique", "Servant", "Energy-Exhaust", "Victory Strike",
  "Warrior of Universe 7", "Ultimate", "Super Combo", "Dragon Ball", "Wormhole", "Invoker", "Heroic", "Villainous", "Offering", "Evolve", "Union", "Over Realm", "Swap", "Arrival", "Aegis",
  "Alliance", "Revive", "Successor", "Overlord", "Rejuvenate", "Spirit Boost", "Empower", "Z-Awaken", "Z-Stack",
] as const satisfies readonly KeywordSkill["name"][];
// A keyword the parser knows but this list does not would fail the referee and the editor silently; make it fail the typecheck instead.
type MissingKeyword = Exclude<KeywordSkill["name"], (typeof KEYWORD_NAMES)[number]>;
const _everyKeywordListed: MissingKeyword extends never ? true : never = true;
void _everyKeywordListed;

/** Each prohibition as the verb phrase a sentence needs after "can't". Shared with `effects.ts`, so the inspector and the board say the same thing. */
export const FORBIDDEN_IN_WORDS: Record<ForbiddenAction, string> = {
  attack: "attack",
  beAttacked: "be attacked",
  block: "block",
  play: "play cards",
  activateSkill: "activate skills",
  activateCounter: "activate [Counter] skills",
  combo: "combo",
  beKOd: "be KO'd",
  beKOdBySkill: "be KO'd by skills",
  beChosen: "be chosen by skills",
  switchToActive: "switch to Active Mode",
  placeEnergy: "place cards in the Energy Area",
  beMovedBySkill: "be removed from a Battle Area by skills",
  beNegated: "have their skills negated",
};
const FORBIDDEN_ACTIONS = Object.keys(FORBIDDEN_IN_WORDS) as readonly ForbiddenAction[];

const SIDE: OpField = { name: "side", type: "side", default: "you" };
const TARGET: OpField = { name: "target", type: "ref", required: true };
/** `costReduction`'s fields, named so its `sentence` function (below) can hand them to `renderTemplate` for the non-"specified" branch without reaching into `OP_SCHEMA` mid-construction. */
const COST_REDUCTION_FIELDS: OpField[] = [
  TARGET,
  { name: "amount", type: "amount", required: true },
  { name: "what", type: { enum: ["energy", "combo", "zEnergy", "specified"] }, default: "energy" },
  { name: "colors", type: { list: { enum: ["any", ...COLORS] } } },
  { name: "until", type: "duration" },
];
const SELF: OpField = { name: "target", type: "ref", default: { sel: { special: "self" } } };
const UNTIL: OpField = { name: "until", type: "duration", required: true };
const MODE = { enum: ["active", "rest"] } as const;
const POSITION = { enum: ["top", "bottom"] } as const;
const n = (required = true): OpField => ({ name: "n", type: "amount", required });

type OpOf<K extends Op["op"]> = Extract<Op, { op: K }>;

export const OP_SCHEMA: Record<Op["op"], OpSpec> = {
  draw: { fields: [n(), SIDE], sentence: "{side:opponent draws|draw} {n}" },
  discard: { fields: [n(), SIDE, { name: "to", type: { enum: ["warp"] } }], sentence: "{side:opponent discards|discard} {n}{to? to the Warp}", doc: 'cards leave a hand for the Drop (20-7); "to":"warp" for the Warp' },
  damage: { fields: [n(), SIDE], sentence: "deal {n} damage", doc: "life to hand" },
  mill: { fields: [n(), SIDE, { name: "as", type: "string" }], sentence: "{n} from the top of the deck to the Drop", doc: 'deck to Drop; "as" names the cards for a later clause ("if that card is red")' },
  addLife: { fields: [n(), SIDE], sentence: "add {n} to life" },
  lifeDownTo: { fields: [{ name: "n", type: "number", required: true }, SIDE], sentence: "life down to {n}, the cards going to hand", doc: "add cards from life to hand until that many life remain (21-3-2)" },
  shuffle: { fields: [SIDE], sentence: "shuffle" },
  energyMarker: { fields: [n(), SIDE], sentence: "{n} energy marker" },
  choose: {
    fields: [{ name: "sel", type: "selector", required: true }, { name: "as", type: "string", required: true }, { name: "reason", type: "string" }, { name: "chooser", type: "side" }],
    sentence: "choose {sel}",
    doc: 'binds the chosen cards to the name in "as"; "chooser":"opponent" when the card says *they* choose ("your opponent sends 1 Battle Card…")',
  },
  look: {
    fields: [n(), { name: "as", type: "string", required: true }, SIDE, { name: "from", type: POSITION, default: "top" }, { name: "area", type: "area", default: "deck" }],
    sentence: "look at the top {n}",
    doc: "top of your deck, seen only by you; the cards are bound to the name in \"as\" (20-11)",
  },
  reveal: { fields: [{ name: "sel", type: "selector", required: true }, { name: "as", type: "string", required: true }], sentence: "reveal {sel}", doc: "shown to both players; the cards stay where they are (20-11-2)" },
  ko: { fields: [TARGET], sentence: "KO {target}" },
  moveTo: {
    fields: [
      TARGET,
      { name: "to", type: "area", required: true },
      { name: "position", type: POSITION },
      { name: "mode", type: MODE },
      { name: "reveal", type: "boolean" },
      { name: "under", type: "ref" },
      { name: "owner", type: "side" },
      { name: "faceUp", type: "boolean" },
    ],
    sentence: "move {target} to {to}{faceUp? face up}",
    doc: '"to":"under" puts the card under "under" (or under this card, 23-2); "owner":"opponent" for "place it in your opponent\'s energy" — the area is theirs, not the card owner\'s (3-8)',
  },
  play: {
    fields: [TARGET, { name: "mode", type: MODE }, { name: "onto", type: "ref" }, { name: "negated", type: { enum: ["turn", "game"] } }],
    sentence: "play {target}{mode? in {mode} mode}",
    doc: '"onto" plays it on top of another card ([Union-Absorb], 22-13-6-3); "negated" is "played with its skills negated" (9-1-5)',
  },
  switchMode: { fields: [TARGET, { name: "mode", type: MODE, required: true }], sentence: "switch {target} to {mode} mode" },
  power: {
    fields: [TARGET, { name: "amount", type: "amount", required: true }, UNTIL],
    sentence: "{target} {amount:power}{until}",
    doc: 'an amount may also be {"count":SELECTOR,"times":5000} (so much for each card) or {"sumPower":{"var":"rested"}} (the total power of named cards)',
  },
  comboPower: { fields: [TARGET, { name: "amount", type: "amount", required: true }, UNTIL], sentence: "{target} {amount:combo power}{until}" },
  grant: { fields: [TARGET, { name: "keyword", type: "keyword", required: true }, UNTIL], sentence: "{target} gains [{keyword}]{until}" },
  negateSkills: { fields: [TARGET, UNTIL], sentence: "negate the skills of {target}{until}" },
  negateSkillsOfKind: {
    fields: [TARGET, { name: "kind", type: { enum: SKILL_KIND_PREFIXES }, required: true }, UNTIL],
    sentence: "negate the [{kind:auto=Auto|activate=Activate|counter=Counter|permanent=Permanent}] skills of {target}{until}",
    doc: '"negate that card\'s [Auto] skill for the turn" — one kind, not the whole card (9-1-5)',
  },
  hidden: { fields: [TARGET, { name: "hidden", type: "boolean", required: true }], sentence: "switch {target} to {hidden:Hidden|Revealed} Mode", doc: "Hidden Mode / Revealed Mode (23-5)" },
  redirectAttack: { fields: [TARGET], sentence: "switch the target of the attack to {target}", doc: '"switch the target of the attack to it" (22-4-2)' },
  comboFrom: { fields: [TARGET, { name: "negated", type: "boolean" }], sentence: "use {target} in a combo{negated? with its skills negated}", doc: '"use it in a combo from your Drop (with its skills negated)" (5-7)' },
  flip: { fields: [TARGET], sentence: "flip {target} over", doc: 'a Leader awakens ("flip this card over", 22-2-4)' },
  faceUp: { fields: [TARGET, { name: "faceUp", type: "boolean", default: true }], sentence: "turn {target} face {faceUp:up|down}", doc: "turn a card in a life area face up (3-9-2-1); false turns it back down" },
  addMarker: { fields: [TARGET, n()], sentence: "add {n} marker" },
  removeMarker: { fields: [TARGET, n()], sentence: "remove {n} marker" },
  token: {
    fields: [
      { name: "name", type: "string", required: true },
      { name: "power", type: "number", required: true },
      { name: "comboCost", type: "number", required: true, nullable: true },
      { name: "comboPower", type: "number", required: true, nullable: true },
      { name: "colors", type: { list: { enum: COLORS } }, required: true },
      n(),
      SIDE,
    ],
    sentence: "play {n} {name} ({power} power)",
    doc: 'a token (19): {"op":"token","name":"Saibaman Token","power":10000,"comboCost":0,"comboPower":5000,"colors":[],"n":2}',
  },
  costReduction: {
    fields: COST_REDUCTION_FIELDS,
    // "Specified" is not "costs N less" — that would say the total moved,
    // which is exactly what the owner's ruling on BT19-039 (9 Sep 2026) says
    // it does not — so it gets its own sentence rather than sharing the
    // generic template's `{amount:less|more}`, which knows only a flat
    // number and would print a true-looking but wrong reading.
    sentence: (raw, r) => {
      const op = raw as OpOf<"costReduction">;
      if (op.what !== "specified") return renderTemplate("{target} costs {amount:less|more}", raw as unknown as Record<string, unknown>, COST_REDUCTION_FIELDS, r);
      const counts = new Map<string, number>();
      for (const c of op.colors ?? []) counts.set(c, (counts.get(c) ?? 0) + 1);
      const orbs = [...counts.entries()].map(([c, n]) => `${n} ${c === "any" ? "energy" : c.toLowerCase()}`).join(", ");
      const amt = typeof op.amount === "number" ? op.amount : 0;
      return `${describeRef(op.target)}'s specified cost is ${amt < 0 ? `${-amt} more` : `${amt} less`}${orbs ? ` (${orbs})` : ""}`;
    },
    doc: '[Permanent] only unless a duration is given (20-21): "reduce the energy cost of your <Son Goku> cards in your hand by 1" — the selector names the area the text names, usually the hand; "zEnergy" is the Z-Energy cost a Z-Card pays from the Z-Energy Area (5-4), read by `zEnergyCostOf`, never `d.zEnergyCost` raw. "specified" is the coloured part of an X-cost card\'s price (owner\'s ruling on BT19-039, 9 Sep 2026): it never touches the total, only which colours `playCost` demands, and `colors` carries the orbs it relaxes — always printed as `{u}`/`{y}{y}`/…, never a bare count.',
  },
  negateKeyword: { fields: [{ name: "keyword", type: { enum: KEYWORD_NAMES }, required: true }, SELF], sentence: "negate the [{keyword}] skill of {target}", doc: 'take one named keyword away ("negate this card\'s [Energy-Exhaust] skill in all areas", 9-1-5); the keyword is its printed name, e.g. "Blocker"' },
  gains: {
    fields: [
      { name: "traits", type: { list: "string" } },
      { name: "characters", type: { list: "string" } },
      { name: "colors", type: { list: { enum: COLORS } } },
      { name: "names", type: { list: "string" } },
      SELF,
    ],
    // A literal brace cannot appear in a template — `renderTemplate` reads it
    // as a field — so a gained card name is written out in words instead.
    sentence: "{target} also counts as{traits? ≪{traits}≫}{characters? <{characters}>}{colors? {colors}}{names? the card named {names}}",
    doc: 'the card counts as having these too, wherever it is ("gains ≪Saiyan≫ in all areas", "is also treated as red", 20-1); "names" is a whole card name it is also treated as ("also treated as {Planet M-2}"), never a replacement for its own',
  },
  replaceLeave: {
    fields: [{ name: "to", type: "area", required: true }, { name: "by", type: { enum: ["skill", "ko", "skillOrKo"] } }, { name: "mode", type: MODE }, { name: "optional", type: "boolean" }, SELF],
    sentence: (raw) => {
      const op = raw as OpOf<"replaceLeave">;
      const cause = op.by === "ko" ? "be KO'd" : op.by === "skill" ? "be removed from the Battle Area by a skill" : op.by === "skillOrKo" ? "be removed from the Battle Area by a skill or KO'd" : "leave the Battle Area";
      return `if ${describeRef(op.target ?? { sel: { special: "self" } })} would ${cause}, it ${op.optional ? "may go" : "goes"} to the ${op.to}${op.mode === "rest" ? " in Rest Mode" : ""} instead`;
    },
    doc: '[Permanent] only (9-10): "if this card would be KO\'d, send it to the Warp instead". "by" is which departure it replaces: omitted = any, "skill" = removed by an effect, "ko" = the KO, "skillOrKo" = either. "optional" is 9-10-3\'s "you may". Omit "target" for this card',
  },
  altCost: {
    fields: [
      { name: "pay", type: { enum: ["none", "life", "program", "energy"] }, required: true },
      { name: "n", type: "number" },
      { name: "for", type: { enum: ["counter", "play"] }, default: "counter" },
      { name: "ops", type: "ops" },
      { name: "orbs", type: { list: { enum: ["any", ...COLORS] } } },
      SELF,
      { name: "until", type: "duration" },
    ],
    sentence: (raw, r) => {
      const op = raw as OpOf<"altCost">;
      const price =
        op.pay === "none"
          ? "for no energy"
          : op.pay === "program"
            ? `by: ${describeScript(op.ops ?? [], r)}`
            : op.pay === "energy"
              ? `for ${(op.orbs ?? []).map((o) => (o === "any" ? "{any}" : `{${o}}`)).join("")}`
              : `by adding ${op.n ?? 1} from your life to your hand`;
      const who = op.target ? describeRef(op.target) : "this card";
      const until = op.until ? ` until ${op.until === "game" ? "the game ends" : op.until}` : "";
      return `${op.for === "play" ? `${who} may be played` : `${who}'s [Counter] may be activated`} ${price}${until}`;
    },
    doc: 'another way to pay for a [Counter] (or a play, "for":"play") (5-3) — "none", "life" (n cards), a reduced "energy" price ("orbs"), or a "program" the card asks for instead. Printed on the card itself this is [Permanent]-only and omits "target"/"until"; a card that grants it to *other* cards for a span carries both — "Until the start of your next turn, you can activate mono-blue cards with [Counter] skills from your hand by …" (BT11-033)',
  },
  resolvingPlay: {
    fields: [{ name: "instead", type: "area" }, { name: "position", type: POSITION }, { name: "mode", type: { enum: ["rest"] } }, { name: "negated", type: "boolean" }],
    sentence: (raw) => {
      const op = raw as OpOf<"resolvingPlay">;
      return op.instead
        ? `the card being played is not played and goes to the ${op.instead} instead`
        : op.mode === "rest"
          ? "the card being played is played in Rest Mode"
          : "the card being played is played with its skills negated";
    },
    doc: '[Counter: Play] only (9-6). With "instead" the play is negated and the card goes there; without it the play happens and only the manner changes ("mode":"rest" or "negated":true)',
  },
  negateAttack: { fields: [], sentence: "negate the attack" },
  negateCounter: { fields: [], sentence: "negate the counter being answered", doc: "negate the [Counter] this one is answering (9-7)" },
  negateOwnSkill: { fields: [{ name: "until", type: { enum: ["turn", "battle"] } }], sentence: "this skill does not happen again", doc: '"negate this skill for the game / turn / battle" (9-1-5)' },
  forbid: {
    fields: [
      { name: "what", type: { enum: FORBIDDEN_ACTIONS }, required: true },
      UNTIL,
      { name: "target", type: "ref" },
      { name: "side", type: "side" },
      { name: "filter", type: "filter" },
      { name: "sameNameAsSelf", type: "boolean" },
      { name: "bySkill", type: "boolean" },
    ],
    sentence: (raw, r) => {
      const op = raw as OpOf<"forbid">;
      // A rule aimed at a card reads the other way round: the card is what is
      // played, not what plays. "You can't play …" is the player's version.
      const who = op.target ? describeRef(op.target) : op.side === "opponent" ? "your opponent" : "you";
      const what = op.target && op.what === "play" ? `be played${op.bySkill === true ? " by a skill" : op.bySkill === false ? " except by a skill" : ""}` : FORBIDDEN_IN_WORDS[op.what];
      // Which cards the ban is about, when it is about cards rather than the
      // player: "you can't play cards" said nothing about *which*.
      const which = op.sameNameAsSelf ? "another copy of this card" : op.filter ? describeFilter(op.filter) : "";
      // "…can't play **cards**" already names the object, so a description
      // of *which* cards replaces that word rather than following it.
      const verb = which ? what.replace(/\s+cards?$/, "") : what;
      return `${who} can't ${verb}${which ? ` ${which}` : ""}${forThe(op.until, r)}`;
    },
    doc: `forbid an action (20-14): a "target" for a rule about particular cards, or a "side" for one about a player, narrowed by a "filter"; "sameNameAsSelf":true narrows a play rule to copies of this card. "what" is one of ${FORBIDDEN_ACTIONS.map((w) => `"${w}"`).join(" | ")}`,
  },
  immune: {
    fields: [UNTIL, SELF, { name: "from", type: "side" }, { name: "fromFilter", type: "filter" }],
    sentence: (raw, r) => {
      const op = raw as OpOf<"immune">;
      const who = op.from === "opponent" ? "your opponent's" : op.from === "you" ? "your" : "";
      const whose = [who, op.fromFilter ? describeFilter(op.fromFilter) : ""].filter(Boolean).join(" ");
      return `${describeRef(op.target ?? { sel: { special: "self" } })} isn't affected by ${whose ? `${whose} ` : ""}skills${forThe(op.until, r)}`;
    },
    doc: '9-1-4: a card no skill may touch (stronger than "forbid":"beChosen", which only stops a skill choosing it); "from" and "fromFilter" narrow whose skills, and both absent means every skill',
  },
  permit: {
    fields: [{ name: "what", type: { enum: ["attackActive"] }, required: true }, UNTIL, TARGET, { name: "filter", type: "filter" }],
    sentence: "{target} can attack {filter:cards} in Active Mode{until}",
    doc: 'the one rule of the game a card may lift: "this card can attack Battle Cards in Active Mode" (8-1-1). The filter says *which* active cards — leave it out only when the card does',
  },
  if: { fields: [{ name: "cond", type: "cond", required: true }, { name: "then", type: "ops", required: true }, { name: "else", type: "ops" }], sentence: "if {cond}: {then:nothing}{else?, otherwise {else}}" },
  chooseMode: { fields: [{ name: "modes", type: "modes", required: true }, { name: "reason", type: "string" }], sentence: "choose one — {modes}", doc: '"Choose one— ・A ・B" (20-2): the master picks one printed option' },
  may: {
    fields: [{ name: "ops", type: "ops", required: true }, { name: "reason", type: "string" }, { name: "chooser", type: "side" }],
    sentence: "{chooser:your opponent|you} may: {ops}",
    doc: '"You may …" (20-16): wrap only the optional part; {"kind":"did","what":"may"} then reads the answer for "if you do" / "if you don\'t". "chooser":"opponent" when it is theirs to decline. A clause that is already an "up to" choice declines by choosing nothing — do not wrap those',
  },
  delay: {
    fields: [{ name: "at", type: { enum: DELAY_TIMINGS }, required: true }, { name: "scope", type: { enum: DELAY_SCOPES }, default: "thisTurn" }, { name: "ops", type: "ops", required: true }, { name: "label", type: "string" }],
    sentence: "{label:later}: {ops}",
    doc: 'the inner operations happen later (1-7-2-1-1): "At the end of the turn, KO it" is a choose, then a delay at "turnEnd" whose ops KO {"var":"t"}. A delayed program keeps the variables bound before it',
  },
  note: { fields: [{ name: "text", type: "string", required: true }], sentence: "", doc: "a remark in the log; does nothing" },
};

/**
 * A condition in the same form as an op: its fields, and the sentence it makes.
 *
 * The same reason `OP_SCHEMA` exists. A condition kind used to be written in
 * three places — the `Cond` union, the interpreter in `state.ts`, and a
 * hand-written `switch` in `describeCond` — and nothing checked its fields at
 * all: the validator accepted any object carrying a `kind`, so
 * `{"kind":"count"}` with no selector passed, was stored, and threw when the
 * engine read it. Adding a kind is now one interpreter case and one row here.
 *
 * Most sentences turn on which bound is set ("2 or more" against "no"), so
 * they are functions rather than templates; the fields beside them are what
 * the validator and the workbench's editor read.
 */
export interface CondSpec {
  fields: OpField[];
  sentence: (cond: Cond) => string;
  doc?: string;
}

type CondOf<K extends Cond["kind"]> = Extract<Cond, { kind: K }>;

const SEL: OpField = { name: "sel", type: "selector", required: true };
const AT_LEAST: OpField = { name: "atLeast", type: "number" };
const AT_MOST: OpField = { name: "atMost", type: "number" };

/** "2 or more", "no", "any" — the bound a counting condition puts on a number. */
function bound(c: { atLeast?: number; atMost?: number }, most = "or fewer"): string {
  if (c.atMost === 0) return "no";
  if (c.atLeast != null) return `${c.atLeast} or more`;
  if (c.atMost != null) return `${c.atMost} ${most}`;
  return "any";
}

const DID_IN_WORDS: Record<CondOf<"did">["what"], string> = {
  addToHand: "you added a card to your hand",
  play: "you played a card",
  negateAttack: "you negated the attack",
  negateLeaderAttack: "you negated a Leader's attack",
  ko: "you KO'd a card",
  draw: "you drew a card",
  may: "the offer was taken",
};
const DID_WHATS = Object.keys(DID_IN_WORDS) as readonly CondOf<"did">["what"][];

export const COND_SCHEMA: Record<Cond["kind"], CondSpec> = {
  count: {
    fields: [SEL, AT_LEAST, AT_MOST],
    sentence: (raw) => {
      const c = raw as CondOf<"count">;
      // "all" is the count this borrows to name the cards; what is left says
      // which and where. With no filter it starts at the area — "there is 2 or
      // more in your drop" — so the noun the selector had nothing to say about
      // is put back.
      const what = describeSelector({ ...c.sel, count: 99 }).replace(/^all /, "");
      return `there are ${bound(c)} ${what.startsWith("in ") ? `cards ${what}` : what}`;
    },
    doc: "how many cards a selector finds",
  },
  life: {
    fields: [{ name: "side", type: "side", required: true }, AT_LEAST, AT_MOST],
    sentence: (raw) => {
      const c = raw as CondOf<"life">;
      const whose = c.side === "opponent" ? "their" : "your";
      if (c.atMost != null) return `${whose} life is ${c.atMost} or less`;
      if (c.atLeast != null) return `${whose} life is ${c.atLeast} or more`;
      return `${whose} life`;
    },
  },
  lifeVsOpponent: {
    fields: [
      { name: "atLeast", type: "boolean" },
      { name: "atMost", type: "boolean" },
    ],
    sentence: (raw) => ((raw as CondOf<"lifeVsOpponent">).atLeast ? "your life is at least theirs" : "your life is no more than theirs"),
    doc: "the two life counts against each other",
  },
  leaderColor: {
    fields: [{ name: "color", type: { enum: COLORS }, required: true }],
    sentence: (raw) => `your leader is ${(raw as CondOf<"leaderColor">).color}`,
  },
  leaderMatches: {
    fields: [
      { name: "filter", type: "filter", required: true },
      { name: "side", type: "side" },
      { name: "back", type: "boolean" },
    ],
    sentence: (raw) => {
      const c = raw as CondOf<"leaderMatches">;
      const f = c.filter;
      const bits = [...f.colors, ...f.characters.map((x) => `<${x}>`), ...f.traits.map((x) => `\u226a${x}\u226b`)];
      return `${c.side === "opponent" ? "their" : "your"} leader${c.back ? "'s back side" : ""} is ${bits.join(" ") || f.names?.join("/") || "a match"}`;
    },
    doc: '"If your Leader is a <Baby> card" — colour, character name and traits alike',
  },
  markers: {
    fields: [SEL, AT_LEAST, AT_MOST],
    sentence: (raw) => {
      const c = raw as CondOf<"markers">;
      return `${describeSelector(c.sel)} has ${bound(c)} markers`;
    },
  },
  inBattle: {
    fields: [SEL, { name: "not", type: "boolean" }, { name: "role", type: { enum: ["attacker", "guard"] } }],
    sentence: (raw) => {
      const c = raw as CondOf<"inBattle">;
      return `${describeSelector(c.sel, "any of")} is ${c.not ? "not " : ""}${c.role === "guard" ? "being attacked" : c.role === "attacker" ? "attacking" : "in a battle"}`;
    },
  },
  battled: { fields: [SEL], sentence: (raw) => `${describeSelector((raw as CondOf<"battled">).sel, "any of")} has been in a battle this turn` },
  every: {
    fields: [SEL, { name: "matching", type: "selector", required: true }],
    sentence: (raw) => {
      const c = raw as CondOf<"every">;
      // Both selectors are built by `parseTarget` with the count deleted (see
      // `compile.ts`), so the quantifier is the sentence's own word: "all of
      // all in your energy is all mono-colour blue in your energy" was the
      // stutter that came of letting each of them claim one.
      return `every card ${describeSelector(c.sel, "")} is also ${describeSelector(c.matching, "")}`;
    },
    doc: "every card the first selector finds is also one the second finds; false when there is nothing to find (0-2-4-1)",
  },
  any: { fields: [{ name: "conds", type: "conds", required: true }], sentence: (raw) => (raw as CondOf<"any">).conds.map(describeCond).join(", or ") },
  all: { fields: [{ name: "conds", type: "conds", required: true }], sentence: (raw) => (raw as CondOf<"all">).conds.map(describeCond).join(" and ") },
  leaderFlipped: {
    fields: [
      { name: "side", type: "side" },
      { name: "flipped", type: "boolean" },
    ],
    sentence: (raw) => {
      const c = raw as CondOf<"leaderFlipped">;
      return `${c.side === "opponent" ? "their" : "your"} leader ${c.flipped === false ? "has not" : "has"} awakened`;
    },
  },
  power: {
    fields: [SEL, AT_LEAST, AT_MOST],
    sentence: (raw) => {
      const c = raw as CondOf<"power">;
      return `${describeSelector(c.sel)} has ${bound(c, "or less")} power`;
    },
  },
  did: {
    fields: [{ name: "what", type: { enum: DID_WHATS }, required: true }],
    sentence: (raw) => DID_IN_WORDS[(raw as CondOf<"did">).what],
    doc: 'whether an earlier step of this same skill did that — {"what":"may"} reads the answer to a "you may"',
  },
  not: { fields: [{ name: "cond", type: "cond", required: true }], sentence: (raw) => `not (${describeCond((raw as CondOf<"not">).cond)})` },
  chose: {
    fields: [{ name: "var", type: "string", required: true }, AT_LEAST],
    sentence: (raw) => {
      const c = raw as CondOf<"chose">;
      return c.atLeast && c.atLeast > 1 ? `you took all ${c.atLeast}` : "you took that choice";
    },
    doc: '"If you do so" (20-16): whether an earlier choice was answered, and with how many',
  },
  varMatches: {
    fields: [
      { name: "var", type: "string", required: true },
      { name: "filter", type: "filter", required: true },
    ],
    sentence: (raw) => `that card is ${describeFilter((raw as CondOf<"varMatches">).filter)}`,
  },
  isTurnPlayer: {
    fields: [{ name: "who", type: { enum: ["you", "opponent"] } }],
    sentence: (raw) => ((raw as CondOf<"isTurnPlayer">).who === "opponent" ? "it is your opponent's turn" : "it is your turn"),
    doc: 'whose turn it is (7-1) — "during your opponent\'s turn" is this, not a duration',
  },
};

// ── validation, for programs that did not come from the compiler ───────────

/**
 * Structural check for a program supplied by the referee, the workbench or a
 * stored row: every op is in the schema, every required field is there and
 * every enumerated field holds one of its values. It only proves the shape is
 * executable — the engine still enforces every rule while running it, so a
 * bad ruling can be wrong but never illegal. Nested programs are checked to
 * the depth a real card ever needs.
 */
export function validateProgram(ops: unknown, depth = 0): ops is Op[] {
  if (!Array.isArray(ops) || depth > 4) return false;
  return ops.every((raw) => {
    if (!raw || typeof raw !== "object") return false;
    const o = raw as Record<string, unknown>;
    const spec = typeof o.op === "string" ? OP_SCHEMA[o.op as Op["op"]] : undefined;
    if (!spec) return false;
    return spec.fields.every((f) => {
      const v = o[f.name];
      if (v === undefined) return !f.required;
      if (v === null) return !!f.nullable;
      return fieldHolds(f.type, v, depth);
    });
  });
}

function selectorHolds(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const special = (v as { special?: unknown }).special;
  return special === undefined || (SPECIAL_TARGETS as readonly string[]).includes(special as string);
}

/**
 * A condition's shape, from `COND_SCHEMA`. Until this existed the validator
 * asked only for a `kind`, so a condition missing the selector it counts was
 * stored happily and threw when a game read it.
 */
function condShapeHolds(v: unknown, depth: number): boolean {
  if (typeof v !== "object" || v === null || depth > 4) return false;
  const c = v as Record<string, unknown>;
  const spec = typeof c.kind === "string" ? COND_SCHEMA[c.kind as Cond["kind"]] : undefined;
  if (!spec) return false;
  return spec.fields.every((f) => {
    const x = c[f.name];
    if (x === undefined) return !f.required;
    if (x === null) return !!f.nullable;
    return fieldHolds(f.type, x, depth);
  });
}

function fieldHolds(type: FieldType, v: unknown, depth: number): boolean {
  if (typeof type === "object") {
    if ("enum" in type) return typeof v === "string" && type.enum.includes(v);
    return Array.isArray(v) && v.every((x) => (type.list === "string" ? typeof x === "string" : typeof x === "string" && type.list.enum.includes(x)));
  }
  switch (type) {
    case "amount":
      return typeof v === "number" || (typeof v === "object" && v !== null);
    // A ref is a bound name or a selector — a bare selector written where a
    // ref belongs ({"special":"self"} for {"sel":{"special":"self"}}) is the
    // mistake Claude makes most, and read as a ref it threw while being
    // described. Refused here, it comes back as "not a valid program".
    case "ref":
      return typeof v === "object" && v !== null && (typeof (v as { var?: unknown }).var === "string" || selectorHolds((v as { sel?: unknown }).sel));
    case "selector":
      return selectorHolds(v);
    case "cond":
      return condShapeHolds(v, depth);
    case "conds":
      return Array.isArray(v) && v.length > 0 && v.every((c) => condShapeHolds(c, depth + 1));
    case "filter":
      return typeof v === "object" && v !== null;
    case "keyword":
      return typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string";
    case "side":
      return typeof v === "string" && (SIDES as readonly string[]).includes(v);
    case "area":
      return typeof v === "string" && (AREAS as readonly string[]).includes(v);
    case "duration":
      return typeof v === "string" && (DURATIONS as readonly string[]).includes(v);
    case "ops":
      return validateProgram(v, depth + 1);
    case "modes":
      return Array.isArray(v) && v.length > 0 && v.every((m) => !!m && typeof m === "object" && validateProgram((m as { ops?: unknown }).ops, depth + 1));
    case "string":
      return typeof v === "string";
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "boolean":
      return typeof v === "boolean";
  }
}

// ── plain-English rendering, for the inspector, the workbench and the log ───

/**
 * What a filter says, in words. `describeSelector` used to be handed a bare
 * filter for this and printed "undefined in your undefined" — the count and
 * the area it wants are not part of a filter.
 */
/** How a relative power bound is worded, in the words `parseFilter` reads back. */
const POWER_REL_WORDS: Record<NonNullable<CardFilter["powerRel"]>["cmp"], string> = {
  "<=": "less than or equal to",
  "<": "less than",
  ">=": "greater than or equal to",
  ">": "greater than",
};

export function describeFilter(f: CardFilter): string {
  const bits: string[] = [];
  if (f.monoColor) bits.push("mono-colour");
  if (f.multiColor) bits.push("multicolour");
  bits.push(...f.colors.map((c) => c.toLowerCase()));
  // Every measure that *narrows by exclusion* was silent until 9 Sep 2026,
  // and a measure the reading drops always reads as the wider filter — the
  // one direction ground rule 5 forbids. "Non-black Battle Cards" printed as
  // "battle card" is the same sentence as no filter at all.
  bits.push(...f.notColors.map((c) => `non-${c.toLowerCase()}`));
  bits.push(...f.traits.map((x) => `≪${x}≫`));
  bits.push(...f.notTraits.map((x) => `non-≪${x}≫`));
  bits.push(...f.characters.map((x) => `<${x}>`));
  bits.push(...f.notCharacters.map((x) => `non-<${x}>`));
  bits.push(...f.names.map((x) => `{${x}}`));
  if (f.token) bits.push("token");
  else if (f.notToken) bits.push("non-token");
  if (f.z) bits.push("Z-card");
  // The noun has to be settled before the trailing measures are hung off it,
  // and a name asked for **in part** is one of those — printed after the word
  // it qualifies, the way the card prints it.
  const partial = [
    ...f.charactersIncluding.map((x) => `with <${x}> in its character name`),
    ...f.namesIncluding.map((x) => `with {${x}} in its card name`),
    ...f.notCharactersIncluding.map((x) => `without <${x}> in its character name`),
    ...f.notNamesIncluding.map((x) => `without {${x}} in its card name`),
    // A name the target must *not* have. Written the way the cards write it,
    // which is also the only wording `parseFilter` reads it back from.
    ...f.notNames.map((x) => `other than {${x}}`),
    // "…with [Blocker]", "…with an [Evolve] skill", "…with [Counter] skills".
    // One "with" apiece rather than a list, so the phrase reads back as the
    // same set of keywords it printed.
    ...f.keywords.map((k) => `with [${k}]`),
    ...f.notKeywords.map((k) => `non-[${k}]`),
  ];
  if (f.skillKind) partial.push(`with [${f.skillKind === "activate" ? "Activate" : f.skillKind === "counter" ? "Counter" : f.skillKind === "auto" ? "Auto" : "Permanent"}] skills`);
  if (f.type) bits.push(`${f.type.toLowerCase()} card`);
  else if (f.notType) bits.push(`non-${f.notType.toLowerCase()} card`);
  else if (!bits.length) bits.push("card");
  // Printed nowhere until 9 Sep 2026, which is what let "choose up to 1 of
  // your Battle Cards **with <Son Gohan> in its character name**" (BT19-130)
  // read as "choose up to 1 in your battle" — a filter the compiler had,
  // printed as though it had none. The reading is the only check on a filter
  // that narrows wrongly, so a measure it cannot print is a measure nobody can
  // sign off.
  bits.push(...partial);
  if (f.faceUp) bits.push("that is face up");
  // A range said only half of itself: a filter with both bounds printed as
  // "or less" and dropped the floor, and an *exact* cost or power printed as
  // "or less" too — a reading strictly wider than the filter in both cases.
  if (f.costMin != null && f.costMin === f.costMax) bits.push(`with an energy cost of ${f.costMin}`);
  else if (f.costMin != null && f.costMax != null) bits.push(`with an energy cost of between ${f.costMin} and ${f.costMax}`);
  else if (f.costMax != null) bits.push(`with an energy cost of ${f.costMax} or less`);
  else if (f.costMin != null) bits.push(`with an energy cost of ${f.costMin} or more`);
  if (f.powerMin != null && f.powerMin === f.powerMax) bits.push(`with ${f.powerMin} power`);
  else if (f.powerMin != null && f.powerMax != null) bits.push(`with power between ${f.powerMin} and ${f.powerMax}`);
  else if (f.powerMax != null) bits.push(`with ${f.powerMax} power or less`);
  else if (f.powerMin != null) bits.push(`with ${f.powerMin} power or more`);
  if (f.powerRel) bits.push(`with power ${POWER_REL_WORDS[f.powerRel.cmp]} ${f.powerRel.of === "chosen" ? "the chosen card's" : "this card's"} power`);
  if (f.noKeywords) bits.push("and no keyword skills");
  return bits.join(" ");
}

/**
 * The filter's words, unless they only repeat what the area already says: a
 * selector over the Battle Area whose filter is "battle card" would read "1
 * battle card in your battle".
 */
function selectorWords(sel: Selector): string {
  if (!sel.filter) return "";
  const words = describeFilter(sel.filter);
  const areas = (sel.areas?.length ? sel.areas : [sel.area]).filter(Boolean).map((a) => `${String(a).toLowerCase()} card`);
  return words === "card" || areas.includes(words) ? "" : words;
}

/**
 * Which cards, in words. The filter is part of the answer: without it the
 * worklist read "choose up to 1 in your warp" for a skill that can only take
 * a blue ≪Another World Budokai≫ card, which is exactly the detail that tells
 * two cards phrased alike apart.
 *
 * `all` is the word for a selector with no count of its own, which is every
 * card it finds. A condition that *tests* the cards rather than taking them
 * says so differently — `inBattle` and `battled` ask whether **any** of them
 * is, `every` asks about each — so they pass their own word rather than let
 * the sentence claim a quantifier the engine does not use.
 */
function describeSelector(sel: Selector, all = "all"): string {
  // The one special a filter can narrow and the reading has to keep: "the
  // <Majin Buu> on top of this card" and "the Leader on top of this card" are
  // different cards, and dropping the words would print them the same.
  if (sel.special === "onTop") {
    const words = selectorWords(sel);
    return `the ${words ? `${words} ` : "card "}on top of this card`;
  }
  if (sel.special)
    return {
      self: "this card",
      attacker: "the attacking card",
      guard: "the guard card",
      subject: "that card",
      leader: "your leader",
      opponentLeader: "the opposing leader",
      resolving: "the card being played",
    }[sel.special];
  const who = sel.side === "opponent" ? "opponent's " : sel.side === "both" ? "each player's " : "your ";
  // A selector with neither a count nor a `take` is every card the filter
  // matches — `resolveSelector` returns the whole area — and printing
  // `${undefined}` said so as "undefined in your energy", on 145 readings.
  // `take` is the area's own order rather than a choice among it (see
  // `Selector.take`), so it is worded as the cards it takes, not as a number
  // of them to pick.
  const count =
    sel.take != null
      ? `the ${sel.fromEnd ? "bottom" : "top"} ${sel.take}`
      : sel.count == null
        ? all
        : sel.count === 99
          ? "all"
          : sel.upTo
            ? `up to ${sel.count}`
            : `${sel.count}`;
  const words = selectorWords(sel);
  const where = sel.fromVar ? "of the cards looked at" : `in ${who}${sel.areas?.length ? sel.areas.join(" or ") : sel.area}`;
  const mode = describeMode(sel);
  return [count, words, where].filter(Boolean).join(" ") + mode + describeNotSelf(sel);
}

/**
 * "In Rest Mode" / "In Hidden Mode" — the two axes a card instance carries
 * (§23-5's Hidden/Revealed is orthogonal to §1-10's Active/Rest, and the
 * compiler never sets both on one selector, so there is no case where they
 * would need to be said together).
 */
const describeMode = (sel: Selector): string =>
  sel.mode ? ` in ${sel.mode} mode` : sel.hidden === true ? " in Hidden Mode" : sel.hidden === false ? " in Revealed Mode" : "";

/**
 * "…other than this card". Left out of the reading until 9 Sep 2026, when
 * reading "all other Battle Cards" as `notSelf` made it the difference between
 * a board wipe and a board wipe that also takes the card casting it — which
 * the sentence "all in each player's battle" said nothing about either way.
 */
const describeNotSelf = (sel: Selector): string =>
  sel.notSelf === "card" ? " other than this card" : sel.notSelf === "copies" ? " other than copies of this card" : "";

function describeRef(ref: Ref): string {
  return "var" in ref ? "the chosen cards" : describeSelector(ref.sel);
}

/**
 * A number in words. With a `noun` ("power") it is the signed change cards
 * print — "+5000 power", "+5000 power for each of your Battle Cards" — so the
 * noun sits next to the number rather than at the end of the sentence.
 */
function describeAmount(a: Amount, noun?: string): string {
  if (noun) {
    if (typeof a === "number") return `${a >= 0 ? "+" : ""}${a} ${noun}`;
    if ("count" in a) return `+${a.times ?? 1} ${noun} for each of ${describeEach(a.count)}`;
    if ("markers" in a) return `+${a.times ?? 1} ${noun} for each marker on ${describeEach(a.markers)}`;
    return `+that many ${noun}`;
  }
  if (typeof a === "number") return `${a}`;
  if ("var" in a) return "that many";
  if ("sumPower" in a) return "the total power of the cards rested";
  if ("handUpTo" in a) return `up to ${a.handUpTo} in hand`;
  if ("markers" in a) return `${a.times ?? 1} for each marker on ${describeEach(a.markers)}`;
  return `${a.times ?? 1} for each of ${describeEach(a.count)}`;
}

/** The area as a person would name it, for "for each of your Battle Cards". */
const AREA_NOUNS: Partial<Record<ScriptArea, string>> = {
  play: "cards in play",
  battle: "Battle Cards",
  unison: "Unison Cards",
  leader: "Leader",
  drop: "cards in the Drop",
  hand: "cards in hand",
  deck: "cards in the deck",
  life: "life cards",
  energy: "energy",
  warp: "cards in the Warp",
  combo: "combo cards",
  zDeck: "Z-Deck cards",
  zEnergy: "Z-Energy",
  removed: "removed cards",
  under: "cards underneath",
};

function describeEach(sel: Selector): string {
  if (sel.special) return describeSelector(sel);
  const who = sel.side === "opponent" ? "their " : sel.side === "both" ? "" : "your ";
  const mode = describeMode(sel);
  const nouns = (sel.areas?.length ? sel.areas : [sel.area ?? "play"]).map((a) => AREA_NOUNS[a] ?? "cards");
  return `${who}${nouns.join(" or ")}${mode}${describeNotSelf(sel)}`;
}

/**
 * A condition in plain words. The workbench shows this back before you keep a
 * reading, and "if a condition holds" would tell you nothing about whether the
 * engine understood the condition you meant.
 */
export function describeCond(c: Cond): string {
  return COND_SCHEMA[c.kind].sentence(c);
}

/** A duration as the inspector says it. A [Permanent] holds while its card is where the skill is valid (9-5-1), so it gets no clause at all. */
const DURATION_IN_WORDS: Record<Duration, string> = {
  turn: " for the turn",
  battle: " for the battle",
  nextTurn: " until the end of your opponent's turn",
  opponentTurn: " until the start of your opponent's next turn",
  afterNextCharge: " through your next Charge Phase",
  game: " for the rest of the game",
};
const forThe = (until: Duration | undefined, r: RenderOptions) => (r.permanent || !until ? "" : DURATION_IN_WORDS[until]);

/** Whether a field counts as given, for `{field? …}`: unset, false and an empty list are not. */
function given(v: unknown): boolean {
  return v !== undefined && v !== null && v !== false && !(Array.isArray(v) && v.length === 0);
}

/** One field in words, by its type; `hint` is what the template wrote after the colon. */
function describeField(f: OpField, v: unknown, hint: string | undefined, r: RenderOptions): string {
  const t = f.type;
  const two = (flag: boolean) => (hint ? (hint.split("|")[flag ? 0 : 1] ?? "") : String(flag));
  if (typeof t === "object") {
    if ("enum" in t) {
      // "auto=Auto|counter=Counter" maps the values; "A|B" is for a two-valued enum.
      if (hint?.includes("=")) return hint.split("|").map((kv) => kv.split("=")).find(([k]) => k === v)?.[1] ?? String(v);
      return v === undefined ? (hint ?? "") : t.enum.length === 2 && hint ? two(v === t.enum[0]) : String(v);
    }
    return Array.isArray(v) ? v.join(", ") : (hint ?? "");
  }
  switch (t) {
    case "amount":
      return describeAmount(v as Amount, hint);
    case "ref":
      return describeRef(v as Ref);
    case "selector":
      return describeSelector(v as Selector);
    case "side":
      return hint ? two(v === "opponent") : String(v ?? f.default ?? "you");
    case "area":
      return String(v);
    case "duration":
      return forThe(v as Duration | undefined, r);
    case "cond":
      return describeCond(v as Cond);
    case "conds":
      return ((v as Cond[] | undefined) ?? []).map(describeCond).join(" and ");
    case "ops": {
      const inner = describeScript((v as Op[] | undefined) ?? [], r);
      return inner || (hint ?? "");
    }
    case "keyword":
      return (v as KeywordSkill).name;
    case "filter":
      return v ? describeFilter(v as CardFilter) : (hint ?? "");
    case "modes":
      return ((v as { ops: Op[] }[]) ?? []).map((m) => describeScript(m.ops, r)).join(" / ");
    case "string":
      return typeof v === "string" && v ? v : (hint ?? "");
    case "number":
      return String(v);
    case "boolean":
      return hint ? two(Boolean(v ?? f.default)) : String(v);
  }
}

/** `costs {amount:less|more}`: 20-21 goes both ways, and "costs -2 less" is not English. */
function describeCostChange(a: Amount): string {
  if (typeof a === "number" && a < 0) return `${-a} more`;
  return `${describeAmount(a)} less`;
}

/**
 * Fill a sentence template from an op. `{f}` and `{f:hint}` render the field;
 * `{f? …}` renders its text, with the same substitutions inside, only when the
 * field is given.
 */
function renderTemplate(template: string, op: Record<string, unknown>, fields: OpField[], r: RenderOptions): string {
  const byName = new Map(fields.map((f) => [f.name, f]));
  const one = (name: string, hint?: string): string => {
    const f = byName.get(name);
    if (!f) return "";
    const v = op[name] ?? f.default;
    if (f.name === "amount" && hint === "less|more") return describeCostChange(v as Amount);
    if (v === undefined && !hint) return "";
    return describeField(f, v, hint, r);
  };
  return template
    .replace(/\{(\w+)\?([^{}]*(?:\{\w+(?::[^{}]*)?\}[^{}]*)*)\}/g, (_, name: string, text: string) => (given(op[name]) ? text.replace(/\{(\w+)(?::([^{}]*))?\}/g, (__, n2: string, h2?: string) => one(n2, h2)) : ""))
    .replace(/\{(\w+)(?::([^{}]*))?\}/g, (_, name: string, hint?: string) => one(name, hint));
}

/**
 * A program in words, one clause per op. `permanent` drops every duration:
 * the compiler stamps `game` on a [Permanent]'s ops (the skill never resolves,
 * so no length of time is the right one), and "for the rest of the game" on
 * a card that simply holds while in play would say something it does not
 * mean.
 */
export function describeScript(ops: Op[], o: RenderOptions = {}): string {
  const parts: string[] = [];
  for (const op of ops) {
    const spec = OP_SCHEMA[op.op];
    if (!spec) continue;
    const text = typeof spec.sentence === "function" ? spec.sentence(op, o) : renderTemplate(spec.sentence, op as unknown as Record<string, unknown>, spec.fields, o);
    if (text) parts.push(text);
  }
  return parts.join(", ");
}

/**
 * The op's shape as the referee is shown it: `{"op":"draw","n":AMOUNT,"side"?:SIDE}`.
 * Optional fields carry a `?`; the placeholders are defined once under the list.
 */
export function opSignature(name: Op["op"]): string {
  const shape = (t: FieldType): string => {
    if (typeof t === "object") {
      if ("enum" in t) return t.enum.length > 6 ? `${t.enum.slice(0, 3).map((e) => `"${e}"`).join("|")}|…` : t.enum.map((e) => `"${e}"`).join("|");
      return t.list === "string" ? '["…"]' : `[${t.list.enum.map((e) => `"${e}"`).join("|")}]`;
    }
    return { amount: "AMOUNT", ref: "TARGET", selector: "SELECTOR", side: '"you"|"opponent"', area: "AREA", duration: "DURATION", cond: "COND", conds: "[COND]", ops: "[…]", string: '"…"', number: "N", boolean: "true|false", keyword: '{"name":"Blocker"}', filter: "FILTER", modes: '[{"label":"…","ops":[…]}]' }[t];
  };
  const fields = OP_SCHEMA[name].fields.map((f) => `"${f.name}"${f.required ? "" : "?"}:${shape(f.type)}`);
  return `{"op":"${name}"${fields.length ? "," : ""}${fields.join(",")}}`;
}

/** The same, for a condition: `{"kind":"count","sel":SELECTOR,"atLeast"?:N}`. */
export function condSignature(kind: Cond["kind"]): string {
  const shape = (t: FieldType): string => {
    if (typeof t === "object") return "enum" in t ? (t.enum.length > 4 ? `${t.enum.slice(0, 3).map((e) => `"${e}"`).join("|")}|…` : t.enum.map((e) => `"${e}"`).join("|")) : "[…]";
    return { selector: "SELECTOR", side: '"you"|"opponent"', cond: "COND", conds: "[COND]", filter: "FILTER", string: '"…"', number: "N", boolean: "true|false", amount: "AMOUNT", ref: "TARGET", area: "AREA", duration: "DURATION", ops: "[…]", keyword: '{"name":"Blocker"}', modes: "[…]" }[t];
  };
  const fields = COND_SCHEMA[kind].fields.map((f) => `"${f.name}"${f.required ? "" : "?"}:${shape(f.type)}`);
  return `{"kind":"${kind}"${fields.length ? "," : ""}${fields.join(",")}}`;
}
