# Complete card support workstream

The owner requested on 4 Nov 2026: “Continue until all cards are supported.” Continue in PR #1249; do not stop after one bounded family. The batch process still governs validation and combined integration.

## Starting point

At `93ebd6b9`, the frozen public Masters catalog has 6,597 cards and 13,964 skill records: 12,956 readable and 1,008 unread, spread across 916 cards. The catalog SHA-256 is `dcfba11b09fe10746a5f86176511bc9edd85c6156f239508a301326440339fb4`; the full-record baseline SHA-256 is `2284c8aa822b4cf781fc0338e377bd777eef35abfca28a5d5c5d7eff512fcac7`. This is compiler coverage, not a claim of fully verified gameplay or refreshed production records.

The fresh first-clause queue contains 206 moment, 107 condition, 279 selector and 414 effect skills. These overlap through later clauses. Two additional unread records are excluded by the current cluster tool’s defensive-refusal filter: BT28-028#0b and BT23-042#0. They remain in the completion scope; an excluded cluster is not a supported skill.

## Completion criteria

- Every catalog skill has an accurate, source-backed reading, or an explicit, reviewed explanation that it is a keyword/reminder/deck-construction line handled by the appropriate subsystem. No swallowed clause or unread-list suppression counts as support.
- All compiled operations, triggers, payment paths and permissions needed by those cards execute through stored rules. A parsed trigger with no event, or an invocation without the printed payment, does not count.
- Review every changed record’s costs, conditions, targets, side, area, count, optionality, duration and trigger. Exercise each new runtime family with actual actions/events, negative controls, both seats and saved-state checks where relevant.
- Recheck deliberately refused records and the silent-reading detector. Retain defensive guards for malformed or obsolete saved data; full support does not mean deleting every `NotYet` exception.
- Keep the games separate. The present 13,964-record audit measures Masters. Fusion fixture fuzz is a regression check, not proof that every Fusion card or every Masters deck is supported.
- Integrate the families and run the repository’s full gate once on the combined head, including the direct arena run and fixture review. Production record refresh is a separate, explicit integration step that respects confirmed records.

## Active sequence

1. Bring the previously reviewed seven condition misread corrections from the condition lane into PR #1249 and recheck their combined behavior.
2. Work the condition and trigger queues in separate worktrees. Reuse existing state/events where they express the printed rule faithfully; add missing state only with source research and runtime proof.
3. Continue into selector and effect mechanisms: non-hand activation permissions, invoked skills and costs, counted choices, copied/granted skills, replacements, delayed effects and paid-card references. These are dependencies to implement, not permanent deferrals.
4. Regenerate the full-record comparison and remaining queue after each combined batch. Preserve actual totals and evidence; do not report a percentage as complete card support.
5. Resolve genuine unanswered rules decisions from the documented source order. Ask the owner only for decisions that remain open after that research, while continuing independent work.

Record completed batches and their exact receipts below as they are integrated. Historical receipts retain the validation that ran on their own heads; they are not automatically evidence for a newer combined head.

## Integrated progress

- **Seven known condition misreads**, combined head `29326703`: the previously reviewed condition work is now in PR #1249. The new combined-head `audit-conditions-4` suite passes. A full-record comparison against `93ebd6b9` changes exactly the seven expected records, with no read/unread transitions; every changed cost field is its condition, with payment components preserved. Totals remain 12,956 readable / 1,008 unread. The full-record artifact SHA-256 is `72478eb41970effb1a7c27bb97721fc96c5cdd1c7c7298ec6b4a930d2a33ff73`; [structural evidence](round-4/conditions-port-program-diff.json) and [original source/review receipt](round-4/conditions-followup.md). New families continue below this checkpoint.

## Runtime baseline beyond unread text

`runtimeSupportOfRow` over the combined condition-port snapshot reports 396 records with additional explicit runtime reasons; 73 of those have no unread text. These 73 are included alongside the 1,008 unread records, giving 1,081 records requiring investigation at this checkpoint. The [additional readable-record gaps](support-baseline-runtime-gaps.json) retain the exact reason per skill. They include 47 unread payment contracts, eight missing face-up-life events, six unsupported Permanent optional programs, five unsupported Permanent skill negations, four missing Auto triggers, and one each of combo permission, typed Absorb and an Auto play price. Verify the runtime and metadata together before fixing or clearing a reason.

