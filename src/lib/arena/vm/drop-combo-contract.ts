/** R473 persisted-record guard. Printed text only detects obsolete semantics. */
import { emptyFilter } from "../text/filters";
import { canonicalTaxValue } from "./tax-receipt";

export function dropComboRecordGap(row: { kind?: unknown; printed?: unknown; ops?: unknown; cond?: unknown }): string | null {
  if (row.kind !== "permanent" || typeof row.printed !== "string" ||
    !/^\[permanent\] you can use mono-yellow ≪earthling≫ cards with 5000 combo power from your drop(?: area)? in combos\.$/.test(row.printed.toLowerCase().replace(/\s+/g, " ").trim())) return null;
  const expected = [{ op: "permit", what: "comboFromDrop", until: "game", target: { sel: { special: "self" } },
    filter: { ...emptyFilter(), colors: ["Yellow"], monoColor: true, traits: ["earthling"], type: "BATTLE", comboPowerMin: 5000, comboPowerMax: 5000 } }];
  return row.cond != null || canonicalTaxValue(row.ops) !== canonicalTaxValue(expected) ? "rebuild the standing Drop combo permission (R473)" : null;
}
