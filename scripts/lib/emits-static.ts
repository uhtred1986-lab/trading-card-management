/**
 * Does a [Permanent] program put a standing change in force the static layer applies?
 *
 * The audit scripts (`arena:coverage`, `arena:gaps`, `arena:deck-audit`) use this so their
 * "applied by the static layer" line means what it says: a [Permanent] whose ops are all
 * outside `STATIC_OPS` compiles and reads cleanly but changes nothing, which no compile figure
 * can show. It was the legacy engine's `emitsStatic`; the list is now the rules engine's
 * (`vm/effects.ts`'s `STATIC_OPS`), with the spellings folded the way the compiler reads them.
 */
import { STATIC_OPS } from "../../src/lib/arena/vm/effects";
import { costModifierAs, modifyAttrAs, negateAs, replaceAs, type Op } from "../../src/lib/arena/vm/script";

const APPLIED = new Set<string>(STATIC_OPS.filter((op) => op !== "if"));

export function emitsStatic(ops: Op[]): boolean {
  return ops.some((o) => (o.op === "if" ? emitsStatic(o.then) || emitsStatic(o.else ?? []) : APPLIED.has(replaceAs(costModifierAs(negateAs(modifyAttrAs(o)))).op)));
}
