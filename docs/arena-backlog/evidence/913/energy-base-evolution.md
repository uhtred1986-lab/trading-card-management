# Energy-area evolution evidence (#913)

## Sources and interpretation

Official Masters manual sections 22-5-2-2, 22-5-3-1-1 and 22-5-5, plus official DB3-027/030/033/035/037/039 card Q&A, establish the shared capability. The evolving card is used from hand; its specified Battle Card may instead be chosen in energy. At resolution, preliminary base placement causes no area-movement Auto or additional counter timing; normal stacking and final play remain shared. The printed Active Mode override applies to this energy-base path. Ordinary Battle-base evolution retains mode/power semantics. This capability does not extend the evolving card's source area (#917 is separate).

Printed costs remain payable before resolution. An active selected energy base remains energy during payment and may be rested to pay one orb; payment does not change its area or identity. Preliminary area entry clears old area-bound power effects. Final Active Mode placement is not a Rest-to-Active switch of the underlying card. Counter instructions to play the new card rested retain priority.

Official sources: <https://www.dbs-cardgame.com/pdf/rulemanual.pdf?ver_4.00>, <https://www.dbs-cardgame.com/us-en/rule/game_faq.php>, <https://www.dbs-cardgame.com/us-en/rule/card_faq.php>. No DB3-042-specific Q&A entry was found.

## Reading delta

Live `arena:readings -- --unread` and `arena:tally` failed before edits with ECONNREFUSED to the feed. An isolated read-only public catalog snapshot was compiled before and after instead: 6,552 Masters records, 17,327 front/back skills. Exactly seven outputs change: DB3-027/030/033/035/037/039/042, front skill20. Unsupported clauses decrease from 3,354 to 3,347. Each complete Permanent now reads:

> this card's [Evolve] skill used from hand may choose its specified Battle Card from your energy; that energy-base evolution plays this card in Active Mode

The public full printed fixtures are in `cards.json`. Runtime evolving-card fixtures deliberately project only actual EX-Evolve and complete Permanent lines, leaving unrelated skills outside this capability proof. No stored program, status, owner record or catalog text was changed.

## Runtime evidence

The registered verifier covers both seats; rested/active energy bases; exact blue payments including selected energy as payer; Nappa's single payer/base; wrong controller/type/colour/character/cost/area/source; no permission or payment; ordinary mode/power stacking; preliminary clearing of energy buffs; selected-base removal, mutation and leave/return identity; serialized payment/choice/counter boundaries; normal counter replacement including Rest Mode; final play/evolution/from-hand Autos; and snapshots/policy answers without opposing hand identities.

Six named official negatives pass. Five actual compiled base Autos have genuine positive controls. A supported compiled placement Auto activates under normal movement and does not activate under preliminary movement; a Battle-area watcher fires only for the new top card. This establishes causal suppression independently of the unavailable named Bardock positive.

**Remaining dependency:** TB3-019's existing complete Rest-to-Active Auto has no trigger and incorrect effects/chooser. [#922](https://github.com/uhtred1986-lab/trading-card-management/issues/922) tracks its repair and genuine exact positive. Its negative alone is insufficient proof and is not presented as such. DB3-031's positive exercises only the supported Drop retrieval branch; its unrelated missing Unison-area alternative is not certified here. Issue #913's original exact-positive acceptance remains open.

## Validation

Node 24, with `DATABASE_URL` unset: typecheck passes; lint passes with the five existing prototype warnings; production build passes; focused #913 and #825 regressions pass; regenerated contract engine run passes 92/92. Contract deltas are limited to the new permission enum/documentation and the Evolve choice probe digest. A local projected-fixture 40-game fuzz campaign completes 40 games with zero interruptions, action limits or crashes; seed913 replay exactly matches the original completed game at112 actions. These isolated projections do not establish full-catalog or actual-deck playability. The complete `npm test` chain passes, including PGlite rule review/saved games, policy privacy, offline recovery and final response-window checks. No UI layout changed; behavior is in compiler/runtime data, so screenshots would not validate this change.
