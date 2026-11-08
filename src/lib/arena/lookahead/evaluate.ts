/**
 * How good a position is for one seat: the lookahead's yardstick at the end of
 * a played-forward line. Read from the seat's own restricted observation (what
 * it could see in that world), so the yardstick itself cannot read anything a
 * player could not.
 *
 * A plain weighted sum, deliberately simple and explainable, with every weight
 * in `EVAL_WEIGHTS` so a tuner can move them (the SPRT harness measures any
 * change, `docs/arena-policy-sprt.md`):
 *
 *  - the game's end dominates everything (a win or loss is worth more than any
 *    board);
 *  - Life is concave: the last cards of Life are worth far more than the first,
 *    for either side (8 -> 7 is a small loss, 2 -> 1 a large one);
 *  - cards in hand are combo and counter resources and future plays;
 *  - Battle Cards count by presence and power; one of the seat's own left
 *    rested where an opposing card at least as strong could attack it next turn
 *    counts half (8-4: the attacker wins ties);
 *  - energy is development; a nearly empty deck is a loss coming.
 */
import type { PolicyObservation, CardFacts, SideFacts } from "../policy/observation";

export const EVAL_WEIGHTS = {
  win: 1000,
  /** Value of having n Life (index n, capped at the last entry). */
  life: [0, 20, 36, 49, 59, 67, 73, 78, 82, 85, 87, 89],
  hand: 2.5,
  battleCard: 2,
  /** Per 5,000 power of a Battle Card. */
  battlePower: 1,
  /** Share of a Battle Card's value kept when it is rested in reach of a stronger attacker. */
  exposedShare: 0.5,
  energy: 1.5,
  /** Penalty when the deck has this many cards or fewer. */
  deckOutAt: 2,
  deckOut: 15,
} as const;

export type EvalWeights = typeof EVAL_WEIGHTS;

function lifeValue(n: number, w: EvalWeights): number {
  const table = w.life;
  return table[Math.max(0, Math.min(n, table.length - 1))];
}

function cardWorth(c: CardFacts, w: EvalWeights): number {
  return w.battleCard + (w.battlePower * Math.max(0, c.power ?? 0)) / 5000;
}

function boardValue(side: SideFacts, threats: number[], w: EvalWeights, own: boolean): number {
  let v = 0;
  for (const c of side.battle) {
    const worth = cardWorth(c, w);
    const exposed = own && c.mode === "rest" && threats.some((p) => p >= (c.power ?? 0));
    v += exposed ? worth * w.exposedShare : worth;
  }
  return v;
}

/** The value of `o`'s position for the seat that observes it; higher is better. */
export function evaluate(o: PolicyObservation, w: EvalWeights = EVAL_WEIGHTS): number {
  if (o.over) return o.over.winner === null ? 0 : o.over.winner === o.seat ? w.win : -w.win;
  const you = o.you;
  const them = o.them;
  const theirAttackers = [them.leader, ...them.battle].filter((c): c is CardFacts => !!c).map((c) => c.power ?? 0);
  let v = lifeValue(you.life, w) - lifeValue(them.life, w);
  v += w.hand * (you.handCount - them.handCount);
  v += boardValue(you, theirAttackers, w, true) - boardValue(them, [], w, false);
  v += w.energy * (you.energy.length - them.energy.length);
  if (you.deck <= w.deckOutAt) v -= w.deckOut;
  if (them.deck <= w.deckOutAt) v += w.deckOut;
  return v;
}
