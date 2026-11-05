# Competing Z-Awaken payment order — 5 Nov 2026

Intermediate checkpoint in PR #1249, source `451e8688`. Complete card support remains in progress.

R-443 implements RM 22-46-3-1’s choice of payment order for EX21-28#0 and BT19-003#10. Players can pay Z-Energy first or the printed skill cost first. EX21-28 retains its yellow orb, life-at-most-four condition and distinct Zamasu/Goku Black cards sent to Warp. BT19-003 retains its red orb and optional zero-to-three cards placed under the original Leader. [Source, implementation and scope receipt](../round-5/z-awaken-cost-order.md).

Saved order, resource and action cursors preserve source/base and unpaid payer occurrences. Affordability proves the actual native movements and the remaining payment, including nongreedy material assignments; it does not rely on pool counts. Opaque remaining-cost proofs disable candidate folding. Explicit energy and pool requests survive the deferred declaration, partial prefixes consider alternate completions, and malformed requests refuse. Failed replacement payments retain earlier paid resources without announcing the unpaid activation. Missing/re-entered unpaid payers cannot silently become empty moves.

Exactly two full records change, only their cost field. The parent verified all other fields and retained cost text, orbs and metadata against the complete preceding corpus. [Complete cost evidence](support-twentyfirst-full-record-diff.json).

Combined validation passes 752 counted scenarios: ordered Z-Awaken 72, resource choices 64, native Z-Awaken 60, prior Z prices 146, Charge skip 28, Z self-pile 48, composite completion 34, native under-placement 38, stored under-placement 29, movement 52, original cost movement 8, replacement timing 53, replacement taxes 26 and shared scope 94. Existing Auto-cost, keyword-price, typed-payment and disjoint-price suites pass. Typecheck, changed-file lint, language/lang/Teach, capability inventory and rulings (212, zero pending) pass. Fixture fuzz completes 40/40 with zero crashes, interruptions or action limits.

Full catalog totals remain **12,980 readable / 984 unread** across 6,597 cards and 13,964 records. Additional readable runtime gaps fall from **29 to 27**. SHA-256: `2e5c1da43aa57a7efad2a76c7a4de7bc08a225161c26df5399bcc5e1d691db77`. Evidence is retained under `/workspace/shared/arena-support5/recovery/twentyfirst-*` and `conditions-r443/`.

Qualified Bond/Spirit Boost, conditional/delayed continuations and the remaining payment/runtime/unread inventory continue. No production refresh, database change, deployment or merge occurred. The full gate remains for complete combined integration.
