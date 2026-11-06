# Support checkpoint 43 — resolved skill-grant deletion

Runtime `355e8553` in draft PR #1249 implements R475: resolved keyword and copied-skill grants deleted by whole-skill negation do not return when that negation expires. Printed skills return normally; fresh grants have independent identities. See [the mechanism and native receipt](resolved-grant-deletion-prerequisite.md).

Saved history binds the original card occurrence, hidden incarnation and grant identity. Current reads reject missing or mismatched history; captured pending/active programs retain their original compiled skill and cannot borrow a fresh occurrence. Existing pending-hook cancellation remains intact, while already-witnessed arrival Autos and activated bodies retain their established timing. Native KO replacement preparation now captures the same original declaration as ordinary movement replacements.

## Validation and coverage

Combined tests pass: 30 mechanism cases, 50 native/protocol cases, 64 keyword-negation cases, 53 replacement-Auto cases, 14 Counter after-window cases, 94 Launch cases, 8 Launch stored/DSL cases and 78 alternate-Awaken cases (**391 counted cases**). Granted/printed Heroic, quoted grants, battle cleanup, complete standalone VM and wording suites also pass.

Typecheck and changed-file lint pass. Language/lang/Teach, 250 rulings, 42 capability scenarios / 142 VM sites and attack previews pass. The first capability check identified seven missing guard entries and two moved function identities; the inventory now records those exact sites. Browser validation covers 182 portable modules and a 121-step replay with privacy, immutability and deterministic replay checks. Fusion fuzz completes 40/40, with no crashes, interruptions or action limits.

All 6,597 cards / 13,964 complete records were regenerated: **zero record changes** from checkpoint 42. Snapshot SHA-256 remains `94c81ffe7c02bccfd1a0aa9fa714b852807473ba2e006900625cc794f1096aea`. Counts remain **12,999 readable / 965 unread**, **12 readable runtime gaps**, **322 additional blocked records** and **2,559 contextual unknowns**. These are not fully verified card counts; R475 is a runtime prerequisite, not a new printed-card admission. Local evidence is under `/workspace/shared/arena-support5/recovery/fortythird-*`.

Standing whole-negation history and all-area self-keyword qualification are the next prerequisites. Optional Energy-Exhaust payment wiring continues; its incoming-Drop-card payer question and the earlier Cell Games cost-waiver question remain pending. Full card support remains the objective. Full gate/build is reserved for complete integration. No database write, refresh, migration, dependency change, deployment or merge occurred.
