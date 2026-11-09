/**
 * AI-07 Fusion and evolution material planning (`docs/arena-strategy-validation.md`): accept lines
 * preserving or developing the exact eligible base or materials for the specified next Evolve or
 * Union-Fusion play, unless immediate survival or proven lethal dominates.
 *
 * The keyword cards mirror printed forms the compiler reads completely: "[Evolve]{r}{r}: <Pan>" (the
 * line `scripts/verify/wordings.ts` pins with a Blocker tag) and "[Union-Fusion]{r}{r}: <Pan> and
 * <Goten>." (the printed "[Union-Fusion]{r}: <Son Goku: Br> and <Vegeta: Br>." shape). Each costs more
 * to play from the hand than through its keyword and is one energy short this turn, so the plan is next
 * turn's play: the objective is read where the opponent's turn ends (the candidate's next turn
 * begins), with the base still in the Battle Area or the materials still in hand. The engine offers
 * the Union-Fusion only for a <Pan> and a <Goten> of one power in the hand (22-13), which is what
 * makes one of two <Pan> cards the exact material.
 */
import type { PlayerId } from "../../../src/lib/arena/types";
import { localPolicy } from "../../../src/lib/arena/policy/combat";
import { count, lifeOf, opening, other, position, synthetic, winner, type BenchCase } from "./kit";

/** The Evolve cases' base: a 10,000 <Pan> Battle Card (the one <Pan> on their boards and hands). */
const PAN = synthetic("B7-PAN", 10000, { characters: ["Pan"] });
/** Not a base: a stronger <Goten> Battle Card for the same cost. */
const GOTEN = synthetic("B7-GOTEN", 15000, { characters: ["Goten"] });
/**
 * Keep-base's attacker that is not the base: a 25,000 <Goten>, which the opponent's 20,000 cannot KO even
 * rested, so attacking with it is free and the case asks only the AI-07 question (which card keeps the
 * base). With the 15,000 <Goten> the attack was also a trade (one damage for a card the 20,000 KOs), and
 * ending the turn was a defensible answer the objective refused.
 */
const BIGGOTEN = synthetic("B7-GOTEN25", 25000, { characters: ["Goten"] });
/** The Evolve card: 4 energy to play from the hand, {r}{r} to evolve onto a <Pan>. */
const SSPAN = synthetic("B7-SSPAN", 25000, { energyCost: 4, characters: ["Pan"], skill: "[Evolve]{r}{r}: <Pan>" });
/** A 15,000 <Pan>: with the 15,000 <Goten> the one equal-power pair the Union-Fusion takes (the 10,000 <Pan> is not). */
const FPAN = synthetic("B7-FPAN", 15000, { characters: ["Pan"] });
/** The Union-Fusion card: {r}{r}, dropping a <Pan> and a <Goten> of one power from the hand. */
const FUSE = synthetic("B7-FUSE", 35000, { energyCost: 5, characters: ["Pan"], skill: "[Union-Fusion]{r}{r}: <Pan> and <Goten>." });
/** The opponent's 20,000 Battle Card. */
const BRUTE = synthetic("B7-BRUTE", 20000);

export const AI07_CARDS = [PAN, GOTEN, BIGGOTEN, SSPAN, FPAN, FUSE, BRUTE];

type M = Parameters<BenchCase["objective"]>[0];
/** Cards with <Pan> in their character name: what "[Evolve]{r}{r}: <Pan>" may evolve onto. */
const PANS = new Set(AI07_CARDS.filter((c) => c.characters.includes("Pan")).map((c) => c.id));
/** Next turn's Evolve is still possible: a <Pan> base in the Battle Area and the Evolve card in hand. */
const evolveReady = (m: M, seat: PlayerId) =>
  m.state.sides[seat].zones.battle.some((id) => PANS.has(m.state.cards[id].cardId)) && count(m, seat, "hand", SSPAN.id) >= 1;

