# Union residual evidence matrix — 19 October 2026

This reconciles the dated 15 October inventory with delivered code and recorded
applications. It does not rerun tests, query the database, certify all 229 cards
or close #923/#929/#930. Current reconciliation baseline: merged #1087 (`cf81bef6`), following the
separately applied #1083 Absorb, #1084 Potara and #1085/#1086 Fusion batches.
The #899 strength experiment completed inconclusively and is outside this audit.

## Evidence levels and three separate contracts

“Supported with proof” below means the named verifier/receipt's bounded scope.
A printed-line fixture, a compiler-generated stored record and an actual deployed
record export are different evidence. A completed deck game does not prove every
skill executed. Preserve the [original inventory](README.md), [exact text index](cards.md)
and [official reference index](official-references.json) as dated source material.

| Family / responsibility | Supported with proof | Still unverified or unsupported |
|---|---|---|
| **Fusion:** named/equal-power Battle materials, source permissions, payment order and entry | #925 exact-set/per-name controls; #541 Battle/Drop scenario; #924 Warp permissions and ordinary-play route; #926 action costs; #1067 material-before-additional-payment checkpoint; #1068 typed material contract. #1071 adds recorded Fusion identity and saved-context guards for actual BT6-012 front#0, BT6-013 front#0 and BT6-015 front#10. | #1085/#1086 add the conditioned EX23-36/P-519 Drop-to-bottom permission, with 116 actual-record cases for exactly two activation/support pairs. This is not all Fusion cards or all modifiers; combinations with Warp/Areas destinations remain unsupported. Preserve the owner-approved #541 printed-power interpretation; no new power ruling is inferred here. |
| **Potara:** named Battle set, extension transfer, stack order and carryover | #927 proves exact selection, Active entry, selected order/piles, power carryover and source extensions for the named fixtures. #930 proves energy/Warp extension paths; #926 covers printed action costs; #928 compound keyword declarations remain delivered. | #1084 establishes typed identity/material/source authority for BT2-012/front/0 rule10297 v2, with 76 actual-record cases. That bounded record and the older source/stack fixtures do not establish current admission for every Potara card or all extension combinations. |
| **Absorb:** in-play source, printed cost/effect, target/onto and entry | #930 covers errata-correct BT3-070, BT3-048, BT17-067 and under-Leader cost BT14-079 through stored-row/reload fixtures. #929 covers generic host invalidation/failed entry. BT3-070's two reference records have historical application evidence. | #1083 establishes typed native identity/source authority for BT3-070/front/0 rule6416 v10, with 66 actual-record cases. This is not all Absorb records. BT17-082 substitution is not proved by BT14-079's different printed under-Leader cost. BT4-018's indexed binding issue and other named support clauses require exact current-source classification. |

