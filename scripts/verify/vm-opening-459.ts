/**
 * Seed 7, fifty V1 / fifty V-BLUE cards, 6-2-1-4 through 6-2-1-12.
 *
 * These are the fixed instance orders observed and reviewed when both engines
 * agreed. The rule manual fixes the sequence: choose who starts, offer each
 * player a six-card mulligan, deal eight life from the deck, then begin turn 1.
 * The instance numbers make a shuffle regression visible without consulting
 * another engine during the test. Each player's three piles contain every main
 * deck instance 1..50 exactly once; the leader is instance 0.
 */
const ids = (player: "p1" | "p2", numbers: number[]): string[] => numbers.map((n) => `${player}#${n}`);

export const SEED_7_OPENING = {
  chooser: "p1",
  p1: {
    hand: ids("p1", [9, 23, 17, 50, 29, 26]),
    life: ids("p1", [1, 3, 39, 22, 47, 33, 40, 16]),
    deck: ids("p1", [43, 15, 35, 18, 38, 13, 12, 45, 2, 49, 36, 42, 28, 5, 6, 27, 37, 32, 10, 46, 41, 14, 8, 20, 30, 7, 44, 31, 24, 11, 21, 19, 25, 34, 48, 4]),
    leader: ["p1#0"],
  },
  p2: {
    hand: ids("p2", [10, 41, 19, 22, 5, 6]),
    life: ids("p2", [32, 16, 39, 35, 34, 3, 23, 8]),
    deck: ids("p2", [13, 44, 37, 30, 11, 46, 47, 12, 1, 20, 14, 26, 27, 50, 25, 29, 40, 38, 49, 4, 33, 24, 31, 21, 36, 43, 2, 45, 28, 9, 15, 42, 48, 7, 18, 17]),
    leader: ["p2#0"],
  },
} as const;

// A redraw is offered before life is dealt (6-2-1-9-1, 6-2-1-10).
export const SEED_7_P1_REDRAW = ids("p1", [45, 48, 2, 35, 37, 43]);
