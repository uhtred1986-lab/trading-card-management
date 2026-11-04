# Explicit mill payment history — 4 Nov 2026

Intermediate checkpoint in PR #1249, compiler/runtime head `d9761d50`, invocation proof `312424e3`. Complete support remains in progress.

**R-392:** SD3-01's two faces remember the effective characteristics of the three cards actually placed in Drop to pay the Activate price. Black grants Critical; another color grants +5000 once, including when a black multicolor card satisfies both clauses. The normalized official SD3-001 FAQ explicitly rejects +10000 for two other-color cards. Historical facts survive later characteristic changes and movement; live targets separately require the paid occurrence. Payment aliases use `paid_mill_m0`, so a later ordinary effect mill cannot overwrite them.

Only successful, complete payments forward history. Failed or replaced movement cancels the effect. Ordinary effect mills do not manufacture payment history, including after an Auto finishes its action price. A waived exact mill price supplies known-empty history while preserving any previously supplied successful history. Six additional native invocation cases cover both seats and hand/deck/Drop origins: no cards are milled and the unpaid bonus does not resolve.

Combined verification passes **242 scenarios**: explicit mill 46, invocation 82, Burst 92 and immediate lifecycle 22. Typecheck, changed-file lint, rulings (196, zero pending), and whitespace checks pass. Worker compatibility additionally covers shared price readers, cost binding, phrasing 9, Auto costs, typed payments, keyword action costs, language and Teach. Fusion fixture fuzz completes **40/40**, zero crashes, interruptions or action limits; this is shared-runtime regression coverage, not exhaustive card support.

The full-record comparison changes exactly **SD3-01#0 and SD3-01#0b**, only operations, unread status, pattern and narration. Both records exactly equal the reviewed worker output. The independent comparison checks the historical colors, self target, amount and turn duration; printed text, payment, usage and trigger fields remain unchanged. [Full changed-field evidence](support-sixth-program-diff.json).

Frozen catalog totals: **12,981 readable / 983 unread**, no read-to-unread regressions. Additional readable-record runtime gaps remain **44** (360 broader additional reasons, 2,559 contextual unknowns). Snapshot `/tmp/arena-support5/combined/sixth-mill-full.json`, SHA-256 `51846afc02dfa5812b9df4f90a07494408a9cad816937a45a0c09149addb579d`; fuzz `/tmp/arena-support5/combined/fuzz-sixth-mill.json`.

Next work includes confirmed-record loading and exact destinations for Turles combo replacements, remaining Awaken payments, and shared skill-play Counter timing. The Battle invocation owner question remains pending. No production refresh, database change, deployment or merge occurred; the full integration gate remains deferred until the complete combined deliverable.
