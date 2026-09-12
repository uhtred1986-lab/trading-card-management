import type { Ref, Selector } from "../script";

export interface Ctx {
  /** The variable the last `choose` bound. */
  last: string | null;
  /**
   * Every choice the skill has made so far, in order. "The chosen card" means
   * the last one, but a skill that chooses twice has to name them apart —
   * "place **the chosen opponent Battle Card** under **the chosen <Majin
   * Buu>**" (BT3-052, BT3-054) — and the description is what says which.
   */
  choices: { var: string; sel: Selector }[];
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
  /** The variable bound by the last "play …" choice — what "the card you played with this skill" means. */
  lastPlayed: string | null;
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
  replacing: { by?: "skill" | "ko" | "skillOrKo"; subject?: string } | null;
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
