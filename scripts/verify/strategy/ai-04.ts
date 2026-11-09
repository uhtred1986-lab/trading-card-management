/**
 * AI-04 Card advantage and combo opportunity costs (`docs/arena-strategy-validation.md`): accept
 * cheapest sufficient, outcome-equivalent battle/development lines, retaining required
 * material/counter cards when expendable equivalents exist.
 *
 * Every case starts inside the first of two battles, with the first attack already declared, so the
 * judged first move is the combo or counter answer itself. The attacker wins ties (8-4), a Leader hit
 * at 1 Life loses, ordinary damage moves a Life card to hand (where the defender can combo it in the
 * next battle), and the attacker combos before the defender with no second chance to answer. The
 * attackers here carry no combo power (an active Battle Card in the Battle Area can itself be
 * comboed, which would blur what the hand alone can do).
 */
import type { Action, PlayerId } from "../../../src/lib/arena/types";
import { applyMove, legalMoves, type PinnedMatch } from "../../../src/lib/arena/browser";
import { localPolicy } from "../../../src/lib/arena/policy/combat";
import { opening, other, position, synthetic, winner, type BenchCase } from "./kit";

const NO_COMBO = { comboCost: null, comboPower: null };

export const AI04_CARDS = [
  synthetic("B4-A5", 5000, NO_COMBO), synthetic("B4-A10", 10000, NO_COMBO),
  synthetic("B4-A15", 15000, NO_COMBO), synthetic("B4-A20", 20000, NO_COMBO),
  /** A 10,000 with [Critical]: its hit sends the Life card to the Drop, so the defender's hand stays known. */
  synthetic("B4-A10C", 10000, { ...NO_COMBO, skill: "[Critical]" }),
  /** Combo cards (free to combo): +5,000 and +10,000. */
  synthetic("B4-X5", 5000, { comboPower: 5000 }),
  synthetic("B4-X10", 10000, { comboPower: 10000 }),
  /** Red 1-cost counter. */
  synthetic("B4-CR", 0, { type: "EXTRA", power: null, energyCost: 1, ...NO_COMBO, skill: "[Counter: Attack] Negate the attack." }),
  synthetic("B4-L15", 15000, { type: "LEADER", energyCost: null, ...NO_COMBO }),
];

/** Apply the one legal engine move `pick` names: the case starts with the first attack declared. */
function declared(m: PinnedMatch, what: string, pick: (a: Action & Record<string, unknown>) => boolean): PinnedMatch {
  const action = legalMoves(m).map((l) => l.action).find((a) => pick(a as Action & Record<string, unknown>));
  if (!action) throw new Error(`ai-04: no legal move ${what}`);
  return applyMove(m, action).match;
}
const attackWith = (m: PinnedMatch, cardId: string) =>
  declared(m, `attacking with ${cardId}`, (a) => a.type === "attack" && typeof a.attacker === "string" && m.state.cards[a.attacker]?.cardId === cardId);

export async function ai04Cases(bundle: Parameters<typeof opening>[0]): Promise<BenchCase[]> {
  const cases: BenchCase[] = [];
  for (const seat of ["p1", "p2"] as PlayerId[]) {
    const opp = other(seat);
    const theirs = await opening(bundle, opp);
    // 1. Defender: the cheapest sufficient combo now, the bigger one for the bigger attack.
    cases.push({
      benchmark: "ai-04", key: `ai-04-cheapest-combo-${seat}`, variant: "success", seat,
      note: "At 1 Life with a 10,000 Leader, a +5,000 and a +10,000 combo in hand, a 10,000 attack declared and a 15,000 attacker still to come: combo the +5,000 now and keep the +10,000, the only card that stops the second attack.",
      match: attackWith(position(theirs, {
        [opp]: { hand: [], battle: [{ cardId: "B4-A10", mode: "active" }, { cardId: "B4-A15", mode: "active" }], energy: [], energyMarkers: 0, leaderMode: "rest" },
        [seat]: { hand: ["B4-X5", "B4-X10"], energy: [], energyMarkers: 0, battle: [], life: 1, leaderMode: "rest" },
      }), "B4-A10"),
      objective: (end) => winner(end) !== opp,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
    // 2. Defender: an expendable combo answers the first attack; the counter is the only answer to the second.
    cases.push({
      benchmark: "ai-04", key: `ai-04-keep-counter-${seat}`, variant: "adverse", seat,
      note: "At 1 Life with a 10,000 Leader, a +5,000 combo and a Red counter in hand (one Red energy), a 10,000 attack declared and a 20,000 attacker still to come: don't counter now; the combo holds this battle and the counter is the only answer to the 20,000.",
      match: attackWith(position(theirs, {
        [opp]: { hand: [], battle: [{ cardId: "B4-A10", mode: "active" }, { cardId: "B4-A20", mode: "active" }], energy: [], energyMarkers: 0, leaderMode: "rest" },
        [seat]: { hand: ["B4-X5", "B4-CR"], energy: ["B-F"], energyMarkers: 0, battle: [], life: 1, leaderMode: "rest" },
      }), "B4-A10"),
      objective: (end) => winner(end) !== opp,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
    // 3. Attacker: spend the least that wins this battle when the next battle needs the rest.
    const mine = await opening(bundle, seat);
    cases.push({
      benchmark: "ai-04", key: `ai-04-attack-least-combo-${seat}`, variant: "success", seat,
      note: "The opponent at 2 Life with a 15,000 Leader, an empty hand and no defence, a 10,000 [Critical] and a 5,000 attacker and a +5,000 and a +10,000 combo in hand, the 10,000 attack declared: combo just the +5,000 (a tie hits) and keep the +10,000 for the 5,000 attacker's lethal hit.",
      match: attackWith(position(mine, {
        [seat]: { hand: ["B4-X5", "B4-X10"], battle: [{ cardId: "B4-A10C", mode: "active" }, { cardId: "B4-A5", mode: "active" }], energy: [], energyMarkers: 0, leaderMode: "rest" },
        // [Critical]: the first hit sends its Life card to the Drop, so the defender's hand stays empty and
        // known, and the second battle is the arithmetic alone for every candidate (no hidden card decides it).
        [opp]: { hand: [], battle: [], energy: [], energyMarkers: 0, life: 2, leader: "B4-L15", leaderMode: "rest" },
      }), "B4-A10C"),
      objective: (end) => winner(end) === seat,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
    // 4. Attacker, decline: the tie already wins this battle, and the first hit hands the defender a combo card.
    cases.push({
      benchmark: "ai-04", key: `ai-04-hold-combo-${seat}`, variant: "decline", seat,
      note: "The opponent at 2 Life with a 10,000 Leader, an empty hand and +5,000 Life cards, two 10,000 attackers and one +5,000 combo, the first attack declared: spend nothing (the tie hits) and combo in the second battle, where the Life card that hit moved to hand would otherwise turn the tie.",
      match: attackWith(position(mine, {
        [seat]: { hand: ["B4-X5"], battle: [{ cardId: "B4-A10", mode: "active" }, { cardId: "B4-A10", mode: "active" }], energy: [], energyMarkers: 0, leaderMode: "rest" },
        [opp]: { hand: [], battle: [], energy: [], energyMarkers: 0, life: 2, lifeCards: ["B-F", "B-F"], leaderMode: "rest" },
      }), "B4-A10"),
      objective: (end) => winner(end) === seat,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
  }
  return cases;
}
