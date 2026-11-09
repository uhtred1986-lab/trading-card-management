/**
 * AI-09 Recursion and finite resource loops (`docs/arena-strategy-validation.md`): accept eligible
 * recovered or replayed cards that enable the specified defense or development, with limits and net
 * costs included.
 *
 * The recursion cards mirror printed forms the compiler reads completely: an Extra's
 * "[Activate: Main] Choose up to 1 card with an energy cost of 2 or less in your Drop Area and add it to
 * your hand." and a Battle Card's "[Auto] When this card is played, add up to 1 Battle Card with an
 * energy cost of 2 or less from your Drop Area to your hand." (the printed "add up to 1 … from your
 * Drop Area to your hand" form, e.g. "add up to 1 green <Gotenks> card from your Drop Area to your hand").
 */
import type { PlayerId } from "../../../src/lib/arena/types";
import type { PinnedMatch } from "../../../src/lib/arena/browser";
import { applyDecision, policyTurn } from "../../../src/lib/arena/policy/boundary";
import { answerFor } from "../../../src/lib/arena/policy/contract";
import { localPolicy } from "../../../src/lib/arena/policy/combat";
import { count, lifeOf, opening, other, position, synthetic, winner, type BenchCase } from "./kit";

const EXTRA = { type: "EXTRA" as const, comboCost: null, comboPower: null };

/** The opponent's Leader: a 5,000 swing that cannot hit a 10,000 Leader, so its Battle Card is the one threat. */
const L5 = synthetic("B9-L5", 5000, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null });
/** Recursion from the hand: an Extra that adds a card costing 2 or less from the Drop to the hand. */
const RAISE = synthetic("B9-RAISE", 0, { ...EXTRA, energyCost: 1, skill: "[Activate: Main] Choose up to 1 card with an energy cost of 2 or less in your Drop Area and add it to your hand." });
/** The same recursion at no cost: it can take itself back, so it loops for free and without end. */
const RAISE0 = synthetic("B9-RAISE0", 0, { ...EXTRA, energyCost: 0, skill: RAISE.skill });
/** Recursion on a body: played, it adds a Battle Card costing 2 or less from the Drop to the hand. */
const RECALL = synthetic("B9-RECALL", 10000, { energyCost: 1, skill: "[Auto] When this card is played, add up to 1 Battle Card with an energy cost of 2 or less from your Drop Area to your hand." });
/** A free Counter that negates an attack. */
const NEGATE = synthetic("B9-NEGATE", 0, { ...EXTRA, energyCost: 0, skill: "[Counter: Attack] Negate the attack." });
/** The same Counter at 2 energy. */
const NEGATE2 = synthetic("B9-NEGATE2", 0, { ...EXTRA, energyCost: 2, skill: "[Counter: Attack] Negate the attack." });
/** A 2-cost body with a 10,000 combo. */
const BOOST = synthetic("B9-BOOST", 10000, { energyCost: 2, comboPower: 10000 });
/** A 2-cost 15,000 body. */
const C2 = synthetic("B9-C2", 15000, { energyCost: 2 });
/** A 1-cost 10,000 body. */
const C1 = synthetic("B9-C1", 10000, { energyCost: 1 });
/** A 3-cost 20,000 body. */
const C3 = synthetic("B9-C3", 20000, { energyCost: 3 });
/** The opponent's 15,000 and 20,000 Battle Cards. */
const MID = synthetic("B9-MID", 15000);
const BRUTE = synthetic("B9-BRUTE", 20000);

export const AI09_CARDS = [L5, RAISE, RAISE0, RECALL, NEGATE, NEGATE2, BOOST, C2, C1, C3, MID, BRUTE];

const POWER: Record<string, number> = Object.fromEntries(AI09_CARDS.map((c) => [c.id, c.power ?? 0]));
const boardPower = (m: PinnedMatch, seat: PlayerId) => m.state.sides[seat].zones.battle.reduce((sum, id) => sum + (POWER[m.state.cards[id].cardId] ?? 0), 0);
const alive = (m: PinnedMatch, seat: PlayerId) => winner(m) === null && lifeOf(m, seat) >= 1;

/**
 * Play the seat's menu decisions named by `labels` (each a substring of the decision's label) from
 * `match`: how a case starts at the question a play opens (the recursion's card pick).
 */
function advance(match: PinnedMatch, seat: PlayerId, labels: string[]): PinnedMatch {
  let at = match;
  labels.forEach((want, n) => {
    const turn = policyTurn(at, seat, 1000 + n);
    const d = turn.input.decisions.decisions.find((x) => x.kind === "menu" && x.label.includes(want));
    if (!d) throw new Error(`advance: no decision "${want}" for ${seat}`);
    const played = applyDecision(at, turn.key, answerFor(turn.input.decisions, d.id));
    if (!played.ok) throw new Error(`advance: "${want}" was refused: ${played.detail}`);
    at = played.match;
  });
  return at;
}

