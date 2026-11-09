/**
 * AI-06 Development sequencing and curve (`docs/arena-strategy-validation.md`): accept feasible turn
 * sequences reaching the specified board milestone while preserving necessary defense; a more
 * expensive play is not automatically better, and ending the turn can be right.
 */
import type { PlayerId } from "../../../src/lib/arena/types";
import { localPolicy } from "../../../src/lib/arena/policy/combat";
import { opening, other, position, synthetic, type BenchCase } from "./kit";

export const AI06_CARDS = [
  synthetic("B-C1", 10000, { energyCost: 1 }),
  synthetic("B-C2", 15000, { energyCost: 2 }),
  synthetic("B-C3", 20000, { energyCost: 3 }),
];

/** The seat's total Battle Card power on board. */
function boardPower(m: Parameters<BenchCase["objective"]>[0], seat: PlayerId): number {
  return m.state.sides[seat].zones.battle.reduce((sum, id) => sum + (m.state.cards[id].cardId === "B-C1" ? 10000 : m.state.cards[id].cardId === "B-C2" ? 15000 : m.state.cards[id].cardId === "B-C3" ? 20000 : 0), 0);
}

export async function ai06Cases(bundle: Parameters<typeof opening>[0]): Promise<BenchCase[]> {
  const cases: BenchCase[] = [];
  for (const seat of ["p1", "p2"] as PlayerId[]) {
    const base = await opening(bundle, seat);
    // 1. Curve: two cheap plays out-develop one expensive play with the same energy.
    cases.push({
      benchmark: "ai-06", key: `ai-06-curve-${seat}`, variant: "success", seat,
      note: "3 energy, hand of 1-, 2- and 3-cost cards: the 1 and the 2 (25,000) beat the 3 alone (20,000).",
      match: position(base, {
        [seat]: { hand: ["B-C1", "B-C2", "B-C3"], energy: ["B-F", "B-F", "B-F"], battle: [], leaderMode: "rest" },
        [other(seat)]: { hand: [], battle: [], life: 8, leaderMode: "rest" },
      }),
      objective: (end) => boardPower(end, seat) >= 25000,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
  }
  // 2. The boundary: with 4 energy and a 30,000 milestone only 1 + 3 works; the 2 first cannot reach it.
  {
    const seat: PlayerId = "p1";
    const base = await opening(bundle, seat);
    cases.push({
      benchmark: "ai-06", key: "ai-06-curve-boundary-p1", variant: "adverse", seat,
      note: "4 energy, hand of 1-, 2- and 3-cost cards, milestone 30,000: only the 1 and the 3 reach it; the cheapest-first order (1, 2) does not.",
      match: position(base, {
        [seat]: { hand: ["B-C1", "B-C2", "B-C3"], energy: ["B-F", "B-F", "B-F", "B-F"], battle: [], leaderMode: "rest" },
        [other(seat)]: { hand: [], battle: [], life: 8, leaderMode: "rest" },
      }),
      objective: (end) => boardPower(end, seat) >= 30000,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
  }
  return cases;
}
