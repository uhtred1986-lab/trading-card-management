/**
 * The arena's shared vocabulary — what the client contract, the engine, the
 * compiler and the rules language all speak: actions, events, prompts, card
 * definitions, skills, areas, and the context an engine is handed
 * (`EngineContext`, at the end). Moved out of `engine/` by #118, which then
 * deleted the legacy engine and its state shape; the rules engine's is
 * `VmState` (`vm/state.ts`).
 *
 * Pure data: no React, no database. Section numbers in comments refer to the official Rule
 * Manual v4.00 (`docs/rules/rulemanual.txt`).
 */

import type { CardFilter } from "./text/filters";
import type { CardScripts, Cond, Op, Selector } from "./vm/script";

export type PlayerId = "p1" | "p2";
export const PLAYERS: PlayerId[] = ["p1", "p2"];
export const other = (p: PlayerId): PlayerId => (p === "p1" ? "p2" : "p1");

/** The five colours (1-8) plus the catalog's "Colorless" for tokens. */
export type Color = "Red" | "Blue" | "Green" | "Yellow" | "Black" | "White" | "Colorless";

export type CardType = "LEADER" | "BATTLE" | "EXTRA" | "UNISON" | "Z-LEADER" | "Z-BATTLE" | "Z-EXTRA" | "Z-UNISON" | "TOKEN";

/**
 * A card as the engine needs it — the catalog row, shaped. `energyCost` is a
 * number, `"X"` or null (leaders); `specifiedCost` is the coloured orbs, which
 * the catalog feed does not carry: set from the hand-entered
 * `cards.specified_cost` column when there is one (issue #255), otherwise
 * absent, and `specifiedCostOf` fills a fixed cost by convention (proposal
 * §9.1) and refuses to guess an X cost.
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
  /**
   * Coloured orbs of the energy cost, when known: the hand-entered
   * `cards.specified_cost` (`{u}{u}` → `{ Blue: 2 }`) or a test's own claim.
   * Absent means `specifiedCostOf` fills a fixed cost by convention and an
   * X cost is `specifiedCostUnknown`.
   */
  specifiedCost?: Partial<Record<Color, number>>;
  /**
   * Card names a skill gave this card "in all areas" (20-1) — "this card is
   * also treated as {Planet M-2} in all areas". *Also*, never instead: the
   * card keeps its printed `name` and answers to both.
   *
   * Set only by `cardNow`, which is what every check of what a card *is* goes
   * through, so nothing that reads a catalog row has to know about it.
   */
  alsoNames?: string[];
  /**
   * Whether the card has no skill in force right now (1-5-9, 9-1-4): none
   * printed or every one negated, and none granted or copied. What a filter's
   * bare "skill-less" asks (`CardFilter.skillLess`).
   *
   * Set only by `cardNow`, and read lazily there, because it asks the table
   * about negations and grants and almost no filter wants it. Absent on a
   * catalog row, where `matches` falls back to the printed text.
   */
  skillLess?: boolean;
}

