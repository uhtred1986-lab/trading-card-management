# R426 — Original movement completion before an if-you-do continuation

RM 20-16-1 makes the preceding action a necessary condition. RM 20-17-1 distinguishes failure even to perform part of that action. Choosing a card is not evidence that the following movement completed. RM 9-10-3-1 explicitly distinguishes a replaced voluntary action from the original action. Token Q&A 5 and BT2-014/033/087/102 state that tokens are not placed in Drop: they are removed instead. RM 19-1-7, 14-1-4 and 16-1-4, and BT20-007/025 and BT28-048/049/050/109/123/124/131/134's Q&As support the corresponding token/Z negative controls. RM 14-1-4-1 preserves the attribution of removal to its effect, not fulfillment of a different destination.

The compiler retains an optional one-card chooser, then binds `moveTo.completedAs` and reads `Cond.moved`. The VM freezes the original selected occurrences and records the actual native movement result before independent movement hooks run. Prevented movement, substitution, a redirect even to the same destination, and rule-normalized removal fail the original-action condition. Empty selection is false. A failed Turles substitute can still resume and complete the original un-replaced departure. Saved frames retain this witness, and a card that leaves/reenters while a replacement prompt is pending is not moved as the original selected occurrence. Typed multi-card results distinguish minimum completion from all-selected completion; compiler lowering remains one-card only.

This batch only lowers an adjacent choose → move → if in the same final emitted body. An early full scan exposed 22 extra provisional annotations in conditional/delayed cross-body or unread-tail shapes; final normalization removes those, so an unexecuted branch cannot accidentally read a missing witness. The five modal hinges use the same adjacent contract. Under/on-top placement, composite P-129, and cross-body condition/delay fidelity remain explicit follow-up. P-129's existing choice-only action hinge is now a deliberate stored runtime refusal in every status, not a claim of completed support.

Old affected stored rows require rebuilding in draft, confirmed, or corrected status (open already refuses). Old saved affected continuations, including a previously spliced if tail, interrupt with `NotYet` before further movement. The unchanged `IllegalAction` class moved to a leaf module so `NotYet` keeps its shared instanceof identity without a compiler/VM import cycle. Unrelated saved draw frames remain usable. The new schema field and condition round-trip through the rule language; both direct language fixtures and the classification table are updated.

## Full record review

Frozen offline catalog: 6,597 cards / 13,964 skill records, 12,961 read / 1,003 unread before and after on this worker's baseline. Exactly **102 records** change. Every complete record was compared: **100** change only `ops`, `pattern`, `reads`; **2** already-unread records change only `ops`, `reads` (`P-068#0b`, unread non-black filter; `BT11-064#20`, unread opponent Battle choice). Their existing gaps remain. Every other field is identical, including print, cost, conditions, trigger, usage, validity, combo metadata and unread clauses. For every changed program, removing only `completedAs` and replacing `moved(var, all:true)` with the prior `chose(var)` produces the exact old program. Thus selectors, sides, cardinality, choice visibility, destinations, order and later tails are unchanged. Each changed print was reviewed against that exact local hinge; no whole-card or privacy expansion is inferred from this result.

Full before/after records and all changed fields are retained at `/workspace/shared/arena-support5/triggers-r426/` (`before-full.json`, `after-full-final.json`, `full-diff-final.json`). SHA-256:

- Before: `e9ea1178b12b76d1bae4d7059859cb929a5b5c26bd8eef2a59b397a7079d1607`
- After: `ddf034c198942dd5b502d5fa604305e4a31386bc09bc35da490594a2e016b77e`

All changed records, grouped by the movement whose completion is witnessed:

- **deck (10)**: `BT11-005#10`, `BT11-054#10`, `BT11-065#10`, `BT11-097#10`, `BT11-130#10`, `BT13-018#20`, `BT13-022#20`, `BT13-025#20`, `P-295#0`, `P-296#10`.

