# Original movement as an action price — 5 Nov 2026

Intermediate checkpoint in PR #1249, source head `9fa87fe2`. Complete card support remains in progress.

R-427 makes the strict ordinary movement-price wrapper consume and forward the native original-movement result. A replaced action is not paid merely because the replacement reaches the same named area. RM 5-8-2-2-1/-1-1 requires the original payment action; RM 5-8-2-3 separately permits modifications to the cost instructions themselves. Existing explicit alternative/modified-price paths remain valid.

An existing native Auto-cost test first reproduced the wrong draw/activation after a same-destination replacement. The corrected path retains prior paid resources but does not activate or resolve the unpaid skill. Eight additional both-seat controls verify original success, different/same-destination replacement failure and result-observer forwarding. This is a narrow ordinary movement-price fix. Deferred substitute payment and under-placement prices require their own continuations; no broader coverage is claimed. [Source receipt](../round-5/cost-movement-result.md).

Combined checks pass **643 counted scenarios**: new price results 8, movement results 52, replacement timing 53, replacement taxes 26, shared scope 94, Z self-pile 48, Z prices 146, Charge skip 28, native Z-Awaken 60, invocation 82 and mill history 46. The complete Auto-cost suite, Counter action-price and Activate: Battle alternative-cost suites pass. Typecheck, changed-file lint, language/lang/Teach, rulings (208, zero pending) and capability inventory pass. Fixture fuzz completes **40/40**, zero crashes, interruptions or action limits.

The full 6,597-card catalog is byte-identical to checkpoint 16: **all 13,964 records unchanged**, **12,980 readable / 984 unread**, additional readable runtime gaps **30**. SHA-256: `704c2c3a869f0f136a286a0ff836fbdd2ee68a308337c1c9a34c18da3e66b41b`. No production refresh, database change, deployment or merge occurred. General Z-Energy selection and the actual under-placement/composite movement families continue; the full gate remains for complete combined integration.
