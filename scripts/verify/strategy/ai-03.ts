/**
 * AI-03 Energy, colors and future payments (`docs/arena-strategy-validation.md`): accept
 * development/payment orders preserving the specified follow-up or defensive cost, unless immediate
 * survival or proven lethal dominates it; equivalent active colored sources may all qualify.
 *
 * Energy colours are the energy cards' own colours; a fixed cost's specified cost is one orb of each
 * of the card's colours (`specifiedCostOf`). The engine folds payments resting the same colours into
 * one, so a `payCost` question is asked only when the colours differ, and it lists them in colour
 * order: wherever a case below asks for a payment, the first one offered is a wrong one (a policy
 * that takes the first payment fails). Energy rested in your own turn
 * stays rested through the opponent's turn (cards stand up at the start of their owner's turn), which
 * is what makes a payment in your turn a future cost.
 */
import type { Action, PlayerId } from "../../../src/lib/arena/types";
import { applyMove, legalMoves, type PinnedMatch } from "../../../src/lib/arena/browser";
import { localPolicy } from "../../../src/lib/arena/policy/combat";
import { count, opening, other, position, synthetic, winner, type BenchCase } from "./kit";

const NO_COMBO = { comboCost: null, comboPower: null };
/** A card that is only ever staged as an energy source of one colour. */
const source = (id: string, color: "Blue" | "Green" | "Yellow") => synthetic(id, 10000, { colors: [color], ...NO_COMBO });
const COUNTER = "[Counter: Attack] Negate the attack.";

export const AI03_CARDS = [
  source("B3-EB", "Blue"), source("B3-EG", "Green"), source("B3-EY", "Yellow"),
  /** Red 2-cost development ({r} + 1); 5,000, so it cannot hit a 10,000 Leader. */
  synthetic("B3-R2", 5000, { energyCost: 2, ...NO_COMBO }),
  /** Red/Blue 2-cost follow-up ({r}{u}). */
  synthetic("B3-RB2", 10000, { colors: ["Red", "Blue"], energyCost: 2, ...NO_COMBO }),
  /** Red 3-cost finisher ({r} + 2); 10,000 hits a 10,000 Leader (the attacker wins ties). */
  synthetic("B3-R3", 10000, { energyCost: 3, ...NO_COMBO }),
  /** Blue 1-cost counter ({u}). */
  synthetic("B3-CB", 0, { type: "EXTRA", colors: ["Blue"], power: null, energyCost: 1, ...NO_COMBO, skill: COUNTER }),
  /** Blue 2-cost counter ({u} + 1). */
  synthetic("B3-CB2", 0, { type: "EXTRA", colors: ["Blue"], power: null, energyCost: 2, ...NO_COMBO, skill: COUNTER }),
  /** Red 1-cost counter ({r}). */
  synthetic("B3-CR", 0, { type: "EXTRA", power: null, energyCost: 1, ...NO_COMBO, skill: COUNTER }),
  /** The threat: beats a 20,000 Leader on its own. */
  synthetic("B3-X25", 25000, NO_COMBO),
  synthetic("B3-L20", 20000, { type: "LEADER", energyCost: null, ...NO_COMBO }),
];

/** Apply the one legal engine move `pick` names: a case that starts mid-turn (a declared play or attack). */
function declared(m: PinnedMatch, what: string, pick: (a: Action & Record<string, unknown>) => boolean): PinnedMatch {
  const action = legalMoves(m).map((l) => l.action).find((a) => pick(a as Action & Record<string, unknown>));
  if (!action) throw new Error(`ai-03: no legal move ${what}`);
  return applyMove(m, action).match;
}
const cardIs = (m: PinnedMatch, id: unknown, cardId: string) => typeof id === "string" && m.state.cards[id]?.cardId === cardId;

