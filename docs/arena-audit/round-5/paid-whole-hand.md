# R525 — P-045 back: historical whole-Hand payment

This slice admits only the complete back Activate Main. The original four-record fixture retains the front's unread look/combo skill, genuine Awaken and back attack draw. The exact compiler matcher includes the raw nonempty-Hand parenthetical, Once per Turn and complete body; it has no CardDef context. The native producer separately requires the original top normal Leader before resources. No catalog or database row is written.

## Sources

- Complete P-045 front/back and all four original records: `scripts/verify/fixtures/paid-hand-5.json`; no own FAQ in the frozen store.
- Official back image: https://www.dbs-cardgame.com/images/cardlist/cardimg/P-045_b.png. Visually reviewed; SHA256 `697a1431af4442a4e414857d506538cf89778060b7cb42c7b87366113172e3c8`. It supplies native `back.power: 5000`; the frozen raw catalog remains unchanged. Successful power is therefore 55,000.
- RM 1-6-1..4, 5-8-1..4, 9-4-1..6 and 3-5-3; existing R427 original-payment semantics and R515 usage completion.
- TB1-002 full source and three FAQs were reviewed in shared recovery. Its optional discard permission belongs to that card: the test uses an explicitly synthetic permission, not a claimed legal Kale/Hercule interaction.

## Implementation

The shared exact `allHandPaymentMove` recognizer is the only additional selector allowed with `completedAs`. The strict ordinary-price host captures the complete original Hand once before actual movement and reuses that capture on repeated `as`/move-loop reference reads. The existing selector's count99 spelling does not truncate this direct reference: a native 100-card Hand proves complete payment. Selected payer order, physical owner, original epochs and hidden counts bind the saved pool. Existing MovementResult outcomes remain authoritative; a current Drop count never supplies history.

Original R515 declaration and usage eligibility authenticate publication. Only complete original payment publishes `paid_hand` and continues to +50000, independently of the five-card Strike threshold. Later Hand arrivals are excluded; previously paid cards may leave Drop without changing the count. Actual optional replacements can be declined. Accepted same-Drop/away replacements and substitution fail the original payment, retaining earlier movements and child effects without the parent's effect or Once use.

For this exact price, a newly effective movement prohibition stops at that instruction, preserving the genuine outcome prefix and untouched suffix. It does not manufacture an outcome or repair generic skipped-price continuation elsewhere. Failed substitutions may have child effects on other captured payers; those failure-only histories cannot publish or activate. For a plain deferred substitute, the strict wrapper records the existing native failed onResult before running its child, because the generic interpreter intentionally withholds its callback. Replacement-Auto fallback remains explicitly unsupported before its original move; it is not assumed to fail or succeed.

Saved frame validation binds complete source, original pool, movement-loop kind/IDs/destination/reason/cursor, outcomes and aliases. Missing/corrupt history, malformed arrays and fabricated play wrappers refuse before mutation. New source face/cover/occurrence transitions are explicit unsupported bounds. No global self-selector policy changes. The body is power plus conditional grant, with no choice or play; native completion leaves no suspended mutated conditional branch.

Copied/waived activation, additional taxes, optional own-discard permissions and non-normal-Leader sources refuse before charging. This does not claim full P-045 support or solve the front's incremental private look dependency.

## Verification

New checks pass: 32 native cases, 80 saved/unsupported-boundary controls and 26 produced-body boundary controls; 124 isolated contracts plus uncounted full-record/DSL assertions. Total: 262 counted new cases. `hercule-native21.log` records the first 32+78+26 run; the final tool-captured run adds two generic-producer absence controls (32+80+26). `hercule-contract4.log` records124. The produced-body mechanism steps the actual R515 cost writer to completion without draining its body, then validates the authentic published receipt before +50000; no genuine body pause is claimed. New native tests use actual stored source and actual Awaken; Hand/resource sizing and replacements/prohibitions are labeled mechanism setup. Both player seats, thresholds 1/4/5/6, 100-card Hand, empty refusal, replacement choice/reload, input immutability, both board views, late Once exhaustion and late prohibition are covered. Snapshot replay compares complete returned states/events on every application. Private projections must not contain the receipt or alias fields.

Compatibility: ordinary Activate 92; Tao 32 native +28 saved; P764 58 native +36 saved; movement completion 8+52; Auto-cost #549 scenario suite (no invented numeric count). Focused full-source DSL roundtrip and all three unchanged sibling records are asserted. Root owns the sole final full-catalog/runtime comparison; its independent BT20-120 source correction must be reported separately.

Final type (`hercule-type7.log`), touched lint (`hercule-lint2.log`), language and ruling checks passed. Compatibility totaled306 explicitly counted cases plus Auto-cost #549 scenarios. No full gate or catalog scan was run. Three new NotYet sites require integration registration: `paid-hand-runtime.original`, `paid-hand-runtime.requirePaidHandFrame`, and the R525 replacement-Auto bound in `stepOrdinaryActivateCost`.
