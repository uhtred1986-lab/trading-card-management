# Paid Counter admission conditions — 5 Nov 2026

Intermediate checkpoint in PR #1249, source `68262b92`. Complete card support remains in progress.

R-433 distinguishes the already-paid activation gate from the incoming-card resolution condition for EX13-04, BT10-082 and BT10-113. The original Counter lifetime now retains the latter without rechecking a Leader or Unison requirement after activation. The loader records structural provenance from matching `row.cond` and `cost.condition`; only the bounded Counter family consumes it. Genuinely repeated effect conditions remain intact. A versioned saved activation witness rejects affected older continuations. [Source and review receipt](../round-5/counter-admission-tail.md).

The 71 new scenarios cover both seats, valid and invalid admission, low/high/zero arrivals, Window2, native nested response windows, reload, reordered condition fields, missing witnesses and repeated effect conditions. EX13-04 fixtures use its official corrected text; an earlier raw-text comparison was discarded and no speculative price-shortcut change was integrated. Loader metadata is attached to 3,262 existing records, but exactly these three Counter records gain a consuming runtime path.

Combined validation passes **407 counted scenarios**: admission 71, retained Counter 152, shared scope 94, after-window 14 and Counter costs 76. Existing Counter-chain, Counter action-price and Union-Counter suites pass. Typecheck, changed-file lint, language/lang/Teach, capabilities and rulings (218, zero pending ledger entries) pass. Fusion fixture fuzz completes 40/40 with zero crashes, interruptions or action limits; it is a regression check, not evidence of exhaustive Masters gameplay coverage.

The complete 6,597-card offline corpus is byte-identical to checkpoint 26: **12,980 readable / 984 unread**, **24 additional readable runtime gaps**, 13,964 records. SHA-256: `6c7fa188e34fcd426c781007ce456d8ae50dc8b211b521d419f59b1df0eb3256`. Evidence is retained under `/workspace/shared/arena-support5/recovery/twentyseventh-*`. No compiler, stored-operation or narration changes are claimed; loaded scripts and saved runtime frames gain admission provenance.

Qualified Spirit Boost/Burst payments, multiple-arrival Counter decisions, scoped discounts, static identity dependencies and remaining unread/runtime families continue. The separate attribute-completeness limitation is recorded in the completion tracker. No production refresh, database change, deployment or merge occurred. The full gate remains for complete combined integration.
