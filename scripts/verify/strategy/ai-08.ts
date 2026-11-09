/**
 * AI-08 Removal and control targets (`docs/arena-strategy-validation.md`): accept removal targets that
 * change the specified survival/board objective, obeying protection and effect scope. A smaller
 * blocker can matter more than the highest-power card; decline when removal has no benefit.
 *
 * Every case starts at the removal's own question (the card is already played through the engine),
 * so the first answer the oracle judges is the target set itself, "Choose none" included.
 */
import type { PlayerId } from "../../../src/lib/arena/types";
import { applyMove, legalMoves } from "../../../src/lib/arena/browser";
import { localPolicy } from "../../../src/lib/arena/policy/combat";
import { opening, other, position, synthetic, winner, type BenchCase } from "./kit";

type Match = BenchCase["match"];

// Printed phrasings the compiler reads: SD5-03's "choose up to 1 of your opponent's Battle Cards and KO
// it" on BT6-025's [Activate: Main] Extra frame, and BT6-025's own scoped wording (its Leader condition
// left out); BT4-091's [Blocker]; BT4-077's [Barrier]; DB3-001's "deal 1 damage to your opponent".
const BLOCKER = "[Blocker] (When one of your other cards is attacked, you may switch this card to Rest Mode and change the target of the attack to this card)";
const BARRIER = "[Barrier] (This card can't be chosen by the skills of your opponent's cards)";

