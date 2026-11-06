# R507 — six printed optional Energy Permanents

DB2-166/168/171/173/175/176#10 now compile through the existing exact reader into the native Energy-entry descriptor. The complete frozen card definitions, including their other Activate skills, are in `scripts/verify/fixtures/energy-admission-5.json`. All six normalized own FAQs are absent. BT1-052's own FAQ confirms that adding a card to Energy means face-up placement; P-656 has no normalized own FAQ.

The descriptor is whole, unpriced and unqualified, with an explicitly empty trigger list. It is consumed before the original arrival, never as an after-arrival Auto or a continuous Exhaust-negation effect. Static collection skips this specific whole descriptor. Record admission validates exact printed policy, condition, usage, validity and payment; mixed/wrapped/conditional/malformed forms remain unsupported even in draft loading. Native source validation also rejects nonzero or represented price metadata, missing payment, use ceilings, conditions and triggered descriptors without compiling printed text during movement.

Two distinct successful matching Drop-to-Warp movements earn the existing occurrence-stamped Exhaust negation. Parent movement actor and incoming Permanent payer actor remain separate. The source card still follows explicit requested Rest Mode. Moving out of Energy ends the stamp and restores normal Exhaust. No origin/procedure machinery was expanded.

## Evidence

`energy-admission-5.ts` has 220 source, saved-game and native gameplay controls. Each actual source uses `skillRecords` and `rulesFromRows`; no source descriptor is injected or its unsupported list cleared. All six records roundtrip through the DSL. Tests reject all represented price/usage/validity qualifiers and stored native corruption. The existing reader suite migrates only its six positive assertions from preparatory blocked status to this intended admission; all near misses remain.

All six × both seats use real Charge with accept, decline and partial payer movement. Every action serializes/restores the match, checks input immutability, and renders both board views. Owner-only responses, unchanged Exhaust before arrival, no incoming Permanent skill-activation event, one arrival, actual payer destinations, exact epoch/source/master stamp and stamp expiration are asserted. No-payer controls decline into Rest normally.

Actual full paid Objection and full P-656 blue hand activation followed by the yellow paid Auto run for both seats and both accept/decline. Both energy payments are asserted Rest. Whis targets the other owner's Battle card, parks its own parent while the owner chooses payers, and always requests Rest even with the earned stamp. Objection reaches the Drop and its ordinary Energy movement reaches Active when payment succeeds.

Additional Hand/Deck/Warp/Z-Energy/Battle origin cases use explicitly labeled independent structural movers with an actual compiled DB2-175 source. Eight live Combo cases use actual Hand/Battle Combo entry in Offense/Defense for both turn seats, then the independently printed fixture Leader movement. These are runtime route proofs, not claims that the structural movers are catalog cards. Existing larger Energy suites retain their independent negation/protection/ABA/ordering coverage.

## Remaining bounds

Only one ordinary owner-held BATTLE source, without Hidden/under cards, Z/token identity or controller loan, is supported by the bounded original script procedure. Battle supports native own or opposing Activate/Auto movers. Combo requires an intact active battle/flow, recorded Hand/Battle origin and no endCombo stage. Charge requires the ordinary untaxed declaration. Costs/proofs, incoming replacements, batch ordering, specialized/direct non-script entry, relevant unproven copied/granted history and source/arrival protection disagreement still refuse explicitly. Selected payer replacement questions remain bounded before payment. Life and incoming Drop are not enabled. Incoming-Drop self-payment is a distinct unanswered owner ruling; no assumption was made.

Admission is therefore readable and executable along the proved routes, not universal six-card completion. `runtimeSupportOfRow` records the remaining board-dependent boundary as unknown. No database writes, dependencies, general framework or broader movement rewrite are included.

Validation: new source/native suite 220; reader 21; stored-descriptor preflight 155; existing Charge 126, opposing mover 434, Combo 1,124, Battle 726 and arrival-negation 120 pass. Final price-contract changes rerun the source/native and preflight suites. TypeScript, targeted lint, and 279-ruling validation pass.

The frozen 6,597-card catalog produces 13,965 complete records (13,018 readable / 947 unread). Exactly DB2-166/168/171/173/175/176#10 differ from the prior blind-Life snapshot: ops, trigger, reads and pattern. All other 13,959 complete records, including each source's other skills, are identical. Readable totals stay unchanged because these six were already readable but runtime-blocked. Artifacts are `/workspace/shared/arena-support5/recovery/energy-admission-full.json` and `energy-admission-delta.json`; root independently verified the same six-record diff. No compiler changes occurred after this snapshot.
