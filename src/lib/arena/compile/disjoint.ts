/**
 * #970: "send 1 <Pilaf> card, 1 <Mai> card, and 1 <Shu> card from your Drop Area
 * to your Warp" (BT10-025/026), the Xeno sends (BT12-138/139), Android 14/15
 * and Gotenks' "send 1 blue card with <Son Goten> in its character name and 1
 * blue card with <Trunks> in its character name from your hand and/or Drop to
 * your Warp" (P-441): one counted description per slot, all from one source to
 * one place.
 *
 * Each slot is a `choose` of its own, and it must be a card of its own: a
 * catalog card may carry several of the names (BT18-077 is Pilaf, Shu and Mai at
 * once), so a plain run of choices could pay two slots with one card. Every slot
 * after the first lists the variables before it in `notIn`, and the moves run
 * once all the slots are chosen. The VM prices such a set as a matching and
 * offers each slot only cards that leave the others payable (`vm/disjoint.ts`).
 *
 * Read only in this exact shape. A slot that is not "N <description>", an "up
 * to", a description carrying its own asides, a missing source or a second
 * place is refused whole, as before.
 */
import type { Op, Selector } from "../vm/script";
import { disjointWords } from "./disjoint-shape";
import type { Ctx } from "./shared";
import { parseTarget } from "./targets";

export interface DisjointMove {
  verb: "send" | "place";
  to: "warp" | "drop";
  source: string;
  slots: { count: number; selector: Selector; text: string }[];
}

/** The clause read slot by slot, or `null` when it is not this shape or a slot does not read. */
export function parseDisjointMove(clause: string): DisjointMove | null {
  const words = disjointWords(clause);
  if (!words) return null;
  const slots: DisjointMove["slots"] = [];
  for (const text of words.slots) {
    const selector = parseTarget(`${text} from ${words.source}`);
    if (!selector || selector.special || selector.fromVar || selector.upTo || selector.take != null || selector.filter?.unreadable) return null;
    const count = Number(/^\d+/.exec(text)![0]);
    if (selector.count !== count || (!selector.area && !selector.areas?.length)) return null;
    slots.push({ count, selector, text });
  }
  const first = slots[0].selector;
  const same = (a: Selector) => a.side === first.side && JSON.stringify(a.areas ?? a.area) === JSON.stringify(first.areas ?? first.area);
  if (!slots.every((x) => same(x.selector))) return null;
  return { verb: words.verb, to: words.verb === "send" ? "warp" : "drop", source: words.source, slots };
}

/**
 * The ops of one such clause, or `undefined` when the clause is not this shape
 * at all (the caller goes on), or `null` when it is but cannot be read.
 */
export function compileDisjointMove(clause: string, c: Ctx): Op[] | null | undefined {
  const words = disjointWords(clause);
  if (!words) return undefined;
  const move = parseDisjointMove(clause);
  if (!move) return null;
  const vars = move.slots.map(() => `c${c.n++}`);
  const chooses: Op[] = move.slots.map((slot, i) => ({
    op: "choose",
    sel: { ...slot.selector, ...(i ? { notIn: vars.slice(0, i) } : {}) },
    as: vars[i],
    reason: `${move.verb} ${slot.text} from ${move.source} ${move.to === "warp" ? "to your Warp" : "in your Drop Area"}`,
  }));
  const moves: Op[] = vars.map((v) => ({ op: "moveTo", target: { var: v }, to: move.to, ...(move.to === "drop" ? { reveal: true } : {}) }));
  return [...chooses, ...moves];
}