export async function ai09Cases(bundle: Parameters<typeof opening>[0]): Promise<BenchCase[]> {
  const cases: BenchCase[] = [];
  /** 1 Life, the recursion Extra and 1 energy; the Drop holds the free Counter and a 10,000-combo body; a 20,000 attack is coming. */
  const defense = (base: PinnedMatch, seat: PlayerId, drop = [BOOST.id, NEGATE.id]) => position(base, {
    [seat]: { hand: [RAISE.id], energy: ["B-F"], energyMarkers: 0, battle: [], drop, life: 1, leaderMode: "rest" },
    [other(seat)]: { hand: [], energy: [], energyMarkers: 0, battle: [{ cardId: BRUTE.id, mode: "active" }], life: 4, leaderMode: "rest", leader: L5.id },
  });
  for (const seat of ["p1", "p2"] as PlayerId[]) {
    const base = await opening(bundle, seat);
    // 1. Recover the defense: the free Counter, not the bigger combo (20,000 ties a 20,000 attacker, and ties go to the attacker).
    cases.push({
      benchmark: "ai-09", key: `ai-09-recover-defense-${seat}`, variant: "success", seat,
      note: "1 Life, 1 energy, the recursion Extra in hand, a 20,000 attack coming: use it and take back the free Negate Counter, since the 10,000-combo body only ties the attacker.",
      match: defense(base, seat),
      objective: (end) => alive(end, seat),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
  }
  {
    const seat: PlayerId = "p1";
    const base = await opening(bundle, seat);
    // 1b. The same position at the recursion's own question: which card to take back.
    cases.push({
      benchmark: "ai-09", key: "ai-09-recover-defense-pick-p1", variant: "success", seat,
      note: "The recursion Extra resolving with the free Negate Counter and a 10,000-combo body in the Drop (Counter first this time), at 1 Life before a 20,000 attack: take the Counter.",
      match: advance(defense(base, seat, [NEGATE.id, BOOST.id]), seat, ["B9-RAISE"]),
      objective: (end) => alive(end, seat),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
  }
  {
    const seat: PlayerId = "p1";
    const base = await opening(bundle, seat);
    // 2. Development: the recursion body and the 2-cost card it takes back reach 25,000 with 3 energy.
    cases.push({
      benchmark: "ai-09", key: "ai-09-recover-develop-p1", variant: "success", seat,
      note: "3 energy, a hand of the recursion body (1) and a 3-cost 20,000, a 1-cost and a 2-cost body in the Drop, milestone 25,000 this turn: play the recursion body, take back the 2-cost 15,000 and play it.",
      match: position(base, {
        [seat]: { hand: [RECALL.id, C3.id], energy: ["B-F", "B-F", "B-F"], energyMarkers: 0, battle: [], drop: [C1.id, C2.id], life: 4, leaderMode: "rest" },
        [other(seat)]: { hand: [], battle: [], life: 4, leaderMode: "rest" },
      }),
      objective: (end) => boardPower(end, seat) >= 25000,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
  }
  {
    const seat: PlayerId = "p1";
    const base = await opening(bundle, seat);
    // 3. Net cost: after paying for the recursion, 1 energy is left, so the 2-cost Counter cannot be used; the combo body can.
    cases.push({
      benchmark: "ai-09", key: "ai-09-recover-net-cost-p1", variant: "adverse", seat,
      note: "1 Life, 2 energy, the recursion Extra resolving with a 2-cost Negate Counter and a 10,000-combo body in the Drop, a 15,000 attack coming: take the body (or the Extra itself, to loop it once onto the body), since after the recursion's 1 energy the Counter cannot be paid.",
      match: advance(position(base, {
        [seat]: { hand: [RAISE.id], energy: ["B-F", "B-F"], energyMarkers: 0, battle: [], drop: [NEGATE2.id, BOOST.id], life: 1, leaderMode: "rest" },
        [other(seat)]: { hand: [], energy: [], energyMarkers: 0, battle: [{ cardId: MID.id, mode: "active" }], life: 4, leaderMode: "rest", leader: L5.id },
      }), seat, ["B9-RAISE"]),
      objective: (end) => alive(end, seat),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
  }
  {
    const seat: PlayerId = "p1";
    const base = await opening(bundle, seat);
    // 4. Termination: a free recursion that can take itself back loops without end; take the 2-cost body once, play it, end the turn.
    cases.push({
      benchmark: "ai-09", key: "ai-09-free-loop-ends-p1", variant: "success", seat,
      note: "2 energy, the free recursion Extra in hand (it can take itself back, an unbounded loop) and a 2-cost 15,000 in the Drop: take the 15,000 once, play it and end the turn yourself, not by the cycle guard.",
      match: position(base, {
        [seat]: { hand: [RAISE0.id], energy: ["B-F", "B-F"], energyMarkers: 0, battle: [], drop: [C2.id], life: 4, leaderMode: "rest" },
        [other(seat)]: { hand: [], battle: [], life: 4, leaderMode: "rest" },
      }),
      objective: (end) => count(end, seat, "battle", C2.id) >= 1,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
      // Within 30 decisions: a line still looping there never ends the turn by itself.
      limits: { depth: 30, depthFails: true },
      unguarded: true,
    });
  }
  return cases;
}