- **drop (60)**: `BT10-062#0`, `BT11-030#0`, `BT11-060#0`, `BT11-061#20b`, `BT11-064#20`, `BT11-090#0`, `BT12-058#10`, `BT12-118#0`, `BT12-126#10`, `BT14-142#10`, `BT15-043#20`, `BT15-058#0`, `BT17-034#20`, `BT17-057#10`, `BT19-069#30`, `BT4-008#0`, `BT4-024#0`, `BT4-072#0`, `BT6-002#10b`, `BT6-026#0`, `BT6-031#10`, `BT6-078#0`, `BT6-079#0`, `BT6-094#10`, `BT7-010#10`, `BT7-017#0`, `BT7-031#0`, `BT7-036#0`, `BT7-063#0`, `BT7-087#0`, `BT7-115#40`, `BT7-116#40`, `DB3-076#0`, `DB3-080#0`, `DB3-102#0`, `DB3-114#0`, `DB3-134#10`, `DB3-140#10`, `DB3-141#0`, `EB1-30#10`, `EX03-01#0`, `EX03-19#0`, `EX06-03#0`, `EX06-26#10`, `P-022#20`, `P-068#0`, `P-068#0b`, `P-073#10b`, `P-130#10`, `P-131#20`, `P-133#10`, `P-146#0`, `P-152#10`, `P-238#10`, `P-244#20`, `P-249#0`, `P-435#10`, `SD9-01#0b`, `TB3-034#0`, `XD1-08#30`.

- **hand (23)**: `BT1-014#0`, `BT14-074#20`, `BT3-075#0`, `BT4-012#0`, `BT4-048#0`, `BT5-036#0`, `BT6-089#0`, `BT7-027#0`, `BT7-099#10`, `BT7-105#0`, `EX03-12#10`, `EX06-24#0`, `P-023#10`, `P-069#10`, `P-071#0`, `P-072#0`, `P-092#0`, `P-222#20`, `TB2-024#0`, `TB2-042#10`, `TB2-061#0`, `TB3-057#20`, `XD1-07#0`.

- **life (7)**: `BT12-002#10`, `BT12-003#20`, `BT12-106#10`, `BT15-094#10`, `BT15-108#0`, `EX19-17#10`, `P-328#20`.

- **warp (2)**: `BT16-093#10`, `EX15-05#10`.

The four under-placement candidates are `P-624#10`, `P-327#20`, `BT15-129#10`, `P-349#10`. Cross-body examples deliberately unchanged include `BT8-033#10`, `BT10-126#0`, `TB3-033#0`, `BT22-133#10`, `P-160#0`, `TB3-018#10b`, `TB1-039#10`, `P-144#0`, `TB2-005#20`, `P-127#0`, `TB1-013#0`, `EX23-50#20`, `BT6-022#0`, `EX03-23#0`; unread cross-body/absent-tail cases remain unread.

## Proof and next dependencies

`movement-result-5.ts` passes 52 cases and covers actual stored TB2-024 attack Autos in both seats with zero/one choices and JSON reload, native saved legacy-frame interruption, typed native movement counts, stale chosen occurrences, same/different-destination installed redirects, token/Z normalization, movement prohibitions, reload at an optional replacement prompt, all-status old-row rejection, apostrophe/negative hinge spellings, malformed/unsupported witness contracts, language roundtrip, modal records, and branch-not-taken controls. Direct state movement, typed effect installation and malformed-save edits are explicitly fault controls, not claims about an actual responding card. `replacement-auto-5.ts` adds four both-seat chooser/move/if-do cases through the real Turles replacement Auto and failed-play fallback; it now passes 53 cases. Tax26, shared-scope94, did-may, language, capabilities, rulings, TypeScript and changed-file lint also pass.

Next, in order: strict action-price result/provenance (ordinary cost wrappers still judge some results by final area; Combo-cost substitute activation needs proof), the four under-placement witnesses, composite P-129 and conditional/delayed cross-body continuations, then mixed future-card Counter continuations. R426 does not claim those paths repaired.

Compatibility follow-up: all suites naming the affected card IDs, plus `readings`, `readings-571`, `lang`, and `teach`, pass. `wordings` runs after its documented `keywords` fixture predecessor. The old BT7-017 modal assertion now expects completed movement; four direct Battle-card Counter expectations in `opponent-leftovers-907` and `phrasing-batch-3` were refreshed for the already-landed R422 qualifier. No compiler/runtime changes accompany these fixture repairs. The named P-129 proof uses its full print and actual skill index 10 in all three executable review statuses.