/** One printed skill line, parsed by `cards.ts`. */
export interface Skill {
  /** Runtime executable usage, attached from the stored script rather than display tags. */
  usage?: unknown;
  /** Runtime Sparking validity from the executable record. */
  validity?: unknown;
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
  // 22-42-2: "[Rejuvenate] skill cost" — the markers the printed cost removes
  // and the life ceiling it may add, read off the line by `parseSkills`
  // (#155). Absent on a bare tag and on a granted [Rejuvenate].
  | { name: "Rejuvenate"; markers?: number; lifeAtMost?: number }
  | { name: "Spirit Boost"; x: number }
  | { name: "Empower"; color: Color | null; x: number }
  | { name: "Z-Awaken" }
  | { name: "Z-Stack"; x: number };

/** Every area of 3-1, per player. */
export type Area = "deck" | "hand" | "drop" | "leader" | "battle" | "combo" | "energy" | "life" | "warp" | "unison" | "zDeck" | "zEnergy" | "removed";

export type Mode = "active" | "rest";
/**
 * Why a card moved. `areaExtension` (#930, 22-13-5-2-1-1) is the move an
 * area-expanding [Union-Potara] permission makes first: a Battle Card chosen
 * from the energy or Warp is moved to the Battle Area, and "area movement
 * triggers resulting from the chosen Battle Card moving to a different area are
 * not made pending, nor does counter timing occur", so it announces no `moved`.
 */
export type MoveReason = "ko" | "effect" | "rule" | "cost" | "play" | "combo" | "damage" | "draw" | "charge" | "areaExtension";

/**
 * A replacement effect that may change what happens when a card is about to
 * leave play (9-10). `to` is where it goes instead; a replacement whose
 * substitute is a whole program carries `ops` and no `to` — the card stays
 * where it is and the program happens in the departure's place.
 */
export interface ReplacementChoice {
  source: string;
  to?: Area;
  position?: "top" | "bottom";
  mode?: Mode;
  optional?: boolean;
  /** The program that happens instead, for a substitute rather than a redirect. */
  ops?: Op[];
  /** Whose skill it is, so the substitute's program runs for the right player. */
  master?: PlayerId;
  /** The [Permanent] line saying it, so the substitute can spend that line ("once per turn … instead", BT29-141). */
  skillIndex?: number;
}

/**
 * Whose skill is moving the card, when a replacement's `bySide` narrows the
 * departures it answers to ("removed from your Battle Area **by an opponent's
 * skill**"). Absent means nobody's skill is known to be doing it — a rule
 * cleanup, a battle KO, a cost — and an opponent-narrowed replacement then
 * does not apply (9-10, and `docs/arena-move-replacement-scope.md` §1.4:
 * prefer unread to wrongly read).
 */
export type MoveActor = PlayerId | undefined;

/** A move route chosen before `move()` begins; null means keep the original route. */
export interface ReplacementResult {
  to?: Area;
  position?: "top" | "bottom";
  mode?: Mode;
  /** The program that happens instead of the move. */
  ops?: Op[];
  /** The card whose skill said so, and whose master runs the program. */
  source?: string;
  master?: PlayerId;
  /**
   * The caller runs `ops` itself, as a frame on the flow, rather than letting
   * `move()` run them inline (#107). `move()` still does everything a
   * substitute means — the departure does not happen and the card stays where
   * it is — and then returns, leaving the program to a frame that *can* stop
   * and ask. Only the two suspendable call sites set it.
   */
  deferred?: boolean;
  /** The line the substitute's program belongs to (`ReplacementChoice.skillIndex`). */
  skillIndex?: number;
  /** A voluntary replacement (9-10-3) the affected player took: its substitute is owed in full (#720). */
  optional?: boolean;
}

/**
 * What 20-13 can be told to skip here. The three phases the turn is made of
 * and the two steps of a battle that have a step of their own to refuse;
 * `turn` (BT31-097), which is a whole later turn refused wholesale, checked
 * once at that turn's own `turn.start` rather than at any one phase; and
 * `span` (BT21-104), a standing entry that reaches further still — the rest
 * of this turn, the whole of the opponent's next turn, and this player's own
 * next Charge Phase, landing at that Main Phase — expanded to the three
 * ordinary entries that already say each of those pieces (#278) rather than
 * carried as one. Not the Damage Step, which is where a battle's result is
 * worked out rather than a moment anything acts in.
 */
export type SkipWhat = "charge" | "main" | "end" | "offense" | "defense" | "turn" | "span";

export type Phase = "setup" | "charge" | "main" | "mainEnd" | "end" | "over";
export type BattleStep = "declared" | "offense" | "defense" | "damage" | "battleEnd";

/** A battle response window the engine advanced past because it had no legal offers. */
export type EmptyResponseWindow = "counter" | "blocker" | "offenseCombo" | "defenseCombo";

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
  /**
   * Only the Charge Phase's own switch (7-2-7): "it can't switch to Active
   * Mode **during your opponent's next Charge Phase**" (BT3-085, BT3-101,
   * XD1-01, #539). A skill may still switch the card to Active later that
   * turn, which a plain `switchToActive` would refuse.
   */
  | "switchToActiveInCharge"
  /**
   * A skill switching cards in an Energy Area to Active Mode — "if the turn
   * player would use the skill of a Battle Card or Extra Card to switch energy
   * to Active Mode, they can't … unless …" (BT8-051). Asked by the `switchMode`
   * op, once per switch, of the energy it would stand up; no card is the
   * subject, the skill's card is the `source`.
   */
  | "switchEnergyToActive"
  | "placeEnergy"
  /**
   * "You can only place up to 6 energy" (BT3-032, BT9-127, BT19-034): another card
   * into the Energy Area is refused while the escape holds no more — the rule's
   * `unless` says the player has fewer than the limit. Unlike `placeEnergy` it
   * stops the Charge Phase's placement **and** a skill's, as the official card
   * Q&A on BT3-032 and BT19-034 says ("a result of both the Charge Phase and skills").
   */
  | "energyCap"
  /** Life-to-hand movement, including costs, skill effects and damage processing. */
  | "addLifeToHand"
  /** "Can't be removed from a Battle Area by your opponent's skills" (20-14): a move by a skill, not by a battle. */
  | "beMovedBySkill"
  /** "This card's skills can't be negated in any area" (9-1-5). */
  | "beNegated";

export interface Prohibition {
  what: ForbiddenAction;
  /** Allowed uses before the prohibition starts applying. */
  uses?: number;
  /** Escape condition: while this holds, the prohibition does not apply. */
  unless?: Cond;
  /**
   * 20-14-1's other escape: a price the acting player may pay to take the
   * action anyway, **each time** — "that card can't attack unless your
   * opponent sends 2 cards from their hand to their Warp each time" (BT30-100).
   * The program is run in the payer's frame ("you" is whoever acts), before the
   * action is taken; an action nobody can pay for is refused. `attack`,
   * `play` (a play the player declares, BT31-093) and `switchEnergyToActive`
   * (paid mid-resolution or the switch does not happen, BT8-051) carry one;
   * `validateProgram` refuses it on any other action.
   */
  pay?: Op[];
  /**
   * Only an action a **skill** of one of these card types takes: "if the turn
   * player would use the skill of a Battle Card or Extra Card to switch energy
   * …" (BT8-051). Matched against the card whose skill it is (`source` in the
   * matchers' options); an action no skill takes is not this rule's.
   */
  byTypes?: ("LEADER" | "BATTLE" | "EXTRA" | "UNISON")[];
  /** Binds only the turn player — "if **the turn player** would …" (BT8-051): whoever's turn it is, whichever side made the rule. */
  turnPlayer?: boolean;
  /**
   * The controller of the card that made the rule. An `unless` is a clause of
   * that card's text, so "you" and "your opponent" in it are read from that
   * chair — not from the chair of whoever is trying to act.
   */
  master?: PlayerId;
  /** Whose action is forbidden. Absent means either player's. */
  player?: PlayerId;
  /** Which cards it is about. Absent means any card. */
  filter?: CardFilter;
  /** Attack declarations only: the prospective defender, not the attacker. */
  attackTarget?: CardFilter;
  /**
   * Attack declarations only (#1005): "…can only attack this card" — the cards
   * (resolved when the rule is read) an attack may still be declared against;
   * any other defender is forbidden to the attackers the rule is about. A
   * Blocker's redirection is not a declaration, so it is not asked.
   */
  attackOnly?: string[];
  /** Cards with this exact name — "you can't play copies of this card". */
  name?: string;
  /**
   * Whether the ban is on a skill doing it or on the player doing it plainly:
   * "this card can't be played by skills from any area" is `true`, "…can't be
   * played from any area except by skills" is `false`, and a bare prohibition
   * leaves it absent and covers both.
   */
  bySkill?: boolean;
  /**
   * #933: with `bySkill: true`, the skill play it stops is any one that is not
   * an evolution — "can't be played from any area with non-[Evolve] skills"
   * (BT13-017/021/024). An [Evolve], [EX-Evolve] or [Xeno-Evolve] play, and a
   * skill whose `play` op names `using` one of them ("evolve it on top of this
   * card", P-336), is let through; a declared play is `bySkill: false` and
   * never met by this rule. Classified by what the play *is*, not by the
   * keyword tag on the skill that makes it.
   */
  exceptEvolve?: boolean;
  /**
   * `activateCounter` only: the one [Counter] kind it names — "[Counter: Play]
   * skills" is not every [Counter] (22-10-2-1). Matched against the line being
   * activated (`skillKind` in the matchers' options); absent means any kind.
   */
  counterKind?: CounterKind;
  /** "…of **other** cards" (BT10-008): the card that made the rule is not bound by it. */
  otherCards?: boolean;
  /**
   * 12-1-3 (#677): "activating an Extra Card" — only an [Activate] or [Counter]
   * skill of an Extra Card used from a player's hand, not an Extra's [Auto]
   * (BT10-097's "can't activate Extra Cards unless …"). Matched against the
   * line's kind and the area the card was used from (`skillKind`, `from`).
   */
  extraCardActivation?: boolean;
}

/** The four [Counter] kinds of 22-10-2-1, as a `forbid` names one. */
export type CounterKind = "play" | "attack" | "battleCardAttack" | "counter";

/** The `CounterKind` of a printed line's `kind` ("counter:battle card attack" → "battleCardAttack"), or null for a line that is no [Counter]. */
export function counterKindOf(kind: string): CounterKind | null {
  if (kind === "counter:play") return "play";
  if (kind === "counter:attack") return "attack";
  if (kind === "counter:battle card attack") return "battleCardAttack";
  if (kind === "counter:counter") return "counter";
  return null;
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
  /**
   * `attackActive`: the card may attack Battle Cards in Active Mode (8-1-1).
   * `comboRest`: its master may use Battle Cards in Rest Mode in combos (5-7)
   * — "you can use your mono-red Rest Mode ≪Saiyan≫ cards in combos"
   * (BT18-001, BT29-129); the target is the card granting it, and `filter`
   * says which rested cards.
   * `overRealmFromWarp`: the target's own [Over Realm] skill may be activated
   * from its owner's Warp under the same conditions as from the hand (22-15)
   * — "This card's [Over Realm] skill can be activated from its owner's Warp
   * under the same conditions as if it were in your hand" (BT31-150). Read
   * while the card is in the Warp, where the line is then used; `filter` is
   * not read.
   * `fieldBattle`: the target's own [Field] skill may be used from the hand at
   * [Activate: Battle] timings as well as the Main Phase's (22-3) — "The
   * [Field] skill on this card in your hand can also be activated at
   * [Activate: Battle] timings" (BT29-041, BT29-042). Read from the hand,
   * where the skill is used; `filter` is not read.
   * `unionFusionWarp`: this target card may activate its own Fusion from hand,
   * choosing its specified materials from hand or Warp and sending both to Drop.
   * This is self-scoped and does not grant any other card an area permission.
   * `unionLine` (#930, P-360): the target card in hand has the printed skill
   * line `line` as well — "Red <Gogeta: Br> cards in your hand gain the
   * following skill: [Union-Fusion]{r}{u}{2}: <Son Goku: Br> and <Vegeta: Br>."
   * Only a [Union-Fusion] / [Union-Potara] line, which is a move of the card in
   * hand and needs no program of its own (the keyword's `DO` is the effect).
   * `unionEnergy` (#930, BT10-046 / BT10-053 / P-220): this hand copy's [Union]
   * skill may choose its specified Battle Cards in the player's energy as well
   * (22-13-5-2-1, "choose Battle Cards in one of your areas"). Self-scoped to the
   * card in hand, like `unionFusionWarp`, which is the same permission for the
   * Warp and serves [Union-Potara] (BT10-132, P-230) as well as Fusion.
   * `unionFusionAreas`: while the card granting it (the target) is in play, its
   * master's [Union-Fusion] may choose its specified Battle Cards from the
   * Battle Area and the Drop as well as the hand (22-13-4-2-1), those two
   * going to their owner's Warp — "You can choose the specified Battle Cards
   * in your Battle Area or your Drop when choosing cards to use with the
   * [Union] skill of a red <Veku> or <Gogeta> card from your hand. If you do,
   * send the chosen cards to their owner's Warp" (BT31-001, owner's ruling of
   * 13 Oct 2026). `filter` says which cards' [Union-Fusion] it widens.
   * `evolveEnergyBases`: this hand copy's Evolve-family skill may choose a
   * qualifying own Battle Card in energy and enter Active Mode on that path
   * (22-5-3-1); it does not extend the skill's activation-source area.
   * `evolveFromZEnergy` (BT19-077/-078/-081/-082): this card's own Evolve-family
   * skill may be activated while the card is in its master's Z-Energy as well as
   * from the hand (22-5-2, official card Q&A on BT19-077). Read while the card is
   * in the Z-Energy Area, where the line is then used. It extends the evolving
   * card's source area only: the base is still chosen in the Battle Area (no
   * `evolveEnergyBases`) and it grants no Active Mode.
   * `aegisAltDrop` (BT22-035): while the card granting it is in play, its
   * master may pay any of their [Aegis] skills by sending one card of each of
   * `filter.colors` from their Drop to their Warp instead of the hand cards of
   * 22-30-3 — `filter` carries only those colours here, it is not asked of a card.
   * `aegisAltOpponentHand` (BT22-140): the target's own [Aegis] skill may be
   * paid by sending 1 card from the opponent's hand to the bottom of their deck
   * instead. Both stand beside the hand payment, which stays the player's choice.
   * `unionSourceUnder` (BT24-112 back, #927): while the card granting it is in
   * play, its master's [Union-Potara] on a card the `filter` describes may
   * also choose its specified Battle Cards from under the master's Unison
   * cards `source` describes (22-13-5-2-1); the chosen cards are first moved
   * to the Battle Area, silently (22-13-5-2-1-1).
   * `unionSourceOpponentBattle` (BT20-125, #927): the target hand card's own
   * [Union-Potara] may also choose Battle Cards its master owns that stand in
   * the opponent's Battle Area. Read from the hand.
   * `playInOpponentBattle` (BT20-125, #927): the target card is played from its
   * master's hand in the opponent's Battle Area - read for the [Union] play;
   * an ordinary hand play of it is not yet moved (see the glossary). Read from the hand.
   * `attackUnnegatable` (EX03-14, #936): the target card's attacks can't be
   * negated (8-6) — a `negateAttack` aimed at a battle whose attacker holds
   * one fails, and "if you negated" reports that it did. Timed (a resolved
   * skill's effect) or a [Permanent]'s standing one. It stops *negation* only:
   * a prohibition on attacking, and removing the attacker, still work.
   * `startLife` (6-2-2, 6-2-2-1; BT12-002, BT16-046, BT16-047, BT19-100): "You start
   * the game with X life." The Leader in the Leader Area sets how many cards the Life
   * Area is set up with (6-2-1-10) in place of the 8 of the rule; `n` is X.
   */
  what: "attackActive" | "comboRest" | "fieldBattle" | "overRealmFromWarp" | "unionFusionAreas" | "unionFusionWarp" | "unionFusionDropBottom" | "unionEnergy" | "unionLine" | "evolveEnergyBases" | "evolveFromZEnergy" | "aegisAltDrop" | "aegisAltOpponentHand" | "attackUnnegatable" | "unionSourceUnder" | "unionSourceOpponentBattle" | "playInOpponentBattle" | "startLife";
  /** Which active (or rested) cards. Absent means any of them. */
  filter?: CardFilter;
  /** `startLife`: how many life cards the player starts with. */
  n?: number;
  /** `unionLine`: the printed text of the line granted. */
  line?: string;
  unionVariant?: "Fusion" | "Potara";
  price?: import("./vm/script").SkillPrice;
  /** `unionSourceUnder`: which Unison cards' piles may be searched (BT24-112's "your black Z-Unison"). */
  source?: CardFilter;
}

/**
 * A card no skill may touch (9-1-4) — stronger than `Prohibition`'s
 * `beChosen`, which only stops a skill *choosing* it. Enforced in one place,
 * `resolveSelector` (`immunityRefusing`), which is where every op reaches a
 * card and so is narrower than the rule by exactly one thing (see the
 * glossary's "What a card no skill may touch" entry): an effect that names no
 * card at all slips through.
 */
export interface Immunity {
  /**
   * Whose skills are blocked, as a player rather than a side — the op's
   * `from` is resolved against the script's master when the rule is made.
   * Absent means either player's, which is what the op's `from: "both"` and
   * an op with no `from` at all both come to.
   */
  from?: PlayerId;
  /** Which cards' skills are blocked. Absent means any card's. */
  fromFilter?: CardFilter;
}

/**
 * How long something in force lasts, as a client is told it: a continuous
 * effect's duration, or "permanent" for a [Permanent] skill, which holds for
 * as long as its card is where the skill is valid (9-5-1) rather than for any
 * length of time.
 */
export type EffectUntil = ContinuousEffect["until"] | "permanent";

/**
 * Skills one card has taken on from another (20-18), as the effect that grants
 * them carries them.
 *
 * A *snapshot* of the printed face, taken when the effect was made. 9-9 fixes
 * what a continuous effect grants at the moment it is created, and 20-18-1's
 * quoting convention is what the target then reads as its own text — so the
 * copy neither changes when the source is flipped or silenced afterwards nor
 * goes away when the source leaves play. The source instance is kept only to
 * say where the skills came from.
 */
export interface CopiedSkills {
  /** The catalog id of the face copied. */
  cardId: string;
  side: "front" | "back";
  /** Which of that face's skills, by their own indices. */
  skills: number[];
  /** The instance copied from, which may since have left play. */
  from?: string;
  /** That card's name, captured now, for the label. */
  name?: string;
}

/** Identity a card also counts as under 20-1, for a static or timed effect. */
export interface CardIdentityGain {
  traits: string[];
  characters: string[];
  colors: Color[];
  /** Names the card is additionally treated as; never replaces its printed name. */
  names: string[];
}

/** A continuous effect (9-9) with a duration. */
export interface ContinuousEffect {
  id: number;
  /** The card it is about; empty for a rule that is about a player, not a card. */
  target: string;
  /**
   * `negateSkill`: one printed/copied skill of the card, by index in `value`
   * (9-1-5, "negate this skill for the turn"). `negateGrantedSkill`: one
   * granted keyword, by timed effect ID or standing grant provenance in
   * `value`. `negateSkillKind`: every skill of one kind,
   * named by a `SkillKindPrefix` in `value` ("negate that card's [Auto] skill
   * for the turn"). `negateKeyword`: one keyword skill of the card, named in
   * `value` — the one the master picked ("choose up to 1 keyword skill on … and
   * negate that skill for the turn").
   */
  kind: "power" | "comboPower" | "keyword" | "gains" | "copiedSkills" | "negateSkills" | "negateSkill" | "negateGrantedSkill" | "negateSkillKind" | "negateKeyword" | "replaceLeave" | "forbid" | "permit" | "immune" | "cost" | "skillCost" | "evolveCost" | "comboCost" | "altCost" | "payer" | "zEnergy" | "specifiedCost" | "control";
  /**
   * `specifiedCost`'s value is the orbs it relaxes or demands (`sign: 1` reduces,
   * `-1` increases) rather than a flat number — see `costReduction` (script.ts)
   * and `playCost` (state.ts), which keep it apart from an ordinary cost change
   * because it never touches the total, only which colours are required.
   */
  value: number | KeywordSkill | KeywordSkill["name"] | SkillKindPrefix | CardIdentityGain | Replacement | { colors: (Color | "any")[]; sign: 1 | -1; all?: true } | { standingGrantId: string };
  /** Set when `kind` is "forbid". */
  forbid?: Prohibition;
  /** Set when `kind` is "permit". */
  permit?: Permission;
  /** Set when `kind` is "immune". */
  immune?: Immunity;
  /** Set when `kind` is "copiedSkills": the face copied and which of its skills (20-18). */
  copied?: CopiedSkills;
  /**
   * Set when `kind` is "control" (20-9): who the card goes back to when the
   * effect ends. The card is already in its new master's Battle Area — that
   * move *is* the control (20-9-1) — so the effect carries no state of its
   * own beyond the way home, and expiring it is what walks the card back.
   */
  control?: { from: PlayerId };
  /**
   * Set when `kind` is "altCost": another way to pay for the target card's own
   * [Counter] (or its play), granted for a duration rather than printed on the
   * card itself — "Until the start of your next turn, you can activate
   * mono-blue cards with [Counter] skills from your hand by …" (BT11-033).
   */
  altCost?: AltCost;
  /**
   * Set when `kind` is "payer" (20-19): what the target counts as when it is
   * rested to pay an energy cost from outside the Energy Area — one energy of
   * its own colours, or one orb of the colour named.
   */
  payAs?: "energy" | Color;
  /** Set when `kind` is "skillCost" or "evolveCost". */
  skillKind?: SkillKindPrefix;
  /** Printed orb kinds for `skillCost`/`evolveCost` modifiers, when colour-scoped. */
  colors?: (Color | "any")[];
  /** `evolveCost` only: the change holds only for an [Evolve] played onto one of these cards (`costReduction`'s `onto`, EX03-16). */
  onto?: string[];
  /**
   * `skillCost`/`evolveCost` only: how many more activations the change
   * applies to. "The next time you activate an [Activate] skill of your
   * Leader during this turn, reduce its skill cost by {b}" (BT31-096) is 1:
   * the first activation it applies to spends it and it ends there, still
   * bounded by `until`. Absent is every activation for the whole duration.
   */
  uses?: number;
  /**
   * `skillCost` only: the change reaches only the keyword skill of this name -
   * "reduce the [Z-Awaken] skill cost of ...", "the next time you activate
   * [Arrival Red/Yellow] on ..." - lower-case, with the [Evolve] family spelled
   * "ex-evolve"/"xeno-evolve" (22-5-2-2: a bare "[Evolve]" is all three, so it
   * needs none). Absent reaches every line `skillKind` allows.
   */
  tag?: string;
  /**
   * Effects put in force together by one "the next time ..." share their use:
   * spending any of them ends the lot. The id of the first one made.
   */
  group?: number;
  /** "nextTurn" runs through the opponent's whole turn and ends as yours begins. */
  until: "battle" | "turn" | "opponentTurn" | "nextTurn" | "afterNextCharge" | "afterOpponentCharge" | "game" | "whileSourceInPlay";
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

export type Trigger =
  | "leaderPlaced"
  | "played"
  /**
   * "When you play this card from your hand", "when this card is played from
   * your hand" (#936, EX03-14 and some forty others): the card's own play, and
   * only when the play's captured origin was the hand — a normal play or a skill
   * that plays from the hand — never one from the Drop, Warp or deck. Plain
   * `played` is any origin.
   */
  | "playedFromHand"
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
  /** 8-5-6: another card in your Combo Area will go to your Drop. */
  | "comboToDrop"
  /** This card's own Auto at genuine Combo Area entry (5-7-5-3/5-7-6-3). */
  | "comboUsed"
  /**
   * Something the *other* player did, watched by every card you have in play:
   * "when your opponent plays a Battle Card", "when your opponent attacks with
   * a Battle Card". The card they played or attacked with is the `subject`, so
   * "that card" and "it" point at it.
   */
  | "opponentPlayed"
  /** #1015: the same, but the opponent's own skill played it ("when your opponent uses a skill to play a Battle Card", BT15-005). A play the opponent declares from the hand is not this moment. */
  | "opponentPlayedBySkill"
  /** Your own side of it: "when your blue ≪God≫ card is played", "when you play a red ≪Android≫ card". */
  | "youPlayed"
  | "opponentAttacks"
  /** BT7-003: an opponent's skill made your energy Active on their turn. */
  | "opponentEnergyActiveBySkill"
  /** SD8-09: the opponent's skill made their own energy Active on their turn. */
  | "opponentOwnEnergyActiveBySkill"
  /** #922: this card itself is switched from Rest Mode to Active Mode (TB3-019), whoever or whatever switched it. */
  | "selfRestToActive"
  /** #916: the opponent's own [Counter] skill made their own rested energy Active (DB3-013 and four more). Any turn. */
  | "opponentOwnEnergyActiveByCounter"
  /** SD15-01: the opponent declared an attack at your red Unison with specified cost 2. */
  | "opponentAttacksRedUnison2"
  | "opponentCombos"
  /**
   * "When you use a card in a combo", "when you combo" (5-7): your own side of
   * the same moment, watched by your cards in play. `comboUsed` is the combo
   * card's own ordinary entry Auto; `comboed` remains the stored legacy name
   * and the distinct explicit end-of-battle departure moment.
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
  /**
   * The same move made by an *opponent's* skill: "when this card is placed in
   * your Drop Area from your Battle Area by an opponent's skill or KO'd"
   * (SD15-03, #728). Its "or KO'd" half is `koed`.
   */
  | "droppedByOpponent"
  /** The same sentence with no cause named, which is every cause: a skill and a battle KO alike. */
  | "leftBattleToDrop"
  | "yourCardReturnedToHand"
  /**
   * "When your ≪Shenron≫ Z-Unison leaves the Unison Area" (EX24-01b): another
   * Unison of yours leaving your Unison Area for any area, watched by your cards
   * in play. The Unison is the `subject`; what the clause says about it is a
   * condition read from its information at the moment it left (`subjectInfo`).
   */
  | "yourUnisonLeft"
  | "battleOrDeckToWarp"
  /**
   * "When [or "If"] this card is placed in your Drop Area from your hand by a
   * skill" (SD13-05, BT7-127, BT11-022): the hand's side of `droppedFromBattle`.
   * A discard by a skill's effect or as a skill's cost (1-6, 1-7-1: the cost is
   * part of the skill; 20-7-4: placing a card from the hand in the Drop is a
   * discard), never a card leaving the hand by the rules — an Extra going to
   * the Drop once it is activated (12-2-2) is not this.
   */
  | "droppedFromHand"
  /** "When your Leader Card is attacked" printed on a Battle Card (8-1). */
  | "yourLeaderAttacked"
  /** "When you take damage from an opponent's non-keyword skill" and its mirror (21-3). */
  | "youTookDamage"
  | "opponentTookDamage"
  /** "When your life moves to another area", "when your life is placed in your Drop" (3-9). */
  | "lifeLeft"
  /** "When a card evolves into this card" (22-5): this card entered play by [Evolve], not by an ordinary play. */
  | "evolvedInto"
  /** "When using this card's [Evolve] from your hand" (22-5): the [Evolve] activation itself. */
  | "evolveFromHandActivated"
  /** "When your opponent activates a [Counter] skill" (4-3): watched by your cards in play. */
  | "opponentCounter"
  /** "When you activate this card's [Counter] from your hand without paying its energy cost" (22-10). */
  | "counterFreeFromHand"
  /** "At the start of your opponent's Main Phase" (7-3): the *other* player's cards watch it. */
  | "opponentMainStart"
  /** "When this card activates [Blocker]" (22-4): the block itself, not the attack. */
  | "blockerUsed"
  /** "When this card is switched to Rest Mode by an [Alliance] skill" (22-32-3): the cards rested as the cost. */
  | "restedByAlliance"
  /** "When this card is switched to Rest Mode by one of your skills" (1-10). */
  | "restedBySkill"
  /** "When this card is switched to Rest Mode by a skill" (1-10), either player's (#907; BT18-104, P-492). */
  | "restedByAnySkill"
  /** "When this card is switched to Rest Mode by your opponent's skill" (1-10, #907). */
  | "restedByOpponentSkill"
  /** "When this card is placed in your energy" (3-8, 7-2-11), by a charge or a skill alike (#907; BT18-052, EX17-02). */
  | "placedInEnergy"
  /** The same arrival from your hand (#907; BT13-040, EX19-26 "played or placed in your energy"). */
  | "placedInEnergyFromHand"
  /** The other end of it: your skill resting one of theirs (1-10). */
  | "restedTheirsBySkill"
  /** "When this card in a Battle Area is switched to Hidden Mode by one of your skills" (1-10-2, 23-5-2-4; BT28-116, BT28-119). */
  | "hiddenBySkill"
  /** "When this Hidden Mode card in a Battle Area is placed into its owner's Drop" (9-6-9-3's "unless specified otherwise"; BT28-117, BT28-118). */
  | "hiddenToDrop"
  /** "When this card is switched to Revealed Mode" (BT29-116, BT29-125), whatever switched it — and half of "…to Revealed Mode or Hidden Mode" (BT29-121, BT29-122). */
  | "switchedRevealed"
  /** "When this card is switched to Hidden Mode" with no cause named (BT29-142's "played or switched to Hidden Mode"), and the other half of "…Revealed Mode or Hidden Mode". */
  | "switchedHidden"
  /** "When this card is placed under a … card" (23-2, BT29-140): the card going into a pile; what it says about the host is a condition on the card on top. */
  | "placedUnder"
  /** "When this card in your deck or hand is placed into its owner's Drop" (BT29-109): out of a secret area, whatever put it there — a discard included. */
  | "deckOrHandToDrop"
  /**
   * "When this card is sent from your deck to your Warp by your <Heles> card's
   * skill" (3-10, BT30-106): one of your skills moved it out of your deck into
   * the Warp. The skill's card is the `subject`, so what the card says about it
   * ("your <Heles> card's") is a condition on the subject, not part of the moment.
   */
  | "deckToWarpBySkill"
  /**
   * A keyword skill being used, watched by that player's cards in play:
   * "when you activate a [Union] skill" (22-13), "…an [Overlord] skill"
   * (22-40), "when you play a Battle Card using [Over Realm]" (22-15).
   * The card that did it is the `subject`.
   */
  | "unionActivated"
  /** "When this card's [Union-Absorb] is activated" (22-13): the keyword activation itself. */
  | "unionAbsorbActivated"
  | "overlordActivated"
  | "overRealmPlayed"
  /**
   * "When you activate a blue Extra from your hand" (12-1-3, BT29-029): an
   * Extra Card's [Activate] or [Counter] skill used from its owner's hand —
   * [Field] included — watched by that player's cards in play. The Extra is
   * the `subject`, so what the clause says about it is a condition on it.
   */
  | "extraActivated"
  /**
   * "When you play this card using [Over Realm]", "when this card is played
   * using [Over Realm]" (22-15): the card's own arrival, and only when the play
   * was [Over Realm]'s. An ordinary play of the same card is `played` and not
   * this — compiled as `played`, these skills fired on every play (2 Oct 2026).
   * `overRealmPlayed` is the watcher on *other* cards.
   */
  | "playedUsingOverRealm"
  /** "When this card is added to your Z-Energy" (17-3). */
  | "addedToZEnergy"
  /**
   * A card *placed* in a Battle Area (5-5-4): by a skill, by [Over Realm], by
   * an Evolve, by its [Field] — and by being played, since 5-5-1 makes a play
   * a placing (owner's ruling, 2 Oct 2026). "When this card is played" does
   * not cover the rest, and 42 skills say only the second.
   */
  | "placed"
  /**
   * "When a {Scouter} is placed in your Battle Area" (BT23-066), "when one of
   * your blue Z-Extras is placed in a Battle Area" (BT22-032b): another card
   * arriving in your Battle Area, played or placed by a skill (5-5-1, 5-5-4),
   * watched by your cards in play. The card is the `subject`, so what the
   * clause says about it is a condition on it.
   */
  | "yourCardPlaced"
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
  /** 9-10: the affected player chooses which replacement, if any, applies. */
  | { kind: "replaceMove"; player: PlayerId; card: string; reason: string; options: string[] }
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
  /**
   * 22-45-3: [Empower]'s "may carry up to Y markers" — a choice, not the
   * maximum. `from` is the outgoing Unison the markers would come from,
   * `max` the cap `resolvePlay` already worked out (colour checked, capped
   * by what `from` actually has); an answer of 0 declines the carry
   * entirely. `markers`/`onto`/`negated` are the rest of what `play.resolve`
   * needs to finish the play once this is answered — carried so `apply`'s
   * "empowerCarry" case can requeue that step without reaching into state
   * the prompt itself is the only record of.
   */
  | { kind: "empowerCarry"; player: PlayerId; card: string; from: string; max: number; markers?: number; onto?: string; negated?: "turn" | "game" }
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
   * The candidates are cards the chooser may not read (BT22-140: "1 card from
   * your opponent's hand"), so asking does not reveal them: they reach the
   * chooser by position, like any hidden card (`vmRevealedTo`).
   */
  blind?: true;
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
  /** `x` is the value an X price is paid at (20-5) — the same field, and the same meaning, as `play`'s. */
  /** `onto`: an [Evolve]'s base, named with the activation — offered only where a price change is scoped to that base (`costReduction`'s `onto`, EX03-16); the card then lands on it without a question. */
  | { type: "activate"; player: PlayerId; card: string; skill: number; pay?: string[]; alt?: boolean; x?: number; onto?: string }
  | { type: "attack"; player: PlayerId; attacker: string; target: string }
  | { type: "endMain"; player: PlayerId }
  | { type: "combo"; player: PlayerId; card: string; pay?: string[] }
  | { type: "pass"; player: PlayerId }
  | { type: "block"; player: PlayerId; card: string | null }
  /** `alt` pays the other cost the card prints instead of its energy cost (5-3). */
  | { type: "counter"; player: PlayerId; card: string | null; skill?: number; pay?: string[]; alt?: boolean }
  | { type: "orderPending"; player: PlayerId; index: number; decline?: true }
  | { type: "optionalCost"; player: PlayerId; pay: boolean }
  | { type: "payCost"; player: PlayerId; option: number }
  | { type: "choose"; player: PlayerId; cards: string[] }
  | { type: "chooseMode"; player: PlayerId; index: number }
  | { type: "zEnergyFromCombo"; player: PlayerId; card: string | null }
  | { type: "offering"; player: PlayerId; dropLife: boolean }
  /** Answers an "empowerCarry" prompt (22-45-3): how many markers, 0 up to the prompt's `max`, to carry over. */
  | { type: "empowerCarry"; player: PlayerId; amount: number }
  /** The referee's answer: a program in the effect language, or an empty one for "nothing happens". */
  | { type: "refereeRuling"; player: PlayerId; ops: Op[] }
  | { type: "concede"; player: PlayerId };

/** Append-only log; the UI animates from these and a replay folds them. */
export type GameEvent =
  | { type: "gameStart"; first: PlayerId; seed: number }
  | { type: "action"; action: Action }
  /** `skipped` is 20-13: the phase is announced and then not performed. */
  | { type: "phase"; phase: Phase; player: PlayerId; turn: number; skipped?: true }
  | { type: "move"; card: string; from: Area; to: Area; owner: PlayerId; index?: number; reveal?: boolean; privateOrder?: true }
  | { type: "draw"; player: PlayerId; card: string }
  | { type: "mode"; card: string; mode: Mode }
  | { type: "flip"; card: string; flipped: boolean }
  | { type: "hidden"; card: string; hidden: boolean }
  /** `from` is the Unison this card's markers were carried over from ([Empower], 22-45-3) — omitted for an ordinary gain or spend. */
  | { type: "markers"; card: string; delta: number; total: number; from?: string }
  | { type: "energyMarker"; player: PlayerId; delta: number }
  | { type: "attack"; attacker: string; target: string }
  | { type: "guardChanged"; guard: string; by: string }
  /** `skipped` is 20-13: the step is named so a client can show it, and did not happen. */
  | { type: "battleStep"; step: BattleStep; skipped?: true }
  | { type: "powerCompare"; attacker: string; guard: string; attackPower: number; guardPower: number; hit: boolean }
  | { type: "damage"; player: PlayerId; amount: number; critical: boolean; cards: string[] }
  | { type: "ko"; card: string; by?: string }
  | { type: "attackNegated" }
  /**
   * `inBattle` is read from the open battle at the moment the skill fired. A
   * client must never infer it from a power figure moving: the engine says a
   * skill belongs to the battle, and the board only draws it.
   */
  | { type: "skill"; card: string; skill: number; master: PlayerId; text: string; inBattle: boolean; reveal?: true; revealEpoch?: number }
  /** 9-6-3-1: a secret priced [Auto] was declared; activation still awaits its full cost. */
  | { type: "autoDeclared"; card: string; skill: number; master: PlayerId; text: string; revealEpoch: number }
  | { type: "effect"; effect: ContinuousEffect }
  /** A continuous effect reaching the end of its duration (9-9): the other end of `effect`. */
  | { type: "effectEnded"; effect: ContinuousEffect }
  /** An effect written down for later; `label` is the timing in plain words. */
  | { type: "delayed"; card: string; label: string }
  | { type: "token"; card: string; owner: PlayerId }
  | { type: "stack"; top: string; under: string[] }
  | { type: "note"; text: string }
  | { type: "gameOver"; winner: PlayerId | null; reason: string };

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
  | { kind: "forbidden"; by: string | null; until?: EffectUntil; unless?: string }
  /**
   * 9-1-4: the card ignores the skill altogether rather than merely refusing
   * to be chosen by it, so it is its own requirement and not a `forbidden`.
   * `whose` names the skills it ignores in the words of the player being
   * refused ("your skills", "non-<Gogeta: GT> skills"), `by` the card whose
   * rule it is when another card grants it, and `until` how long it holds.
   */
  | { kind: "immune"; card: string; whose: string; by: string | null; until?: EffectUntil }
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

/** Stable identity of one skill line on one card instance. */
export interface AbilityIdentity {
  card: string;
  /** The same index carried by an activate Action; copied skills use their engine-assigned copied index. */
  skill: number;
}

/** Read-only engine result for one manual skill line at the current decision. */
export interface AbilityAvailability extends AbilityIdentity {
  state: "offered" | "refused" | "notEvaluated";
  /** Why no cost or legality reading was made for this visible line. */
  notEvaluatedReason?: "notDecisionActor" | "unsupported" | "unidentifiedAction";
  /** Present only when the engine has current, authoritative refusal evidence. */
  why?: Requirement[];
  /** Exact current engine offers, including distinct alternative/X choices. */
  offers?: LegalAction[];
}

/** Human-readable card face, used by the UI and by Claude's view builder. */
export interface CardFace {
  name: string;
  power: number | null;
  skill: string | null;
}

// ── what every engine is handed and hands back (moved from engine.ts/state.ts, #118) ──

export interface GameContext {
  defs: Record<string, CardDef>;
  /**
   * The rules the cards play by, from `card_rules`: keyed by catalog id for a
   * front and `<id>#back` for a leader's awakened side. Nothing in the engine
   * compiles text — a card with no entry here has no rules and is played as
   * blank, and the log says so.
   */
  scripts?: Record<string, CardScripts>;
}

/**
 * A replacement effect on a card leaving the Battle Area (9-10): where it goes
 * instead. `by` narrows it to departures caused by a skill.
 */
export interface Replacement {
  /**
   * Where the card goes instead — a **redirect**. Absent on a *substitute*,
   * whose `ops` happen in the departure's place while the card stays put
   * ("place all the cards under this card in the Drop Area instead").
   */
  to?: Area;
  /** 9-10: the original requested destination this redirect answers to, when narrowed. */
  requestedTo?: Area;
  /** Explicit valid departure areas; absent retains the ordinary in-play scope. */
  from?: ("battle" | "combo")[];
  /** The position to use if the replacement redirects into a pile. */
  position?: "top" | "bottom";
  /** A timed skill replacement re-evaluates this selector at each departure. */
  target?: Selector;
  /** The selector's captured bindings when a timed skill installed it. */
  vars?: Record<string, string[]>;
  /**
   * Which departures it replaces. Absent is any of them ("would leave the
   * Battle Area"); `"skill"` is only an effect putting the card out; `"ko"`
   * only the KO; `"skillOrKo"` is what BT30-016 prints — "would be removed
   * from a Battle Area by a skill **or KO'd**", which is both causes and still
   * not a card leaving for a rule.
   */
  by?: "skill" | "ko" | "skillOrKo";
  /**
   * 9-10 with the cause narrowed to *whose* skill it was: "if this card would
   * be removed from your Battle Area **by an opponent's skill**" (19 cards).
   * `by` says a skill did it; this says whose, and the two are read together.
   * Only the two suspendable call sites know the answer, so a departure with
   * no known actor never matches — see `docs/arena-move-replacement-scope.md`
   * §1.4.
   */
  bySide?: "opponent";
  /**
   * #272: this is a `"life"` moment — a life card's own move to the hand or
   * the Drop Area (8-4-6-1's damage), not a Battle Area departure. Absent
   * means "leave"/"ko"/"play", every existing effect; `by`/`bySide` are not
   * asked when this is set, and `lifeReplacementsFor` is the reader instead
   * of `causeMatches`.
   *
   * `"marker"`: a Unison losing one marker to an attack (13-5-2) — "if this
   * card would lose a marker from an opponent's attack, you may … instead"
   * (SD13-02). Always a substitute, never a redirect: the marker stays and the
   * program runs. Read by `markerReplacementChoices` on the Damage Step alone,
   * once per marker (5-13-4-2), never by `causeMatches`.
   */
  kind?: "life" | "marker";
  /** For `kind: "life"`: narrows to the one destination named, or answers to either when absent — both cards print "to your hand or … your Drop Area". */
  lifeTo?: "hand" | "drop";
  /**
   * For `kind: "life"`: the rule is about the life card that *prints it* —
   * "if you would reveal **this card** from your life to add it to your hand,
   * you may … instead" (BT10-036, BT10-047) — so it answers only when that
   * card is the one being taken, and is read while that card lies in the Life
   * Area (9-1-3-3). Absent, the rule is about whichever life card is taken.
   */
  lifeSelf?: true;
  /** "Add that card to your energy in Rest Mode instead" — the mode it arrives in. */
  mode?: "active" | "rest";
  /** 9-10-3: the affected player may choose not to apply it. */
  optional?: boolean;
  /**
   * The program that happens instead of the departure (`replace`'s substitute
   * form). The card stays where it is; this runs in place of its move, with
   * the card bound as `subject`.
   */
  ops?: Op[];
  /** The card whose skill said so, so the substitute's program has a source. */
  source?: string;
  /** Whose skill it is, so the substitute's program runs for the right player. */
  master?: PlayerId;
  /** The [Permanent] line saying it, handed to the substitute's frame (BT29-141's once per turn). */
  skillIndex?: number;
}

/** Another way to pay for a card's [Counter] skill (5-3). */
export interface AltCost {
  /**
   * `invoker`: rest one active Red/Blue multicolour energy instead (22-37).
   * `program`: an action the card names — "by choosing 1 other black card in
   * your hand and placing it in your Drop" — compiled by the same reader as an
   * ordinary action price (4-3-3) and charged the same way, through the flow,
   * because most of them need the player to pick a card. `energy`: a reduced
   * but still-energy price — "by paying {1} instead of its energy cost"
   * (BT18-088) — read the same way a printed cost's orbs are (`orbs`).
   */
  pay: "none" | "life" | "invoker" | "program" | "energy";
  /** Cards to add from your life to your hand, for `pay: "life"`. */
  n: number;
  /**
   * Which cost it replaces: the [Counter] skill's, playing the card, or — for
   * an Extra — the energy cost of activating its [Activate: Battle] line from
   * the hand (12-2-2-2, #742; that line's own price is still paid).
   */
  for: "counter" | "play" | "activate:battle";
  /** The price to run, for `pay: "program"`. */
  ops?: Op[];
  /** The orbs to rest, one entry per orb, for `pay: "energy"`. */
  orbs?: (Color | "any")[];
}

export interface Payment {
  /**
   * Cards to switch to Rest Mode. Energy, and since 20-19 the cards outside
   * the Energy Area a rule lets stand in for one (`payersFor`) — they are
   * rested where they are and never move, so one list covers both and
   * `pay` needs no second case.
   */
  rest: string[];
  /** Energy markers to remove (1-14-2). */
  markers: number;
}

/**
 * A card that may be rested to pay an energy cost although it is not in the
 * Energy Area (20-19), and what it counts as while it does.
 *
 * `colors` is already settled: the card's own for "use this card as energy",
 * or the single colour a rule names. The planner then treats it as one more
 * active energy card of those colours, which is exactly what the rule says it
 * is — no new kind of requirement, the same answer `planPayment` already knows
 * how to give.
 */
export interface Payer {
  id: string;
  colors: Color[];
}

export type EngineContext = GameContext;

export interface DeckInput {
  name: string;
  leader: string;
  main: string[];
  z?: string[];
}

export interface GameOptions {
  seed: number;
  p1: DeckInput;
  p2: DeckInput;
}

/** Bounded facts from the exact offered executable skill, for the current own battle card. */
export interface BattleActivationSummary {
  version: 1;
  skillIndex: number;
  timing: "activate:battle" | "activate:main/battle";
  power: {
    /** Total boost applying in this battle, including turn-duration boosts. */
    battle: number;
    /** The lasting-turn subset of `battle`; never add the two figures. */
    turn: number;
  };
  /** Unconditional draws before the power effect, not a prediction of drawn identities. */
  drawnFirst: number;
}

export interface CounterResponseSummary {
  version: 1;
  skillIndex: number;
  kind: "counter:attack" | "counter:battle card attack" | "counter:counter" | "counter:play";
  /** Null means the complete effect path is outside the bounded summary. */
  negatesAttack: boolean | null;
  /** Classification of the offered payment route, from the existing price resolver. */
  alternativePrice: "none" | "free" | "other";
}

export interface LegalAction {
  action: Action;
  /** One line for menus and Claude: "Play Son Goku (3)". */
  label: string;
  /**
   * What the move costs, for the row it sits on (`docs/arena-workflow-spec.md`
   * Phase 2: every action with its price on it). Set for skill activations
   * and counters, whose price is not in the card's own numbers; a play's
   * price is its printed cost and a client reads that off the card.
   */
  cost?: ActionCost;
  battleActivation?: BattleActivationSummary;
  counterResponse?: CounterResponseSummary;
  /** A proven positive-power choice for the current own battle card; masked by the policy boundary. */
  battlePowerTarget?: string;
  /** The engine's exact current resource projection for this legal choice.
   * `energyRest` names the cards the payment plan will rest (including legal
   * 20-19 payers); `markers` are Energy markers spent and `costMarkers` are
   * markers added to or removed from the card named by the action. */
  paymentPreview?: {
    state: "known" | "choice";
    options: { energyRest: string[]; markers: number; costMarkers: number }[];
  };
}

export interface ActionCost {
  /** Energy to rest, orbs of the skill included. */
  energy: number;
  /** Which of those must be a colour. */
  orbs?: Partial<Record<Color, number>>;
  /** Unison markers added (positive) or removed (negative) as the price (13-4). */
  markers?: number;
  /** Known mandatory Life payment for this offered route. Absent means the
   * action price is not projected here, not that paying can never cost Life.
   * Describes the required payment, before any replacement of its movement. */
  life?: number;
  /**
   * The price in words, as the row shows it: "2 energy", "{r}{r}", "free",
   * "3 markers" — **except on a play**, where it is the coloured requirement
   * alone ("1 blue"). A play's total is printed on the card and the row reads
   * it there; only the specified cost can have been relaxed out from under the
   * print (owner's ruling on BT19-039), so that is the half the engine has to
   * hand over, and `priceOf` in `wording.ts` is still the one place the two
   * halves become a sentence.
   */
  describe: string;
}

export interface MoveOptions {
  /** "top" is the default: new cards go on top of Drop/Warp/Life (3-4-3, 3-9-2, 3-10-2). Deck bottom is used by some skills. */
  position?: "top" | "bottom";
  /** Entering an open area from a secret one shows the card. */
  reveal?: boolean;
  /** Keep mode/markers/effects (3-1-4-1: battle→combo, combo→battle, gaining control). */
  carry?: boolean;
  /** A rule- or effect-caused move whose cause matters for triggers (KO). */
  reason?: MoveReason;
  /** A caller-decided replacement, or null to suppress replacement lookup entirely. */
  replaced?: ReplacementResult | null;
  /** The card whose skill made the move (#907: "combo … using {X}'s skill"), carried on the `moved` moment as `viaCard`. */
  source?: string;
}
