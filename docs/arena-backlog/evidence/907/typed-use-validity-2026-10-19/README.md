# BT6 typed metadata and rule repairs — #907 / #897

This combined increment continues the frozen BT6 Gogeta/Br Fusion versus
Paragus/Broly pair in one application PR/build. It separates compiler delivery,
actual guarded application, human confirmation and pair qualification.

The preceding four combo records were applied under deployed #1070, with
[actual-export replay evidence](../combo-qualifications-2026-10-19/application-receipt.json).
That checkpoint is historical under engine `3bb6f0e`; the new contracts require
explicit record and saved-context rebuilding.

The online checks pin official current cardlist/manual/FAQ/errata, retrieved
bytes and access limitations:

- [Use ceilings and the eleven printed tags](../typed-usage-2026-10-19/online-sources.md).
- [Four Sparking skills and validity timing](../typed-validity-2026-10-19/online-sources.md).
- [Paragus Life lock, Broly Q7 and actual damage](../life-lock-2026-10-19/online-sources.md).
- [Counter card energy costs](../counter-cost-2026-10-19/online-sources.md).
- [BT6-014 EX-Evolve base, hand timing and stacking](../evolution-identity-2026-10-19/online-sources.md).

Usage v1 persists `oncePerTurn` and `limit`, including explicit unlimited.
Once-per-turn remains per skill/copy; Limit remains shared by master, card
number, face and skill. Declining an unpaid skill cost does not spend a use;
an activated effect choosing zero does. Captured usage survives loss of a
copied skill's granting effect. Combined ceilings and copied/granted Limit
identities without canonical identity remain explicit unsupported boundaries.

Validity v1 persists the bounded Sparking threshold, including explicit absence.
It gates occurrence/pending and rechecks before activation; an already activated
effect continues independently. The three Autos on BT6-003/004/008 previously
bypassed their thresholds. BT6-003 keeps its hand-only play trigger; BT6-007
keeps its separate Rest-Mode cost. Bond remains a separate metadata residual.

Fusion now projects existing stored `kind` into executable contexts and obtains
its canonical keyword identity from `kind: keyword` plus validated `cost.fusion`.
Materials, hand timing, price and saved continuations use those stored fields.
A misleading displayed Strike cannot grant keyword hooks or selector properties
from a blocked record. Native bare keywords remain owned by the pinned ruleset;
other paid keyword variants keep their named boundaries. No extra column is
needed for identity.

BT6-014's bounded EX-Evolve contract records hand activation and a base in its
controller's Battle Area: red Gogeta: Br with current energy cost six, including
the specified-cost floor. The existing two-red-hand discard payment and evolved
Auto remain separate programs. Printed ownership is not a base restriction;
the official control FAQ permits a borrowed card. Other evolution families and
extra-area permissions retain their separate boundaries.

Paragus's front skill pays its Life-to-hand cost before installing its turn lock;
the back's Permanent holds during its controller's turn. Both native and skill
movement enforce the same resolved-destination gate. Costs are refused before
charging; blocked Life-down loops terminate. Actual damage accounting requires
actual Life removal (manual §§1-13, 5-10), while Critical to Drop remains allowed.
Official BT6-063 Q7 confirms the Broly upgrade continues when its Life addition
is prevented. The existing pre-damage announcement checkpoint remains a
separate engine boundary.

BT6-060/061 now prohibit only Counter cards with current energy cost at least 2.
The shared reader includes cost changes and the specified-cost floor, separately
from skill price or a waived payment. Offers and direct saved-prompt activation
both recheck the restriction before charging. BT6-059/060 also receive the
previously omitted `ignoreBarrier` selector flag; Frieza still requires a
Barrier target rather than allowing any opposing Battle Card.

BT6-015's same-Leader Saiyan plus red/no-other-color predicate reads as one
mono-red Saiyan filter. Its own play ban applies outside the Battle Area, for
ordinary and skill plays. Independent KO immunity and Active-Mode Battle Card
attack permission remain separate. Malformed action insertions stay unread.
The compiler still refuses BT6-001 back #10's incomplete conjunction reading.
Its existing owner-corrected stored program is preserved and separately proved:
the discard can supply the final Vegeta in Drop; false turn/count effect conditions
still pay and consume Once-per-turn; both payoff effects and the Counter bound
remain gated together.

[The offline application plan](application-plan.json) admits exactly 63
compiler-owned records: 53 preserve their existing effect/condition/trigger/payment bodies while
adding typed metadata/payment format; ten have explicitly reviewed repairs
(two Barrier flags, two Life locks, two Counter bounds, three Fusion contracts,
one EX-Evolve contract).
No generic refresh may overwrite the four owner corrections.

