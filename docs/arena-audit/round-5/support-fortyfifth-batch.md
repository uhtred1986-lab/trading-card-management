# Support checkpoint 45 — adjacent skill boundaries and bounded observation

Combined source `a229f349` in draft PR #1249 includes R479 (`bc41b72d`) and R477's bounded native-state observer. [R479 evidence](adjacent-skill-boundaries.md) restores separately printed skills when the catalog omits whitespace between a period and a skill tag. Raw Toppo text has the same defect but was already corrected by its existing erratum. Whis's extra-turn Auto remains separately unsupported.

R477 observes exact stored unconditional negator/protection programs and validates complete pre-mutation Battle occurrence snapshots. Identical existing cards cannot masquerade as arrivals; new epochs remain distinct. Malformed transactions, stale history and unreviewed protection transitions refuse. The observer and history helpers still have no gameplay writer and admit no standing-negation cards. [Prototype receipt](standing-negation-history-prototype.md) identifies the remaining mutation boundaries.

## Full record comparison

The same 6,597 cards now produce **13,966 records: 13,002 readable / 964 unread**. Exactly four record keys differ: BT1-043#10 and BT18-043#10 are separated from their next skills, and #20 is newly present on each card. Every unrelated complete record is identical. Whis #20 retains both extra-turn unread clauses; Mijorin retains its separate Auto and Activate costs/effects. These reading counts are not fully verified card counts.

Runtime census: **12 readable runtime gaps**, **321 additional blocked records**, **2,559 contextual unknowns**. Full snapshot SHA-256: `2a02eccbf862a1261cd8ba9bb9ded5930e53cb8d03820ffa64ca6433d7034b2e`. The snapshot was generated on R479; the subsequent observer commits do not change compiler output. Evidence: `/workspace/shared/arena-support5/recovery/fortyfifth-{full,record-diff,runtime}.json`.

## Validation

**151 counted cases** pass: boundary parsing/stale-record 29, observer 40, generation-history 32, and resolved-grant native 50. Full compiler and wording suites, language, 253 rulings, capability inventory (42 scenarios / 144 VM sites), typecheck and changed-file lint pass. Browser validation remains 182 portable modules / 121 replay steps with privacy, immutability and replay checks. Fusion fuzz on the parser runtime completes 40/40, with zero crashes, interruptions or action limits; the subsequent observer remains unwired and the extracted external-negation predicate is behavior-equivalent.

Energy final-mode settlement and optional payment continuations continue. Standing-negation mutation transactions, remaining unread clauses and all remaining card support remain in scope. No database write/refresh, migration, dependency change, deployment or merge occurred. Full gate/build remains reserved for complete integration.