export async function ai07Cases(bundle: Parameters<typeof opening>[0]): Promise<BenchCase[]> {
  const cases: BenchCase[] = [];
  for (const seat of ["p1", "p2"] as PlayerId[]) {
    const base = await opening(bundle, seat);
    // 1. Keep the base home: pressure with the Battle Card that is not the base.
    cases.push({
      benchmark: "ai-07", key: `ai-07-keep-base-${seat}`, variant: "success", seat,
      note: "1 energy (the {r}{r} Evolve waits a turn), a 10,000 <Pan> base and a 25,000 <Goten> on board, the opponent with an active 20,000 Battle Card: attack with the <Goten> (safe even rested) and keep the <Pan> active, since a rested <Pan> is KO'd and the evolution is lost.",
      match: position(base, {
        [seat]: { hand: [SSPAN.id], energy: ["B-F"], energyMarkers: 0, battle: [{ cardId: PAN.id, mode: "active" }, { cardId: BIGGOTEN.id, mode: "active" }], life: 4, leaderMode: "rest" },
        // Active, so it cannot be attacked this turn (only rested cards can): with the 25,000 <Goten> a rested 20,000 is a KO target, a different question.
        [other(seat)]: { hand: [], energy: [], energyMarkers: 0, battle: [{ cardId: BRUTE.id, mode: "active" }], life: 4, leaderMode: "rest" },
      }),
      objective: (end, start) => evolveReady(end, seat) && lifeOf(end, other(seat)) < lifeOf(start, other(seat)),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
      limits: { nodes: 8000 },
    });
  }
  {
    const seat: PlayerId = "p1";
    const base = await opening(bundle, seat);
    // 2. Develop the base: play the <Pan>, not the stronger <Goten>, with the one energy.
    cases.push({
      benchmark: "ai-07", key: "ai-07-develop-base-p1", variant: "success", seat,
      note: "1 energy, a hand of <Pan>, a stronger <Goten> and the Evolve card, empty board: play the <Pan> (the only base) and keep it active, not the bigger body.",
      match: position(base, {
        [seat]: { hand: [PAN.id, GOTEN.id, SSPAN.id], energy: ["B-F"], energyMarkers: 0, battle: [], life: 4, leaderMode: "rest" },
        [other(seat)]: { hand: [], energy: [], energyMarkers: 0, battle: [{ cardId: BRUTE.id, mode: "rest" }], life: 4, leaderMode: "rest" },
      }),
      objective: (end) => evolveReady(end, seat),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
      limits: { nodes: 10000 },
    });
  }
  {
    const seat: PlayerId = "p1";
    const base = await opening(bundle, seat);
    // 3. Survival dominates: at 1 Life the base and the Evolve card are the two combos that stop two attacks.
    cases.push({
      benchmark: "ai-07", key: "ai-07-survive-over-base-p1", variant: "adverse", seat,
      note: "1 Life, the Evolve affordable now (2 energy) and two 10,000 attacks coming: do not evolve and do not attack, since the active <Pan> and the Evolve card in hand are two combos and the evolved card is only one.",
      match: position(base, {
        [seat]: { hand: [SSPAN.id], energy: ["B-F", "B-F"], energyMarkers: 0, battle: [{ cardId: PAN.id, mode: "active" }], life: 1, leaderMode: "rest" },
        [other(seat)]: { hand: [], energy: [], energyMarkers: 0, battle: [{ cardId: "B-F", mode: "active" }], life: 4, leaderMode: "rest" },
      }),
      objective: (end) => winner(end) === null && lifeOf(end, seat) >= 1,
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
    });
  }
  {
    const seat: PlayerId = "p1";
    const base = await opening(bundle, seat);
    // 4. Proven lethal dominates: the base is the one attacker left and the opponent is at 1 Life.
    cases.push({
      benchmark: "ai-07", key: "ai-07-lethal-over-base-p1", variant: "adverse", seat,
      note: "The opponent at 1 Life with no defense, the <Pan> base the only active attacker and the Evolve card waiting for next turn: attack with the <Pan> and win now.",
      match: position(base, {
        [seat]: { hand: [SSPAN.id], energy: ["B-F"], energyMarkers: 0, battle: [{ cardId: PAN.id, mode: "active" }, { cardId: GOTEN.id, mode: "rest" }], life: 4, leaderMode: "rest" },
        [other(seat)]: { hand: [], energy: [], energyMarkers: 0, battle: [], life: 1, leaderMode: "rest" },
      }),
      objective: (end) => winner(end) === seat,
      horizon: { kind: "turn" },
      opponent: localPolicy(),
    });
  }
  {
    const seat: PlayerId = "p1";
    const base = await opening(bundle, seat);
    // 5. Union-Fusion: keep the exact equal-power pair in hand; the same-name <Pan> of another power is free to play.
    cases.push({
      benchmark: "ai-07", key: "ai-07-fusion-materials-p1", variant: "success", seat,
      note: "1 energy (the {r}{r} Union-Fusion waits a turn), a hand of a 10,000 <Pan>, a 15,000 <Pan>, a 15,000 <Goten> and the Fusion card: keep the equal-power 15,000 pair in hand through the opponent's turn (play the 10,000 <Pan> or nothing).",
      match: position(base, {
        [seat]: { hand: [PAN.id, FPAN.id, GOTEN.id, FUSE.id], energy: ["B-F"], energyMarkers: 0, battle: [], life: 4, leaderMode: "rest" },
        [other(seat)]: { hand: [], energy: [], energyMarkers: 0, battle: [], life: 4, leaderMode: "rest" },
      }),
      objective: (end) => [FPAN.id, GOTEN.id, FUSE.id].every((id) => count(end, seat, "hand", id) >= 1),
      horizon: { kind: "turns", n: 2 },
      opponent: localPolicy(),
      limits: { nodes: 20000 },
    });
  }
  return cases;
}