The owner explicitly approved [the exact four-row metadata preview](protected-metadata-preview.json)
on 19 October 2026. The dedicated default-dry-run tool only adds usage/validity
and payment version/readable wrappers; it keeps every existing cost body,
effect, condition, trigger, reading, correction status and review field. Its
approved digest is `0a46676c2d9d7149968ab3fdc0d6e8b517e77b2121a6d2af97c075b937e192cf`.
One atomic full-row comparison refuses all pending writes if any reviewed row
changes. The original frozen catalog and 67-row export remain unchanged.

Focused validation covers 280 named both-seat scenarios across usage, Sparking,
Life lock, Counter costs, Fusion identity, exact Barrier targeting and the
protected Leader program and EX-Evolve. Separate checks cover mono-red predicates,
provenance mutations and guarded PGlite writes. Missing/malformed old records
and contexts explicitly require rebuilding. Current compiler drafts remain
unconfirmed; applying metadata adds no human confirmation.

Essential integrated validation, starter control preservation, deployment and
actual application are recorded separately below as they complete. The owner
requested focused testing: no full `npm test`, full `verify-arena` or local
production build.

The exact starter comparison caught a missing captured usage/validity snapshot
on native Dual Attack hooks. Those hooks now capture their executable metadata;
obsolete saved frames still require rebuilding. It also exposed a reporting
defect: a referee interruption closes the engine phase but is not a result.
The shared duel adapter and corpus classifier now report it as unfinished
instead of a completed draw, with private context excluded from public receipts.

The prepared stored-pair smoke check completed two games and reproduced two
illegal coupled Fusion material picks. The policy boundary had advertised a
conditional named-set choice as an ordinary independent two-card choice. It
must choose one currently offered material, then ask the engine for the narrowed
second pool. The repair changes that legality boundary only; card rankings and
policy promotion criteria are unchanged. The policy source hash is separately
pinned in the final starter comparison; original game and trace expectations
remain exact.

`arena-corpus-freeze --manifest-out <path>` now projects actual full duel metrics
through the existing versioned Testing & stats import contract. It captures
runner, fixture, program and RNG provenance, permits only an explicit custom
corpus protocol, and refuses to invent metrics for a crashed attempt. Historical
packs cannot supply omitted metrics. Raw game data stays local; recipe links
remain null and coverage progress is not automatically changed.

## Final pre-merge validation

The integrated typecheck and repository lint pass (five existing prototype
warnings, no errors); the final dependent-choice files also pass focused lint.
The 280 named rule scenarios, guarded metadata/PGlite checks, provenance
mutations, interruption/manifest proofs and existing evolution/language controls
pass. [Both previously illegal game seeds](dependent-choice-regression.json)
now finish normally on the exact prepared bundle. These are prepared-record
checks, not an actual production application.

[The final starter comparison](starter-control-comparison.json) preserves all
16 complete game records and trace hashes, all original executable fields,
catalog/deck/protocol inputs and ruleset/errata. It independently checks that
every policy file is byte-identical to the original except the exact reviewed
named-set legality condition and its comment. The resulting policy hash is
recorded rather than pretending the source stayed unchanged. Seventy-five
programs add only the enumerated kind/usage/validity metadata.

Production deployment, the 63 compiler refreshes, the four approved protected
metadata migrations, actual-export proofs, stored-pair games and supported
Testing & stats import remain separate operational steps.

## Actual deployment, application and qualification — #1071

[#1071](https://github.com/uhtred1986-lab/trading-card-management/pull/1071)
merged as `c015cc3038abcb6f57872d1d552e661e28bc14e8`. Production was ready
at 13:38:44 UTC on 19 October 2026. The guarded compiler writer refreshed exactly
63 records; the separately approved atomic migration updated only metadata on
the four protected corrections. Full-row comparisons preserve their programs,
readings, correction status and review fields. No human confirmations were added.

[Actual application receipt](application-receipt.json) pins the deployed revision,
writer receipts and complete [67-row actual export](stored-rules-after-application.json).
All 316 named actual-record cases pass, including the four protected records and
36 combo cases. The usage runner retains an old protected-row negative supporting
fixture; its rebuild warning describes that fixture, not the actual migrated row.

[The actual stored-program pack](actual-stored-pair-pack.json) admits both frozen
BT6 decks and completes all 16 both-seat games, with zero illegal, interrupted,
limited, crashed or other outcomes. Its four deterministic replay checks pass.
The engine, dirty-source digest, exact catalog/programs, seeds and policy hashes
are pinned. Original frozen inputs and the 16 historical starter controls remain
unchanged; completed games do not establish that every skill was exercised.

[Testing & stats receipt](testing-import-receipt.json) records supported importer
run 1 with exactly 16 results from [the allowlisted manifest](actual-stored-pair-manifest.json).
No recipe links, coverage progress or human confirmation were added. This closes
the bounded #897 selected-pair qualification/application acceptance. Next: #899
policy decision metadata under delivery-plan step 4; strategic holdouts and any
policy promotion remain separate, predeclared work.
