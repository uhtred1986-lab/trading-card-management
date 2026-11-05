# Conditional and delayed movement follow-ups — 5 Nov 2026

Intermediate checkpoint in PR #1249, source `0e8334dd`. Complete card support remains in progress.

R-430 keeps a positive “if you do” continuation inside the conditional or delayed body that performs its prerequisite movement. The bounded transformation covers an immediately preceding if/delay chain ending in an optional one-card choice and ordinary movement. Negative, else-bearing, under-placement and ambiguous bindings remain outside this batch. [Source and scope receipt](../round-5/cross-body-completion.md).

BT8-033 and BT10-126 now run their follow-ups at the actual end-turn delay. Conditional branches do not read nonexistent movement results when untaken. Compilation-only metadata prevents the changed tree shape from turning a resolution condition into a stored activation gate. Actual EX06-35 tax tests prove that a false TB1-013 resolution condition still offers/pays the activation tax and is checked later. Exact legacy delayed bodies missing their follow-up refuse with a rebuild message; canonical comparison also handles reordered JSON keys while unrelated old delays remain usable.

Exactly 15 records change: BT8-033#10, TB3-033#0, BT22-133#10, BT10-126#0, P-160#0, TB3-018#10b, TB1-039#10, P-144#0, TB2-008#10, TB2-005#20, P-127#0, TB1-013#0, EX23-50#20, BT6-022#0 and EX03-23#0. Only ops/pattern/reads change. The parent reviewed every print and resulting scope, verified all other full-record fields unchanged, and checked that removing completion annotations and flattening nesting reproduces the exact prior instruction sequence and values. Conditions, costs, triggers, validity, usage and unread clauses are preserved. TB2-008’s separate search clauses remain unread. [Complete changed-field evidence](support-twentysecond-full-record-diff.json).

Combined validation passes 534 counted scenarios: cross-body completion 41, composite completion 34, movement 52, native under-placement 38, stored under-placement 29, ordered Z-Awaken 72, Z-Energy choices 64, shared scope 94, replacement timing 53, replacement taxes 26 and condition audit 31. All existing suites naming the affected IDs pass, along with typecheck, changed-file lint, language/lang/Teach, capability inventory and rulings (213, zero pending). Fixture fuzz completes 40/40 with zero crashes, interruptions or action limits.

Full catalog totals remain **12,980 readable / 984 unread**, with **27 additional readable runtime gaps**, across 6,597 cards and 13,964 records. SHA-256: `0fe3daa0581d1ed983053964ecdaff43d4f626c4e5e9456c852d4c5f3ae6b676`. Evidence is retained under `/workspace/shared/arena-support5/recovery/twentysecond-*` and `triggers-r430/`.

Qualified Bond/Spirit Boost, retained Counter continuations and other runtime/unread gaps continue. No production refresh, database change, deployment or merge occurred. The full gate remains for complete combined integration.
