# Support checkpoint 42 — Launch combos and alternate Awaken

Combined runtime `bec64f97` in draft PR #1249 integrates Launch `ae6494ea` and BT17-002's alternative Awaken. Work continues toward complete card support; this is a bounded checkpoint.

## Rules and saved choices

R473 turns BT31-055's standing Drop permission into ordinary declared combos with its mono-yellow Earthling / exactly 5000 combo-power filter and normal combo cost. It preserves Drop origin, R055 departure replacement and printed self-negation. Native hand/Battle/Drop payment choices bind original source and payer occurrences; Drop also retains every original qualifying permission source and accepts any surviving grant. Legacy in-flight combo payment menus without provenance require rebuilding. See [Launch's receipt](launch-drop-combo.md).

R474 preserves BT17-002's free life condition OR an exact three-card payment from one Super Sigma pile. Both legal alternatives remain selectable. Host selection identifies actual board cards; the host is observed rather than targeted. Original source/host/pile/offered/selected occurrences and complete payment precede usage, activation and effects. Paid effect continuations cannot flip a fresh Leader occurrence. The complete draw, optional ready, life-to-six and flip sequence is preserved. See [alternate Awaken's receipt](alternative-awaken.md).

Both stale-record guards apply across review statuses; confirmed rules are refused rather than rewritten. The combined registry contains 321 unique suites, and both source guards, rulings and language changes are retained.

## Complete record comparison

All 6,597 recovered public cards and 13,964 records were regenerated. Totals remain **12,999 readable / 965 unread**. Readable records with known runtime gaps fall from 14 to **12**; additional blocked records fall to **322**, with **2,559 contextual unknowns**. These metrics are not a fully verified card count.

Only two complete records change from checkpoint 41:

| Record | Changed fields |
| --- | --- |
| BT31-055#20b | ops, pattern, reads |
| BT17-002#10 | cost |

Every printed field and every unrelated complete record is identical. Snapshot SHA-256: `94c81ffe7c02bccfd1a0aa9fa714b852807473ba2e006900625cc794f1096aea`. Local evidence: `/workspace/shared/arena-support5/recovery/fortysecond-full.json`, `fortysecond-record-diff.json` and `fortysecond-runtime.json`.

## Combined validation

**775 counted cases pass**: Launch94 + stored/DSL8, alternative Awaken78, Awaken Drop33, Awaken conditions146, named gates102, Surge110, Field84, combo replacement84 and typed combo36. Additional uncounted compatibility suites pass: original Awaken draw, hand combo, Battle/Drop combo origins, the full standalone VM suite and wording suite.

Typecheck and integration-file lint pass. Direct language fixtures match the combined source; lang/Teach, 249 rulings, 42 capability scenarios / 135 VM sites and attack previews pass. Browser checks cover 181 portable modules and a 121-step replay, including privacy, input immutability and deterministic replay. Fusion fuzz completes **40/40**, with zero crashes, interruptions or action limits. Parent execution sessions are closed. Full gate/build remains reserved for complete integration under the batch process.

Legacy fixes `9a8e1320` corrected existing negation attribution and R399 Z-Energy-order expectations and made the Ultimate fixture self-contained. No assertion was weakened; the formerly red VM/wording suites now pass on this combined head.

## Continuing work

R475 develops resolved-grant deletion as a prerequisite for standing whole-skill negation; helper tests alone do not constitute runtime card support. R476 addresses the six optional Energy-Exhaust preplacement procedures. The owner question about using the incoming Drop card itself as a payer is pending; independent routes continue. The earlier Cell Games invoked Battle-card cost waiver question also remains pending. General movement lifetime, broader per-arrival Counter procedures, unread clauses and attribute completeness remain in scope.

No database refresh/write, migration, dependency change, deployment or merge occurred.
