# Legacy count and Energy-entry regression assertions

The frozen combined contract run reported two stale tests in `leader-or-is-price-907` and `census-effects-907`. This repair changes only those tests and this receipt. No compiler, VM, glossary, ruling or card admission changes.

## Complete Leader conjunction

The original synthetic line remains unchanged:

> [Activate: Main]{1}, if your Leader is green and has <GT> in its character name and 3 or more blue and/or yellow cards are in your Combo Area and/or Drop: Play this card from your hand.

The former assertion expected an unread count. The existing reader now preserves all three conjuncts: Green Leader, character name including GT, and at least three Blue-or-Yellow cards across the union of the controller's Combo and Drop Areas. The positive assertion deep-compares the full condition and complete conditional Hand self-choice/play body. A stored `skillRecords` row independently preserves that full condition and the complete price with one generic energy, no action payment and no extra price qualifiers. Existing unread send-clause negatives and the Leader-disjunction precedence checks are unchanged.

This follows the earlier full-clause protections documented in `scripts/verify/price-condition-clauses.ts` and the combined-area reader already exercised in the same Leader suite. It does not claim a new printed card or native action scenario; the source is explicitly the existing complete synthetic line.

## DB2-166 pre-entry descriptor

The census test dereferenced `offer.ops` after searching for an obsolete generic `may` node. R507 replaced that representation with `energyEntryExhaust` for the exact optional Energy-entry Permanent. The prior reviewed receipt is [energy-admission.md](energy-admission.md); its complete six-card source fixture is `scripts/verify/fixtures/energy-admission-5.json`.

The repaired census check loads the complete original DB2-166 card, selects its original Permanent at index 10, and verifies its full printed line, empty price, empty trigger list, and exact Red/Green `energyEntryExhaust` operation. There is no generic optional skill activation or continuous Exhaust-negation operation. The other printed skills remain in the loaded card; none is rewritten or newly claimed.

The separate existing synthetic played-Auto tests still exercise disjoint Red/Green Drop selections and the follow-up draw: a valid pair, a missing Green card, one multicolor card unable to fill both slots, and a multicolor-plus-Green pair. All remain unchanged and pass. Actual DB2-166 native procedure proof remains in the previously reviewed R507 suites, not duplicated by this legacy representation check.

## Verification

- `npx tsx scripts/verify/leader-or-is-price-907.ts`: passes.
- `npx tsx scripts/verify/census-effects-907.ts`: passes, including all retained gameplay blocks.
- `npx tsc --noEmit`, touched-file ESLint and whitespace diff check pass.

No engine bug was exposed by these two failures. No database, full scan, full gate, build, dependency installation or push was performed. Parent owns combined contract rerun and integration.
