# Composite action completion — 5 Nov 2026

Intermediate checkpoint in PR #1249, source `cb61e940`. Complete card support remains in progress.

R-429 restores P-129#10 by requiring all three preceding actions before negating the attack: the chosen yellow hand card’s original movement to Drop, an actual Active-to-Rest switch of the chosen yellow energy, and the original source’s movement to Drop. The existing optional offer and subsequent attempts remain sequential under RM 0-2-3/4. A replacement, prohibition, already-Rest no-op or changed occurrence does not satisfy the final hinge. [Source and scope receipt](../round-5/composite-completion.md).

The one-card switch records its native result and captures candidate occurrences before its chooser opens. The composite self move retains the source occurrence before the offer. Saved old records, missing provenance and obsolete final continuations refuse explicitly; malformed/multiple-card switch witnesses also refuse. Generic untallied switches are unchanged.

Exactly P-129#10 changes, only ops, pattern and reads. The parent compared the complete corpus and reconstructed the previous program by removing the three completion annotations and restoring its old final condition. Selectors, costs, triggers and all other record fields remain unchanged. [Complete changed-field evidence](support-twentieth-full-record-diff.json). The two direct language fixtures change only for the new switch-completion field and condition.

Combined validation passes 656 counted scenarios: composite completion 34, movement 52, native under-placement 38, stored under-placement 29, Z-Energy choices 64, original cost movement 8, replacement timing 53, replacement taxes 26, shared scope 94, Z self-pile 48, Z prices 146, implicit Absorb 48 and selector audit 16. Existing did/may tests, typecheck, changed-file lint, language/lang/Teach, capability inventory and rulings (211, zero pending) pass. Fixture fuzz completes 40/40 with zero crashes, interruptions or action limits.

Full catalog totals remain **12,980 readable / 984 unread** across 6,597 cards and 13,964 records. Additional readable runtime gaps fall from **30 to 29**. SHA-256: `dc6687b267f6a4632aaeaabfd44144ec356106f42933c1a2876e6c91ce9098eb`. Evidence is retained under `/workspace/shared/arena-support5/recovery/twentieth-*` and `triggers-r429/`.

Conditional/delayed action-result hinges, competing Z-Awaken prices and other runtime/unread gaps continue. No production refresh, database change, deployment or merge occurred. The full gate remains for complete combined integration.
