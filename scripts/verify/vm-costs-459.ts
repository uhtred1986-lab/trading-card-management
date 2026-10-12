/**
 * Reviewed fixed price outcomes for #459. `paid` expands literal instance
 * numbers to `p1#N`; `refused` records exact requirement arrays. The five
 * rows are the staged Red/Red/Blue, Red/Blue/Green+marker, two Red markers,
 * dual/dual under a Blue Leader, and Red/Red/Red/Blue/Green+marker boards.
 * Columns are the nine printed prices in §17 of vm.ts: free; generic 1;
 * 2 including Red; 3 including Red and Blue; 2 including Blue twice;
 * 2 including one Red/Blue choice; 3 including Red plus Blue/Green;
 * generic 5; and 2 demanding three Red orbs. No row is computed from a
 * planner or the legacy engine at assertion time. Option order and chosen
 * payment are fixed too: 3-8-2 asks which active Energy cards to rest, and
 * an energy marker can cover one orb of its Leader's colour.
 */
import type { Color, Requirement } from "../../src/lib/arena/types";

type FixedPayment = { rest: string[]; markers: number; options: { rest: string[]; markers: number }[]; describe: string };
type FixedPrice = { paid: FixedPayment } | { refused: Requirement[] };
const ids = (rest: number[]): string[] => rest.map((n) => `p1#${n}`);
const paid = (rest: number[], markers: number, options: [number[], number][], describe: string): FixedPrice => ({
  paid: { rest: ids(rest), markers, options: options.map(([cards, count]) => ({ rest: ids(cards), markers: count })), describe },
});
const refused = (why: Requirement[]): FixedPrice => ({ refused: why });

export const FIXED_PRICES_459: FixedPrice[][] = [
  // Red, Red, Blue; no marker. One Blue cannot pay the double-Blue price.
  [
    paid([], 0, [[[], 0]], "nothing"), // 0
    paid([1], 0, [[[3], 0], [[1], 0]], "1 Red"), // 1
    paid([1, 2], 0, [[[3, 1], 0], [[1, 2], 0]], "2 Red"), // 2
    paid([1, 3, 2], 0, [[[3, 1, 2], 0]], "2 Red, 1 Blue"), // 3
    refused([{"kind": "energyColour", "colour": "Blue", "need": 2, "have": 1}]), // 4
    paid([1, 2], 0, [[[3, 1], 0], [[1, 2], 0]], "2 Red"), // 5
    paid([1, 3, 2], 0, [[[3, 1, 2], 0]], "2 Red, 1 Blue"), // 6
    refused([{"kind": "energy", "need": 5, "have": 3}]), // 7
    refused([{"kind": "energyColour", "colour": "Red", "need": 3, "have": 2}]), // 8
  ],
  // Red, Blue, Green; one Red marker. It adds one possible unit, not Blue.
  [
    paid([], 0, [[[], 0]], "nothing"), // 0
    paid([1], 0, [[[2], 0], [[3], 0], [[1], 0], [[], 1]], "1 Red"), // 1
    paid([1, 2], 0, [[[2, 1], 0], [[2], 1], [[3, 1], 0], [[3], 1], [[1], 1]], "1 Red, 1 Blue"), // 2
    paid([1, 2, 3], 0, [[[2, 3, 1], 0], [[2, 3], 1], [[2, 1], 1]], "1 Red, 1 Blue, 1 Green"), // 3
    refused([{"kind": "energyColour", "colour": "Blue", "need": 2, "have": 1}]), // 4
    paid([1, 2], 0, [[[2, 3], 0], [[2, 1], 0], [[2], 1], [[3, 1], 0], [[3], 1], [[1], 1]], "1 Red, 1 Blue"), // 5
    paid([1, 2, 3], 0, [[[2, 3, 1], 0], [[2, 3], 1], [[2, 1], 1], [[3, 1], 1]], "1 Red, 1 Blue, 1 Green"), // 6
    refused([{"kind": "energy", "need": 5, "have": 4}]), // 7
    refused([{"kind": "energyColour", "colour": "Red", "need": 3, "have": 2}]), // 8
  ],
  // No Energy cards; two Red markers. Blue and Blue/Green remain unavailable.
  [
    paid([], 0, [[[], 0]], "nothing"), // 0
    paid([], 1, [[[], 1]], "1 energy marker"), // 1
    paid([], 2, [[[], 2]], "2 energy markers"), // 2
    refused([{"kind": "energy", "need": 3, "have": 2}, {"kind": "energyColour", "colour": "Blue", "need": 1, "have": 0}]), // 3
    refused([{"kind": "energyColour", "colour": "Blue", "need": 2, "have": 0}]), // 4
    paid([], 2, [[[], 2]], "2 energy markers"), // 5
    refused([{"kind": "energy", "need": 3, "have": 2}, {"kind": "energyColour", "colour": "Blue/Green", "need": 1, "have": 0}]), // 6
    refused([{"kind": "energy", "need": 5, "have": 2}]), // 7
    refused([{"kind": "energyColour", "colour": "Red", "need": 3, "have": 2}]), // 8
  ],
  // Two Red/Blue energy cards under a Blue Leader; no marker.
  [
    paid([], 0, [[[], 0]], "nothing"), // 0
    paid([1], 0, [[[1], 0]], "1 Red/Blue"), // 1
    paid([1, 2], 0, [[[1, 2], 0]], "2 Red/Blue"), // 2
    refused([{"kind": "energy", "need": 3, "have": 2}]), // 3
    paid([1, 2], 0, [[[1, 2], 0]], "2 Red/Blue"), // 4
    paid([1, 2], 0, [[[1, 2], 0]], "2 Red/Blue"), // 5
    refused([{"kind": "energy", "need": 3, "have": 2}]), // 6
    refused([{"kind": "energy", "need": 5, "have": 2}]), // 7
    refused([{"kind": "energyColour", "colour": "Red", "need": 3, "have": 2}]), // 8
  ],
  // Red, Red, Red, Blue, Green; one Red marker. The final price is internally
  // impossible: three required Red orbs but only two total energy to charge.
  [
    paid([], 0, [[[], 0]], "nothing"), // 0
    paid([1], 0, [[[4], 0], [[5], 0], [[1], 0], [[], 1]], "1 Red"), // 1
    paid([1, 2], 0, [[[4, 1], 0], [[4], 1], [[5, 1], 0], [[5], 1], [[1, 2], 0], [[1], 1]], "2 Red"), // 2
    paid([1, 4, 2], 0, [[[4, 5, 1], 0], [[4, 5], 1], [[4, 1, 2], 0], [[4, 1], 1]], "2 Red, 1 Blue"), // 3
    refused([{"kind": "energyColour", "colour": "Blue", "need": 2, "have": 1}]), // 4
    paid([1, 2], 0, [[[4, 5], 0], [[4, 1], 0], [[4], 1], [[5, 1], 0], [[5], 1], [[1, 2], 0], [[1], 1]], "2 Red"), // 5
    paid([1, 4, 2], 0, [[[4, 5, 1], 0], [[4, 5], 1], [[4, 1, 2], 0], [[4, 1], 1], [[5, 1, 2], 0], [[5, 1], 1]], "2 Red, 1 Blue"), // 6
    paid([1, 2, 3, 4, 5], 0, [[[4, 5, 1, 2, 3], 0], [[4, 5, 1, 2], 1], [[4, 1, 2, 3], 1], [[5, 1, 2, 3], 1]], "3 Red, 1 Blue, 1 Green"), // 7
    refused([{"kind": "other", "detail": "the active energy cannot cover the colours of the cost"}]), // 8
  ],
];

