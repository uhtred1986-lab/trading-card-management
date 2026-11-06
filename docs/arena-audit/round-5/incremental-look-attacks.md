# R533: six exact attack inspections

**Native acceptance completed:** the retained full six-source matrix passed230 cases with exit0. The initial commit8256a88f was explicitly WIP while that original process continued; this follow-up records its actual completion, without retroactively assigning that evolving loaded source a commit hash. Parent still owns the final combined gate.

Six complete original free attack Auto lines use the existing R527/R529/R530 inspection kernel. There are no VM, UI, runtime filter, source-correction, registry or runner changes. Bio-Man remains a separate identity-source review.

## Source and rule evidence

The fixture `scripts/verify/fixtures/incremental-look-attacks-5.json` freezes complete raw cards, both faces, all original skill records, all supplied normalized FAQs, complete matching target definitions, genuine Extra nonmatches, and official image URLs/SHA-256. All eleven official face images were personally inspected. Five sources are Leaders (10000 front, 15000 back), with no play cost. P-077 Yamcha is a Red Battle Card: total cost2, **two Red orbs**, power15000, combo0+5000. The native definition sets those two specified Red requirements explicitly.

P-434's original image and raw catalog say non-Villainous cards. The existing official 2022-11-18 correction in `correctSkillText` narrows this to non-Villainous **Battle Cards**. The native definition uses that corrected complete Permanent and preserves its Hand specified-cost reduction. Its frozen original compiled row already contains the correction; this slice introduces no new erratum. The test checks the actual deck-rule predicate accepts Villainous Battle targets and non-Villainous Extras and rejects a non-Villainous Battle control.

The supplied FAQ for BT24-026 confirms the back removal-trigger Auto can respond to its own removal skill. That full sibling remains unchanged. The other five supplied FAQ objects are empty; no broader FAQ-absence claim is made. BT23-072's back final skill is Activate: Battle, and its paid discard-one attack Auto is preserved, not admitted as an incremental inspection.

RM8-1-3 through 8-1-5 establish attack declaration, pending Autos, Counter timing, then checkpoint resolution. RM20-12 keeps inspection private and cards in their original area; the printed shuffle still occurs after stopping at zero. RM3-1-7 requires revealing the selected specified card moving Deck to Hand. RM5-2-7 permits declining the hidden-area choice. Every exact candidate gains only `ops[0].upTo` and corresponding `reads`; the whole original row and all siblings are deep-compared (30 records: six admitted rows and 24 unchanged siblings).

## Exact admitted lines

**BT10-093#0**

> [Auto] When this card attacks, look at up to 5 cards from the top of your deck, add up to 1 ≪Shadow Dragon≫ card among them to your hand, then shuffle your deck.

**P-290#0**

> [Auto] When this card attacks, look at up to 5 cards from the top of your deck, add up to 1 ≪Goku's Lineage≫ card among them to your hand, then shuffle your deck.

**P-434#10**

> [Auto] When this card attacks, look at up to 5 cards from the top of your deck, add up to 1 ≪Villainous≫ card among them to your hand, and shuffle your deck.

**P-077#0**

> [Auto] When this card attacks, look at up to 3 cards from the top of your deck, choose up to 1 ≪Earthling≫ card among them, add it to your hand. Then shuffle your deck.

**BT23-072#10**

> [Auto] When this card attacks, look at up to 5 cards from the top of your deck, add up to 1 <Zamasu> or <Goku Black> card to your hand, then shuffle your deck.

**BT24-026#0**

> [Auto] When this card attacks, look at up to 5 cards from the top of your deck, add up to 1 ≪Phantom Demon≫ card to your hand, then shuffle your deck.

## Native proof and fixture scope

The dedicated `incremental-look-attacks-5.ts` suite starts real games in both seats, makes the other player go first, passes that turn through real actions, and reaches the tested player's legal attacking turn without editing turn counters. It asserts turn-one attacks are unavailable. Leaders are their original createGame instances with full front/back definitions. Yamcha is explicitly staged in Hand with two Red energy resources, then actually played and paid through native play/Counter flow; no attack Auto pends from the play. The native payment chooser explicitly selects both Red payers and preserves the ordinary second-player energy marker. In a separate resource control with no energy marker, one Red plus one Blue is insufficient.

The initial 50-copy synthetic Extra list is a controlled engine fixture, **not a tournament-legal constructed-deck claim**. Ordered Deck/resource setup is explicit. All actual inspected matching faces and normal nonmatching faces are complete frozen catalog definitions. Magenta's initial Extra type, all genuine Extra nonmatches and Villainous target comply with its corrected deck restriction. The synthetic case/suffix controls are separately labeled, and do not purport to be legal printed cards. Unplayed targets retain full identities and skill text, but their unverified specified-cost/combo defaults are not pricing claims.

