# Nested after-window Counter scopes — 5 Nov 2026

Intermediate checkpoint in PR #1249, source `48b5508a`. Complete card support remains in progress.

R-431 records the actual before/after phase when parking a shared Counter window. Previously an after-window retained phase `effect`, so a responding Counter with its own play scope rejected the parent as an invalid saved state. The correction lets nested effects finish and resume their parent without changing the serialized schema or compiler. [Source and scope receipt](../round-5/counter-after-scope.md).

Actual DB2-040 and DB2-169 confirm their official Window2 answers: the being-played condition is false after arrival, neither transformation nor self-play resolves, and the Counter remains in Drop. Existing observational condition semantics already enforce this. Fourteen new native cases cover both seats, JSON replay, low/high/zero arrivals, and BT10-136 answered by Crusher Ball inside the parent's after-window. Both scopes close and Towa enters Rest Mode.

Combined validation passes 280 counted scenarios: after-window 14, shared scope 94, replacement timing 53, replacement taxes 26, cross-body completion 41 and negation areas 52. Existing Counter-chain, Union-Counter and Counter action-price suites pass. Typecheck, changed-file lint, capability inventory and rulings (214, zero pending) pass. Fixture fuzz completes 40/40 with zero crashes, interruptions or action limits.

The full 6,597-card corpus is byte-identical to checkpoint 22: **12,980 readable / 984 unread**, **27 additional readable runtime gaps**, 13,964 records. SHA-256: `0fe3daa0581d1ed983053964ecdaff43d4f626c4e5e9456c852d4c5f3ae6b676`. Complete output and validation logs are retained under `/workspace/shared/arena-support5/recovery/twentythird-*`. Retained mixed Counter continuations, qualified Bond/Spirit Boost and the remaining runtime/unread gaps continue. No production refresh, database change, deployment or merge occurred. The full gate remains for complete combined integration.
