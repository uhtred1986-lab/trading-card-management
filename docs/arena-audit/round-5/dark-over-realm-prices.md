# R456 — Over Realm cost phases and exact Dark arrivals

This batch supports BT27-100#10 and BT27-102#0's complete Dark Over Realm price: a Mechikabura Leader, the native whole-Drop payment, one black skill orb, and drawing one card. It also corrects the shared ordinary/Dark procedure needed to execute those stored prices faithfully. Putine's separate watched-other-card Auto remains unread.

## Sources and interpretation

RM 1-6-3 orders multiple actions in one skill cost from the beginning of the text; 1-6-5-3 includes keyword-referred text. Current manual 22-15-4 and 22-23-4 expressly make the entire Drop-to-Warp movement a cost. Thus the native procedure pays applicable additional play taxes, rechecks its Drop threshold, pays the whole Drop, determines/pays the following printed resources on that board, and completes the admitted draw before announcing activation or spending usage. RM 5-8 preserves already completed payments when a later cost fails.

BT31-093's own FAQ explicitly requires its added three-card payment before rechecking the Over Realm threshold. A player can legally pay black cards for that tax and then fail the Dark threshold; the tax stays paid. BT31-150's own FAQ calls Drop-to-Warp a cost and rejects activating a source still in Drop before that movement. Its printed Warp permission applies only to the original Warp occurrence. General Dark Over Realm Q&A confirms hand/Main, the entire Drop (not only black cards), and shared usage; Wormhole permits the combined second use but never a third.

The older BT1-107/110 Q&A describes the preliminary Counter window before Drop-to-Warp. That conflicts with the current manual's express cost classification. Following `docs/arena-batch-process.md` source priority, this batch follows the current manual and records the conflict rather than citing those answers as agreement.

Dark Over Realm does not have ordinary Over Realm's end-turn departure. Ordinary cleanup is now scheduled only after successful arrival and bound to that arrival's versioned unique token. It survives later skill negation but cannot Warp a fresh occurrence after departure/reentry or after an unsuccessful play. Native reproduction of the prior fresh-occurrence bug is retained in `native-cleanup-repro.log`.

## Implementation boundaries

The native cost continuation stores the declaration source, paid tax identities, unpaid Drop/energy/tax payer occurrences, and strict payment stages. A tax identity includes its typed rule and, for standing rules, source occurrence; timed effect IDs retain their own lifetime. The full affordability proof uses the same tax/Drop/resource/action order without mutating the real board. New taxes appearing before play, including during the preliminary Counter window, run on a strict separate continuation. Failure stops only that play; already paid activation/resources remain spent. General non-OR play-tax behavior is unchanged. A narrow card-local OR return token follows only effect-carry paths (Battle/Unison to Battle/Unison/Combo, Combo to Battle), survives control changes, and is deleted on a true departure or becoming an under-card. Delayed cleanup validates the token and can find either controller while sending the card to its owner's Warp. This is not the general R454 movement-lifetime fix.

The descriptor census contains 121 native OR/DOR rows, 23 Dark. None requires supplementary Burst, marker, life, or pooled native resources; such additional shapes are explicitly refused. The admitted printed action is exactly a single own draw of one on Dark Over Realm. No generic action-price admission was added.

Arrival identity is distinct: `playedUsingDarkOverRealm` and `using: "Dark Over Realm"`. DB3-109's own Auto listens to both printed procedures; BT13-154's own Auto listens only to Dark. The four existing readable `playedUsing(...Over Realm)` conditions all print ordinary Over Realm, so no condition was silently broadened.

## Offline record evidence

Input: recovered public catalog, 6,597 cards, SHA-256 `d3646487f34749d905a65b2473f21aee7984e4aac640c631bc0deb319e512bfb`. This is not claimed byte-equivalent to the lost original input.

Comparison against the R455 snapshot changes exactly four fields across four records:

- BT27-100#10 and BT27-102#0: `cost` only.
- DB3-109#20 and BT13-154#30: `trigger` only.

All other full-record fields are identical. Totals remain 12,988 read / 976 unread because the two newly executable prices already had readable bodies. Artifacts are under `/workspace/shared/arena-support5/conditions-r456/`, including descriptor/condition/FAQ censuses and `full-diff.json`.

## Validation

The focused suite currently passes 111 native/protocol cases across both seats, loading stored rules and JSON-reloading actions/state. It covers boundaries, wrong Leader/black count/energy/empty deck, partial movement replacements, source and energy ABA, missing saved source, both arrival Auto distinctions, actual BT31-093 issuance and tax payment, late-tax failure/source ABA, actual Counter-window tax insertion, ordinary cleanup/negation/no-arrival/fresh occurrence, actual Wormhole, and actual BT31-150 Warp permission.

Protocol-injected taxes/replacement outcomes are explicitly labeled setup; they are not claims that every issuing card is compiled. The actual BT31-093 cases issue the tax through its native activation and on-play Auto.

Compatibility found a pre-existing `keywords.ts` fixture expecting a hand-only timed modifier to discount an Extra Counter's post-Drop skill orbs. The unchanged root reproducer confirms the failure after R453. The fixture now retains that Extra negative and exercises its red/blue and expiry positive on a Battle Counter whose skill payment still occurs in hand. OR beat-order assertions now reflect whole Drop, resources, activation, successful arrival, then cleanup registration.

Final successful logs (all exit 0; `verification.json` records the paths):

- `native-final2.log`: 111 cases, including live resource-cost change, JSON-safe tax identity, second rule during late payment, and carrying/control/no-op movement.
- `type-final3.log`, `lint-final2.log` (full touched source set), and `lint-final3.log` (last changed files).
- `keywords-fourth.log`: full keyword suite. Earlier `keywords-first` through `keywords-third` logs preserve the deliberately investigated failures; they are not passing evidence.
- `keyword-action-costs-926.log`, `taxes.log`, `activate-tax-677.log`.
- `audit-triggers-1.log`: 73 records / 28 VM cases; `phrasing-batch-1.log`: 36 records / 18 reload cases.
- `language.log`, `lang.log`, `teach.log`; only the two direct language fixtures were regenerated.
- `rulings.log`: 238 rulings; `cap-final.log`: 41 narrow scenarios / 98 VM source sites.

Ruleset generation and whitespace checks passed. No full gate, build, database write, paid service, dependency change, or live draft refresh was run. Parent integration must retain the later R463 Counter tax guard ordering and rerun its Energy/Drop native suites against the combined hotfiles.

## Parent follow-up: incremental tax payer receipts

A native BT31-093 tax reproduced duplicate payer receipts: each incremental choice re-appended all earlier picks, and final choice appended them again. After the first payer moved, a replacement pause on the second payer made stale duplicate entries look unpaid, incorrectly canceling Over Realm. Captures now merge by card and original epoch. Saved duplicate receipts preserve an existing completed-payment marker when coalesced; distinct occurrences remain distinct. Eight added both-seat cases cover early actual BT31-093 issuance, typed late-tax setup at a real Counter window, and old duplicate saved receipts. The focused suite now passes 119 cases. Reproduction and fixed logs are `recovery/or-tax-duplicate-repro.log`, `or-tax-duplicate-fixed.log` and `or-tax-occurrences-final.log`. This is an implementation correction to R456, with no new printed reading or rule interpretation.

Follow-up validation: typecheck and changed-file lint passed, together with the 33-case Awaken regression suite, browser boundary, language emission, capability check (42 scenarios / 98 VM sites), and 40 completed Fusion fuzz games with no crashes or interruptions. Compiler records are unchanged from checkpoint 38.
