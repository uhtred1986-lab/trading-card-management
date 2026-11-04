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

## Open owner decision

An asynchronous owner question is pending: whether Cell Games effects waive a Battle Card’s printed skill cost when invoking its Activate: Main from Drop. The manual explicitly waives Extra-card invocation costs; no corresponding Battle-card answer was found in the manual, local official FAQs or ledger. BT26-115 and BT26-116 are concrete partners whose self-to-Drop/rest costs cannot be paid from Drop. Recommended intent reading: waive the printed cost while retaining conditions, usage limits and activation taxes. Do not treat elapsed time as an owner ruling; continue independent Extra invocation and payment work.

## Shared runtime gaps found during invocation review

Ordinary skill-driven Battle Card plays currently omit their Counter: Play windows (`vm/battle.ts`, `openPlayCounterWindow`, and `vm/host.ts`, `playThen`). Keyword-specific windows already have separate handling. BT21-002’s own official Q&A explicitly allows a Counter response to a Battle Card played by a nested skill while its parent is still resolving; RM 9-11-1 also requires nested processing and resumption. This is a shared runtime dependency, including invoked Extras that play cards. P-119’s tested search and P-389’s delayed removal do not exercise it. It is assigned for implementation after the current Life-event/privacy repair; neither a readable program nor the Extra-invocation checkpoint means this timing is already supported.

Face-up-Life testing also found that a generated plain-Life choice lacks the blind flag and reveals face-down candidates to its chooser before the flip. The non-chooser remains unable to see them. The compiler choice repair is integrated in `235138a1` (R-363), with explicit face-up/previously-seen cases preserved and both viewers checked. It marks plain Life choices blind and accepts the current positional alias; only the selected card becomes public when flipped. It does not widen snapshot visibility. Stored records need the eventual refresh to receive the corrected choice.