/** Exact card-price classes from the 98 printed, non-Leader, non-token
 * harness cards at §17. Numeric energyCost is the total, X starts at zero,
 * the first printed colour is the one specified orb, and Colorless specifies
 * none. Thus E-DUAL specifies Red while COST2 specifies no orb. This table
 * freezes *which* cards have each price; vm.ts checks total and specified
 * colours separately for every card. */
export const FIXED_CARD_COSTS_459: { total: number; orbs: Partial<Record<Color, number>>; cards: string[] }[] = [
  { total: 0, orbs: {}, cards: ["U1", "UNI2", "XBAT"] },
  { total: 1, orbs: {"Blue": 1}, cards: ["V-BLUE", "THEIRS", "E-BLUE"] },
  { total: 1, orbs: {"Green": 1}, cards: ["E-GREEN"] },
  { total: 1, orbs: {"Red": 1}, cards: ["V1", "UNIQ", "E-NEGATE", "E-DRAW", "DRAWER", "KILLER", "PUMP", "SPAWN", "MYSTERY", "FLIPPER", "LIFEWATCH", "BLUEWATCH", "LIFEGIVER", "FORCEKILL", "AUTOCOST", "AURA", "ODDAURA", "DELAYKO", "DELAYDRAW", "DELAYOPP", "LOCKDOWN", "RESTLOCK", "NOCOPIES", "STACKER", "MILLGATE", "BUUHOST", "BUUEAT", "TWOKILL", "GRABBER", "ONCEONLY", "STEALER", "SAIYANKILL", "CHEAPENER", "ONLYONE", "RESTCOND", "E-STOP", "MODAL", "SEARCH", "ONCE", "LIMITED2", "PUMPCRIT", "INERTPERM", "WALL", "E-CC", "MUTEAUTO", "E-MYSTERY", "XDRAW", "XMARKERS", "XENERGY", "ATK-LEADER", "CHARGELOCK", "STANDALL", "ATK-BATTLE", "WATCHER", "CHARGER", "COMBOER", "E-RED", "E-DUAL"] },
  { total: 1, orbs: {"Yellow": 1}, cards: ["RECOLORED"] },
  { total: 2, orbs: {"Red": 1}, cards: ["BLOCKER", "BERGAMO", "INDESTRUCT", "REVENGE", "ZB", "ZCHEAP", "SWAPPER", "TOUGH", "PERMTOUGH", "PERMLOCK", "SELFMUTE", "BECOMES", "RECOLOR", "RENAMED", "FREEPLAY", "EXILE", "MAYWARP", "EARTHWARP", "WARPER", "REPLACER"] },
  { total: 2, orbs: {}, cards: ["COST2"] },
  { total: 3, orbs: {"Blue": 1}, cards: ["BLUECOMBO"] },
  { total: 3, orbs: {"Red": 1}, cards: ["CRIT", "DUAL", "EVO", "COST3", "CHEAP", "CHEAPCOMBO", "E-LIFE", "COMBOBACK"] },
  { total: 4, orbs: {"Red": 1}, cards: ["DOUBLE"] },
  { total: 5, orbs: {"Red": 1}, cards: ["BIG"] },
];
