/**
 * #970: disjoint choices. "{r}{r}{r}, send 1 <Pilaf> card, 1 <Mai> card, and 1
 * <Shu> card from your Drop Area to your Warp" (BT10-025) is three choices that
 * must be three different cards, and a catalog card may carry several of the
 * names. The compiler writes each slot as a `choose` whose selector lists the
 * variables of the slots before it in `notIn`; `resolveSelector` then drops the
 * cards already bound. Two things that alone cannot do, and this file does:
 *
 *  - **Payability is a matching, not a greedy pick.** One card carrying Pilaf
 *    and Shu cannot pay both slots, and three single-name cards can; but a
 *    greedy walk that gives the multi-name card to the first slot it fits can
 *    leave the second with nothing although another assignment exists. A price
 *    is offered only when `disjointAssignment` finds one.
 *  - **A slot offers only cards that leave the rest payable**, so a player (or
 *    the AI, which picks among the candidates it is handed) can never choose
 *    their way into a dead end after the price has been offered.
 *
 * Pure: it knows the shape of a program and is handed a way to resolve a
 * selector, never a game.
 */
import type { Op } from "./script";

type Choose = Extract<Op, { op: "choose" }>;

/** The slot count a card pool is matched for: an exact count, as a choice states it. */
const needOf = (op: Choose): number => (typeof op.sel.count === "number" ? op.sel.count : 1);

/**
 * Can every slot be given cards of its own? `slots[i].need` cards out of
 * `slots[i].cands`, no card in two slots. A bipartite matching over the slots'
 * unit places (augmenting paths), exact where a greedy walk is not.
 */
export function disjointAssignment(slots: { cands: readonly string[]; need: number }[]): boolean {
  const places: (readonly string[])[] = [];
  for (const s of slots) for (let i = 0; i < s.need; i++) places.push(s.cands);
  const owner = new Map<string, number>();
  const place = (p: number, seen: Set<string>): boolean => {
    for (const id of places[p]) {
      if (seen.has(id)) continue;
      seen.add(id);
      const held = owner.get(id);
      if (held === undefined || place(held, seen)) {
        owner.set(id, p);
        return true;
      }
    }
    return false;
  };
  for (let p = 0; p < places.length; p++) if (!place(p, new Set())) return false;
  return true;
}

/**
 * The `choose` steps of a program that must pick different cards: the
 * connected sets of choices tied by `notIn`. Each set is a list of indices
 * into `ops`, in program order; a choice with no link to another is in none.
 */
export function disjointGroups(ops: readonly Op[]): number[][] {
  const parent = new Map<number, number>();
  const find = (i: number): number => {
    let r = i;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const link = (a: number, b: number) => {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  };
  ops.forEach((op, j) => {
    if (op.op !== "choose" || !op.sel.notIn?.length) return;
    for (const v of op.sel.notIn) {
      for (let k = j - 1; k >= 0; k--) {
        const before = ops[k];
        if (before.op === "choose" && before.as === v) {
          link(j, k);
          break;
        }
      }
    }
  });
  const sets = new Map<number, number[]>();
  for (const i of [...parent.keys()].sort((a, b) => a - b)) {
    const r = find(i);
    sets.set(r, [...(sets.get(r) ?? []), i]);
  }
  return [...sets.values()];
}

/** Whether a slot of a disjoint set is one this file can match: an exact count, no set-level bound on the choice. */
export function plainSlot(op: Choose): boolean {
  return !op.sel.upTo && op.atMost === undefined && op.sumTo === undefined && op.namedSet === undefined && !op.sel.differentNames && !op.sel.sumAtMost && op.sel.minCount === undefined && !op.sel.take && !op.sel.special && !op.sel.fromVar && typeof op.sel.count !== "object";
}

/**
 * Before the price is offered: does a disjoint assignment exist for every set
 * of linked choices in these ops? `candidates` resolves a slot's selector on
 * the board as it stands, `notIn` unread (nothing is bound yet).
 */
export function disjointPayable(ops: readonly Op[], candidates: (op: Choose) => string[]): boolean {
  for (const group of disjointGroups(ops)) {
    const slots = group.map((i) => ops[i] as Choose);
    if (!slots.every(plainSlot)) return false;
    if (!disjointAssignment(slots.map((op) => ({ cands: candidates(op), need: needOf(op) })))) return false;
  }
  return true;
}

/**
 * While a slot is being chosen: which of its candidates leave the later slots
 * of its set a card each? `later` is the slots after it (those already chosen
 * are bound and have made their cards unavailable through `notIn`); `rest`
 * resolves a later slot's candidates once the pick under test is bound as the
 * current slot's variable. A pick that still leaves `need - picked - 1` of its
 * own slot and every later slot satisfiable is kept.
 */
export function completablePicks(
  cands: readonly string[],
  stillNeeded: number,
  later: Choose[],
  resolveLater: (op: Choose, hypothetical: string) => string[],
): string[] {
  if (!later.length) return [...cands];
  if (!later.every(plainSlot)) return [...cands];
  return cands.filter((id) => {
    const slots = later.map((op) => ({ cands: resolveLater(op, id), need: needOf(op) }));
    // The rest of this slot's own count still needs cards other than this pick.
    if (stillNeeded > 0) slots.push({ cands: cands.filter((o) => o !== id), need: stillNeeded });
    return disjointAssignment(slots);
  });
}

/** The slots after `at` that are in the same disjoint set as `ops[at]`, or none. */
export function laterSlots(ops: readonly Op[], at: number): Choose[] {
  const group = disjointGroups(ops).find((g) => g.includes(at));
  return group ? group.filter((i) => i > at).map((i) => ops[i] as Choose) : [];
}

