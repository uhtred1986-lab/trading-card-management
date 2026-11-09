/**
 * AI-11 Robust hidden-information choices (`docs/arena-strategy-validation.md`): identical answers
 * for identical permitted observations under hidden permutations, and, within those answers, a
 * predeclared public-information risk objective scored under an explicit response distribution —
 * never a reward for knowing the unseen card.
 *
 * A **risk case** is one position the candidate seat sees, played out in several *deals*: the same
 * board with the opponent's hidden cards re-faced (its hand, or the order of its Life). The deals are
 * the declared response distribution (each with a weight). The opponent's card multiset is the same
 * in every deal (a 10,000 combo card not in the hand lies at the bottom of its deck), so the deals
 * differ in nothing the seat may read — not even the Hard difficulty's decklist counts — and
 * `solveRisk` asserts it (same restricted input, same card list per owner, same first options).
 *
 * Scoring (the answer key is the oracle, per deal):
 *  - `solve` (kit) gives each deal's acceptable first moves;
 *  - a first move's *share* is the weight of the deals it is acceptable in, over the total;
 *  - the *risk-acceptable* first moves are those whose share reaches the case's declared threshold;
 *  - a candidate passes when (1) its first answer is the same in every deal and on hidden-state
 *    twins of every deal (`permutedFor`, several salts: same decision, same picked cards, same
 *    memory), (2) that first move is risk-acceptable, and (3) its own line reaches the objective in
 *    deals carrying at least the threshold's share of the weight — the kit's "acceptable first move
 *    AND objective reached", taken over the distribution.
 *
 * The cards: the opponent's hand, deck and Life are pure combo cards (`B11-F5`, `B11-C10`; energy
 * cost 9 and 8, so neither is ever played and the 5,000 one is the card the charge rule gives up),
 * 20 of its 50 the 10,000 one, one of them shown in its Drop. Its attacker and the seat's
 * non-blocking attacker cannot pay their combo cost (9), so neither is a combo card.
 *  - pressure and decline (the hidden hand): every attacker but the Leaders has [Critical], so no hit
 *    puts a Life card in a hand; the declared opponent covers "exactly enough" as attacker and never
 *    stops a hit it cannot stop, so its hand reaches the next turn whole, and what decides each deal
 *    is exactly that hand's combo total against the seat's guard once the blocker is rested;
 *  - Life order: the seat's attackers have no [Critical] on purpose — the first hit hands the
 *    opponent its top Life card, which it combos to stop the second attack when it can.
 */
import type { PlayerId } from "../../../src/lib/arena/types";
import type { PinnedMatch } from "../../../src/lib/arena/browser";
import { localPolicy } from "../../../src/lib/arena/policy/combat";
import { policyTurn } from "../../../src/lib/arena/policy/boundary";
import { stableJson, type PolicyAnswer } from "../../../src/lib/arena/policy/contract";
import { localMemory } from "../../../src/lib/arena/policy/main";
import { policyRng } from "../../../src/lib/arena/policy/rng";
import { permutedFor } from "../arena-policy-permute";
import { judge, lifeOf, opening, other, position, solve, synthetic, winner, type BenchCase, type Candidate, type Oracle, type Result } from "./kit";

