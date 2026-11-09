/**
 * AI-10 Optional payment and deliberate decline (`docs/arena-strategy-validation.md`): pay in full only
 * when the benefit justifies losing what the other objective needs; otherwise decline without spending.
 *
 * Every case starts at the optional price's own question (the card is already played, or the attack
 * already declared, through the engine), so the first answer the oracle judges is the payment itself:
 * which card pays, or "Choose none"; for the exact two-card price the engine first asks pay / "Don't"
 * and then takes exactly two cards, so a partial payment is never on offer. Variants: hand prices
 * (1 card for 2 draws, exactly 2 cards for 3 draws) and a Life price (BT1-014).
 */
import type { PlayerId } from "../../../src/lib/arena/types";
import { applyMove, legalMoves } from "../../../src/lib/arena/browser";
import { localPolicy } from "../../../src/lib/arena/policy/combat";
import { opening, other, position, synthetic, winner, type BenchCase } from "./kit";
import { playFromHand } from "./ai-08";

type Match = BenchCase["match"];

// Printed phrasings the compiler reads: BT6-026's "you may choose 1 ... card from your hand and place it
// in your Drop Area. If you do, ..." with BT6-011's "draw 2 cards"; BT4-097's "[Counter: Attack] Negate
// the attack."; BT6-025's [Activate: Main] Extra frame; BT1-014's Life price, word for word.
export const AI10_CARDS = [
  synthetic("B10-DRAW", 5000, { energyCost: 1, skill: "[Auto] When you play this card, you may choose 1 card from your hand and place it in your Drop Area. If you do, draw 2 cards." }),
  synthetic("B10-TWO", 5000, { energyCost: 1, skill: "[Auto] When you play this card, you may choose 2 cards from your hand and place them in your Drop Area. If you do, draw 3 cards." }),
  synthetic("B10-NEG", 0, { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Counter: Attack] Negate the attack." }),
  synthetic("B10-EXP", 0, { type: "EXTRA", energyCost: 4, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Draw 2 cards." }),
  synthetic("B10-BIG", 30000, { energyCost: 5 }),
  synthetic("B10-MID", 20000, { energyCost: 3 }),
  synthetic("B10-HUGE", 35000, { energyCost: 6 }),
  synthetic("B10-L15", 15000, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  /** What the prices draw: a 5-cost card the seat cannot afford to play, so each draw is +5,000 combo power only. */
  synthetic("B10-C5", 20000, { energyCost: 5 }),
  synthetic("B10-LIFE", 5000, { energyCost: 1, skill: "[Auto] When this card attacks, you may choose 1 card from your life and add it to your hand. If you do so, this card gains +10000 power and [Double Strike] (This card inflicts 2 damage instead of 1 when attacking) for the duration of the turn." }),
];

const alive = (seat: PlayerId) => (end: Match) => winner(end) !== other(seat);

/**
 * Name `seat`'s whole deck `cardId` (what the price would draw), on a copy of `match`. The whole deck,
 * not just its top: a player knows its decklist, not the order, so a draw is only knowable when every
 * card left in the deck is the same (the lookahead's worlds fill the deck from the decklist remainder).
 */
function deckOf(match: Match, seat: PlayerId, cardId: string): Match {
  const state = JSON.parse(JSON.stringify(match.state)) as Match["state"];
  for (const id of state.sides[seat].zones.deck) state.cards[id].cardId = cardId;
  return { ...match, state };
}

/** Declare `cardId`'s attack on the opposing Leader through the engine, so the case starts at the price it asks. */
function attackLeaderWith(match: Match, seat: PlayerId, cardId: string): Match {
  const leader = match.state.sides[other(seat)].zones.leader[0];
  const move = legalMoves(match).map((l) => l.action).find((a) => a.type === "attack" && a.player === seat && match.state.cards[a.attacker].cardId === cardId && a.target === leader);
  if (!move) throw new Error(`${seat} cannot attack with ${cardId} here`);
  const next = applyMove(match, move).match;
  if (next.state.prompt.kind !== "chooseCards" || (next.state.prompt as { player?: PlayerId }).player !== seat) throw new Error(`${cardId}'s attack did not ask ${seat} to choose (${next.state.prompt.kind})`);
  return next;
}

export async function ai10Cases(bundle: Parameters<typeof opening>[0]): Promise<BenchCase[]> {
  const cases: BenchCase[] = [];
  for (const seat of ["p1", "p2"] as PlayerId[]) {
    const foe = other(seat);
    const base = await opening(bundle, seat);
    // 1. Decline: the only card the price could take is the counter that survives the opponent's turn.
    cases.push({
      benchmark: "ai-10", key: `ai-10-keep-counter-${seat}`, variant: "decline", seat,
      note: "At 1 Life behind a 15,000 Leader facing a 30,000 attacker, the draw-2 price could only take the Negate counter: the 5,000 body and two 5,000 draws only tie the 30,000 (a tie hits), so decline.",
      match: playFromHand(deckOf(position(base, {
        [seat]: { hand: ["B10-DRAW", "B10-NEG"], energy: ["B-F", "B-F"], battle: [], life: 1, leader: "B10-L15", leaderMode: "rest" },
        [foe]: { hand: [], battle: [{ cardId: "B10-BIG", mode: "rest" }], life: 4, leaderMode: "rest" },
      }), seat, "B10-C5"), seat, "B10-DRAW"),
      objective: alive(seat),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
    // 2. Pay with the expendable card: the two draws are what holds the second attacker.
    cases.push({
      benchmark: "ai-10", key: `ai-10-pay-expendable-${seat}`, variant: "success", seat,
      note: "At 1 Life behind a 15,000 Leader facing a 30,000 and a 20,000 attacker, with the Negate counter and an unaffordable Extra in hand: pay with the Extra (Negate the 30,000, the two drawn combos hold the 20,000); declining or paying with the counter loses.",
      match: playFromHand(deckOf(position(base, {
        [seat]: { hand: ["B10-DRAW", "B10-NEG", "B10-EXP"], energy: ["B-F", "B-F"], battle: [], life: 1, leader: "B10-L15", leaderMode: "rest" },
        [foe]: { hand: [], battle: [{ cardId: "B10-BIG", mode: "rest" }, { cardId: "B10-MID", mode: "rest" }], life: 4, leaderMode: "rest" },
      }), seat, "B10-C5"), seat, "B10-DRAW"),
      objective: alive(seat),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
    // 3. An exact-count price: two cards or nothing, and the one expendable card cannot pay it alone.
    cases.push({
      benchmark: "ai-10", key: `ai-10-exact-price-${seat}`, variant: "adverse", seat,
      note: "At 1 Life behind a 15,000 Leader facing a 35,000, the price is exactly 2 cards (draw 3) and the hand is the Negate counter and one dead Extra: the Extra cannot pay alone, paying in full throws away the counter and the combos then reach only 35,000 (a tie hits), so decline.",
      match: playFromHand(deckOf(position(base, {
        [seat]: { hand: ["B10-TWO", "B10-NEG", "B10-EXP"], energy: ["B-F", "B-F"], battle: [], life: 1, leader: "B10-L15", leaderMode: "rest" },
        [foe]: { hand: [], battle: [{ cardId: "B10-HUGE", mode: "rest" }], life: 4, leaderMode: "rest" },
      }), seat, "B10-C5"), seat, "B10-TWO", "chooseMode"),
      objective: alive(seat),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
    // 4. Pay a Life for lethal: the +10,000 and [Double Strike] finish an opponent at 2 Life.
    cases.push({
      benchmark: "ai-10", key: `ai-10-life-for-lethal-${seat}`, variant: "success", seat,
      note: "A 5,000 attacker with BT1-014's Life price swings at a 10,000 Leader at 2 Life: paying 1 Life makes it 15,000 with [Double Strike], which wins now; declining bounces off.",
      match: attackLeaderWith(position(base, {
        [seat]: { hand: [], energy: ["B-F"], battle: [{ cardId: "B10-LIFE", mode: "active" }], life: 4, leaderMode: "rest" },
        [foe]: { hand: [], battle: [], life: 2, leaderMode: "active" },
      }), seat, "B10-LIFE"),
      objective: (end) => winner(end) === seat,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
    // 5. Keep the Life buffer: the same price deals 2 but leaves the seat dead to the 30,000 next turn.
    cases.push({
      benchmark: "ai-10", key: `ai-10-life-buffer-${seat}`, variant: "decline", seat,
      note: "At 2 Life behind a 15,000 Leader with one combo in hand, facing a 30,000 next turn and an opponent at 4 Life: paying 1 Life deals 2 but the 30,000's hit then kills; declining keeps the Life that hit can take.",
      match: attackLeaderWith(position(base, {
        [seat]: { hand: ["B10-C5"], energy: ["B-F"], restedEnergy: 1, battle: [{ cardId: "B10-LIFE", mode: "active" }], life: 2, leader: "B10-L15", leaderMode: "rest" },
        [foe]: { hand: [], battle: [{ cardId: "B10-BIG", mode: "rest" }], life: 4, leaderMode: "active" },
      }), seat, "B10-LIFE"),
      objective: alive(seat),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
  }
  return cases;
}