Each source declares an offered legal attack at the opponent's Leader, rests, and produces exactly one original indexed attacks Auto with its captured source/script. A synthetic zero-cost Counter with the complete text `[Counter: Attack] Negate the attack.` keeps that native window observable; ordinary empty windows otherwise auto-pass. Tests pass the window normally and separately actually negate the attack, proving the pending Auto survives negation. Every action is checked for JSON replay and input purity.

Both seats cover stop0/1/full maximum, choose0/1, exact ordered private prefix, final genuine nonmatching face before Continue, unchanged Deck/RNG during inspection, selected Hand addition/public event-scoped reveal and final shuffle. Short Deck and ordinary empty-Deck loss are covered; the empty-Deck boundary is staged after Yamcha has completed genuine paid play and resolves at the subsequent attack checkpoint. No live empty Deck or empty inspection is fabricated at a payment prompt. Zamasu and Goku Black each qualify independently, with at most one selected total; their full source Permanent remains installed. Forged/nonmatching/unseen/duplicate selections refuse. Pending receipt removal/body corruption and preactivation source-transition controls refuse without private faces. Five Leaders separately flip their actual instance before activation to prove face binding; interrupted outcomes must be exactly interrupted, never win/draw. The source-departure saved-receipt case is explicitly a **postactivation movement primitive**, not a concurrently legal player action or newly supported Counter-removal transition.

Opponent boardView/full Snapshot/events/beats hide every inspected/unseen face before the filtered Hand move. Only the selected Hand face is disclosed through the existing event-scoped alias, with no physical/decklist ID; the opponent's later Hand projection remains hidden. No global seen-state widening is introduced. Existing R529 stale reveal/alias tests and R530 dynamic-eligibility tests remain the compatibility proof for those unchanged mechanisms.

Near-match controls change the maximum, identity, tail or attack producer to attacked, and receive no admission. Generic look lowering and the prior exact played admissions remain unchanged.

## Verification

The retained six-source matrix passed **230 cases**, exit0: BT10-09338, P-29038, P-43438, P-07738, BT23-07240, BT24-02638. Session93935/PID333196 completed. It launched against fb791b42 plus the reviewed R533 working changes, before the WIP commit; no retroactive commit hash is assigned to that loaded source. The sole subsequent test-source edit was the per-card completion console line; assertions, final Leader/Extra combo-null definitions and fixture data were already loaded. Reconstructed loaded-source SHA-256 is `641366befea9a2ad64339d1b0e30003ae80b4c7a9fab733477cdf6c0df46bb7a`; committed progress-logging source SHA-256 is `bc6c45e5762f19a432133a46c04aae4e3f9bc6362097d5f4e4d90295b80210eb`. Reconstruction and the completed receipt remain at `/workspace/shared/arena-support5/recovery/r533-matrix-loaded-source.ts` and `r533-matrix-loaded-receipt.json`. Root collected a brief read-only CPU profile without pausing/killing the process or changing source/assertions; no fixture reduction or proof restart occurred.

A preceding Yamcha-only run passed38 cases. The retained full result now supersedes that subset acceptance. Compatibility already passed: native Gohan/Trunks48, saved/empty contracts86, language22, Babidi29, Cheelai53, ordinary played422, attack timing1139, attack-negation936 and public move projection28. Production compiler code has not changed since those passes. Final typecheck, touched-file ESLint, whitespace and ruling validation passed (304 worker rulings; the parent has separately integrated work). The final per-source count and exit0 above close the native acceptance; combined-head integration remains the parent’s check. No database, dependency installation, full scan, full gate, build or push is performed by this worker. Parent owns registration and combined-head validation.

Root integration WIP `fdf0aa3a`: the full frozen catalog comparison changes exactly BT10-093#0, P-290#0, P-434#10, P-077#0, BT23-072#10 and BT24-026#0, each only optional-look `ops` and `reads`. All other13,960 complete records and field sets are identical to checkpoint85. Totals remain6,597 cards/13,966 records/13,032 readable/934 unread. Snapshot SHA-256:`aacd539f36cfe10b5288273df8517094d8e7417b39eab16bbff04744582bcd63`. Combined TypeScript, focused lint and rulings305/171 pass. The retained native matrix subsequently passed 230 cases as recorded above. The combined full gate remains pending; this is not an all-card support claim.
