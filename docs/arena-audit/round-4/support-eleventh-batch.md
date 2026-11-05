# Bounded Z-Awaken action payments — 5 Nov 2026

Intermediate checkpoint in PR #1249, source head `463a7c96`. Complete card support remains in progress.

R-396 restores four complete action prices: EX21-22 and EX23-19 place the named Ball from hand or Drop under the Leader; SD20-02 sends a Great Ape Son Goku: Childhood from Drop to Warp; BT27-046 places one controlled Battle Card in its owner’s Drop. Printed life conditions, colored energy and Z-Energy costs remain intact. The strict keyword-payment runner pays the action before spending the Z-Awaken use and performing placement.

Saved prompts bind source, Leader and selected material occurrences. Invalid or re-entered objects cannot satisfy the old payment. Interrupted payment retains resources already paid without spending the Z-Awaken use. A replacement that diverts the required movement does not count as payment; declining an optional replacement allows the actual required movement to complete. Unsupported action shapes remain explicitly refused.

Combined checks pass **540 counted scenarios**: new action prices 148, native Z-Awaken 60, shared skill scope 94, invocation 82, mill-payment history 46 and Surge 110. Existing keyword-action-costs-926, language/lang/Teach, rulings (202, zero pending), typecheck and changed-file lint pass. Ruleset output was regenerated. Fixture fuzz completes **40/40**, with zero crashes, interruptions or action limits.

The complete recovered 6,597-card catalog produces **12,980 readable / 984 unread** across 13,964 records. Exactly four full records change, each only in its cost field: EX21-22#10, EX23-19#10, SD20-02#10 and BT27-046#0. The original cost text and resource fields are unchanged; the full condition and action program are restored. [Full changed-field evidence](support-eleventh-program-diff.json).

Additional readable-record runtime gaps fall from **35 to 31**, broader additional reasons from 351 to 347; contextual unknowns remain 2,559. These counts are an inventory, not proof of exhaustive runtime coverage. Full-output SHA-256: `0fdde1eae505ee3a772dbfe4efbdfe3c9e3382bfd1c6495f12712877cd507dad`. Input is the recovered catalog documented in the tenth receipt, SHA-256 `d3646487f34749d905a65b2473f21aee7984e4aac640c631bc0deb319e512bfb`.

Four Z-Awaken action-price records remain: EX21-28, BT19-003, BT21-036 and BT18-003. Z-Energy selection, incoming Leader piles, skip-Charge behavior and replacement Auto timing continue. No production refresh, database change, deployment or merge occurred. The full integration gate remains for the complete combined deliverable.
