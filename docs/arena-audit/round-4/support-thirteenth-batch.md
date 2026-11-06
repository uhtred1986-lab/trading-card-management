# Next Charge Phase as a Z-Awaken price — 5 Nov 2026

Intermediate checkpoint in PR #1249, source head `738478fb`. Complete card support remains in progress.

R-397 restores BT18-003’s complete Z-Awaken price: life four or less, all energy in Rest Mode, and a commitment to skip the next own Charge Phase. The future timing phrase identifies the phase being skipped; it does not defer creating the skip until that phase. The strict keyword runner admits only this exact own-next-Charge commitment for Z-Awaken, without widening ordinary Auto prices.

The commitment survives failed placement and the card’s printed end-opponent-turn removal Auto. The next own Charge Phase skips readying, drawing and charging, expires until-next-turn effects at the appropriate boundary, and is consumed once. The following own Charge Phase is normal. Opponent-turn activation is covered.

Two prerequisite runtime corrections accompany the price. `every` conditions now observe both their pool and matching subset, including protected cards; actual choices retain immunity exclusions. The effect interpreter permits a controller’s effects to move its own Z-Leader, allowing existing top-Z removal and awakened-Leader restoration. Ordinary Leaders and opponent effects remain barred. Incoming paid piles are separate follow-up work.

Combined checks pass **520 counted scenarios**: Charge price 28, existing Z-Awaken prices 147, native Z-Awaken 60, replacement timing 49, shared scope 94, observational conditions 8, supported conditions 52 and invocation 82. Typecheck, changed-file lint, language/lang/Teach, rulings (204, zero pending) and capability inventory pass. Worker checks also cover existing duration, keyword/wording, Z-Energy, Z-Extra, typed payment, prohibition and affected-card suites. One obsolete BT18 unread-price assertion is removed from the previous price suite because this batch implements it.

The tests distinguish actual native turn transitions from staged Battle setup, primitive negative controls and a staged post-payment failed-placement continuation. The latter does not claim a new response window.

The full 6,597-card offline catalog remains **12,980 readable / 984 unread** across 13,964 records. Exactly BT18-003#10 changes, only its cost field; printed text, resource fields and every other record remain unchanged. [Full changed-field evidence](support-thirteenth-program-diff.json). Additional readable runtime gaps fall to **30**, broader additional reasons to 346, contextual unknowns remain 2,559. Full-output SHA-256: `e7714c059e683c69f512482cd385f1ec5487771f64f0ff9819de250d9471fcb2`. Fixture fuzz completes **40/40**, zero crashes, interruptions or action limits.

 Existing false empty-pool `every` semantics are retained, not newly established by this ruling. The old RM 0-2-4-1 code comment concerns object state changes and does not prove the empty-condition reading; a separate source check remains queued. No production refresh, database change, deployment or merge occurred; the full gate remains for the complete combined integration.