export const AI11_CARDS = [
  synthetic("B11-L20", 20000, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  synthetic("B11-L5", 5000, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
  synthetic("B11-X25", 25000, { comboCost: 9, skill: "[Critical]" }),
  synthetic("B11-BLK", 25000, { skill: "[Blocker] [Critical]" }),
  synthetic("B11-A20", 20000, { comboCost: 9, skill: "[Critical]" }),
  synthetic("B11-F5", 5000, { energyCost: 9, comboPower: 5000 }),
  synthetic("B11-C10", 5000, { energyCost: 8, comboPower: 10000 }),
  synthetic("B11-P10", 10000),
  synthetic("B11-Q20", 20000),
];

/** The opponent's 10,000 combo cards in all (one shown in its Drop, the rest in hand or at the bottom of its deck). */
export const AI11_C10_COPIES = 20;

export interface Deal {
  /** The opponent's hidden cards in this deal: its hand in hand order, or its Life from index 0. */
  label: string;
  weight: number;
  case: BenchCase;
}

export interface RiskCase {
  benchmark: "ai-11";
  key: string;
  variant: BenchCase["variant"];
  note: string;
  seat: PlayerId;
  /** The declared response distribution. Every deal is the same position up to cards the seat may not read. */
  deals: Deal[];
  /** A first move is risk-acceptable when the deals it is acceptable in carry at least this share of the weight. */
  threshold: number;
  /** The public-information risk rule, in words. */
  rule: string;
}

export interface RiskOracle {
  options: string[];
  /** Each first move's share of the weight among the deals it is acceptable in. */
  share: Record<string, number>;
  riskAcceptable: Set<string>;
  perDeal: Oracle[];
  nodes: number;
}

export interface RiskResult extends Result {
  /** The first answer was the same in every deal and on every hidden-state twin. */
  invariant: boolean;
  /** What differed, when it did. */
  differences: string[];
  twinChecks: number;
  /** Twins whose state differs from their deal's (a twin that changed nothing would prove nothing). */
  twinNontrivial: number;
  /** The first move's share (0 when it is no option at all). */
  share: number;
  /** The share of the weight in whose deals the candidate's own line reached the objective. */
  objectiveShare: number;
  threshold: number;
}

/** The first answer as the kit's oracle names it: a pick by its cards, a menu decision by its id. */
const keyOf = (answer: PolicyAnswer | undefined, id: string) => (answer?.cards ? `${answer.id}[${[...answer.cards].sort().join(",")}]` : (answer?.id ?? id));
/** The memory the kit's `judge` gives the seat for its first decision. */
const firstMemory = (seat: PlayerId) => localMemory(policyRng(seat === "p1" ? 41 : 42));
/** What the seat is shown at the case's position (its restricted input). */
const shown = (m: PinnedMatch, seat: PlayerId) => stableJson(policyTurn(m, seat, 0).input);

/**
 * The answer key of a risk case: each deal solved by the kit's exhaustive oracle, and the share of
 * the declared weight each first move is acceptable in. Throws when the deals are not one
 * information set for the seat (a different restricted input or a different opponent decklist).
 */
export function solveRisk(rc: RiskCase): RiskOracle {
  const [first, ...rest] = rc.deals;
  const seen = shown(first.case.match, rc.seat);
  const list = (m: PinnedMatch, p: PlayerId) => stableJson(Object.values(m.state.cards).filter((c) => c.owner === p).map((c) => c.cardId).sort());
  for (const d of rest) {
    if (d.case.seat !== rc.seat) throw new Error(`${rc.key}: deal ${d.label} is for another seat`);
    if (shown(d.case.match, rc.seat) !== seen) throw new Error(`${rc.key}: deal ${d.label} shows the seat something deal ${first.label} does not`);
    for (const p of ["p1", "p2"] as PlayerId[]) if (list(d.case.match, p) !== list(first.case.match, p)) throw new Error(`${rc.key}: deal ${d.label} changes ${p}'s card list`);
  }
  const perDeal = rc.deals.map((d) => solve(d.case));
  const options = perDeal[0].options;
  for (const [i, o] of perDeal.entries()) if (stableJson(o.options) !== stableJson(options)) throw new Error(`${rc.key}: deal ${rc.deals[i].label} offers other first moves`);
  const total = rc.deals.reduce((n, d) => n + d.weight, 0);
  const share: Record<string, number> = {};
  for (const o of options) share[o] = rc.deals.reduce((n, d, i) => n + (perDeal[i].acceptable.has(o) ? d.weight : 0), 0) / total;
  const riskAcceptable = new Set(options.filter((o) => share[o] >= rc.threshold - 1e-9));
  return { options, share, riskAcceptable, perDeal, nodes: perDeal.reduce((n, o) => n + o.nodes, 0) };
}

/**
 * The candidate's first answer, compared across the deals and on hidden-state twins of each deal
 * (same decision, same picked cards, same memory). A twin the seat can tell apart from its deal is
 * the harness's fault and throws.
 */
export function invariance(rc: RiskCase, candidate: Candidate, salts: readonly number[] = [1, 2, 3]): { invariant: boolean; differences: string[]; checks: number; nontrivial: number } {
  const differences: string[] = [];
  let checks = 0;
  let nontrivial = 0;
  const one = (m: PinnedMatch) => {
    const step = candidate(m, rc.seat, 0, firstMemory(rc.seat));
    return step.ok ? `${keyOf(step.answer, step.id)} memory ${stableJson(step.memory)}` : `refused ${step.reason}`;
  };
  const reference = one(rc.deals[0].case.match);
  for (const d of rc.deals) {
    const here = one(d.case.match);
    if (here !== reference) differences.push(`deal ${d.label} answers ${here.slice(0, 80)} where deal ${rc.deals[0].label} answers ${reference.slice(0, 80)}`);
    for (const salt of salts) {
      const twin = permutedFor(d.case.match, rc.seat, salt);
      if (shown(twin, rc.seat) !== shown(d.case.match, rc.seat)) throw new Error(`${rc.key}: the twin (salt ${salt}) of deal ${d.label} shows the seat something else`);
      checks++;
      if (stableJson(twin.state) !== stableJson(d.case.match.state)) nontrivial++;
      const there = one(twin);
      if (there !== here) differences.push(`deal ${d.label}, twin salt ${salt}: ${there.slice(0, 80)} vs ${here.slice(0, 80)}`);
    }
  }
  return { invariant: differences.length === 0, differences, checks, nontrivial };
}

/** Play the candidate in every deal (the kit's `judge`) and score it as the module header says. */
export function judgeRisk(rc: RiskCase, oracle: RiskOracle, name: string, candidate: Candidate, salts?: readonly number[]): RiskResult {
  const inv = invariance(rc, candidate, salts);
  const rows = rc.deals.map((d, i) => judge(d.case, oracle.perDeal[i], name, candidate));
  const total = rc.deals.reduce((n, d) => n + d.weight, 0);
  const objectiveShare = rc.deals.reduce((n, d, i) => n + (rows[i].objective ? d.weight : 0), 0) / total;
  const first = rows[0].first;
  const share = first !== null ? (oracle.share[first] ?? 0) : 0;
  const firstAcceptable = first !== null && oracle.riskAcceptable.has(first);
  const interrupted = rows.some((r) => r.outcome === "interrupted");
  return {
    benchmark: rc.benchmark, key: rc.key, variant: rc.variant, seat: rc.seat, candidate: name,
    outcome: interrupted ? "interrupted" : inv.invariant && firstAcceptable && objectiveShare >= rc.threshold - 1e-9 ? "pass" : "fail",
    firstAcceptable, objective: objectiveShare >= rc.threshold - 1e-9, guarded: rows.some((r) => r.guarded), first, acceptable: [...oracle.riskAcceptable], options: oracle.options.length,
    invariant: inv.invariant, differences: inv.differences, twinChecks: inv.checks, twinNontrivial: inv.nontrivial, share, objectiveShare, threshold: rc.threshold,
  };
}

/** Re-face the opponent's hidden cards: its hand (in order), and its deck — `bottom` copies of `card` at the bottom, `rest` above. */
function hidden(match: PinnedMatch, owner: PlayerId, hand: string[], card: string, bottom: number, rest: string): PinnedMatch {
  const state = JSON.parse(JSON.stringify(match.state)) as PinnedMatch["state"];
  const zones = state.sides[owner].zones as Record<string, string[]>;
  if (zones.hand.length !== hand.length) throw new Error(`hidden: ${owner} holds ${zones.hand.length} cards, not ${hand.length}`);
  zones.hand.forEach((id, i) => { state.cards[id].cardId = hand[i]; });
  zones.deck.forEach((id, i) => { state.cards[id].cardId = i >= zones.deck.length - bottom ? card : rest; });
  return { ...match, state };
}

/** Each of the opponent's two hidden hand cards is a 10,000 or a 5,000 combo card, even odds: four equally likely deals. */
const HANDS: { label: string; hand: string[] }[] = [
  { label: "F5,F5", hand: ["B11-F5", "B11-F5"] },
  { label: "C10,F5", hand: ["B11-C10", "B11-F5"] },
  { label: "F5,C10", hand: ["B11-F5", "B11-C10"] },
  { label: "C10,C10", hand: ["B11-C10", "B11-C10"] },
];

const RULE = "each of the opponent's two hidden cards is a 10,000 or a 5,000 combo card with even odds (it has shown a 10,000 combo; its list is about 40% of them); a first move must reach the objective in at least 3 of the 4 equally likely deals";

/** The position for `seat`, its deals, and the declared distribution (weights 1). */
function deals(base: PinnedMatch, seat: PlayerId, xAttacked: boolean, objective: BenchCase["objective"], keyBase: string, variant: BenchCase["variant"], note: string): Deal[] {
  const opp = other(seat);
  const staged = position(base, {
    [seat]: { hand: [], energy: [], energyMarkers: 0, battle: [{ cardId: "B11-X25", mode: xAttacked ? "rest" : "active" }, { cardId: "B11-BLK", mode: "active" }], life: 2, leader: "B11-L20", leaderMode: "rest" },
    [opp]: { hand: ["B11-F5", "B11-F5"], energy: [], energyMarkers: 0, battle: [{ cardId: "B11-A20", mode: "active" }], life: xAttacked ? 3 : 4, leader: "B11-L5", leaderMode: "rest", drop: ["B11-C10", ...(xAttacked ? ["B11-F5"] : [])], lifeCards: ["B11-F5", "B11-F5", "B11-F5", "B11-F5"] },
  });
  return HANDS.map(({ label, hand }) => ({
    label,
    weight: 1,
    case: {
      benchmark: "ai-11", key: `${keyBase}[${label}]`, variant, seat, note,
      match: hidden(staged, opp, hand, "B11-C10", AI11_C10_COPIES - 1 - hand.filter((c) => c === "B11-C10").length, "B11-F5"),
      objective, horizon: { kind: "turns", n: 2 }, opponent: localPolicy(), limits: { nodes: 4000 },
    },
  }));
}

/** Every order of two 10,000 and two 5,000 combo cards in a four-card Life area (index 0 first), each equally likely. */
const LIFE_ORDERS: string[][] = [
  ["B11-C10", "B11-C10", "B11-F5", "B11-F5"], ["B11-C10", "B11-F5", "B11-C10", "B11-F5"], ["B11-C10", "B11-F5", "B11-F5", "B11-C10"],
  ["B11-F5", "B11-C10", "B11-C10", "B11-F5"], ["B11-F5", "B11-C10", "B11-F5", "B11-C10"], ["B11-F5", "B11-F5", "B11-C10", "B11-C10"],
];

/** The Life-order position for `seat`: one deal per order of the opponent's Life, the rest of its list as in the other cases. */
function lifeOrderDeals(base: PinnedMatch, seat: PlayerId, key: string, note: string): Deal[] {
  const opp = other(seat);
  return LIFE_ORDERS.map((life) => {
    const staged = position(base, {
      [seat]: { hand: [], energy: [], energyMarkers: 0, battle: [{ cardId: "B11-P10", mode: "active" }, { cardId: "B11-Q20", mode: "active" }], life: 2, leader: "B11-L20", leaderMode: "rest" },
      [opp]: { hand: [], energy: [], energyMarkers: 0, battle: [], life: 4, leader: "B11-L5", leaderMode: "rest", drop: ["B11-C10"], lifeCards: life },
    });
    const label = life.map((c) => c.slice(4)).join(",");
    return {
      label,
      weight: 1,
      case: {
        benchmark: "ai-11", key: `${key}[${label}]`, variant: "adverse", seat, note,
        match: hidden(staged, opp, [], "B11-C10", AI11_C10_COPIES - 1 - 2, "B11-F5"),
        objective: (end, start) => lifeOf(end, opp) <= lifeOf(start, opp) - 2,
        horizon: { kind: "turn" }, opponent: localPolicy(), limits: { nodes: 4000 },
      },
    };
  });
}

export async function ai11RiskCases(bundle: Parameters<typeof opening>[0]): Promise<RiskCase[]> {
  const out: RiskCase[] = [];
  for (const seat of ["p1", "p2"] as PlayerId[]) {
    const base = await opening(bundle, seat);
    const opp = other(seat);
    {
      const key = `ai-11-risk-life-order-${seat}`;
      const note = "Leader already attacked; a 10,000 and a 20,000 attacker against a 5,000 Leader with an empty hand at 4 Life, whose hidden Life holds two 10,000 and two 5,000 combo cards in unknown order: hit with the 10,000 first, because the first hit hands over the top Life card and a 10,000 one (half the orders) stops the 10,000 attacker but never the 20,000.";
      out.push({ benchmark: "ai-11", key, variant: "adverse", note, seat, threshold: 0.75,
        rule: "the opponent's four Life cards are two 10,000 and two 5,000 combo cards (it has shown a 10,000 combo; its list is about 40% of them) in one of the six orders, equally likely; a first move must deal 2 damage this turn in at least 75% of them",
        deals: lifeOrderDeals(base, seat, key, note) });
    }
    {
      const key = `ai-11-risk-pressure-${seat}`;
      const note = "Leader already attacked; a 25,000 [Critical] attacker and a 25,000 [Critical] [Blocker] can each hit the 5,000 Leader through any combo, the opponent's active 20,000 [Critical] attacker swings next turn and its two hidden cards are 5,000 or 10,000 combos: hit with the attacker and keep the blocker home, because with a 10,000 combo in hand (3 of 4 deals) the rested blocker loses the game.";
      out.push({ benchmark: "ai-11", key, variant: "success", note, seat, threshold: 0.75, rule: `${RULE}; objective: deal damage this turn and be alive at the start of the next`,
        deals: deals(base, seat, false, (end, start) => winner(end) !== opp && lifeOf(end, opp) < lifeOf(start, opp), key, "success", note) });
    }
    {
      const key = `ai-11-risk-decline-${seat}`;
      const note = "Leader and the 25,000 attacker have already hit; only the 25,000 [Blocker] is left against the same hidden 5,000-or-10,000 combos: decline the extra hit and keep it home, since swinging it survives only the deal with no 10,000 combo (1 of 4).";
      out.push({ benchmark: "ai-11", key, variant: "decline", note, seat, threshold: 0.75, rule: `${RULE}; objective: be alive at the start of the next turn`,
        deals: deals(base, seat, true, (end) => winner(end) !== opp, key, "decline", note) });
    }
  }
  return out;
}