References: [#925](../../../../scripts/verify/union-exact-sets-925.ts),
[#541](../../../../scripts/verify/union-areas-541.ts),
[#924](../../../../scripts/verify/gogeta-warp-924.ts),
[#926](../../../../scripts/verify/keyword-action-costs-926.ts),
[#927](../../../../scripts/verify/union-potara-927.ts),
[#928](../../../../scripts/verify/union-compound-928.ts),
[#929](../../../../scripts/verify/union-counter-929.ts),
[#930](../../../../scripts/verify/union-sources-930.ts),
[typed payment/checkpoint/material matrix](typed-payment-907.md),
[#1071 receipt](../907/typed-use-validity-2026-10-19/README.md).

## #923 remaining acceptance

| Acceptance | Reconciled evidence | Remaining acceptance |
|---|---|---|
| Versioned supported/unproven/wrong/unread matrix | This matrix replaces the old claims that Counter windows, exact-set selection, Potara carryover, grants or action costs are wholly unimplemented. Closed #924–928/#934 and validated #932 remain delivered. | The full 268-record index is not a current-runtime certification. Every remaining indexed clause still needs a source/skill-specific disposition; keep this audit open. |
| Official FAQ/errata/source mapping | The original official index maps 54 matching FAQ headings and six errata IDs. #934 corrected five outdated catalog texts; BT5-120 was already correct. Fresh #1068 official checks establish EX23-36/P-519 Drop-to-bottom wording, with no located power waiver, and BT17-082's Absorb-only scope. | No new ruling is supplied for the unproved modifier combinations. An absent card-specific FAQ is recorded as absence, not permission. Preserve labelled existing owner guidance in #925/#927/#929. |
| Source/material/payment/stack/trigger/Counter/reload/privacy | Bounded family proofs above cover these concerns individually. #929's suite covers both seats, JSON answers, paid costs, first/second windows, returned/dropped replacements, missing hosts/materials and one-place invariants. | Full printed-card/stored-row cases across all three families, source-extension combinations, Union-specific Counter chains and all indexed triggers are not established by the synthetic suite. Separate Counter-chain proof does not automatically certify its Union composition. |
| Ordinary energy-cost play remains separate | #924 proves P-286 ordinary play costs six without Fusion materials, alongside the three-energy Fusion route; printed prohibitions remain respected. | Do not generalize this to all restrictions. P-069/P-226's full printed restrictions still need exact supported/unread/proven classification. |
| Application independent of code | Dated applications are listed below, with #1071's actual BT6 exports separated from older reference records. | The dated read-only assessment below precedes the eleven-row metadata application and exact one-row Absorb repair. Later actual receipts supersede those specific blockers; no blanket repeat refresh follows. |

## #929 residual Counter/failed-entry acceptance

**Delivered:** #1017 (`0455167d`), `union-counter-929.ts`. Generic Fusion, Potara
and Absorb fixtures cover offered windows before/after landing, decline,
non-replacing Counter, return-to-hand/Drop replacement, costs remaining paid,
Deflect, invalidated materials/host, no false arrival and JSON reload on both
seats. #927 separately covers Counter interaction with its Potara extensions.
These are useful semantic proofs; the fixture IDs are not complete printed cards.

**Unverified:** full printed-text/current stored-record cases for each family
and applicable extension; Union-specific Counter:Counter chains; the complete
privacy boundary of all extension/failure combinations. Preserve #929's labelled
owner guidance for already accepted ambiguous destinations instead of silently
reinterpreting it. [Counter-chain #552](../../../../scripts/verify/counter-chain-552.ts)
is separate evidence, not proof that every Union composition ran.

**25 Oct addendum (#929 rescope):** bullet 1 is narrowed to the applied records
(BT3-070 f#0, BT2-012 f#0, BT11-013, P-360 back#0, BT6-012/013 f#0) and the Union
Counter:Counter composition is now proved on them by
[`union-counter-records-929.ts`](../../../../scripts/verify/union-counter-records-929.ts).
Per-bullet mapping and the gate/glossary review: [929.md](../../929.md). The
"Unverified" paragraph above and the line below are the 19 Oct state, kept for history.

Keep #929 open. Do not reimplement its delivered windows or failed-entry machinery
because the 15 October matrix still says unsupported.

## #930 named support residuals

| Indexed card / face / skill | Current evidence classification |
|---|---|
| P-360 back#0 | **Supported with bounded fixture proof:** granted Fusion, typed grant price/materials and saved contexts in #930/#1066/#1068. The historical readback preserved v4; the approved metadata-only application advanced rule12065 v4→v5 and restored loader admission while preserving the existing body. Existing actual-export Fusion material/payment proofs pass; no new grant behavior is claimed. |
| BT17-082 back#0 | **Unread/unproved support family:** substitution from under the Leader for Namekian Absorb payments; not Fusion and not identical to BT14-079's existing cost. |
| EX23-36 front#20; P-519 front#20 | **Supported with actual-record proof:** #1085 implements the conditioned Drop-to-bottom permission; #1086 records the separately approved four-row application. Support IDs3898/9888 are v6 draft; activation IDs3897/9887 are v3/v2 draft. All stored fields match the approved plan and116 actual-record cases pass, including private order and strict payment/source guards. No equal-power waiver or whole-card qualification. [Bounded evidence](../907/fusion-drop-bottom-2026-10-19/README.md). |
| BT28-079 back#0; BT31-042 front#0; BT31-043 front#20; EX23-11 front#10; EX23-29 front#10; EX25-11 front#10; SD19-04 front#20 | **Unverified exact indexed reductions:** standing/next-use conditions, payer, expiry and qualifying variant must be mapped to existing typed cost primitives and specific proof. The dated unread labels alone do not establish that current code is still wrong. |
| EX13-14 front#0/#10; SD19-03 front#20 | **Unverified exact search/support clauses:** existing generic selection is not a complete per-card execution proof. Preserve exact source wording and binding in the reconciliation. |
| P-069 back#10; P-226 front#0 | **Unverified full restriction semantics:** distinguish ordinary play, Fusion, other Union variants and printed conditions. Do not silently ignore the indexed remainder or treat a clean prefix as whole-skill support. |
| BT5-037 front#10; BT6-036 front#10 | **Unverified complete Union-used condition/payoff cases:** BT5-037 is an Activate effect with a prior-Union-play condition; BT6-036 is an on-play Auto with an additional draw. Generic keyword activation moments are not proof of successful “played using Union” qualification, Counter failure and the full printed payoff. |
| BT17-077 front#0 | **Historical unread target/onto word order:** no new current-source runtime proof identified by this audit. Needs precise classification, not a repeated blanket implementation. |
| BT28-012 front#0 | **Source correction delivered:** #1019's application receipt explicitly records catalog correction. The old “the shuffle” inventory text is dated; current whole-line/readback/admission is not proved here. |
| BT30-064 front#10 | **Historical unread granted-Absorb tail:** quote/source boundary and complete grant/cost/target execution remain unverified; no automatic extension of P-360's Fusion grant proof. |
| BT4-018 front#0 | **Supported in code, pending owner record application (25 Oct 2026, branch `claude/930-bt4-018`).** Owner ruling on #930: the placed material is a new card once under this card, so its **printed** character names apply. The price binds `choose … as c0` → `moveTo under`; the deck search carries `sameCharacterAs: c0` (`compile/targets.ts`, `vm/program.ts`), and the Absorb cost's names now reach the effect (`vm/keyword-costs.ts`). Proof: `scripts/verify/absorb-placed-name-930.ts` (printed match, multiple names, gained name ignored, no match, optional decline, effect-side Leader condition, both seats, stored-row reload). The live `card_rules` row is not refreshed; the owner applies the recompiled record. Earlier note: the dated inventory's clean parse searched the wrong area (cards under this card); that reading is not restored. |

Existing positive #930 controls must remain distinct: BT3-070/020/022 required
Android pair wording; BT3-048 hand-under-source; BT17-067 conditioned Namekian
cost; BT14-079 under-Majin-Leader cost; BT10-046/053/P-220 energy permissions;
BT10-132/P-230 Warp permissions; EX25-32/P-308 Fusion Warp wordings. Several
fixtures deliberately simplify surrounding printed clauses. Their assertions
cannot close unrelated full-card acceptance.

## Application and source revision boundaries

| Receipt | Proven scope | Current limit |
|---|---|---|
| [18 October #907 application](https://github.com/uhtred1986-lab/trading-card-management/issues/907#issuecomment-6247494085) | #1017:52 Absorb lines applied, two unread held. #1019:eight refreshed,16 already current, BT4-018 unread, BT28-012 source corrected. #1022:BT20-125 front#20 and BT24-112 back#0 applied. | Dated application counts, not today's complete typed admission or all-Union coverage. |
| [#934 official errata application](https://github.com/uhtred1986-lab/trading-card-management/issues/934#issuecomment-6242586467) | Corrected BT2-015, BT22-137, BT3-070, BT4-108 and P-360 source text read back; compiler-owned changed rows redrafted; protected rules preserved. | #934 is closed despite the old local issue file still saying open. Do not repeat the errata implementation/sync. |
| [#1067 reference application](../907/fusion-checkpoint-2026-10-19/application-receipt.json) | Eleven actual draft rows: BT11-013 front#10/#20/#30; BT3-070 front#0/#10; P-360 front/back#0/#10/#20. | No human confirmation added. This predates the new usage/validity contract. |
| [#1068/#1069 material application](../907/fusion-materials-2026-10-19/application-receipt.json) | Exactly BT11-013 front#10 and P-360 back#0 refreshed v3→v4; actual exports pass material/payment replay. Other nine reference rows unchanged. | Fresh readback below finds all eleven usage/validity fields null; the historical effect/cost/reading bodies remain exact. Migrations0059/0060 added nullable columns without migrating these records. |
| [#1071 actual application/qualification](../907/typed-use-validity-2026-10-19/README.md) |63 compiler rows plus four approved protected metadata migrations for the frozen BT6 pair; actual 67-row export,316 named cases and16 completed stored games with replay. Actual Fusion identity proof covers BT6-012#0, BT6-013#0, BT6-015#10. | These67 rows do not include BT11-013, BT3-070 or P-360. They cannot certify the older11reference rows or other Potara/Absorb/support cards. |

## Historical eleven-reference readback — 19 October, 15:16 UTC

The coordinator obtained the current three catalog definitions and eleven raw
reference rows at 15:16:19 UTC. The [public assessment receipt](reference-readback-2026-10-19.json)
contains only allowed identifiers, versions, metadata, blocker labels and hashes;
private review payloads and raw rows are excluded. This offline assessment did
not contact the database or execute games/tests.

All eleven rows exist, match current printed sources, remain unflagged compiler
drafts and retain valid CostRecords. Their public program/cost/trigger/condition/
reading/status bodies exactly match the historical reference export and their
persisted executable fields match current `skillRecords` output. Comparing the
persisted representation avoids false drift from compiler condition hoisting.
BT11-013 front#10 already has canonical recorded Fusion identity/materials;
P-360 back#0 already has the current typed Fusion grant.

Actual `programProvenance` normalization rejects all eleven for missing typed
validity. Direct real `rulesFromRows` inspection independently reports both
missing validity and missing usage on every target. These are physically present
obsolete records, not missing cards or evidence of changed effect semantics.

An **offline projection changing only usage and validity** admits all eleven
through normalization and the real loader, preserving costs, kinds, operations,
triggers, readings, statuses, versions and all other raw fields. Validity is
`{version:1,sparking:null}` throughout. Usage is version1 with no Limit; only
P-360 front#10 and back#20 have `oncePerTurn:true`. This is a proposal assessment,
not an application or fresh semantic execution proof.

Strict authoritative provenance accepts ten of the eleven projected target
records. BT3-070 front#0 still derives its Union Absorb activation/material
contract from printed text at runtime; metadata admission does not close that
separate authority gap. Potara is outside these eleven rows. The additional
native Deflect manifest line is not a twelfth stored target.

## Approved application and actual admission

The owner explicitly approved the separate eleven-row digest
`75e82837c5c2b9f4cbc881719c45c38fffcea6d6d9eda593ebce400ab730bdaa`.
The [application receipt](metadata-2026-10-19/application-receipt.json) records
exactly eleven writes and the 15:33:45 UTC readback. Independent offline raw-field
comparison confirms only usage, validity, version and update timestamp changed;
all costs, combo contracts, programs, readings, source/status and private fields
remain exact. All eleven remain compiler drafts; no human confirmation occurred.
The separately approved #825 eight-row scope is not included here.

[Actual admission](metadata-2026-10-19/actual-admission.json) confirms normalization
and real loader admission for all eleven, with ten fully authoritative target
records. BT3-070 front#0 retains its native Union-Absorb activation/material
text dependency. [Actual reference export](metadata-2026-10-19/actual-reference-records.json)
passes both existing `fusion-materials-907.ts --reference-records` and
`typed-payment-907.ts --reference-records` proofs. Their exact target scopes are
nine material records and three payment records respectively, with other lines
explicit compiled support; these are not eleven-card or whole-deck execution
claims. [Safe stored export](metadata-2026-10-19/actual-stored-export.json) and
[preflight](metadata-2026-10-19/preflight.json) retain the bounded application pins.

## Latest bounded deliveries and next single action

PR #1083's [Absorb contract and application](../907/absorb-identity-2026-10-19/README.md)
close the native identity gap for the exact BT3-070/front/0 reference only.
The owner separately approved digest512b924a…; rule6416 is now v10, with all
existing bodies/private fields preserved and 66 actual-record cases passing
on the deployed engine. The older ten-of-eleven admission result above remains
a dated pre-identity observation, not today's blocker for that exact row.

PR #1084's [Potara contract and application](../907/potara-identity-2026-10-19/README.md)
cover only BT2-012/front/0 rule10297 v1→v2. Its actual stored record passes76
scenarios on deployed418d2065, including native five-energy entry and ordinary
seven-energy play; the other two stored lines remain excluded.

PR #1085's code deployed at `ca988c9e`. The owner separately approved digest
`f3b8068dc937ebedfd0c4eb0181ca91fdbb7a2c19e0a33e4304803aa2cadf0af`.
PR #1086 records the [four-row application](../907/fusion-drop-bottom-2026-10-19/application.json)
and exact readback. The safe actual export equals the proposal, every stored
field matches the approved plan, and116 actual-record scenarios pass. No human
confirmation was added. This repair is complete and must not be repeated.

PR #1087 repairs the diagnostic gap that earlier #1084/#1085 receipts correctly
reported as an unchanged #926 failure. The original verifier now passes without
any oracle changes; [42 identity cases and116 actual-record controls](../907/unread-fusion-diagnostic-2026-10-19/README.md)
preserve execution refusal, stored authority, native-hook suppression and privacy.
Historical failure receipts remain unchanged.

**Next single action:** freeze and classify BT4-018/front/0's comparison against
the material actually paid under its Absorb source. Current `compile/targets.ts`
explicitly refuses the missing relation rather than searching the wrong area.
Recheck official wording and source/record identity before proposing a typed
paid-material binding and complete persisted/VM proof. The
[three-case source audit](next-absorb-boundary-2026-10-19.md) separates BT17-082's
under-Leader substitution and BT30-064's temporary grant as different gaps.
No further nineteen-row migration, whole-card/deck qualification or broad catalog
refresh follows. Keep #923/#929/#930 open for their remaining indexed acceptance.

Audit method: read current merged source, existing committed verifiers/receipts,
and public GitHub bodies/comments for #923/#929/#930/#934 on19October. The first
three have no comments and no blocked/owner-ruling labels. The followup uses the
coordinator's read-only snapshots, approved application receipts and pure offline
raw-field comparison. No code was changed and no tests/games/database query or
ongoing holdout result was used by this independent audit. Runtime proof outcomes
above are the coordinator's separately collected actual-export results.
