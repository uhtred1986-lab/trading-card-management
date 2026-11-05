# Extra card activation, R460

An Extra's own activation Auto previously listened for a Battle/Unison arrival. Actual BT7-024 hand Counter negated an attack but never installed its same-name activation lock. The native two-attack regression failed before this change and now passes from both seats.

RM 12-1-3 and 12-2-2 through 12-2-4 distinguish card activation from ordinary skill activation. BT10-092 and BT10-095's own FAQs expressly distinguish BT9-109's ordinary Drop Activate from the four BT7 Drop Counter permissions; only the latter is Extra card activation. The BT7-024/048/073/098 FAQs confirm BT10-092 observes their permitted activation. BT10-092 also confirms invocation from hand through SD7-01. Frozen own FAQ and errata inspection found no conflicting change for the seventeen self-trigger records.

Native hand Activate, Counter, Field and invocation now provide typed cardActivation provenance. Own selfExtraActivated observes the exact source after payment; broad own/opposing watchers observe the same event. extraActivatedFromHand preserves explicitly printed hand origin. Battle keyword activation and unrelated Drop Extra Activate remain excluded. The future Drop-permission event is tested as a typed protocol control, not claimed as native Drop Counter support: that payment/permission implementation remains R438.

Old own played mappings and broad mappings for explicit hand watchers require rebuilding across draft, confirmed and corrected stored rows. Missing own activation rules block actual card-activation routes before payment; unrelated Drop Activate remains usable. Saved hand activation moments lacking provenance and paid saved Counter continuations using stale own rules fail explicitly. This does not widen general Auto validity in Removed.

## Exact record evidence

Frozen artifacts are under `/workspace/shared/arena-support5/triggers-r460`: `self-intent.json`, `watchers.json`, `after-full.json`, and `full-diff.json`. Compared with checkpoint30, exactly 28 records change, and only their trigger field changes. All other full fields remain byte-equivalent. Compiler totals remain 6597 cards / 13964 records / 12980 read / 984 unread on this branch; the parent's later independent coupon changes are not part of this baseline.

Seventeen own triggers: BT7-073#20, BT7-048#20, BT9-131#10, BT6-051#0, BT9-130#10, BT11-119#10, BT10-058#30, BT11-057#10, DB3-074#10, BT7-098#20, BT7-024#20, BT9-132#10, BT10-028#10, BT9-133#10, BT8-087#0, BT9-134#10, BT8-063#0.

Eleven explicitly hand-qualified watchers: BT29-001#0b, BT29-029#10, BT29-003#20, P-265#20b, BT29-005#10, BT29-010#0, BT27-026#10b, P-266#10, BT14-121#10, BT14-121#10b, BT29-011#10. Other broad watchers change runtime event routing without compiler record changes. Effect text that later plays the watcher from hand is not an activation-origin qualifier.

## Validation

`extra-self-activated-5` proves 41 native/protocol cases: actual BT7-024 lock, BT11-057 and BT10-058 Field effects, ordinary Main/Battle Extra activation, actual SD7-01 hand invocation observed by BT10-092, explicit hand watchers, genuine Battle arrival, unrelated Drop activation, native alternative Counter payment with own and broad/hand watcher draws, all-status stale/missing rows and saved-event refusal, both seats and JSON reloads. Protocol-only permitted Drop activation and saved-state fault controls are labelled separately.

Invocation origins (82), audit-triggers-3, free-extra-680, rulesets, affected-ID reading suites, TypeScript, changed-file lint and language/lang/Teach are checked. The two direct language fixtures were regenerated; only the reference fixture changes. Existing keywords and phrasing-batch-7 assertions are updated for the two exact new trigger names. The older wordings suite requires keywords in the same process for its Ultimate fixture; its standalone failure did not justify a runtime or assertion change.

Remaining work: native Drop Counter permissions and complete payment/provenance (R438), then energy/under Counter activation families. The ordinary Z-Extra Battle exclusion is a typed eligibility control. No database, paid compiler, dependency, build or full-gate operation was used.
