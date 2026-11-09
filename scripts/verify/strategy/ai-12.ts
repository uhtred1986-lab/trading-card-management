/**
 * AI-12 Adapt pressure, control and long-game plans (`docs/arena-strategy-validation.md`): accept
 * finite continuations that pressure when delay loses the race and stabilize when racing loses.
 * Horizon: the rest of this turn and the opponent's whole next turn (`turns: 2`); objective: not lost
 * at the start of the seat's next turn; declared opponent: `localPolicy()`.
 *
 * One board, three race states. The seat has a 15,000 Leader and an active 25,000 [Blocker]; the
 * opponent's Leader is 5,000 and its hand is empty, so every attack this turn hits.
 *  - stabilize (decline): at 2 Life against two 20,000 attackers, the blocker must stay home;
 *  - pressure (success): with the opponent at 2 Life and three 30,000 attackers, holding back loses
 *    next turn, so the Leader and the blocker must both swing now;
 *  - blocked race (adverse): the opponent at 2 Life but with a visible active 5,000 [Blocker], so the
 *    tempting two-attack race cannot finish and the swung blocker is missed next turn.
 *
 * The numbers follow the declared opponent's attack scoring (`policy/main.ts`, `scoreAttack`): it
 * halves a Leader attack while the defender has an active [Blocker] *stronger* than the attacker, and
 * prefers KO'ing any rested Battle Card it can beat (power >= the card's). So the 20,000 attackers
 * neither run into the 25,000 blocker nor can KO it when it is rested: with it rested they both go to
 * the Leader. The 30,000 attackers are not deterred, which is what makes holding back lose. Traced:
 * with the blocker home the opponent attacks into it and spends its other attacker as a combo to KO
 * it; with the blocker rested both attackers hit the Leader.
 */
import type { PlayerId } from "../../../src/lib/arena/types";
import { localPolicy } from "../../../src/lib/arena/policy/combat";
import { opening, other, position, synthetic, winner, type BenchCase, type Side } from "./kit";

export const AI12_CARDS = [
  synthetic("B12-L15", 15000, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  synthetic("B12-L5", 5000, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  synthetic("B12-BLK", 25000, { skill: "[Blocker]" }),
  synthetic("B12-A20", 20000),
  synthetic("B12-A30", 30000),
  synthetic("B12-OBK", 5000, { skill: "[Blocker]" }),
];

const notLost = (seat: PlayerId): BenchCase["objective"] => (end) => winner(end) !== other(seat);

export async function ai12Cases(bundle: Parameters<typeof opening>[0]): Promise<BenchCase[]> {
  const cases: BenchCase[] = [];
  for (const seat of ["p1", "p2"] as PlayerId[]) {
    const base = await opening(bundle, seat);
    const opp = other(seat);
    const me: Side = { hand: [], energy: [], energyMarkers: 0, battle: [{ cardId: "B12-BLK", mode: "active" }], life: 2, leader: "B12-L15", leaderMode: "active" };
    const them = (battle: Side["battle"], life: number): Side => ({ hand: [], energy: [], energyMarkers: 0, battle, life, leader: "B12-L5", leaderMode: "rest" });
    const common = { benchmark: "ai-12" as const, seat, objective: notLost(seat), horizon: { kind: "turns" as const, n: 2 }, opponent: localPolicy() };
    cases.push({
      ...common, key: `ai-12-stabilize-${seat}`, variant: "decline",
      note: "At 2 Life against two active 20,000 attackers (the opponent at 4), with a 15,000 Leader and an active 25,000 [Blocker]: swinging the blocker at the 5,000 Leader hits but leaves it rested and both attackers then kill, while keeping it home (the Leader may swing) survives.",
      match: position(base, { [seat]: me, [opp]: them([{ cardId: "B12-A20", mode: "active" }, { cardId: "B12-A20", mode: "active" }], 4) }),
    });
    cases.push({
      ...common, key: `ai-12-pressure-${seat}`, variant: "success",
      note: "Both at 2 Life, the opponent with three rested 30,000 attackers that out-class the 25,000 [Blocker]: holding back loses next turn whatever is blocked, while the Leader and the blocker together take the last 2 Life now.",
      match: position(base, { [seat]: me, [opp]: them([{ cardId: "B12-A30", mode: "rest" }, { cardId: "B12-A30", mode: "rest" }, { cardId: "B12-A30", mode: "rest" }], 2) }),
    });
    cases.push({
      ...common, key: `ai-12-blocked-race-${seat}`, variant: "adverse",
      note: "Both at 2 Life, but the opponent shows an active 5,000 [Blocker] beside two active 20,000 attackers: the two-attack race cannot finish, the swung 25,000 [Blocker] is then rested for both attackers, and keeping it home survives.",
      match: position(base, { [seat]: me, [opp]: them([{ cardId: "B12-A20", mode: "active" }, { cardId: "B12-A20", mode: "active" }, { cardId: "B12-OBK", mode: "active" }], 2) }),
    });
  }
  return cases;
}