export const AI08_CARDS = [
  synthetic("B8-KO", 0, { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards and KO it." }),
  synthetic("B8-KO20", 0, { type: "EXTRA", energyCost: 1, power: null, comboCost: null, comboPower: null, skill: "[Activate: Main] Choose up to 1 of your opponent's Battle Cards with 20000 power or less and KO it." }),
  synthetic("B8-BLK", 5000, { energyCost: 1, skill: BLOCKER }),
  synthetic("B8-BAR", 5000, { energyCost: 1, skill: `${BLOCKER}<br>${BARRIER}` }),
  synthetic("B8-WALL", 25000, { energyCost: 4, skill: BLOCKER }),
  synthetic("B8-MID", 15000, { energyCost: 3 }),
  synthetic("B8-BIG", 25000, { energyCost: 4 }),
  synthetic("B8-TRAP", 10000, { energyCost: 2, skill: "[Auto] When this card is KO'd, deal 1 damage to your opponent." }),
  synthetic("B8-L25", 25000, { type: "LEADER", energyCost: null, comboCost: null, comboPower: null }),
];

/** Play `cardId` from `seat`'s hand through the engine, so the case starts at the question it asks (`ask`). */
export function playFromHand(match: Match, seat: PlayerId, cardId: string, ask: "chooseCards" | "chooseMode" = "chooseCards"): Match {
  const move = legalMoves(match).map((l) => l.action).find((a) => (a.type === "play" || a.type === "activate") && a.player === seat && "card" in a && match.state.cards[a.card as string]?.cardId === cardId);
  if (!move) throw new Error(`${seat} cannot play ${cardId} here`);
  const next = applyMove(match, move).match;
  if (next.state.prompt.kind !== ask || (next.state.prompt as { player?: PlayerId }).player !== seat) throw new Error(`playing ${cardId} did not ask ${seat} ${ask} (${next.state.prompt.kind})`);
  return next;
}

const alive = (seat: PlayerId) => (end: Match) => winner(end) !== other(seat);

export async function ai08Cases(bundle: Parameters<typeof opening>[0]): Promise<BenchCase[]> {
  const cases: BenchCase[] = [];
  for (const seat of ["p1", "p2"] as PlayerId[]) {
    const foe = other(seat);
    const base = await opening(bundle, seat);
    // 1. Aggro clears the blocker: the 5,000 [Blocker] is the target that wins, not the 25,000.
    cases.push({
      benchmark: "ai-08", key: `ai-08-blocker-lethal-${seat}`, variant: "success", seat,
      note: "Opponent at 1 Life with an active 5,000 [Blocker] and a rested 25,000 (it can neither block nor combo): KO the Blocker and the lone Leader attack is lethal; KOing the 25,000, or nothing, leaves the Blocker to stop it (blocking, or as a +5,000 combo).",
      match: playFromHand(position(base, {
        [seat]: { hand: ["B8-KO"], energy: ["B-F"], battle: [], leaderMode: "active" },
        [foe]: { hand: [], battle: [{ cardId: "B8-BLK", mode: "active" }, { cardId: "B8-BIG", mode: "rest" }], life: 1, leaderMode: "active" },
      }), seat, "B8-KO"),
      objective: (end) => winner(end) === seat,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
    // 2. Control removes the biggest threat: the same two cards, but the objective is surviving the next turn.
    cases.push({
      benchmark: "ai-08", key: `ai-08-threat-survive-${seat}`, variant: "success", seat,
      note: "At 1 Life behind a 25,000 Leader, facing a 5,000 [Blocker] and a 25,000 attacker: only KOing the 25,000 survives the opponent's turn; the Blocker cannot get through.",
      match: playFromHand(position(base, {
        [seat]: { hand: ["B8-KO"], energy: ["B-F"], battle: [], life: 1, leader: "B8-L25", leaderMode: "rest" },
        [foe]: { hand: [], battle: [{ cardId: "B8-BLK", mode: "active" }, { cardId: "B8-BIG", mode: "rest" }], life: 4, leaderMode: "rest" },
      }), seat, "B8-KO"),
      objective: alive(seat),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
    // 3. Protection: of two Blockers one has [Barrier]; the removal must take the one it may choose.
    cases.push({
      benchmark: "ai-08", key: `ai-08-protected-blocker-${seat}`, variant: "adverse", seat,
      note: "Opponent at 1 Life with two active 5,000 Blockers, one with [Barrier] (the removal cannot choose it), and a rested 25,000; two attackers: KO the unprotected Blocker and one attack gets through; KOing the 25,000, or nothing, leaves a Blocker for each attack.",
      match: playFromHand(position(base, {
        [seat]: { hand: ["B8-KO"], energy: ["B-F"], battle: [{ cardId: "B-F", mode: "active" }], leaderMode: "active" },
        [foe]: { hand: [], battle: [{ cardId: "B8-BAR", mode: "active" }, { cardId: "B8-BLK", mode: "active" }, { cardId: "B8-BIG", mode: "rest" }], life: 1, leaderMode: "active" },
      }), seat, "B8-KO"),
      objective: (end) => winner(end) === seat,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
    // 4. Effect scope: the removal reaches 20,000 or less, so the 25,000 Blocker is out of reach.
    cases.push({
      benchmark: "ai-08", key: `ai-08-scoped-blocker-${seat}`, variant: "adverse", seat,
      note: "Opponent at 1 Life with an active 25,000 [Blocker] (beyond a 20,000-or-less removal), an active 5,000 [Blocker] and a rested 15,000; two attackers: KO the 5,000 Blocker and one attack gets through; the 15,000, the biggest card in scope, is the wrong target.",
      match: playFromHand(position(base, {
        [seat]: { hand: ["B8-KO20"], energy: ["B-F"], battle: [{ cardId: "B-F", mode: "active" }], leaderMode: "active" },
        [foe]: { hand: [], battle: [{ cardId: "B8-WALL", mode: "active" }, { cardId: "B8-BLK", mode: "active" }, { cardId: "B8-MID", mode: "rest" }], life: 1, leaderMode: "active" },
      }), seat, "B8-KO20"),
      objective: (end) => winner(end) === seat,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
    // 5. Decline: the only target is harmless and punishes its removal.
    cases.push({
      benchmark: "ai-08", key: `ai-08-decline-trap-${seat}`, variant: "decline", seat,
      note: "At 1 Life behind a 25,000 Leader, the opponent's only Battle Card is a 10,000 that deals 1 damage when KO'd: it cannot get through, so removal gains nothing and loses the game; choose none.",
      match: playFromHand(position(base, {
        [seat]: { hand: ["B8-KO"], energy: ["B-F"], battle: [], life: 1, leader: "B8-L25", leaderMode: "rest" },
        [foe]: { hand: [], battle: [{ cardId: "B8-TRAP", mode: "rest" }], life: 4, leaderMode: "rest" },
      }), seat, "B8-KO"),
      objective: alive(seat),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
  }
  return cases;
}
