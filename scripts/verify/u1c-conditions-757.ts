/**
 * #757 U1-c, rows "Conditional (if ...)" and "Conditions: Leader match, life, counts, did/chose, battle, turn" of the
 * #649 deck audit: each printed condition is played on both sides (holds / does not hold) on the rules engine, with the
 * cards' own wording (see `u1c-757-lib.ts`). The last block is the coverage proof: every deck skill the audit counts
 * in the four U1-c rows is either registered as played by these suites or named with the issue that owns the gap.
 */
import assert from "node:assert/strict";
import moves from "./u1c-moves-757";
import { played } from "./u1c-757-lib";

/** Skills a played scenario would have to assert something the engine does not do yet: the issue that owns each. */
export const OPEN_GAPS: Record<string, number> = {};

const ROWS = ["op-effects", "op-moves", "op-if", "cond"];

async function main(): Promise<void> {
  await moves;

  // ── coverage: every face the four rows count was played ──
  // The audit script is an ES module with top-level await: loaded dynamically, it does nothing unless run as a script.
  const { auditDecks, familyOf, loadSnapshot } = await import("../arena-deck-audit.mts");
  const audits = auditDecks(loadSnapshot().cards as never);
  const counted = new Map<string, Set<string>>();
  for (const a of audits) {
    for (const s of a.skills) {
      const key = `${s.cardId}${s.face === "back" ? "b" : ""}#${s.index}`;
      for (const m of s.mechanics) {
        const fam = familyOf(m);
        if (fam && ROWS.includes(fam.key)) (counted.get(fam.key) ?? counted.set(fam.key, new Set()).get(fam.key)!).add(key);
      }
    }
  }
  const missing = [...new Set([...counted.values()].flatMap((set) => [...set]))].filter((k) => !played.has(k) && !(k in OPEN_GAPS)).sort();
  assert.deepEqual(missing, [], `skills counted by the U1-c rows but not played: ${missing.join(", ")}`);
  console.log(`  #757 U1-c coverage: ${ROWS.map((r) => `${r} ${counted.get(r)?.size}`).join(", ")} skills, all played or owned`);
}

export default main();