export async function ai03Cases(bundle: Parameters<typeof opening>[0]): Promise<BenchCase[]> {
  const cases: BenchCase[] = [];
  for (const seat of ["p1", "p2"] as PlayerId[]) {
    const opp = other(seat);
    const mine = await opening(bundle, seat);
    // 1. The payment itself: the 2-cost is declared, and only a Red + off-colour payment leaves {r}{u} for the follow-up.
    const pay = position(mine, {
      [seat]: { hand: ["B3-R2", "B3-RB2"], energy: ["B-F", "B-F", "B3-EB", "B3-EG", "B3-EY"], energyMarkers: 0, battle: [], leaderMode: "rest" },
      [opp]: { hand: [], battle: [], energy: [], energyMarkers: 0, life: 8, leaderMode: "rest" },
    });
    cases.push({
      benchmark: "ai-03", key: `ai-03-pay-preserve-${seat}`, variant: "success", seat,
      note: "Red, Red, Blue, Green and Yellow energy, the Red 2-cost declared and the Red/Blue 2-cost still in hand: pay Red with Green or Yellow (both qualify), never the second Red or the Blue the follow-up needs.",
      match: declared(pay, "playing B3-R2", (a) => a.type === "play" && cardIs(pay, a.card, "B3-R2")),
      objective: (end) => count(end, seat, "battle", "B3-R2") === 1 && count(end, seat, "battle", "B3-RB2") === 1,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
    // 2. A future-turn defensive cost: develop, but keep the Blue the counter needs in the opponent's turn.
    cases.push({
      benchmark: "ai-03", key: `ai-03-keep-counter-colour-${seat}`, variant: "success", seat,
      note: "At 1 Life against a 25,000 attacker, with Red, Red and Blue energy and a Blue counter in hand: develop the Red 2-cost paying Red + Red, so the Blue stays active to negate the attack next turn.",
      match: position(mine, {
        [seat]: { hand: ["B3-R2", "B3-CB"], energy: ["B-F", "B-F", "B3-EB"], energyMarkers: 0, battle: [], life: 1, leader: "B3-L20", leaderMode: "rest" },
        [opp]: { hand: [], battle: [{ cardId: "B3-X25", mode: "rest" }], energy: [], energyMarkers: 0, life: 8, leaderMode: "rest" },
      }),
      objective: (end) => count(end, seat, "hand", "B3-R2") === 0 && winner(end) !== opp,
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
    // 3. A defensive payment in the opponent's turn: two lethal attacks, two counters, one Red.
    const theirs = await opening(bundle, opp);
    const defend = position(theirs, {
      [opp]: { hand: [], battle: [{ cardId: "B3-X25", mode: "active" }, { cardId: "B3-X25", mode: "active" }], energy: [], energyMarkers: 0, leaderMode: "rest" },
      [seat]: { hand: ["B3-CB2", "B3-CR"], energy: ["B-F", "B3-EB", "B3-EY"], energyMarkers: 0, battle: [], life: 1, leader: "B3-L20", leaderMode: "rest" },
    });
    const attacked = declared(defend, "attacking with B3-X25", (a) => a.type === "attack" && cardIs(defend, a.attacker, "B3-X25"));
    cases.push({
      benchmark: "ai-03", key: `ai-03-counter-payment-${seat}`, variant: "success", seat,
      note: "At 1 Life facing two 25,000 attacks, the Blue 2-cost counter declared against the first, Red, Blue and Yellow energy and a Red counter in hand: pay Blue + Yellow so the Red counter still negates the second attack.",
      match: declared(attacked, "countering with B3-CB2", (a) => a.type === "counter" && cardIs(attacked, a.card, "B3-CB2")),
      objective: (end) => winner(end) !== opp,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
    // 4. The boundary: no payment preserves the Blue, so developing is declined.
    cases.push({
      benchmark: "ai-03", key: `ai-03-no-spare-colour-${seat}`, variant: "decline", seat,
      note: "At 1 Life against a 25,000 attacker, with only Red and Blue energy and a Blue counter in hand: the Red 2-cost would take the Blue too, so a good player develops nothing and ends the turn.",
      match: position(mine, {
        [seat]: { hand: ["B3-R2", "B3-CB"], energy: ["B-F", "B3-EB"], energyMarkers: 0, battle: [], life: 1, leader: "B3-L20", leaderMode: "rest" },
        [opp]: { hand: [], battle: [{ cardId: "B3-X25", mode: "rest" }], energy: [], energyMarkers: 0, life: 8, leaderMode: "rest" },
      }),
      objective: (end) => winner(end) !== opp,
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
    // 5. Proven lethal dominates the reserve: spend the counter's Blue on the finisher.
    cases.push({
      benchmark: "ai-03", key: `ai-03-lethal-spends-reserve-${seat}`, variant: "adverse", seat,
      note: "At 1 Life against a 25,000 attacker with a Blue counter in hand and Red, Red and Blue energy, but the opponent at 1 Life with no defence: play the Red 3-cost, which takes the Blue, and win with its attack; the reserving line (the 2-cost on Red + Red) cannot hit.",
      match: position(mine, {
        [seat]: { hand: ["B3-R2", "B3-R3", "B3-CB"], energy: ["B-F", "B-F", "B3-EB"], energyMarkers: 0, battle: [], life: 1, leader: "B3-L20", leaderMode: "rest" },
        [opp]: { hand: [], battle: [{ cardId: "B3-X25", mode: "rest" }], energy: [], energyMarkers: 0, life: 1, leaderMode: "rest" },
      }),
      objective: (end) => winner(end) === seat,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
  }
  return cases;
}
