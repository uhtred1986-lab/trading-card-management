import type { Duration, Op, Ref, Selector, Side } from "../vm/script";

/** "The card that was switched to Hidden Mode by this skill" (BT28-105, BT28-121): the card the skill's price switched (`Ctx.priceChoice`). */
export const SWITCHED_BY_THIS_SKILL = /\b(?:all )?the cards? (?:that (?:was|were) )?switched to (?:hidden|revealed) mode by this skill\b/i;

/**
 * "…with the same character name as **the card you placed under this card**"
 * (BT4-018, #930): `parseTarget` writes this placeholder into the filter's
 * `sameCharacterAs`, and the compiler's choice clause replaces it with the
 * variable the skill's price bound and placed under this card
 * (`Ctx.pricePlacedUnder`). A placeholder left anywhere else is unread
 * (`compileEffect`), never a measure against nothing.
 */
export const PLACED_UNDER_PLACEHOLDER = "placedUnderByPrice";
export const SAME_CHARACTER_AS_PLACED = /\s*,?\s*with the same character name as the card you placed under this card\b/i;

export interface Ctx {
  /** The variable the last `choose` bound. */
  last: string | null;
  /**
   * Every choice the skill has made so far, in order. "The chosen card" means
   * the last one, but a skill that chooses twice has to name them apart —
   * "place **the chosen opponent Battle Card** under **the chosen <Majin
   * Buu>**" (BT3-052, BT3-054) — and the description is what says which.
   */
  choices: { var: string; sel: Selector; reason?: string }[];
  /**
   * A [Permanent] never *acts*, so its "you can …" is a standing permission
   * rather than an offer to do something now (9-5-1) — and wrapping one in a
   * decision hides it from the static layer entirely.
   */
  permanent: boolean;
  /**
   * The variable the last `look` or `reveal` bound: the cards held out in
   * front of the player, which a following clause may pick *out of* — "look at
   * the top 3 cards of your deck, add 1 of them to your hand", "choose up to
   * 1". Only a look or a reveal makes such a pool.
   */
  lastSeen: string | null;
  /**
   * The last name bound to cards the sentence can point back at with "that
   * card": a look, a reveal, or a mill, whose cards go to the Drop face up.
   *
   * Kept apart from `lastSeen` because the two are not the same claim. A mill
   * gives the sentence something to talk about, but not a pool to draw from —
   * its cards are in the Drop already, and reading "add 1 card to your hand"
   * as taking one of them moves a card the text never offered.
   */
  lastNamed: string | null;
  /**
   * Choices that were placed *under* another choice by this skill, keyed by the
   * placed card's variable, valued with its host's (BT31-139: the Android put
   * under the chosen Cell). A card in a pile is the host's passenger, never a
   * host: a later "on top of the (originally) chosen card" names the card the
   * pile hangs from, whatever choice was made in between.
   */
  underHost?: Record<string, string>;
  /** The variable bound by the last "play …" choice — what "the card you played with this skill" means. */
  lastPlayed: string | null;
  /**
   * The card the skill's price chose, by the name the price binds it to —
   * "the card that was switched to Hidden Mode **by this skill**" (BT28-105,
   * BT28-121) is that card and no other. Absent when the price chose nothing.
   */
  priceChoice?: string;
  /**
   * Every card the price *chose* ("then choose 1 of your red <Android 17> cards
   * and 1 of your red <Android 18> cards", BT23-007), by the names it binds —
   * not the pile card it placed on top of this card (`placeOnTop`), which it
   * placed rather than chose. What "all of the chosen cards" in the effect means
   * when the effect has chosen nothing of its own.
   */
  priceChosen?: string[];
  /**
   * The price's choice is a discard: it moves the cards it chose to the Drop
   * Area. "The cards discarded by this skill" (BT20-090, BT20-107..109) means
   * those and nothing else, so it is read only when this holds.
   */
  priceDiscarded?: boolean;
  /**
   * The price's single one-card choice is placed under this card ("Choose 1
   * of your Battle Cards and place it under this card", BT4-018, #930): what
   * "the card you placed under this card" names in the effect. Read only when
   * this holds.
   */
  pricePlacedUnder?: boolean;
  /**
   * The name the skill's price bound the card it revealed to ("…choose 1 card in
   * your hand with a [union-fusion] skill and reveal it", EX13-14; "…reveal 1
   * card with [Union-Fusion] in your hand", SD19-03): what "the revealed card"
   * in the effect means (#930). Absent when the price revealed nothing.
   */
  priceRevealed?: string;
  /**
   * The cards this skill's own effect last switched to Hidden or Revealed
   * Mode — "then switch all the cards switched to Hidden Mode by this skill
   * to Revealed Mode" (BT29-139), where the price switched nothing.
   */
  switchedHere?: string;
  /**
   * The cards this skill's own effect last sent to a Warp, by the name the
   * choice bound — "…send it to its owner's Warp. At the end of your opponent's
   * next turn, return **the card sent to the Warp by this skill** to its owner's
   * hand" (BT13-025, phrasing batch 1). Only a move of a bound choice sets it.
   */
  sentToWarp?: string;
  /** The span of the last power change or grant read ("…for the battle"), for an "it also gains …" that prints none (BT12-083). */
  lastUntil?: "battle" | "turn";
  /** The name the last KO of a bound choice used: "if the KO'd card was a ≪Saiyan≫ card" (BT25-097). */
  koed?: string;
  /** The name the last move of a bound choice to a Drop used: "If you placed a card in your Drop Area using this skill" (EX19-11, phrasing batch 2). */
  dropped?: string;
  /**
   * What "it"/"them" points at. Card text carries the subject from clause to
   * clause — "Switch this card to Active Mode and it gets +5000 power" means
   * this card — so the last target of any clause counts, not only a choice.
   */
  lastTarget: Ref | null;
  /**
   * The antecedent that was standing when a clause in this skill went unread.
   *
   * A refusal is not silent for the clauses after it: the sentence goes on
   * talking about what the refused clause named, and there is nothing bound to
   * it. An [Auto] seeds the antecedent to the card it is on, so "…, and **it**
   * gains [Double Strike]" after an unread play lands on the card printing the
   * skill (P-645). Held by identity, not as a flag: any clause that does bind
   * something new writes a fresh `lastTarget`, and the reference after it is
   * pointing at that rather than at the hole.
   */
  stale: Ref | null;
  /**
   * Set once a refused clause was itself a two-named-card search
   * (`TWO_NAMED_CARDS`, in `parseTarget`) — the one case where a plural
   * pronoun after a stale target must not fall back to it even though the
   * stale target is not `self`. See the `c.stale` check in `refFor` for why
   * this is narrower than generalising that check to every subject.
   */
  twoNamedCardsRefused: boolean;
  /** The op the previous clause produced, for wordings that restate it. */
  lastOp: string | null;
  /**
   * Set by "if this card would leave the Battle Area": the *next* clause says
   * where it goes instead, so it becomes a replacement rather than a move
   * (9-10).
   */
  replacing: { from?: ("battle" | "combo")[]; by?: "skill" | "ko" | "skillOrKo" | "skillOrKoBySkill" | "koInBattle"; bySide?: "opponent" | "you"; subject?: string; subjectSide?: Side; event?: "life" | "marker"; to?: "hand" | "drop"; lifeSelf?: true; requestedTo?: "hand" | "drop"; until?: Duration } | null;
  /**
   * The steps of a replacement's body read so far, when the sentence runs past
   * one clause and the word "instead" has not arrived yet (9-10, #107). Held
   * rather than pushed, so the whole sentence becomes the replacement and no
   * half of it escapes to happen always.
   */
  replacingOps?: Op[];
  /** Those clauses' own text, so all of them are refused together if the last one cannot be read. */
  replacingClauses?: string[];
  /** 9-10-3's "you may", wherever in the body's clauses it was printed. */
  replacingOffered?: boolean;
  n: number;
  /**
   * A counter of its own for the names a mill binds, so `n` keeps its count.
   *
   * A skill's price and its effect are compiled separately and both start at
   * `c0`, and that collision is load-bearing: `runSkill` merges the price's
   * bindings into the effect's frame by name, which is how "the chosen card"
   * in an effect means the card its cost chose (4-3-3). Spending `n` on a mill
   * would push the effect's own first choice to `c1`, leaving the price's `c0`
   * alive underneath it — and a later reference then moves the card the price
   * already spent.
   */
  mills: number;
  /**
   * And another for the names an optional price binds, and for the same
   * reason: `n` is the counter the price/effect merge leans on, so spending
   * it here would leave the price's own `c0` alive under the effect's first
   * choice.
   */
  costs: number;
  /** The skill text with its explanatory notes still in place. A token's stats are printed there. */
  raw: string;
  /** The kind of the skill being read (`counter:play`, …): a [Counter: Play] restating its own moment says nothing more (phrasing batch 2). */
  skillKind?: string;
  /**
   * Does this skill's price charge an X (20-5)? Only then may a clause read
   * `X` as an amount.
   *
   * Without the gate, "Draw X cards" compiles on any card that prints the
   * letter, and DB3-138 — whose price is "{u}(X)", a notation this compiler
   * does not read — turned from honestly unread into a program with an `X`
   * nothing binds. That program throws when it resolves, which is a worse
   * answer than the gap it replaced.
   */
  xBound: boolean;
}

export const countWord = (w: string) => (/^\d+$/.test(w) ? Number(w) : 1);
