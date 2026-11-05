# Checkpoint 41: Field activation and per-arrival Counter decisions

Combined runtime `8656c571`, incorporating Field `3248f285`. Worker aggregates are `f06cda50..19fee7f2` and `f06cda50..03caf3e2`. Integration retained both imports in host/flow and every registered suite: 318 unique entries. No runtime conflict required choosing one implementation over the other.

Field activation now pays card energy, stages the original Extra in Drop, completes its skill costs and taxes, then places that occurrence in Battle Active. Failure retains prior payments without spending Limit, coupons or counted activation allowance. Invoked Fields waive prices but retain conditions. Mandatory cleanup binds all older Fields, preserves owner-selected order and supports replacement choices. King Cold's exception uses original cost 2 and its live Leader condition; its duplicate restriction uses card number. [Field source and detailed proof](field-staging.md).

Ultrasonic Exchange follows owner ruling R435: unknown skill plays are permitted and each qualifying arrival has its own decision. The original Counter pays and activates once. Deflect, Barrier, original movement completion and replacement fallback are distinguished. No future qualifying arrival means no decision/fallback. Original source, batch order, parent operation and saved child ownership remain bound. Counter:Counter candidate discovery no longer reuses another Extra's saved payment declaration. [Counter source and detailed proof](counter-arrival-decisions.md).

## Complete-record comparison

All 6,597 recovered public cards and 13,964 records were regenerated. Totals: **12,999 readable / 965 unread**, **14 additional runtime gaps in readable records**, **324 additional blocked records** and **2,559 contextual unknowns**. A clean static row is not exhaustive gameplay proof. The recovered input also omits combo stats and specified-cost data; actual native fixtures use inspected official images where needed.

Only these five records differ from checkpoint 40:

| Record | Changed fields |
| --- | --- |
| BT13-084#10 | cond, ops, pattern, reads, unread |
| BT13-084#20 | ops, pattern, reads, unread |
| DB2-030#0 | ops, pattern, reads, unread |
| BT27-119#10 | cost |
| BT27-120#10 | cost |

Every printed field and every unrelated complete record is identical. Full snapshot SHA-256: `d77b0c1649de9f75ca633f5a14d182b90aae072530184b3cef4543cec176945b`. Local evidence: `/workspace/shared/arena-support5/recovery/fortyfirst-full.json`, `fortyfirst-record-diff.json`, `fortyfirst-runtime.json`, and `fortyfirst-verification.json`.

## Combined validation

**1,288 counted cases pass:** 430 across Field, per-arrival policy/lifecycle/native, under Counter, Revive and Awaken; 858 across Over Realm, Energy/Drop/Extra Counters, retained choices and shared scopes. The Drop suite's 12 stored cases are included in its 164 total, not counted twice.

Typecheck and integration-file lint pass. Direct language fixtures match the combined source; lang/Teach, 247 rulings, 42 capability scenarios / 134 VM sites, attack previews and the 177-module browser boundary pass. Browser replay completes 121 steps with privacy, immutability and replay checks. Fusion fuzz completes 40/40 with zero crashes, interruptions or action limits. All parent execution sessions are closed.

Follow-up commit `9a8e1320` repairs the legacy verification defects: `vm.ts` now expects the existing negation-source attribution and R399 Z-Energy pool order; `wordings.ts` defines its Ultimate fixture locally instead of depending on another suite. Both complete standalone suites pass. The earlier missing-zAwakens inventory failure was independently reproduced on unchanged checkpoint 40 and exact inventory/snapshot expectations were corrected. No assertion was weakened, and these follow-up suites are not added to the 1,288-case claim. Full gate/build is still reserved for complete integration under the batch process.

## Continuing work

Launch BT31-055's standing Drop combo permission (R473) and BT17-002's alternative Awaken payment from one Super Sigma (R474) are active. R435 still needs owner ordering for automatic multi-card pools and token/special-procedure support; its census distinguishes 75 ordering, 100 token, 65 explicit-window and 115 other procedure exclusions. Field admits the source-backed empty/exact Draw 1 action prices, not arbitrary keyword costs. General movement lifetime, standing negation, optional Energy-Exhaust procedures, unread clauses and attribute completeness remain in scope. Cell Games' invoked Battle-card cost waiver remains the sole unanswered owner question.

No database refresh/write, migration, dependency change, deployment or merge occurred. Work continues in draft PR #1249.