The checker also reports 2,556 context-dependent play targets as unknown. This is not a finding that all those cards are unsupported, and none is added to the explicit-gap count on that basis. Conversely, a clean static checker result is not exhaustive runtime proof.

## Source correction while investigating payment gaps

BT26-031’s public-feed Awaken text says “you have or more Z-Energy.” Bandai’s [printed front](https://www.dbs-cardgame.com/images/cardlist/cardimg/BT26-031.png), inspected on 4 Nov 2026, says “you have **3 or more** Z-Energy.” The catalog correction now restores that number without changing the life-to-hand effect or any other text; exact-delta and idempotence checks pass. The corrected printed payment condition is still unread at this checkpoint, so this source correction alone is not counted as newly supported gameplay. No database update was made.

- **First combined grammar/trigger checkpoint**, head `1aa146ce`: [receipt and full-record evidence](round-4/support-first-batch.md). Eleven more readable skills, 12,967 read / 997 unread; 122 focused scenarios in one process, typecheck and 40/40 fuzz passed. Twenty full records differ from the prior condition-port checkpoint, including six changed programs whose narration is unchanged. Payment and invocation work continues.

- **Awaken and Extra invocation checkpoint**, head `df50abd6`: [receipt and full-record evidence](round-4/support-second-batch.md). Ten payment contracts restored and four gates corrected; 252 combined focused scenarios, typecheck, Teach and rulings passed. Reading totals remain 12,967 / 997, while additional readable-record runtime gaps fall from 73 to 63. Extra invocation is a runtime improvement with no compiler-record delta. Surge and face-up-life work continue.

- **Surge, face-up Life and combo checkpoint**, head `1ec07f5e`: [receipt and full-record evidence](round-4/support-third-batch.md). Totals 12,969 readable / 995 unread, with no read-to-unread regression; additional readable-record runtime gaps fall to 48. The refresh set contains 82 changed records, including 59 narrative corrections. Combined focused tests and 40/40 fixture fuzz pass at the heads stated in the receipt. Shared Counter timing and entry-time partial negation continue.

- **Entry negation, implicit Absorb and passive costs**, source heads `e428cf6c` / `4560a682`, catalog proof followup `a9d2f507`: [receipt and full-record evidence](round-4/support-fourth-batch.md). Totals **12,972 readable / 992 unread**, additional readable-record runtime gaps **47**. Eighteen full records change, including three restored passive modifiers; no read-to-unread regressions. Entry checks preserve pre-entry Deflect and apply negation before on-play triggers. Lifecycle infrastructure is integrated and tested, but shared Counter windows are not yet enabled. Both entry and lifecycle runtime heads complete 40/40 fixture fuzz. Burst paid-card identity and shared Counter timing continue.

- **Burst history and printed payment repairs**, combined head `85112214`: [receipt and full-record evidence](round-4/support-fifth-batch.md). Totals **12,979 readable / 985 unread**, additional readable-record runtime gaps **44**. Ten full records change: seven Burst restorations, two Evolve prices and SD22 Awaken. The normalized SD16 FAQ corrects the bounded paid-color interpretation and requires Burst negation; R-391 supersedes R-389 on that point. Combined 526 focused scenarios, typecheck, lint, Teach, rulings, capability inventory and 40/40 fixture fuzz pass. SD3 explicit mill-payment history and shared Counter timing continue.

- **Explicit mill payment history**, source `d9761d50`, invocation proof `312424e3`: [receipt and full-record evidence](round-4/support-sixth-batch.md). Both SD3 faces restored, **12,981 readable / 983 unread**, additional readable-record runtime gaps **44**. Exactly two records change; printed payment and all unrelated fields are preserved. Combined 242 scenarios, typecheck, lint, rulings and 40/40 fuzz pass. Reserved payment aliases survive later effect mills; waived mill prices carry known-empty history. Turles combo replacement loading/destination checks and shared Counter timing continue.

## Open owner decision

An asynchronous owner question is pending: whether Cell Games effects waive a Battle Card’s printed skill cost when invoking its Activate: Main from Drop. The manual explicitly waives Extra-card invocation costs; no corresponding Battle-card answer was found in the manual, local official FAQs or ledger. BT26-115 and BT26-116 are concrete partners whose self-to-Drop/rest costs cannot be paid from Drop. Recommended intent reading: waive the printed cost while retaining conditions, usage limits and activation taxes. Do not treat elapsed time as an owner ruling; continue independent Extra invocation and payment work.

## Shared runtime gaps found during invocation review

Ordinary skill-driven Battle Card plays currently omit their Counter: Play windows (`vm/battle.ts`, `openPlayCounterWindow`, and `vm/host.ts`, `playThen`). Keyword-specific windows already have separate handling. BT21-002’s own official Q&A explicitly allows a Counter response to a Battle Card played by a nested skill while its parent is still resolving; RM 9-11-1 also requires nested processing and resumption. This is a shared runtime dependency, including invoked Extras that play cards. P-119’s tested search and P-389’s delayed removal do not exercise it. It is assigned for implementation after the current Life-event/privacy repair; neither a readable program nor the Extra-invocation checkpoint means this timing is already supported.

Face-up-Life testing also found that a generated plain-Life choice lacks the blind flag and reveals face-down candidates to its chooser before the flip. The non-chooser remains unable to see them. The compiler choice repair is integrated in `235138a1` (R-363), with explicit face-up/previously-seen cases preserved and both viewers checked. It marks plain Life choices blind and accepts the current positional alias; only the selected card becomes public when flipped. It does not widen snapshot visibility. Stored records need the eventual refresh to receive the corrected choice.

## Follow-up audit evidence

At the fourth full-record snapshot, 1,429 records have empty operations and no unread clauses. Rechecking their printed skills with `readsAsNothingSilently` finds no silent blank among the 1,407 records that reparse as one skill. The other 22 print adjacent keyword tags; manual inspection confirms the stored identity is Field, Over Realm, Overlord or Union, whose own program is intentionally empty. This is an empty-program check, not proof that every keyword payment or runtime path works. Scratch evidence: `/tmp/arena-support5/combined/fourth-empty-record-audit.json` and `/tmp/arena-support5/silent-record-check.mts`.

The payment census identifies two bare numeric Evolve prices: P-006 (`{g}{g}1`) and BT2-084 (`{g}{g}4`). Bandai's printed images, inspected on 4 Nov 2026, show two green orbs plus a generic one/four respectively. Those generic amounts must become part of the payment, not be discarded as unread prose. Their existing own-card FAQ is absent or unrelated to payment; the repair is integrated in the fifth checkpoint with paid-total, colour and base tests. Source images: `https://www.dbs-cardgame.com/images/cardlist/cardimg/P-006.png` and `https://www.dbs-cardgame.com/images/cardlist/cardimg/BT2-084.png`.


## Additional source-backed followups

- The four Turles combo replacements (BT12-071, BT12-072, BT12-074, BT12-075) already have a standing runtime path, but confirmed/corrected records are blocked by the generic missing-Auto-trigger check. Investigation also finds their substitute replacement loses the printed Drop-only destination. Correct and test both issues before classifying these records as supported; draft/compiler-only tests are insufficient.
- Standing full negation remains a runtime dependency. Normalized DB1-066 and BT10-153 FAQs require first-in-play priority, suppression persisting after temporary negation lets the other Permanent take over, protection from skill negation, granted keyword negation and distinct pre-/post-entry Deflect behavior. TB1-048's FAQ confirms Barrier is not protection from this unchosen standing effect. Source extraction: `/tmp/arena-support5/combined/permanent-next-intent.txt`.
- Distinguish supplementary keywords from keyword skills when auditing chosen negation. RM 22-1-2 says supplementary keywords are not skills by themselves; Burst (22-27-1), Spirit Boost (22-43-1), Limit (22-44-1), Bond (22-21-1) and Sparking are not automatically standalone options for “choose one keyword skill.” Conversely, RM 22-1-3 says negating keyword skills stops the keyword from applying, and SD16-001 expressly confirms this for Burst. The existing Burst fix does not prove global-negation handling for every supplementary keyword; audit those validity/payment/usage paths separately.

- Chosen keyword negation also needs a separate Counter-line audit: RM 9-7-1 explicitly makes Counter a keyword skill, but `printedKeywords` currently gathers only `Skill.keyword` and the `KeywordSkill` union has no Counter member. Verify actual stored Counter lines on an attacking Battle Card, per-line identity and later counter activation; the current chosen-instance tests do not establish that coverage. Do not confuse this with the supplementary-keyword exclusions above.
