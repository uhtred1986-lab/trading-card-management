# R477 standing whole-negation history prototype

This is a pure transition prototype for the DB1-066 / BT10-153 all-other-Battle policy. No card is admitted, no compiler behavior changes, and no gameplay caller writes or reads this history. TB1-048, BT20-086 and BT23-070 are outside this stage.

The King Vegeta / SS3 Gotenks official FAQs establish first-active precedence and the temporary-negation handoff: if A is negated, B takes over, and A does not reclaim the effect when its temporary negation expires. The prototype retains surviving active generation serials before admitting newly enabled occurrences. Identity includes card, card ID, epoch, hidden incarnation, side, master, skill index and exact compiled record identity. Enumeration sorting is used only for stale-observation detection. Multiple newly enabled sources require an explicit order supplied by the mutation owner; no player/card-array order is inferred. An asymmetric graph that would suppress a surviving active source refuses pending a reviewed protection transition.

Inputs explicitly supply externally enabled sources and protection-filtered target edges. Reads require matching settled history, never assign history, and fail closed for affected legacy boards. Missing history on an unaffected board is harmless. The optional state field is a storage shape only. A future native initializer must create empty history before the first affected transaction; it must not infer old activation order from a loaded board.

## Native seams still needed

- `host.moveTo`, token creation and the play-arrival transaction: settle after the complete landing, including pre-entry timed negation, but before arrival Autos and post-arrival Counter evaluation. Low-level `zones.moveCard` alone is too early and lacks source/protection context. Preserve R422 already-witnessed arrivals.
- `effects.addEffect` / `endEffects` and source-ending cleanup: settle actual validity changes and timer expiry before subsequent projections. Resolve mutation ordering explicitly; a batch's enumeration is not evidence of simultaneous-effect ordering.
- Control, face/hidden incarnation, under-pile and skill-copy changes: update occurrence identity at the actual transaction boundary; the initial policy covers Battle sources only.
- Protection observation: newly arriving Whis / protected Son Goku apply their own protection immediately, but pre-entry timed negation suppresses it. Do not blanket-ignore existing standing suppression when evaluating a previously suppressed target's protection at timer expiry. Candidate enablement and target protection may need separate observation passes.
- Barrier is irrelevant to these non-choosing edges. Deflect must still work before entry and be suppressed after landing. Already-resolved Over Realm delayed cleanup survives subsequent standing negation.
- R475 resolved keyword/copy deletion receipts must be updated by mutation settlement, not queries. Standing grant reactivation needs its own reviewed generation semantics; these active suppressor generations are not standing grant generations.

Verification: `npx tsx scripts/verify/standing-negation-history-5.ts` covers 32 grouped cases across both seats, including first-wins/handoff, generation identity, serialization, read purity, explicit simultaneous ordering, protection-edge input, and stale/malformed/legacy refusal. No full gate, database access, dependency installation or support-count change is part of this prototype.
